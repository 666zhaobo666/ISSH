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

interface WsResponseMsg {
  type: 'response' | 'pty_data' | 'status';
  reqId?: string;
  sessionId?: string;
  ok?: boolean;
  data?: unknown;
  error?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export class WebSocketSshTransport implements ISshTransport {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<WebSocket> | null = null;
  private tokenProvider: () => string;
  private pending = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void }
  >();
  private ptyListeners = new Map<string, Set<(chunk: Uint8Array) => void>>();
  private pendingPtyBuffers = new Map<string, Uint8Array[]>();
  private statusListeners = new Map<
    string,
    Set<(status: ConnectionStatus, error?: string) => void>
  >();
  private cwdListeners = new Map<string, Set<(cwd: string) => void>>();

  constructor(tokenProvider: () => string) {
    this.tokenProvider = tokenProvider;
  }

  private ensureSocket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = encodeURIComponent(this.tokenProvider());
      const url = `${proto}//${window.location.host}/ws/ssh?token=${token}`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        this.ws = ws;
        this.connectPromise = null;
        resolve(ws);
      };
      ws.onerror = () => {
        this.connectPromise = null;
        reject(new Error('无法连接到 WebSocket SSH 网关'));
      };
      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        for (const [, p] of this.pending) {
          p.reject(new Error('WebSocket 连接已断开'));
        }
        this.pending.clear();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as WsResponseMsg;
          if (msg.type === 'response' && msg.reqId) {
            const p = this.pending.get(msg.reqId);
            if (p) {
              this.pending.delete(msg.reqId);
              if (msg.ok) p.resolve(msg.data);
              else p.reject(new Error(msg.error ?? '网关操作失败'));
            }
          } else if (msg.type === 'pty_data' && msg.sessionId && typeof msg.data === 'string') {
            const bytes = base64ToBytes(msg.data);
            const set = this.ptyListeners.get(msg.sessionId);
            if (set && set.size > 0) {
              for (const h of set) h(bytes);
            } else {
              const buf = this.pendingPtyBuffers.get(msg.sessionId) ?? [];
              buf.push(bytes);
              this.pendingPtyBuffers.set(msg.sessionId, buf);
            }
          } else if (msg.type === 'status' && msg.sessionId) {
            const set = this.statusListeners.get(msg.sessionId);
            const st = (msg.data as { status?: ConnectionStatus } | undefined)?.status ?? 'disconnected';
            if (set) {
              for (const h of set) h(st);
            }
          }
        } catch {
          // ignore malformed messages
        }
      };
    });

    return this.connectPromise;
  }

  private async rpc<T>(
    action: string,
    payload?: Record<string, unknown>,
    sessionId?: string
  ): Promise<T> {
    const ws = await this.ensureSocket();
    const reqId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, {
        resolve: (d) => resolve(d as T),
        reject,
      });
      ws.send(JSON.stringify({ reqId, action, sessionId, payload }));
    });
  }

  async connect(config: HostConfig, initialSize: PtySize): Promise<string> {
    const res = await this.rpc<{ sessionId: string }>('connect', {
      host: config.host,
      port: config.port,
      username: config.username,
      auth: config.auth,
      cols: initialSize.cols,
      rows: initialSize.rows,
    });
    return res.sessionId;
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.rpc('disconnect', undefined, sessionId);
    this.ptyListeners.delete(sessionId);
    this.pendingPtyBuffers.delete(sessionId);
    this.statusListeners.delete(sessionId);
    this.cwdListeners.delete(sessionId);
  }

  async writePty(sessionId: string, data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await this.rpc('write_pty', { dataB64: bytesToBase64(bytes) }, sessionId);
  }

  async resizePty(sessionId: string, size: PtySize): Promise<void> {
    await this.rpc('resize_pty', { cols: size.cols, rows: size.rows }, sessionId);
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
      for (const chunk of pending) handler(chunk);
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

  async exec(sessionId: string, command: string): Promise<ExecResult> {
    return this.rpc<ExecResult>('exec', { command }, sessionId);
  }

  async fetchMetrics(_sessionId: string): Promise<SystemMetrics> {
    return {
      timestamp: Date.now(),
      hostname: '',
      osName: '',
      uptimeSeconds: 0,
      cpu: { usagePercent: 0, cores: 1, loadAvg: [0, 0, 0] },
      memory: {
        totalBytes: 0,
        usedBytes: 0,
        freeBytes: 0,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
      },
      network: [],
      disks: [],
      topProcesses: [],
    };
  }

  async sftpRealpath(sessionId: string, path = '~'): Promise<string> {
    const res = await this.rpc<{ path: string }>('sftp_realpath', { path }, sessionId);
    return res.path;
  }

  async sftpList(sessionId: string, remotePath: string): Promise<SftpEntry[]> {
    return this.rpc<SftpEntry[]>('sftp_list', { path: remotePath }, sessionId);
  }

  async sftpRead(sessionId: string, remotePath: string): Promise<SftpReadResult> {
    const res = await this.rpc<{
      path: string;
      text: string;
      bytesB64: string;
      permissions: number;
      encoding: 'utf-8' | 'binary';
    }>('sftp_read', { path: remotePath }, sessionId);
    return {
      path: res.path,
      text: res.text,
      bytes: base64ToBytes(res.bytesB64),
      permissions: res.permissions,
      encoding: res.encoding,
    };
  }

  async sftpWrite(
    sessionId: string,
    remotePath: string,
    content: Uint8Array | string,
    options?: { permissions?: number }
  ): Promise<void> {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    await this.rpc(
      'sftp_write',
      {
        path: remotePath,
        bytesB64: bytesToBase64(bytes),
        permissions: options?.permissions ?? null,
      },
      sessionId
    );
  }

  async sftpMkdir(sessionId: string, remotePath: string): Promise<void> {
    await this.rpc('sftp_mkdir', { path: remotePath }, sessionId);
  }

  async sftpRemove(
    sessionId: string,
    remotePath: string,
    recursive?: boolean
  ): Promise<void> {
    await this.rpc('sftp_remove', { path: remotePath, isDir: Boolean(recursive) }, sessionId);
  }

  async sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    await this.rpc('sftp_rename', { oldPath, newPath }, sessionId);
  }

  dispose() {
    this.ws?.close();
    this.ws = null;
  }
}
