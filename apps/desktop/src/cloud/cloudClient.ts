import type { IsshUserProfileBundle } from '../ai/profileBundle';

export interface CloudUser {
  id: string;
  email: string;
  nickname: string;
  avatarUrl: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  vipExpireAt: number;
  vipActive: boolean;
  createdAt: number;
}

export interface SyncHeartbeatResponse {
  vipActive: boolean;
  vipExpireAt: number;
  hasCloudProfile: boolean;
  profileVersion: number;
  threadsMaxVersion: number;
}

export interface CloudThreadEnvelope {
  threadId: string;
  version?: number;
  deleted: boolean;
  updatedAt: number;
  data?: unknown;
}

const SERVER_URL_KEY = 'issh.cloud.server_url.v1';
const TOKEN_KEY = 'issh.cloud.token.v1';
const USER_KEY = 'issh.cloud.user.v1';
const SYNC_META_KEY = 'issh.cloud.sync_meta.v1';

export function getCloudServerUrl(): string {
  const saved = localStorage.getItem(SERVER_URL_KEY)?.trim();
  if (saved) return saved.replace(/\/+$/, '');
  // On Web build served from the same origin, default to window.location.origin
  if (typeof window !== 'undefined' && !window.location.origin.startsWith('http://localhost:1420') && !window.location.origin.startsWith('tauri://')) {
    return window.location.origin;
  }
  return 'http://localhost:8080';
}

export function setCloudServerUrl(url: string) {
  localStorage.setItem(SERVER_URL_KEY, url.trim().replace(/\/+$/, ''));
}

export function getCloudToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setCloudToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getCachedCloudUser(): CloudUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as CloudUser) : null;
  } catch {
    return null;
  }
}

export function setCachedCloudUser(user: CloudUser | null) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function getSyncMeta(): {
  userId?: string;
  profileVersion: number;
  threadsMaxVersion: number;
  lastSyncedAt: number;
} {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { profileVersion: 0, threadsMaxVersion: 0, lastSyncedAt: 0 };
}

export function setSyncMeta(meta: {
  userId?: string;
  profileVersion: number;
  threadsMaxVersion: number;
  lastSyncedAt: number;
}) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

export function resolveAvatarUrl(avatarUrl: string): string {
  if (!avatarUrl) return '';
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
    return avatarUrl;
  }
  return `${getCloudServerUrl()}${avatarUrl}`;
}

export class CloudApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function cloudFetch<T>(
  path: string,
  options: RequestInit = {},
  baseUrlOverride?: string
): Promise<T> {
  const base = (baseUrlOverride ?? getCloudServerUrl()).replace(/\/+$/, '');
  const token = getCloudToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...options, headers });
  } catch {
    throw new CloudApiError(0, 'NETWORK_ERROR', `无法连接到服务器 (${base})`);
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new CloudApiError(
      res.status,
      String(json.error ?? 'HTTP_ERROR'),
      String(json.message ?? `请求失败 (HTTP ${res.status})`)
    );
  }
  return json as T;
}

export async function sendEmailCode(
  email: string,
  purpose: 'register' | 'reset_pwd',
  serverUrl?: string
): Promise<{ expireMinutes: number }> {
  return cloudFetch(
    '/api/auth/send-code',
    { method: 'POST', body: JSON.stringify({ email, purpose }) },
    serverUrl
  );
}

export async function registerAccount(
  payload: { email: string; password: string; code: string; nickname?: string },
  serverUrl?: string
): Promise<{ token: string; user: CloudUser }> {
  const res = await cloudFetch<{ token: string; user: CloudUser }>(
    '/api/auth/register',
    { method: 'POST', body: JSON.stringify(payload) },
    serverUrl
  );
  if (serverUrl) setCloudServerUrl(serverUrl);
  setCloudToken(res.token);
  setCachedCloudUser(res.user);
  return res;
}

export async function loginAccount(
  email: string,
  password: string,
  serverUrl?: string
): Promise<{ token: string; user: CloudUser }> {
  const res = await cloudFetch<{ token: string; user: CloudUser }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    serverUrl
  );
  if (serverUrl) setCloudServerUrl(serverUrl);
  setCloudToken(res.token);
  setCachedCloudUser(res.user);
  return res;
}

export async function resetPasswordAccount(
  payload: { email: string; code: string; newPassword: string },
  serverUrl?: string
): Promise<void> {
  await cloudFetch(
    '/api/auth/reset-password',
    { method: 'POST', body: JSON.stringify(payload) },
    serverUrl
  );
}

export async function fetchMe(): Promise<CloudUser> {
  const res = await cloudFetch<{ user: CloudUser }>('/api/user/me');
  setCachedCloudUser(res.user);
  return res.user;
}

export async function updateNickname(nickname: string): Promise<CloudUser> {
  const res = await cloudFetch<{ user: CloudUser }>('/api/user/profile', {
    method: 'PUT',
    body: JSON.stringify({ nickname }),
  });
  setCachedCloudUser(res.user);
  return res.user;
}

export async function uploadUserAvatar(file: File): Promise<CloudUser> {
  const fd = new FormData();
  fd.append('avatar', file);
  const res = await cloudFetch<{ user: CloudUser }>('/api/user/avatar', {
    method: 'POST',
    body: fd,
  });
  setCachedCloudUser(res.user);
  return res.user;
}

export async function changeUserPassword(
  oldPassword: string,
  newPassword: string
): Promise<CloudUser> {
  const res = await cloudFetch<{ token: string; user: CloudUser }>(
    '/api/user/change-password',
    { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }
  );
  if (res.token) setCloudToken(res.token);
  setCachedCloudUser(res.user);
  return res.user;
}

export async function redeemVipCode(
  code: string
): Promise<{ durationDays: number; vipExpireAt: number; user: CloudUser }> {
  const res = await cloudFetch<{
    durationDays: number;
    vipExpireAt: number;
    user: CloudUser;
  }>('/api/vip/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  setCachedCloudUser(res.user);
  return res;
}

export function logoutCloudAccount() {
  setCloudToken('');
  setCachedCloudUser(null);
}

export async function fetchSyncHeartbeat(): Promise<SyncHeartbeatResponse> {
  return cloudFetch<SyncHeartbeatResponse>('/api/sync/heartbeat');
}

export async function pullCloudProfile(): Promise<{
  exists: boolean;
  version: number;
  profile: IsshUserProfileBundle | null;
}> {
  return cloudFetch('/api/sync/profile');
}

export async function pushCloudProfile(
  profile: IsshUserProfileBundle
): Promise<{ version: number; updatedAt: number }> {
  return cloudFetch('/api/sync/profile', {
    method: 'PUT',
    body: JSON.stringify({ profile }),
  });
}

export async function pullCloudThreads(
  sinceVersion: number
): Promise<{ maxVersion: number; threads: CloudThreadEnvelope[] }> {
  return cloudFetch(`/api/sync/threads?sinceVersion=${sinceVersion}`);
}

export async function pushCloudThreads(
  threads: CloudThreadEnvelope[]
): Promise<{ maxVersion: number }> {
  return cloudFetch('/api/sync/threads', {
    method: 'POST',
    body: JSON.stringify({ threads }),
  });
}
