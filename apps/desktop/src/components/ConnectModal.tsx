import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isTauriRuntime } from '../transport/runtime';
import { FileKey2, KeyRound, Lock, Plus, Save, Upload, X } from 'lucide-react';
import type { AuthMethod, HostConfig } from '@issh/core';

interface ConnectModalProps {
  open: boolean;
  editingHost?: HostConfig | null;
  existingGroups: string[];
  onClose: () => void;
  onSaveHost: (host: HostConfig, connectNow: boolean) => void;
}

export function ConnectModal({
  open,
  editingHost,
  existingGroups,
  onClose,
  onSaveHost,
}: ConnectModalProps) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [authType, setAuthType] = useState<'password' | 'privateKey'>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [keyFileName, setKeyFileName] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState(false);
  const keyFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || authType !== 'privateKey' || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (cancelled) return;
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setDraggingKey(true);
        } else if (event.payload.type === 'leave') {
          setDraggingKey(false);
        } else if (event.payload.type === 'drop') {
          setDraggingKey(false);
          const firstPath = event.payload.paths?.[0];
          if (!firstPath) return;
          setKeyError(null);
          try {
            const content = await invoke<string>('read_local_text_file', {
              path: firstPath,
            });
            setPrivateKey(content.trim());
            const namePart = firstPath.split(/[/\\]/).pop() ?? firstPath;
            setKeyFileName(namePart);
          } catch (err) {
            setKeyError(err instanceof Error ? err.message : String(err));
          }
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [open, authType]);

  useEffect(() => {
    if (!open) return;
    if (editingHost) {
      setName(editingHost.name);
      setGroup(editingHost.group ?? '');
      setTagsInput((editingHost.tags ?? []).join(', '));
      setHost(editingHost.host);
      setPort(String(editingHost.port));
      setUsername(editingHost.username);
      if (editingHost.auth.type === 'privateKey') {
        setAuthType('privateKey');
        setPrivateKey(editingHost.auth.privateKey);
        setPassphrase(editingHost.auth.passphrase ?? '');
        setPassword('');
      } else {
        setAuthType('password');
        setPassword(editingHost.auth.type === 'password' ? editingHost.auth.password : '');
        setPrivateKey('');
        setPassphrase('');
      }
    } else {
      setName('');
      setGroup('');
      setTagsInput('');
      setHost('');
      setPort('22');
      setUsername('root');
      setAuthType('password');
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
      setKeyFileName(null);
      setKeyError(null);
    }
  }, [open, editingHost]);

  if (!open) return null;

  const buildConfig = (): HostConfig => {
    const auth: AuthMethod =
      authType === 'password'
        ? { type: 'password', password }
        : {
            type: 'privateKey',
            privateKey,
            passphrase: passphrase || undefined,
          };

    const tags = tagsInput
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const now = Date.now();
    return {
      id: editingHost?.id ?? crypto.randomUUID(),
      name: name.trim() || `${username}@${host}`,
      group: group.trim() || undefined,
      tags: tags.length > 0 ? Array.from(new Set(tags)) : undefined,
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      auth,
      enableOsc7Hook: true,
      createdAt: editingHost?.createdAt ?? now,
      updatedAt: now,
    };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim() || !username.trim()) return;
    onSaveHost(buildConfig(), !editingHost);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-white/15 bg-[#111827] p-5 shadow-2xl"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            {editingHost ? (
              <Save className="h-4 w-4 text-sky-400" />
            ) : (
              <Plus className="h-4 w-4 text-sky-400" />
            )}
            {editingHost ? '编辑主机' : '新建主机'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-slate-400">主机名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：香港生产机"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400">所属分组</label>
              <input
                list="issh-group-suggestions"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="例如：生产环境 / 香港"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
              <datalist id="issh-group-suggestions">
                {existingGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-slate-400">标签 (空格或逗号分隔)</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例如：Debian, Docker, 重要"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="mb-1 block text-slate-400">主机地址 / IP</label>
              <input
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400">端口</label>
              <input
                required
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-slate-400">用户名</label>
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setAuthType('password')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 transition ${
                authType === 'password'
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                  : 'border-white/10 bg-white/5 text-slate-400'
              }`}
            >
              <Lock className="h-3.5 w-3.5" />
              密码认证
            </button>
            <button
              type="button"
              onClick={() => setAuthType('privateKey')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 transition ${
                authType === 'privateKey'
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                  : 'border-white/10 bg-white/5 text-slate-400'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              私钥认证
            </button>
          </div>

          {authType === 'password' ? (
            <div>
              <label className="mb-1 block text-slate-400">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入 SSH 密码"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-slate-400">
                  私钥内容 / 密钥文件 (支持直接拖入文件)
                </label>
                <button
                  type="button"
                  onClick={() => keyFileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-sky-300 transition hover:bg-white/10"
                >
                  <Upload className="h-3 w-3" />
                  选择密钥文件
                </button>
                <input
                  ref={keyFileInputRef}
                  type="file"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setKeyError(null);
                    try {
                      const txt = await f.text();
                      setPrivateKey(txt.trim());
                      setKeyFileName(f.name);
                    } catch (err) {
                      setKeyError(err instanceof Error ? err.message : String(err));
                    }
                    e.target.value = '';
                  }}
                />
              </div>

              {keyFileName && (
                <div className="flex items-center gap-1.5 rounded bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-300">
                  <FileKey2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">已加载密钥文件：{keyFileName}</span>
                </div>
              )}
              {keyError && (
                <div className="rounded bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-300">
                  {keyError}
                </div>
              )}

              <textarea
                rows={3}
                value={privateKey}
                onChange={(e) => {
                  setPrivateKey(e.target.value);
                  setKeyFileName(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDraggingKey(true);
                }}
                onDragLeave={() => setDraggingKey(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDraggingKey(false);
                  const f = e.dataTransfer.files?.[0];
                  if (!f) return;
                  const txt = await f.text();
                  setPrivateKey(txt.trim());
                  setKeyFileName(f.name);
                }}
                placeholder="粘贴 -----BEGIN OPENSSH PRIVATE KEY----- 或直接将密钥文件拖到这里"
                className={`max-h-48 min-h-[72px] w-full resize-y rounded-lg border bg-white/5 px-3 py-2 font-mono text-[11px] text-slate-200 outline-none transition focus:border-sky-500 ${
                  draggingKey
                    ? 'border-sky-400 ring-2 ring-sky-400/40'
                    : 'border-white/10'
                }`}
              />
              <div>
                <label className="mb-1 block text-slate-400">私钥密码 (可选)</label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
          >
            取消
          </button>
          {!editingHost && (
            <button
              type="button"
              onClick={() => {
                if (!host.trim() || !username.trim()) return;
                onSaveHost(buildConfig(), false);
                onClose();
              }}
              className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-xs font-medium text-sky-300 transition hover:bg-sky-500/25"
            >
              仅保存
            </button>
          )}
          <button
            type="submit"
            className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sky-400"
          >
            {editingHost ? '保存修改' : '保存并连接'}
          </button>
        </div>
      </form>
    </div>
  );
}
