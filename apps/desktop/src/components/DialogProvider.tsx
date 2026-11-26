import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
}

interface DialogContextValue {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used inside DialogProvider');
  }
  return ctx;
}

type ActiveDialog =
  | { kind: 'confirm'; opts: ConfirmOptions }
  | { kind: 'prompt'; opts: PromptOptions; value: string };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const resolverRef = useRef<((val: unknown) => void) | null>(null);

  const confirm = useCallback((input: ConfirmOptions | string) => {
    const opts: ConfirmOptions =
      typeof input === 'string' ? { message: input } : input;
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve as (v: unknown) => void;
      setDialog({ kind: 'confirm', opts });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve as (v: unknown) => void;
      setDialog({ kind: 'prompt', opts, value: opts.defaultValue ?? '' });
    });
  }, []);

  const closeWith = (val: unknown) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(val);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}

      {dialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-xl border border-white/15 bg-[#111827] text-xs text-slate-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 font-semibold text-white">
                {dialog.kind === 'confirm' && dialog.opts.danger ? (
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                ) : (
                  <HelpCircle className="h-4 w-4 text-sky-400" />
                )}
                <span>
                  {dialog.opts.title ??
                    (dialog.kind === 'confirm' ? '确认操作' : '请输入')}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  closeWith(dialog.kind === 'confirm' ? false : null)
                }
                className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {dialog.kind === 'confirm' ? (
              <div className="p-4">
                <p className="leading-relaxed text-slate-300">
                  {dialog.opts.message}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => closeWith(false)}
                    className="rounded-lg border border-white/10 px-3.5 py-1.5 text-slate-300 hover:bg-white/5"
                  >
                    {dialog.opts.cancelText ?? '取消'}
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => closeWith(true)}
                    className={`rounded-lg px-3.5 py-1.5 font-medium text-white transition ${
                      dialog.opts.danger
                        ? 'bg-rose-500 hover:bg-rose-400'
                        : 'bg-sky-500 hover:bg-sky-400'
                    }`}
                  >
                    {dialog.opts.confirmText ?? '确定'}
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  closeWith(dialog.value);
                }}
                className="p-4"
              >
                {dialog.opts.message && (
                  <p className="mb-2 text-slate-400">{dialog.opts.message}</p>
                )}
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(e) =>
                    setDialog((d) =>
                      d && d.kind === 'prompt'
                        ? { ...d, value: e.target.value }
                        : d
                    )
                  }
                  placeholder={dialog.opts.placeholder}
                  className="w-full rounded-lg border border-white/15 bg-[#090d14] px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => closeWith(null)}
                    className="rounded-lg border border-white/10 px-3.5 py-1.5 text-slate-300 hover:bg-white/5"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-sky-500 px-3.5 py-1.5 font-medium text-white hover:bg-sky-400"
                  >
                    {dialog.opts.confirmText ?? '确定'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
