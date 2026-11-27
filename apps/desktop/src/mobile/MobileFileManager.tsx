import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Download,
  Edit3,
  FolderPlus,
  Link2,
  MoreVertical,
  PenLine,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import type { SftpEntry, SftpReadResult } from '@issh/core';
import type { AppSshTransport } from '../transport';
import { FileEditorModal } from '../components/FileEditorModal';
import { FileTypeIcon, FolderIcon } from '../components/FileIcons';
import { useDialog } from '../components/DialogProvider';

interface MobileFileManagerProps {
  sessionId: string | null;
  terminalCwd: string;
  transport: AppSshTransport;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 1 ? 1 : 0)} ${units[i]}`;
}

function formatPerm(mode: number): string {
  const chars = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  return chars[(mode >> 6) & 7] + chars[(mode >> 3) & 7] + chars[mode & 7];
}

export function MobileFileManager({
  sessionId,
  terminalCwd,
  transport,
}: MobileFileManagerProps) {
  const dialog = useDialog();
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followTerminal, setFollowTerminal] = useState(true);
  const [sheetEntry, setSheetEntry] = useState<SftpEntry | null>(null);
  const [editorFile, setEditorFile] = useState<SftpReadResult | null>(null);
  const homeDirRef = useRef<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const loadDir = useCallback(
    async (targetPath: string) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      try {
        let effective = targetPath.trim() || '~';
        if (effective === '~' || effective.startsWith('~/')) {
          if (!homeDirRef.current) {
            homeDirRef.current = await transport.sftpRealpath(sessionId, '~');
          }
          effective =
            effective === '~'
              ? homeDirRef.current
              : `${homeDirRef.current.replace(/\/+$/, '')}/${effective.slice(2)}`;
        }
        const resolved = effective.startsWith('/')
          ? effective
          : await transport.sftpRealpath(sessionId, effective);
        const list = await transport.sftpList(sessionId, resolved);
        list.sort((a, b) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });
        setCurrentPath(resolved);
        setEntries(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionId, transport]
  );

  useEffect(() => {
    if (!sessionId) {
      setEntries([]);
      homeDirRef.current = null;
      return;
    }
    if (followTerminal && terminalCwd) {
      void loadDir(terminalCwd);
    }
  }, [sessionId, terminalCwd, followTerminal, loadDir]);

  const handleOpen = async (entry: SftpEntry) => {
    if (!sessionId) return;
    if (entry.type === 'directory' || entry.type === 'symlink') {
      void loadDir(entry.path);
      return;
    }
    setLoading(true);
    try {
      const file = await transport.sftpRead(sessionId, entry.path);
      setEditorFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (entry: SftpEntry) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const file = await transport.sftpRead(sessionId, entry.path);
      const copy = new Uint8Array(file.bytes.length);
      copy.set(file.bytes);
      const blob = new Blob([copy], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!sessionId || !files || files.length === 0) return;
    setLoading(true);
    try {
      for (const f of Array.from(files)) {
        const buf = new Uint8Array(await f.arrayBuffer());
        const remote =
          currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`;
        await transport.sftpWrite(sessionId, remote, buf);
      }
      await loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleMkdir = async () => {
    if (!sessionId) return;
    const name = await dialog.prompt({
      title: '新建文件夹',
      placeholder: '请输入文件夹名称',
      confirmText: '创建',
    });
    if (!name?.trim()) return;
    const target =
      currentPath === '/' ? `/${name.trim()}` : `${currentPath}/${name.trim()}`;
    try {
      await transport.sftpMkdir(sessionId, target);
      await loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRename = async (entry: SftpEntry) => {
    if (!sessionId) return;
    const next = await dialog.prompt({
      title: '重命名',
      defaultValue: entry.name,
      confirmText: '确认',
    });
    if (!next?.trim() || next.trim() === entry.name) return;
    const parent = currentPath === '/' ? '' : currentPath;
    try {
      await transport.sftpRename(sessionId, entry.path, `${parent}/${next.trim()}`);
      await loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (entry: SftpEntry) => {
    if (!sessionId) return;
    const ok = await dialog.confirm({
      title: '确认删除',
      message: `确定永久删除「${entry.name}」吗？`,
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    try {
      await transport.sftpRemove(sessionId, entry.path, entry.type === 'directory');
      await loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b0f17] p-6 text-center text-sm text-slate-400">
        请先在「主机」页连接一台 Linux 服务器
      </div>
    );
  }

  const segments = currentPath.split('/').filter(Boolean);

  return (
    <div className="flex h-full flex-col bg-[#0b0f17] text-slate-100">
      {/* Touch Toolbar */}
      <div className="shrink-0 space-y-2 border-b border-white/10 bg-[#0e1420] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const parent =
                  currentPath === '/'
                    ? '/'
                    : currentPath.split('/').slice(0, -1).join('/') || '/';
                void loadDir(parent);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 active:bg-white/15"
              title="上级目录"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setFollowTerminal((v) => !v)}
              className={`flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium ${
                followTerminal
                  ? 'border-sky-500/50 bg-sky-500/20 text-sky-300'
                  : 'border-white/10 bg-white/5 text-slate-400'
              }`}
            >
              <Link2 className="h-3.5 w-3.5" />
              跟随终端
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleMkdir()}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 active:bg-white/15"
              title="新建文件夹"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 active:bg-white/15"
              title="上传文件"
            >
              <Upload className="h-4 w-4" />
            </button>
            <input
              ref={uploadRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUpload(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => void loadDir(currentPath)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 active:bg-white/15"
              title="刷新"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Scrollable Breadcrumb Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 font-mono text-xs">
          <button
            type="button"
            onClick={() => void loadDir('/')}
            className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1 text-sky-300 active:bg-white/15"
          >
            /
          </button>
          {segments.map((seg, idx) => {
            const full = '/' + segments.slice(0, idx + 1).join('/');
            return (
              <button
                key={full}
                type="button"
                onClick={() => void loadDir(full)}
                className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1 text-slate-200 active:bg-white/15"
              >
                {seg}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Touch File Rows (58px tall) */}
      <div className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
        {entries.map((entry) => {
          const isDir = entry.type === 'directory';
          const isLink = entry.type === 'symlink';
          return (
            <div
              key={entry.path}
              onClick={() => void handleOpen(entry)}
              className="flex min-h-[58px] cursor-pointer items-center justify-between gap-3 px-4 py-2.5 active:bg-white/5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="shrink-0">
                  {isDir ? (
                    <FolderIcon />
                  ) : isLink ? (
                    <FolderIcon symlink />
                  ) : (
                    <FileTypeIcon filename={entry.name} />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-100">
                    {entry.name}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                    {isDir ? '文件夹' : formatSize(entry.size)} · {formatPerm(entry.permissions)}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSheetEntry(entry);
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 active:bg-white/10"
              >
                <MoreVertical className="h-5 w-5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom Action Sheet */}
      {sheetEntry && (
        <div
          onClick={() => setSheetEntry(null)}
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-t-3xl border-t border-white/15 bg-[#101622] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-3 truncate px-2 text-sm font-semibold text-white">
              {sheetEntry.name}
            </div>
            <div className="space-y-1.5">
              {sheetEntry.type !== 'directory' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const t = sheetEntry;
                      setSheetEntry(null);
                      void handleOpen(t);
                    }}
                    className="flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-sm text-sky-300 active:bg-white/10"
                  >
                    <Edit3 className="h-4 w-4" /> 在线实时编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const t = sheetEntry;
                      setSheetEntry(null);
                      void handleDownload(t);
                    }}
                    className="flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-sm text-emerald-300 active:bg-white/10"
                  >
                    <Download className="h-4 w-4" /> 下载文件
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  const t = sheetEntry;
                  setSheetEntry(null);
                  void handleRename(t);
                }}
                className="flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-sm text-slate-200 active:bg-white/10"
              >
                <PenLine className="h-4 w-4" /> 重命名
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = sheetEntry;
                  setSheetEntry(null);
                  void handleDelete(t);
                }}
                className="flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-sm text-rose-400 active:bg-rose-500/15"
              >
                <Trash2 className="h-4 w-4" /> 删除
              </button>
            </div>
          </div>
        </div>
      )}

      {editorFile && sessionId && (
        <FileEditorModal
          sessionId={sessionId}
          file={editorFile}
          transport={transport}
          onClose={() => setEditorFile(null)}
          onSaved={() => void loadDir(currentPath)}
        />
      )}
    </div>
  );
}
