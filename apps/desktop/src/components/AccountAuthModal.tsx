import { useEffect, useState } from 'react';
import { Cloud, KeyRound, Mail, Server, User, X } from 'lucide-react';
import {
  getCloudServerUrl,
  loginAccount,
  registerAccount,
  resetPasswordAccount,
  sendEmailCode,
  setCloudServerUrl,
  type CloudUser,
} from '../cloud/cloudClient';

type AuthMode = 'login' | 'register' | 'reset';

interface AccountAuthModalProps {
  open: boolean;
  required?: boolean;
  hideServerUrl?: boolean;
  onClose: () => void;
  onAuthenticated: (user: CloudUser) => void;
}

export function AccountAuthModal({
  open,
  required = false,
  hideServerUrl = false,
  onClose,
  onAuthenticated,
}: AccountAuthModalProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [serverUrl, setServerUrl] = useState(getCloudServerUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  if (!open) return null;

  const handleSendCode = async () => {
    if (!email.trim()) {
      setError('请先填写邮箱地址');
      return;
    }
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      setCloudServerUrl(serverUrl);
      const res = await sendEmailCode(
        email.trim(),
        mode === 'register' ? 'register' : 'reset_pwd',
        serverUrl
      );
      setCooldown(60);
      setInfo(`验证码已发送至 ${email.trim()}（${res.expireMinutes} 分钟内有效）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      setCloudServerUrl(serverUrl);
      if (mode === 'login') {
        const res = await loginAccount(email.trim(), password, serverUrl);
        onAuthenticated(res.user);
        onClose();
      } else if (mode === 'register') {
        const res = await registerAccount(
          {
            email: email.trim(),
            password,
            code: code.trim(),
            nickname: nickname.trim() || undefined,
          },
          serverUrl
        );
        onAuthenticated(res.user);
        onClose();
      } else {
        await resetPasswordAccount(
          { email: email.trim(), code: code.trim(), newPassword: password },
          serverUrl
        );
        setInfo('密码重置成功，请使用新密码登录');
        setMode('login');
        setPassword('');
        setCode('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0e1420] text-xs text-slate-200 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-sky-400" />
            <span className="text-sm font-semibold text-white">
              {mode === 'login'
                ? '登录 ISSH 云账号'
                : mode === 'register'
                  ? '注册 ISSH 云账号'
                  : '邮箱找回密码'}
            </span>
          </div>
          {!required && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 p-5">
          {/* Server Endpoint */}
          {!hideServerUrl && (
            <div>
              <label className="mb-1 flex items-center gap-1 text-slate-400">
                <Server className="h-3 w-3 text-sky-400" /> 云同步服务器地址
              </label>
              <input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://ssh.yourdomain.com"
                className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">
              {info}
            </div>
          )}

          <div>
            <label className="mb-1 flex items-center gap-1 text-slate-400">
              <Mail className="h-3 w-3" /> 邮箱地址
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
            />
          </div>

          {mode !== 'login' && (
            <div>
              <label className="mb-1 block text-slate-400">邮箱验证码</label>
              <div className="flex gap-2">
                <input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 位数字验证码"
                  className="flex-1 rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 font-mono text-slate-200 outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  disabled={busy || cooldown > 0}
                  onClick={() => void handleSendCode()}
                  className="shrink-0 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-sky-300 hover:bg-sky-500/25 disabled:opacity-45"
                >
                  {cooldown > 0 ? `${cooldown}s 后重试` : '发送验证码'}
                </button>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label className="mb-1 flex items-center gap-1 text-slate-400">
                <User className="h-3 w-3" /> 昵称（可选）
              </label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="默认取邮箱前缀"
                className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
          )}

          <div>
            <label className="mb-1 flex items-center gap-1 text-slate-400">
              <KeyRound className="h-3 w-3" />
              {mode === 'reset' ? '新密码（6 位以上，支持字母/数字/特殊字符）' : '密码'}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-sky-500 py-2 font-medium text-white transition hover:bg-sky-400 disabled:opacity-50"
          >
            {busy
              ? '处理中...'
              : mode === 'login'
                ? '登录'
                : mode === 'register'
                  ? '完成注册并登录'
                  : '重置密码'}
          </button>

          <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
            {mode === 'login' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfo(null);
                    setMode('register');
                  }}
                  className="text-sky-400 hover:underline"
                >
                  没有账号？邮箱注册
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfo(null);
                    setMode('reset');
                  }}
                  className="hover:text-slate-200"
                >
                  忘记密码？
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setMode('login');
                }}
                className="text-sky-400 hover:underline"
              >
                返回登录
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
