import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { marked } from 'marked';
import {
  Binary,
  Check,
  Columns2,
  Eye,
  FileCode2,
  Save,
  X,
} from 'lucide-react';
import type { ISshTransport, SftpReadResult } from '@issh/core';
import { useDialog } from './DialogProvider';

function getLanguageExtension(filename: string): {
  ext: Extension[];
  label: string;
  isMarkdown: boolean;
} {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const suffix = dot >= 0 ? lower.slice(dot) : '';

  switch (suffix) {
    case '.ts':
    case '.mts':
      return { ext: [javascript({ typescript: true })], label: 'TypeScript', isMarkdown: false };
    case '.tsx':
      return { ext: [javascript({ typescript: true, jsx: true })], label: 'TSX', isMarkdown: false };
    case '.js':
    case '.mjs':
    case '.cjs':
      return { ext: [javascript()], label: 'JavaScript', isMarkdown: false };
    case '.jsx':
      return { ext: [javascript({ jsx: true })], label: 'JSX', isMarkdown: false };
    case '.py':
    case '.pyw':
      return { ext: [python()], label: 'Python', isMarkdown: false };
    case '.java':
      return { ext: [java()], label: 'Java', isMarkdown: false };
    case '.json':
    case '.jsonc':
      return { ext: [json()], label: 'JSON', isMarkdown: false };
    case '.yml':
    case '.yaml':
      return { ext: [yaml()], label: 'YAML', isMarkdown: false };
    case '.md':
    case '.markdown':
      return { ext: [markdown()], label: 'Markdown', isMarkdown: true };
    case '.html':
    case '.htm':
      return { ext: [html()], label: 'HTML', isMarkdown: false };
    case '.css':
    case '.scss':
      return { ext: [css()], label: 'CSS', isMarkdown: false };
    case '.sql':
      return { ext: [sql()], label: 'SQL', isMarkdown: false };
    case '.xml':
    case '.svg':
      return { ext: [xml()], label: 'XML', isMarkdown: false };
    default:
      return { ext: [], label: suffix ? suffix.slice(1).toUpperCase() : 'TEXT', isMarkdown: false };
  }
}

function HexViewer({ bytes }: { bytes: Uint8Array }) {
  const rows = useMemo(() => {
    const limit = Math.min(bytes.length, 64 * 1024);
    const out: Array<{ offset: string; hex: string; ascii: string }> = [];
    for (let i = 0; i < limit; i += 16) {
      const slice = bytes.subarray(i, i + 16);
      const hexParts: string[] = [];
      let ascii = '';
      for (let j = 0; j < 16; j++) {
        if (j < slice.length) {
          const b = slice[j];
          hexParts.push(b.toString(16).padStart(2, '0'));
          ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
        } else {
          hexParts.push('  ');
        }
      }
      out.push({
        offset: i.toString(16).padStart(8, '0'),
        hex: hexParts.join(' '),
        ascii,
      });
    }
    return out;
  }, [bytes]);

  return (
    <div className="h-full overflow-auto bg-[#0b0f17] p-4 font-mono text-xs text-slate-300">
      <div className="mb-2 text-[11px] text-amber-300">
        二进制文件只读 Hex 视图（共 {bytes.length.toLocaleString()} 字节，展示前 64 KB）
      </div>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.offset} className="flex gap-4 whitespace-pre">
            <span className="text-slate-500">{r.offset}</span>
            <span className="text-sky-300">{r.hex}</span>
            <span className="text-emerald-300">{r.ascii}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface FileEditorModalProps {
  sessionId: string;
  file: SftpReadResult;
  transport: ISshTransport;
  onClose: () => void;
  onSaved?: () => void;
}

export function FileEditorModal({
  sessionId,
  file,
  transport,
  onClose,
  onSaved,
}: FileEditorModalProps) {
  const { confirm } = useDialog();
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [content, setContent] = useState(file.text ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filename = file.path.split('/').pop() ?? file.path;
  const langInfo = useMemo(() => getLanguageExtension(filename), [filename]);
  const [mdMode, setMdMode] = useState<'edit' | 'split' | 'preview'>(
    langInfo.isMarkdown ? 'split' : 'edit'
  );

  const isBinary = file.text === null;

  const handleSave = useCallback(async () => {
    if (isBinary || saving) return;
    setSaving(true);
    setError(null);
    try {
      const latestText = viewRef.current?.state.doc.toString() ?? content;
      await transport.sftpWrite(sessionId, file.path, latestText, {
        permissions: file.permissions,
      });
      setDirty(false);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 1800);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [isBinary, saving, content, transport, sessionId, file.path, file.permissions, onSaved]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    if (isBinary || mdMode === 'preview') return;
    const host = editorHostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        oneDark,
        ...langInfo.ext,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: 'Mod-s',
            run: () => {
              void handleSaveRef.current();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setContent(update.state.doc.toString());
            setDirty(true);
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px', backgroundColor: '#0b0f17' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: '"JetBrainsMono Nerd Font", "Cascadia Code", Consolas, monospace',
          },
          '.cm-gutters': { backgroundColor: '#0e1420', borderRight: '1px solid rgba(255,255,255,0.08)' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [isBinary, mdMode, langInfo]);

  const renderedMarkdown = useMemo(() => {
    if (!langInfo.isMarkdown) return '';
    return marked.parse(content, { async: false }) as string;
  }, [langInfo.isMarkdown, content]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-0 backdrop-blur-sm md:p-6">
      <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#0e1420] shadow-2xl md:h-[85vh] md:w-[88vw] md:max-w-6xl md:rounded-xl md:border md:border-white/15">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#101622] px-3 py-2.5 text-xs md:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isBinary ? (
              <Binary className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <FileCode2 className="h-4 w-4 shrink-0 text-sky-400" />
            )}
            <span className="truncate font-mono font-semibold text-white" title={file.path}>
              <span className="md:hidden">{filename}</span>
              <span className="hidden md:inline">{file.path}</span>
            </span>
            {dirty && <span className="shrink-0 text-amber-400">●</span>}
            <span className="hidden shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 sm:inline">
              {isBinary ? 'HEX' : langInfo.label}
            </span>
            <span className="hidden shrink-0 font-mono text-[10px] text-slate-500 md:inline">
              0{file.permissions.toString(8)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
            {error && <span className="max-w-[120px] truncate text-rose-400 sm:max-w-none">{error}</span>}
            {savedNotice && (
              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-emerald-400">
                <Check className="h-3.5 w-3.5" /> 已保存
              </span>
            )}

            {langInfo.isMarkdown && !isBinary && (
              <div className="flex shrink-0 rounded-md border border-white/10 bg-white/5 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setMdMode('edit')}
                  className={`whitespace-nowrap rounded px-2 py-0.5 ${mdMode === 'edit' ? 'bg-sky-500/25 text-sky-300' : 'text-slate-400'}`}
                >
                  源码
                </button>
                <button
                  type="button"
                  onClick={() => setMdMode('split')}
                  className={`hidden items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 md:flex ${mdMode === 'split' ? 'bg-sky-500/25 text-sky-300' : 'text-slate-400'}`}
                >
                  <Columns2 className="h-3 w-3" /> 分栏
                </button>
                <button
                  type="button"
                  onClick={() => setMdMode('preview')}
                  className={`flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 ${mdMode === 'preview' ? 'bg-sky-500/25 text-sky-300' : 'text-slate-400'}`}
                >
                  <Eye className="h-3 w-3" /> 预览
                </button>
              </div>
            )}

            {!isBinary && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-500 px-3 py-1.5 font-medium text-white transition hover:bg-sky-400 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5 shrink-0" />
                <span>{saving ? '保存中...' : '保存'}</span>
                <span className="hidden sm:inline">(Ctrl+S)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (!dirty) {
                  onClose();
                  return;
                }
                void confirm({
                  title: '放弃修改',
                  message: '当前文件有未保存的修改，确定要关闭吗？',
                  confirmText: '放弃并关闭',
                  danger: true,
                }).then((ok) => {
                  if (ok) onClose();
                });
              }}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {isBinary ? (
            <div className="w-full">
              <HexViewer bytes={file.bytes} />
            </div>
          ) : (
            <>
              {mdMode !== 'preview' && (
                <div
                  ref={editorHostRef}
                  className={`min-h-0 ${mdMode === 'split' ? 'w-1/2 border-r border-white/10' : 'w-full'}`}
                />
              )}
              {langInfo.isMarkdown && mdMode !== 'edit' && (
                <div
                  className={`overflow-y-auto bg-[#0b0f17] p-6 text-sm leading-relaxed text-slate-200 ${
                    mdMode === 'split' ? 'w-1/2' : 'w-full'
                  } [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#111827] [&_pre]:p-3`}
                  dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
