import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit2,
  ExternalLink,
  History,
  MessageSquarePlus,
  PanelRight,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type {
  AiMode,
  ApprovalPolicy,
  CommandRiskLevel,
  HostConfig,
} from '@issh/core';
import type { AppSshTransport } from '../transport';
import {
  AGENT_TOOLS,
  buildSystemPrompt,
  executeAgentTool,
  streamChatCompletion,
  type OpenAiMessage,
  type TerminalSnapshotContext,
} from '../ai/aiClient';
import {
  RISK_LEVEL_META,
  evaluateApproval,
} from '../ai/safetyGuard';
import {
  resolveActiveProvider,
  type AiSettingsState,
} from '../ai/settingsStore';
import type { SettingsTab } from './SettingsModal';
import {
  AI_THREADS_UPDATED_EVENT,
  AI_THREADS_LOCAL_CHANGED_EVENT,
  recordDeletedThreadTombstone,
} from '../cloud/syncEngine';

const AI_THREADS_KEY = 'issh.ai_threads.v1';
const AI_WIDTH_KEY = 'issh.ai_sidebar_width.v1';
const AI_HOST_SEL_KEY = 'issh.ai_host_selection.v1';

interface ToolStepLog {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error' | 'rejected';
  output?: string;
}

interface UiChatItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps?: ToolStepLog[];
}

interface AiThread {
  id: string;
  title: string;
  messages: UiChatItem[];
  updatedAt: number;
}

function createEmptyThread(title = '新对话'): AiThread {
  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    updatedAt: Date.now(),
  };
}

function loadThreads(): AiThread[] {
  try {
    const raw = localStorage.getItem(AI_THREADS_KEY);
    const parsed = raw ? (JSON.parse(raw) as AiThread[]) : [];
    return parsed.length > 0 ? parsed : [createEmptyThread()];
  } catch {
    return [createEmptyThread()];
  }
}

function formatShortTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface PendingApproval {
  toolName: string;
  targetLabel: string;
  riskLevel: CommandRiskLevel;
  args: Record<string, unknown>;
  isHighRisk: boolean;
  riskReason?: string;
  editableCommand?: string;
  resolve: (decision: { approved: boolean; editedArgs?: Record<string, unknown> }) => void;
}

function MessageContent({
  content,
  canInsert,
  onInsertCommand,
}: {
  content: string;
  canInsert: boolean;
  onInsertCommand: (cmd: string) => void;
}) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-2 break-words leading-relaxed">
      {parts.map((part, idx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3);
          const firstNl = inner.indexOf('\n');
          const lang = firstNl >= 0 ? inner.slice(0, firstNl).trim() : '';
          const code = (firstNl >= 0 ? inner.slice(firstNl + 1) : inner).trim();
          return (
            <div
              key={idx}
              className="overflow-hidden rounded-lg border border-white/10 bg-[#090d14]"
            >
              <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-400">
                <span>{lang || 'code'}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(code)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
                  >
                    <Copy className="h-3 w-3" /> 复制
                  </button>
                  {canInsert && (
                    <button
                      type="button"
                      onClick={() => onInsertCommand(code)}
                      className="flex items-center gap-1 rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-300 hover:bg-sky-500/30"
                    >
                      <Terminal className="h-3 w-3" /> 填入终端
                    </button>
                  )}
                </div>
              </div>
              <pre className="overflow-x-auto p-2.5 font-mono text-[11px] text-slate-200">
                {code}
              </pre>
            </div>
          );
        }
        const trimmed = part.trim();
        if (!trimmed) return null;
        const html = marked.parse(trimmed, {
          async: false,
          gfm: true,
          breaks: true,
        }) as string;
        return (
          <div
            key={idx}
            className="ai-markdown break-words text-xs leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-sky-400 [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-sky-500/50 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-sky-300 [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-white [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:border-b [&_h2]:border-white/10 [&_h2]:pb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-white [&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:font-semibold [&_h4]:text-slate-100 [&_hr]:my-3 [&_hr]:border-white/10 [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_strong]:font-semibold [&_strong]:text-white [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_table]:border-white/10 [&_table]:text-[11px] [&_td]:border [&_td]:border-white/10 [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-slate-200 [&_tr:nth-child(even)]:bg-white/[0.02] [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}

function ToolStepCard({ step }: { step: ToolStepLog }) {
  const [open, setOpen] = useState(false);
  const targetPrefix = step.args.target ? `[${String(step.args.target)}] ` : '';
  const summary =
    step.name === 'ssh_exec'
      ? `${targetPrefix}${String(step.args.command ?? '')}`
      : `${targetPrefix}${String(step.args.path ?? step.args.pattern ?? '')}`;

  return (
    <div className="rounded-lg border border-white/10 bg-[#090d14] text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
          )}
          <Wrench className="h-3 w-3 shrink-0 text-violet-400" />
          <span className="shrink-0 font-mono text-violet-300">{step.name}</span>
          <span className="truncate font-mono text-slate-400">{summary}</span>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
            step.status === 'running'
              ? 'bg-sky-500/20 text-sky-300'
              : step.status === 'done'
                ? 'bg-emerald-500/20 text-emerald-300'
                : step.status === 'rejected'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-rose-500/20 text-rose-300'
          }`}
        >
          {step.status === 'running'
            ? '执行中'
            : step.status === 'done'
              ? '完成'
              : step.status === 'rejected'
                ? '已拒绝'
                : '失败'}
        </span>
      </button>
      {open && step.output && (
        <pre className="max-h-48 overflow-auto border-t border-white/10 p-2 font-mono text-[10px] text-slate-300">
          {step.output}
        </pre>
      )}
    </div>
  );
}

interface AiSidebarProps {
  standalone?: boolean;
  activeSessionId: string | null;
  connectedContexts: TerminalSnapshotContext[];
  savedHosts?: HostConfig[];
  onConnectHost?: (host: HostConfig) => void;
  settings: AiSettingsState;
  transport: AppSshTransport;
  onChangeSettings: (next: AiSettingsState) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onInsertCommand: (cmd: string) => void;
  onDetachWindow?: () => void;
  onRedock?: () => void;
  onClose?: () => void;
}

export function AiSidebar({
  standalone = false,
  activeSessionId,
  connectedContexts,
  savedHosts = [],
  onConnectHost,
  settings,
  transport,
  onChangeSettings,
  onOpenSettings,
  onInsertCommand,
  onDetachWindow,
  onRedock,
  onClose,
}: AiSidebarProps) {
  const [aiMode, setAiMode] = useState<AiMode>('agent');
  const [threads, setThreads] = useState<AiThread[]>(loadThreads);
  const [activeThreadId, setActiveThreadId] = useState<string>(
    () => loadThreads()[0]?.id ?? ''
  );

  // History popover state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  // Composer popovers
  const [attachOpen, setAttachOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [permMenuOpen, setPermMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  // Context attachments (persisted across dock/standalone switches)
  const [followActive, setFollowActive] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(AI_HOST_SEL_KEY);
      if (raw) return Boolean((JSON.parse(raw) as { followActive?: boolean }).followActive ?? true);
    } catch {
      // ignore
    }
    return true;
  });
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(AI_HOST_SEL_KEY);
      if (raw) return (JSON.parse(raw) as { selectedSessionIds?: string[] }).selectedSessionIds ?? [];
    } catch {
      // ignore
    }
    return [];
  });
  const [extraSkillIds, setExtraSkillIds] = useState<string[]>([]);

  // Docked width resize + Detach floating window
  const [dockWidth, setDockWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(AI_WIDTH_KEY));
    return saved >= 320 && saved <= 860 ? saved : 380;
  });
  const [detached, setDetached] = useState(false);
  const [floatRect, setFloatRect] = useState({
    x: Math.max(80, window.innerWidth - 540),
    y: 72,
    w: 480,
    h: Math.min(680, window.innerHeight - 120),
  });

  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? threads[0],
    [threads, activeThreadId]
  );

  const { provider: activeProvider, model: activeModelName } = useMemo(
    () => resolveActiveProvider(settings),
    [settings]
  );

  const targetContexts = useMemo(() => {
    if (followActive) {
      const cur =
        connectedContexts.find((c) => c.sessionId === activeSessionId) ??
        connectedContexts[0];
      return cur ? [cur] : [];
    }
    return connectedContexts.filter((c) => selectedSessionIds.includes(c.sessionId));
  }, [followActive, connectedContexts, activeSessionId, selectedSessionIds]);

  const disconnectedSavedHosts = useMemo(() => {
    return savedHosts.filter(
      (h) =>
        !connectedContexts.some(
          (c) =>
            c.host === h.host &&
            c.port === h.port &&
            c.username === h.username &&
            c.targetName === h.name
        )
    );
  }, [savedHosts, connectedContexts]);

  const mountedSkills = useMemo(() => {
    return settings.skills.filter((s) => extraSkillIds.includes(s.id));
  }, [settings.skills, extraSkillIds]);

  useEffect(() => {
    localStorage.setItem(AI_THREADS_KEY, JSON.stringify(threads.slice(0, 40)));
    // 本地对话变更（新增/编辑消息/新建对话）立即通知 App.tsx 推送云端，
    // 不再只等 30s 心跳，解决"新增的对话和内容没有及时同步"的问题。
    window.dispatchEvent(new CustomEvent(AI_THREADS_LOCAL_CHANGED_EVENT));
  }, [threads]);

  useEffect(() => {
    localStorage.setItem(
      AI_HOST_SEL_KEY,
      JSON.stringify({ followActive, selectedSessionIds })
    );
  }, [followActive, selectedSessionIds]);

  // Sync threads & host selection across main, standalone AI windows, and cloud sync
  useEffect(() => {
    const reloadThreadsFromStorage = () => {
      const next = loadThreads();
      setThreads(next);
      setActiveThreadId((cur) =>
        next.some((t) => t.id === cur) ? cur : (next[0]?.id ?? '')
      );
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === AI_THREADS_KEY) {
        reloadThreadsFromStorage();
      } else if (e.key === AI_HOST_SEL_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as {
            followActive?: boolean;
            selectedSessionIds?: string[];
          };
          if (typeof parsed.followActive === 'boolean') {
            setFollowActive(parsed.followActive);
          }
          if (Array.isArray(parsed.selectedSessionIds)) {
            setSelectedSessionIds(parsed.selectedSessionIds);
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(AI_THREADS_UPDATED_EVENT, reloadThreadsFromStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(AI_THREADS_UPDATED_EVENT, reloadThreadsFromStorage);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [activeThread?.messages, pendingApproval]);

  // Close popovers on Escape or clicking anywhere outside
  useEffect(() => {
    const closeAll = () => {
      setAttachOpen(false);
      setModeMenuOpen(false);
      setPermMenuOpen(false);
      setModelMenuOpen(false);
      setHistoryOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-ai-popover]')) {
        closeAll();
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  // Docked left-edge resize
  const startDockResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    document.body.style.cursor = 'col-resize';

    const onMove = (ev: MouseEvent) => {
      const next = Math.max(320, Math.min(860, startW + (startX - ev.clientX)));
      setDockWidth(next);
      localStorage.setItem(AI_WIDTH_KEY, String(next));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Floating window drag
  const startFloatDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = floatRect.x;
    const origY = floatRect.y;

    const onMove = (ev: MouseEvent) => {
      setFloatRect((r) => ({
        ...r,
        x: Math.max(0, Math.min(window.innerWidth - 200, origX + (ev.clientX - startX))),
        y: Math.max(0, Math.min(window.innerHeight - 100, origY + (ev.clientY - startY))),
      }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Floating window corner resize
  const startFloatResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = floatRect.w;
    const origH = floatRect.h;

    const onMove = (ev: MouseEvent) => {
      setFloatRect((r) => ({
        ...r,
        w: Math.max(360, Math.min(window.innerWidth - 40, origW + (ev.clientX - startX))),
        h: Math.max(420, Math.min(window.innerHeight - 40, origH + (ev.clientY - startY))),
      }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const updateActiveMessages = (
    updater: (prev: UiChatItem[]) => UiChatItem[],
    titleHint?: string
  ) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== activeThread.id) return t;
        const nextMsgs = updater(t.messages);
        const nextTitle =
          t.title === '新对话' && titleHint ? titleHint.slice(0, 22) : t.title;
        return { ...t, title: nextTitle, messages: nextMsgs, updatedAt: Date.now() };
      })
    );
  };

  const handleNewThread = () => {
    if (running) return;
    if (activeThread && activeThread.messages.length === 0) {
      setHistoryOpen(false);
      return;
    }
    const existingEmpty = threads.find((t) => t.messages.length === 0);
    if (existingEmpty) {
      setActiveThreadId(existingEmpty.id);
      setHistoryOpen(false);
      return;
    }
    const t = createEmptyThread();
    setThreads((prev) => [t, ...prev]);
    setActiveThreadId(t.id);
    setHistoryOpen(false);
  };

  const handleDeleteThread = (id: string) => {
    if (running && id === activeThread.id) return;
    recordDeletedThreadTombstone(id);
    setThreads((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      const next = remaining.length > 0 ? remaining : [createEmptyThread()];
      if (activeThreadId === id) setActiveThreadId(next[0].id);
      return next;
    });
  };

  const toggleHostSelection = (sid: string) => {
    const curActive = activeSessionId ?? connectedContexts[0]?.sessionId ?? null;
    const wasFollowing = followActive;
    setFollowActive(false);
    setSelectedSessionIds((prev) => {
      const base = wasFollowing ? (curActive ? [curActive] : []) : prev;
      return base.includes(sid)
        ? base.filter((id) => id !== sid)
        : [...base, sid];
    });
  };

  const toggleExtraSkill = (id: string) => {
    setExtraSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const resolveTargetContext = (targetArg?: unknown): TerminalSnapshotContext | null => {
    if (targetContexts.length === 0) return null;
    if (typeof targetArg === 'string' && targetArg.trim()) {
      const q = targetArg.trim().toLowerCase();
      const matched = targetContexts.find(
        (c) =>
          c.targetName.toLowerCase() === q ||
          c.host.toLowerCase() === q ||
          c.hostLabel.toLowerCase().includes(q)
      );
      if (matched) return matched;
    }
    return targetContexts[0];
  };

  const requestApproval = (
    toolName: string,
    targetLabel: string,
    args: Record<string, unknown>
  ): Promise<{ approved: boolean; editedArgs?: Record<string, unknown> }> => {
    const decision = evaluateApproval(
      settings.approvalPolicy,
      settings.customRules,
      toolName,
      args
    );
    if (decision.autoApprove) {
      return Promise.resolve({ approved: true });
    }

    return new Promise((resolve) => {
      setPendingApproval({
        toolName,
        targetLabel,
        riskLevel: decision.risk.level,
        args,
        isHighRisk: decision.risk.isHighRisk,
        riskReason: decision.risk.reason,
        editableCommand:
          toolName === 'ssh_exec' ? String(args.command ?? '') : undefined,
        resolve,
      });
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || running) return;
    if (
      !activeProvider.apiKey.trim() &&
      !activeProvider.baseUrl.includes('localhost') &&
      !activeProvider.baseUrl.includes('127.0.0.1')
    ) {
      onOpenSettings('providers');
      return;
    }
    if (aiMode === 'agent' && targetContexts.length === 0) {
      updateActiveMessages(
        (prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'user', content: text },
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Agent 模式需要至少连接并勾选一台 SSH 主机（点击输入框左下角 `+` 选择主机）。',
          },
        ],
        text
      );
      setInput('');
      return;
    }

    setInput('');
    setRunning(true);
    const abort = new AbortController();
    abortRef.current = abort;

    const priorMsgs = activeThread.messages;
    const userItem: UiChatItem = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    const assistantId = crypto.randomUUID();
    const assistantItem: UiChatItem = {
      id: assistantId,
      role: 'assistant',
      content: '',
      steps: [],
    };
    updateActiveMessages((prev) => [...prev, userItem, assistantItem], text);

    const apiMessages: OpenAiMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(aiMode, targetContexts, mountedSkills),
      },
      ...priorMsgs.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: text },
    ];

    try {
      const maxLoops = aiMode === 'agent' ? 25 : 1;
      for (let stepIdx = 0; stepIdx < maxLoops; stepIdx++) {
        let streamedText = '';
        const { content, toolCalls } = await streamChatCompletion(
          activeProvider,
          apiMessages,
          {
            tools: aiMode === 'agent' ? AGENT_TOOLS : undefined,
            signal: abort.signal,
            onDeltaText: (delta) => {
              streamedText += delta;
              updateActiveMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: streamedText } : m
                )
              );
            },
          }
        );

        if (toolCalls.length === 0 || aiMode === 'ask') {
          break;
        }

        apiMessages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch {
            parsedArgs = {};
          }

          const targetCtx = resolveTargetContext(parsedArgs.target);
          if (!targetCtx) {
            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: 'Error: No connected target host available.',
            });
            continue;
          }

          const stepLogId = tc.id;
          updateActiveMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    steps: [
                      ...(m.steps ?? []),
                      {
                        id: stepLogId,
                        name: tc.function.name,
                        args: parsedArgs,
                        status: 'running',
                      },
                    ],
                  }
                : m
            )
          );

          const decision = await requestApproval(
            tc.function.name,
            targetCtx.targetName,
            parsedArgs
          );
          if (!decision.approved) {
            const rejectMsg = 'User rejected this tool execution.';
            updateActiveMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      steps: m.steps?.map((s) =>
                        s.id === stepLogId
                          ? { ...s, status: 'rejected', output: rejectMsg }
                          : s
                      ),
                    }
                  : m
              )
            );
            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: rejectMsg,
            });
            continue;
          }

          const finalArgs = decision.editedArgs ?? parsedArgs;
          try {
            const toolOutput = await executeAgentTool(
              transport,
              targetCtx.sessionId,
              targetCtx.cwd,
              tc.function.name,
              finalArgs
            );
            updateActiveMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      steps: m.steps?.map((s) =>
                        s.id === stepLogId
                          ? { ...s, args: finalArgs, status: 'done', output: toolOutput }
                          : s
                      ),
                    }
                  : m
              )
            );
            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: toolOutput,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            updateActiveMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      steps: m.steps?.map((s) =>
                        s.id === stepLogId
                          ? { ...s, status: 'error', output: errMsg }
                          : s
                      ),
                    }
                  : m
              )
            );
            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: `Error: ${errMsg}`,
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const errMsg = err instanceof Error ? err.message : String(err);
        updateActiveMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content
                    ? `${m.content}\n\n[请求中断: ${errMsg}]`
                    : `请求失败: ${errMsg}`,
                }
              : m
          )
        );
      }
    } finally {
      setRunning(false);
      setPendingApproval(null);
      abortRef.current = null;
    }
  };

  const filteredThreads = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, historyQuery]);

  const policyLabel: Record<ApprovalPolicy, string> = {
    manual: 'Manual',
    custom: 'Custom',
    auto: 'Auto',
  };

  const containerStyle = standalone
    ? undefined
    : detached
      ? {
          left: floatRect.x,
          top: floatRect.y,
          width: floatRect.w,
          height: floatRect.h,
        }
      : { width: dockWidth };

  return (
    <aside
      style={containerStyle}
      className={
        standalone
          ? 'relative flex h-full w-full flex-col bg-[#0e1420] text-xs'
          : detached
            ? 'fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0e1420] text-xs shadow-2xl'
            : 'relative flex shrink-0 flex-col border-l border-white/10 bg-[#0e1420] text-xs'
      }
    >
      {/* Left Resize Handle (Docked Mode) */}
      {!standalone && !detached && (
        <div
          onMouseDown={startDockResize}
          className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-sky-400/40"
          title="拖动调整 AI 面板宽度"
        />
      )}

      {/* Top Header & Modern Thread Switcher */}
      <header
        data-ai-popover
        onMouseDown={!standalone && detached ? startFloatDrag : undefined}
        className={`relative flex items-center justify-between gap-2 border-b border-white/10 bg-[#101622] px-3 py-2 ${
          !standalone && detached ? 'cursor-move select-none' : ''
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Bot className="h-4 w-4 shrink-0 text-violet-400" />
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-slate-200 transition hover:bg-white/10"
            title="切换历史对话"
          >
            <span className="truncate">{activeThread.title}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleNewThread}
            className="rounded-md p-1 text-slate-400 transition hover:bg-white/10 hover:text-sky-300"
            title="新建对话"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className={`rounded-md p-1 transition ${
              historyOpen
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
            title="历史对话列表"
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (standalone) {
                onRedock?.();
              } else if (onDetachWindow) {
                onDetachWindow();
              } else {
                setDetached((d) => !d);
              }
            }}
            className="rounded-md p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
            title={
              standalone || detached
                ? '停靠回主窗口右侧栏'
                : '弹出为独立系统窗口（可拖到其他屏幕）'
            }
          >
            {standalone || detached ? (
              <PanelRight className="h-3.5 w-3.5" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onOpenSettings('providers')}
            className="rounded-md p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
            title="AI 与模型设置"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
              title="收起 AI 面板"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Modern History Popover */}
        {historyOpen && (
          <div className="absolute left-2 right-2 top-11 z-40 overflow-hidden rounded-xl border border-white/15 bg-[#111827] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-white/10 p-2">
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <input
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="搜索历史对话..."
                className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none"
              />
              <button
                type="button"
                onClick={handleNewThread}
                className="rounded bg-sky-500/20 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-500/30"
              >
                + 新建
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto p-1.5">
              {filteredThreads.map((t) => {
                const isCur = t.id === activeThread.id;
                return (
                  <div
                    key={t.id}
                    className={`group flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 transition ${
                      isCur
                        ? 'bg-sky-500/15 text-sky-200'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {renamingId === t.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const next = renameText.trim();
                          if (next) {
                            setThreads((prev) =>
                              prev.map((item) =>
                                item.id === t.id ? { ...item, title: next } : item
                              )
                            );
                          }
                          setRenamingId(null);
                        }}
                        className="flex flex-1 items-center gap-1"
                      >
                        <input
                          autoFocus
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          onBlur={() => setRenamingId(null)}
                          className="w-full rounded border border-sky-500 bg-[#090d14] px-1.5 py-0.5 text-xs text-white outline-none"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveThreadId(t.id);
                          setHistoryOpen(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate font-medium">{t.title}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                          <span>{formatShortTime(t.updatedAt)}</span>
                          <span>{t.messages.length} 条消息</span>
                        </div>
                      </button>
                    )}

                    <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(t.id);
                          setRenameText(t.title);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                        title="重命名"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteThread(t.id)}
                        className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-rose-400"
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Chat Stream */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        {activeThread.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 px-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-400">
              <Bot className="h-5 w-5" />
            </div>
            <div className="text-sm font-semibold text-white">ISSH AI 工作台</div>
            <p className="max-w-xs text-[11px] leading-relaxed text-slate-400">
              点下方 <span className="font-mono text-sky-300">+</span> 可多选目标主机与自定义 Skills，支持单机运维、多机联调。
            </p>
            {!activeProvider.apiKey &&
              !activeProvider.baseUrl.includes('localhost') && (
                <button
                  type="button"
                  onClick={() => onOpenSettings('providers')}
                  className="mt-1 rounded-lg bg-sky-500/20 px-3 py-1.5 text-sky-300 hover:bg-sky-500/30"
                >
                  去设置配置 API Key
                </button>
              )}
          </div>
        ) : (
          activeThread.messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col gap-1.5 ${
                m.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {m.role === 'user' ? (
                <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-sky-500/20 px-3.5 py-2 text-slate-100">
                  {m.content}
                </div>
              ) : (
                <div className="w-full space-y-2 rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.03] p-3 text-slate-200">
                  {m.steps && m.steps.length > 0 && (
                    <div className="space-y-1.5">
                      {m.steps.map((s) => (
                        <ToolStepCard key={s.id} step={s} />
                      ))}
                    </div>
                  )}
                  {m.content ? (
                    <MessageContent
                      content={m.content}
                      canInsert={Boolean(activeSessionId)}
                      onInsertCommand={onInsertCommand}
                    />
                  ) : running &&
                    m.id ===
                      activeThread.messages[activeThread.messages.length - 1]?.id ? (
                    <span className="animate-pulse text-slate-400">思考中...</span>
                  ) : null}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pending Approval Card (with 5-level Risk Badge) */}
      {pendingApproval && (
        <div
          className={`mx-3 mb-2 rounded-xl border p-3 shadow-lg ${
            pendingApproval.isHighRisk
              ? 'border-rose-500/50 bg-rose-500/10'
              : 'border-amber-500/40 bg-[#111827]'
          }`}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 font-semibold">
              {pendingApproval.isHighRisk ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              ) : (
                <ShieldCheck className="h-4 w-4 shrink-0 text-amber-400" />
              )}
              <span
                className={`truncate ${
                  pendingApproval.isHighRisk ? 'text-rose-300' : 'text-amber-300'
                }`}
              >
                [{pendingApproval.targetLabel}] {pendingApproval.toolName}
              </span>
            </div>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                RISK_LEVEL_META[pendingApproval.riskLevel].badgeClass
              }`}
            >
              {RISK_LEVEL_META[pendingApproval.riskLevel].label}
            </span>
          </div>

          {pendingApproval.riskReason && (
            <div className="mb-2 text-[11px] text-rose-300">
              {pendingApproval.riskReason}
            </div>
          )}

          {pendingApproval.editableCommand !== undefined ? (
            <textarea
              rows={2}
              value={pendingApproval.editableCommand}
              onChange={(e) =>
                setPendingApproval((p) =>
                  p ? { ...p, editableCommand: e.target.value } : null
                )
              }
              className="mb-2 w-full rounded border border-white/15 bg-[#090d14] p-2 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
            />
          ) : (
            <pre className="mb-2 max-h-24 overflow-auto rounded bg-[#090d14] p-2 font-mono text-[10px] text-slate-300">
              {JSON.stringify(pendingApproval.args, null, 2)}
            </pre>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                const p = pendingApproval;
                setPendingApproval(null);
                p.resolve({ approved: false });
              }}
              className="flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10"
            >
              <X className="h-3 w-3" /> 拒绝
            </button>
            <button
              type="button"
              onClick={() => {
                const p = pendingApproval;
                setPendingApproval(null);
                const editedArgs =
                  p.editableCommand !== undefined
                    ? { ...p.args, command: p.editableCommand }
                    : p.args;
                p.resolve({ approved: true, editedArgs });
              }}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-white ${
                pendingApproval.isHighRisk
                  ? 'bg-rose-500 hover:bg-rose-400'
                  : 'bg-emerald-500 hover:bg-emerald-400'
              }`}
            >
              <Check className="h-3 w-3" /> 允许执行
            </button>
          </div>
        </div>
      )}

      {/* Copilot-Style Bottom Composer */}
      <div className="relative border-t border-white/10 p-3">
        {/* Attached Context Chips */}
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {targetContexts.length === 0 ? (
            <span className="rounded-md border border-dashed border-white/15 px-2 py-0.5 text-[10px] text-slate-500">
              未关联主机
            </span>
          ) : (
            targetContexts.map((c) => (
              <span
                key={c.sessionId}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
              >
                <Server className="h-2.5 w-2.5" />
                <span>{c.targetName}</span>
                {!followActive && (
                  <button
                    type="button"
                    onClick={() => toggleHostSelection(c.sessionId)}
                    className="hover:text-white"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            ))
          )}

          {mountedSkills.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300"
            >
              <Sparkles className="h-2.5 w-2.5" />
              <span>{s.name}</span>
              <button
                type="button"
                onClick={() => toggleExtraSkill(s.id)}
                className="hover:text-white"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>

        {/* Composer Box */}
        <div className="rounded-xl border border-white/15 bg-[#090d14] p-2 focus-within:border-sky-500/60">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              aiMode === 'ask'
                ? '提问、分析报错或生成跨机命令 (Enter 发送)...'
                : '下达任务：写项目、改配置或跨主机联调...'
            }
            className="w-full resize-none bg-transparent px-1 py-0.5 text-xs text-slate-200 outline-none placeholder:text-slate-500"
          />

          {/* Bottom Control Row (Copilot Style) */}
          <div className="mt-1.5 flex items-center justify-between gap-1 pt-1">
            {/* Left controls: +, Mode, Permissions */}
            <div className="flex flex-wrap items-center gap-1">
              {/* + Attach Popover Trigger */}
              <div className="relative" data-ai-popover>
                <button
                  type="button"
                  onClick={() => {
                    setAttachOpen((v) => !v);
                    setModeMenuOpen(false);
                    setPermMenuOpen(false);
                    setModelMenuOpen(false);
                  }}
                  className={`flex h-6 w-6 items-center justify-center rounded-md border transition ${
                    attachOpen
                      ? 'border-sky-500/50 bg-sky-500/20 text-sky-300'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                  title="挂载目标主机与自定义 Skills"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>

                {attachOpen && (
                  <div className="absolute bottom-8 left-0 z-40 w-64 rounded-xl border border-white/15 bg-[#111827] p-2.5 shadow-2xl">
                    <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-300">
                      <span className="flex items-center gap-1">
                        <Server className="h-3.5 w-3.5 text-sky-400" /> 目标主机 (可多选)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setFollowActive(true);
                          setSelectedSessionIds([]);
                        }}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          followActive
                            ? 'bg-sky-500/20 text-sky-300'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        跟随当前
                      </button>
                    </div>
                    <div className="mb-3 max-h-36 space-y-1 overflow-y-auto">
                      {connectedContexts.length === 0 &&
                      disconnectedSavedHosts.length === 0 ? (
                        <div className="text-[11px] text-slate-500">
                          暂无主机，请先在主界面添加主机
                        </div>
                      ) : (
                        <>
                          {connectedContexts.map((c) => {
                            const checked = followActive
                              ? c.sessionId ===
                                (activeSessionId ?? connectedContexts[0]?.sessionId)
                              : selectedSessionIds.includes(c.sessionId);
                            return (
                              <label
                                key={c.sessionId}
                                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-white/5"
                              >
                                <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-200">
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                                  <span className="truncate">{c.targetName}</span>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleHostSelection(c.sessionId)}
                                  className="accent-sky-500"
                                />
                              </label>
                            );
                          })}
                          {disconnectedSavedHosts.map((h) => (
                            <div
                              key={h.id}
                              className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-white/5"
                            >
                              <span
                                className="flex min-w-0 items-center gap-1.5 truncate text-slate-400"
                                title={`${h.username}@${h.host}:${h.port}`}
                              >
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                                <span className="truncate">{h.name}</span>
                              </span>
                              {onConnectHost ? (
                                <button
                                  type="button"
                                  onClick={() => onConnectHost(h)}
                                  className="shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/30"
                                >
                                  连接
                                </button>
                              ) : (
                                <span className="shrink-0 text-[10px] text-slate-500">
                                  未连接
                                </span>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    <div className="mb-1.5 flex items-center justify-between border-t border-white/10 pt-2 text-[11px] font-semibold text-slate-300">
                      <span className="flex items-center gap-1">
                        <Sparkles className="h-3.5 w-3.5 text-violet-400" /> 自定义 Skills
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachOpen(false);
                          onOpenSettings('skills');
                        }}
                        className="text-[10px] text-sky-400 hover:underline"
                      >
                        管理
                      </button>
                    </div>
                    <div className="max-h-28 space-y-1 overflow-y-auto">
                      {settings.skills.length === 0 ? (
                        <div className="text-[11px] text-slate-500">暂无 Skill</div>
                      ) : (
                        settings.skills.map((s) => {
                          const active = extraSkillIds.includes(s.id);
                          return (
                            <label
                              key={s.id}
                              className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-white/5"
                            >
                              <span className="truncate text-slate-200">{s.name}</span>
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => toggleExtraSkill(s.id)}
                                className="accent-violet-500"
                              />
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Mode Selector Pill (Agent / Ask) */}
              <div className="relative" data-ai-popover>
                <button
                  type="button"
                  onClick={() => {
                    setModeMenuOpen((v) => !v);
                    setAttachOpen(false);
                    setPermMenuOpen(false);
                    setModelMenuOpen(false);
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-300 transition hover:bg-white/10"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      aiMode === 'agent' ? 'bg-violet-400' : 'bg-sky-400'
                    }`}
                  />
                  <span>{aiMode === 'agent' ? 'Agent' : 'Ask'}</span>
                  <ChevronDown className="h-3 w-3 text-slate-500" />
                </button>
                {modeMenuOpen && (
                  <div className="absolute bottom-8 left-0 z-40 w-44 rounded-xl border border-white/15 bg-[#111827] p-1 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setAiMode('agent');
                        setModeMenuOpen(false);
                      }}
                      className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-white/10"
                    >
                      <span className="font-medium text-violet-300">Agent 模式</span>
                      <span className="text-[10px] text-slate-400">
                        自主读写文件、执行命令与跨机联调
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAiMode('ask');
                        setModeMenuOpen(false);
                      }}
                      className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-white/10"
                    >
                      <span className="font-medium text-sky-300">Ask 模式</span>
                      <span className="text-[10px] text-slate-400">
                        只读问答与命令建议，绝不自动执行
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* Permission Selector Pill (Manual / Custom / Auto) */}
              {aiMode === 'agent' && (
                <div className="relative" data-ai-popover>
                  <button
                    type="button"
                    onClick={() => {
                      setPermMenuOpen((v) => !v);
                      setAttachOpen(false);
                      setModeMenuOpen(false);
                      setModelMenuOpen(false);
                    }}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                    title="执行审批策略"
                  >
                    <ShieldCheck className="h-3 w-3 text-emerald-400" />
                    <span>{policyLabel[settings.approvalPolicy]}</span>
                    <ChevronDown className="h-3 w-3 text-slate-500" />
                  </button>

                  {permMenuOpen && (
                    <div className="absolute bottom-8 left-0 z-40 w-48 rounded-xl border border-white/15 bg-[#111827] p-1 shadow-2xl">
                      {(['manual', 'custom', 'auto'] as ApprovalPolicy[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            onChangeSettings({ ...settings, approvalPolicy: p });
                            setPermMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-white/10 ${
                            settings.approvalPolicy === p
                              ? 'bg-white/10 text-white'
                              : 'text-slate-300'
                          }`}
                        >
                          <span>
                            {p === 'manual'
                              ? 'Manual (手动审批)'
                              : p === 'custom'
                                ? 'Custom (自定义分级)'
                                : 'Auto (高权限自动)'}
                          </span>
                          {settings.approvalPolicy === p && (
                            <Check className="h-3 w-3 text-sky-400" />
                          )}
                        </button>
                      ))}
                      <div className="my-1 border-t border-white/10" />
                      <button
                        type="button"
                        onClick={() => {
                          setPermMenuOpen(false);
                          onOpenSettings('permissions');
                        }}
                        className="w-full rounded-lg px-2.5 py-1 text-left text-[10px] text-sky-400 hover:bg-white/10"
                      >
                        配置 Custom 分级规则...
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right controls: Model Picker + Send/Stop */}
            <div className="flex items-center gap-1">
              <div className="relative" data-ai-popover>
                <button
                  type="button"
                  onClick={() => {
                    setModelMenuOpen((v) => !v);
                    setAttachOpen(false);
                    setModeMenuOpen(false);
                    setPermMenuOpen(false);
                  }}
                  className="flex max-w-[130px] items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                  title={`${activeProvider.name} / ${activeModelName}`}
                >
                  <span className="truncate font-mono">{activeModelName}</span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </button>

                {modelMenuOpen && (
                  <div className="absolute bottom-8 right-0 z-40 max-h-64 w-60 overflow-y-auto rounded-xl border border-white/15 bg-[#111827] p-1.5 shadow-2xl">
                    {settings.providers.map((prov) => {
                      const models =
                        prov.models && prov.models.length > 0
                          ? prov.models
                          : [prov.model];
                      return (
                        <div key={prov.id} className="mb-1.5 last:mb-0">
                          <div className="px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {prov.name}
                          </div>
                          {models.map((m) => {
                            const selected =
                              settings.activeModel.providerId === prov.id &&
                              settings.activeModel.model === m;
                            return (
                              <button
                                key={`${prov.id}:${m}`}
                                type="button"
                                onClick={() => {
                                  onChangeSettings({
                                    ...settings,
                                    activeModel: { providerId: prov.id, model: m },
                                  });
                                  setModelMenuOpen(false);
                                }}
                                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left font-mono text-[11px] hover:bg-white/10 ${
                                  selected ? 'bg-sky-500/20 text-sky-300' : 'text-slate-300'
                                }`}
                              >
                                <span className="truncate">{m}</span>
                                {selected && <Check className="h-3 w-3 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                    <div className="mt-1 border-t border-white/10 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setModelMenuOpen(false);
                          onOpenSettings('providers');
                        }}
                        className="w-full rounded-lg px-2 py-1 text-left text-[11px] text-sky-400 hover:bg-white/10"
                      >
                        + 管理服务商与拉取模型...
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {running ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-rose-500 text-white hover:bg-rose-400"
                  title="停止生成"
                >
                  <Square className="h-3 w-3" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!input.trim()}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-500 text-white transition hover:bg-sky-400 disabled:opacity-40"
                  title="发送 (Enter)"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Window Corner Resize Grip */}
      {detached && (
        <div
          onMouseDown={startFloatResize}
          className="absolute bottom-0 right-0 z-30 h-4 w-4 cursor-nwse-resize"
          title="拖动缩放窗口大小"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-slate-500">
            <path
              d="M11 1L1 11M11 6L6 11"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
    </aside>
  );
}
