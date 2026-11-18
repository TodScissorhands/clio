use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WebviewWindowBuilder, WebviewUrl};

#[derive(Default)]
pub struct Sessions(pub Arc<Mutex<HashMap<String, Session>>>);
pub(crate) struct Session {
    path: String,
    bytes: Arc<[u8]>,
    ready: Option<std::sync::mpsc::Sender<Result<(), String>>>,
    generation: u64,
    committed: bool,
}
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
static OPEN_GENERATION: AtomicU64 = AtomicU64::new(0);

fn cancel_pending(state: &mut HashMap<String, Session>) -> Vec<String> {
    let ids: Vec<_> = state.iter().filter(|(_, session)| !session.committed).map(|(id, _)| id.clone()).collect();
    for id in &ids { state.remove(id); }
    ids
}

pub(crate) fn shutdown_sessions(app: &AppHandle) {
    OPEN_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut sessions) = app.state::<Sessions>().0.lock() { sessions.clear(); }
    for (label, reader) in app.webview_windows() {
        if label.starts_with("epub-") { let _ = reader.close(); }
    }
}

#[tauri::command]
pub fn begin_epub_acquisition(app: AppHandle, window: WebviewWindow, sessions: State<'_, Sessions>) -> Result<u64, String> {
    if window.label() != "main" { return Err("Only the shell may acquire publications".into()); }
    let generation = OPEN_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let ids = {
        let mut state = sessions.0.lock().map_err(|e| e.to_string())?;
        cancel_pending(&mut state)
    };
    for id in ids {
        if let Some(reader) = app.get_webview_window(&format!("epub-{id}")) { let _ = reader.close(); }
    }
    Ok(generation)
}

fn authorized_sessions<'a>(sessions: &'a Sessions, caller: &str, id: &str) -> Result<std::sync::MutexGuard<'a, HashMap<String, Session>>, String> {
    if caller.strip_prefix("epub-") != Some(id) { return Err("Wrong reader window".into()); }
    let state = sessions.0.lock().map_err(|e| e.to_string())?;
    if !state.contains_key(id) { return Err("Closed EPUB session".into()); }
    Ok(state)
}

fn save_session_position(sessions: &Sessions, caller: &str, id: &str, cfi: String, destination: &std::path::Path, lock: &Mutex<()>) -> Result<(), String> {
    if !super::is_valid_epub_cfi(&cfi) { return Err("Invalid EPUB reading position".into()); }
    // Keep authorization live through the transaction. A retired session must
    // not write a stale CFI after a newer reader has opened the same path.
    let state = authorized_sessions(sessions, caller, id)?;
    let session = state.get(id).ok_or("Closed EPUB session")?;
    super::with_position_lock(lock, || super::write_position(destination, session.path.clone(),
        super::StoredPosition::Epub(super::EpubReadingPosition { cfi, cfi_model: Some(super::EpubCfiModel::FoliateHtmlV1) })))
}

#[tauri::command]
pub async fn create_epub_session(app: AppHandle, window: WebviewWindow, sessions: State<'_, Sessions>, canonical_path: String, generation: u64) -> Result<String, String> {
    if window.label() != "main" { return Err("Only the shell may open publications".into()); }
    if generation != OPEN_GENERATION.load(Ordering::SeqCst) { return Err("Superseded EPUB acquisition".into()); }
    let (path, bytes) = super::blocking_io(move || {
        let path = super::canonicalize_epub_path_sync(canonical_path)?;
        let bytes: Arc<[u8]> = std::fs::read(&path).map_err(|e| e.to_string())?.into();
        Ok((path, bytes))
    }).await?;
    if generation != OPEN_GENERATION.load(Ordering::SeqCst) { return Err("Superseded EPUB acquisition".into()); }
    let title = format!("{} — Clio", std::path::Path::new(&path).file_name().and_then(|name| name.to_str()).unwrap_or("EPUB"));
    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed).to_string();
    let (ready, receiver) = std::sync::mpsc::channel();
    sessions.0.lock().map_err(|e| e.to_string())?.insert(id.clone(), Session { path, bytes, ready: Some(ready), generation, committed: false });
    let label = format!("epub-{id}");
    let initial = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let nav_initial = initial.clone();
    let result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("epub-reader.html?epubSession={id}").into()))
        // Preparation needs a mapped allocation, but only commit takes focus.
        .title(title).inner_size(900.0, 700.0).focused(false)
        .on_navigation(move |url| {
            // The trusted bootstrap is a one-time transition, never a publication destination.
            if url.scheme() == "blob" || url.as_str() == "about:blank" || url.as_str() == "about:srcdoc" { return true; }
            let allowed = nav_initial.swap(false, Ordering::SeqCst)
                && url.path() == "/epub-reader.html"
                && url.query().is_some_and(|q| q.starts_with("epubSession="));
            allowed
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_page_load(move |_, _| { initial.store(false, Ordering::SeqCst); })
        .build();
    match result {
        Ok(reader) => {
            let id_on_close = id.clone();
            let app_on_close = app.clone();
            reader.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    if let Ok(mut sessions) = app_on_close.state::<Sessions>().0.lock() { sessions.remove(&id_on_close); }
                    let _ = app_on_close.emit_to("main", "epub-session-closed", &id_on_close);
                }
            });
            let result = super::blocking_io(move || receiver.recv_timeout(std::time::Duration::from_secs(60))
                .map_err(|e| format!("EPUB reader did not become ready: {e}"))?).await;
            match result {
                Ok(()) => Ok(id),
                Err(error) => {
                    sessions.0.lock().map_err(|e| e.to_string())?.remove(&id);
                    let _ = reader.close();
                    Err(error)
                }
            }
        }
        Err(e) => { sessions.0.lock().map_err(|e| e.to_string())?.remove(&id); Err(e.to_string()) }
    }
}

#[tauri::command]
pub fn ready_epub_session(window: WebviewWindow, sessions: State<'_, Sessions>, session_id: String, error: Option<String>) -> Result<(), String> {
    let mut state = authorized_sessions(&sessions, window.label(), &session_id)?;
    if let Some(message) = &error { eprintln!("EPUB session {session_id} failed: {message}"); }
    if let Some(sender) = state.get_mut(&session_id).and_then(|s| s.ready.take()) {
        sender.send(error.map_or(Ok(()), Err)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn commit_epub_session(app: AppHandle, window: WebviewWindow, sessions: State<'_, Sessions>, session_id: String) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the shell may commit publications".into()); }
    {
        let mut state = sessions.0.lock().map_err(|e| e.to_string())?;
        let session = state.get_mut(&session_id).ok_or("Closed EPUB session")?;
        if (session.generation != OPEN_GENERATION.load(Ordering::SeqCst) && !session.committed) || session.ready.is_some() { return Err("Superseded or unready EPUB session".into()); }
        session.committed = true;
    }
    let reader = app.get_webview_window(&format!("epub-{session_id}")).ok_or("Missing reader window")?;
    reader.show().map_err(|e| e.to_string())?;
    reader.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn retire_epub_session(app: AppHandle, window: WebviewWindow, sessions: State<'_, Sessions>, session_id: String) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the shell may retire publications".into()); }
    sessions.0.lock().map_err(|e| e.to_string())?.remove(&session_id);
    if let Some(reader) = app.get_webview_window(&format!("epub-{session_id}")) {
        reader.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn request_epub_open(app: AppHandle, window: WebviewWindow, sessions: State<'_, Sessions>, session_id: String) -> Result<(), String> {
    drop(authorized_sessions(&sessions, window.label(), &session_id)?);
    let main = app.get_webview_window("main").ok_or("Missing application shell")?;
    main.set_focus().map_err(|e| e.to_string())?;
    app.emit_to("main", "epub-request-open", ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_epub_session(window: WebviewWindow, sessions: State<'_, Sessions>, session_id: String) -> Result<tauri::ipc::Response, String> {
    let sessions = authorized_sessions(&sessions, window.label(), &session_id)?;
    let session = sessions.get(&session_id).ok_or("Closed EPUB session")?;
    Ok(tauri::ipc::Response::new(session.bytes.to_vec()))
}

#[tauri::command]
pub async fn load_epub_session_position(app: AppHandle, window: WebviewWindow, sessions: State<'_, Sessions>, lock: State<'_, Arc<Mutex<()>>>, session_id: String) -> Result<Option<super::EpubReadingPosition>, String> {
    let state = Arc::clone(&sessions.0);
    let lock = Arc::clone(lock.inner());
    let caller = window.label().to_owned();
    super::blocking_io(move || {
        let sessions = Sessions(state);
        let state = authorized_sessions(&sessions, &caller, &session_id)?;
        let session = state.get(&session_id).ok_or("Closed EPUB session")?;
        super::with_position_lock(&lock, || {
            let mut positions = super::read_positions(&super::positions_file(&app)?)?;
            Ok(positions.remove(&session.path).and_then(super::StoredPosition::into_epub))
        })
    }).await
}

#[tauri::command]
pub async fn save_epub_session_position(app: AppHandle, window: WebviewWindow, sessions: State<'_, Sessions>, lock: State<'_, Arc<Mutex<()>>>, session_id: String, cfi: String) -> Result<(), String> {
    let state = Arc::clone(&sessions.0);
    let lock = Arc::clone(lock.inner());
    let caller = window.label().to_owned();
    super::blocking_io(move || save_session_position(&Sessions(state), &caller, &session_id, cfi, &super::positions_file(&app)?, &lock)).await
}

#[tauri::command]
pub fn close_epub_session(window: WebviewWindow, sessions: State<'_, Sessions>, session_id: String) -> Result<(), String> {
    authorized_sessions(&sessions, window.label(), &session_id)?.remove(&session_id);
    window.close().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_access_requires_exact_live_reader() {
        let sessions = Sessions::default();
        sessions.0.lock().unwrap().insert("1".into(), Session { path: "/selected/book.epub".into(), bytes: Arc::from([]), ready: None, generation: 0, committed: true });
        assert!(authorized_sessions(&sessions, "main", "1").is_err());
        assert!(authorized_sessions(&sessions, "epub-2", "1").is_err());
        assert_eq!(authorized_sessions(&sessions, "epub-1", "1").unwrap().get("1").unwrap().path, "/selected/book.epub");
        sessions.0.lock().unwrap().remove("1");
        assert!(authorized_sessions(&sessions, "epub-1", "1").is_err());
    }

    #[test]
    fn retired_session_cannot_overwrite_a_newer_saved_position() {
        let sessions = Sessions::default();
        sessions.0.lock().unwrap().insert("1".into(), Session { path: "/selected/book.epub".into(), bytes: Arc::from([]), ready: None, generation: 0, committed: true });
        let destination = std::env::temp_dir().join(format!("clio-foliate-stale-{}-{}.json", std::process::id(), NEXT_SESSION.fetch_add(1, Ordering::Relaxed)));
        let lock = Mutex::new(());
        let newer = "epubcfi(/6/4!/4/2/1:20)";
        save_session_position(&sessions, "epub-1", "1", newer.into(), &destination, &lock).unwrap();
        let saved = std::fs::read(&destination).unwrap();
        assert!(save_session_position(&sessions, "epub-2", "1", "epubcfi(/6/2!/4/2/1:0)".into(), &destination, &lock).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), saved);
        sessions.0.lock().unwrap().remove("1");
        let before = std::fs::read(&destination).unwrap();
        assert!(save_session_position(&sessions, "epub-1", "1", "epubcfi(/6/2!/4/2/1:0)".into(), &destination, &lock).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), before);
        std::fs::remove_file(destination).unwrap();
    }

    #[test]
    fn cancelling_candidates_preserves_committed_publication() {
        let sessions = Sessions::default();
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut state = sessions.0.lock().unwrap();
        state.insert("current".into(), Session { path: "a.epub".into(), bytes: Arc::from([1, 2, 3]), ready: None, generation: 1, committed: true });
        state.insert("candidate".into(), Session { path: "b.epub".into(), bytes: Arc::from([4, 5, 6]), ready: Some(sender), generation: 2, committed: false });
        assert_eq!(cancel_pending(&mut state), vec!["candidate"]);
        assert_eq!(&*state.get("current").unwrap().bytes, &[1, 2, 3]);
        assert!(matches!(receiver.try_recv(), Err(std::sync::mpsc::TryRecvError::Disconnected)));
        drop(state);
        assert!(authorized_sessions(&sessions, "epub-candidate", "candidate").is_err());
    }
}
