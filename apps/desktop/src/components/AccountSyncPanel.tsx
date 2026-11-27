import { useRef, useState } from 'react';
import {
  Camera,
  Check,
  Cloud,
  CloudOff,
  Crown,
  KeyRound,
  LogOut,
  Pencil,
  RefreshCw,
  Ticket,
} from 'lucide-react';
import {
  changeUserPassword,
  logoutCloudAccount,
  redeemVipCode,
  resolveAvatarUrl,
  updateNickname,
  uploadUserAvatar,
  type CloudUser,
} from '../cloud/cloudClient';

export type SyncStatusState =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'vip_expired'
  | 'error';

interface AccountSyncPanelProps {
  user: CloudUser | null;
  syncStatus: SyncStatusState;
  lastSyncedAt: number;
  onOpenAuth: () => void;
  onUserChange: (user: CloudUser | null) => void;
  onManualSync: () => void;
}

function formatDate(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function AccountSyncPanel({
  user,
  syncStatus,
  lastSyncedAt,
  onOpenAuth,
  onUserChange,
  onManualSync,
}: AccountSyncPanelProps) {
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [nickSaving, setNickSaving] = useState(false);
  const [vipCode, setVipCode] = useState('');
  const [vipRedeeming, setVipRedeeming] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 3200);
  };

  if (!user) {
    return (
      <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-white">
              <Cloud className="h-4 w-4 text-sky-400" />
              <span>云端账号与多端无感同步</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              未登录或非 VIP 用户可无限制使用全部本地 SSH / SFTP / AI 功能。登录云账号并激活 VIP 后，自动开启主机配置、AI 服务商、Skills 与对话历史的多端无感心跳同步。
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAuth}
            className="shrink-0 rounded-lg bg-sky-500 px-3.5 py-1.5 font-medium text-white transition hover:bg-sky-400"
          >
            登录 / 注册
          </button>
        </div>
      </div>
    );
  }

  const avatarSrc = resolveAvatarUrl(user.avatarUrl);
  const nickDirty = nickname.trim() !== '' && nickname.trim() !== user.nickname;

  const handleSaveNickname = async () => {
    if (!nickDirty) return;
    setNickSaving(true);
    try {
      const updated = await updateNickname(nickname.trim());
      onUserChange(updated);
      flash('ok', '昵称已更新');
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      setNickSaving(false);
    }
  };

  const handleAvatarFile = async (file: File | null) => {
    if (!file) return;
    try {
      const updated = await uploadUserAvatar(file);
      onUserChange(updated);
      flash('ok', '头像已更新并自动压缩优化');
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vipCode.trim()) return;
    setVipRedeeming(true);
    try {
      const res = await redeemVipCode(vipCode.trim());
      setVipCode('');
      onUserChange(res.user);
      flash('ok', `激活成功！VIP 已延长 ${res.durationDays} 天`);
      onManualSync();
    } catch (err) {
      flash('err', err instanceof Error ? err.message : String(err));
    } finally {
      setVipRedeeming(false);
    }
  };

  const handleChangePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdSaving(true);
    try {
      const updated = await changeUserPassword(oldPwd, newPwd);
      onUserChange(updated);
      setOldPwd('');
      setNewPwd('');
      setPwdOpen(false);
      flash('ok', '密码修改成功');
    } catch (err) {
      flash('err', err instanceof Error ? err.message : String(err));
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-[11px] ${
            notice.kind === 'ok'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* User Identity Card */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="group relative h-12 w-12 shrink-0 rounded-full border border-white/15 bg-sky-500/20"
              title="点击更换头像（自动压缩为 256×256）"
            >
              <span className="block h-full w-full overflow-hidden rounded-full">
                {avatarSrc ? (
                  <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-base font-semibold text-sky-300">
                    {(user.nickname || user.email)[0]?.toUpperCase()}
                  </span>
                )}
              </span>
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition group-hover:opacity-100">
                <Camera className="h-4 w-4 text-white" />
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[#0e1420] bg-sky-500 text-white shadow">
                <Pencil className="h-2.5 w-2.5" />
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void handleAvatarFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />

            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 focus-within:border-sky-500 focus-within:bg-[#090d14]">
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    title="点击编辑昵称"
                    className="w-28 bg-transparent text-sm font-semibold text-white outline-none sm:w-32"
                  />
                  <Pencil className="h-3 w-3 shrink-0 text-slate-400" />
                </div>
                {nickDirty && (
                  <button
                    type="button"
                    disabled={nickSaving}
                    onClick={() => void handleSaveNickname()}
                    className="flex items-center gap-1 rounded bg-sky-500 px-2 py-0.5 text-[10px] text-white hover:bg-sky-400"
                  >
                    <Check className="h-3 w-3" /> 保存
                  </button>
                )}
                {user.vipActive ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-gradient-to-r from-amber-500/20 to-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    <Crown className="h-2.5 w-2.5" />
                    VIP · 至 {formatDate(user.vipExpireAt)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                    {user.vipExpireAt > 0 ? 'VIP 已过期' : '普通用户'}
                  </span>
                )}
              </div>
              <div className="px-0.5 text-[11px] text-slate-400">{user.email}</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPwdOpen((v) => !v)}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/10"
            >
              <KeyRound className="h-3 w-3" /> 改密码
            </button>
            <button
              type="button"
              onClick={() => {
                logoutCloudAccount();
                onUserChange(null);
              }}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-400 hover:bg-rose-500/15 hover:text-rose-300"
            >
              <LogOut className="h-3 w-3" /> 退出
            </button>
          </div>
        </div>

        {pwdOpen && (
          <form
            onSubmit={handleChangePwd}
            className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3"
          >
            <input
              type="password"
              required
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              placeholder="原密码"
              className="w-36 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
            />
            <input
              type="password"
              required
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="新密码 (6位以上)"
              className="flex-1 rounded-lg border border-white/10 bg-[#090d14] px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={pwdSaving}
              className="rounded-lg bg-sky-500 px-3 py-1.5 font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              确认修改
            </button>
          </form>
        )}
      </div>

      {/* VIP Token Redemption (no external shop links) */}
      <form
        onSubmit={handleRedeem}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3.5"
      >
        <Ticket className="h-4 w-4 shrink-0 text-amber-400" />
        <input
          value={vipCode}
          onChange={(e) => setVipCode(e.target.value)}
          placeholder="输入 VIP 卡密（如 ISSH-XXXX-XXXX-XXXX）激活或续费"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 font-mono text-[11px] uppercase text-slate-200 outline-none focus:border-amber-400/60"
        />
        <button
          type="submit"
          disabled={vipRedeeming || !vipCode.trim()}
          className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3.5 py-1.5 font-medium text-amber-300 transition hover:bg-amber-500/25 disabled:opacity-40"
        >
          {vipRedeeming ? '兑换中...' : '激活 VIP'}
        </button>
      </form>

      {/* Heartbeat Sync Status */}
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-2.5">
          {user.vipActive ? (
            <Cloud className="h-4 w-4 text-emerald-400" />
          ) : (
            <CloudOff className="h-4 w-4 text-slate-500" />
          )}
          <div>
            <div className="font-medium text-slate-200">
              {user.vipActive ? '同步功能已开启' : '云端同步已暂停（仅 VIP 可用）'}
            </div>
            <div className="text-[11px] text-slate-400">
              {user.vipActive
                ? lastSyncedAt > 0
                  ? `上次同步：${new Date(lastSyncedAt).toLocaleTimeString()}`
                  : '配置变更即时同步，后台自动静默保活'
                : '云端数据已安全保留不删除，激活 VIP 后可选择云端/本地/智能合并恢复'}
            </div>
          </div>
        </div>
        {user.vipActive && (
          <button
            type="button"
            disabled={syncStatus === 'syncing'}
            onClick={onManualSync}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncStatus === 'syncing' ? 'animate-spin text-sky-400' : ''}`}
            />
            立即同步
          </button>
        )}
      </div>
    </div>
  );
}
