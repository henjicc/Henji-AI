#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod modelscope;
mod clipboard_files;

use tauri::Manager;

use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
fn copy_image_to_clipboard(app: tauri::AppHandle, image_data: Vec<u8>) -> Result<(), String> {
    // 1. 使用 image crate 加载任意格式的图片数据 (支持 JPEG, PNG, WEBP 等)
    let img = image::load_from_memory(&image_data).map_err(|e| format!("Failed to parse image: {}", e))?;
    
    // 2. 转换为 RGBA8 格式
    let rgba = img.into_rgba8();
    let (width, height) = rgba.dimensions();
    
    // 3. 构建 Tauri Image 对象
    let raw_data = rgba.into_raw();
    let tauri_image = tauri::image::Image::new(&raw_data, width, height);

    // 4. 写入剪贴板
    app.clipboard().write_image(&tauri_image).map_err(|e| format!("Failed to write to clipboard: {}", e))?;
    
    Ok(())
}
#[tauri::command]
fn toggle_devtools(app: tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    // Tauri v2 中直接调用 open_devtools()
    // 如果已经打开，再次调用会关闭（toggle 行为）
    window.open_devtools();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .invoke_handler(tauri::generate_handler![
      modelscope::modelscope_submit_task,
      modelscope::modelscope_check_status,
      toggle_devtools,
      clipboard_files::read_clipboard_files,
      copy_image_to_clipboard
    ])
    .setup(|app| {
      let app_local = app.path().app_local_data_dir().expect("get app local data dir");
      let media_dir = app_local.join("Henji-AI").join("Media");
      if let Err(e) = std::fs::create_dir_all(&media_dir) {
        eprintln!("failed to create media dir: {}", e);
      }
      
      if let Some(win) = app.get_webview_window("main") {
        // 先最大化窗口，然后显示，避免看到小窗口
        let _ = win.maximize();
        
        // 延迟显示窗口，确保内容加载完成
        let window = win.clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_millis(100));
          let _ = window.show();
        });
      }
      
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() {
  run();
}
