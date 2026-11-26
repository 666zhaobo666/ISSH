import type { AiMode, AiProviderConfig, AiSkill, SystemMetrics } from '@issh/core';
import type { AppSshTransport } from '../transport';

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface TerminalSnapshotContext {
  sessionId: string;
  targetName: string;
  hostLabel: string;
  host: string;
  port: number;
  username: string;
  cwd: string;
  osName?: string;
  metrics?: SystemMetrics | null;
  selectedText?: string;
  recentOutput?: string;
}

export const DEFAULT_AI_PROVIDER: AiProviderConfig = {
  id: 'default',
  name: 'DeepSeek / OpenAI 兼容',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.2,
};

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'ssh_exec',
      description:
        'Execute a non-interactive shell command on a target Linux server and return stdout, stderr, and exitCode. Use non-interactive flags (e.g. apt -y, --no-pager).',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Optional target host name when multiple hosts are selected',
          },
          command: { type: 'string', description: 'Shell command to execute' },
          workdir: { type: 'string', description: 'Optional working directory' },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in ms (default 60000, max 300000 for builds/installs)',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sftp_read',
      description:
        'Read a remote text file with line numbers. Supports optional start_line and end_line (1-based) for large files.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Optional target host name when multiple hosts are selected',
          },
          path: { type: 'string', description: 'Absolute remote file path' },
          start_line: { type: 'number', description: 'Optional 1-based start line' },
          end_line: { type: 'number', description: 'Optional 1-based end line' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sftp_write',
      description:
        'Create or completely overwrite a remote file (automatically creates parent directories). Prefer sftp_edit for partial edits to existing files.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Optional target host name when multiple hosts are selected',
          },
          path: { type: 'string', description: 'Absolute remote file path' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sftp_edit',
      description:
        'Replace an exact substring in an existing remote file. old_text must match uniquely in the file.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Optional target host name when multiple hosts are selected',
          },
          path: { type: 'string', description: 'Absolute remote file path' },
          old_text: { type: 'string', description: 'Exact existing text to replace' },
          new_text: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sftp_list',
      description: 'List files and directories in a remote path.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Optional target host name when multiple hosts are selected',
          },
          path: { type: 'string', description: 'Remote directory path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sftp_grep',
      description: 'Search for a text or regex pattern across files in a remote directory.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Optional target host name when multiple hosts are selected',
          },
          pattern: { type: 'string', description: 'Search pattern' },
          path: { type: 'string', description: 'Directory to search (default current cwd)' },
        },
        required: ['pattern'],
      },
    },
  },
] as const;

export function buildSystemPrompt(
  mode: AiMode,
  targets: TerminalSnapshotContext[],
  activeSkills: AiSkill[] = []
): string {
  const envBlock =
    targets.length === 0
      ? 'No active SSH session selected.'
      : targets
          .map((ctx, idx) =>
            [
              `[Target ${idx + 1}: ${ctx.targetName}]`,
              `Host: ${ctx.username}@${ctx.host}:${ctx.port}`,
              `OS: ${ctx.osName ?? 'Linux'}`,
              `CWD: ${ctx.cwd}`,
              ctx.metrics
                ? `Load: CPU ${ctx.metrics.cpu.usagePercent.toFixed(1)}% (${ctx.metrics.cpu.cores} cores), Mem ${(ctx.metrics.memory.usedBytes / 1024 / 1024 / 1024).toFixed(1)}/${(ctx.metrics.memory.totalBytes / 1024 / 1024 / 1024).toFixed(1)} GB`
                : null,
              ctx.selectedText?.trim()
                ? `Selected Terminal Text:\n\`\`\`\n${ctx.selectedText.slice(0, 6000)}\n\`\`\``
                : ctx.recentOutput?.trim()
                  ? `Recent Terminal Output:\n\`\`\`\n${ctx.recentOutput.slice(-4500)}\n\`\`\``
                  : null,
            ]
              .filter(Boolean)
              .join('\n')
          )
          .join('\n\n');

  const skillsBlock =
    activeSkills.length > 0
      ? `\n\nUser Custom Skills & Operational Rules (MUST FOLLOW):\n${activeSkills
          .map((s) => `### Skill: ${s.name}\n${s.content}`)
          .join('\n\n')}`
      : '';

  if (mode === 'ask') {
    return `You are ISSH Copilot, a concise, expert Linux/DevOps & full-stack engineering assistant.
You are in ASK mode (read-only): you CANNOT execute commands or edit files directly.
Answer clearly in Chinese (unless the user writes in English), explain root causes, and put runnable shell commands in \`\`\`bash code blocks so the user can insert them into the terminal with one click.
When multiple hosts are selected, you can reference each host's IP/port/CWD to give accurate cross-host commands (e.g. scp, rsync, curl, joint debugging).${skillsBlock}

Current Environment Context:
${envBlock}`;
  }

  return `You are ISSH Agent, an autonomous Linux DevOps & multi-host software engineering agent operating over SSH/SFTP.
Follow best practices:
1. Inspect before modifying: use sftp_list, sftp_read, or sftp_grep to understand existing code/configs first.
2. Prefer sftp_edit for modifying existing files and sftp_write for creating new files.
3. For ssh_exec, ALWAYS use non-interactive flags (e.g., -y, --no-pager, DEBIAN_FRONTEND=noninteractive) and never run interactive TUI tools like vim, nano, or top.
4. Multi-host collaboration: when multiple targets are attached (e.g., backend on Host A, frontend on Host B), ALWAYS specify the \`target\` argument in every tool call so commands and file edits run on the exact right machine, and test cross-host connectivity (e.g. curl/health checks).
5. After writing code or changing configs, verify with tests, syntax checks (e.g. nginx -t), or builds via ssh_exec.
6. Reply concisely in Chinese with a clear summary of what was changed and verified.${skillsBlock}

Current Environment Context:
${envBlock}`;
}

export async function fetchProviderModels(
  provider: Pick<AiProviderConfig, 'baseUrl' | 'apiKey'>
): Promise<string[]> {
  const base = provider.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const url = `${base}/models`;

  const headers: Record<string, string> = {};
  if (provider.apiKey.trim()) {
    headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
  }

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ id?: string }>;
    models?: Array<{ id?: string; name?: string }>;
  };

  const rawList = json.data
    ? json.data.map((m) => m.id).filter(Boolean)
    : json.models
      ? json.models.map((m) => m.id ?? m.name).filter(Boolean)
      : [];

  return Array.from(new Set(rawList as string[])).sort();
}

export async function testModelLatency(
  provider: Pick<AiProviderConfig, 'baseUrl' | 'apiKey'>,
  model: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const base = provider.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const start = performance.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey.trim()
          ? { Authorization: `Bearer ${provider.apiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      return { ok: false, latencyMs, error: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      ok: false,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function truncateOutput(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.6));
  const tail = text.slice(-Math.floor(maxChars * 0.35));
  return `${head}\n\n... [已省略 ${text.length - head.length - tail.length} 字符] ...\n\n${tail}`;
}

export async function streamChatCompletion(
  provider: AiProviderConfig,
  messages: OpenAiMessage[],
  options: {
    tools?: readonly unknown[];
    signal?: AbortSignal;
    onDeltaText?: (delta: string) => void;
  }
): Promise<{ content: string; toolCalls: OpenAiToolCall[] }> {
  const base = provider.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature: provider.temperature ?? 0.2,
    stream: true,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`AI API 错误 (${res.status}): ${errText.slice(0, 300)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('AI API 未返回流式响应');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCallsMap = new Map<number, OpenAiToolCall>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          options.onDeltaText?.(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            let entry = toolCallsMap.get(tc.index);
            if (!entry) {
              entry = {
                id: tc.id ?? `call_${tc.index}_${Date.now()}`,
                type: 'function',
                function: { name: '', arguments: '' },
              };
              toolCallsMap.set(tc.index, entry);
            }
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.function.name += tc.function.name;
            if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
          }
        }
      } catch {
        // Ignore partial or non-JSON SSE lines
      }
    }
  }

  return {
    content,
    toolCalls: Array.from(toolCallsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v),
  };
}

export async function executeAgentTool(
  transport: AppSshTransport,
  sessionId: string,
  cwd: string,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (name === 'ssh_exec') {
    const command = String(args.command ?? '');
    const workdir = typeof args.workdir === 'string' ? args.workdir : cwd;
    const timeoutMs = Math.min(
      Math.max(Number(args.timeout_ms) || 60_000, 3_000),
      300_000
    );
    const res = await transport.exec(sessionId, command, {
      timeoutMs,
      cwd: workdir && workdir !== '~' ? workdir : undefined,
    });
    return truncateOutput(
      JSON.stringify({
        exitCode: res.exitCode,
        timedOut: res.timedOut,
        stdout: res.stdout,
        stderr: res.stderr,
      })
    );
  }

  if (name === 'sftp_list') {
    const path = String(args.path ?? cwd ?? '~');
    const entries = await transport.sftpList(sessionId, path);
    const lines = entries.slice(0, 200).map((e) => {
      const tag = e.type === 'directory' ? '[DIR]' : '[FILE]';
      return `${tag} ${e.name} (${e.size}B)`;
    });
    return truncateOutput(lines.join('\n') || '(空目录)');
  }

  if (name === 'sftp_read') {
    const path = String(args.path ?? '');
    const res = await transport.sftpRead(sessionId, path);
    if (res.text === null) {
      return `Binary file (${res.bytes.length} bytes), cannot read as text.`;
    }
    const allLines = res.text.split('\n');
    const start = Math.max(1, Number(args.start_line) || 1);
    const end = Math.min(allLines.length, Number(args.end_line) || allLines.length);
    const numbered = allLines
      .slice(start - 1, end)
      .map((line, i) => `${start + i} | ${line}`)
      .join('\n');
    return truncateOutput(
      `File: ${path} (lines ${start}-${end} of ${allLines.length})\n${numbered}`
    );
  }

  if (name === 'sftp_write') {
    const path = String(args.path ?? '');
    const content = String(args.content ?? '');
    const parent = path.replace(/\/[^/]+$/, '');
    if (parent && parent.startsWith('/')) {
      await transport.exec(sessionId, `mkdir -p '${parent.replace(/'/g, "'\\''")}'`);
    }
    await transport.sftpWrite(sessionId, path, content);
    return `Successfully wrote ${content.length} chars to ${path}`;
  }

  if (name === 'sftp_edit') {
    const path = String(args.path ?? '');
    const oldText = String(args.old_text ?? '');
    const newText = String(args.new_text ?? '');
    const res = await transport.sftpRead(sessionId, path);
    if (res.text === null) {
      throw new Error(`Cannot edit binary file: ${path}`);
    }
    const firstIdx = res.text.indexOf(oldText);
    if (firstIdx === -1) {
      throw new Error(`old_text not found in ${path}`);
    }
    if (res.text.indexOf(oldText, firstIdx + 1) !== -1) {
      throw new Error(`old_text matched multiple locations in ${path}; please provide more context`);
    }
    const updated =
      res.text.slice(0, firstIdx) +
      newText +
      res.text.slice(firstIdx + oldText.length);
    await transport.sftpWrite(sessionId, path, updated, {
      permissions: res.permissions,
    });
    return `Successfully edited ${path}`;
  }

  if (name === 'sftp_grep') {
    const pattern = String(args.pattern ?? '');
    const searchPath = String(args.path ?? cwd ?? '.');
    const qPat = `'${pattern.replace(/'/g, "'\\''")}'`;
    const qPath = `'${searchPath.replace(/'/g, "'\\''")}'`;
    const cmd = `if command -v rg >/dev/null 2>&1; then rg -n --max-count 50 ${qPat} ${qPath}; else grep -rn --exclude-dir=node_modules --exclude-dir=.git ${qPat} ${qPath} | head -n 80; fi`;
    const res = await transport.exec(sessionId, cmd, { timeoutMs: 15_000 });
    return truncateOutput(res.stdout || '(无匹配结果)');
  }

  throw new Error(`Unknown tool: ${name}`);
}
