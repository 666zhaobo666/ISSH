import { isTauriRuntime } from './runtime';
import { tauriTransport, type TauriSshTransport } from './TauriSshTransport';
import {
  webSocketTransport,
  type WebSocketSshTransport,
} from './WebSocketSshTransport';

export type AppSshTransport = TauriSshTransport | WebSocketSshTransport;

export const appTransport: AppSshTransport = isTauriRuntime()
  ? tauriTransport
  : webSocketTransport;
