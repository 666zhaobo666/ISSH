import { useMemo, useState } from 'react';
import {
  Copy,
  Edit3,
  MoreVertical,
  Play,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import type { HostConfig } from '@issh/core';
import { useDialog } from '../components/DialogProvider';
import { HostBadgeIcon } from '../components/HostBadges';

interface MobileHostsViewProps {
  hosts: HostConfig[];
  isTablet: boolean;
  onConnect: (host: HostConfig) => void;
  onNewHost: () => void;
  onEditHost: (host: HostConfig) => void;
  onDuplicateHost: (host: HostConfig) => void;
  onDeleteHost: (id: string) => void;
}

export function MobileHostsView({
  hosts,
  isTablet,
  onConnect,
  onNewHost,
  onEditHost,
  onDuplicateHost,
  onDeleteHost,
}: MobileHostsViewProps) {
  const dialog = useDialog();
  const [query, setQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [sheetHost, setSheetHost] = useState<HostConfig | null>(null);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts) {
      if (h.group?.trim()) set.add(h.group.trim());
    }
    return Array.from(set).sort();
  }, [hosts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hosts.filter((h) => {
      if (selectedGroup === 'UNGROUPED' && h.group?.trim()) return false;
      if (
        selectedGroup !== 'ALL' &&
        selectedGroup !== 'UNGROUPED' &&
        (h.group?.trim() ?? '') !== selectedGroup
      ) {
        return false;
      }
      if (!q) return true;
      return (
        h.name.toLowerCase().includes(q) ||
        h.host.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q) ||
        (h.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [hosts, query, selectedGroup]);

  return (
    <div className="relative flex h-full flex-col bg-[#0b0f17] text-slate-100">
      {/* Search + Group Pills */}
      <div className="shrink-0 space-y-3 border-b border-white/10 bg-[#0e1420] px-4 pb-3 pt-3">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索主机名称、IP 或标签..."
            className="h-11 w-full rounded-xl border border-white/10 bg-[#090d14] pl-10 pr-10 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 active:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          {[
            { id: 'ALL', label: `全部 (${hosts.length})` },
            ...groups.map((g) => ({ id: g, label: g })),
            ...(hosts.some((h) => !h.group?.trim())
              ? [{ id: 'UNGROUPED', label: '未分组' }]
              : []),
          ].map((g) => {
            const active = selectedGroup === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedGroup(g.id)}
                className={`h-9 shrink-0 rounded-full border px-3.5 text-xs font-medium transition active:scale-95 ${
                  active
                    ? 'border-sky-400/60 bg-sky-500/20 text-sky-300'
                    : 'border-white/10 bg-white/[0.04] text-slate-400'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Termius-Style Big Touch Cards */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-24">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-500">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-slate-400">
              <Server className="h-8 w-8" />
            </div>
            <p className="text-sm text-slate-400">
              {hosts.length === 0 ? '还没有添加任何服务器' : '没有匹配的主机'}
            </p>
            <button
              type="button"
              onClick={onNewHost}
              className="mt-1 flex h-11 items-center gap-2 rounded-xl bg-sky-500 px-5 text-sm font-medium text-white active:scale-95"
            >
              <Plus className="h-4 w-4" /> 添加第一台主机
            </button>
          </div>
        ) : (
          <div
            className={`grid gap-3 ${
              isTablet ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'
            }`}
          >
            {filtered.map((h) => (
              <div
                key={h.id}
                onClick={() => onConnect(h)}
                className="flex min-h-[76px] cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#111827] px-4 py-3.5 shadow-sm transition active:scale-[0.98] active:border-sky-500/50 active:bg-[#162033]"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <HostBadgeIcon host={h} size="lg" />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-white">
                      {h.name}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                      {h.username}@{h.host}:{h.port}
                    </div>
                    {h.tags && h.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {h.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSheetHost(h);
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 active:bg-white/10 active:text-white"
                  aria-label="更多操作"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Termius-style Floating Action Button (+) */}
      <button
        type="button"
        onClick={onNewHost}
        className="fixed bottom-20 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-xl shadow-sky-500/30 transition active:scale-90 md:bottom-6 md:right-6"
        aria-label="新建主机"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Bottom Action Sheet for Host Card */}
      {sheetHost && (
        <div
          onClick={() => setSheetHost(null)}
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-t-3xl border-t border-white/15 bg-[#101622] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-3 px-2">
              <div className="text-base font-semibold text-white">
                {sheetHost.name}
              </div>
              <div className="font-mono text-xs text-slate-400">
                {sheetHost.username}@{sheetHost.host}:{sheetHost.port}
              </div>
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  const target = sheetHost;
                  setSheetHost(null);
                  onConnect(target);
                }}
                className="flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-sm font-medium text-emerald-300 active:bg-white/10"
              >
                <Play className="h-4 w-4" /> 立即连接 SSH
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = sheetHost;
                  setSheetHost(null);
                  onEditHost(target);
                }}
                className="flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-sm text-slate-200 active:bg-white/10"
              >
                <Edit3 className="h-4 w-4 text-sky-400" /> 编辑主机配置
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = sheetHost;
                  setSheetHost(null);
                  onDuplicateHost(target);
                }}
                className="flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-sm text-slate-200 active:bg-white/10"
              >
                <Copy className="h-4 w-4 text-violet-400" /> 复制一份主机
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = sheetHost;
                  setSheetHost(null);
                  const ok = await dialog.confirm({
                    title: '删除主机',
                    message: `确定要删除主机「${target.name}」吗？`,
                    danger: true,
                    confirmText: '确认删除',
                  });
                  if (ok) onDeleteHost(target.id);
                }}
                className="flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-sm text-rose-400 active:bg-rose-500/15"
              >
                <Trash2 className="h-4 w-4" /> 删除主机
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
