import { useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  TerminalSquare,
} from 'lucide-react';

interface TerminalKeybarProps {
  disabled?: boolean;
  onSendSequence: (seq: string) => void;
  onOpenCommands?: () => void;
}

/**
 * Termius-style mobile virtual shortcut keybar for SSH terminal.
 * Supports sticky Ctrl / Alt modifiers (tap Ctrl, then tap C => sends \x03).
 */
export function TerminalKeybar({
  disabled = false,
  onSendSequence,
  onOpenCommands,
}: TerminalKeybarProps) {
  const [ctrlSticky, setCtrlSticky] = useState(false);
  const [altSticky, setAltSticky] = useState(false);

  const sendKey = (seq: string) => {
    if (disabled) return;
    if (ctrlSticky && seq.length === 1) {
      const code = seq.toUpperCase().charCodeAt(0) - 64;
      if (code >= 1 && code <= 26) {
        onSendSequence(String.fromCharCode(code));
      } else {
        onSendSequence(seq);
      }
      setCtrlSticky(false);
      return;
    }
    if (altSticky) {
      onSendSequence(`\x1b${seq}`);
      setAltSticky(false);
      return;
    }
    onSendSequence(seq);
  };

  const btnBase =
    'flex h-8 min-w-[36px] shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#141c2b] px-2 font-mono text-[11px] font-medium text-slate-200 active:scale-95 active:bg-sky-500/30 disabled:opacity-40';

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-t border-white/10 bg-[#0d121c] px-2 py-1.5 select-none">
      <button
        type="button"
        disabled={disabled}
        onClick={() => sendKey('\x1b')}
        className={btnBase}
      >
        ESC
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => sendKey('\t')}
        className={btnBase}
      >
        TAB
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setCtrlSticky((v) => !v)}
        className={`${btnBase} ${
          ctrlSticky
            ? 'border-sky-400 bg-sky-500/25 text-sky-300'
            : ''
        }`}
      >
        CTRL
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAltSticky((v) => !v)}
        className={`${btnBase} ${
          altSticky
            ? 'border-violet-400 bg-violet-500/25 text-violet-300'
            : ''
        }`}
      >
        ALT
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSendSequence('\x03')}
        className={`${btnBase} text-rose-300`}
        title="中断当前命令 (Ctrl+C)"
      >
        ^C
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSendSequence('\x1b[A')}
        className={btnBase}
        title="上方向键"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSendSequence('\x1b[B')}
        className={btnBase}
        title="下方向键"
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSendSequence('\x1b[D')}
        className={btnBase}
        title="左方向键"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSendSequence('\x1b[C')}
        className={btnBase}
        title="右方向键"
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
      {['/', '-', '|', '~', '_'].map((ch) => (
        <button
          key={ch}
          type="button"
          disabled={disabled}
          onClick={() => sendKey(ch)}
          className={btnBase}
        >
          {ch}
        </button>
      ))}
      {onOpenCommands && (
        <button
          type="button"
          onClick={onOpenCommands}
          className={`${btnBase} border-sky-500/30 bg-sky-500/15 text-sky-300`}
          title="常用命令"
        >
          <TerminalSquare className="mr-1 h-3.5 w-3.5" />
          命令
        </button>
      )}
    </div>
  );
}
