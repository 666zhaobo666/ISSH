import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import {
  Activity,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Columns2,
  Download,
  Eye,
  Info,
  Palette,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AiProviderConfig,
  AiSkill,
  ApprovalPolicy,
  CommandRiskLevel,
} from '@issh/core';
import {
  PROVIDER_PRESETS,
  type AiSettingsState,
  type ProviderPreset,
} from '../ai/settingsStore';
import { fetchProviderModels, testModelLatency } from '../ai/aiClient';
import { RISK_LEVEL_META } from '../ai/safetyGuard';
import {
  exportUserProfile,
  importUserProfile,
  type IsshUserProfileBundle,
} from '../ai/profileBundle';
import { TERMINAL_THEMES } from '../themes/terminalThemes';
import { ProviderIcon } from './ProviderIcons';
import { AccountSyncPanel, type SyncStatusState } from './AccountSyncPanel';
import type { CloudUser } from '../cloud/cloudClient';
import {
  APP_VERSION,
  checkAppUpdate,
  installDesktopUpdate,
  type UpdateCheckResult,
} from '../utils/appVersion';
import { isTauriRuntime } from '../transport/runtime';
import { useDeviceLayout } from '../hooks/useDeviceLayout';

export type SettingsTab =
  | 'providers'
  | 'skills'
  | 'permissions'
  | 'appearance'
  | 'sync'
  | 'about';

interface SettingsModalProps {
  open: boolean;
  initialTab?: SettingsTab;
  settings: AiSettingsState;
  uiMode: 'dark' | 'light';
  terminalThemeId: string;
  onChangeSettings: (next: AiSettingsState) => void;
  onChangeUiMode: (mode: 'dark' | 'light') => void;
  onChangeTerminalTheme: (id: string) => void;
  onProfileImported: (bundle: IsshUserProfileBundle) => void;
  cloudUser?: CloudUser | null;
  syncStatus?: SyncStatusState;
  lastSyncedAt?: number;
  onOpenAuth?: () => void;
  onCloudUserChange?: (user: CloudUser | null) => void;
  onManualSync?: () => void;
  updateInfo?: UpdateCheckResult | null;
  onUpdateChecked?: (info: UpdateCheckResult) => void;
  onClose: () => void;
}

const RISK_ORDER: CommandRiskLevel[] = [
  'readonly',
  'file_write',
  'normal_exec',
  'system_ops',
  'destructive',
];

export function SettingsModal({
  open,
  initialTab = 'providers',
  settings,
  uiMode,
  terminalThemeId,
  onChangeSettings,
  onChangeUiMode,
  onChangeTerminalTheme,
  onProfileImported,
  cloudUser = null,
  syncStatus = 'idle',
  lastSyncedAt = 0,
  onOpenAuth,
  onCloudUserChange,
  onManualSync,
  updateInfo = null,
  onUpdateChecked,
  onClose,
}: SettingsModalProps) {
  const { mode: deviceMode } = useDeviceLayout();
  const isPhone = deviceMode === 'phone';
  const isWeb = !isTauriRuntime();
  const isAndroid =
    isTauriRuntime() &&
    typeof navigator !== 'undefined' &&
    /Android/i.test(navigator.userAgent);

  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    settings.activeModel.providerId || settings.providers[0]?.id || ''
  );
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [customProviderName, setCustomProviderName] = useState('');

  // Provider draft state with explicit Save button
  const [provDraft, setProvDraft] = useState<{
    name: string;
    baseUrl: string;
    apiKey: string;
  }>({ name: '', baseUrl: '', apiKey: '' });
  const [provSavedNotice, setProvSavedNotice] = useState(false);

  const [manualModelInput, setManualModelInput] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [latencyMap, setLatencyMap] = useState<
    Record<string, { testing?: boolean; ok?: boolean; latencyMs?: number; error?: string }>
  >({});

  // Skills state (MD editor + preview + upload/download + explicit Save)
  const [selectedSkillId, setSelectedSkillId] = useState<string>(
    settings.skills[0]?.id ?? ''
  );
  const [skillDraft, setSkillDraft] = useState<{
    name: string;
    description: string;
    content: string;
  }>({ name: '', description: '', content: '' });
  const [skillMdMode, setSkillMdMode] = useState<'edit' | 'split' | 'preview'>('split');
  const [skillSavedNotice, setSkillSavedNotice] = useState(false);
  const skillUploadRef = useRef<HTMLInputElement>(null);

  // Sync / Export / Import state
  const [includeSecrets, setIncludeSecrets] = useState(true);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateErr, setUpdateErr] = useState<string | null>(null);
  const [upToDateNotice, setUpToDateNotice] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installPhase, setInstallPhase] = useState<'checking' | 'downloading' | 'installing'>('checking');
  const [localUpdateInfo, setLocalUpdateInfo] = useState<UpdateCheckResult | null>(
    updateInfo
  );
  const effectiveUpdateInfo = localUpdateInfo ?? updateInfo;
  const importFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setMobileDetailOpen(initialTab !== 'providers');
    }
  }, [open, initialTab]);

  const activeProvider =
    settings.providers.find((p) => p.id === selectedProviderId) ??
    settings.providers[0];

  const activeSkill =
    settings.skills.find((s) => s.id === selectedSkillId) ?? settings.skills[0];

  useEffect(() => {
    if (activeProvider) {
      setProvDraft({
        name: activeProvider.name,
        baseUrl: activeProvider.baseUrl,
        apiKey: activeProvider.apiKey,
      });
      setProvSavedNotice(false);
    }
  }, [
    activeProvider?.id,
    activeProvider?.name,
    activeProvider?.baseUrl,
    activeProvider?.apiKey,
  ]);

  useEffect(() => {
    if (activeSkill) {
      setSkillDraft({
        name: activeSkill.name,
        description: activeSkill.description,
        content: activeSkill.content,
      });
      setSkillSavedNotice(false);
    }
  }, [activeSkill?.id]);

  const renderedSkillMd = useMemo(() => {
    return marked.parse(skillDraft.content || '', { async: false }) as string;
  }, [skillDraft.content]);

  if (!open) return null;

  const provDirty = Boolean(
    activeProvider &&
      (provDraft.name !== activeProvider.name ||
        provDraft.baseUrl !== activeProvider.baseUrl ||
        provDraft.apiKey !== activeProvider.apiKey)
  );

  const skillDirty = Boolean(
    activeSkill &&
      (skillDraft.name !== activeSkill.name ||
        skillDraft.description !== activeSkill.description ||
        skillDraft.content !== activeSkill.content)
  );

  const updateProvider = (id: string, patch: Partial<AiProviderConfig>) => {
    onChangeSettings({
      ...settings,
      providers: settings.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  const handleSaveProviderDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProvider) return;
    const next = {
      name: provDraft.name.trim() || activeProvider.name,
      baseUrl: provDraft.baseUrl.trim(),
      apiKey: provDraft.apiKey.trim(),
    };
    updateProvider(activeProvider.id, next);
    setProvDraft(next);
    setProvSavedNotice(true);
    setTimeout(() => setProvSavedNotice(false), 1800);
  };

  const handleAddFromPreset = (preset: ProviderPreset, customName?: string) => {
    const baseName = customName?.trim() || preset.name;
    const existingSame = settings.providers.filter(
      (p) => p.name === baseName || p.name.startsWith(`${baseName} #`)
    );
    const finalName =
      existingSame.length === 0 ? baseName : `${baseName} #${existingSame.length + 1}`;

    const newProv: AiProviderConfig = {
      id: `${preset.presetId}-${crypto.randomUUID().slice(0, 6)}`,
      name: finalName,
      baseUrl: preset.baseUrl,
      apiKey: '',
      model: preset.defaultModels[0] ?? '',
      models: [...preset.defaultModels],
      temperature: 0.2,
      enabled: true,
    };
    onChangeSettings({
      ...settings,
      providers: [...settings.providers, newProv],
    });
    setSelectedProviderId(newProv.id);
    setAddPickerOpen(false);
    setCustomProviderName('');
    setFetchError(null);
  };

  const handleDeleteProvider = (id: string) => {
    if (settings.providers.length <= 1) return;
    const remaining = settings.providers.filter((p) => p.id !== id);
    const nextActive =
      settings.activeModel.providerId === id
        ? {
            providerId: remaining[0].id,
            model: remaining[0].models?.[0] ?? remaining[0].model,
          }
        : settings.activeModel;
    onChangeSettings({
      ...settings,
      providers: remaining,
      activeModel: nextActive,
    });
    setSelectedProviderId(remaining[0].id);
  };

  const handleFetchModels = async (prov: AiProviderConfig) => {
    const effective = {
      ...prov,
      baseUrl: provDraft.baseUrl.trim() || prov.baseUrl,
      apiKey: provDraft.apiKey.trim(),
    };
    setFetchingModels(true);
    setFetchError(null);
    try {
      const fetched = await fetchProviderModels(effective);
      if (fetched.length === 0) {
        setFetchError('接口未返回模型列表，请在下方手动添加模型名称');
      } else {
        const merged = Array.from(new Set([...(prov.models ?? []), ...fetched]));
        updateProvider(prov.id, {
          baseUrl: effective.baseUrl,
          apiKey: effective.apiKey,
          models: merged,
        });
      }
    } catch (err) {
      setFetchError(
        `拉取失败 (${err instanceof Error ? err.message : String(err)})，支持手动添加模型`
      );
    } finally {
      setFetchingModels(false);
    }
  };

  const handleAddManualModel = (prov: AiProviderConfig) => {
    const m = manualModelInput.trim();
    if (!m) return;
    const merged = Array.from(new Set([...(prov.models ?? []), m]));
    updateProvider(prov.id, { models: merged });
    setManualModelInput('');
  };

  const handleRemoveModel = (prov: AiProviderConfig, model: string) => {
    const nextModels = (prov.models ?? []).filter((m) => m !== model);
    updateProvider(prov.id, { models: nextModels });
  };

  const handleTestModel = async (prov: AiProviderConfig, model: string) => {
    const key = `${prov.id}:${model}`;
    const effective = {
      baseUrl: provDraft.baseUrl.trim() || prov.baseUrl,
      apiKey: provDraft.apiKey.trim(),
    };
    setLatencyMap((prev) => ({ ...prev, [key]: { testing: true } }));
    const res = await testModelLatency(effective, model);
    setLatencyMap((prev) => ({
      ...prev,
      [key]: { testing: false, ok: res.ok, latencyMs: res.latencyMs, error: res.error },
    }));
  };

  // Skills handlers
  const handleAddSkill = () => {
    const item: AiSkill = {
      id: `skill-${crypto.randomUUID().slice(0, 8)}`,
      name: '新运维/开发规范',
      description: '在 AI 对话框 + 号中按需挂载',
      content: '# 规范标题\n\n- 规则 1：\n- 规则 2：\n',
      enabled: false,
      updatedAt: Date.now(),
    };
    onChangeSettings({
      ...settings,
      skills: [item, ...settings.skills],
    });
    setSelectedSkillId(item.id);
  };

  const handleUploadSkillMd = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const baseName = file.name.replace(/\.(md|markdown|txt)$/i, '');
    const headingMatch = text.match(/^#\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : baseName;
    const item: AiSkill = {
      id: `skill-${crypto.randomUUID().slice(0, 8)}`,
      name: title,
      description: `导入自 ${file.name}`,
      content: text,
      enabled: false,
      updatedAt: Date.now(),
    };
    onChangeSettings({
      ...settings,
      skills: [item, ...settings.skills],
    });
    setSelectedSkillId(item.id);
  };

  const handleDownloadSkillMd = () => {
    if (!activeSkill) return;
    const blob = new Blob([skillDraft.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${skillDraft.name || 'skill'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveSkillDraft = () => {
    if (!activeSkill) return;
    const next = {
      name: skillDraft.name.trim() || activeSkill.name,
      description: skillDraft.description.trim(),
      content: skillDraft.content,
    };
    onChangeSettings({
      ...settings,
      skills: settings.skills.map((s) =>
        s.id === activeSkill.id
          ? {
              ...s,
              ...next,
              updatedAt: Date.now(),
            }
          : s
      ),
    });
    setSkillDraft(next);
    setSkillSavedNotice(true);
    setTimeout(() => setSkillSavedNotice(false), 1800);
  };

  const deleteSkill = (id: string) => {
    const remaining = settings.skills.filter((s) => s.id !== id);
    onChangeSettings({ ...settings, skills: remaining });
    setSelectedSkillId(remaining[0]?.id ?? '');
  };

  // Profile Export / Import handlers
  const handleExportProfile = () => {
    const bundle = exportUserProfile(includeSecrets);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `issh-profile-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSyncMsg({ ok: true, text: '已导出完整配置文件（主机、命令、AI 服务商、Skills、权限与外观）' });
  };

  const handleImportProfile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const restored = importUserProfile(text);
      onProfileImported(restored);
      setSyncMsg({ ok: true, text: `已成功导入配置（共 ${restored.hosts.length} 台主机，${restored.aiSettings.providers.length} 个 AI 服务商，${restored.aiSettings.skills.length} 个 Skills）` });
    } catch (err) {
      setSyncMsg({
        ok: false,
        text: `导入失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const navItems = [
    { id: 'providers' as const, label: 'AI 服务商与模型', desc: '配置模型接口与 API Key', icon: Bot },
    { id: 'skills' as const, label: '自定义 Skills', desc: '管理运维规范与 Prompt', icon: Sparkles },
    { id: 'permissions' as const, label: '命令权限与安全', desc: '危险命令分级审批策略', icon: ShieldCheck },
    { id: 'appearance' as const, label: '外观与终端', desc: '浅色/深色与终端配色', icon: Palette },
    { id: 'sync' as const, label: '账号与数据同步', desc: '云端同步与配置导入导出', icon: Cloud },
    {
      id: 'about' as const,
      label: isWeb ? '关于 ISSH' : '关于与更新',
      desc: isWeb ? `当前版本 v${APP_VERSION}` : `版本 v${APP_VERSION} 与更新检查`,
      icon: Info,
    },
  ];

  const currentTabTitle =
    tab === 'providers'
      ? 'AI 服务商与模型'
      : tab === 'skills'
        ? '自定义 Skills'
        : tab === 'permissions'
          ? '命令权限与安全'
          : tab === 'appearance'
            ? '外观与终端偏好'
            : tab === 'sync'
              ? '账号与数据同步'
              : isWeb
                ? '关于 ISSH'
                : '关于 ISSH 与版本更新';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-0 pt-[env(safe-area-inset-top)] backdrop-blur-sm md:p-4">
      <div className="flex h-full w-screen flex-col overflow-hidden bg-[#0e1420] text-xs text-slate-200 shadow-2xl md:h-[84vh] md:w-[92vw] md:max-w-5xl md:flex-row md:rounded-2xl md:border md:border-white/15">
        {/* Phone Level-1 Main Menu (Native Mobile Settings Drill-Down) */}
        {isPhone && !mobileDetailOpen ? (
          <div className="flex h-full w-full flex-col bg-[#0b0f17]">
            <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0e1420] px-4 py-3.5">
              <h2 className="text-base font-semibold text-white">设置</h2>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 active:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const showDot =
                  !isWeb &&
                  item.id === 'about' &&
                  Boolean(effectiveUpdateInfo?.hasUpdate);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTab(item.id);
                      setMobileDetailOpen(true);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0e1420] px-4 py-3.5 text-left transition active:scale-[0.99] active:bg-white/5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{item.label}</div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {item.desc}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {showDot && (
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                      )}
                      <ChevronRight className="h-4 w-4 text-slate-500" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {/* Tablet / Desktop Left Sidebar Navigation */}
            {!isPhone && (
              <nav className="flex w-48 shrink-0 flex-col border-r border-white/10 bg-[#0b0f17] p-3">
                <div className="mb-4 px-2 text-sm font-semibold text-white">软件设置</div>
                <div className="flex flex-col space-y-1">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const active = tab === item.id;
                    const showDot =
                      !isWeb &&
                      item.id === 'about' &&
                      Boolean(effectiveUpdateInfo?.hasUpdate);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                          active
                            ? 'bg-sky-500/20 font-medium text-sky-300'
                            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0" />
                          <span>{item.label}</span>
                        </span>
                        {showDot && (
                          <span className="h-2 w-2 rounded-full bg-rose-500" title="发现新版本" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </nav>
            )}

            {/* Right / Level-2 Content */}
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3 md:px-5">
                <div className="flex min-w-0 items-center gap-2">
                  {isPhone && (
                    <button
                      type="button"
                      onClick={() => setMobileDetailOpen(false)}
                      className="flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-sm font-medium text-sky-400 active:bg-white/10"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>返回</span>
                    </button>
                  )}
                  <h2 className="truncate text-sm font-semibold text-white">
                    {currentTabTitle}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            {/* TAB 1: PROVIDERS */}
            {tab === 'providers' && (
              <div className="flex flex-col gap-4 md:h-full md:flex-row">
                {/* Provider List */}
                <div className="flex w-full shrink-0 flex-col gap-2 border-b border-white/10 pb-3 md:w-48 md:border-b-0 md:border-r md:pb-0 md:pr-3">
                  <button
                    type="button"
                    onClick={() => setAddPickerOpen(true)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-white/20 py-1.5 text-sky-300 hover:border-sky-400 hover:bg-sky-500/10"
                  >
                    <Plus className="h-3.5 w-3.5" /> 添加服务商
                  </button>
                  <div className="space-y-1 overflow-y-auto">
                    {settings.providers.map((p) => {
                      const isSel = p.id === activeProvider?.id;
                      const isCur = p.id === settings.activeModel.providerId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSelectedProviderId(p.id);
                            setFetchError(null);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition ${
                            isSel
                              ? 'bg-white/10 font-medium text-white'
                              : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <ProviderIcon
                              presetId={`${p.id} ${p.name} ${p.baseUrl}`}
                              className="h-5 w-5 shrink-0"
                            />
                            <span className="truncate">{p.name}</span>
                          </div>
                          {isCur && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Provider Detail with explicit Save button */}
                {activeProvider && (
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <form onSubmit={handleSaveProviderDraft} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-semibold text-white">
                          <ProviderIcon
                            presetId={`${activeProvider.id} ${activeProvider.name} ${activeProvider.baseUrl}`}
                            className="h-5 w-5"
                          />
                          <span>基础配置</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {provSavedNotice && (
                            <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                              <Check className="h-3.5 w-3.5" /> 已保存
                            </span>
                          )}
                          {provDirty && (
                            <button
                              type="submit"
                              className="flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1 font-medium text-white hover:bg-sky-400"
                            >
                              <Save className="h-3.5 w-3.5" /> 保存配置
                            </button>
                          )}
                          {settings.providers.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteProvider(activeProvider.id)}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-rose-400 hover:bg-rose-500/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> 删除
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-slate-400">服务商名称</label>
                          <input
                            value={provDraft.name}
                            onChange={(e) =>
                              setProvDraft((d) => ({ ...d, name: e.target.value }))
                            }
                            className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-slate-400">
                            Base URL (OpenAI 兼容 /v1)
                          </label>
                          <input
                            value={provDraft.baseUrl}
                            onChange={(e) =>
                              setProvDraft((d) => ({ ...d, baseUrl: e.target.value }))
                            }
                            placeholder="https://api.deepseek.com/v1"
                            className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 font-mono text-slate-200 outline-none focus:border-sky-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-slate-400">
                          API Key（本地 Ollama 可留空）
                        </label>
                        <input
                          type="password"
                          value={provDraft.apiKey}
                          onChange={(e) =>
                            setProvDraft((d) => ({ ...d, apiKey: e.target.value }))
                          }
                          placeholder="sk-..."
                          className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 font-mono text-slate-200 outline-none focus:border-sky-500"
                        />
                      </div>
                    </form>

                    {/* Models Section */}
                    <div className="mt-1 border-t border-white/10 pt-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-semibold text-white">
                          模型列表 ({(activeProvider.models ?? []).length})
                        </span>
                        <button
                          type="button"
                          disabled={fetchingModels}
                          onClick={() => void handleFetchModels(activeProvider)}
                          className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${fetchingModels ? 'animate-spin' : ''}`}
                          />
                          自动拉取 /models
                        </button>
                      </div>

                      {fetchError && (
                        <div className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
                          {fetchError}
                        </div>
                      )}

                      <div className="mb-2.5 flex gap-2">
                        <input
                          value={manualModelInput}
                          onChange={(e) => setManualModelInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddManualModel(activeProvider);
                            }
                          }}
                          placeholder="手动输入模型名（如 deepseek-chat / claude-3-7-sonnet）"
                          className="flex-1 rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 font-mono text-slate-200 outline-none focus:border-sky-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddManualModel(activeProvider)}
                          className="rounded-lg bg-sky-500 px-3 py-1.5 font-medium text-white hover:bg-sky-400"
                        >
                          添加
                        </button>
                      </div>

                      <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                        {(activeProvider.models ?? []).map((m) => {
                          const key = `${activeProvider.id}:${m}`;
                          const stat = latencyMap[key];
                          const isSelected =
                            settings.activeModel.providerId === activeProvider.id &&
                            settings.activeModel.model === m;

                          return (
                            <div
                              key={m}
                              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 ${
                                isSelected
                                  ? 'border-sky-500/50 bg-sky-500/10'
                                  : 'border-white/10 bg-white/[0.02]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  onChangeSettings({
                                    ...settings,
                                    activeModel: { providerId: activeProvider.id, model: m },
                                  })
                                }
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              >
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                    isSelected
                                      ? 'border-sky-400 bg-sky-500 text-white'
                                      : 'border-white/20'
                                  }`}
                                >
                                  {isSelected && <Check className="h-2.5 w-2.5" />}
                                </span>
                                <span className="truncate font-mono text-slate-200">{m}</span>
                              </button>

                              <div className="flex shrink-0 items-center gap-2">
                                {stat?.testing ? (
                                  <span className="text-[11px] text-slate-400">测试中...</span>
                                ) : stat?.ok === true ? (
                                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                                    ✓ {stat.latencyMs}ms
                                  </span>
                                ) : stat?.ok === false ? (
                                  <span
                                    className="max-w-[140px] truncate rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300"
                                    title={stat.error}
                                  >
                                    ✗ 失败
                                  </span>
                                ) : null}

                                <button
                                  type="button"
                                  onClick={() => void handleTestModel(activeProvider, m)}
                                  className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10"
                                  title="测试连通性与延迟"
                                >
                                  <Activity className="h-3 w-3 text-sky-400" />
                                  测速
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveModel(activeProvider, m)}
                                  className="rounded p-1 text-slate-500 hover:text-rose-400"
                                  title="移除模型"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: SKILLS (Markdown Upload / Download + Live Preview Editor) */}
            {tab === 'skills' && (
              <div className="flex flex-col gap-4 md:h-full md:flex-row">
                <div className="flex w-full shrink-0 flex-col gap-2 border-b border-white/10 pb-3 md:w-48 md:border-b-0 md:border-r md:pb-0 md:pr-3">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleAddSkill}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-white/20 py-1.5 text-sky-300 hover:border-sky-400 hover:bg-sky-500/10"
                    >
                      <Plus className="h-3.5 w-3.5" /> 新建
                    </button>
                    <button
                      type="button"
                      onClick={() => skillUploadRef.current?.click()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/5 py-1.5 text-slate-200 hover:bg-white/10"
                      title="上传本地 .md Skill 文件"
                    >
                      <Upload className="h-3.5 w-3.5 text-violet-400" /> 上传 MD
                    </button>
                    <input
                      ref={skillUploadRef}
                      type="file"
                      accept=".md,.markdown,.txt"
                      className="hidden"
                      onChange={(e) => {
                        void handleUploadSkillMd(e.target.files?.[0] ?? null);
                        e.target.value = '';
                      }}
                    />
                  </div>

                  <div className="space-y-1 overflow-y-auto">
                    {settings.skills.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedSkillId(s.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                          s.id === activeSkill?.id
                            ? 'bg-white/10 font-medium text-white'
                            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                        }`}
                      >
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                        <span className="truncate">{s.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {activeSkill ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 p-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setSkillMdMode('edit')}
                          className={`rounded px-2 py-0.5 ${
                            skillMdMode === 'edit'
                              ? 'bg-sky-500/25 text-sky-300'
                              : 'text-slate-400'
                          }`}
                        >
                          源码
                        </button>
                        <button
                          type="button"
                          onClick={() => setSkillMdMode('split')}
                          className={`flex items-center gap-1 rounded px-2 py-0.5 ${
                            skillMdMode === 'split'
                              ? 'bg-sky-500/25 text-sky-300'
                              : 'text-slate-400'
                          }`}
                        >
                          <Columns2 className="h-3 w-3" /> 分栏
                        </button>
                        <button
                          type="button"
                          onClick={() => setSkillMdMode('preview')}
                          className={`flex items-center gap-1 rounded px-2 py-0.5 ${
                            skillMdMode === 'preview'
                              ? 'bg-sky-500/25 text-sky-300'
                              : 'text-slate-400'
                          }`}
                        >
                          <Eye className="h-3 w-3" /> 预览
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {skillSavedNotice && (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                            <Check className="h-3.5 w-3.5" /> 已保存
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={handleDownloadSkillMd}
                          className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300 hover:bg-white/10"
                          title="下载为 .md 文件"
                        >
                          <Download className="h-3.5 w-3.5" /> 下载 MD
                        </button>
                        {skillDirty && (
                          <button
                            type="button"
                            onClick={handleSaveSkillDraft}
                            className="flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1 font-medium text-white hover:bg-sky-400"
                          >
                            <Save className="h-3.5 w-3.5" /> 保存
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteSkill(activeSkill.id)}
                          className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10"
                          title="删除 Skill"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-slate-400">Skill 名称</label>
                        <input
                          value={skillDraft.name}
                          onChange={(e) =>
                            setSkillDraft((d) => ({ ...d, name: e.target.value }))
                          }
                          className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-slate-400">简短描述</label>
                        <input
                          value={skillDraft.description}
                          onChange={(e) =>
                            setSkillDraft((d) => ({ ...d, description: e.target.value }))
                          }
                          className="w-full rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    {/* Markdown Editor + Live Preview */}
                    <div className="flex min-h-[260px] flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#090d14]">
                      {skillMdMode !== 'preview' && (
                        <textarea
                          value={skillDraft.content}
                          onChange={(e) =>
                            setSkillDraft((d) => ({ ...d, content: e.target.value }))
                          }
                          placeholder="# 在此编写 Markdown 格式的运维或开发规范..."
                          className={`h-full resize-none bg-transparent p-3.5 font-mono text-xs leading-relaxed text-slate-200 outline-none ${
                            skillMdMode === 'split'
                              ? 'w-1/2 border-r border-white/10'
                              : 'w-full'
                          }`}
                        />
                      )}
                      {skillMdMode !== 'edit' && (
                        <div
                          className={`h-full overflow-y-auto p-4 text-xs leading-relaxed text-slate-200 ${
                            skillMdMode === 'split' ? 'w-1/2' : 'w-full'
                          } [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 [&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#111827] [&_pre]:p-2.5`}
                          dangerouslySetInnerHTML={{ __html: renderedSkillMd }}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-500">
                    <Sparkles className="h-7 w-7 opacity-40" />
                    <p>点击左侧「新建」或「上传 MD」导入你的个人运维/开发规范</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: PERMISSIONS */}
            {tab === 'permissions' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(
                    [
                      {
                        id: 'manual',
                        title: 'Manual (手动审批)',
                        desc: '除纯只读文件查询外，所有执行与修改均需点击确认',
                      },
                      {
                        id: 'custom',
                        title: 'Custom (自定义分级)',
                        desc: '按下方 5 级危险度与自定义白名单/黑名单精准放行',
                      },
                      {
                        id: 'auto',
                        title: 'Auto (高权限自动)',
                        desc: '常规与系统操作自动放行；高危操作由下方开关控制',
                      },
                    ] as Array<{ id: ApprovalPolicy; title: string; desc: string }>
                  ).map((item) => {
                    const active = settings.approvalPolicy === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          onChangeSettings({ ...settings, approvalPolicy: item.id })
                        }
                        className={`rounded-xl border p-3 text-left transition ${
                          active
                            ? 'border-sky-500/60 bg-sky-500/15'
                            : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="font-semibold text-white">{item.title}</div>
                        <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                          {item.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Mode-specific isolated panels: Manual / Custom / Auto are completely independent */}
                {settings.approvalPolicy === 'manual' && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="mb-1 font-semibold text-white">
                      Manual 模式规则（独立于 Custom / Auto）
                    </div>
                    <p className="mb-3 text-[11px] text-slate-400">
                      最严格的审批策略：仅纯只读文件查询（查看目录、读文件、搜索内容）免打扰，所有终端命令与文件写入均需人工点击「允许」。
                    </p>
                    <div className="space-y-2">
                      {RISK_ORDER.map((lvl) => {
                        const meta = RISK_LEVEL_META[lvl];
                        const isReadonly = lvl === 'readonly';
                        return (
                          <div
                            key={lvl}
                            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#090d14] px-3 py-2 opacity-80"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                              >
                                {meta.label}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {meta.description}
                              </span>
                            </div>
                            <span
                              className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${
                                isReadonly
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              {isReadonly ? '只读工具自动 / 命令行需确认' : '必须人工确认'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {settings.approvalPolicy === 'custom' && (
                  <>
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="mb-1 font-semibold text-white">
                        Custom 专属危险等级配置（仅对 Custom 模式生效）
                      </div>
                      <p className="mb-3 text-[11px] text-slate-400">
                        自由勾选哪些危险等级在 Custom 模式下可以自动执行，不会影响 Manual 或 Auto 模式的设置。
                      </p>
                      <div className="space-y-2.5">
                        {RISK_ORDER.map((lvl) => {
                          const meta = RISK_LEVEL_META[lvl];
                          const isDestructive = lvl === 'destructive';
                          const checked = settings.customRules.autoApproveLevels[lvl];
                          return (
                            <label
                              key={lvl}
                              className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-white/10 bg-[#090d14] p-2.5 hover:border-white/20"
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                                  >
                                    {meta.label}
                                  </span>
                                  {isDestructive && (
                                    <span className="text-[10px] text-rose-400">
                                      {checked
                                        ? '⚠ 已在 Custom 模式下开启自动放行'
                                        : '(默认拦截，勾选后仅在 Custom 下自动放行)'}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-400">
                                  {meta.description}
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  onChangeSettings({
                                    ...settings,
                                    customRules: {
                                      ...settings.customRules,
                                      autoApproveLevels: {
                                        ...settings.customRules.autoApproveLevels,
                                        [lvl]: e.target.checked,
                                      },
                                    },
                                  })
                                }
                                className="mt-1 h-4 w-4 accent-sky-500"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-slate-400">
                        Custom 专属白名单命令前缀（每行一条，非高危命令直接自动放行）
                      </label>
                      <textarea
                        rows={4}
                        value={settings.customRules.allowPrefixes.join('\n')}
                        onChange={(e) =>
                          onChangeSettings({
                            ...settings,
                            customRules: {
                              ...settings.customRules,
                              allowPrefixes: e.target.value.split('\n'),
                            },
                          })
                        }
                        className="w-full rounded-lg border border-white/10 bg-[#090d14] p-2.5 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
                      />
                    </div>
                  </>
                )}

                {settings.approvalPolicy === 'auto' && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="mb-1 font-semibold text-white">
                      Auto 模式规则（仅对 Auto 模式生效，不影响 Custom）
                    </div>
                    <p className="mb-3 text-[11px] text-slate-400">
                      Auto 模式下常规读写、命令与系统服务操作默认全自动执行；高危破坏性操作由下方独立开关控制。
                    </p>
                    <div className="space-y-2.5">
                      {RISK_ORDER.map((lvl) => {
                        const meta = RISK_LEVEL_META[lvl];
                        const isDestructive = lvl === 'destructive';
                        const checked = isDestructive
                          ? Boolean(settings.customRules.autoApproveDestructive)
                          : true;
                        return (
                          <label
                            key={lvl}
                            className={`flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-[#090d14] p-2.5 ${
                              isDestructive
                                ? 'cursor-pointer hover:border-rose-500/40'
                                : 'opacity-75'
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                                >
                                  {meta.label}
                                </span>
                                {isDestructive ? (
                                  <span className="text-[10px] text-rose-400">
                                    {checked
                                      ? '⚠ 已在 Auto 模式下开启全自动放行（高风险）'
                                      : '(默认拦截，勾选后仅在 Auto 下自动执行)'}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-emerald-400">
                                    Auto 模式默认自动放行
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-400">
                                {meta.description}
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!isDestructive}
                              onChange={(e) => {
                                if (!isDestructive) return;
                                onChangeSettings({
                                  ...settings,
                                  customRules: {
                                    ...settings.customRules,
                                    autoApproveDestructive: e.target.checked,
                                  },
                                });
                              }}
                              className="mt-1 h-4 w-4 accent-rose-500 disabled:accent-emerald-500"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-slate-400">
                    全局黑名单正则（每行一条，在所有模式下强制弹窗确认）
                  </label>
                  <textarea
                    rows={3}
                    value={settings.customRules.denyPatterns.join('\n')}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        customRules: {
                          ...settings.customRules,
                          denyPatterns: e.target.value.split('\n'),
                        },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#090d14] p-2.5 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            )}

            {/* TAB 4: APPEARANCE */}
            {tab === 'appearance' && (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 font-semibold text-white">界面色调</div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => onChangeUiMode('dark')}
                      className={`rounded-xl border px-4 py-2.5 transition ${
                        uiMode === 'dark'
                          ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                          : 'border-white/10 bg-white/5 text-slate-400'
                      }`}
                    >
                      暗色模式 (Dark)
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeUiMode('light')}
                      className={`rounded-xl border px-4 py-2.5 transition ${
                        uiMode === 'light'
                          ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                          : 'border-white/10 bg-white/5 text-slate-400'
                      }`}
                    >
                      亮色模式 (Light)
                    </button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-semibold text-white">终端配色主题</div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {TERMINAL_THEMES.map((t) => {
                      const active = terminalThemeId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onChangeTerminalTheme(t.id)}
                          className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                            active
                              ? 'border-sky-500 bg-sky-500/15 text-white'
                              : 'border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]'
                          }`}
                        >
                          <span>{t.name}</span>
                          <span
                            className="h-4 w-4 rounded-full border border-white/20"
                            style={{ backgroundColor: t.theme.background }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: ACCOUNT & PROFILE EXPORT/IMPORT */}
            {tab === 'sync' && (
              <div className="space-y-4">
                {onOpenAuth && onCloudUserChange && onManualSync && (
                  <AccountSyncPanel
                    user={cloudUser}
                    syncStatus={syncStatus}
                    lastSyncedAt={lastSyncedAt}
                    onOpenAuth={onOpenAuth}
                    onUserChange={onCloudUserChange}
                    onManualSync={onManualSync}
                  />
                )}

                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <div className="font-semibold text-white">本地导入 / 导出（跨设备迁移与备份）</div>

                  <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeSecrets}
                      onChange={(e) => setIncludeSecrets(e.target.checked)}
                      className="accent-sky-500"
                    />
                    <span>导出时包含敏感凭证（SSH 密码/私钥 与 AI API Key，取消勾选可用于安全脱敏分享）</span>
                  </label>

                  <div className="flex flex-wrap gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleExportProfile}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 font-medium text-white hover:bg-sky-400"
                    >
                      <Download className="h-4 w-4" />
                      导出全部配置 (.json)
                    </button>

                    <button
                      type="button"
                      onClick={() => importFileRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-4 py-2 font-medium text-slate-200 hover:bg-white/10"
                    >
                      <Upload className="h-4 w-4 text-emerald-400" />
                      导入配置文件 (.json)
                    </button>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        void handleImportProfile(e.target.files?.[0] ?? null);
                        e.target.value = '';
                      }}
                    />
                  </div>

                  {syncMsg && (
                    <div
                      className={`rounded-lg px-3 py-2 text-[11px] ${
                        syncMsg.ok
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      {syncMsg.text}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 6: ABOUT & UPDATE CHECKER */}
            {tab === 'about' && (
              <div className="space-y-4">
                <div className="flex flex-col justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:p-5">
                  <div className="flex items-center gap-4">
                    <img
                      src="./favicon.png"
                      alt="ISSH"
                      className="h-14 w-14 shrink-0 rounded-2xl border border-white/15 bg-[#090d14] p-1 shadow-lg"
                    />
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-white">ISSH</span>
                        <span className="rounded-full border border-sky-500/35 bg-sky-500/15 px-2.5 py-0.5 font-mono text-[11px] font-medium text-sky-300">
                          v{APP_VERSION}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                          {isAndroid
                            ? 'Android 客户端'
                            : isTauriRuntime()
                              ? 'Desktop 客户端'
                              : 'Web 客户端'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        现代高颜值、多端云同步、内置 AI Agent 的跨平台 SSH 工作台
                      </p>
                    </div>
                  </div>

                  {!isWeb && (
                    <button
                      type="button"
                      disabled={checkingUpdate}
                      onClick={async () => {
                        setCheckingUpdate(true);
                        setUpdateErr(null);
                        setUpToDateNotice(false);
                        try {
                          const res = await checkAppUpdate(true);
                          setLocalUpdateInfo(res);
                          onUpdateChecked?.(res);
                          if (!res.hasUpdate) {
                            setUpToDateNotice(true);
                          }
                        } catch (e) {
                          setUpdateErr(e instanceof Error ? e.message : String(e));
                        } finally {
                          setCheckingUpdate(false);
                        }
                      }}
                      className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 font-medium text-white transition hover:bg-sky-400 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${checkingUpdate ? 'animate-spin' : ''}`}
                      />
                      {checkingUpdate ? '检查中...' : '检查更新'}
                    </button>
                  )}
                </div>

                {isWeb && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[11px] text-slate-400">
                    Web 端与服务端一体部署，版本升级由服务器管理员在后台统一维护。
                  </div>
                )}

                {!isWeb && updateErr && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300">
                    {updateErr}
                  </div>
                )}

                {!isWeb && upToDateNotice && !effectiveUpdateInfo?.hasUpdate && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-300">
                    <Check className="h-4 w-4" />
                    <span>当前已是最新版本 (v{APP_VERSION})</span>
                  </div>
                )}

                {!isWeb && effectiveUpdateInfo?.hasUpdate && (() => {
                  const apkAsset = effectiveUpdateInfo.assets.find((a) =>
                    a.name.toLowerCase().endsWith('.apk')
                  );
                  return (
                    <div className="space-y-2.5 rounded-xl border border-emerald-500/35 bg-emerald-500/[0.07] p-4">
                      <div className="font-semibold text-white">
                        发现新版本 {effectiveUpdateInfo.tagName}
                      </div>

                      {effectiveUpdateInfo.notes && (
                        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#090d14] p-3 font-sans text-[11px] leading-relaxed text-slate-300">
                          {effectiveUpdateInfo.notes}
                        </pre>
                      )}

                      {installingUpdate && (
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between text-[11px] text-emerald-300">
                            <span>
                              {installPhase === 'checking'
                                ? '正在校验更新包签名...'
                                : installPhase === 'downloading'
                                  ? `正在下载更新包 (${installProgress}%)...`
                                  : '正在安装并准备重启...'}
                            </span>
                            <span className="font-mono">{installProgress}%</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-emerald-400 transition-all duration-200"
                              style={{ width: `${installProgress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {isAndroid ? (
                          <a
                            href={apkAsset?.downloadUrl || effectiveUpdateInfo.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 font-medium text-white hover:bg-emerald-400"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {apkAsset
                              ? `下载新版 APK (${effectiveUpdateInfo.tagName})`
                              : `前往下载新版 (${effectiveUpdateInfo.tagName})`}
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled={installingUpdate}
                            onClick={async () => {
                              setInstallingUpdate(true);
                              setUpdateErr(null);
                              try {
                                const ok = await installDesktopUpdate((pct, phase) => {
                                  setInstallProgress(pct);
                                  setInstallPhase(phase);
                                });
                                if (!ok) {
                                  setUpToDateNotice(true);
                                }
                              } catch (e) {
                                setUpdateErr(
                                  `自动更新失败：${e instanceof Error ? e.message : String(e)}`
                                );
                              } finally {
                                setInstallingUpdate(false);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {installingUpdate
                              ? '正在更新...'
                              : `一键更新并重启 (${effectiveUpdateInfo.tagName})`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
          </>
        )}
      </div>

      {/* CLIProxy-style Add Provider Preset Picker Modal (with Brand SVG Icons) */}
      {addPickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#111827] text-xs text-slate-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-white">添加 AI 提供商</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  支持同一提供商添加多个实例（如多个 DeepSeek / OpenAI 账号），也支持自定义 OpenAI 兼容中转
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddPickerOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              {(
                [
                  { cat: 'official', title: '官方 API 预设' },
                  { cat: 'aggregator', title: '聚合 / 路由平台' },
                  { cat: 'local', title: '本地模型服务' },
                ] as const
              ).map(({ cat, title }) => (
                <div key={cat}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {title}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {PROVIDER_PRESETS.filter((p) => p.category === cat).map((preset) => {
                      const count = settings.providers.filter(
                        (p) =>
                          p.baseUrl.replace(/\/+$/, '') ===
                            preset.baseUrl.replace(/\/+$/, '') ||
                          p.id.startsWith(`${preset.presetId}-`) ||
                          p.id === preset.presetId
                      ).length;
                      return (
                        <button
                          key={preset.presetId}
                          type="button"
                          onClick={() => handleAddFromPreset(preset)}
                          className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition hover:border-sky-500/50 hover:bg-sky-500/10"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <ProviderIcon
                              presetId={preset.presetId}
                              className="h-7 w-7 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-white">
                                {preset.name}
                              </div>
                              <div className="truncate font-mono text-[10px] text-slate-500">
                                {preset.baseUrl}
                              </div>
                            </div>
                          </div>
                          {count > 0 ? (
                            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                              已接入 {count}
                            </span>
                          ) : (
                            <span className="shrink-0 text-[11px] text-sky-400">
                              + 接入
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Custom OpenAI Compatible with Custom Name */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  自定义提供商 (OpenAI 兼容 / OneAPI / CLIProxy / 自建网关)
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const customPreset = PROVIDER_PRESETS.find(
                      (p) => p.presetId === 'custom-openai'
                    )!;
                    handleAddFromPreset(
                      customPreset,
                      customProviderName.trim() || '自定义 OpenAI 兼容'
                    );
                  }}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <ProviderIcon presetId="custom-openai" className="h-7 w-7 shrink-0" />
                  <input
                    value={customProviderName}
                    onChange={(e) => setCustomProviderName(e.target.value)}
                    placeholder="输入自定义名称（如：CLIProxy 中转 / 公司网关）"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#090d14] px-3 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-lg bg-sky-500 px-4 py-1.5 font-medium text-white hover:bg-sky-400"
                  >
                    + 创建并配置
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
