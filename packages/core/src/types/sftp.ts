export type SftpFileType = 'file' | 'directory' | 'symlink' | 'other';

export interface SftpEntry {
  name: string;
  path: string;
  type: SftpFileType;
  size: number;
  /** Unix permissions, e.g. 0o755 */
  permissions: number;
  owner?: string;
  group?: string;
  modifiedAt: number;
  symlinkTarget?: string;
}

export interface SftpReadResult {
  path: string;
  /** UTF-8 decoded text if text file, otherwise null */
  text: string | null;
  /** Raw bytes for binary / Hex editor */
  bytes: Uint8Array;
  permissions: number;
  encoding: string;
}

export interface SftpTransferProgress {
  transferId: string;
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  transferredBytes: number;
  totalBytes: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}
