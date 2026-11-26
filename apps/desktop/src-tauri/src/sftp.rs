use crate::ssh::SshManager;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use russh_sftp::protocol::FileAttributes;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};

static ACTIVE_WATCHERS: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

fn watchers_map() -> &'static Mutex<HashMap<String, PathBuf>> {
    ACTIVE_WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalSyncPayload {
    session_id: String,
    remote_path: String,
    file_name: String,
    status: String,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntryDto {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub size: u64,
    pub permissions: u32,
    pub owner: Option<String>,
    pub group: Option<String>,
    pub modified_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpReadResultDto {
    pub path: String,
    pub text: Option<String>,
    pub bytes_b64: String,
    pub permissions: u32,
    pub encoding: String,
}

fn join_remote(base: &str, name: &str) -> String {
    if base == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", base.trim_end_matches('/'), name)
    }
}

#[tauri::command]
pub async fn sftp_realpath(
    state: State<'_, SshManager>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;
    let target = if path == "~" || path.is_empty() { "." } else { &path };
    sftp.canonicalize(target)
        .await
        .map_err(|e| format!("SFTP realpath failed: {e}"))
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, SshManager>,
    session_id: String,
    remote_path: String,
) -> Result<Vec<SftpEntryDto>, String> {
    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;

    let resolved = if remote_path == "~" || remote_path.is_empty() {
        sftp.canonicalize(".")
            .await
            .map_err(|e| format!("Failed to resolve home dir: {e}"))?
    } else {
        remote_path
    };

    let entries = sftp
        .read_dir(&resolved)
        .await
        .map_err(|e| format!("SFTP read_dir failed: {e}"))?;

    let mut out = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = entry.metadata();
        let ft = entry.file_type();
        let file_type = if ft.is_dir() {
            "directory"
        } else if ft.is_symlink() {
            "symlink"
        } else if ft.is_file() {
            "file"
        } else {
            "other"
        };

        let owner = meta
            .user
            .clone()
            .or_else(|| meta.uid.map(|u| if u == 0 { "root".to_string() } else { u.to_string() }));
        let group = meta
            .group
            .clone()
            .or_else(|| meta.gid.map(|g| if g == 0 { "root".to_string() } else { g.to_string() }));

        out.push(SftpEntryDto {
            path: join_remote(&resolved, &name),
            name,
            file_type: file_type.to_string(),
            size: meta.size.unwrap_or(0),
            permissions: meta.permissions.unwrap_or(0o644) & 0o7777,
            owner,
            group,
            modified_at: meta.mtime.unwrap_or(0) as u64 * 1000,
        });
    }

    out.sort_by(|a, b| {
        let a_dir = a.file_type == "directory";
        let b_dir = b.file_type == "directory";
        b_dir.cmp(&a_dir).then_with(|| a.name.cmp(&b.name))
    });

    Ok(out)
}

#[tauri::command]
pub async fn sftp_read(
    state: State<'_, SshManager>,
    session_id: String,
    remote_path: String,
) -> Result<SftpReadResultDto, String> {
    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;

    let meta = sftp
        .metadata(&remote_path)
        .await
        .map_err(|e| format!("SFTP metadata failed: {e}"))?;

    if meta.size.unwrap_or(0) > 10 * 1024 * 1024 {
        return Err("文件超过 10MB，请使用下载功能".to_string());
    }

    let bytes = sftp
        .read(&remote_path)
        .await
        .map_err(|e| format!("SFTP read failed: {e}"))?;

    let is_likely_binary = bytes.iter().take(4096).any(|&b| b == 0);
    let text = if is_likely_binary {
        None
    } else {
        std::str::from_utf8(&bytes).ok().map(|s| s.to_string())
    };

    Ok(SftpReadResultDto {
        path: remote_path,
        text,
        bytes_b64: B64.encode(&bytes),
        permissions: meta.permissions.unwrap_or(0o644) & 0o7777,
        encoding: if is_likely_binary { "binary" } else { "utf-8" }.to_string(),
    })
}

#[tauri::command]
pub async fn sftp_write(
    state: State<'_, SshManager>,
    session_id: String,
    remote_path: String,
    bytes_b64: String,
    permissions: Option<u32>,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;
    let bytes = B64
        .decode(bytes_b64)
        .map_err(|e| format!("Invalid base64 content: {e}"))?;

    sftp.write(&remote_path, &bytes)
        .await
        .map_err(|e| format!("SFTP write failed: {e}"))?;

    if let Some(perm) = permissions {
        let mut attrs = FileAttributes::empty();
        attrs.permissions = Some(perm);
        let _ = sftp.set_metadata(&remote_path, attrs).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, SshManager>,
    session_id: String,
    remote_path: String,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;
    sftp.create_dir(&remote_path)
        .await
        .map_err(|e| format!("SFTP mkdir failed: {e}"))
}

#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, SshManager>,
    session_id: String,
    remote_path: String,
    is_dir: bool,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;
    if is_dir {
        sftp.remove_dir(&remote_path)
            .await
            .map_err(|e| format!("SFTP remove_dir failed: {e}"))
    } else {
        sftp.remove_file(&remote_path)
            .await
            .map_err(|e| format!("SFTP remove_file failed: {e}"))
    }
}

#[tauri::command]
pub async fn sftp_upload_local_file(
    state: State<'_, SshManager>,
    session_id: String,
    local_path: String,
    remote_dir: String,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;

    let path_obj = std::path::Path::new(&local_path);
    let file_name = path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid local file name".to_string())?;

    let bytes = tokio::fs::read(path_obj)
        .await
        .map_err(|e| format!("Failed to read local file {local_path}: {e}"))?;

    let remote_path = join_remote(&remote_dir, file_name);
    sftp.write(&remote_path, &bytes)
        .await
        .map_err(|e| format!("SFTP upload failed: {e}"))
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, SshManager>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;
    sftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("SFTP rename failed: {e}"))
}

fn launch_os_default_editor(path: &std::path::Path) -> Result<(), String> {
    let path_str = path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("启动本地默认程序失败: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("启动本地默认程序失败: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("启动本地默认程序失败: {e}"))?;
        return Ok(());
    }
}

#[tauri::command]
pub async fn sftp_open_external_editor(
    app: AppHandle,
    state: State<'_, SshManager>,
    session_id: String,
    remote_path: String,
) -> Result<String, String> {
    let watch_key = format!("{session_id}:{remote_path}");

    // If already being watched and temp file exists, just re-open it
    if let Ok(map) = watchers_map().lock() {
        if let Some(existing_path) = map.get(&watch_key) {
            if existing_path.exists() {
                launch_os_default_editor(existing_path)?;
                return Ok(existing_path.to_string_lossy().to_string());
            }
        }
    }

    let session = state.get_session(&session_id).await?;
    let sftp = session.get_sftp().await?;

    let meta = sftp
        .metadata(&remote_path)
        .await
        .map_err(|e| format!("读取远程文件属性失败: {e}"))?;
    let max_bytes: u64 = 16 * 1024 * 1024;
    if meta.size.unwrap_or(0) > max_bytes {
        return Err("文件超过 16MB，请先下载后使用本地编辑器打开".to_string());
    }
    let original_perm = meta.permissions.map(|p| p & 0o7777);

    let bytes = sftp
        .read(&remote_path)
        .await
        .map_err(|e| format!("下载远程文件失败: {e}"))?;

    let file_name = remote_path
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("remote_file")
        .to_string();
    let safe_name: String = file_name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();

    let short_sid: String = session_id.chars().take(8).collect();
    let dir = std::env::temp_dir().join("issh-edit").join(short_sid);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("创建临时编辑目录失败: {e}"))?;

    // Hash prefix prevents collisions when two different directories share a filename
    let path_hash: u64 = remote_path
        .bytes()
        .fold(5381u64, |acc, b| acc.wrapping_mul(33).wrapping_add(b as u64));
    let local_path = dir.join(format!("{:06x}_{}", path_hash & 0xffffff, safe_name));

    tokio::fs::write(&local_path, &bytes)
        .await
        .map_err(|e| format!("写入本地临时文件失败: {e}"))?;

    let initial_meta = tokio::fs::metadata(&local_path)
        .await
        .map_err(|e| format!("读取临时文件属性失败: {e}"))?;
    let mut last_mtime: Option<SystemTime> = initial_meta.modified().ok();
    let mut last_len: u64 = initial_meta.len();

    launch_os_default_editor(&local_path)?;

    if let Ok(mut map) = watchers_map().lock() {
        map.insert(watch_key.clone(), local_path.clone());
    }

    let watch_path = local_path.clone();
    let watch_remote = remote_path.clone();
    let watch_file_name = file_name.clone();
    let watch_sid = session_id.clone();

    tokio::spawn(async move {
        let mut idle_ticks: u32 = 0;
        let max_idle_ticks: u32 = 2 * 3600 * 1000 / 700; // ~2 hours

        loop {
            tokio::time::sleep(Duration::from_millis(700)).await;
            idle_ticks += 1;

            // Stop if session disconnected or idle timeout reached
            let mgr = app.state::<SshManager>();
            let session_opt = mgr.get_session(&watch_sid).await.ok();
            if session_opt.is_none() || idle_ticks > max_idle_ticks {
                break;
            }

            let Ok(cur_meta) = tokio::fs::metadata(&watch_path).await else {
                // Local temp file deleted externally
                break;
            };

            let cur_mtime = cur_meta.modified().ok();
            let cur_len = cur_meta.len();

            if cur_mtime != last_mtime || cur_len != last_len {
                // Brief debounce so atomic-save editors finish flushing
                tokio::time::sleep(Duration::from_millis(250)).await;
                let Ok(new_bytes) = tokio::fs::read(&watch_path).await else {
                    continue;
                };
                if let Ok(m2) = tokio::fs::metadata(&watch_path).await {
                    last_mtime = m2.modified().ok();
                    last_len = m2.len();
                } else {
                    last_mtime = cur_mtime;
                    last_len = cur_len;
                }
                idle_ticks = 0;

                if let Some(sess) = session_opt {
                    let sync_res: Result<(), String> = async {
                        let sftp = sess.get_sftp().await?;
                        sftp.write(&watch_remote, &new_bytes)
                            .await
                            .map_err(|e| format!("SFTP 回传失败: {e}"))?;
                        if let Some(perm) = original_perm {
                            let mut attrs = FileAttributes::empty();
                            attrs.permissions = Some(perm);
                            let _ = sftp.set_metadata(&watch_remote, attrs).await;
                        }
                        Ok(())
                    }
                    .await;

                    match sync_res {
                        Ok(()) => {
                            let _ = app.emit(
                                "sftp-external-sync",
                                ExternalSyncPayload {
                                    session_id: watch_sid.clone(),
                                    remote_path: watch_remote.clone(),
                                    file_name: watch_file_name.clone(),
                                    status: "synced".to_string(),
                                    message: None,
                                },
                            );
                        }
                        Err(err) => {
                            let _ = app.emit(
                                "sftp-external-sync",
                                ExternalSyncPayload {
                                    session_id: watch_sid.clone(),
                                    remote_path: watch_remote.clone(),
                                    file_name: watch_file_name.clone(),
                                    status: "error".to_string(),
                                    message: Some(err),
                                },
                            );
                        }
                    }
                }
            }
        }

        if let Ok(mut map) = watchers_map().lock() {
            map.remove(&watch_key);
        }
        let _ = tokio::fs::remove_file(&watch_path).await;
    });

    Ok(local_path.to_string_lossy().to_string())
}
