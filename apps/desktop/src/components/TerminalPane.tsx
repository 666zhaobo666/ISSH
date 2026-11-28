import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { ConnectionStatus, ISshTransport, PtySize } from '@issh/core';
import { isTauriRuntime } from '../transport/runtime';
import { TerminalSemanticHighlighter } from '../utils/terminalHighlighter';

const STRIP_ANSI_FOR_CTX =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export interface TerminalContextHandle {
  getRecentOutput: (maxLines?: number) => string;
  getSelection: () => string;
}

interface TerminalPaneProps {
  sessionId: string | null;
  status: ConnectionStatus;
  error?: string;
  hostLabel: string;
  active: boolean;
  theme: ITheme;
  transport: ISshTransport;
  onReady?: (size: PtySize) => void;
  onRegisterContext?: (handle: TerminalContextHandle) => void;
}

export function TerminalPane({
  sessionId,
  status,
  error,
  hostLabel,
  active,
  theme,
  transport,
  onReady,
  onRegisterContext,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const highlighterRef = useRef(new TerminalSemanticHighlighter());
  const connectedPrintedRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const lineBufferRef = useRef<string[]>([]);
  const ctxDecoderRef = useRef(new TextDecoder('utf-8', { fatal: false }));
  sessionIdRef.current = sessionId;

  useEffect(() => {
    onRegisterContext?.({
      getRecentOutput: (maxLines = 150) => {
        const lines = lineBufferRef.current;
        return lines.slice(-maxLines).join('\n');
      },
      getSelection: () => termRef.current?.getSelection() ?? '',
    });
  }, [onRegisterContext]);

  const readClipboard = async (): Promise<string> => {
    if (isTauriRuntime()) {
      try {
        return await invoke<string>('read_clipboard_text');
      } catch {
        // fallback below
      }
    }
    return await navigator.clipboard.readText();
  };

  const triggerCopiedToast = () => {
    setCopiedToast(true);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setCopiedToast(false), 1200);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"JetBrainsMono Nerd Font", "Cascadia Code", Consolas, monospace',
      fontSize: 13.5,
      lineHeight: 1.35,
      scrollback: 10000,
      allowProposedApi: true,
      theme,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      // Fallback gracefully to canvas/DOM renderer if WebGL is unavailable
    }

    fitAddon.fit();
    onReady?.({ cols: term.cols, rows: term.rows });
    term.writeln(`\x1b[36m连接主机 ${hostLabel}...\x1b[0m`);

    // Handle Ctrl+Shift+C (Copy) & Ctrl+Shift+V (Paste) without triggering WebView2 DevTools
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyC') {
        ev.preventDefault();
        const sel = term.getSelection();
        if (sel) {
          void navigator.clipboard.writeText(sel);
          triggerCopiedToast();
        }
        return false;
      }
      if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyV') {
        ev.preventDefault();
        void readClipboard().then((txt) => {
          const sid = sessionIdRef.current;
          if (sid && txt) void transport.writePty(sid, txt);
        });
        return false;
      }
      return true;
    });

    const dataDisposable = term.onData((data) => {
      const sid = sessionIdRef.current;
      if (sid) {
        void transport.writePty(sid, data);
      }
    });

    const observer = new ResizeObserver(() => {
      if (!container.offsetParent) return;
      fitAddon.fit();
      const sid = sessionIdRef.current;
      if (sid) {
        void transport.resizePty(sid, { cols: term.cols, rows: term.rows });
      }
    });
    observer.observe(container);

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const sel = term.getSelection();
      if (sel) {
        void navigator.clipboard.writeText(sel);
        triggerCopiedToast();
      }
    };
    container.addEventListener('mouseup', onMouseUp);

    // Termius-style mobile/tablet touch gestures:
    // - 1-finger horizontal swipe: Left/Right arrow cursor control
    // - 1-finger vertical swipe: Scroll terminal buffer (up/down)
    // - 2-finger vertical swipe: Up/Down arrow command history switching
    // - Double-tap: Tab autocomplete & focus
    let touchMode: 'none' | 'single' | 'history' = 'none';
    let lastX = 0;
    let lastY = 0;
    let accumX = 0;
    let accumY = 0;
    let totalMoved = 0;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchMode = 'single';
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        accumX = 0;
        accumY = 0;
        totalMoved = 0;
      } else if (e.touches.length === 2) {
        touchMode = 'history';
        lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        accumY = 0;
      } else {
        touchMode = 'none';
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const sid = sessionIdRef.current;
      if (touchMode === 'history' && e.touches.length === 2) {
        // 2-finger vertical swipe: Up/Down arrow command history switching
        e.preventDefault();
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        accumY += midY - lastY;
        lastY = midY;
        const step = 40;
        if (Math.abs(accumY) >= step) {
          const steps = Math.trunc(accumY / step);
          if (sid) {
            // swipe down (positive) -> DOWN arrow (newer); swipe up -> UP arrow (older)
            const seq = steps > 0 ? '\x1b[B' : '\x1b[A';
            void transport.writePty(sid, seq.repeat(Math.abs(steps)));
          }
          accumY -= steps * step;
        }
        return;
      }

      if (touchMode === 'single' && e.touches.length === 1) {
        const curX = e.touches[0].clientX;
        const curY = e.touches[0].clientY;
        const dx = curX - lastX;
        const dy = curY - lastY;
        lastX = curX;
        lastY = curY;
        totalMoved += Math.abs(dx) + Math.abs(dy);
        accumX += dx;
        accumY += dy;

        // 1-finger vertical swipe: scroll terminal buffer (up/down)
        const vStep = 20;
        if (Math.abs(accumY) >= vStep && Math.abs(accumY) > Math.abs(accumX) * 1.2) {
          e.preventDefault();
          const lines = Math.trunc(accumY / vStep);
          // swipe up (negative accumY) -> scroll up to older content; swipe down -> newer
          term.scrollLines(-lines);
          accumY -= lines * vStep;
          accumX = 0;
          return;
        }

        if (!sid) return;
        const hStep = 28;

        // 1-finger horizontal swipe: Left/Right arrow cursor control
        if (Math.abs(accumX) >= hStep && Math.abs(accumX) > Math.abs(accumY) * 1.2) {
          e.preventDefault();
          const steps = Math.trunc(accumX / hStep);
          const seq = steps > 0 ? '\x1b[C' : '\x1b[D';
          void transport.writePty(sid, seq.repeat(Math.abs(steps)));
          accumX -= steps * hStep;
          accumY = 0;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchMode === 'single' && totalMoved < 16 && e.changedTouches.length === 1) {
        const now = Date.now();
        const tx = e.changedTouches[0].clientX;
        const ty = e.changedTouches[0].clientY;
        if (
          now - lastTapAt < 260 &&
          Math.abs(tx - lastTapX) < 28 &&
          Math.abs(ty - lastTapY) < 28
        ) {
          const sid = sessionIdRef.current;
          if (sid) void transport.writePty(sid, '\t');
          term.focus();
          lastTapAt = 0;
        } else {
          lastTapAt = now;
          lastTapX = tx;
          lastTapY = ty;
        }
      }
      if (e.touches.length === 0) {
        touchMode = 'none';
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });

    termRef.current = term;
    fitRef.current = fitAddon;

    return () => {
      container.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      observer.disconnect();
      dataDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [transport, hostLabel]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !sessionId) return;

    if (!connectedPrintedRef.current) {
      connectedPrintedRef.current = true;
      term.writeln('\x1b[32m连接主机成功\x1b[0m');
    }

    const unsub = transport.onPtyData(sessionId, (chunk) => {
      term.write(highlighterRef.current.process(chunk));

      // Append clean plain-text lines to 300-line ring buffer for AI context
      const rawText = ctxDecoderRef.current
        .decode(chunk, { stream: true })
        .replace(STRIP_ANSI_FOR_CTX, '')
        .replace(/\r/g, '');
      if (rawText) {
        const buf = lineBufferRef.current;
        const parts = rawText.split('\n');
        if (buf.length > 0 && parts.length > 0) {
          buf[buf.length - 1] += parts[0];
          for (let i = 1; i < parts.length; i++) {
            buf.push(parts[i]);
          }
        } else {
          buf.push(...parts);
        }
        if (buf.length > 300) {
          lineBufferRef.current = buf.slice(-300);
        }
      }
    });

    return () => {
      unsub();
    };
  }, [sessionId, transport]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (status === 'error' && error) {
      term.writeln(`\r\n\x1b[31m连接失败: ${error}\x1b[0m`);
    } else if (status === 'disconnected' && connectedPrintedRef.current) {
      term.writeln('\r\n\x1b[33m会话已断开\x1b[0m');
    }
  }, [status, error]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme;
  }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    if (!active || !term) return;
    fitRef.current?.fit();
    term.focus();
    if (sessionId) {
      void transport.resizePty(sessionId, { cols: term.cols, rows: term.rows });
    }
  }, [active, sessionId, transport]);

  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const handleCopy = () => {
    const sel = termRef.current?.getSelection();
    if (sel) {
      void navigator.clipboard.writeText(sel);
      triggerCopiedToast();
    }
    setCtxMenu(null);
    termRef.current?.focus();
  };

  const handlePaste = () => {
    void readClipboard().then((txt) => {
      const sid = sessionIdRef.current;
      if (sid && txt) void transport.writePty(sid, txt);
    });
    setCtxMenu(null);
    termRef.current?.focus();
  };

  const handleClear = () => {
    termRef.current?.clear();
    setCtxMenu(null);
    termRef.current?.focus();
  };

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{ backgroundColor: theme.background ?? '#090d14' }}
      className={`relative h-full w-full overflow-hidden px-2 py-1.5 ${
        active ? 'block' : 'hidden'
      }`}
    >
      <div ref={containerRef} className="h-full w-full" />
      {copiedToast && (
        <div className="pointer-events-none absolute right-4 top-3 z-40 rounded-md border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300 shadow-lg backdrop-blur-sm">
          ✓ 已复制到剪贴板
        </div>
      )}
      {ctxMenu && (
        <div
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          className="fixed z-50 w-44 rounded-lg border border-white/15 bg-[#111827] py-1 text-xs text-slate-200 shadow-2xl"
        >
          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-white/10"
          >
            <span>复制</span>
            <span className="text-[10px] text-slate-500">Ctrl+Shift+C</span>
          </button>
          <button
            type="button"
            onClick={handlePaste}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-white/10"
          >
            <span>粘贴</span>
            <span className="text-[10px] text-slate-500">Ctrl+Shift+V</span>
          </button>
          <div className="my-1 border-t border-white/10" />
          <button
            type="button"
            onClick={handleClear}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-white/10"
          >
            <span>清屏</span>
          </button>
        </div>
      )}
    </div>
  );
}
