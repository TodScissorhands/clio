mod epub_session;
mod bookmarks;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReadingPosition {
    page: u32,
    offset: f64,
}

#[derive(Deserialize, Serialize)]
enum EpubCfiModel {
    #[serde(rename = "foliate-html-v1")]
    FoliateHtmlV1,
}

// An absent tag is legacy; an explicit null/unknown tag is not.
fn deserialize_epub_cfi_model<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<EpubCfiModel>, D::Error> {
    EpubCfiModel::deserialize(deserializer).map(Some)
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EpubReadingPosition {
    cfi: String,
    #[serde(default, rename = "cfiModel", deserialize_with = "deserialize_epub_cfi_model", skip_serializing_if = "Option::is_none")]
    cfi_model: Option<EpubCfiModel>,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum StoredPosition {
    Pdf(ReadingPosition),
    Epub(EpubReadingPosition),
    // Preserve unsupported or malformed records without hiding other saved positions.
    Other(serde_json::Value),
}

impl StoredPosition {
    fn into_pdf(self) -> Option<ReadingPosition> {
        match self {
            Self::Pdf(position) => Some(position),
            _ => None,
        }
    }

    fn into_epub(self) -> Option<EpubReadingPosition> {
        match self {
            Self::Epub(position) if is_valid_epub_cfi(&position.cfi) => Some(position),
            _ => None,
        }
    }
}

fn is_valid_epub_cfi(cfi: &str) -> bool {
    cfi.strip_prefix("epubcfi(")
        .and_then(|value| value.strip_suffix(')'))
        .is_some_and(|value| {
            value.starts_with('/')
                && value.as_bytes().get(1).is_some_and(u8::is_ascii_digit)
                && !value.chars().any(char::is_control)
        })
}

// Both worker failures and join failures reject the existing string-error IPC contract.
async fn blocking_io<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Native I/O worker failed: {error}"))?
}

fn canonicalize_pdf_path_sync(path: String) -> Result<String, String> {
    let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if canonical.extension().and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("Choose a file with a .pdf extension.".into());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
async fn canonicalize_pdf_path(path: String) -> Result<String, String> {
    blocking_io(move || canonicalize_pdf_path_sync(path)).await
}

#[tauri::command]
async fn read_pdf_file(path: String) -> Result<tauri::ipc::Response, String> {
    blocking_io(move || {
        let canonical = canonicalize_pdf_path_sync(path)?;
        let bytes = fs::read(canonical).map_err(|error| error.to_string())?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
}

fn canonicalize_epub_path_sync(path: String) -> Result<String, String> {
    let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if canonical.extension().and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("epub"))
    {
        return Err("Choose a file with a .epub extension.".into());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
async fn canonicalize_epub_path(path: String) -> Result<String, String> {
    blocking_io(move || canonicalize_epub_path_sync(path)).await
}

#[tauri::command]
async fn read_epub_file(path: String) -> Result<tauri::ipc::Response, String> {
    blocking_io(move || {
        let canonical = canonicalize_epub_path_sync(path)?;
        let bytes = fs::read(canonical).map_err(|error| error.to_string())?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
}

fn positions_file(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(directory.join("reading-positions.json"))
}

fn read_positions(path: &Path) -> Result<HashMap<String, StoredPosition>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PositionWriteStage {
    QuarantineCandidate,
    QuarantineCreated,
    QuarantineWritten,
    QuarantineSynced,
    BeforeQuarantineRemove,
    TemporaryCandidate,
    TemporaryCreated,
    TemporaryWritten,
    BeforeReplace,
    Replaced,
}

// Candidate names are advisory; create_new is the authority even after a crash
// or a PID/clock reuse. Never open an existing candidate for writing.
fn create_position_sibling(
    destination: &Path,
    suffix: &str,
    stage: PositionWriteStage,
    hook: &mut impl FnMut(PositionWriteStage, &Path) -> Result<(), String>,
) -> Result<(PathBuf, fs::File), String> {
    static NEXT_FILE: AtomicU64 = AtomicU64::new(0);
    loop {
        let mut name = destination.file_name().ok_or("Invalid app-data path.")?.to_os_string();
        name.push(format!(".{suffix}.{}.{}", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
        let path = destination.with_file_name(name);
        hook(stage, &path)?;
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn sync_position_directory(directory: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(directory).and_then(|file| file.sync_all()).map_err(|error| error.to_string())?;
    #[cfg(not(unix))]
    let _ = directory;
    Ok(())
}

fn positions_for_write(
    destination: &Path,
    hook: &mut impl FnMut(PositionWriteStage, &Path) -> Result<(), String>,
) -> Result<HashMap<String, StoredPosition>, String> {
    let bytes = match fs::read(destination) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(error.to_string()),
    };
    if let Ok(positions) = serde_json::from_slice(&bytes) {
        return Ok(positions);
    }
    let directory = destination.parent().ok_or("Invalid app-data path.")?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?.as_millis();
    let (quarantine, mut file) = create_position_sibling(destination,
        &format!("corrupt.{timestamp}"), PositionWriteStage::QuarantineCandidate, hook)?;
    let protection = (|| {
        hook(PositionWriteStage::QuarantineCreated, &quarantine)?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        hook(PositionWriteStage::QuarantineWritten, &quarantine)?;
        file.sync_all().map_err(|error| error.to_string())?;
        hook(PositionWriteStage::QuarantineSynced, &quarantine)?;
        sync_position_directory(directory)
    })();
    drop(file);
    if let Err(error) = protection {
        let _ = fs::remove_file(&quarantine);
        return Err(error);
    }
    // No deletion before both the copy and its directory entry are protected.
    hook(PositionWriteStage::BeforeQuarantineRemove, &quarantine)?;
    fs::remove_file(destination).map_err(|error| error.to_string())?;
    eprintln!("Quarantined malformed reading positions; original preserved at {}", quarantine.display());
    Ok(HashMap::new())
}

#[cfg(not(windows))]
fn replace_position_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn replace_position_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    // Both paths are siblings. No copy fallback or destination removal: a
    // replacement failure must leave the old store intact.
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(),
        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

fn write_position(
    destination: &Path,
    canonical: String,
    position: StoredPosition,
) -> Result<(), String> {
    write_position_with_hook(destination, canonical, position, &mut |_, _| Ok(()))
}

fn write_position_with_hook(
    destination: &Path,
    canonical: String,
    position: StoredPosition,
    hook: &mut impl FnMut(PositionWriteStage, &Path) -> Result<(), String>,
) -> Result<(), String> {
    let mut positions = positions_for_write(destination, hook)?;
    positions.insert(canonical, position);
    let directory = destination.parent().ok_or("Invalid app-data path.")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(&positions).map_err(|error| error.to_string())?;
    let (temporary, mut file) = create_position_sibling(destination, "tmp",
        PositionWriteStage::TemporaryCandidate, hook)?;
    let preparation = (|| {
        hook(PositionWriteStage::TemporaryCreated, &temporary)?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        hook(PositionWriteStage::TemporaryWritten, &temporary)?;
        file.sync_all().map_err(|error| error.to_string())
    })();
    drop(file);
    let result = preparation
        .and_then(|()| hook(PositionWriteStage::BeforeReplace, &temporary))
        .and_then(|()| replace_position_file(&temporary, destination));
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    // A failure here is reported even though complete new JSON is visible.
    hook(PositionWriteStage::Replaced, destination)?;
    sync_position_directory(directory)
}

// Keep the complete read/modify/replace transaction under the one shared lock.
// Only call this from a blocking worker; no guard may cross an await.
fn with_position_lock<T>(
    lock: &Mutex<()>,
    transaction: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let (guard, poisoned) = match lock.lock() {
        Ok(guard) => (guard, false),
        Err(error) => (error.into_inner(), true),
    };
    // Disk, not protected in-memory state, is authoritative. Failed or panicked
    // transactions leave poison set; only a successful serialized transaction
    // establishes that the recoverable on-disk state can be used again.
    let result = transaction();
    if poisoned && result.is_ok() { lock.clear_poison(); }
    drop(guard);
    result
}

#[tauri::command]
async fn load_reading_position(
    app: AppHandle,
    lock: State<'_, Arc<Mutex<()>>>,
    path: String,
) -> Result<Option<ReadingPosition>, String> {
    let lock = Arc::clone(lock.inner());
    blocking_io(move || {
        let canonical = canonicalize_pdf_path_sync(path)?;
        with_position_lock(&lock, || {
            let mut positions = read_positions(&positions_file(&app)?)?;
            Ok(positions.remove(&canonical).and_then(StoredPosition::into_pdf))
        })
    })
    .await
}

#[tauri::command]
async fn save_reading_position(
    app: AppHandle,
    lock: State<'_, Arc<Mutex<()>>>,
    path: String,
    page: u32,
    offset: f64,
) -> Result<(), String> {
    let lock = Arc::clone(lock.inner());
    blocking_io(move || {
        if page == 0 || !offset.is_finite() || !(0.0..=1.0).contains(&offset) {
            return Err("Invalid reading position.".into());
        }
        let canonical = canonicalize_pdf_path_sync(path)?;
        with_position_lock(&lock, || {
            write_position(
                &positions_file(&app)?,
                canonical,
                StoredPosition::Pdf(ReadingPosition { page, offset }),
            )
        })
    })
    .await
}

#[tauri::command]
async fn load_epub_reading_position(
    app: AppHandle,
    lock: State<'_, Arc<Mutex<()>>>,
    path: String,
) -> Result<Option<EpubReadingPosition>, String> {
    let lock = Arc::clone(lock.inner());
    blocking_io(move || {
        let canonical = canonicalize_epub_path_sync(path)?;
        with_position_lock(&lock, || {
            let mut positions = read_positions(&positions_file(&app)?)?;
            Ok(positions.remove(&canonical).and_then(StoredPosition::into_epub))
        })
    })
    .await
}

#[tauri::command]
async fn save_epub_reading_position(
    app: AppHandle,
    lock: State<'_, Arc<Mutex<()>>>,
    path: String,
    cfi: String,
    cfi_model: Option<EpubCfiModel>,
) -> Result<(), String> {
    let lock = Arc::clone(lock.inner());
    blocking_io(move || {
        if !is_valid_epub_cfi(&cfi) {
            return Err("Invalid EPUB reading position.".into());
        }
        let canonical = canonicalize_epub_path_sync(path)?;
        with_position_lock(&lock, || {
            write_position(
                &positions_file(&app)?,
                canonical,
                StoredPosition::Epub(EpubReadingPosition { cfi, cfi_model }),
            )
        })
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Mutex::new(())))
        .manage(epub_session::Sessions::default())
        .manage(bookmarks::Bookmarks::default())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                epub_session::shutdown_sessions(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            epub_session::epub_bookmarks,
            epub_session::create_epub_session,
            epub_session::read_epub_session,
            epub_session::load_epub_session_position,
            epub_session::save_epub_session_position,
            epub_session::close_epub_session,
            epub_session::ready_epub_session,
            epub_session::commit_epub_session,
            epub_session::retire_epub_session,
            epub_session::request_epub_open,
            epub_session::begin_epub_acquisition,
            canonicalize_pdf_path,
            read_pdf_file,
            canonicalize_epub_path,
            read_epub_file,
            load_reading_position,
            save_reading_position,
            load_epub_reading_position,
            save_epub_reading_position
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(super) struct TestDirectory(pub(super) PathBuf);

    impl TestDirectory {
        pub(super) fn new() -> Self {
            static NEXT_ID: AtomicU64 = AtomicU64::new(0);
            let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!(
                "clio-reading-positions-{}-{timestamp}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reading_positions_quarantine_failures_retain_original_bytes() {
        for stage in [
            PositionWriteStage::QuarantineCandidate,
            PositionWriteStage::QuarantineCreated,
            PositionWriteStage::QuarantineWritten,
            PositionWriteStage::QuarantineSynced,
            PositionWriteStage::BeforeQuarantineRemove,
        ] {
            let directory = TestDirectory::new();
            let destination = directory.0.join("reading-positions.json");
            let original = b"{malformed\0\xff";
            fs::write(&destination, original).unwrap();
            let mut preserved = None;
            let error = positions_for_write(&destination, &mut |current, path| {
                if current != stage { return Ok(()); }
                if current == PositionWriteStage::QuarantineCreated {
                    fs::write(path, b"partial copy").unwrap();
                }
                preserved = Some(path.to_path_buf());
                Err("injected quarantine failure".into())
            }).err().unwrap();
            assert_eq!(error, "injected quarantine failure");
            assert_eq!(fs::read(&destination).unwrap(), original);
            let path = preserved.unwrap();
            if stage == PositionWriteStage::BeforeQuarantineRemove {
                assert_eq!(fs::read(path).unwrap(), original);
            } else {
                assert!(!path.exists());
            }
        }
    }

    #[test]
    fn reading_positions_quarantines_are_unique_and_never_overwrite() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let mut collision = None;
        for original in [b"{first".as_slice(), b"{second".as_slice()] {
            fs::write(&destination, original).unwrap();
            positions_for_write(&destination, &mut |stage, path| {
                if stage == PositionWriteStage::QuarantineCandidate && collision.is_none() {
                    fs::write(path, b"existing quarantine").unwrap();
                    collision = Some(path.to_path_buf());
                }
                Ok(())
            }).unwrap();
        }
        assert_eq!(fs::read(collision.unwrap()).unwrap(), b"existing quarantine");
        let mut contents: Vec<_> = fs::read_dir(&directory.0).unwrap()
            .map(|entry| fs::read(entry.unwrap().path()).unwrap()).collect();
        contents.sort();
        let mut expected = vec![b"{first".to_vec(), b"{second".to_vec(), b"existing quarantine".to_vec()];
        expected.sort();
        assert_eq!(contents, expected);
    }

    #[test]
    fn reading_positions_replacement_failure_after_quarantine_retains_recoverable_bytes() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let original = b"{malformed\0\xff";
        fs::write(&destination, original).unwrap();
        let error = write_position_with_hook(&destination, "failed.pdf".into(),
            StoredPosition::Pdf(ReadingPosition { page: 1, offset: 0.0 }),
            &mut |stage, _| {
                if stage == PositionWriteStage::TemporaryCandidate {
                    Err("injected temp creation failure after quarantine".into())
                } else { Ok(()) }
            }).unwrap_err();
        assert_eq!(error, "injected temp creation failure after quarantine");
        assert!(!destination.exists());
        let quarantine = fs::read_dir(&directory.0).unwrap().next().unwrap().unwrap().path();
        assert_eq!(fs::read(&quarantine).unwrap(), original);
        write_position(&destination, "recovered.pdf".into(),
            StoredPosition::Pdf(ReadingPosition { page: 3, offset: 0.5 })).unwrap();
        assert_eq!(read_positions(&destination).unwrap().remove("recovered.pdf")
            .unwrap().into_pdf().unwrap().page, 3);
        assert_eq!(fs::read(quarantine).unwrap(), original);
    }

    #[test]
    fn reading_positions_native_replacement_error_retains_old_store() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let original = br#"{"old":{"page":9,"offset":0.25}}"#;
        fs::write(&destination, original).unwrap();
        let result = write_position_with_hook(&destination, "new".into(),
            StoredPosition::Pdf(ReadingPosition { page: 2, offset: 0.5 }),
            &mut |stage, path| {
                if stage == PositionWriteStage::BeforeReplace {
                    // Force the platform replacement API itself to fail.
                    fs::remove_file(path).unwrap();
                }
                Ok(())
            });
        assert!(result.is_err());
        assert_eq!(fs::read(&destination).unwrap(), original);
        assert_eq!(read_positions(&destination).unwrap().remove("old")
            .unwrap().into_pdf().unwrap().page, 9);
    }

    #[test]
    fn reading_positions_failed_preparation_retains_complete_old_store() {
        for stage in [
            PositionWriteStage::TemporaryCandidate,
            PositionWriteStage::TemporaryCreated,
            PositionWriteStage::TemporaryWritten,
            PositionWriteStage::BeforeReplace,
        ] {
            let directory = TestDirectory::new();
            let destination = directory.0.join("reading-positions.json");
            let original = br#"{"/library/old.pdf":{"page":9,"offset":0.25}}"#;
            fs::write(&destination, original).unwrap();
            let orphan = directory.0.join("reading-positions.json.tmp.orphan");
            fs::write(&orphan, b"incomplete orphan").unwrap();
            let error = write_position_with_hook(&destination, "/library/new.pdf".into(),
                StoredPosition::Pdf(ReadingPosition { page: 2, offset: 0.5 }),
                &mut |current, path| {
                    if current != stage { return Ok(()); }
                    if current == PositionWriteStage::TemporaryCreated {
                        fs::write(path, b"partial JSON").unwrap();
                    }
                    Err("injected temp failure".into())
                }).unwrap_err();
            assert_eq!(error, "injected temp failure");
            assert_eq!(fs::read(&destination).unwrap(), original);
            assert_eq!(read_positions(&destination).unwrap().remove("/library/old.pdf")
                .unwrap().into_pdf().unwrap().page, 9);
            assert_eq!(fs::read(&orphan).unwrap(), b"incomplete orphan");
            assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 2);
        }
    }

    #[test]
    fn reading_positions_interrupted_write_and_collision_preserve_data() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let original = br#"{"old":{"page":9,"offset":0.25}}"#;
        fs::write(&destination, original).unwrap();
        let mut orphan = None;
        let interrupted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            write_position_with_hook(&destination, "interrupted".into(),
                StoredPosition::Pdf(ReadingPosition { page: 1, offset: 0.0 }),
                &mut |stage, path| {
                    if stage == PositionWriteStage::TemporaryWritten {
                        orphan = Some(path.to_path_buf());
                        panic!("interrupted before replacement");
                    }
                    Ok(())
                })
        }));
        assert!(interrupted.is_err());
        assert_eq!(fs::read(&destination).unwrap(), original);
        let orphan = orphan.unwrap();
        let orphan_bytes = fs::read(&orphan).unwrap();
        let mut collision = None;
        write_position_with_hook(&destination, "new".into(),
            StoredPosition::Pdf(ReadingPosition { page: 3, offset: 0.5 }),
            &mut |stage, path| {
                if stage == PositionWriteStage::TemporaryCandidate && collision.is_none() {
                    fs::write(path, b"pre-existing temp").unwrap();
                    collision = Some(path.to_path_buf());
                }
                Ok(())
            }).unwrap();
        assert_eq!(fs::read(collision.unwrap()).unwrap(), b"pre-existing temp");
        assert_eq!(fs::read(orphan).unwrap(), orphan_bytes);
        let mut saved = read_positions(&destination).unwrap();
        assert_eq!(saved.remove("old").unwrap().into_pdf().unwrap().page, 9);
        assert_eq!(saved.remove("new").unwrap().into_pdf().unwrap().page, 3);
        assert!(!saved.contains_key("interrupted"));
    }

    #[test]
    fn reading_positions_post_replace_failure_leaves_complete_new_store() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        fs::write(&destination, b"{}").unwrap();
        let error = write_position_with_hook(&destination, "new".into(),
            StoredPosition::Pdf(ReadingPosition { page: 7, offset: 0.25 }),
            &mut |stage, _| {
                if stage == PositionWriteStage::Replaced {
                    Err("injected directory sync failure".into())
                } else { Ok(()) }
            }).unwrap_err();
        assert_eq!(error, "injected directory sync failure");
        assert_eq!(read_positions(&destination).unwrap().remove("new").unwrap()
            .into_pdf().unwrap().page, 7);
    }

    #[test]
    fn malformed_positions_are_quarantined_before_recovery() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let original = b"{malformed";
        fs::write(&destination, original).unwrap();
        let result = write_position(&destination, "/library/book.pdf".into(),
            StoredPosition::Pdf(ReadingPosition { page: 12, offset: 0.25 }));
        if let Err(error) = &result {
            assert_eq!(fs::read(&destination).unwrap(), original);
            eprintln!("Recovery failed; original bytes retained: {error}");
        }
        result.unwrap();
        let quarantines: Vec<_> = fs::read_dir(&directory.0).unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.file_name().unwrap().to_string_lossy()
                .starts_with("reading-positions.json.corrupt."))
            .collect();
        assert_eq!(quarantines.len(), 1);
        assert_eq!(fs::read(&quarantines[0]).unwrap(), original);
        write_position(&destination, "/library/book.epub".into(),
            StoredPosition::Epub(EpubReadingPosition {
                cfi: "epubcfi(/6/4!/4/2/1:20)".into(),
                cfi_model: Some(EpubCfiModel::FoliateHtmlV1),
            })).unwrap();
        let mut positions = read_positions(&destination).unwrap();
        assert_eq!(positions.len(), 2);
        assert_eq!(positions.remove("/library/book.pdf").unwrap().into_pdf().unwrap().page, 12);
        let epub = positions.remove("/library/book.epub").unwrap().into_epub().unwrap();
        assert_eq!(epub.cfi, "epubcfi(/6/4!/4/2/1:20)");
        assert!(matches!(epub.cfi_model, Some(EpubCfiModel::FoliateHtmlV1)));
    }

    #[test]
    fn epub_cfi_models_preserve_legacy_and_unknown_records() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let fixture = serde_json::json!({
            "legacy.epub": { "cfi": "epubcfi(/6/2!/4/2/1:0)" },
            "current.epub": { "cfi": "epubcfi(/6/2!/4/2/1:4)", "cfiModel": "foliate-html-v1" },
            "future.epub": { "cfi": "epubcfi(/6/2!/4/2/1:8)", "cfiModel": "future", "extra": true },
            "null-model.epub": { "cfi": "epubcfi(/6/2!/4/2/1:8)", "cfiModel": null }
        });
        fs::write(&destination, serde_json::to_vec(&fixture).unwrap()).unwrap();
        let mut records = read_positions(&destination).unwrap();
        assert!(records.remove("legacy.epub").unwrap().into_epub().unwrap().cfi_model.is_none());
        assert!(records.remove("current.epub").unwrap().into_epub().unwrap().cfi_model.is_some());
        assert!(records.remove("future.epub").unwrap().into_epub().is_none());
        assert!(records.remove("null-model.epub").unwrap().into_epub().is_none());
        write_position(&destination, "other.pdf".into(), StoredPosition::Pdf(ReadingPosition { page: 1, offset: 0.0 })).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&destination).unwrap()).unwrap();
        for key in ["legacy.epub", "current.epub", "future.epub", "null-model.epub"] {
            assert_eq!(saved[key], fixture[key]);
        }
    }

    #[test]
    fn legacy_pdf_and_mixed_records_keep_their_json_format() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let legacy = serde_json::json!({
            "/library/book.pdf": { "page": 17, "offset": 0.375 }
        });
        fs::write(&destination, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let positions = read_positions(&destination).unwrap();
        assert_eq!(serde_json::to_value(&positions).unwrap(), legacy);

        let mixed = serde_json::json!({
            "/library/book.pdf": { "page": 17, "offset": 0.375 },
            "/library/book.epub": { "cfi": "epubcfi(/6/2!/4/2/1:12)" }
        });
        fs::write(&destination, serde_json::to_vec(&mixed).unwrap()).unwrap();
        let mut positions = read_positions(&destination).unwrap();
        assert_eq!(serde_json::to_value(&positions).unwrap(), mixed);
        let pdf = positions.remove("/library/book.pdf").unwrap().into_pdf().unwrap();
        assert_eq!(pdf.page, 17);
        assert_eq!(pdf.offset, 0.375);
        let epub = positions.remove("/library/book.epub").unwrap().into_epub().unwrap();
        assert_eq!(epub.cfi, "epubcfi(/6/2!/4/2/1:12)");
        assert!(StoredPosition::Epub(epub).into_pdf().is_none());
        assert!(StoredPosition::Pdf(pdf).into_epub().is_none());
    }

    #[test]
    fn epub_positions_are_independent_and_use_canonical_paths() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("app-data/reading-positions.json");
        assert!(read_positions(&destination).unwrap().is_empty());
        for name in ["first", "second"] {
            fs::create_dir(directory.0.join(name)).unwrap();
            fs::write(directory.0.join(name).join("book.epub"), []).unwrap();
        }
        let first = canonicalize_epub_path_sync(
            directory.0.join("first/book.epub").to_string_lossy().into_owned(),
        ).unwrap();
        let second = canonicalize_epub_path_sync(
            directory.0.join("second/book.epub").to_string_lossy().into_owned(),
        ).unwrap();
        for (path, cfi) in [
            (&first, "epubcfi(/6/2!/4/2/1:0)"),
            (&second, "epubcfi(/6/4!/4/2/1:8)"),
            (&first, "epubcfi(/6/2!/4/2/1:20)"),
        ] {
            write_position(
                &destination,
                path.clone(),
                StoredPosition::Epub(EpubReadingPosition { cfi: cfi.into(), cfi_model: None }),
            ).unwrap();
        }
        let alias = canonicalize_epub_path_sync(
            directory.0.join("first/../first/book.epub").to_string_lossy().into_owned(),
        ).unwrap();
        assert_eq!(alias, first);
        let mut positions = read_positions(&destination).unwrap();
        assert_eq!(positions.len(), 2);
        assert_eq!(
            positions.remove(&alias).unwrap().into_epub().unwrap().cfi,
            "epubcfi(/6/2!/4/2/1:20)"
        );
        assert_eq!(
            positions.remove(&second).unwrap().into_epub().unwrap().cfi,
            "epubcfi(/6/4!/4/2/1:8)"
        );
    }

    #[test]
    fn malformed_epub_records_do_not_hide_valid_positions() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let fixture = serde_json::json!({
            "empty": { "cfi": "" },
            "not-cfi": { "cfi": "chapter-1" },
            "wrong-type": { "cfi": 42 },
            "null-cfi": { "cfi": null },
            "missing-cfi": {},
            "null-record": null,
            "array-record": [],
            "valid.epub": { "cfi": "epubcfi(/6/2!/4/2/1:0)" },
            "valid.pdf": { "page": 3, "offset": 0.25 }
        });
        fs::write(&destination, serde_json::to_vec(&fixture).unwrap()).unwrap();
        let mut positions = read_positions(&destination).unwrap();
        for key in [
            "empty", "not-cfi", "wrong-type", "null-cfi",
            "missing-cfi", "null-record", "array-record", "absent",
        ] {
            assert!(positions.remove(key).and_then(StoredPosition::into_epub).is_none(), "{key}");
        }
        assert!(positions.remove("valid.epub").unwrap().into_epub().is_some());
        assert_eq!(positions.remove("valid.pdf").unwrap().into_pdf().unwrap().page, 3);
    }

    #[test]
    fn epub_writes_preserve_existing_pdf_and_unknown_records() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let fixture = serde_json::json!({
            "/library/book.pdf": { "page": 29, "offset": 0.625 },
            "/library/broken.epub": { "cfi": false }
        });
        fs::write(&destination, serde_json::to_vec(&fixture).unwrap()).unwrap();
        write_position(
            &destination,
            "/library/book.epub".into(),
            StoredPosition::Epub(EpubReadingPosition {
                cfi: "epubcfi(/6/2!/4/2/1:42)".into(),
                cfi_model: None,
            }),
        ).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&destination).unwrap()).unwrap();
        assert_eq!(saved["/library/book.pdf"], fixture["/library/book.pdf"]);
        assert_eq!(saved["/library/broken.epub"], fixture["/library/broken.epub"]);
        assert_eq!(
            saved["/library/book.epub"],
            serde_json::json!({ "cfi": "epubcfi(/6/2!/4/2/1:42)" })
        );
    }

    #[test]
    fn epub_cfi_validation_rejects_obviously_malformed_values() {
        for cfi in [
            "", "chapter-1", "epubcfi()", "epubcfi(/)", "epubcfi(/x)",
            "epubcfi(/6/2", "epubcfi(/6/2)\n", "epubcfi(/6/\n2)",
        ] {
            assert!(!is_valid_epub_cfi(cfi), "{cfi:?}");
        }
        for cfi in [
            "epubcfi(/6/2!/4/2/1:0)",
            "epubcfi(/6/2[chapter-1]!/4/2,/1:0,/1:12)",
        ] {
            assert!(is_valid_epub_cfi(cfi), "{cfi}");
        }
    }

    #[test]
    fn document_commands_validate_canonical_paths_and_return_original_bytes() {
        use tauri::ipc::{InvokeResponseBody, IpcResponse};

        let directory = TestDirectory::new();
        for extension in ["PDF", "EPUB"] {
            let path = directory.0.join(format!("book.{extension}"));
            let bytes = b"original document bytes\0\xff";
            fs::write(&path, bytes).unwrap();
            let alias = directory.0.join(format!("../{}/book.{extension}",
                directory.0.file_name().unwrap().to_str().unwrap()));
            let alias = alias.to_string_lossy().into_owned();
            let expected = fs::canonicalize(&path).unwrap().to_string_lossy().into_owned();
            let (canonical, response) = tauri::async_runtime::block_on(async {
                if extension == "PDF" {
                    (canonicalize_pdf_path(alias.clone()).await.unwrap(),
                     read_pdf_file(alias).await.unwrap())
                } else {
                    (canonicalize_epub_path(alias.clone()).await.unwrap(),
                     read_epub_file(alias).await.unwrap())
                }
            });
            assert_eq!(canonical, expected);
            match response.body().unwrap() {
                InvokeResponseBody::Raw(actual) => assert_eq!(actual, bytes),
                InvokeResponseBody::Json(_) => panic!("document bytes must remain a raw response"),
            }
        }
        let invalid = directory.0.join("invalid.txt");
        fs::write(&invalid, b"not a document").unwrap();
        tauri::async_runtime::block_on(async {
            let path = invalid.to_string_lossy().into_owned();
            assert_eq!(canonicalize_pdf_path(path.clone()).await.unwrap_err(),
                "Choose a file with a .pdf extension.");
            assert_eq!(canonicalize_epub_path(path.clone()).await.unwrap_err(),
                "Choose a file with a .epub extension.");
            assert!(read_pdf_file(path.clone()).await.is_err());
            assert!(read_epub_file(path).await.is_err());
            for name in ["missing.pdf", "missing.epub"] {
                let path = directory.0.join(name).to_string_lossy().into_owned();
                let expected = fs::canonicalize(&path).unwrap_err().to_string();
                assert_eq!(canonicalize_pdf_path(path.clone()).await.unwrap_err(), expected);
                assert_eq!(canonicalize_epub_path(path.clone()).await.unwrap_err(), expected);
                assert_eq!(read_pdf_file(path.clone()).await.err().unwrap(), expected);
                assert_eq!(read_epub_file(path).await.err().unwrap(), expected);
            }
        });
    }

    #[test]
    fn serialized_pdf_epub_pdf_writes_survive_document_replacement() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("app-data/reading-positions.json");
        let pdf = directory.0.join("book.pdf");
        let epub = directory.0.join("book.epub");
        fs::write(&pdf, b"first PDF").unwrap();
        fs::write(&epub, b"first EPUB").unwrap();
        let pdf = canonicalize_pdf_path_sync(pdf.to_string_lossy().into_owned()).unwrap();
        let epub = canonicalize_epub_path_sync(epub.to_string_lossy().into_owned()).unwrap();
        let lock = Arc::new(Mutex::new(()));
        for (path, position) in [
            (pdf.clone(), StoredPosition::Pdf(ReadingPosition { page: 3, offset: 0.25 })),
            (epub.clone(), StoredPosition::Epub(EpubReadingPosition {
                cfi: "epubcfi(/6/2!/4/2/1:8)".into(),
                cfi_model: None,
            })),
            (pdf.clone(), StoredPosition::Pdf(ReadingPosition { page: 7, offset: 0.5 })),
        ] {
            let destination = destination.clone();
            let lock = Arc::clone(&lock);
            tauri::async_runtime::block_on(blocking_io(move || {
                with_position_lock(&lock, || write_position(&destination, path, position))
            })).unwrap();
        }
        fs::write(&pdf, b"replacement PDF at the same canonical path").unwrap();
        fs::write(&epub, b"replacement EPUB at the same canonical path").unwrap();
        let mut positions = with_position_lock(&lock, || read_positions(&destination)).unwrap();
        assert_eq!(positions.len(), 2);
        let saved_pdf = positions.remove(&pdf).unwrap().into_pdf().unwrap();
        assert_eq!((saved_pdf.page, saved_pdf.offset), (7, 0.5));
        assert_eq!(positions.remove(&epub).unwrap().into_epub().unwrap().cfi,
            "epubcfi(/6/2!/4/2/1:8)");
    }

    #[test]
    fn overlapping_workers_preserve_records_and_last_serialized_writes() {
        use std::sync::{Barrier, mpsc};

        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let unknown = serde_json::json!({ "future": { "version": 2, "location": [1, 2] } });
        fs::write(&destination, serde_json::to_vec(&unknown).unwrap()).unwrap();
        let lock = Arc::new(Mutex::new(()));
        let barrier = Arc::new(Barrier::new(8));
        let (sent, received) = mpsc::channel();
        let mut requests = Vec::new();
        for index in 1..=8 {
            let destination = destination.clone();
            let lock = Arc::clone(&lock);
            let barrier = Arc::clone(&barrier);
            let sent = sent.clone();
            requests.push(tauri::async_runtime::spawn(async move {
                blocking_io(move || {
                    barrier.wait();
                    with_position_lock(&lock, || {
                        // Unique records expose lost read/modify/write updates.
                        write_position(&destination, format!("unique-{index}.pdf"),
                            StoredPosition::Pdf(ReadingPosition { page: index, offset: 0.25 }))?;
                        let key = if index % 2 == 0 { "shared.pdf" } else { "shared.epub" };
                        let position = if index % 2 == 0 {
                            StoredPosition::Pdf(ReadingPosition { page: index, offset: 0.5 })
                        } else {
                            StoredPosition::Epub(EpubReadingPosition {
                                cfi: format!("epubcfi(/6/2!/4/2/1:{index})"),
                                cfi_model: None,
                            })
                        };
                        write_position(&destination, key.into(), position)?;
                        sent.send((key, index)).unwrap();
                        Ok(())
                    })?;
                    // Loads contend on the same production lock as saves.
                    with_position_lock(&lock, || {
                        let mut positions = read_positions(&destination)?;
                        assert_eq!(positions.remove(&format!("unique-{index}.pdf"))
                            .unwrap().into_pdf().unwrap().page, index);
                        Ok(())
                    })
                }).await
            }));
        }
        for request in requests {
            tauri::async_runtime::block_on(request).unwrap().unwrap();
        }
        drop(sent);
        let serialized: HashMap<_, _> = received.into_iter().collect();
        let mut positions = read_positions(&destination).unwrap();
        assert_eq!(positions.len(), 11);
        assert_eq!(serde_json::to_value(positions.remove("future").unwrap()).unwrap(), unknown["future"]);
        for index in 1..=8 {
            assert_eq!(positions.remove(&format!("unique-{index}.pdf"))
                .unwrap().into_pdf().unwrap().page, index);
        }
        assert_eq!(positions.remove("shared.pdf").unwrap().into_pdf().unwrap().page,
            serialized["shared.pdf"]);
        assert_eq!(positions.remove("shared.epub").unwrap().into_epub().unwrap().cfi,
            format!("epubcfi(/6/2!/4/2/1:{})", serialized["shared.epub"]));
    }

    #[test]
    fn reading_positions_preserve_unsupported_records_across_pdf_epub_writes() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let fixture = serde_json::json!({
            "/library/legacy.epub": { "cfi": "epubcfi(/6/2!/4/2/1:0)" },
            "/library/current.epub": { "cfi": "epubcfi(/6/2!/4/2/1:4)", "cfiModel": "foliate-html-v1" },
            "/library/future.epub": { "cfi": "epubcfi(/6/2!/4/2/1:8)", "cfiModel": "future", "extra": null },
            "/library/null-model.epub": { "cfi": "epubcfi(/6/2!/4/2/1:8)", "cfiModel": null },
            "/library/future.pdf": { "page": 9, "offset": 0.5, "future": null },
            "/library/unrelated.pdf": { "page": 17, "offset": 0.375 },
            "/library/malformed.epub": { "cfi": 42 },
            "/library/null": null,
            "/library/array": [1, false, null],
            "/library/unknown": { "version": 42, "location": { "line": 3 } }
        });
        fs::write(&destination, serde_json::to_vec(&fixture).unwrap()).unwrap();
        let pdf = directory.0.join("new.pdf");
        let epub = directory.0.join("new.epub");
        fs::write(&pdf, []).unwrap();
        fs::write(&epub, []).unwrap();
        let pdf = canonicalize_pdf_path_sync(pdf.to_string_lossy().into_owned()).unwrap();
        let epub = canonicalize_epub_path_sync(epub.to_string_lossy().into_owned()).unwrap();
        write_position(&destination, pdf.clone(),
            StoredPosition::Pdf(ReadingPosition { page: 5, offset: 0.75 })).unwrap();
        write_position(&destination, epub.clone(),
            StoredPosition::Epub(EpubReadingPosition {
                cfi: "epubcfi(/6/4!/4/2/1:20)".into(),
                cfi_model: Some(EpubCfiModel::FoliateHtmlV1),
            })).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&destination).unwrap()).unwrap();
        for (key, value) in fixture.as_object().unwrap() {
            assert_eq!(&saved[key], value, "untouched record {key}");
        }
        assert_eq!(saved[&pdf], serde_json::json!({ "page": 5, "offset": 0.75 }));
        assert_eq!(saved[&epub], serde_json::json!({
            "cfi": "epubcfi(/6/4!/4/2/1:20)", "cfiModel": "foliate-html-v1"
        }));
    }

    #[test]
    fn blocking_workers_propagate_read_io_and_join_errors() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        fs::write(&destination, b"{malformed").unwrap();
        let original = fs::read(&destination).unwrap();
        let lock = Arc::new(Mutex::new(()));
        let worker_lock = Arc::clone(&lock);
        let worker_destination = destination.clone();
        let expected = read_positions(&destination).err().unwrap();
        assert_eq!(tauri::async_runtime::block_on(blocking_io(move || {
            with_position_lock(&worker_lock, || read_positions(&worker_destination))
        })).err().unwrap(), expected);
        assert_eq!(fs::read(&destination).unwrap(), original);

        // A directory instead of the destination is an actual filesystem read
        // failure, not malformed JSON. It must never trigger quarantine.
        fs::remove_file(&destination).unwrap();
        fs::create_dir(&destination).unwrap();
        let expected = fs::read(&destination).unwrap_err().to_string();
        let worker_destination = destination.clone();
        let error = tauri::async_runtime::block_on(blocking_io(move || {
            with_position_lock(&lock, || write_position(&worker_destination,
                "book.pdf".into(), StoredPosition::Pdf(ReadingPosition { page: 1, offset: 0.0 })))
        })).unwrap_err();
        assert_eq!(error, expected);
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 1);
        let error = tauri::async_runtime::block_on(blocking_io::<()>(move || {
            panic!("controlled worker panic")
        })).unwrap_err();
        assert!(error.starts_with("Native I/O worker failed: "));
        assert!(error.contains("controlled worker panic"));
    }

    #[test]
    fn reading_positions_poison_clears_only_after_successful_disk_transaction() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("reading-positions.json");
        let lock = Arc::new(Mutex::new(()));
        let worker_lock = Arc::clone(&lock);
        let worker_destination = destination.clone();
        assert!(std::thread::spawn(move || {
            with_position_lock(&worker_lock, || {
                write_position_with_hook(&worker_destination, "interrupted.pdf".into(),
                    StoredPosition::Pdf(ReadingPosition { page: 1, offset: 0.0 }),
                    &mut |stage, _| {
                        if stage == PositionWriteStage::TemporaryWritten {
                            panic!("interrupted storage worker");
                        }
                        Ok(())
                    })
            })
        }).join().is_err());
        assert!(lock.is_poisoned());
        let error = with_position_lock(&lock, || {
            assert!(lock.is_poisoned());
            write_position_with_hook(&destination, "failed.pdf".into(),
                StoredPosition::Pdf(ReadingPosition { page: 2, offset: 0.0 }),
                &mut |stage, _| {
                    if stage == PositionWriteStage::BeforeReplace {
                        Err("injected failure while poisoned".into())
                    } else { Ok(()) }
                })
        }).unwrap_err();
        assert_eq!(error, "injected failure while poisoned");
        assert!(lock.is_poisoned());
        with_position_lock(&lock, || {
            assert!(lock.is_poisoned());
            write_position(&destination, "recovered.pdf".into(),
                StoredPosition::Pdf(ReadingPosition { page: 3, offset: 0.5 }))
        }).unwrap();
        assert!(!lock.is_poisoned());
        let mut records = with_position_lock(&lock, || read_positions(&destination)).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records.remove("recovered.pdf").unwrap().into_pdf().unwrap().page, 3);
    }
}
