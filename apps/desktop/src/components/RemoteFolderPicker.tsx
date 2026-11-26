import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, RefreshCw } from 'lucide-react';
import type { SftpEntry } from '@issh/core';
import type { AppSshTransport } from '../transport';
import { FolderIcon } from './FileIcons';

interface RemoteFolderPickerProps {
  sessionId: string;
  initialPath: string;
  transport: AppSshTransport;
  cache: Map<string, SftpEntry[]>;
  onSelectPath: (path: string) => void;
}

export function RemoteFolderPicker({
  sessionId,
  initialPath,
  transport,
  cache,
  onSelectPath,
}: RemoteFolderPickerProps) {
  const [browsePath, setBrowsePath] = useState(
    initialPath.startsWith('/') ? initialPath : '/'
  );
  const [dirs, setDirs] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const onSelectPathRef = useRef(onSelectPath);
  onSelectPathRef.current = onSelectPath;

  const load = useCallback(
    async (path: string, force = false) => {
      const target = path.startsWith('/') ? path : '/';
      if (!force && cache.has(target)) {
        const list = cache.get(target)!;
        setBrowsePath(target);
        setDirs(list.filter((e) => e.type === 'directory' || e.type === 'symlink'));
        onSelectPathRef.current(target);
        return;
      }
      setLoading(true);
      try {
        const list = await transport.sftpList(sessionId, target);
        cache.set(target, list);
        setBrowsePath(target);
        setDirs(list.filter((e) => e.type === 'directory' || e.type === 'symlink'));
        onSelectPathRef.current(target);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, transport, cache]
  );

  useEffect(() => {
    void load(initialPath.startsWith('/') ? initialPath : '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  const goUp = () => {
    if (browsePath === '/') return;
    const parent = browsePath.replace(/\/[^/]+\/?$/, '') || '/';
    void load(parent);
  };

  return (
    <div className="mt-2 flex flex-col overflow-hidden rounded-lg border border-white/15 bg-[#090d14]">
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#101622] px-2 py-1.5 text-[11px]">
        <button
          type="button"
          onClick={goUp}
          disabled={browsePath === '/'}
          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
          title="上级目录"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-sky-300">
          {browsePath}
        </span>
        <button
          type="button"
          onClick={() => void load(browsePath, true)}
          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          title="刷新"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="h-44 overflow-y-auto p-1">
        {loading && dirs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
            加载中...
          </div>
        ) : dirs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
            无子目录（当前路径已选中）
          </div>
        ) : (
          dirs.map((d) => (
            <button
              key={d.path}
              type="button"
              onClick={() => void load(d.path)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-[11px] text-slate-200 hover:bg-sky-500/15 hover:text-white"
            >
              <FolderIcon
                symlink={d.type === 'symlink'}
                dimmed={!cache.has(d.path)}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="truncate">{d.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
