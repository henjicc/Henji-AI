use std::fs;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

/// 读取剪贴板中的文件路径（Windows 专用）
/// 当用户在文件管理器中复制文件时，文件路径会以 CF_HDROP 格式存储在剪贴板中
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn read_clipboard_files() -> Result<Vec<ClipboardFile>, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::ptr::null_mut;

    // Windows API 常量
    const CF_HDROP: u32 = 15;

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: *mut std::ffi::c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn GetClipboardData(format: u32) -> *mut std::ffi::c_void;
        fn IsClipboardFormatAvailable(format: u32) -> i32;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn DragQueryFileW(hdrop: *mut std::ffi::c_void, index: u32, file: *mut u16, size: u32) -> u32;
    }

    unsafe {
        // 检查剪贴板是否有文件
        if IsClipboardFormatAvailable(CF_HDROP) == 0 {
            return Ok(vec![]);
        }

        // 打开剪贴板
        if OpenClipboard(null_mut()) == 0 {
            return Err("无法打开剪贴板".to_string());
        }

        let result = (|| -> Result<Vec<ClipboardFile>, String> {
            // 获取剪贴板数据
            let hdrop = GetClipboardData(CF_HDROP);
            if hdrop.is_null() {
                return Ok(vec![]);
            }

            // 获取文件数量
            let file_count = DragQueryFileW(hdrop, 0xFFFFFFFF, null_mut(), 0);
            if file_count == 0 {
                return Ok(vec![]);
            }

            let mut files = Vec::new();

            for i in 0..file_count {
                // 获取文件路径长度
                let path_len = DragQueryFileW(hdrop, i, null_mut(), 0);
                if path_len == 0 {
                    continue;
                }

                // 获取文件路径
                let mut path_buf: Vec<u16> = vec![0; (path_len + 1) as usize];
                DragQueryFileW(hdrop, i, path_buf.as_mut_ptr(), path_len + 1);

                // 转换为 Rust 字符串
                let path_os = OsString::from_wide(&path_buf[..path_len as usize]);
                let path_str = path_os.to_string_lossy().to_string();

                // 检查是否是图片文件
                let lower_path = path_str.to_lowercase();
                if lower_path.ends_with(".png")
                    || lower_path.ends_with(".jpg")
                    || lower_path.ends_with(".jpeg")
                    || lower_path.ends_with(".gif")
                    || lower_path.ends_with(".webp")
                    || lower_path.ends_with(".bmp")
                {
                    // 读取文件内容并转换为 base64
                    match fs::read(&path_str) {
                        Ok(data) => {
                            let base64_data = BASE64.encode(&data);
                            let mime_type = get_mime_type(&lower_path);
                            files.push(ClipboardFile {
                                path: path_str,
                                data: format!("data:{};base64,{}", mime_type, base64_data),
                                mime_type,
                            });
                        }
                        Err(e) => {
                            eprintln!("读取文件失败 {}: {}", path_str, e);
                        }
                    }
                }
            }

            Ok(files)
        })();

        // 关闭剪贴板
        CloseClipboard();

        result
    }
}

/// 非 Windows 平台的空实现
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn read_clipboard_files() -> Result<Vec<ClipboardFile>, String> {
    Ok(vec![])
}

/// 剪贴板文件信息
#[derive(serde::Serialize)]
pub struct ClipboardFile {
    pub path: String,
    pub data: String,      // base64 编码的数据 URL
    pub mime_type: String,
}

/// 根据文件扩展名获取 MIME 类型
fn get_mime_type(path: &str) -> String {
    if path.ends_with(".png") {
        "image/png".to_string()
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else if path.ends_with(".gif") {
        "image/gif".to_string()
    } else if path.ends_with(".webp") {
        "image/webp".to_string()
    } else if path.ends_with(".bmp") {
        "image/bmp".to_string()
    } else {
        "application/octet-stream".to_string()
    }
}
