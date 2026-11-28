import { useEffect, useState } from 'react';
import { Play, Plus, Search, Terminal, Trash2 } from 'lucide-react';
import {
  PROFILE_LOCAL_CHANGED_EVENT,
  SAVED_COMMANDS_UPDATED_EVENT,
} from '../cloud/syncEngine';

export interface SavedCommand {
  id: string;
  title: string;
  command: string;
  category: string;
}

const COMMANDS_STORAGE_KEY = 'issh.saved_commands.v1';

const DEFAULT_COMMANDS: SavedCommand[] = [
  {
    id: 'preset-docker-ps',
    title: 'Docker 运行中容器',
    command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"',
    category: 'Docker',
  },
  {
    id: 'preset-ports',
    title: '查看监听端口',
    command: 'ss -tulnp',
    category: '网络',
  },
  {
    id: 'preset-disk',
    title: '查看磁盘占用 (人类可读)',
    command: 'df -hT',
    category: '系统',
  },
  {
    id: 'preset-journal',
    title: '最近系统错误日志',
    command: 'journalctl -p err -n 30 --no-pager',
    category: '日志',
  },
];

function loadCommands(): SavedCommand[] {
  try {
    const raw = localStorage.getItem(COMMANDS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedCommand[]) : DEFAULT_COMMANDS;
  } catch {
    return DEFAULT_COMMANDS;
  }
}

interface SavedCommandsPaneProps {
  connected: boolean;
  onSendCommand: (command: string, execute: boolean) => void;
}

export function SavedCommandsPane({
  connected,
  onSendCommand,
}: SavedCommandsPaneProps) {
  const [commands, setCommands] = useState<SavedCommand[]>(loadCommands);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [commandText, setCommandText] = useState('');
  const [category, setCategory] = useState('常用');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const reload = () => setCommands(loadCommands());
    const onStorage = (e: StorageEvent) => {
      if (e.key === COMMANDS_STORAGE_KEY) reload();
    };
    window.addEventListener(SAVED_COMMANDS_UPDATED_EVENT, reload);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SAVED_COMMANDS_UPDATED_EVENT, reload);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const persist = (next: SavedCommand[]) => {
    setCommands(next);
    localStorage.setItem(COMMANDS_STORAGE_KEY, JSON.stringify(next));
    // Notify unified cloud sync engine for immediate push (300ms debounce)
    window.dispatchEvent(new CustomEvent(PROFILE_LOCAL_CHANGED_EVENT));
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !commandText.trim()) return;
    const item: SavedCommand = {
      id: crypto.randomUUID(),
      title: title.trim(),
      command: commandText.trim(),
      category: category.trim() || '常用',
    };
    persist([item, ...commands]);
    setTitle('');
    setCommandText('');
    setAdding(false);
  };

  const handleDelete = (id: string) => {
    persist(commands.filter((c) => c.id !== id));
  };

  const filtered = commands.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      c.command.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full flex-col bg-[#0d121c] p-2.5 text-xs">
      {/* Toolbar */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索命令名称、内容或分类..."
            className="w-full rounded-md border border-white/10 bg-white/5 py-1 pl-8 pr-2.5 text-xs text-slate-200 outline-none focus:border-sky-500"
          />
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded-md bg-sky-500/20 px-2.5 py-1 text-sky-300 transition hover:bg-sky-500/30"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{adding ? '取消' : '新增命令'}</span>
        </button>
      </div>

      {/* Add Form */}
      {adding && (
        <form
          onSubmit={handleAdd}
          className="mb-2 grid grid-cols-12 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2"
        >
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="名称 (如: 重启 Nginx)"
            className="col-span-3 rounded border border-white/10 bg-[#090d14] px-2 py-1 text-slate-200 outline-none focus:border-sky-500"
          />
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="分类"
            className="col-span-2 rounded border border-white/10 bg-[#090d14] px-2 py-1 text-slate-200 outline-none focus:border-sky-500"
          />
          <input
            required
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            placeholder="命令内容 (如: systemctl restart nginx)"
            className="col-span-6 rounded border border-white/10 bg-[#090d14] px-2 py-1 font-mono text-slate-200 outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            className="col-span-1 rounded bg-sky-500 py-1 font-medium text-white hover:bg-sky-400"
          >
            保存
          </button>
        </form>
      )}

      {/* Command Grid */}
      <div className="grid flex-1 grid-cols-1 gap-1.5 overflow-y-auto md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="group flex flex-col justify-between rounded-lg border border-white/10 bg-white/[0.02] p-2 transition hover:border-sky-500/30 hover:bg-white/[0.05]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {item.category}
                  </span>
                  <span className="truncate font-medium text-slate-200">
                    {item.title}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-slate-400" title={item.command}>
                  {item.command}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                className="hidden rounded p-1 text-slate-500 hover:text-rose-400 group-hover:block"
                title="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                disabled={!connected}
                onClick={() => onSendCommand(item.command, false)}
                className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-40"
                title="填入终端但不回车"
              >
                <Terminal className="h-3 w-3" />
                填入
              </button>
              <button
                type="button"
                disabled={!connected}
                onClick={() => onSendCommand(item.command, true)}
                className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                title="立即发送到终端执行"
              >
                <Play className="h-3 w-3" />
                执行
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
