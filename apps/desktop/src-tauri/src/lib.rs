mod metrics;
mod sftp;
mod ssh;

use ssh::SshManager;
use tauri::Manager;

#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
    #[cfg(not(mobile))]
    {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        return cb.get_text().map_err(|e| e.to_string());
    }
    #[cfg(mobile)]
    {
        Err("mobile uses browser clipboard".to_string())
    }
}

#[tauri::command]
fn read_local_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("无法读取文件: {e}"))?;
    if meta.len() > 256 * 1024 {
        return Err("密钥文件过大（超过 256KB）".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("读取密钥内容失败: {e}"))
}

#[tauri::command]
async fn open_ai_window(app: tauri::AppHandle, dark: Option<bool>) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (app, dark);
        return Ok(());
    }
    #[cfg(not(mobile))]
    {
        if let Some(existing) = app.get_webview_window("ai-workbench") {
            let _ = existing.unminimize();
            let _ = existing.show();
            let _ = existing.set_focus();
            return Ok(());
        }

        let is_dark = dark.unwrap_or(true);
        let bg = if is_dark {
            tauri::window::Color(12, 16, 24, 255)
        } else {
            tauri::window::Color(248, 250, 252, 255)
        };
        let theme = if is_dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        };

        let _window = tauri::WebviewWindowBuilder::new(
            &app,
            "ai-workbench",
            tauri::WebviewUrl::App("index.html?window=ai".into()),
        )
        .title("ISSH — AI 工作台")
        .inner_size(520.0, 760.0)
        .min_inner_size(360.0, 480.0)
        .center()
        .resizable(true)
        .decorations(true)
        .visible(false)
        .theme(Some(theme))
        .background_color(bg)
        .build()
        .map_err(|e| format!("创建 AI 独立窗口失败: {e}"))?;

        Ok(())
    }
}

#[tauri::command]
async fn show_ai_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(mobile))]
    if let Some(win) = app.get_webview_window("ai-workbench") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    #[cfg(mobile)]
    let _ = app;
    Ok(())
}

#[tauri::command]
async fn close_ai_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(mobile))]
    {
        if let Some(win) = app.get_webview_window("ai-workbench") {
            let _ = win.close();
        }
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.unminimize();
            let _ = main.set_focus();
        }
    }
    #[cfg(mobile)]
    let _ = app;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .manage(SshManager::default());

    #[cfg(not(mobile))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window_vibrancy::apply_mica(&window, Some(true));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ssh::ssh_connect,
            ssh::ssh_write_pty,
            ssh::ssh_resize_pty,
            ssh::ssh_disconnect,
            ssh::ssh_exec,
            ssh::ssh_fetch_metrics,
            sftp::sftp_realpath,
            sftp::sftp_list,
            sftp::sftp_read,
            sftp::sftp_write,
            sftp::sftp_mkdir,
            sftp::sftp_remove,
            sftp::sftp_rename,
            sftp::sftp_upload_local_file,
            sftp::sftp_open_external_editor,
            read_clipboard_text,
            read_local_text_file,
            open_ai_window,
            show_ai_window,
            close_ai_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
