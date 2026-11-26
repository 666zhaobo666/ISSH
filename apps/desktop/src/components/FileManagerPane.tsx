import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Link2,
  PenLine,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import type { SftpEntry, SftpReadResult } from '@issh/core';
import type { AppSshTransport } from '../transport';
import { isTauriRuntime } from '../transport/runtime';
import { FileEditorModal } from './FileEditorModal';
import { FileTypeIcon, FolderIcon } from './FileIcons';
import { RemoteFolderPicker } from './RemoteFolderPicker';
import { useDialog } from './DialogProvider';

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

function formatDateTime(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSftpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/no such file/i.test(msg)) return '该目录或文件不存在';
  if (/permission denied/i.test(msg)) return '权限不足，无法访问该目录或文件';
  if (/not empty|directory not empty/i.test(msg)) return '目录非空，无法直接删除';
  if (/closed|eof|disconnect/i.test(msg)) return 'SFTP 连接已断开';
  return msg;
}

function getEntryTypeLabel(entry: SftpEntry): string {
  if (entry.type === 'directory') return '文件夹';
  if (entry.type === 'symlink') return '软链接';
  const dot = entry.name.lastIndexOf('.');
  if (dot > 0 && dot < entry.name.length - 1) {
    return `${entry.name.slice(dot + 1).toUpperCase()} 文件`;
  }
  return '文件';
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function getAncestorPaths(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  const out = ['/'];
  let cur = '';
  for (const p of parts) {
    cur += `/${p}`;
    out.push(cur);
  }
  return out;
}

interface TreeNodeProps {
  path: string;
  name: string;
  depth: number;
  currentPath: string;
  expanded: Set<string>;
  childrenMap: Map<string, SftpEntry[]>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

function DirTreeNode({
  path,
  name,
  depth,
  currentPath,
  expanded,
  childrenMap,
  onToggle,
  onSelect,
}: TreeNodeProps) {
  const isLoaded = childrenMap.has(path);
  const isExpanded = expanded.has(path);
  const isSelected = currentPath === path;
  const subDirs = (childrenMap.get(path) ?? []).filter(
    (e) => e.type === 'directory' || e.type === 'symlink'
  );
  const hasChildren = isLoaded && subDirs.length > 0;

  return (
    <div>
      <div
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelect(path)}
        className={`flex cursor-pointer items-center gap-1 rounded py-1 pr-2 text-[11px] transition ${
          isSelected
            ? 'bg-sky-500/20 font-medium text-sky-200'
            : 'text-slate-300 hover:bg-white/[0.05]'
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(path);
            }}
            className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="inline-block w-4 shrink-0" />
        )}
        <FolderIcon
          open={isExpanded || isSelected}
          dimmed={!isLoaded}
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className={`truncate ${!isLoaded ? 'text-slate-400' : ''}`}>{name}</span>
      </div>

      {isExpanded &&
        subDirs.map((child) => (
          <DirTreeNode
            key={child.path}
            path={child.path}
            name={child.name}
            depth={depth + 1}
            currentPath={currentPath}
            expanded={expanded}
            childrenMap={childrenMap}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

type FileColKey = 'name' | 'size' | 'type' | 'mtime' | 'perm' | 'owner' | 'actions';

const FILE_COLUMNS: Array<{ key: FileColKey; label: string; defaultWidth: number }> = [
  { key: 'name', label: '文件名', defaultWidth: 180 },
  { key: 'size', label: '大小', defaultWidth: 68 },
  { key: 'type', label: '类型', defaultWidth: 76 },
  { key: 'mtime', label: '修改时间', defaultWidth: 124 },
  { key: 'perm', label: '权限', defaultWidth: 92 },
  { key: 'owner', label: '用户/组', defaultWidth: 88 },
  { key: 'actions', label: '操作', defaultWidth: 132 },
];

interface FileManagerPaneProps {
  sessionId: string | null;
  terminalCwd: string;
  transport: AppSshTransport;
}

export function FileManagerPane({
  sessionId,
  terminalCwd,
  transport,
}: FileManagerPaneProps) {
  const { confirm, prompt } = useDialog();
  const [currentPath, setCurrentPath] = useState<string>('~');
  const [pathInput, setPathInput] = useState<string>('~');
  const [editingPath, setEditingPath] = useState(false);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const [syncToast, setSyncToast] = useState<{
    kind: 'info' | 'ok' | 'err';
    text: string;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showSyncToast = useCallback(
    (kind: 'info' | 'ok' | 'err', text: string) => {
      setSyncToast({ kind, text });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setSyncToast(null), 3200);
    },
    []
  );
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [treeChildren, setTreeChildren] = useState<Map<string, SftpEntry[]>>(
    () => new Map()
  );
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(['/']));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followTerminal, setFollowTerminal] = useState(true);
  const [editingFile, setEditingFile] = useState<SftpReadResult | null>(null);
  const [transferModal, setTransferModal] = useState<{
    mode: 'move' | 'copy';
    entry: SftpEntry;
    targetDir: string;
    targetName: string;
    showBrowser: boolean;
  } | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [colWidths, setColWidths] = useState<Record<FileColKey, number>>(() =>
    Object.fromEntries(FILE_COLUMNS.map((c) => [c.key, c.defaultWidth])) as Record<
      FileColKey,
      number
    >
  );
  const colResizeRef = useRef<{
    key: FileColKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const r = colResizeRef.current;
      if (!r) return;
      const nextWidth = Math.max(48, r.startWidth + (e.clientX - r.startX));
      setColWidths((prev) => ({ ...prev, [r.key]: nextWidth }));
    };
    const onMouseUp = () => {
      colResizeRef.current = null;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startColResize = (key: FileColKey, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    colResizeRef.current = {
      key,
      startX: e.clientX,
      startWidth: colWidths[key],
    };
    document.body.style.cursor = 'col-resize';
  };

  const treeCacheRef = useRef<Map<string, SftpEntry[]>>(new Map());
  const homeDirRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);

  const loadTreeNode = useCallback(
    async (dirPath: string) => {
      if (!sessionId || treeCacheRef.current.has(dirPath)) return;
      try {
        const list = await transport.sftpList(sessionId, dirPath);
        treeCacheRef.current.set(dirPath, list);
        setTreeChildren(new Map(treeCacheRef.current));
      } catch {
        // ignore permission errors on individual tree nodes
      }
    },
    [sessionId, transport]
  );

  const loadDir = useCallback(
    async (targetPath: string, forceRefresh = false) => {
      if (!sessionId) return;
      const seq = ++loadSeqRef.current;
      setError(null);

      // Resolve '~' from cache if already known
      const normalizedTarget =
        targetPath === '~' && homeDirRef.current ? homeDirRef.current : targetPath;

      // Instant open if already cached and not forcing refresh
      if (
        !forceRefresh &&
        normalizedTarget.startsWith('/') &&
        treeCacheRef.current.has(normalizedTarget)
      ) {
        const cached = treeCacheRef.current.get(normalizedTarget)!;
        setCurrentPath(normalizedTarget);
        setPathInput(normalizedTarget);
        setEntries(cached);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        let effectiveTarget = normalizedTarget;
        if (effectiveTarget === '~' || effectiveTarget.startsWith('~/')) {
          let home = homeDirRef.current;
          if (!home) {
            home = await transport.sftpRealpath(sessionId, '~');
            homeDirRef.current = home;
          }
          effectiveTarget =
            effectiveTarget === '~'
              ? home
              : `${home.replace(/\/+$/, '')}/${effectiveTarget.slice(2)}`;
        }

        const resolved = effectiveTarget.startsWith('/')
          ? effectiveTarget
          : await transport.sftpRealpath(sessionId, effectiveTarget);

        if (seq !== loadSeqRef.current) return;

        if (targetPath === '~') {
          homeDirRef.current = resolved;
        }

        if (!forceRefresh && treeCacheRef.current.has(resolved)) {
          const cached = treeCacheRef.current.get(resolved)!;
          setCurrentPath(resolved);
          setPathInput(resolved);
          setEntries(cached);
          setLoading(false);
          return;
        }

        const list = await transport.sftpList(sessionId, resolved);
        if (seq !== loadSeqRef.current) return;

        setCurrentPath(resolved);
        setPathInput(resolved);
        setEntries(list);

        treeCacheRef.current.set(resolved, list);
        setTreeChildren(new Map(treeCacheRef.current));

        const ancestors = getAncestorPaths(resolved);
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          for (const a of ancestors) next.add(a);
          return next;
        });
        for (const a of ancestors) {
          if (a !== resolved && !treeCacheRef.current.has(a)) {
            void loadTreeNode(a);
          }
        }
      } catch (err) {
        if (seq === loadSeqRef.current) {
          setError(formatSftpError(err));
        }
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [sessionId, transport, loadTreeNode]
  );

  useEffect(() => {
    if (!sessionId) {
      setEntries([]);
      homeDirRef.current = null;
      treeCacheRef.current.clear();
      setTreeChildren(new Map());
      setLoading(false);
      return;
    }
    if (followTerminal && terminalCwd) {
      void loadDir(terminalCwd);
    }
  }, [sessionId, terminalCwd, followTerminal, loadDir]);

  const handleToggleTree = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!treeChildren.has(path)) {
          void loadTreeNode(path);
        }
      }
      return next;
    });
  };

  const handleOpenEntry = async (entry: SftpEntry) => {
    if (!sessionId) return;
    if (entry.type === 'directory') {
      await loadDir(entry.path);
      return;
    }
    try {
      const result = await transport.sftpRead(sessionId, entry.path);
      setEditingFile(result);
    } catch (err) {
      setError(formatSftpError(err));
    }
  };

  const handleGoUp = () => {
    if (currentPath === '/' || !currentPath) return;
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    void loadDir(parent);
  };

  const handleMkdir = async () => {
    if (!sessionId) return;
    const name = await prompt({
      title: '新建文件夹',
      placeholder: '输入文件夹名称',
      confirmText: '创建',
    });
    if (!name?.trim()) return;
    const target =
      currentPath === '/' ? `/${name.trim()}` : `${currentPath}/${name.trim()}`;
    await transport.sftpMkdir(sessionId, target);
    void loadDir(currentPath, true);
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !transferModal) return;
    const { mode, entry, targetDir, targetName } = transferModal;
    const cleanDir = targetDir.trim().replace(/\/+$/, '') || '/';
    const cleanName = targetName.trim() || entry.name;
    const destPath = cleanDir === '/' ? `/${cleanName}` : `${cleanDir}/${cleanName}`;

    if (destPath === entry.path) {
      setTransferModal(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (mode === 'move') {
        try {
          await transport.sftpRename(sessionId, entry.path, destPath);
        } catch {
          const res = await transport.exec(
            sessionId,
            `mv -f ${shQuote(entry.path)} ${shQuote(destPath)}`
          );
          if (res.exitCode !== 0) {
            throw new Error(res.stderr || '移动失败');
          }
        }
      } else {
        const res = await transport.exec(
          sessionId,
          `cp -r ${shQuote(entry.path)} ${shQuote(destPath)}`
        );
        if (res.exitCode !== 0) {
          throw new Error(res.stderr || '复制失败');
        }
      }
      setTransferModal(null);
      treeCacheRef.current.delete(cleanDir);
      await loadDir(currentPath, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (entry: SftpEntry) => {
    if (!sessionId) return;
    const nextName = await prompt({
      title: '重命名',
      defaultValue: entry.name,
      confirmText: '确定',
    });
    if (!nextName?.trim() || nextName.trim() === entry.name) return;
    const dir = entry.path.slice(0, entry.path.length - entry.name.length);
    await transport.sftpRename(sessionId, entry.path, `${dir}${nextName.trim()}`);
    void loadDir(currentPath, true);
  };

  const handleDelete = async (entry: SftpEntry) => {
    if (!sessionId) return;
    const ok = await confirm({
      title: '删除确认',
      message: `确定删除「${entry.name}」吗？此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await transport.sftpRemove(sessionId, entry.path, entry.type === 'directory');
      void loadDir(currentPath, true);
    } catch (err) {
      setError(formatSftpError(err));
    }
  };

  const handleDownload = async (entry: SftpEntry) => {
    if (!sessionId || entry.type === 'directory') return;
    try {
      const res = await transport.sftpRead(sessionId, entry.path);
      const blob = new Blob([res.bytes.buffer as ArrayBuffer]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const uploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!sessionId || !files || files.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        for (const f of Array.from(files)) {
          const buf = new Uint8Array(await f.arrayBuffer());
          const remote =
            currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`;
          await transport.sftpWrite(sessionId, remote, buf);
        }
        await loadDir(currentPath, true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionId, currentPath, transport, loadDir]
  );

  // Tauri 2.0 native OS file drag-and-drop listener
  useEffect(() => {
    if (!sessionId || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (cancelled) return;
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setDraggingOver(true);
        } else if (event.payload.type === 'leave') {
          setDraggingOver(false);
        } else if (event.payload.type === 'drop') {
          setDraggingOver(false);
          const paths = event.payload.paths;
          if (!paths || paths.length === 0) return;
          setLoading(true);
          setError(null);
          try {
            for (const localPath of paths) {
              await transport.sftpUploadLocalFile(
                sessionId,
                localPath,
                currentPath
              );
            }
            await loadDir(currentPath, true);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setLoading(false);
          }
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Ignore in non-Tauri browser preview
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionId, currentPath, transport, loadDir]);

  // Listen for external-editor auto-sync events from Rust watcher
  useEffect(() => {
    if (!sessionId || !isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    void listen<{
      sessionId: string;
      remotePath: string;
      fileName: string;
      status: 'synced' | 'error';
      message?: string;
    }>('sftp-external-sync', (ev) => {
      if (ev.payload.sessionId !== sessionId) return;
      if (ev.payload.status === 'synced') {
        showSyncToast('ok', `已自动回传: ${ev.payload.fileName}`);
        void loadDir(currentPathRef.current);
      } else {
        showSyncToast(
          'err',
          `回传失败 (${ev.payload.fileName}): ${ev.payload.message ?? '未知错误'}`
        );
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [sessionId, loadDir, showSyncToast]);

  const handleOpenExternal = async (entry: SftpEntry) => {
    if (!sessionId) return;
    try {
      await transport.sftpOpenExternalEditor(sessionId, entry.path);
      showSyncToast(
        'info',
        `已用外部程序打开 ${entry.name}，保存后将自动回传服务器`
      );
    } catch (err) {
      setError(formatSftpError(err));
    }
  };

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        连接 SSH 后自动加载远程文件系统
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDraggingOver(true);
      }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDraggingOver(false);
        void uploadFiles(e.dataTransfer.files);
      }}
      className={`relative flex h-full flex-col bg-[#0d121c] text-xs ${
        draggingOver ? 'ring-2 ring-inset ring-sky-400' : ''
      }`}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-white/10 px-2.5 py-1.5">
        <button
          type="button"
          onClick={handleGoUp}
          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          title="上级目录"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>

        {editingPath ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditingPath(false);
              void loadDir(pathInput);
            }}
            className="flex-1"
          >
            <input
              autoFocus
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onBlur={() => setEditingPath(false)}
              className="w-full rounded border border-sky-500 bg-[#090d14] px-2.5 py-1 font-mono text-[11px] text-slate-200 outline-none"
            />
          </form>
        ) : (
          <div
            onClick={() => setEditingPath(true)}
            className="flex min-w-0 flex-1 cursor-text items-center gap-0.5 overflow-x-auto rounded border border-white/10 bg-[#090d14] px-2 py-1 font-mono text-[11px]"
            title="点击任意层级快速跳转，点击空白处可手动输入路径"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void loadDir('/');
              }}
              className="shrink-0 rounded px-1 text-slate-300 hover:bg-white/10 hover:text-sky-300"
            >
              /
            </button>
            {currentPath
              .split('/')
              .filter(Boolean)
              .map((seg, idx, arr) => {
                const target = '/' + arr.slice(0, idx + 1).join('/');
                return (
                  <span key={target} className="flex shrink-0 items-center">
                    <span className="text-slate-600">/</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void loadDir(target);
                      }}
                      className="rounded px-1 text-slate-200 hover:bg-white/10 hover:text-sky-300"
                    >
                      {seg}
                    </button>
                  </span>
                );
              })}
          </div>
        )}

        <button
          type="button"
          onClick={() => setFollowTerminal((v) => !v)}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition ${
            followTerminal
              ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
              : 'border-white/10 bg-white/5 text-slate-400'
          }`}
          title="跟随终端 cd 切换目录"
        >
          <Link2 className="h-3 w-3" />
          <span>跟随终端</span>
        </button>

        <button
          type="button"
          onClick={() => void handleMkdir()}
          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          title="新建文件夹"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          title="上传文件 (也支持直接拖拽)"
        >
          <Upload className="h-3.5 w-3.5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void uploadFiles(e.target.files)}
        />

        <button
          type="button"
          onClick={() => void loadDir(currentPath, true)}
          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          title="刷新"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="border-b border-rose-500/20 bg-rose-500/10 px-3 py-1 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* Split View: Directory Tree (Left) + File List (Right) */}
      <div className="flex min-h-0 flex-1">
        {/* Directory Tree */}
        <div className="w-40 shrink-0 overflow-y-auto border-r border-white/10 bg-[#0a0e17] p-1.5">
          <DirTreeNode
            path="/"
            name="/"
            depth={0}
            currentPath={currentPath}
            expanded={expandedDirs}
            childrenMap={treeChildren}
            onToggle={handleToggleTree}
            onSelect={(p) => void loadDir(p)}
          />
        </div>

        {/* File List */}
        <div className="relative min-w-0 flex-1 overflow-auto">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d121c]/70 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-[#101622] px-4 py-2 text-xs text-slate-200 shadow-xl">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-400" />
                <span>加载中...</span>
              </div>
            </div>
          )}
          <table
            style={{
              width: Object.values(colWidths).reduce((a, b) => a + b, 0),
            }}
            className="min-w-full table-fixed border-collapse text-left font-mono text-[11px]"
          >
            <colgroup>
              {FILE_COLUMNS.map((col) => (
                <col key={col.key} style={{ width: colWidths[col.key] }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 select-none whitespace-nowrap bg-[#101622] text-slate-400">
              <tr className="border-b border-white/10">
                {FILE_COLUMNS.map((col, idx) => (
                  <th
                    key={col.key}
                    className={`relative px-2.5 py-1.5 ${
                      idx < FILE_COLUMNS.length - 1 ? 'border-r border-white/15' : ''
                    }`}
                  >
                    <span className="truncate">{col.label}</span>
                    <span
                      onMouseDown={(e) => startColResize(col.key, e)}
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-sky-400/50"
                      title="拖动调整列宽"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isDir = entry.type === 'directory';
                const isSymlink = entry.type === 'symlink';
                const ownerGroup =
                  entry.owner || entry.group
                    ? `${entry.owner ?? '-'}/${entry.group ?? '-'}`
                    : '-';
                return (
                  <tr
                    key={entry.path}
                    onDoubleClick={() => void handleOpenEntry(entry)}
                    className="group cursor-pointer border-b border-white/5 hover:bg-white/[0.04]"
                  >
                    <td className="flex items-center gap-2 truncate px-2.5 py-1.5 text-slate-200">
                      {isDir ? (
                        <FolderIcon />
                      ) : isSymlink ? (
                        <FolderIcon symlink />
                      ) : (
                        <FileTypeIcon filename={entry.name} />
                      )}
                      <span className="truncate" title={entry.name}>
                        {entry.name}
                      </span>
                    </td>
                    <td className="truncate px-2 py-1.5 text-slate-400">
                      {isDir ? '-' : formatSize(entry.size)}
                    </td>
                    <td className="truncate px-2 py-1.5 text-slate-400">
                      {getEntryTypeLabel(entry)}
                    </td>
                    <td className="truncate px-2 py-1.5 text-slate-400">
                      {formatDateTime(entry.modifiedAt)}
                    </td>
                    <td className="truncate px-2 py-1.5 text-slate-500">
                      {formatPerm(entry.permissions)}
                    </td>
                    <td
                      className="truncate px-2 py-1.5 text-slate-400"
                      title={ownerGroup}
                    >
                      {ownerGroup}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="inline-flex items-center gap-1 opacity-70 group-hover:opacity-100">
                        {!isDir && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleOpenEntry(entry)}
                              className="rounded p-1 text-sky-300 hover:bg-white/10"
                              title="内置编辑器实时编辑"
                            >
                              <Edit3 className="h-3 w-3" />
                            </button>
                            {isTauriRuntime() && (
                              <button
                                type="button"
                                onClick={() => void handleOpenExternal(entry)}
                                className="rounded p-1 text-violet-300 hover:bg-white/10"
                                title="用本地外部程序编辑（保存自动回传）"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDownload(entry)}
                              className="rounded p-1 text-emerald-300 hover:bg-white/10"
                              title="下载"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setTransferModal({
                              mode: 'move',
                              entry,
                              targetDir: currentPath,
                              targetName: entry.name,
                              showBrowser: true,
                            })
                          }
                          className="rounded p-1 text-amber-300 hover:bg-white/10"
                          title="移动到指定目录"
                        >
                          <FolderInput className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setTransferModal({
                              mode: 'copy',
                              entry,
                              targetDir: currentPath,
                              targetName: entry.name,
                              showBrowser: true,
                            })
                          }
                          className="rounded p-1 text-indigo-300 hover:bg-white/10"
                          title="复制到指定目录"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRename(entry)}
                          className="rounded p-1 text-slate-300 hover:bg-white/10"
                          title="重命名"
                        >
                          <PenLine className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry)}
                          className="rounded p-1 text-rose-400 hover:bg-white/10"
                          title="删除"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editingFile && sessionId && (
        <FileEditorModal
          sessionId={sessionId}
          file={editingFile}
          transport={transport}
          onClose={() => setEditingFile(null)}
          onSaved={() => void loadDir(currentPath)}
        />
      )}

      {transferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <form
            onSubmit={(e) => void handleTransferSubmit(e)}
            className="w-full max-w-md rounded-xl border border-white/15 bg-[#111827] p-4 text-xs shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold text-white">
                {transferModal.mode === 'move' ? (
                  <FolderInput className="h-4 w-4 text-amber-400" />
                ) : (
                  <Copy className="h-4 w-4 text-indigo-400" />
                )}
                {transferModal.mode === 'move' ? '移动到指定目录' : '复制到指定目录'}
              </span>
              <button
                type="button"
                onClick={() => setTransferModal(null)}
                className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 truncate rounded bg-white/5 px-2.5 py-1.5 font-mono text-[11px] text-slate-300">
              源路径：{transferModal.entry.path}
            </div>

            <div className="space-y-2.5">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-slate-400">目标目录（点击下方文件夹逐级选择）</label>
                  <button
                    type="button"
                    onClick={() =>
                      setTransferModal((m) =>
                        m ? { ...m, showBrowser: !m.showBrowser } : null
                      )
                    }
                    className="text-[11px] text-sky-400 hover:text-sky-300"
                  >
                    {transferModal.showBrowser ? '收起目录浏览' : '展开目录浏览'}
                  </button>
                </div>
                <input
                  required
                  value={transferModal.targetDir}
                  onChange={(e) =>
                    setTransferModal((m) =>
                      m ? { ...m, targetDir: e.target.value } : null
                    )
                  }
                  placeholder="/opt"
                  className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 font-mono text-slate-200 outline-none focus:border-sky-500"
                />
                {transferModal.showBrowser && sessionId && (
                  <RemoteFolderPicker
                    sessionId={sessionId}
                    initialPath={currentPath}
                    transport={transport}
                    cache={treeCacheRef.current}
                    onSelectPath={(path) =>
                      setTransferModal((m) => (m ? { ...m, targetDir: path } : null))
                    }
                  />
                )}
              </div>

              <div>
                <label className="mb-1 block text-slate-400">目标名称</label>
                <input
                  required
                  value={transferModal.targetName}
                  onChange={(e) =>
                    setTransferModal((m) =>
                      m ? { ...m, targetName: e.target.value } : null
                    )
                  }
                  className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 font-mono text-slate-200 outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTransferModal(null)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-300 hover:bg-white/5"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-lg bg-sky-500 px-3.5 py-1.5 font-medium text-white hover:bg-sky-400"
              >
                {transferModal.mode === 'move' ? '确认移动' : '确认复制'}
              </button>
            </div>
          </form>
        </div>
      )}

      {syncToast && (
        <div
          className={`pointer-events-none absolute bottom-3 right-3 z-30 rounded-lg border px-3 py-1.5 text-[11px] shadow-xl backdrop-blur ${
            syncToast.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200'
              : syncToast.kind === 'err'
                ? 'border-rose-500/40 bg-rose-950/90 text-rose-200'
                : 'border-sky-500/40 bg-slate-900/95 text-sky-200'
          }`}
        >
          {syncToast.text}
        </div>
      )}
    </div>
  );
}
