use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Deserialize, Serialize)]
struct ReadingPosition {
    page: u32,
    offset: f64,
}

#[derive(Deserialize, Serialize)]
struct EpubReadingPosition {
    cfi: String,
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

#[tauri::command]
fn canonicalize_pdf_path(path: String) -> Result<String, String> {
    let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if canonical.extension().and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("Choose a file with a .pdf extension.".into());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_pdf_file(path: String) -> Result<tauri::ipc::Response, String> {
    let canonical = canonicalize_pdf_path(path)?;
    let bytes = fs::read(canonical).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn canonicalize_epub_path(path: String) -> Result<String, String> {
    let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if canonical.extension().and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("epub"))
    {
        return Err("Choose a file with a .epub extension.".into());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_epub_file(path: String) -> Result<tauri::ipc::Response, String> {
    let canonical = canonicalize_epub_path(path)?;
    let bytes = fs::read(canonical).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
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

fn write_position(
    destination: &Path,
    canonical: String,
    position: StoredPosition,
) -> Result<(), String> {
    let mut positions = read_positions(destination)?;
    positions.insert(canonical, position);
    let directory = destination.parent().ok_or("Invalid app-data path.")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary = destination.with_extension("json.tmp");
    let bytes = serde_json::to_vec(&positions).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(temporary, destination).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_reading_position(
    app: AppHandle,
    lock: State<'_, Mutex<()>>,
    path: String,
) -> Result<Option<ReadingPosition>, String> {
    let canonical = canonicalize_pdf_path(path)?;
    let _guard = lock.lock().map_err(|error| error.to_string())?;
    let mut positions = read_positions(&positions_file(&app)?)?;
    Ok(positions.remove(&canonical).and_then(StoredPosition::into_pdf))
}

#[tauri::command]
fn save_reading_position(
    app: AppHandle,
    lock: State<'_, Mutex<()>>,
    path: String,
    page: u32,
    offset: f64,
) -> Result<(), String> {
    if page == 0 || !offset.is_finite() || !(0.0..=1.0).contains(&offset) {
        return Err("Invalid reading position.".into());
    }
    let canonical = canonicalize_pdf_path(path)?;
    let _guard = lock.lock().map_err(|error| error.to_string())?;
    write_position(
        &positions_file(&app)?,
        canonical,
        StoredPosition::Pdf(ReadingPosition { page, offset }),
    )
}

#[tauri::command]
fn load_epub_reading_position(
    app: AppHandle,
    lock: State<'_, Mutex<()>>,
    path: String,
) -> Result<Option<EpubReadingPosition>, String> {
    let canonical = canonicalize_epub_path(path)?;
    let _guard = lock.lock().map_err(|error| error.to_string())?;
    let mut positions = read_positions(&positions_file(&app)?)?;
    Ok(positions.remove(&canonical).and_then(StoredPosition::into_epub))
}

#[tauri::command]
fn save_epub_reading_position(
    app: AppHandle,
    lock: State<'_, Mutex<()>>,
    path: String,
    cfi: String,
) -> Result<(), String> {
    if !is_valid_epub_cfi(&cfi) {
        return Err("Invalid EPUB reading position.".into());
    }
    let canonical = canonicalize_epub_path(path)?;
    let _guard = lock.lock().map_err(|error| error.to_string())?;
    write_position(
        &positions_file(&app)?,
        canonical,
        StoredPosition::Epub(EpubReadingPosition { cfi }),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(()))
        .invoke_handler(tauri::generate_handler![
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

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
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
        let first = canonicalize_epub_path(
            directory.0.join("first/book.epub").to_string_lossy().into_owned(),
        ).unwrap();
        let second = canonicalize_epub_path(
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
                StoredPosition::Epub(EpubReadingPosition { cfi: cfi.into() }),
            ).unwrap();
        }
        let alias = canonicalize_epub_path(
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
        assert!(!destination.with_extension("json.tmp").exists());
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
            }),
        ).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&destination).unwrap()).unwrap();
        assert_eq!(saved["/library/book.pdf"], fixture["/library/book.pdf"]);
        assert_eq!(saved["/library/broken.epub"], fixture["/library/broken.epub"]);
        assert_eq!(
            saved["/library/book.epub"],
            serde_json::json!({ "cfi": "epubcfi(/6/2!/4/2/1:42)" })
        );
        assert!(!destination.with_extension("json.tmp").exists());
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
}
