import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ConnectionStatus,
  ExecResult,
  HostConfig,
  ISshTransport,
  PtySize,
  SftpEntry,
  SftpReadResult,
  SystemMetrics,
  Unsubscribe,
} from '@issh/core';

interface PtyDataPayload {
  sessionId: string;
  dataB64: string;
}

interface StatusPayload {
  sessionId: string;
  status: ConnectionStatus;
  error?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const OSC7_REGEX = /\x1b\]7;file:\/\/[^/\x07\x1b]*([^\x07\x1b]+)(?:\x07|\x1b\\)/g;
const STRIP_ANSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const PROMPT_CWD_REGEX = /[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:(~(?:\/[^\s#$]*)?|\/[^\s#$]*)[#$]\s*$/;

export class TauriSshTransport implements ISshTransport {
  private ptyListeners = new Map<string, Set<(chunk: Uint8Array) => void>>();
  private pendingPtyBuffers = new Map<string, Uint8Array[]>();
  private statusListeners = new Map<
    string,
    Set<(status: ConnectionStatus, error?: string) => void>
  >();
  private cwdListeners = new Map<string, Set<(cwd: string) => void>>();
  private unlistenPty: UnlistenFn | null = null;
  private unlistenStatus: UnlistenFn | null = null;
  private initialized = false;
  private textDecoder = new TextDecoder('utf-8', { fatal: false });

  private async ensureListeners() {
    if (this.initialized) return;
    this.initialized = true;

    this.unlistenPty = await listen<PtyDataPayload>('ssh-pty-data', (event) => {
      const { sessionId, dataB64 } = event.payload;
      const bytes = base64ToBytes(dataB64);

      const handlers = this.ptyListeners.get(sessionId);
      if (handlers && handlers.size > 0) {
        for (const h of handlers) h(bytes);
      } else {
        const buf = this.pendingPtyBuffers.get(sessionId) ?? [];
        buf.push(bytes);
        this.pendingPtyBuffers.set(sessionId, buf);
      }

      // Check for OSC 7 or standard shell prompt working directory updates
      const cwdHandlers = this.cwdListeners.get(sessionId);
      if (cwdHandlers && cwdHandlers.size > 0) {
        const text = this.textDecoder.decode(bytes, { stream: true });
        let matchedOsc7 = false;
        let match: RegExpExecArray | null;
        OSC7_REGEX.lastIndex = 0;
        while ((match = OSC7_REGEX.exec(text)) !== null) {
          matchedOsc7 = true;
          try {
            const decodedPath = decodeURIComponent(match[1]);
            for (const h of cwdHandlers) h(decodedPath);
          } catch {
            // ignore malformed URI
          }
        }

        if (!matchedOsc7) {
          const clean = text.replace(STRIP_ANSI_REGEX, '');
          const promptMatch = clean.match(PROMPT_CWD_REGEX);
          if (promptMatch) {
            const rawCwd = promptMatch[1];
            for (const h of cwdHandlers) h(rawCwd);
          }
        }
      }
    });

    this.unlistenStatus = await listen<StatusPayload>('ssh-status', (event) => {
      const { sessionId, status, error } = event.payload;
      const handlers = this.statusListeners.get(sessionId);
      if (handlers) {
        for (const h of handlers) h(status, error);
      }
    });
  }

  async connect(config: HostConfig, initialSize: PtySize): Promise<string> {
    await this.ensureListeners();
    const sessionId = await invoke<string>('ssh_connect', {
      config: {
        host: config.host,
        port: config.port,
        username: config.username,
        auth: config.auth,
      },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });
    return sessionId;
  }

  async disconnect(sessionId: string): Promise<void> {
    await invoke('ssh_disconnect', { sessionId });
    this.ptyListeners.delete(sessionId);
    this.pendingPtyBuffers.delete(sessionId);
    this.statusListeners.delete(sessionId);
    this.cwdListeners.delete(sessionId);
  }

  async writePty(sessionId: string, data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await invoke('ssh_write_pty', {
      sessionId,
      dataB64: bytesToBase64(bytes),
    });
  }

  async resizePty(sessionId: string, size: PtySize): Promise<void> {
    await invoke('ssh_resize_pty', {
      sessionId,
      cols: size.cols,
      rows: size.rows,
    });
  }

  onPtyData(sessionId: string, handler: (chunk: Uint8Array) => void): Unsubscribe {
    let set = this.ptyListeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.ptyListeners.set(sessionId, set);
    }
    set.add(handler);

    const pending = this.pendingPtyBuffers.get(sessionId);
    if (pending && pending.length > 0) {
      this.pendingPtyBuffers.delete(sessionId);
      for (const chunk of pending) {
        handler(chunk);
      }
    }

    return () => {
      set?.delete(handler);
    };
  }

  onStatusChange(
    sessionId: string,
    handler: (status: ConnectionStatus, error?: string) => void
  ): Unsubscribe {
    let set = this.statusListeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.statusListeners.set(sessionId, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  onCwdChange(sessionId: string, handler: (cwd: string) => void): Unsubscribe {
    let set = this.cwdListeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.cwdListeners.set(sessionId, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  async exec(
    sessionId: string,
    command: string,
    options?: { timeoutMs?: number; cwd?: string }
  ): Promise<ExecResult> {
    const fullCmd = options?.cwd
      ? `cd ${JSON.stringify(options.cwd)} && ${command}`
      : command;
    return await invoke<ExecResult>('ssh_exec', {
      sessionId,
      command: fullCmd,
      timeoutMs: options?.timeoutMs ?? 30_000,
    });
  }

  async fetchMetrics(sessionId: string): Promise<SystemMetrics> {
    return await invoke<SystemMetrics>('ssh_fetch_metrics', { sessionId });
  }

  async sftpRealpath(sessionId: string, path: string): Promise<string> {
    return await invoke<string>('sftp_realpath', { sessionId, path });
  }

  async sftpList(sessionId: string, remotePath: string): Promise<SftpEntry[]> {
    return await invoke<SftpEntry[]>('sftp_list', { sessionId, remotePath });
  }

  async sftpRead(sessionId: string, remotePath: string): Promise<SftpReadResult> {
    const dto = await invoke<{
      path: string;
      text: string | null;
      bytesB64: string;
      permissions: number;
      encoding: string;
    }>('sftp_read', { sessionId, remotePath });
    return {
      path: dto.path,
      text: dto.text,
      bytes: base64ToBytes(dto.bytesB64),
      permissions: dto.permissions,
      encoding: dto.encoding,
    };
  }

  async sftpWrite(
    sessionId: string,
    remotePath: string,
    content: Uint8Array | string,
    options?: { permissions?: number }
  ): Promise<void> {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    await invoke('sftp_write', {
      sessionId,
      remotePath,
      bytesB64: bytesToBase64(bytes),
      permissions: options?.permissions ?? null,
    });
  }

  async sftpMkdir(sessionId: string, remotePath: string): Promise<void> {
    await invoke('sftp_mkdir', { sessionId, remotePath });
  }

  async sftpRemove(
    sessionId: string,
    remotePath: string,
    recursive?: boolean
  ): Promise<void> {
    await invoke('sftp_remove', {
      sessionId,
      remotePath,
      isDir: Boolean(recursive),
    });
  }

  async sftpRename(
    sessionId: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    await invoke('sftp_rename', { sessionId, oldPath, newPath });
  }

  async sftpUploadLocalFile(
    sessionId: string,
    localPath: string,
    remoteDir: string
  ): Promise<void> {
    await invoke('sftp_upload_local_file', {
      sessionId,
      localPath,
      remoteDir,
    });
  }

  async sftpOpenExternalEditor(
    sessionId: string,
    remotePath: string
  ): Promise<string> {
    return invoke<string>('sftp_open_external_editor', {
      sessionId,
      remotePath,
    });
  }

  dispose() {
    this.unlistenPty?.();
    this.unlistenStatus?.();
  }
}

export const tauriTransport = new TauriSshTransport();
