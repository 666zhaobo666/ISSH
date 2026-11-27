import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Ban,
  Check,
  Copy,
  Crown,
  DatabaseBackup,
  Download,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  apiRequest,
  getAdminToken,
  setAdminToken,
  type AdminStats,
  type AdminUser,
  type AuditLogItem,
  type BannedIPItem,
  type SystemSettings,
  type SystemUpdateStatus,
  type VipTokenItem,
} from './api';

type AdminTab = 'dashboard' | 'users' | 'tokens' | 'security' | 'settings' | 'backup';

function formatTime(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function App() {
  const [authedUser, setAuthedUser] = useState<AdminUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loginEmail, setLoginEmail] = useState('admin@issh.local');
  const [loginPwd, setLoginPwd] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState<AdminTab>('dashboard');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Dashboard & Server Release Check + One-Click Updater
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [latestRelease, setLatestRelease] = useState<{
    hasRelease: boolean;
    tagName?: string;
    notes?: string;
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<SystemUpdateStatus | null>(null);
  const [triggeringUpdate, setTriggeringUpdate] = useState(false);
  const [ackUpdateAt, setAckUpdateAt] = useState<number>(() =>
    Number(localStorage.getItem('issh.admin.ack_update_at.v1') || '0')
  );
  const [showUpdateLog, setShowUpdateLog] = useState(false);

  // Users
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const [usersTotal, setUsersTotal] = useState(0);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    email: '',
    password: '',
    nickname: '',
    vipDays: 0,
  });

  // Security, Logs & Banned IPs
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [bannedIps, setBannedIps] = useState<BannedIPItem[]>([]);
  const [banIpInput, setBanIpInput] = useState('');
  const [banReasonInput, setBanReasonInput] = useState('');

  // Tokens
  const [tokens, setTokens] = useState<VipTokenItem[]>([]);
  const [tokenFilter, setTokenFilter] = useState<'all' | 'unused' | 'redeemed' | 'revoked'>('all');
  const [genCount, setGenCount] = useState(10);
  const [genDays, setGenDays] = useState(30);
  const [genNote, setGenNote] = useState('');
  const [newlyGenerated, setNewlyGenerated] = useState<string[]>([]);

  // Settings
  const [sysSettings, setSysSettings] = useState<SystemSettings | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);

  // Backup
  const [restoring, setRestoring] = useState(false);
  const backupFileRef = useRef<HTMLInputElement>(null);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    apiRequest<{ user: AdminUser }>('/api/user/me')
      .then((res) => {
        if (res.user.role === 'admin') setAuthedUser(res.user);
        else setAdminToken('');
      })
      .catch(() => setAdminToken(''))
      .finally(() => setCheckingAuth(false));
  }, []);

  const loadStats = async () => {
    try {
      const s = await apiRequest<AdminStats>('/api/admin/stats');
      setStats(s);
    } catch (e) {
      showToast('err', String(e));
    }
  };

  const loadSecurity = async () => {
    try {
      const [logsRes, ipsRes] = await Promise.all([
        apiRequest<{ logs: AuditLogItem[] }>('/api/admin/logs?limit=150'),
        apiRequest<{ ips: BannedIPItem[] }>('/api/admin/banned-ips'),
      ]);
      setAuditLogs(logsRes.logs ?? []);
      setBannedIps(ipsRes.ips ?? []);
    } catch (e) {
      showToast('err', String(e));
    }
  };

  const loadUsers = async (q = userQuery) => {
    try {
      const res = await apiRequest<{ total: number; users: AdminUser[] }>(
        `/api/admin/users?q=${encodeURIComponent(q)}&limit=100`
      );
      setUsers(res.users ?? []);
      setUsersTotal(res.total);
    } catch (e) {
      showToast('err', String(e));
    }
  };

  const loadTokens = async (st = tokenFilter) => {
    try {
      const res = await apiRequest<{ total: number; tokens: VipTokenItem[] }>(
        `/api/admin/tokens?status=${st}&limit=100`
      );
      setTokens(res.tokens ?? []);
    } catch (e) {
      showToast('err', String(e));
    }
  };

  const loadSettings = async () => {
    try {
      const res = await apiRequest<SystemSettings>('/api/admin/settings');
      setSysSettings(res);
    } catch (e) {
      showToast('err', String(e));
    }
  };

  const loadUpdateStatus = async () => {
    try {
      const st = await apiRequest<SystemUpdateStatus>('/api/admin/system/update/status');
      setUpdateStatus(st);
    } catch {
      // Ignore transient disconnect while container restarts during update
    }
  };

  useEffect(() => {
    if (!authedUser) return;
    if (tab === 'dashboard') {
      void loadStats();
      void loadUpdateStatus();
      apiRequest<{ hasRelease: boolean; tagName?: string; notes?: string }>('/api/app/latest')
        .then(setLatestRelease)
        .catch(() => {});
    }
    if (tab === 'users') void loadUsers();
    if (tab === 'tokens') void loadTokens();
    if (tab === 'security') void loadSecurity();
    if (tab === 'settings') void loadSettings();
  }, [authedUser, tab]);

  // Poll update progress every 2s while queued or running
  useEffect(() => {
    if (!authedUser || tab !== 'dashboard') return;
    if (updateStatus?.state !== 'queued' && updateStatus?.state !== 'running') return;
    const timer = window.setInterval(() => {
      void loadUpdateStatus();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [authedUser, tab, updateStatus?.state]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr(null);
    setLoggingIn(true);
    try {
      const res = await apiRequest<{ token: string; user: AdminUser }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email: loginEmail, password: loginPwd }),
        }
      );
      if (res.user.role !== 'admin') {
        throw new Error('该账号不是管理员');
      }
      setAdminToken(res.token);
      setAuthedUser(res.user);
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : String(err));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleToggleUserStatus = async (u: AdminUser) => {
    const next = u.status === 'active' ? 'disabled' : 'active';
    try {
      await apiRequest(`/api/admin/users/${u.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: next }),
      });
      showToast('ok', next === 'disabled' ? `已禁用 ${u.email}` : `已恢复 ${u.email}`);
      void loadUsers();
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    }
  };

  const handleAdjustVip = async (u: AdminUser, addDays: number | null) => {
    try {
      await apiRequest(`/api/admin/users/${u.id}/vip`, {
        method: 'PUT',
        body: JSON.stringify(addDays === null ? { expireAt: 0 } : { addDays }),
      });
      showToast('ok', addDays === null ? `已清除 ${u.email} VIP` : `已为 ${u.email} 增加 ${addDays} 天 VIP`);
      void loadUsers();
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    }
  };

  const handleGenerateTokens = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ tokens: VipTokenItem[] }>(
        '/api/admin/tokens/batch',
        {
          method: 'POST',
          body: JSON.stringify({
            count: genCount,
            durationDays: genDays,
            batchNote: genNote,
          }),
        }
      );
      setNewlyGenerated(res.tokens.map((t) => t.code));
      showToast('ok', `成功生成 ${res.tokens.length} 张 ${genDays} 天 VIP 卡密`);
      void loadTokens();
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    }
  };

  const handleRevokeToken = async (id: string) => {
    try {
      await apiRequest(`/api/admin/tokens/${id}/revoke`, { method: 'POST' });
      showToast('ok', '卡密已作废');
      void loadTokens();
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sysSettings) return;
    setSavingSettings(true);
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(sysSettings),
      });
      showToast('ok', '系统设置与发信模板已保存');
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestSmtp = async () => {
    if (!sysSettings || !testEmail.trim()) {
      showToast('err', '请先填写测试收件邮箱');
      return;
    }
    setTestingSmtp(true);
    try {
      await apiRequest('/api/admin/settings/test-smtp', {
        method: 'POST',
        body: JSON.stringify({ toEmail: testEmail.trim(), smtp: sysSettings.smtp }),
      });
      showToast('ok', `测试邮件已发送至 ${testEmail.trim()}`);
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const res = await fetch('/api/admin/backup/export', {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `issh-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('ok', '全量灾备压缩包已导出');
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    }
  };

  const handleRestoreBackup = async (file: File | null) => {
    if (!file) return;
    setRestoring(true);
    try {
      const fd = new FormData();
      fd.append('backup', file);
      const res = await apiRequest<{ avatarCount: number }>(
        '/api/admin/backup/restore',
        { method: 'POST', body: fd }
      );
      showToast('ok', `数据已无损恢复（含 ${res.avatarCount} 个头像），正在刷新...`);
      void loadStats();
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0f17] text-xs text-slate-400">
        正在验证管理员会话...
      </div>
    );
  }

  if (!authedUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0f17] p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#101622] p-6 shadow-2xl"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">ISSH 管理后台</h1>
              <p className="text-[11px] text-slate-400">管理员身份验证</p>
            </div>
          </div>

          {loginErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {loginErr}
            </div>
          )}

          <div className="space-y-3 text-xs">
            <div>
              <label className="mb-1 block text-slate-400">管理员邮箱</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400">密码</label>
              <input
                type="password"
                required
                value={loginPwd}
                onChange={(e) => setLoginPwd(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loggingIn}
            className="w-full rounded-lg bg-sky-500 py-2 text-xs font-medium text-white transition hover:bg-sky-400 disabled:opacity-50"
          >
            {loggingIn ? '登录中...' : '登录管理后台'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b0f17] text-xs text-slate-200">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-[#0e1420] p-3">
        <div className="mb-5 flex items-center gap-2.5 px-2 pt-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="font-semibold text-white">ISSH Admin</div>
            <div className="text-[10px] text-slate-500">{authedUser.email}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {(
            [
              { id: 'dashboard', label: '概览仪表盘', icon: LayoutDashboard },
              { id: 'users', label: '用户与 VIP 管理', icon: Users },
              { id: 'tokens', label: 'VIP 卡密管理', icon: Ticket },
              { id: 'security', label: '安全防护与日志', icon: ShieldAlert },
              { id: 'settings', label: '系统与 SMTP 设置', icon: Settings },
              { id: 'backup', label: '全量备份与恢复', icon: DatabaseBackup },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                  active
                    ? 'bg-sky-500/15 font-medium text-sky-300'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => {
            setAdminToken('');
            setAuthedUser(null);
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-400 hover:bg-white/5 hover:text-rose-300"
        >
          <LogOut className="h-4 w-4" /> 退出登录
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6">
        {/* TAB 1: DASHBOARD */}
        {tab === 'dashboard' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">系统概览</h2>
              <button
                type="button"
                onClick={() => void loadStats()}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300 hover:bg-white/10"
              >
                <RefreshCw className="h-3.5 w-3.5" /> 刷新
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { label: '注册用户总数', val: stats?.totalUsers ?? 0, color: 'text-sky-400' },
                { label: '有效 VIP 用户', val: stats?.activeVipUsers ?? 0, color: 'text-amber-400' },
                { label: '未使用卡密', val: stats?.unusedTokens ?? 0, color: 'text-emerald-400' },
                { label: '已封禁 IP / 审计日志', val: `${stats?.bannedIpCount ?? 0} / ${stats?.auditLogCount ?? 0}`, color: 'text-rose-400' },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-white/10 bg-[#101622] p-4"
                >
                  <div className="text-slate-400">{card.label}</div>
                  <div className={`mt-2 font-mono text-2xl font-bold ${card.color}`}>
                    {card.val}
                  </div>
                </div>
              ))}
            </div>

            {/* Server & Web One-Click Update Control (Admin-only, Scheme A) */}
            {(() => {
              const curVer = updateStatus?.currentVersion || '-';
              const latestVer = latestRelease?.hasRelease ? latestRelease.tagName : '';
              const isUpToDate = Boolean(curVer && latestVer && curVer === latestVer);
              const isRunning =
                updateStatus?.state === 'queued' || updateStatus?.state === 'running';
              const showResultBanner =
                Boolean(updateStatus?.message) &&
                (isRunning ||
                  updateStatus?.state === 'error' ||
                  (updateStatus?.state === 'success' &&
                    (updateStatus.finishedAt ?? 0) > ackUpdateAt));

              return (
                <div className="rounded-xl border border-white/10 bg-[#101622] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-white">服务端与 Web 端一键更新</div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          updateStatus?.agentOnline
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        {updateStatus?.agentOnline ? '● 更新守护进程在线' : '○ 未安装守护进程'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-[11px] text-slate-300">
                        当前版本：{curVer}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] ${
                          isUpToDate
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-sky-500/15 text-sky-300'
                        }`}
                      >
                        {isUpToDate
                          ? `✓ 已是最新 (${latestVer})`
                          : `最新 Release：${latestVer || '检测中...'}`}
                      </span>
                      {updateStatus?.log && !isRunning && (
                        <button
                          type="button"
                          onClick={() => setShowUpdateLog((v) => !v)}
                          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/10"
                        >
                          {showUpdateLog ? '收起日志' : '上次日志'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={triggeringUpdate || isRunning}
                        onClick={async () => {
                          setTriggeringUpdate(true);
                          setShowUpdateLog(true);
                          try {
                            await apiRequest('/api/admin/system/update', { method: 'POST' });
                            showToast('ok', '已触发一键更新，正在拉取代码并重建容器...');
                            await loadUpdateStatus();
                          } catch (e) {
                            showToast('err', e instanceof Error ? e.message : String(e));
                          } finally {
                            setTriggeringUpdate(false);
                          }
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-sky-400 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            triggeringUpdate || isRunning ? 'animate-spin' : ''
                          }`}
                        />
                        {isRunning ? '正在更新构建中...' : '一键更新服务端与 Web 端'}
                      </button>
                    </div>
                  </div>

                  {showResultBanner && updateStatus?.message && (
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] ${
                        updateStatus.state === 'error'
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                          : updateStatus.state === 'success'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                      }`}
                    >
                      <span>{updateStatus.message}</span>
                      {updateStatus.state === 'success' && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const ts = updateStatus.finishedAt || Date.now();
                              localStorage.setItem('issh.admin.ack_update_at.v1', String(ts));
                              setAckUpdateAt(ts);
                              setShowUpdateLog(false);
                              window.location.reload();
                            }}
                            className="rounded bg-emerald-500 px-2.5 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-400"
                          >
                            刷新页面生效
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const ts = updateStatus.finishedAt || Date.now();
                              localStorage.setItem('issh.admin.ack_update_at.v1', String(ts));
                              setAckUpdateAt(ts);
                              setShowUpdateLog(false);
                            }}
                            className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-white/10"
                          >
                            知道了
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {!updateStatus?.agentOnline && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-slate-400">
                        首次启用面板按钮一键更新，只需在 VPS 项目目录运行一次以下安装命令即可（之后永久在面板点按钮更新）：
                      </p>
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 font-mono text-[11px] text-emerald-300">
                        <code>sudo bash deploy/install-updater.sh</code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText('sudo bash deploy/install-updater.sh');
                            showToast('ok', '已复制守护进程安装命令');
                          }}
                          className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-slate-200 hover:bg-white/20"
                        >
                          <Copy className="h-3 w-3" /> 复制
                        </button>
                      </div>
                    </div>
                  )}

                  {updateStatus?.log && (isRunning || showUpdateLog || updateStatus.state === 'error') && (
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#090d14] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                      {updateStatus.log}
                    </pre>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 2: USERS */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-white">
                用户管理 ({usersTotal})
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadUsers();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="搜索邮箱或昵称..."
                    className="w-60 rounded-lg border border-white/10 bg-[#101622] py-1.5 pl-8 pr-3 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-500 px-3 py-1.5 text-white hover:bg-sky-400"
                >
                  搜索
                </button>
                <button
                  type="button"
                  onClick={() => setCreateUserOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 font-medium text-emerald-300 hover:bg-emerald-500/25"
                >
                  <UserPlus className="h-3.5 w-3.5" /> 添加用户
                </button>
              </form>
            </div>

            {createUserOpen && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await apiRequest('/api/admin/users', {
                      method: 'POST',
                      body: JSON.stringify(newUserForm),
                    });
                    showToast('ok', `已创建用户 ${newUserForm.email}`);
                    setNewUserForm({ email: '', password: '', nickname: '', vipDays: 0 });
                    setCreateUserOpen(false);
                    void loadUsers();
                  } catch (err) {
                    showToast('err', err instanceof Error ? err.message : String(err));
                  }
                }}
                className="flex flex-wrap items-end gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5"
              >
                <input
                  type="email"
                  required
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  placeholder="邮箱"
                  className="w-48 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                />
                <input
                  type="password"
                  required
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  placeholder="初始密码 (≥6位)"
                  className="w-40 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                />
                <input
                  value={newUserForm.nickname}
                  onChange={(e) => setNewUserForm({ ...newUserForm, nickname: e.target.value })}
                  placeholder="昵称 (可选)"
                  className="w-32 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                />
                <input
                  type="number"
                  min={0}
                  value={newUserForm.vipDays}
                  onChange={(e) => setNewUserForm({ ...newUserForm, vipDays: Number(e.target.value) })}
                  placeholder="赠送VIP天数"
                  className="w-28 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  title="赠送 VIP 天数（0 为普通用户）"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-500 px-3.5 py-1.5 font-medium text-white hover:bg-emerald-400"
                >
                  确认创建
                </button>
              </form>
            )}

            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#101622]">
              <table className="w-full text-left">
                <thead className="border-b border-white/10 bg-white/[0.02] text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">用户</th>
                    <th className="px-4 py-2.5">角色 / 状态</th>
                    <th className="px-4 py-2.5">VIP 到期时间</th>
                    <th className="px-4 py-2.5">注册时间</th>
                    <th className="px-4 py-2.5 text-right">快捷操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {u.avatarUrl ? (
                            <img
                              src={u.avatarUrl}
                              alt=""
                              className="h-7 w-7 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/20 font-semibold text-sky-300">
                              {(u.nickname || u.email)[0]?.toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-white">{u.nickname || '-'}</div>
                            <div className="text-[11px] text-slate-400">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {u.role === 'admin' && (
                            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300">
                              管理员
                            </span>
                          )}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              u.status === 'active'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-rose-500/15 text-rose-300'
                            }`}
                          >
                            {u.status === 'active' ? '正常' : '已禁用'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {u.vipActive ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
                            <Crown className="h-3 w-3" /> {formatTime(u.vipExpireAt)}
                          </span>
                        ) : (
                          <span className="text-slate-500">
                            {u.vipExpireAt > 0 ? `已过期 (${formatTime(u.vipExpireAt)})` : '未开通'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{formatTime(u.createdAt)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleAdjustVip(u, 30)}
                            className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20"
                          >
                            +30天
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleAdjustVip(u, 365)}
                            className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20"
                          >
                            +1年
                          </button>
                          {u.vipActive && (
                            <button
                              type="button"
                              onClick={() => void handleAdjustVip(u, null)}
                              className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:text-rose-300"
                            >
                              清VIP
                            </button>
                          )}
                          {u.role !== 'admin' && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleToggleUserStatus(u)}
                                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                                  u.status === 'active'
                                    ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                                    : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                }`}
                              >
                                <Ban className="h-3 w-3" />
                                {u.status === 'active' ? '封禁' : '解封'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!window.confirm(`确定永久删除用户 ${u.email} 及其所有云端数据吗？`)) return;
                                  try {
                                    await apiRequest(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                                    showToast('ok', `已删除用户 ${u.email}`);
                                    void loadUsers();
                                  } catch (err) {
                                    showToast('err', err instanceof Error ? err.message : String(err));
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded border border-rose-500/30 px-2 py-1 text-[11px] text-rose-400 hover:bg-rose-500/20"
                                title="永久删除用户"
                              >
                                <Trash2 className="h-3 w-3" /> 删除
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: VIP TOKENS */}
        {tab === 'tokens' && (
          <div className="space-y-5">
            <h2 className="text-base font-semibold text-white">VIP 卡密管理</h2>

            <form
              onSubmit={handleGenerateTokens}
              className="rounded-xl border border-white/10 bg-[#101622] p-4 space-y-3"
            >
              <div className="font-medium text-white">批量生成 VIP 卡密</div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-slate-400">快捷时长</label>
                  <div className="flex gap-1.5">
                    {[
                      { label: '7天', days: 7 },
                      { label: '1个月', days: 30 },
                      { label: '1年', days: 365 },
                    ].map((p) => (
                      <button
                        key={p.days}
                        type="button"
                        onClick={() => setGenDays(p.days)}
                        className={`rounded-lg border px-2.5 py-1.5 ${
                          genDays === p.days
                            ? 'border-amber-400/60 bg-amber-500/15 text-amber-300'
                            : 'border-white/10 bg-white/5 text-slate-300'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">自定义天数</label>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={genDays}
                    onChange={(e) => setGenDays(Number(e.target.value))}
                    className="w-24 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">生成数量</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={genCount}
                    onChange={(e) => setGenCount(Number(e.target.value))}
                    className="w-24 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="mb-1 block text-slate-400">批次备注（可选）</label>
                  <input
                    value={genNote}
                    onChange={(e) => setGenNote(e.target.value)}
                    placeholder="例如：内测赠送 / 活动批次"
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 font-medium text-white hover:bg-sky-400"
                >
                  <Plus className="h-3.5 w-3.5" /> 立即生成
                </button>
              </div>

              {newlyGenerated.length > 0 && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-medium text-emerald-300">
                      本次新生成 ({newlyGenerated.length} 张)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(newlyGenerated.join('\n'));
                        showToast('ok', '已复制全部新卡密到剪贴板');
                      }}
                      className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-200 hover:bg-emerald-500/30"
                    >
                      <Copy className="h-3 w-3" /> 一键复制全部
                    </button>
                  </div>
                  <pre className="max-h-32 overflow-y-auto font-mono text-[11px] text-emerald-100">
                    {newlyGenerated.join('\n')}
                  </pre>
                </div>
              )}
            </form>

            <div className="flex items-center gap-2">
              {(['all', 'unused', 'redeemed', 'revoked'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setTokenFilter(st);
                    void loadTokens(st);
                  }}
                  className={`rounded-lg px-3 py-1 ${
                    tokenFilter === st
                      ? 'bg-sky-500/20 text-sky-300'
                      : 'bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st === 'all' ? '全部' : st === 'unused' ? '未使用' : st === 'redeemed' ? '已兑换' : '已作废'}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#101622]">
              <table className="w-full text-left">
                <thead className="border-b border-white/10 bg-white/[0.02] text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">卡密</th>
                    <th className="px-4 py-2.5">时长</th>
                    <th className="px-4 py-2.5">状态</th>
                    <th className="px-4 py-2.5">兑换人 / 时间</th>
                    <th className="px-4 py-2.5">备注</th>
                    <th className="px-4 py-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {tokens.map((t) => (
                    <tr key={t.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2 font-mono text-slate-200">{t.code}</td>
                      <td className="px-4 py-2 text-amber-300">{t.durationDays} 天</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            t.status === 'unused'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : t.status === 'redeemed'
                                ? 'bg-sky-500/15 text-sky-300'
                                : 'bg-slate-500/20 text-slate-400'
                          }`}
                        >
                          {t.status === 'unused' ? '未使用' : t.status === 'redeemed' ? '已兑换' : '已作废'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {t.redeemedEmail ? `${t.redeemedEmail} (${formatTime(t.redeemedAt)})` : '-'}
                      </td>
                      <td className="px-4 py-2 text-slate-400">{t.batchNote || '-'}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(t.code);
                              showToast('ok', `已复制 ${t.code}`);
                            }}
                            className="rounded border border-white/10 px-2 py-0.5 text-slate-300 hover:bg-white/10"
                          >
                            复制
                          </button>
                          {t.status === 'unused' && (
                            <button
                              type="button"
                              onClick={() => void handleRevokeToken(t.id)}
                              className="rounded border border-rose-500/30 px-2 py-0.5 text-rose-300 hover:bg-rose-500/15"
                            >
                              作废
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3.5: SECURITY, IP BAN & AUDIT LOGS */}
        {tab === 'security' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white">安全防护、IP 封禁与系统日志</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadSecurity()}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300 hover:bg-white/10"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> 刷新
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await apiRequest<{ deletedLogs: number; deletedCodes: number }>(
                        '/api/admin/cache/clear',
                        { method: 'POST' }
                      );
                      showToast(
                        'ok',
                        `清理完成：已清除 ${res.deletedLogs} 条日志、${res.deletedCodes} 条过期验证码及内存缓存`
                      );
                      void loadSecurity();
                    } catch (err) {
                      showToast('err', err instanceof Error ? err.message : String(err));
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 font-medium text-amber-300 hover:bg-amber-500/25"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 一键清理日志与缓存
                </button>
              </div>
            </div>

            {/* Banned IPs */}
            <div className="rounded-xl border border-white/10 bg-[#101622] p-4 space-y-3">
              <div className="font-medium text-white">
                IP 封禁列表（系统自动拦截 10 分钟内高频注册/爆破 IP，也支持手动封禁）
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!banIpInput.trim()) return;
                  try {
                    await apiRequest('/api/admin/banned-ips', {
                      method: 'POST',
                      body: JSON.stringify({
                        ip: banIpInput.trim(),
                        reason: banReasonInput.trim() || '管理员手动封禁',
                        hours: 0,
                      }),
                    });
                    setBanIpInput('');
                    setBanReasonInput('');
                    showToast('ok', '已封禁 IP');
                    void loadSecurity();
                  } catch (err) {
                    showToast('err', err instanceof Error ? err.message : String(err));
                  }
                }}
                className="flex flex-wrap gap-2"
              >
                <input
                  value={banIpInput}
                  onChange={(e) => setBanIpInput(e.target.value)}
                  placeholder="输入要封禁的 IP（如 1.2.3.4）"
                  className="w-52 rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 font-mono text-slate-200 outline-none focus:border-sky-500"
                />
                <input
                  value={banReasonInput}
                  onChange={(e) => setBanReasonInput(e.target.value)}
                  placeholder="封禁原因（可选）"
                  className="flex-1 rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-rose-500 px-3.5 py-1.5 font-medium text-white hover:bg-rose-400"
                >
                  封禁 IP
                </button>
              </form>

              {bannedIps.length === 0 ? (
                <div className="text-[11px] text-slate-500">当前无封禁 IP</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {bannedIps.map((b) => (
                    <div key={b.ip} className="flex items-center justify-between py-2">
                      <div>
                        <span className="font-mono font-semibold text-rose-300">{b.ip}</span>
                        <span className="ml-2 text-slate-400">{b.reason}</span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiRequest(`/api/admin/banned-ips/${encodeURIComponent(b.ip)}`, {
                            method: 'DELETE',
                          });
                          showToast('ok', `已解封 ${b.ip}`);
                          void loadSecurity();
                        }}
                        className="rounded border border-white/10 px-2.5 py-0.5 text-[11px] text-slate-300 hover:bg-white/10"
                      >
                        解封
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Audit Logs */}
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#101622]">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 font-medium text-white">
                <FileText className="h-4 w-4 text-sky-400" /> 最近系统与安全日志 ({auditLogs.length})
              </div>
              <table className="w-full text-left">
                <thead className="border-b border-white/10 bg-white/[0.02] text-slate-400">
                  <tr>
                    <th className="px-4 py-2">时间</th>
                    <th className="px-4 py-2">级别</th>
                    <th className="px-4 py-2">事件</th>
                    <th className="px-4 py-2">IP</th>
                    <th className="px-4 py-2">操作者</th>
                    <th className="px-4 py-2">详情</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                  {auditLogs.map((l) => (
                    <tr key={l.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2 text-slate-400">{formatTime(l.createdAt)}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            l.level === 'security'
                              ? 'bg-rose-500/20 text-rose-300'
                              : l.level === 'warn'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-sky-500/15 text-sky-300'
                          }`}
                        >
                          {l.level}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-200">{l.action}</td>
                      <td className="px-4 py-2 text-slate-400">{l.ip || '-'}</td>
                      <td className="px-4 py-2 text-slate-300">{l.actor || '-'}</td>
                      <td className="px-4 py-2 font-sans text-slate-300">{l.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: SETTINGS & SMTP */}
        {tab === 'settings' && sysSettings && (
          <form onSubmit={handleSaveSettings} className="max-w-3xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">系统与发信邮箱设置</h2>
              <button
                type="submit"
                disabled={savingSettings}
                className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 font-medium text-white hover:bg-sky-400 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> {savingSettings ? '保存中...' : '保存全部设置'}
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#101622] p-4 space-y-3">
              <div className="font-medium text-white">站点与 Web 网关限制</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-slate-400">站点名称</label>
                  <input
                    value={sysSettings.siteName}
                    onChange={(e) =>
                      setSysSettings({ ...sysSettings, siteName: e.target.value })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    id="reg-toggle"
                    type="checkbox"
                    checked={sysSettings.registrationEnabled}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        registrationEnabled: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-sky-500"
                  />
                  <label htmlFor="reg-toggle" className="text-slate-200">
                    开放新用户注册
                  </label>
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">Web 单用户最大并发 SSH 数</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={sysSettings.webMaxSshConns}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        webMaxSshConns: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">Web 空闲 SSH 超时断开（分钟）</label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    value={sysSettings.webIdleTimeoutMins}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        webIdleTimeoutMins: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#101622] p-4 space-y-3">
              <div className="flex items-center gap-2 font-medium text-white">
                <Mail className="h-4 w-4 text-sky-400" /> SMTP 发信配置与邮件模板
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-slate-400">SMTP 主机</label>
                  <input
                    value={sysSettings.smtp.host}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, host: e.target.value },
                      })
                    }
                    placeholder="smtp.qq.com / smtp.gmail.com"
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">端口（465 SSL / 587 STARTTLS）</label>
                  <input
                    type="number"
                    value={sysSettings.smtp.port}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, port: Number(e.target.value) },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">发信账号</label>
                  <input
                    value={sysSettings.smtp.username}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, username: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">授权码 / 密码</label>
                  <input
                    type="password"
                    value={sysSettings.smtp.password}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, password: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">发件人名称</label>
                  <input
                    value={sysSettings.smtp.fromName}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, fromName: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">发件人邮箱</label>
                  <input
                    value={sysSettings.smtp.fromEmail}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, fromEmail: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-2 border-t border-white/10 pt-3">
                <div className="text-[11px] text-slate-400">
                  模板可用变量：<code>{'{{siteName}}'}</code>、<code>{'{{code}}'}</code>、<code>{'{{expireMinutes}}'}</code>
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">注册验证码邮件标题</label>
                  <input
                    value={sysSettings.smtp.registerSubject}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, registerSubject: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">注册验证码邮件正文</label>
                  <textarea
                    rows={3}
                    value={sysSettings.smtp.registerBody}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, registerBody: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] p-2.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">重置密码邮件标题</label>
                  <input
                    value={sysSettings.smtp.resetSubject}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, resetSubject: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">重置密码邮件正文</label>
                  <textarea
                    rows={3}
                    value={sysSettings.smtp.resetBody}
                    onChange={(e) =>
                      setSysSettings({
                        ...sysSettings,
                        smtp: { ...sysSettings.smtp, resetBody: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] p-2.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-white/10 pt-3">
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="输入测试收件邮箱..."
                  className="flex-1 rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  disabled={testingSmtp}
                  onClick={() => void handleTestSmtp()}
                  className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> {testingSmtp ? '发送中...' : '发送测试邮件'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* TAB 5: BACKUP & RESTORE */}
        {tab === 'backup' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-base font-semibold text-white">全量灾备导出与恢复 (.zip)</h2>

            <div className="rounded-xl border border-white/10 bg-[#101622] p-5 space-y-3">
              <div className="flex items-center gap-2 font-medium text-white">
                <Download className="h-4 w-4 text-sky-400" /> 一键导出全量备份包 (.zip)
              </div>
              <p className="leading-relaxed text-slate-400">
                使用 SQLite 在线热备份（VACUUM INTO）打包完整数据库（所有用户账号、加密同步配置、AI 对话、VIP 卡密、系统与 SMTP 设置）、全部用户头像文件以及 SHA-256 校验清单。
              </p>
              <button
                type="button"
                onClick={() => void handleExportBackup()}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 font-medium text-white hover:bg-sky-400"
              >
                <Download className="h-4 w-4" /> 下载 .zip 全量备份
              </button>
            </div>

            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 space-y-3">
              <div className="flex items-center gap-2 font-medium text-amber-300">
                <Upload className="h-4 w-4" /> 上传 .zip 备份包恢复数据
              </div>
              <p className="leading-relaxed text-slate-300">
                重装后端服务器后，上传此前导出的 <code>.zip</code> 备份包即可一键还原所有用户数据、头像与系统设置。
                <br />
                <strong className="text-amber-300">重要提示：</strong>
                请确保新服务器环境变量中的 <code>ISSH_MASTER_KEY</code> 与原服务器一致，否则无法解密用户的加密配置。
              </p>
              <input
                ref={backupFileRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  void handleRestoreBackup(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={restoring}
                onClick={() => backupFileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 px-4 py-2 font-medium text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
              >
                <KeyRound className="h-4 w-4" />
                {restoring ? '正在校验并恢复...' : '选择 .zip 备份包并恢复'}
              </button>
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs shadow-2xl ${
            toast.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/95 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/95 text-rose-200'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
