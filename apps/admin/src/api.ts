const TOKEN_KEY = 'issh.admin.token.v1';

export function getAdminToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setAdminToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // ignore non-json
  }
  if (!res.ok) {
    throw new Error(String(json.message ?? json.error ?? `HTTP ${res.status}`));
  }
  return json as T;
}

export interface AdminStats {
  totalUsers: number;
  activeVipUsers: number;
  disabledUsers: number;
  unusedTokens: number;
  redeemedTokens: number;
  syncedProfiles: number;
  syncedThreads: number;
  auditLogCount?: number;
  bannedIpCount?: number;
}

export interface AuditLogItem {
  id: string;
  level: 'info' | 'warn' | 'security';
  action: string;
  ip: string;
  actor: string;
  detail: string;
  createdAt: number;
}

export interface BannedIPItem {
  ip: string;
  reason: string;
  expiresAt: number;
  createdAt: number;
}

export interface AdminUser {
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

export interface VipTokenItem {
  id: string;
  code: string;
  durationDays: number;
  status: 'unused' | 'redeemed' | 'revoked';
  batchNote: string;
  redeemedBy: string;
  redeemedEmail?: string;
  redeemedAt: number;
  createdAt: number;
}

export interface SystemSettings {
  siteName: string;
  registrationEnabled: boolean;
  webMaxSshConns: number;
  webIdleTimeoutMins: number;
  smtp: {
    host: string;
    port: number;
    username: string;
    password: string;
    fromName: string;
    fromEmail: string;
    useTls: boolean;
    registerSubject: string;
    registerBody: string;
    resetSubject: string;
    resetBody: string;
  };
}
