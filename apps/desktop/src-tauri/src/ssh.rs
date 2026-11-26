use crate::metrics::{MetricsTracker, SystemMetrics, METRICS_PROBE_CMD};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use russh::client::{self, AuthResult, Config, Handle};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthMethodInput {
    Password {
        password: String,
    },
    PrivateKey {
        private_key: String,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectConfigInput {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethodInput,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
    pub timed_out: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataPayload {
    session_id: String,
    data_b64: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    session_id: String,
    status: String,
    error: Option<String>,
}

enum PtyCmd {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &PublicKeyOrCertificate,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        // TODO(Phase 2): Prompt & persist known_hosts fingerprints
        async { Ok(true) }
    }
}

pub struct SshSession {
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    pty_tx: mpsc::UnboundedSender<PtyCmd>,
    metrics_tracker: Mutex<MetricsTracker>,
    sftp: Mutex<Option<Arc<russh_sftp::client::SftpSession>>>,
}

#[derive(Default)]
pub struct SshManager {
    sessions: RwLock<HashMap<String, Arc<SshSession>>>,
}

impl SshManager {
    pub async fn get_session(&self, session_id: &str) -> Result<Arc<SshSession>, String> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {session_id}"))
    }
}

impl SshSession {
    pub async fn get_sftp(&self) -> Result<Arc<russh_sftp::client::SftpSession>, String> {
        let mut guard = self.sftp.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }

        let channel = {
            let handle = self.handle.lock().await;
            handle
                .channel_open_session()
                .await
                .map_err(|e| format!("Failed to open SFTP session channel: {e}"))?
        };
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("Failed to request SFTP subsystem: {e}"))?;

        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("Failed to initialize SFTP session: {e}"))?;
        let arc = Arc::new(sftp);
        *guard = Some(arc.clone());
        Ok(arc)
    }
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, SshManager>,
    config: ConnectConfigInput,
    cols: u32,
    rows: u32,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();

    let russh_cfg = Arc::new(Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        keepalive_interval: Some(Duration::from_secs(15)),
        ..Default::default()
    });

    let addr = format!("{}:{}", config.host, config.port);
    let mut handle = tokio::time::timeout(
        Duration::from_secs(15),
        client::connect(russh_cfg, addr, ClientHandler),
    )
    .await
    .map_err(|_| "SSH connection timed out".to_string())?
    .map_err(|e| format!("SSH connect failed: {e}"))?;

    let auth_res = match config.auth {
        AuthMethodInput::Password { password } => handle
            .authenticate_password(config.username.clone(), password)
            .await
            .map_err(|e| format!("Password auth error: {e}"))?,
        AuthMethodInput::PrivateKey {
            private_key,
            passphrase,
        } => {
            let key_pair = decode_secret_key(&private_key, passphrase.as_deref())
                .map_err(|e| format!("Invalid private key: {e}"))?;
            let best_hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("Key hash negotiation error: {e}"))?
                .flatten();
            handle
                .authenticate_publickey(
                    config.username.clone(),
                    PrivateKeyWithHashAlg::new(Arc::new(key_pair), best_hash),
                )
                .await
                .map_err(|e| format!("Public key auth error: {e}"))?
        }
        AuthMethodInput::Agent => {
            return Err("SSH Agent auth is not implemented yet".to_string());
        }
    };

    if !matches!(auth_res, AuthResult::Success) {
        return Err("Authentication failed".to_string());
    }

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open session channel: {e}"))?;

    channel
        .request_pty(
            true,
            "xterm-256color",
            cols,
            rows,
            0,
            0,
            &[],
        )
        .await
        .map_err(|e| format!("Failed to request PTY: {e}"))?;

    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("Failed to start shell: {e}"))?;

    let (pty_tx, mut pty_rx) = mpsc::unbounded_channel::<PtyCmd>();
    let handle_arc = Arc::new(Mutex::new(handle));

    let session = Arc::new(SshSession {
        handle: handle_arc,
        pty_tx,
        metrics_tracker: Mutex::new(MetricsTracker::default()),
        sftp: Mutex::new(None),
    });

    state
        .sessions
        .write()
        .await
        .insert(session_id.clone(), session);

    if let Err(e) = app.emit(
        "ssh-status",
        StatusPayload {
            session_id: session_id.clone(),
            status: "connected".to_string(),
            error: None,
        },
    ) {
        eprintln!("[issh] emit ssh-status failed: {e}");
    }

    let sid = session_id.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                cmd = pty_rx.recv() => {
                    match cmd {
                        Some(PtyCmd::Write(bytes)) => {
                            if channel.data(&bytes[..]).await.is_err() {
                                break;
                            }
                        }
                        Some(PtyCmd::Resize(c, r)) => {
                            let _ = channel.window_change(c, r, 0, 0).await;
                        }
                        Some(PtyCmd::Close) | None => {
                            let _ = channel.eof().await;
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            if let Err(e) = app_clone.emit(
                                "ssh-pty-data",
                                PtyDataPayload {
                                    session_id: sid.clone(),
                                    data_b64: B64.encode(&data),
                                },
                            ) {
                                eprintln!("[issh] emit ssh-pty-data failed: {e}");
                            }
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            if let Err(e) = app_clone.emit(
                                "ssh-pty-data",
                                PtyDataPayload {
                                    session_id: sid.clone(),
                                    data_b64: B64.encode(&data),
                                },
                            ) {
                                eprintln!("[issh] emit ssh-pty-data ext failed: {e}");
                            }
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            let _ = app_clone.emit(
                                "ssh-status",
                                StatusPayload {
                                    session_id: sid.clone(),
                                    status: "disconnected".to_string(),
                                    error: None,
                                },
                            );
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn ssh_write_pty(
    state: State<'_, SshManager>,
    session_id: String,
    data_b64: String,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await?;
    let bytes = B64
        .decode(data_b64)
        .map_err(|e| format!("Invalid base64 payload: {e}"))?;
    session
        .pty_tx
        .send(PtyCmd::Write(bytes))
        .map_err(|_| "PTY channel closed".to_string())
}

#[tauri::command]
pub async fn ssh_resize_pty(
    state: State<'_, SshManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await?;
    session
        .pty_tx
        .send(PtyCmd::Resize(cols, rows))
        .map_err(|_| "PTY channel closed".to_string())
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, SshManager>,
    session_id: String,
) -> Result<(), String> {
    if let Some(session) = state.sessions.write().await.remove(&session_id) {
        let _ = session.pty_tx.send(PtyCmd::Close);
    }
    Ok(())
}

async fn run_exec_internal(
    session: &SshSession,
    command: &str,
    timeout_ms: u64,
) -> Result<ExecResult, String> {
    let mut channel = {
        let handle = session.handle.lock().await;
        handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open exec channel: {e}"))?
    };

    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Exec failed: {e}"))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    let mut timed_out = false;

    let fut = async {
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
                    stderr.extend_from_slice(&data);
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = Some(exit_status);
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
    };

    if tokio::time::timeout(Duration::from_millis(timeout_ms), fut)
        .await
        .is_err()
    {
        timed_out = true;
        let _ = channel.close().await;
    }

    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit_code,
        timed_out,
    })
}

#[tauri::command]
pub async fn ssh_exec(
    state: State<'_, SshManager>,
    session_id: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<ExecResult, String> {
    let session = state.get_session(&session_id).await?;
    run_exec_internal(&session, &command, timeout_ms.unwrap_or(30_000)).await
}

#[tauri::command]
pub async fn ssh_fetch_metrics(
    state: State<'_, SshManager>,
    session_id: String,
) -> Result<SystemMetrics, String> {
    let session = state.get_session(&session_id).await?;
    let res = run_exec_internal(&session, METRICS_PROBE_CMD, 5_000).await?;
    let mut tracker = session.metrics_tracker.lock().await;
    Ok(tracker.parse(&res.stdout))
}
