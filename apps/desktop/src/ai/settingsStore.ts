import type {
  ActiveModelRef,
  AiProviderConfig,
  AiSkill,
  ApprovalPolicy,
  CustomApprovalRules,
} from '@issh/core';

const SETTINGS_KEY = 'issh.ai_settings.v2';
const LEGACY_PROVIDER_KEY = 'issh.ai_provider.v1';

export interface AiSettingsState {
  providers: AiProviderConfig[];
  activeModel: ActiveModelRef;
  skills: AiSkill[];
  approvalPolicy: ApprovalPolicy;
  customRules: CustomApprovalRules;
}

export const DEFAULT_CUSTOM_RULES: CustomApprovalRules = {
  autoApproveLevels: {
    readonly: true,
    file_write: false,
    normal_exec: false,
    system_ops: false,
    destructive: false,
  },
  allowPrefixes: ['git status', 'git diff', 'docker ps', 'docker logs', 'ls', 'cat'],
  denyPatterns: ['rm\\s+-rf\\s+/', 'mkfs', 'shutdown', 'reboot'],
};

export const DEFAULT_SKILLS: AiSkill[] = [
  {
    id: 'skill-nginx-safe',
    name: 'Nginx 安全修改规范',
    description: '修改 Nginx 配置前先备份并用 nginx -t 校验',
    content:
      '修改任何 Nginx 配置文件前，必须先执行 cp 备份原文件为 .bak；修改完成后先运行 `nginx -t` 验证语法无误，再执行 `systemctl reload nginx`，绝不直接强制重启。',
    enabled: false,
    updatedAt: Date.now(),
  },
  {
    id: 'skill-python-uv',
    name: 'Python 项目规范 (uv)',
    description: '开发 Python 项目优先使用 uv 管理虚拟环境与依赖',
    content:
      '在 Linux 服务器开发 Python 项目时，优先使用 `uv` 或项目内 `.venv` 虚拟环境，不要污染系统全局 Python；安装依赖后同步更新 `requirements.txt` 或 `pyproject.toml`。',
    enabled: false,
    updatedAt: Date.now(),
  },
];

export interface ProviderPreset {
  presetId: string;
  name: string;
  category: 'official' | 'aggregator' | 'local' | 'custom';
  badge: string;
  baseUrl: string;
  defaultModels: string[];
  hint?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    presetId: 'deepseek',
    name: 'DeepSeek',
    category: 'official',
    badge: 'DS',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    presetId: 'openai',
    name: 'OpenAI',
    category: 'official',
    badge: 'OA',
    baseUrl: 'https://api.openai.com/v1',
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  },
  {
    presetId: 'gemini',
    name: 'Google Gemini',
    category: 'official',
    badge: 'GM',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    presetId: 'kimi',
    name: 'Kimi (Moonshot)',
    category: 'official',
    badge: 'KM',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModels: ['moonshot-v1-8k', 'kimi-k2-0711-preview'],
  },
  {
    presetId: 'qwen',
    name: '通义千问 (DashScope)',
    category: 'official',
    badge: 'QW',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModels: ['qwen-max', 'qwen-plus', 'qwen-coder-plus'],
  },
  {
    presetId: 'zhipu',
    name: '智谱 GLM',
    category: 'official',
    badge: 'ZP',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModels: ['glm-4-plus', 'glm-4-flash'],
  },
  {
    presetId: 'xai',
    name: 'xAI (Grok)',
    category: 'official',
    badge: 'xA',
    baseUrl: 'https://api.x.ai/v1',
    defaultModels: ['grok-3', 'grok-3-mini'],
  },
  {
    presetId: 'openrouter',
    name: 'OpenRouter',
    category: 'aggregator',
    badge: 'OR',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: ['anthropic/claude-3.7-sonnet', 'openai/gpt-4o', 'deepseek/deepseek-chat'],
  },
  {
    presetId: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    category: 'aggregator',
    badge: 'SF',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModels: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
  },
  {
    presetId: 'ollama',
    name: 'Ollama (本地)',
    category: 'local',
    badge: 'OL',
    baseUrl: 'http://localhost:11434/v1',
    defaultModels: ['qwen2.5-coder:7b', 'deepseek-r1:8b'],
  },
  {
    presetId: 'lmstudio',
    name: 'LM Studio (本地)',
    category: 'local',
    badge: 'LM',
    baseUrl: 'http://localhost:1234/v1',
    defaultModels: ['local-model'],
  },
  {
    presetId: 'custom-openai',
    name: 'OpenAI 兼容 (自定义)',
    category: 'custom',
    badge: '++',
    baseUrl: 'https://your-api-endpoint.com/v1',
    defaultModels: [],
    hint: '支持任意 OneAPI / NewAPI / CLIProxy / 企业自建网关，可自定义名称',
  },
];

export const DEFAULT_PROVIDERS: AiProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    temperature: 0.2,
    enabled: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'],
    temperature: 0.2,
    enabled: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'qwen2.5-coder:7b',
    models: ['qwen2.5-coder:7b'],
    temperature: 0.2,
    enabled: true,
  },
];

export function loadAiSettings(): AiSettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiSettingsState>;
      const providers =
        parsed.providers && parsed.providers.length > 0
          ? parsed.providers
          : DEFAULT_PROVIDERS;
      const activeModel = parsed.activeModel ?? {
        providerId: providers[0].id,
        model: providers[0].models?.[0] ?? providers[0].model,
      };
      return {
        providers,
        activeModel,
        skills: parsed.skills ?? DEFAULT_SKILLS,
        approvalPolicy: parsed.approvalPolicy ?? 'manual',
        customRules: {
          ...DEFAULT_CUSTOM_RULES,
          ...(parsed.customRules ?? {}),
          autoApproveLevels: {
            ...DEFAULT_CUSTOM_RULES.autoApproveLevels,
            ...(parsed.customRules?.autoApproveLevels ?? {}),
          },
        },
      };
    }

    // Migrate legacy v1 provider config if present
    const legacyRaw = localStorage.getItem(LEGACY_PROVIDER_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as AiProviderConfig;
      const migrated: AiProviderConfig = {
        ...legacy,
        id: 'custom-legacy',
        name: legacy.name || '自定义服务商',
        models: [legacy.model || 'deepseek-chat'],
        enabled: true,
      };
      return {
        providers: [migrated, ...DEFAULT_PROVIDERS.filter((p) => p.baseUrl !== migrated.baseUrl)],
        activeModel: { providerId: migrated.id, model: migrated.model },
        skills: DEFAULT_SKILLS,
        approvalPolicy: 'manual',
        customRules: DEFAULT_CUSTOM_RULES,
      };
    }
  } catch {
    // ignore storage errors
  }

  return {
    providers: DEFAULT_PROVIDERS,
    activeModel: { providerId: 'deepseek', model: 'deepseek-chat' },
    skills: DEFAULT_SKILLS,
    approvalPolicy: 'manual',
    customRules: DEFAULT_CUSTOM_RULES,
  };
}

export function saveAiSettings(state: AiSettingsState): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
}

export function resolveActiveProvider(
  state: AiSettingsState
): { provider: AiProviderConfig; model: string } {
  const provider =
    state.providers.find((p) => p.id === state.activeModel.providerId) ??
    state.providers[0] ??
    DEFAULT_PROVIDERS[0];
  const model =
    state.activeModel.model ||
    provider.models?.[0] ||
    provider.model ||
    'deepseek-chat';
  return { provider: { ...provider, model }, model };
}
