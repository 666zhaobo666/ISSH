import { useState } from 'react';
import {
  Activity,
  Bot,
  Crown,
  FolderTree,
  Moon,
  Plus,
  Server,
  Settings,
  Sun,
  Terminal as TerminalIcon,
  User,
  X,
} from 'lucide-react';
import type { ITheme } from '@xterm/xterm';
import type {
  ConnectionStatus,
  HostConfig,
  PtySize,
  SystemMetrics,
} from '@issh/core';
import type { AppSshTransport } from '../transport';
import type { AiSettingsState } from '../ai/settingsStore';
import type { TerminalSnapshotContext } from '../ai/aiClient';
import {
  resolveAvatarUrl,
  type CloudUser,
} from '../cloud/cloudClient';
import type { UpdateCheckResult } from '../utils/appVersion';
import type { SettingsTab } from '../components/SettingsModal';
import {
  TerminalPane,
  type TerminalContextHandle,
} from '../components/TerminalPane';
import { TerminalKeybar } from '../components/TerminalKeybar';
import { SavedCommandsPane } from '../components/SavedCommandsPane';
import { AiSidebar } from '../components/AiSidebar';
import { MobileHostsView } from './MobileHostsView';
import { MobileFileManager } from './MobileFileManager';
import { MobileMonitorView } from './MobileMonitorView';

export type MobileNavTab = 'hosts' | 'terminal' | 'files' | 'metrics' | 'ai';

export interface MobileSessionTab {
  tabId: string;
  host: HostConfig;
  sessionId: string | null;
  status: ConnectionStatus;
  error?: string;
  cwd: string;
}

interface MobileShellProps {
  isTablet: boolean;
  keyboardOpen: boolean;
  activeTab: MobileNavTab;
  onChangeTab: (tab: MobileNavTab) => void;
  hosts: HostConfig[];
  tabs: MobileSessionTab[];
  activeSessionTabId: string | null;
  onSelectSessionTab: (tabId: string) => void;
  onCloseSessionTab: (tabId: string) => void;
  metrics: SystemMetrics | null;
  terminalTheme: ITheme;
  transport: AppSshTransport;
  onReadyPty: (size: PtySize) => void;
  onRegisterTermContext: (tabId: string, handle: TerminalContextHandle) => void;
  connectedContexts: TerminalSnapshotContext[];
  aiSettings: AiSettingsState;
  onChangeAiSettings: (next: AiSettingsState) => void;
  onConnectHost: (host: HostConfig) => void;
  onNewHost: () => void;
  onEditHost: (host: HostConfig) => void;
  onDuplicateHost: (host: HostConfig) => void;
  onDeleteHost: (id: string) => void;
  onSendCommand: (cmd: string, autoExecute: boolean) => void;
  uiMode: 'dark' | 'light';
  onToggleUiMode: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onOpenAuth: () => void;
  cloudUser: CloudUser | null;
  updateInfo: UpdateCheckResult | null;
}

const NAV_ITEMS: Array<{
  id: MobileNavTab;
  label: string;
  icon: typeof Server;
}> = [
  { id: 'hosts', label: '主机', icon: Server },
  { id: 'terminal', label: '终端', icon: TerminalIcon },
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'metrics', label: '监控', icon: Activity },
  { id: 'ai', label: 'AI', icon: Bot },
];

export function MobileShell({
  isTablet,
  keyboardOpen,
  activeTab,
  onChangeTab,
  hosts,
  tabs,
  activeSessionTabId,
  onSelectSessionTab,
  onCloseSessionTab,
  metrics,
  terminalTheme,
  transport,
  onReadyPty,
  onRegisterTermContext,
  connectedContexts,
  aiSettings,
  onChangeAiSettings,
  onConnectHost,
  onNewHost,
  onEditHost,
  onDuplicateHost,
  onDeleteHost,
  onSendCommand,
  uiMode,
  onToggleUiMode,
  onOpenSettings,
  onOpenAuth,
  cloudUser,
  updateInfo,
}: MobileShellProps) {
  const [commandsOpen, setCommandsOpen] = useState(false);
  const currentSessionTab =
    tabs.find((t) => t.tabId === activeSessionTabId) ?? null;

  const renderAvatarButton = () =>
    cloudUser ? (
      <button
        type="button"
        onClick={() => onOpenSettings('sync')}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 active:scale-95"
        aria-label="账号与同步"
      >
        {cloudUser.avatarUrl ? (
          <img
            src={resolveAvatarUrl(cloudUser.avatarUrl)}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/25 text-xs font-bold text-sky-300">
            {(cloudUser.nickname || cloudUser.email)[0]?.toUpperCase()}
          </span>
        )}
        {cloudUser.vipActive && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[#0b0f17] shadow">
            <Crown className="h-2.5 w-2.5" />
          </span>
        )}
      </button>
    ) : (
      <button
        type="button"
        onClick={onOpenAuth}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300 active:scale-95"
        aria-label="登录"
      >
        <User className="h-4 w-4" />
      </button>
    );

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#0b0f17] pt-[env(safe-area-inset-top)] text-slate-100">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* TABLET LEFT NAVIGATION RAIL (Termius Touch Tablet Style) */}
        {isTablet && (
          <aside className="flex w-20 shrink-0 flex-col items-center justify-between border-r border-white/10 bg-[#0e1420] py-3">
            <div className="flex flex-col items-center gap-2">
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-[#090d14] p-1.5">
                <img src="./favicon.png" alt="ISSH" className="h-full w-full" />
              </div>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeTab(item.id)}
                    className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium transition active:scale-95 ${
                      active
                        ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                        : 'text-slate-400 active:bg-white/5'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col items-center gap-2.5 pb-1">
              <button
                type="button"
                onClick={onToggleUiMode}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 active:scale-95"
                aria-label="切换亮暗色"
              >
                {uiMode === 'light' ? (
                  <Sun className="h-5 w-5 text-amber-400" />
                ) : (
                  <Moon className="h-5 w-5 text-indigo-400" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenSettings(updateInfo?.hasUpdate ? 'about' : 'providers')}
                className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 active:scale-95"
                aria-label="设置"
              >
                <Settings className="h-5 w-5" />
                {updateInfo?.hasUpdate && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />
                )}
              </button>
              {renderAvatarButton()}
            </div>
          </aside>
        )}

        {/* RIGHT / MAIN CONTENT COLUMN */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top Session Bar (Phone: sessions + actions; Tablet: large touch session strip) */}
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#101622] px-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              {tabs.length > 0 ? (
                <>
                  {tabs.map((t) => {
                    const isCur = t.tabId === activeSessionTabId;
                    return (
                      <div
                        key={t.tabId}
                        onClick={() => {
                          onSelectSessionTab(t.tabId);
                          if (activeTab === 'hosts') onChangeTab('terminal');
                        }}
                        className={`flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-medium transition active:scale-95 ${
                          isCur
                            ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                            : 'border-white/10 bg-white/5 text-slate-400'
                        }`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            t.status === 'connected'
                              ? 'bg-emerald-400'
                              : t.status === 'connecting'
                                ? 'bg-amber-400 animate-pulse'
                                : 'bg-rose-400'
                          }`}
                        />
                        <span className="max-w-[120px] truncate">{t.host.name}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCloseSessionTab(t.tabId);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 active:bg-white/15 active:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={onNewHost}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/20 text-sky-300 active:bg-sky-500/15"
                    aria-label="新建主机"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2.5 px-1">
                  {!isTablet && (
                    <img src="./favicon.png" alt="ISSH" className="h-7 w-7 rounded-lg" />
                  )}
                  <span className="text-base font-bold tracking-tight text-white">
                    ISSH
                  </span>
                </div>
              )}
            </div>

            {!isTablet && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleUiMode}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 active:scale-95"
                >
                  {uiMode === 'light' ? (
                    <Sun className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Moon className="h-4 w-4 text-indigo-400" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOpenSettings(updateInfo?.hasUpdate ? 'about' : 'providers')
                  }
                  className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 active:scale-95"
                >
                  <Settings className="h-4 w-4" />
                  {updateInfo?.hasUpdate && (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />
                  )}
                </button>
                {renderAvatarButton()}
              </div>
            )}
          </header>

          {/* FULL-SCREEN ACTIVE VIEW */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {activeTab === 'hosts' && (
              <MobileHostsView
                hosts={hosts}
                isTablet={isTablet}
                onConnect={onConnectHost}
                onNewHost={onNewHost}
                onEditHost={onEditHost}
                onDuplicateHost={onDuplicateHost}
                onDeleteHost={onDeleteHost}
              />
            )}

            {/* Keep Terminals mounted so SSH sessions never drop on tab switch */}
            <div
              className={`flex h-full w-full flex-col ${
                activeTab === 'terminal' ? 'flex' : 'hidden'
              }`}
            >
              <div className="min-h-0 flex-1 bg-[#0b0f17]">
                {tabs.length > 0 ? (
                  tabs.map((tab) => (
                    <TerminalPane
                      key={tab.tabId}
                      sessionId={tab.sessionId}
                      status={tab.status}
                      error={tab.error}
                      hostLabel={`${tab.host.username}@${tab.host.host}:${tab.host.port}`}
                      active={tab.tabId === activeSessionTabId && activeTab === 'terminal'}
                      theme={terminalTheme}
                      transport={transport}
                      onReady={onReadyPty}
                      onRegisterContext={(handle) =>
                        onRegisterTermContext(tab.tabId, handle)
                      }
                    />
                  ))
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-slate-400">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-sky-400">
                      <TerminalIcon className="h-8 w-8" />
                    </div>
                    <p className="text-sm">尚未连接任何 SSH 会话</p>
                    <button
                      type="button"
                      onClick={() => onChangeTab('hosts')}
                      className="h-11 rounded-xl bg-sky-500 px-6 text-sm font-medium text-white active:scale-95"
                    >
                      选择主机连接
                    </button>
                  </div>
                )}
              </div>
              <TerminalKeybar
                disabled={currentSessionTab?.status !== 'connected'}
                onSendSequence={(seq) => {
                  if (currentSessionTab?.sessionId) {
                    void transport.writePty(currentSessionTab.sessionId, seq);
                  }
                }}
                onOpenCommands={() => setCommandsOpen(true)}
              />
            </div>

            {activeTab === 'files' && (
              <MobileFileManager
                sessionId={currentSessionTab?.sessionId ?? null}
                terminalCwd={currentSessionTab?.cwd ?? '~'}
                transport={transport}
              />
            )}

            {activeTab === 'metrics' && (
              <MobileMonitorView
                metrics={metrics}
                connected={currentSessionTab?.status === 'connected'}
                sessionId={currentSessionTab?.sessionId ?? null}
                isTablet={isTablet}
                transport={transport}
              />
            )}

            {/* 100% Full-Screen AI Workbench */}
            {activeTab === 'ai' && (
              <div className="h-full w-full">
                <AiSidebar
                  standalone
                  activeSessionId={currentSessionTab?.sessionId ?? null}
                  connectedContexts={connectedContexts}
                  savedHosts={hosts}
                  onConnectHost={onConnectHost}
                  settings={aiSettings}
                  transport={transport}
                  onChangeSettings={onChangeAiSettings}
                  onOpenSettings={onOpenSettings}
                  onInsertCommand={(cmd) => {
                    if (currentSessionTab?.sessionId) {
                      void transport.writePty(currentSessionTab.sessionId, cmd);
                      onChangeTab('terminal');
                    }
                  }}
                />
              </div>
            )}
          </div>

          {/* PHONE BOTTOM 5-TAB NAVIGATION BAR (auto-hidden when keyboard opens) */}
          {!isTablet && !keyboardOpen && (
            <nav className="grid shrink-0 grid-cols-5 border-t border-white/10 bg-[#101622] pb-[env(safe-area-inset-bottom)]">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeTab(item.id)}
                    className={`flex h-15 flex-col items-center justify-center gap-1 py-2 text-[11px] transition active:scale-95 ${
                      active ? 'font-semibold text-sky-400' : 'text-slate-400'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      </div>

      {/* Quick Commands Bottom Sheet */}
      {commandsOpen && (
        <div
          onClick={() => setCommandsOpen(false)}
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-[58vh] flex-col rounded-t-3xl border-t border-white/15 bg-[#0e1420] pb-[env(safe-area-inset-bottom)]"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm">
              <span className="font-semibold text-white">常用快捷命令</span>
              <button
                type="button"
                onClick={() => setCommandsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 active:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SavedCommandsPane
                connected={currentSessionTab?.status === 'connected'}
                onSendCommand={(cmd, autoExec) => {
                  onSendCommand(cmd, autoExec);
                  setCommandsOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
