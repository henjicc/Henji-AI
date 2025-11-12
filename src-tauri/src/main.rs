use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      let app_local = app.path().app_local_data_dir().expect("get app local data dir");
      let media_dir = app_local.join("Henji-AI").join("Media");
      if let Err(e) = std::fs::create_dir_all(&media_dir) {
        eprintln!("failed to create media dir: {}", e);
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() {
  run();
}
