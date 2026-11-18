fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "canonicalize_pdf_path", "read_pdf_file", "canonicalize_epub_path", "read_epub_file",
            "load_reading_position", "save_reading_position", "load_epub_reading_position",
            "save_epub_reading_position", "create_epub_session", "read_epub_session",
            "load_epub_session_position", "save_epub_session_position", "close_epub_session",
            "ready_epub_session", "commit_epub_session", "retire_epub_session",
            "request_epub_open",
            "begin_epub_acquisition",
        ]),
    )).expect("build native command permissions");
}
