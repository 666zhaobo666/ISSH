import type { ConnectionStatus, ExecResult, HostConfig, PtySize } from '../types/connection';
import type { SystemMetrics } from '../types/metrics';
import type { SftpEntry, SftpReadResult } from '../types/sftp';

export type Unsubscribe = () => void;

/**
 * Unified SSH/SFTP transport abstraction.
 * - Desktop & Android implement this over Tauri IPC (native Rust `russh`).
 * - Web implements this over WebSocket (Go WS-to-SSH Gateway).
 */
export interface ISshTransport {
  /** Open a new SSH session and return its sessionId */
  connect(config: HostConfig, initialSize: PtySize): Promise<string>;

  /** Close an active SSH session */
  disconnect(sessionId: string): Promise<void>;

  /** Write raw user input / keystrokes to the PTY */
  writePty(sessionId: string, data: string | Uint8Array): Promise<void>;

  /** Resize the remote PTY */
  resizePty(sessionId: string, size: PtySize): Promise<void>;

  /** Subscribe to PTY stdout/stderr data stream */
  onPtyData(sessionId: string, handler: (chunk: Uint8Array) => void): Unsubscribe;

  /** Subscribe to session status changes */
  onStatusChange(
    sessionId: string,
    handler: (status: ConnectionStatus, error?: string) => void
  ): Unsubscribe;

  /** Subscribe to working directory updates (via OSC 7 or fallback parser) */
  onCwdChange(sessionId: string, handler: (cwd: string) => void): Unsubscribe;

  /** Run a non-interactive command in a separate Exec channel (used by AI & monitor) */
  exec(
    sessionId: string,
    command: string,
    options?: { timeoutMs?: number; cwd?: string }
  ): Promise<ExecResult>;

  /** Fetch one snapshot of zero-intrusion system metrics */
  fetchMetrics(sessionId: string): Promise<SystemMetrics>;

  /** SFTP operations */
  sftpList(sessionId: string, remotePath: string): Promise<SftpEntry[]>;
  sftpRead(sessionId: string, remotePath: string): Promise<SftpReadResult>;
  sftpWrite(
    sessionId: string,
    remotePath: string,
    content: Uint8Array | string,
    options?: { permissions?: number }
  ): Promise<void>;
  sftpMkdir(sessionId: string, remotePath: string): Promise<void>;
  sftpRemove(sessionId: string, remotePath: string, recursive?: boolean): Promise<void>;
  sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<void>;
}
