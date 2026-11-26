import { useEffect, useState } from 'react';
import { Activity, Cpu, HardDrive, Network, Server } from 'lucide-react';
import type { SystemMetrics } from '@issh/core';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${mins}分`;
  return `${mins}分钟`;
}

interface NetSample {
  rx: number;
  tx: number;
}

interface MetricsSidebarProps {
  metrics: SystemMetrics | null;
  connected: boolean;
  fullWidth?: boolean;
  onOpenProcessManager?: () => void;
}

export function MetricsSidebar({
  metrics,
  connected,
  fullWidth = false,
  onOpenProcessManager,
}: MetricsSidebarProps) {
  const [selectedIface, setSelectedIface] = useState<string>('');
  const [netHistory, setNetHistory] = useState<NetSample[]>([]);

  const memPct =
    metrics && metrics.memory.totalBytes > 0
      ? (metrics.memory.usedBytes / metrics.memory.totalBytes) * 100
      : 0;
  const swapPct =
    metrics && metrics.memory.swapTotalBytes > 0
      ? (metrics.memory.swapUsedBytes / metrics.memory.swapTotalBytes) * 100
      : 0;

  // Pick a sensible default network interface (eth0/ens*/enp* or first non-lo)
  useEffect(() => {
    if (!metrics || metrics.network.length === 0) return;
    const exists = metrics.network.some((n) => n.interfaceName === selectedIface);
    if (!exists) {
      const preferred =
        metrics.network.find((n) => /^(eth|ens|enp|wlan)/.test(n.interfaceName)) ??
        metrics.network.find((n) => n.interfaceName !== 'lo') ??
        metrics.network[0];
      setSelectedIface(preferred.interfaceName);
      setNetHistory([]);
    }
  }, [metrics, selectedIface]);

  // Append selected interface traffic sample for sparkline
  useEffect(() => {
    if (!metrics || !selectedIface) return;
    const current = metrics.network.find((n) => n.interfaceName === selectedIface);
    if (!current) return;
    setNetHistory((prev) => [
      ...prev.slice(-29),
      { rx: current.rxBytesPerSec, tx: current.txBytesPerSec },
    ]);
  }, [metrics?.timestamp, selectedIface]);

  const activeNet = metrics?.network.find((n) => n.interfaceName === selectedIface) ?? null;
  const maxRate = Math.max(
    1024,
    ...netHistory.map((s) => Math.max(s.rx, s.tx))
  );

  return (
    <aside
      className={`flex shrink-0 flex-col gap-3 overflow-y-auto bg-[#0e1420]/95 p-3 text-xs ${
        fullWidth ? 'h-full w-full' : 'w-64 border-r border-white/10'
      }`}
    >
      {/* Host Info */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold text-slate-200">
            <Server className="h-3.5 w-3.5 text-sky-400" />
            {metrics?.hostname ?? (connected ? '采集中...' : '未连接')}
          </span>
          {metrics && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
              {formatUptime(metrics.uptimeSeconds)}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-[11px] text-slate-400">
          {metrics?.osName ?? '连接 SSH 后自动零侵入采集'}
        </div>
      </div>

      {/* CPU & Memory */}
      <div className="space-y-2.5 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-sky-400" />
            性能概览
          </span>
          {metrics && (
            <span className="font-mono text-[10px] text-slate-400">
              {metrics.cpu.cores} 核
            </span>
          )}
        </div>

        <div>
          <div className="mb-1 flex justify-between text-slate-300">
            <span>CPU</span>
            <span className="font-mono">
              {metrics ? `${metrics.cpu.usagePercent.toFixed(1)}%` : '-- %'}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-sky-400 transition-all duration-300"
              style={{ width: `${Math.min(metrics?.cpu.usagePercent ?? 0, 100)}%` }}
            />
          </div>
          {metrics && (
            <div className="mt-1 text-[10px] text-slate-500">
              负载: {metrics.cpu.loadAvg.map((v) => v.toFixed(2)).join(', ')}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 flex justify-between text-slate-300">
            <span>内存</span>
            <span className="font-mono text-[11px]">
              {metrics
                ? `${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`
                : '--'}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-300"
              style={{ width: `${Math.min(memPct, 100)}%` }}
            />
          </div>
        </div>

        {metrics && metrics.memory.swapTotalBytes > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-slate-400">
              <span>Swap</span>
              <span className="font-mono text-[11px]">
                {formatBytes(metrics.memory.swapUsedBytes)} /{' '}
                {formatBytes(metrics.memory.swapTotalBytes)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-amber-400 transition-all duration-300"
                style={{ width: `${Math.min(swapPct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Network with Interface Dropdown + Sparkline */}
      {metrics && metrics.network.length > 0 && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <Network className="h-3.5 w-3.5 text-violet-400" />
              网络
            </span>
            <select
              value={selectedIface}
              onChange={(e) => {
                setSelectedIface(e.target.value);
                setNetHistory([]);
              }}
              className="max-w-[130px] truncate rounded border border-white/10 bg-[#0b0f17] px-1.5 py-0.5 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
            >
              {metrics.network.map((net) => (
                <option key={net.interfaceName} value={net.interfaceName}>
                  {net.interfaceName}
                </option>
              ))}
            </select>
          </div>

          {activeNet && (
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="text-emerald-300">
                ↓ {formatBytes(activeNet.rxBytesPerSec)}/s
              </span>
              <span className="text-amber-300">
                ↑ {formatBytes(activeNet.txBytesPerSec)}/s
              </span>
            </div>
          )}

          <div className="flex h-10 items-end gap-[2px] rounded bg-[#090d14]/70 px-1 py-1">
            {Array.from({ length: 30 }).map((_, idx) => {
              const sample = netHistory[netHistory.length - 30 + idx];
              const rxH = sample ? Math.max(2, (sample.rx / maxRate) * 32) : 2;
              const txH = sample ? Math.max(2, (sample.tx / maxRate) * 32) : 2;
              return (
                <div key={idx} className="flex flex-1 items-end gap-[1px]">
                  <div
                    className="w-1/2 rounded-t-[1px] bg-emerald-400/75"
                    style={{ height: `${rxH}px` }}
                  />
                  <div
                    className="w-1/2 rounded-t-[1px] bg-amber-400/75"
                    style={{ height: `${txH}px` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Processes (Click to open full Process Manager) */}
      {metrics && metrics.topProcesses.length > 0 && (
        <button
          type="button"
          onClick={onOpenProcessManager}
          className="w-full space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-left transition hover:border-sky-500/40 hover:bg-white/[0.06]"
          title="点击打开完整进程管理界面"
        >
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-rose-400" />
              Top 进程
            </span>
            <span className="text-[10px] font-normal normal-case text-sky-400">
              管理 &gt;
            </span>
          </div>
          <div className="space-y-1">
            {metrics.topProcesses.slice(0, 5).map((p) => (
              <div
                key={p.pid}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="truncate font-mono text-slate-300">{p.command}</span>
                <span className="shrink-0 font-mono text-sky-300">
                  {p.cpuPercent.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </button>
      )}

      {/* Disks */}
      <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <HardDrive className="h-3.5 w-3.5 text-indigo-400" />
          <span>磁盘挂载</span>
        </div>
        {!metrics ? (
          <div className="text-[11px] text-slate-500">暂无挂载数据</div>
        ) : (
          <div className="space-y-2">
            {metrics.disks.slice(0, 6).map((d) => (
              <div key={d.mountPoint}>
                <div className="mb-0.5 flex justify-between text-[11px]">
                  <span className="truncate font-mono text-slate-300" title={d.mountPoint}>
                    {d.mountPoint}
                  </span>
                  <span className="shrink-0 font-mono text-slate-400">
                    {formatBytes(d.usedBytes)} / {formatBytes(d.totalBytes)}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-indigo-400"
                    style={{ width: `${Math.min(d.usePercent, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
