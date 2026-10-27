use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Deserialize, Serialize)]
struct ReadingPosition {
    page: u32,
    offset: f64,
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

fn read_positions(path: &Path) -> Result<HashMap<String, ReadingPosition>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn load_reading_position(
    app: AppHandle,
    lock: State<'_, Mutex<()>>,
    path: String,
) -> Result<Option<ReadingPosition>, String> {
    let canonical = canonicalize_pdf_path(path)?;
    let _guard = lock.lock().map_err(|error| error.to_string())?;
    let positions = read_positions(&positions_file(&app)?)?;
    Ok(positions.get(&canonical).cloned())
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
    let destination = positions_file(&app)?;
    let mut positions = read_positions(&destination)?;
    positions.insert(canonical, ReadingPosition { page, offset });

    let directory = destination.parent().ok_or("Invalid app-data path.")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary = destination.with_extension("json.tmp");
    let bytes = serde_json::to_vec(&positions).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(temporary, destination).map_err(|error| error.to_string())
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
            save_reading_position
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
