import { useMemo, useState } from 'react';
import {
  Copy,
  Edit2,
  FolderOpen,
  KeyRound,
  Lock,
  Play,
  Plus,
  Search,
  Server,
  Tag,
  Trash2,
} from 'lucide-react';
import type { HostConfig } from '@issh/core';
import { useDialog } from './DialogProvider';

interface HostsManagerPaneProps {
  hosts: HostConfig[];
  onConnect: (host: HostConfig) => void;
  onNewHost: () => void;
  onEditHost: (host: HostConfig) => void;
  onDuplicateHost: (host: HostConfig) => void;
  onDeleteHost: (id: string) => void;
}

export function HostsManagerPane({
  hosts,
  onConnect,
  onNewHost,
  onEditHost,
  onDuplicateHost,
  onDeleteHost,
}: HostsManagerPaneProps) {
  const { confirm } = useDialog();
  const [query, setQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('__ALL__');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of hosts) {
      const g = h.group?.trim() || '未分组';
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [hosts]);

  const allTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of hosts) {
      for (const t of h.tags ?? []) {
        const clean = t.trim();
        if (clean) map.set(clean, (map.get(clean) ?? 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [hosts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hosts.filter((h) => {
      const g = h.group?.trim() || '未分组';
      if (selectedGroup !== '__ALL__' && g !== selectedGroup) return false;
      if (selectedTag && !(h.tags ?? []).includes(selectedTag)) return false;
      if (!q) return true;
      return (
        h.name.toLowerCase().includes(q) ||
        h.host.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q) ||
        g.toLowerCase().includes(q) ||
        (h.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [hosts, query, selectedGroup, selectedTag]);

  return (
    <div className="flex h-full bg-[#090d14] text-xs text-slate-200">
      {/* Left: Groups & Tags Filter */}
      <div className="flex w-52 shrink-0 flex-col gap-4 border-r border-white/10 bg-[#0c111b] p-3">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
            <span>主机分组</span>
          </div>
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => setSelectedGroup('__ALL__')}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition ${
                selectedGroup === '__ALL__'
                  ? 'bg-sky-500/20 font-medium text-sky-300'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <span>全部主机</span>
              <span className="text-[10px] text-slate-400">{hosts.length}</span>
            </button>
            {groups.map(([g, count]) => (
              <button
                key={g}
                type="button"
                onClick={() => setSelectedGroup(g)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition ${
                  selectedGroup === g
                    ? 'bg-sky-500/20 font-medium text-sky-300'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <span className="truncate">{g}</span>
                <span className="text-[10px] text-slate-400">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {allTags.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <Tag className="h-3.5 w-3.5 text-violet-400" />
              <span>标签筛选</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map(([tag, count]) => {
                const active = selectedTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(active ? null : tag)}
                    className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                      active
                        ? 'border-violet-400/50 bg-violet-500/25 text-violet-200'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20'
                    }`}
                  >
                    #{tag} <span className="opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right: Search + Host Cards */}
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索主机名称、IP、分组或标签..."
              className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-sky-500"
            />
          </div>

          <button
            type="button"
            onClick={onNewHost}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 font-medium text-white transition hover:bg-sky-400"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建主机</span>
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 text-slate-500">
            <Server className="h-8 w-8 opacity-40" />
            <p>{hosts.length === 0 ? '还没有保存的主机，点击右上角「新建主机」添加' : '没有匹配的主机'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] content-start gap-3 overflow-y-auto">
            {filtered.map((h) => (
              <div
                key={h.id}
                onDoubleClick={() => onConnect(h)}
                className="group flex flex-col justify-between rounded-xl border border-white/10 bg-[#0e1420] p-3.5 transition hover:border-sky-500/40 hover:bg-[#111827]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
                        <Server className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-white">
                          {h.name}
                        </div>
                        <div className="truncate font-mono text-[11px] text-slate-400">
                          {h.username}@{h.host}:{h.port}
                        </div>
                      </div>
                    </div>

                    <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {h.group?.trim() || '未分组'}
                    </span>
                  </div>

                  {/* Tags */}
                  {(h.tags?.length ?? 0) > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {h.tags!.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-2.5">
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-slate-500">
                    {h.auth.type === 'password' ? (
                      <>
                        <Lock className="h-3 w-3 shrink-0" /> 密码
                      </>
                    ) : (
                      <>
                        <KeyRound className="h-3 w-3 shrink-0" /> 私钥
                      </>
                    )}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEditHost(h)}
                      className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                      title="编辑"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicateHost(h)}
                      className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                      title="复制配置"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void confirm({
                          title: '删除主机',
                          message: `确定删除主机「${h.name}」吗？`,
                          confirmText: '删除',
                          danger: true,
                        }).then((ok) => {
                          if (ok) onDeleteHost(h.id);
                        });
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-rose-400"
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onConnect(h)}
                      className="ml-1 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/30"
                    >
                      <Play className="h-3 w-3 shrink-0" />
                      连接
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
