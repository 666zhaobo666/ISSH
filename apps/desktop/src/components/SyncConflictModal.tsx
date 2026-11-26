import { CloudDownload, CloudUpload, GitMerge, X } from 'lucide-react';
import type { IsshUserProfileBundle } from '../ai/profileBundle';

export type ConflictStrategy = 'cloud' | 'local' | 'merge';

interface SyncConflictModalProps {
  open: boolean;
  localProfile: IsshUserProfileBundle;
  cloudProfile: IsshUserProfileBundle;
  localThreadsCount: number;
  cloudThreadsCount: number;
  busy?: boolean;
  onResolve: (strategy: ConflictStrategy) => void;
  onCancel: () => void;
}

export function SyncConflictModal({
  open,
  localProfile,
  cloudProfile,
  localThreadsCount,
  cloudThreadsCount,
  busy = false,
  onResolve,
  onCancel,
}: SyncConflictModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-[#0e1420] text-xs text-slate-200 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-white">检测到云端与本地数据存在差异</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              请选择本次同步的恢复策略，之后将自动开启无感心跳同步
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Comparison Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3">
              <div className="mb-1.5 font-semibold text-sky-300">云端数据</div>
              <ul className="space-y-1 text-[11px] text-slate-300">
                <li>主机连接：{cloudProfile.hosts?.length ?? 0} 台</li>
                <li>AI 服务商：{cloudProfile.aiSettings?.providers?.length ?? 0} 个</li>
                <li>自定义 Skills：{cloudProfile.aiSettings?.skills?.length ?? 0} 个</li>
                <li>AI 对话记录：{cloudThreadsCount} 条</li>
              </ul>
            </div>
            <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3">
              <div className="mb-1.5 font-semibold text-violet-300">当前本地数据</div>
              <ul className="space-y-1 text-[11px] text-slate-300">
                <li>主机连接：{localProfile.hosts?.length ?? 0} 台</li>
                <li>AI 服务商：{localProfile.aiSettings?.providers?.length ?? 0} 个</li>
                <li>自定义 Skills：{localProfile.aiSettings?.skills?.length ?? 0} 个</li>
                <li>AI 对话记录：{localThreadsCount} 条</li>
              </ul>
            </div>
          </div>

          {/* 3 Choices */}
          <div className="space-y-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve('merge')}
              className="flex w-full items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-left transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <GitMerge className="h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <div className="font-semibold text-emerald-200">
                  智能合并（推荐）
                </div>
                <div className="text-[11px] text-slate-400">
                  保留两端全部主机、服务商、Skills 与 AI 对话，同名项按最新修改时间自动合并
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve('cloud')}
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-sky-500/40 hover:bg-sky-500/10 disabled:opacity-50"
            >
              <CloudDownload className="h-5 w-5 shrink-0 text-sky-400" />
              <div>
                <div className="font-semibold text-white">以云端为准（覆盖本地）</div>
                <div className="text-[11px] text-slate-400">
                  完全使用云端备份替换当前本地配置与对话
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve('local')}
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-violet-500/40 hover:bg-violet-500/10 disabled:opacity-50"
            >
              <CloudUpload className="h-5 w-5 shrink-0 text-violet-400" />
              <div>
                <div className="font-semibold text-white">以本地为准（覆盖云端）</div>
                <div className="text-[11px] text-slate-400">
                  将当前本地全部配置与对话上传覆盖云端
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
