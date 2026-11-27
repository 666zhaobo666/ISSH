import { useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  Skull,
} from 'lucide-react';
import type { SystemMetrics } from '@issh/core';
import type { AppSshTransport } from '../transport';
import { useDialog } from '../components/DialogProvider';

interface MobileMonitorViewProps {
  metrics: SystemMetrics | null;
  connected: boolean;
  sessionId: string | null;
  isTablet: boolean;
  transport: AppSshTransport;
}

function fmtBytes(b: number): string {
  if (b <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天 ${h}时`;
  if (h > 0) return `${h}时 ${m}分`;
  return `${m}分钟`;
}

export function MobileMonitorView({
  metrics,
  connected,
  sessionId,
  isTablet,
  transport,
}: MobileMonitorViewProps) {
  const dialog = useDialog();
  const [iface, setIface] = useState('');

  useEffect(() => {
    if (!metrics || metrics.network.length === 0) return;
    if (!metrics.network.some((n) => n.interfaceName === iface)) {
      const pref =
        metrics.network.find((n) => /^(eth|ens|enp|wlan)/.test(n.interfaceName)) ??
        metrics.network[0];
      setIface(pref.interfaceName);
    }
  }, [metrics, iface]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b0f17] p-6 text-center text-sm text-slate-400">
        请先在「主机」页连接一台 Linux 服务器以查看实时性能监控
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b0f17] text-sm text-slate-400">
        正在采集服务器性能数据...
      </div>
    );
  }

  const memPct =
    metrics.memory.totalBytes > 0
      ? (metrics.memory.usedBytes / metrics.memory.totalBytes) * 100
      : 0;
  const swapPct =
    metrics.memory.swapTotalBytes > 0
      ? (metrics.memory.swapUsedBytes / metrics.memory.swapTotalBytes) * 100
      : 0;
  const activeNet =
    metrics.network.find((n) => n.interfaceName === iface) ?? metrics.network[0];

  const handleKill = async (pid: number, cmd: string) => {
    if (!sessionId) return;
    const ok = await dialog.confirm({
      title: `终止进程 PID ${pid}`,
      message: `确定发送 SIGKILL 终止进程？\n${cmd}`,
      danger: true,
      confirmText: '强制终止',
    });
    if (!ok) return;
    await transport.exec(sessionId, `kill -9 ${pid}`);
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0b0f17] p-4 pb-20 text-slate-100">
      {/* Host Header Card */}
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-[#111827] p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Server className="h-4 w-4 text-sky-400" />
            <span className="truncate">{metrics.hostname}</span>
          </div>
          <div className="mt-1 truncate text-xs text-slate-400">{metrics.osName}</div>
        </div>
        <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
          已运行 {fmtUptime(metrics.uptimeSeconds)}
        </span>
      </div>

      {/* Responsive Metric Cards Grid */}
      <div className={`grid gap-3.5 ${isTablet ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {/* CPU Card */}
        <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Cpu className="h-4 w-4 text-sky-400" /> CPU ({metrics.cpu.cores} 核)
            </span>
            <span className="font-mono text-xl font-bold text-sky-300">
              {metrics.cpu.usagePercent.toFixed(1)}%
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all"
              style={{ width: `${Math.min(100, metrics.cpu.usagePercent)}%` }}
            />
          </div>
          <div className="font-mono text-xs text-slate-400">
            Load Avg: {metrics.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ')}
          </div>
        </div>

        {/* Memory & Swap Card */}
        <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <MemoryStick className="h-4 w-4 text-violet-400" /> 内存
            </span>
            <span className="font-mono text-xl font-bold text-violet-300">
              {memPct.toFixed(1)}%
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all"
              style={{ width: `${Math.min(100, memPct)}%` }}
            />
          </div>
          <div className="flex items-center justify-between font-mono text-xs text-slate-400">
            <span>
              {fmtBytes(metrics.memory.usedBytes)} / {fmtBytes(metrics.memory.totalBytes)}
            </span>
            {metrics.memory.swapTotalBytes > 0 && (
              <span>Swap {swapPct.toFixed(0)}%</span>
            )}
          </div>
        </div>

        {/* Network Card */}
        <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Network className="h-4 w-4 text-emerald-400" /> 实时网络
            </span>
            {metrics.network.length > 0 && (
              <select
                value={iface}
                onChange={(e) => setIface(e.target.value)}
                className="h-8 rounded-lg border border-white/10 bg-[#090d14] px-2 font-mono text-xs text-slate-200 outline-none"
              >
                {metrics.network.map((n) => (
                  <option key={n.interfaceName} value={n.interfaceName}>
                    {n.interfaceName}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 font-mono">
            <div className="rounded-xl bg-white/[0.03] p-3">
              <div className="text-[11px] text-slate-400">↓ 下行速率</div>
              <div className="mt-1 text-base font-bold text-emerald-300">
                {fmtBytes(activeNet?.rxBytesPerSec ?? 0)}/s
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3">
              <div className="text-[11px] text-slate-400">↑ 上行速率</div>
              <div className="mt-1 text-base font-bold text-sky-300">
                {fmtBytes(activeNet?.txBytesPerSec ?? 0)}/s
              </div>
            </div>
          </div>
        </div>

        {/* Disk Mounts Card */}
        <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <HardDrive className="h-4 w-4 text-amber-400" /> 磁盘挂载
          </div>
          <div className="space-y-2.5">
            {metrics.disks.slice(0, 5).map((d) => (
              <div key={d.mountPoint} className="space-y-1">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="truncate text-slate-200">{d.mountPoint}</span>
                  <span className="text-slate-400">
                    {fmtBytes(d.usedBytes)} / {fmtBytes(d.totalBytes)} ({d.usePercent.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${
                      d.usePercent > 85 ? 'bg-rose-400' : 'bg-amber-400'
                    }`}
                    style={{ width: `${Math.min(100, d.usePercent)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Processes Touch List */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-[#111827] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Activity className="h-4 w-4 text-rose-400" /> Top 进程（点击右侧可结束）
        </div>
        <div className="divide-y divide-white/5">
          {metrics.topProcesses.map((p) => (
            <div
              key={p.pid}
              className="flex min-h-[52px] items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-xs font-medium text-slate-100">
                  {p.command}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                  PID {p.pid} · {p.user} · CPU {p.cpuPercent.toFixed(1)}% · 内存{' '}
                  {fmtBytes(p.memBytes)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleKill(p.pid, p.command)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 active:bg-rose-500/25"
                title="终止进程"
              >
                <Skull className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
