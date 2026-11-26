import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Copy,
  RefreshCw,
  Search,
  Skull,
  Terminal,
} from 'lucide-react';
import type { ISshTransport } from '@issh/core';
import { useDialog } from './DialogProvider';

interface ProcessItem {
  pid: number;
  user: string;
  memBytes: number;
  cpuPercent: number;
  name: string;
  exe: string;
  cmdline: string;
}

interface ProcessDetail {
  pid: number;
  name: string;
  exe: string;
  cwd: string;
  cmdline: string;
  env: Array<{ key: string; value: string }>;
}

type SortKey = 'pid' | 'user' | 'mem' | 'cpu' | 'name' | 'cmdline' | 'exe';

interface ColumnDef {
  key: SortKey;
  label: string;
  defaultPct: number;
}

const COLUMNS: ColumnDef[] = [
  { key: 'pid', label: 'PID', defaultPct: 9 },
  { key: 'user', label: '用户', defaultPct: 10 },
  { key: 'mem', label: '内存', defaultPct: 11 },
  { key: 'cpu', label: 'CPU %', defaultPct: 9 },
  { key: 'name', label: '名称', defaultPct: 15 },
  { key: 'cmdline', label: '命令行', defaultPct: 27 },
  { key: 'exe', label: '位置', defaultPct: 19 },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

interface ProcessManagerPaneProps {
  sessionId: string;
  transport: ISshTransport;
}

export function ProcessManagerPane({
  sessionId,
  transport,
}: ProcessManagerPaneProps) {
  const { confirm } = useDialog();
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('cpu');
  const [sortAsc, setSortAsc] = useState(false);
  const [colPcts, setColPcts] = useState<Record<SortKey, number>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultPct])) as Record<
      SortKey,
      number
    >
  );
  const tableRef = useRef<HTMLTableElement>(null);
  const resizingRef = useRef<{
    key: SortKey;
    startX: number;
    startPct: number;
    tableWidth: number;
  } | null>(null);

  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    proc: ProcessItem;
  } | null>(null);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const [psRes, exeRes] = await Promise.all([
        transport.exec(
          sessionId,
          'ps -eo pid=,user=,rss=,%cpu=,comm=,args= --sort=-%cpu 2>/dev/null | head -n 250',
          { timeoutMs: 8000 }
        ),
        transport.exec(
          sessionId,
          'find /proc/[0-9]* -maxdepth 1 -name exe -printf "%h|%l\\n" 2>/dev/null',
          { timeoutMs: 8000 }
        ),
      ]);

      const exeMap = new Map<number, string>();
      for (const line of exeRes.stdout.split('\n')) {
        const sepIdx = line.indexOf('|');
        if (sepIdx > 0) {
          const pidStr = line.slice(0, sepIdx).replace('/proc/', '').trim();
          const pidNum = Number(pidStr);
          const exePath = line.slice(sepIdx + 1).trim();
          if (pidNum && exePath) {
            exeMap.set(pidNum, exePath);
          }
        }
      }

      const items: ProcessItem[] = [];
      for (const rawLine of psRes.stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const m = line.match(
          /^(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s*(.*)$/
        );
        if (!m) continue;
        const pid = Number(m[1]);
        const name = m[5];
        const cmdline = m[6] || name;
        // Skip our own transient `ps` sampling process
        if (name === 'ps' && cmdline.includes('pid=,user=')) continue;
        items.push({
          pid,
          user: m[2],
          memBytes: Number(m[3]) * 1024,
          cpuPercent: Number(m[4]),
          name,
          exe: exeMap.get(pid) ?? '',
          cmdline,
        });
      }
      setProcesses(items);
    } finally {
      setLoading(false);
    }
  }, [sessionId, transport]);

  const fetchDetail = useCallback(
    async (proc: ProcessItem) => {
      setSelectedPid(proc.pid);
      const cmd = `
echo "===CWD==="; readlink -f /proc/${proc.pid}/cwd 2>/dev/null
echo "===EXE==="; readlink /proc/${proc.pid}/exe 2>/dev/null
echo "===CMD==="; tr '\\0' ' ' < /proc/${proc.pid}/cmdline 2>/dev/null; echo ""
echo "===ENV==="; tr '\\0' '\\n' < /proc/${proc.pid}/environ 2>/dev/null
`;
      const res = await transport.exec(sessionId, cmd, { timeoutMs: 5000 });
      const out = res.stdout;
      const extract = (tag: string, nextTag?: string) => {
        const start = out.indexOf(`===${tag}===`);
        if (start === -1) return '';
        const after = out.slice(start + tag.length + 6);
        const end = nextTag ? after.indexOf(`===${nextTag}===`) : after.length;
        return (end === -1 ? after : after.slice(0, end)).trim();
      };

      const cwd = extract('CWD', 'EXE');
      const exe = extract('EXE', 'CMD') || proc.exe;
      const cmdline = extract('CMD', 'ENV') || proc.cmdline;
      const envRaw = extract('ENV');
      const env = envRaw
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const idx = l.indexOf('=');
          return idx === -1
            ? { key: l, value: '' }
            : { key: l.slice(0, idx), value: l.slice(idx + 1) };
        });

      setDetail({
        pid: proc.pid,
        name: proc.name,
        exe,
        cwd,
        cmdline,
        env,
      });
    },
    [sessionId, transport]
  );

  useEffect(() => {
    void fetchProcesses();
    const timer = setInterval(() => void fetchProcesses(), 3000);
    return () => clearInterval(timer);
  }, [fetchProcesses]);

  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const r = resizingRef.current;
      if (!r || r.tableWidth <= 0) return;
      const deltaPct = ((e.clientX - r.startX) / r.tableWidth) * 100;
      const nextPct = Math.max(5, Math.min(60, r.startPct + deltaPct));
      setColPcts((prev) => ({ ...prev, [r.key]: nextPct }));
    };
    const onMouseUp = () => {
      resizingRef.current = null;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = (key: SortKey, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizingRef.current = {
      key,
      startX: e.clientX,
      startPct: colPcts[key],
      tableWidth: tableRef.current?.clientWidth ?? 700,
    };
    document.body.style.cursor = 'col-resize';
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((a) => !a);
    } else {
      setSortKey(key);
      setSortAsc(key !== 'cpu' && key !== 'mem');
    }
  };

  const handleKill = async (proc: ProcessItem, signal: 15 | 9) => {
    const label = signal === 9 ? '强制终止 (SIGKILL)' : '终止 (SIGTERM)';
    const ok = await confirm({
      title: '终止进程',
      message: `确定要${label}进程 ${proc.name} (PID ${proc.pid}) 吗？`,
      confirmText: '终止',
      danger: true,
    });
    if (!ok) return;
    await transport.exec(sessionId, `kill -${signal} ${proc.pid}`);
    void fetchProcesses();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? processes.filter(
          (p) =>
            String(p.pid).includes(q) ||
            p.user.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            p.cmdline.toLowerCase().includes(q) ||
            p.exe.toLowerCase().includes(q)
        )
      : [...processes];

    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'cpu') cmp = a.cpuPercent - b.cpuPercent;
      else if (sortKey === 'mem') cmp = a.memBytes - b.memBytes;
      else if (sortKey === 'pid') cmp = a.pid - b.pid;
      else if (sortKey === 'user') cmp = a.user.localeCompare(b.user);
      else if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'cmdline') cmp = a.cmdline.localeCompare(b.cmdline);
      else cmp = a.exe.localeCompare(b.exe);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [processes, query, sortKey, sortAsc]);

  return (
    <div className="relative flex h-full flex-col bg-[#090d14] text-xs text-slate-200">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0e1420] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="筛选 PID / 用户 / 名称 / 命令行..."
              className="w-full rounded-md border border-white/10 bg-white/5 py-1 pl-8 pr-2.5 text-xs text-slate-200 outline-none focus:border-sky-500"
            />
          </div>
          <span className="text-[11px] text-slate-400">
            共 {filtered.length} 个进程
          </span>
        </div>

        <button
          type="button"
          onClick={() => void fetchProcesses()}
          className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300 hover:bg-white/10"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新</span>
        </button>
      </div>

      {/* Process Table (Fixed percentage layout, always fits viewport cleanly) */}
      <div className="min-h-0 flex-[3] overflow-y-auto overflow-x-hidden">
        <table
          ref={tableRef}
          className="w-full table-fixed border-collapse text-left font-mono text-[11px]"
        >
          <thead className="sticky top-0 z-10 select-none bg-[#101622] text-slate-400">
            <tr className="border-b border-white/10">
              {COLUMNS.map((col, idx) => {
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    style={{ width: `${colPcts[col.key]}%` }}
                    onClick={() => handleSort(col.key)}
                    className={`relative cursor-pointer px-3 py-2 transition hover:text-white ${
                      idx < COLUMNS.length - 1 ? 'border-r border-white/15' : ''
                    } ${isSorted ? 'text-sky-300' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1 truncate">
                      {col.label}
                      {isSorted ? (
                        sortAsc ? (
                          <ArrowUp className="h-3 w-3 shrink-0 text-sky-400" />
                        ) : (
                          <ArrowDown className="h-3 w-3 shrink-0 text-sky-400" />
                        )
                      ) : (
                        <ArrowDownUp className="h-3 w-3 shrink-0 opacity-35" />
                      )}
                    </span>
                    {/* Column Resize Handle */}
                    <span
                      onMouseDown={(e) => startResize(col.key, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-sky-400/50"
                      title="拖动调整列宽"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const selected = p.pid === selectedPid;
              return (
                <tr
                  key={p.pid}
                  onClick={() => void fetchDetail(p)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, proc: p });
                  }}
                  className={`cursor-pointer border-b border-white/5 transition ${
                    selected
                      ? 'bg-sky-500/20 text-white'
                      : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <td className="truncate px-3 py-1.5 text-slate-400">{p.pid}</td>
                  <td className="truncate px-3 py-1.5 text-slate-300">{p.user}</td>
                  <td className="truncate px-3 py-1.5 text-emerald-300">
                    {formatBytes(p.memBytes)}
                  </td>
                  <td className="truncate px-3 py-1.5 text-sky-300">
                    {p.cpuPercent.toFixed(1)}
                  </td>
                  <td className="truncate px-3 py-1.5 font-semibold text-slate-200">
                    {p.name}
                  </td>
                  <td
                    className="truncate px-3 py-1.5 text-slate-400"
                    title={p.cmdline}
                  >
                    {p.cmdline}
                  </td>
                  <td
                    className="truncate px-3 py-1.5 text-slate-500"
                    title={p.exe}
                  >
                    {p.exe || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom Detail + Environment Variables */}
      <div className="flex min-h-0 flex-[2] border-t border-white/10 bg-[#0d121c]">
        {detail ? (
          <>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto border-r border-white/10 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-sky-300">
                    PID {detail.pid}
                  </span>
                  <span className="font-semibold text-white">{detail.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void handleKill(
                      {
                        pid: detail.pid,
                        name: detail.name,
                        user: '',
                        memBytes: 0,
                        cpuPercent: 0,
                        exe: detail.exe,
                        cmdline: detail.cmdline,
                      },
                      9
                    )
                  }
                  className="flex items-center gap-1 rounded bg-rose-500/20 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/30"
                >
                  <Skull className="h-3.5 w-3.5" />
                  终止进程
                </button>
              </div>

              <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-slate-400">位置</span>
                  <span className="break-all font-mono text-slate-200">
                    {detail.exe || '-'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-slate-400">工作目录</span>
                  <span className="break-all font-mono text-slate-200">
                    {detail.cwd || '-'}
                  </span>
                </div>
              </div>

              <div className="mt-1 flex-1 rounded-md border border-white/10 bg-[#090d14] p-2 font-mono text-[11px] text-slate-300">
                <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-500">
                  <Terminal className="h-3 w-3" /> 完整命令行
                </div>
                <div className="break-all">{detail.cmdline}</div>
              </div>
            </div>

            <div className="flex w-80 shrink-0 flex-col overflow-hidden">
              <div className="border-b border-white/10 bg-[#101622] px-3 py-1.5 text-[11px] font-semibold text-slate-300">
                环境变量 ({detail.env.length})
              </div>
              <div className="flex-1 overflow-y-auto font-mono text-[11px]">
                {detail.env.length === 0 ? (
                  <div className="p-3 text-slate-500">无权限或无环境变量</div>
                ) : (
                  detail.env.map((item, idx) => (
                    <div
                      key={`${item.key}-${idx}`}
                      className="flex border-b border-white/5 px-2.5 py-1"
                    >
                      <span className="w-28 shrink-0 truncate text-cyan-300" title={item.key}>
                        {item.key}
                      </span>
                      <span className="truncate text-slate-300" title={item.value}>
                        {item.value}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            点击上方任意进程查看位置、工作目录、完整命令行与环境变量；右键可终止或复制
          </div>
        )}
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <div
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          className="fixed z-50 w-44 rounded-lg border border-white/15 bg-[#111827] py-1 text-xs shadow-2xl"
        >
          <button
            type="button"
            onClick={() => void handleKill(ctxMenu.proc, 15)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-300 hover:bg-white/10"
          >
            <Skull className="h-3.5 w-3.5" />
            终止进程 (SIGTERM)
          </button>
          <button
            type="button"
            onClick={() => void handleKill(ctxMenu.proc, 9)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-400 hover:bg-white/10"
          >
            <Skull className="h-3.5 w-3.5" />
            强制终止 (SIGKILL)
          </button>
          <div className="my-1 border-t border-white/10" />
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(String(ctxMenu.proc.pid))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-white/10"
          >
            <Copy className="h-3.5 w-3.5 text-slate-400" />
            复制 PID
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(ctxMenu.proc.name)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-white/10"
          >
            <Copy className="h-3.5 w-3.5 text-slate-400" />
            复制名称
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(ctxMenu.proc.cmdline)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-white/10"
          >
            <Copy className="h-3.5 w-3.5 text-slate-400" />
            复制命令行
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(ctxMenu.proc.exe)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-white/10"
          >
            <Copy className="h-3.5 w-3.5 text-slate-400" />
            复制位置
          </button>
        </div>
      )}
    </div>
  );
}
