import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  Cloud,
  CloudOff,
  Crown,
  Folder,
  FileText,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  Terminal as TerminalIcon,
  Ticket,
  X,
} from 'lucide-react';
import type { HostConfig, SftpEntry } from '@issh/core';
import { WebSocketSshTransport } from './transport/WebSocketSshTransport';

const TOKEN_KEY = 'issh.web.token.v1';

interface WebUser {
  id: string;
  email: string;
  nickname: string;
  avatarUrl: string;
  role: 'user' | 'admin';
  vipExpireAt: number;
  vipActive: boolean;
}

interface WebSessionTab {
  tabId: string;
  host: HostConfig;
  sessionId: string | null;
  status: 'connecting' | 'connected' | 'error' | 'disconnected';
  error?: string;
}

function WebTerminal({
  sessionId,
  active,
  transport,
}: {
  sessionId: string | null;
  active: boolean;
  transport: WebSocketSshTransport;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: "'Cascadia Code', 'JetBrains Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#0b0f17',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (sessionId) {
          void transport.resizePty(sessionId, { cols: term.cols, rows: term.rows });
        }
      } catch {
        // ignore
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, [sessionId, transport]);

  useEffect(() => {
    if (!sessionId || !termRef.current) return;
    const term = termRef.current;
    const unsub = transport.onPtyData(sessionId, (chunk) => term.write(chunk));
    const disp = term.onData((data) => {
      void transport.writePty(sessionId, data);
    });
    return () => {
      unsub();
      disp.dispose();
    };
  }, [sessionId, transport]);

  useEffect(() => {
    if (active) {
      window.setTimeout(() => {
        fitRef.current?.fit();
        termRef.current?.focus();
      }, 30);
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full p-2 ${active ? 'block' : 'hidden'}`}
    />
  );
}

export default function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [user, setUser] = useState<WebUser | null>(null);
  const [checking, setChecking] = useState(true);

  // Auth form
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Workspace state
  const [cloudHosts, setCloudHosts] = useState<HostConfig[]>([]);
  const [tabs, setTabs] = useState<WebSessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickHost, setQuickHost] = useState({
    name: '',
    host: '',
    port: 22,
    username: 'root',
    password: '',
  });
  const [vipModalOpen, setVipModalOpen] = useState(false);
  const [vipCode, setVipCode] = useState('');
  const [vipMsg, setVipMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // SFTP drawer state
  const [sftpPath, setSftpPath] = useState('~');
  const [sftpEntries, setSftpEntries] = useState<SftpEntry[]>([]);

  const transport = useMemo(
    () => new WebSocketSshTransport(() => localStorage.getItem(TOKEN_KEY) ?? ''),
    []
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const apiFetch = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const tk = localStorage.getItem(TOKEN_KEY) ?? '';
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
    };
    if (tk) headers['Authorization'] = `Bearer ${tk}`;
    if (init.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, { ...init, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
    }
    return json as T;
  };

  const loadCloudHosts = async (u: WebUser) => {
    if (!u.vipActive) {
      setCloudHosts([]);
      return;
    }
    try {
      const res = await apiFetch<{ exists: boolean; profile?: { hosts?: HostConfig[] } }>(
        '/api/sync/profile'
      );
      if (res.exists && res.profile?.hosts) {
        setCloudHosts(res.profile.hosts);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    apiFetch<{ user: WebUser }>('/api/user/me')
      .then((res) => {
        setUser(res.user);
        void loadCloudHosts(res.user);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken('');
      })
      .finally(() => setChecking(false));
  }, [token]);

  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;

  useEffect(() => {
    if (!activeTab?.sessionId || activeTab.status !== 'connected') {
      setSftpEntries([]);
      return;
    }
    transport
      .sftpList(activeTab.sessionId, sftpPath)
      .then((list) => setSftpEntries(list))
      .catch(() => setSftpEntries([]));
  }, [activeTab?.sessionId, activeTab?.status, sftpPath, transport]);

  const handleConnect = async (host: HostConfig) => {
    const tabId = crypto.randomUUID();
    setTabs((prev) => [
      ...prev,
      { tabId, host, sessionId: null, status: 'connecting' },
    ]);
    setActiveTabId(tabId);
    setSftpPath('~');
    try {
      const sid = await transport.connect(host, { cols: 100, rows: 30 });
      setTabs((prev) =>
        prev.map((t) =>
          t.tabId === tabId ? { ...t, sessionId: sid, status: 'connected' } : t
        )
      );
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.tabId === tabId
            ? { ...t, status: 'error', error: e instanceof Error ? e.message : String(e) }
            : t
        )
      );
    }
  };

  const handleCloseTab = (tabId: string) => {
    const target = tabs.find((t) => t.tabId === tabId);
    if (target?.sessionId) void transport.disconnect(target.sessionId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.tabId !== tabId);
      if (activeTabId === tabId) setActiveTabId(next[0]?.tabId ?? null);
      return next;
    });
  };

  const handleSendCode = async () => {
    setAuthErr(null);
    setAuthInfo(null);
    setAuthBusy(true);
    try {
      const res = await apiFetch<{ expireMinutes: number }>('/api/auth/send-code', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          purpose: authMode === 'register' ? 'register' : 'reset_pwd',
        }),
      });
      setCooldown(60);
      setAuthInfo(`验证码已发送，${res.expireMinutes} 分钟内有效`);
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr(null);
    setAuthInfo(null);
    setAuthBusy(true);
    try {
      if (authMode === 'login') {
        const res = await apiFetch<{ token: string; user: WebUser }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), password }),
        });
        localStorage.setItem(TOKEN_KEY, res.token);
        setToken(res.token);
        setUser(res.user);
        void loadCloudHosts(res.user);
      } else if (authMode === 'register') {
        const res = await apiFetch<{ token: string; user: WebUser }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            password,
            code: code.trim(),
            nickname: nickname.trim() || undefined,
          }),
        });
        localStorage.setItem(TOKEN_KEY, res.token);
        setToken(res.token);
        setUser(res.user);
      } else {
        await apiFetch('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            code: code.trim(),
            newPassword: password,
          }),
        });
        setAuthInfo('密码重置成功，请使用新密码登录');
        setAuthMode('login');
        setPassword('');
        setCode('');
      }
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRedeemVip = async (e: React.FormEvent) => {
    e.preventDefault();
    setVipMsg(null);
    try {
      const res = await apiFetch<{ durationDays: number; user: WebUser }>(
        '/api/vip/redeem',
        {
          method: 'POST',
          body: JSON.stringify({ code: vipCode.trim() }),
        }
      );
      setUser(res.user);
      setVipCode('');
      setVipMsg({ ok: true, text: `VIP 已激活（+${res.durationDays} 天），正在同步云端主机...` });
      void loadCloudHosts(res.user);
    } catch (e) {
      setVipMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0f17] text-xs text-slate-400">
        正在加载 ISSH Web...
      </div>
    );
  }

  // Login Gate (Web requires authentication)
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0f17] p-4 text-xs">
        <form
          onSubmit={handleAuthSubmit}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#101622] p-6 shadow-2xl"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400">
              <TerminalIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">ISSH Web</h1>
              <p className="text-[11px] text-slate-400">
                {authMode === 'login'
                  ? '登录您的 ISSH 云账号'
                  : authMode === 'register'
                    ? '邮箱注册新账号'
                    : '邮箱验证码找回密码'}
              </p>
            </div>
          </div>

          {authErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">
              {authErr}
            </div>
          )}
          {authInfo && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">
              {authInfo}
            </div>
          )}

          <div className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="邮箱地址"
              className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
            />
            {authMode !== 'login' && (
              <div className="flex gap-2">
                <input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 位邮箱验证码"
                  className="flex-1 rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 font-mono text-slate-200 outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  disabled={authBusy || cooldown > 0}
                  onClick={() => void handleSendCode()}
                  className="shrink-0 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-sky-300 hover:bg-sky-500/25 disabled:opacity-45"
                >
                  {cooldown > 0 ? `${cooldown}s` : '发送验证码'}
                </button>
              </div>
            )}
            {authMode === 'register' && (
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="昵称（可选）"
                className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
            )}
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={authMode === 'reset' ? '设置新密码 (6位以上)' : '密码'}
              className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
            />
          </div>

          <button
            type="submit"
            disabled={authBusy}
            className="w-full rounded-lg bg-sky-500 py-2 font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {authBusy
              ? '处理中...'
              : authMode === 'login'
                ? '登录'
                : authMode === 'register'
                  ? '注册并登录'
                  : '重置密码'}
          </button>

          <div className="flex justify-between text-[11px] text-slate-400">
            {authMode === 'login' ? (
              <>
                <button
                  type="button"
                  onClick={() => setAuthMode('register')}
                  className="text-sky-400 hover:underline"
                >
                  邮箱注册
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('reset')}
                  className="hover:text-slate-200"
                >
                  忘记密码？
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className="text-sky-400 hover:underline"
              >
                返回登录
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0b0f17] text-xs text-slate-200">
      {/* Top Bar */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 bg-[#0e1420] px-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          <div className="flex items-center gap-1.5 pr-2 font-semibold text-white">
            <TerminalIcon className="h-4 w-4 text-sky-400" />
            <span>ISSH Web</span>
          </div>
          {tabs.map((t) => (
            <div
              key={t.tabId}
              onClick={() => setActiveTabId(t.tabId)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 ${
                t.tabId === activeTabId
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  t.status === 'connected'
                    ? 'bg-emerald-400'
                    : t.status === 'error'
                      ? 'bg-rose-400'
                      : 'bg-amber-400'
                }`}
              />
              <span>{t.host.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(t.tabId);
                }}
                className="text-slate-500 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            className="flex items-center gap-1 rounded-md border border-dashed border-white/20 px-2.5 py-1 text-sky-300 hover:border-sky-400 hover:bg-sky-500/10"
          >
            <Plus className="h-3.5 w-3.5" /> 临时连接
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVipModalOpen(true)}
            className="flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] pl-1 pr-2.5 text-[11px] hover:border-white/20"
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/25 text-[10px] font-semibold text-sky-300">
                {(user.nickname || user.email)[0]?.toUpperCase()}
              </span>
            )}
            <span className="max-w-[90px] truncate">{user.nickname || user.email}</span>
            {user.vipActive ? (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/35 bg-amber-500/15 px-1.5 py-[1px] text-[9px] font-semibold text-amber-300">
                <Crown className="h-2.5 w-2.5" /> VIP
              </span>
            ) : (
              <span className="rounded-full bg-white/10 px-1.5 py-[1px] text-[9px] text-slate-400">
                卡密激活
              </span>
            )}
            {user.vipActive ? (
              <Cloud className="h-3 w-3 text-emerald-400" />
            ) : (
              <CloudOff className="h-3 w-3 text-slate-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(TOKEN_KEY);
              setToken('');
              setUser(null);
            }}
            className="rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-rose-300"
            title="退出登录"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Main Split */}
      <div className="flex min-h-0 flex-1">
        {/* Left Hosts Sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-[#0e1420] p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-400">
            <span>{user.vipActive ? '云端同步主机' : '临时会话模式'}</span>
            {user.vipActive && (
              <button
                type="button"
                onClick={() => void loadCloudHosts(user)}
                className="text-slate-400 hover:text-white"
                title="刷新云端主机"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            )}
          </div>

          {!user.vipActive ? (
            <div className="space-y-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] text-slate-400">
              <p>当前未开通 VIP，可点击「临时连接」直接连接任意 SSH 服务器（仅当前浏览器会话有效，不保存云端）。</p>
              <button
                type="button"
                onClick={() => setVipModalOpen(true)}
                className="flex w-full items-center justify-center gap-1 rounded-lg border border-amber-400/35 bg-amber-500/10 py-1.5 text-amber-300 hover:bg-amber-500/20"
              >
                <Ticket className="h-3.5 w-3.5" /> 输入卡密激活 VIP
              </button>
            </div>
          ) : (
            <div className="flex-1 space-y-1 overflow-y-auto">
              {cloudHosts.length === 0 ? (
                <div className="text-[11px] text-slate-500">
                  云端暂无主机，可在桌面端同步或点击上方「临时连接」
                </div>
              ) : (
                cloudHosts.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => void handleConnect(h)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-slate-300 hover:bg-white/5 hover:text-white"
                  >
                    <Server className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{h.name}</div>
                      <div className="truncate font-mono text-[10px] text-slate-500">
                        {h.username}@{h.host}:{h.port}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </aside>

        {/* Center Terminal + Bottom SFTP */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-[3] bg-[#0b0f17]">
            {tabs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
                <TerminalIcon className="h-8 w-8 opacity-40" />
                <p>选择左侧云端主机或点击「临时连接」开始 Web SSH 会话</p>
              </div>
            ) : (
              tabs.map((t) =>
                t.status === 'error' ? (
                  <div
                    key={t.tabId}
                    className={`flex h-full items-center justify-center text-rose-400 ${
                      t.tabId === activeTabId ? 'flex' : 'hidden'
                    }`}
                  >
                    连接失败：{t.error}
                  </div>
                ) : (
                  <WebTerminal
                    key={t.tabId}
                    sessionId={t.sessionId}
                    active={t.tabId === activeTabId}
                    transport={transport}
                  />
                )
              )
            )}
          </div>

          {/* Simple SFTP File List */}
          <div className="flex h-48 shrink-0 flex-col border-t border-white/10 bg-[#0d121c]">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[11px] text-slate-400">
              <span className="font-mono">SFTP: {sftpPath}</span>
              {sftpPath !== '/' && sftpPath !== '~' && (
                <button
                  type="button"
                  onClick={() =>
                    setSftpPath(sftpPath.split('/').slice(0, -1).join('/') || '/')
                  }
                  className="text-sky-400 hover:underline"
                >
                  返回上级
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {sftpEntries.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-slate-500">
                  连接 SSH 后显示远程目录文件
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                  {sftpEntries.map((e) => (
                    <button
                      key={e.path}
                      type="button"
                      onDoubleClick={() => {
                        if (e.type === 'directory') setSftpPath(e.path);
                      }}
                      className="flex items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[11px] text-slate-300 hover:bg-white/5"
                    >
                      {e.type === 'directory' ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                      )}
                      <span className="truncate">{e.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Quick Temporary Connect Modal */}
      {quickOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuickOpen(false);
              const now = Date.now();
              void handleConnect({
                id: crypto.randomUUID(),
                name: quickHost.name.trim() || quickHost.host.trim(),
                host: quickHost.host.trim(),
                port: quickHost.port || 22,
                username: quickHost.username.trim() || 'root',
                auth: { type: 'password', password: quickHost.password },
                createdAt: now,
                updatedAt: now,
              });
            }}
            className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-[#101622] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">临时 SSH 连接</span>
              <button type="button" onClick={() => setQuickOpen(false)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <input
              placeholder="备注名称（可选）"
              value={quickHost.name}
              onChange={(e) => setQuickHost({ ...quickHost, name: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
            />
            <div className="flex gap-2">
              <input
                required
                placeholder="主机 IP / 域名"
                value={quickHost.host}
                onChange={(e) => setQuickHost({ ...quickHost, host: e.target.value })}
                className="flex-1 rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
              />
              <input
                type="number"
                value={quickHost.port}
                onChange={(e) => setQuickHost({ ...quickHost, port: Number(e.target.value) })}
                className="w-20 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
            <input
              required
              placeholder="用户名 (如 root)"
              value={quickHost.username}
              onChange={(e) => setQuickHost({ ...quickHost, username: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
            />
            <input
              type="password"
              required
              placeholder="SSH 密码"
              value={quickHost.password}
              onChange={(e) => setQuickHost({ ...quickHost, password: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-sky-500 py-2 font-medium text-white hover:bg-sky-400"
            >
              立即连接
            </button>
          </form>
        </div>
      )}

      {/* VIP Token Redemption Modal (No shop/purchase links) */}
      {vipModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleRedeemVip}
            className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-[#101622] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-white">
                <Crown className="h-4 w-4 text-amber-400" />
                <span>激活 / 续费 VIP</span>
              </div>
              <button type="button" onClick={() => setVipModalOpen(false)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              {user.vipActive
                ? `当前 VIP 有效期至：${new Date(user.vipExpireAt).toLocaleDateString()}`
                : '输入卡密激活 VIP 后即可同步云端主机与配置'}
            </p>
            <input
              required
              value={vipCode}
              onChange={(e) => setVipCode(e.target.value)}
              placeholder="ISSH-XXXX-XXXX-XXXX"
              className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 font-mono uppercase text-slate-200 outline-none focus:border-amber-400"
            />
            {vipMsg && (
              <div
                className={`rounded-lg px-3 py-2 text-[11px] ${
                  vipMsg.ok
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-rose-500/15 text-rose-300'
                }`}
              >
                {vipMsg.text}
              </div>
            )}
            <button
              type="submit"
              className="w-full rounded-lg border border-amber-400/40 bg-amber-500/20 py-2 font-medium text-amber-200 hover:bg-amber-500/30"
            >
              确认兑换
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
