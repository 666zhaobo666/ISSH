export type AuthMethod =
  | { type: 'password'; password: string }
  | { type: 'privateKey'; privateKey: string; passphrase?: string }
  | { type: 'agent' };

export interface HostConfig {
  id: string;
  name: string;
  group?: string;
  tags?: string[];
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  /** Optional jump host ID */
  jumpHostId?: string;
  /** Enable OSC 7 shell hook injection for accurate directory tracking */
  enableOsc7Hook?: boolean;
  /** Detected or user-chosen OS type (e.g. debian, ubuntu, centos, alpine, arch, rocky, linux) */
  osType?: string;
  /** ISO 2-letter country/region code (e.g. US, HK, JP, SG, CN, DE) */
  countryCode?: string;
  createdAt: number;
  updatedAt: number;
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface PtySize {
  cols: number;
  rows: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
}
