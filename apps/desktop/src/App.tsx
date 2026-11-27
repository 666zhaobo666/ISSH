import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import {
  Bot,
  Cloud,
  CloudOff,
  Crown,
  FolderTree,
  Moon,
  Palette,
  PanelLeft,
  Plus,
  Server,
  Settings,
  Sun,
  Terminal as TerminalIcon,
  TerminalSquare,
  User,
  X,
} from 'lucide-react';
import type {
  ConnectionStatus,
  HostConfig,
  PtySize,
  SystemMetrics,
} from '@issh/core';
import { appTransport } from './transport';
import { isTauriRuntime } from './transport/runtime';
import {
  TerminalPane,
  type TerminalContextHandle,
} from './components/TerminalPane';
import { MetricsSidebar } from './components/MetricsSidebar';
import { ConnectModal } from './components/ConnectModal';
import { SavedCommandsPane } from './components/SavedCommandsPane';
import { ProcessManagerPane } from './components/ProcessManagerPane';
import { FileManagerPane } from './components/FileManagerPane';
import { HostsManagerPane } from './components/HostsManagerPane';
import { AiSidebar } from './components/AiSidebar';
import { useDeviceLayout } from './hooks/useDeviceLayout';
import { MobileShell, type MobileNavTab } from './mobile/MobileShell';
import type { AiContextSyncPayload } from './components/AiStandaloneWindow';
import { SettingsModal, type SettingsTab } from './components/SettingsModal';
import { AccountAuthModal } from './components/AccountAuthModal';
import {
  SyncConflictModal,
  type ConflictStrategy,
} from './components/SyncConflictModal';
import type { SyncStatusState } from './components/AccountSyncPanel';
import {
  exportUserProfile,
  importUserProfile,
  type IsshUserProfileBundle,
} from './ai/profileBundle';
import {
  fetchMe,
  fetchSyncHeartbeat,
  getCachedCloudUser,
  getCloudToken,
  getSyncMeta,
  pullCloudProfile,
  pullCloudThreads,
  pushCloudProfile,
  pushCloudThreads,
  resolveAvatarUrl,
  setSyncMeta,
  type CloudUser,
} from './cloud/cloudClient';
import {
  mergeAiThreads,
  mergeUserProfiles,
  readLocalThreads,
  writeLocalThreads,
  type LocalAiThread,
} from './cloud/syncEngine';
import {
  checkAppUpdate,
  type UpdateCheckResult,
} from './utils/appVersion';
import {
  loadAiSettings,
  saveAiSettings,
  type AiSettingsState,
} from './ai/settingsStore';
import {
  TERMINAL_THEMES,
  getTerminalThemeById,
} from './themes/terminalThemes';

interface SessionTab {
  tabId: string;
  host: HostConfig;
  sessionId: string | null;
  status: ConnectionStatus;
  error?: string;
  cwd: string;
}

const HOSTS_STORAGE_KEY = 'issh.hosts.v1';
const THEME_STORAGE_KEY = 'issh.terminal_theme.v1';
const UI_MODE_STORAGE_KEY = 'issh.ui_mode.v1';

function loadSavedHosts(): HostConfig[] {
  try {
    const raw = localStorage.getItem(HOSTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HostConfig[]) : [];
  } catch {
    return [];
  }
}

export function App() {
  const [hosts, setHosts] = useState<HostConfig[]>(loadSavedHosts);
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<HostConfig | null>(null);
  const [ptySize, setPtySize] = useState<PtySize>({ cols: 100, rows: 30 });
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const termContextMapRef = useRef<Map<string, TerminalContextHandle>>(new Map());
  const [themeId, setThemeId] = useState<string>(
    () => localStorage.getItem(THEME_STORAGE_KEY) ?? 'tokyo-night'
  );
  const [bottomTab, setBottomTab] = useState<'files' | 'commands'>('files');
  const [processTabIds, setProcessTabIds] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<'hosts' | 'terminal' | 'process'>('hosts');
  const { mode: deviceMode, isMobileOrTablet, keyboardOpen } = useDeviceLayout();
  const [mobileTab, setMobileTab] = useState<MobileNavTab>('hosts');
  const [showMetrics, setShowMetrics] = useState(true);
  const [showAi, setShowAi] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettingsState>(loadAiSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers');
  const [uiMode, setUiMode] = useState<'dark' | 'light'>(
    () => (localStorage.getItem(UI_MODE_STORAGE_KEY) as 'dark' | 'light') ?? 'dark'
  );

  // Cloud Account & VIP Heartbeat Sync state
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(getCachedCloudUser);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusState>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(() => getSyncMeta().lastSyncedAt);
  const [conflictState, setConflictState] = useState<{
    localProfile: IsshUserProfileBundle;
    cloudProfile: IsshUserProfileBundle;
    localThreads: LocalAiThread[];
    cloudThreads: LocalAiThread[];
    cloudProfileVersion: number;
    cloudThreadsMaxVer: number;
  } | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const suppressNextPushRef = useRef(false);
  const pushTimerRef = useRef<number | null>(null);

  const applyBundleToState = (bundle: IsshUserProfileBundle) => {
    suppressNextPushRef.current = true;
    importUserProfile(JSON.stringify(bundle));
    setHosts(bundle.hosts);
    setAiSettings(bundle.aiSettings);
    setUiMode(bundle.appearance.uiMode);
    setThemeId(bundle.appearance.terminalThemeId);
    window.setTimeout(() => {
      suppressNextPushRef.current = false;
    }, 300);
  };

  const runSyncCycle = async (
    interactiveOnDivergence = false,
    userOverride?: CloudUser | null
  ) => {
    const activeUser = userOverride !== undefined ? userOverride : cloudUser;
    if (!activeUser || !getCloudToken()) return;
    setSyncStatus('syncing');
    try {
      const hb = await fetchSyncHeartbeat();
      if (
        hb.vipActive !== activeUser.vipActive ||
        hb.vipExpireAt !== activeUser.vipExpireAt
      ) {
        const refreshed = {
          ...activeUser,
          vipActive: hb.vipActive,
          vipExpireAt: hb.vipExpireAt,
        };
        setCloudUser(refreshed);
      }

      if (!hb.vipActive) {
        setSyncStatus('vip_expired');
        return;
      }

      const meta = getSyncMeta();
      const isDifferentOrInitial =
        meta.userId !== activeUser.id || meta.profileVersion === 0;

      // If VIP renewed or first login and both cloud & local have data -> ask user (Cloud / Local / Merge)
      if (interactiveOnDivergence && hb.hasCloudProfile && isDifferentOrInitial) {
        const localProfile = exportUserProfile(true);
        const localThreads = readLocalThreads();
        const hasLocalData =
          localProfile.hosts.length > 0 ||
          localThreads.some((t) => (t.messages?.length ?? 0) > 0);

        const pulled = await pullCloudProfile();
        const pulledThreadsRes = await pullCloudThreads(0);
        const cloudThreads = pulledThreadsRes.threads
          .filter((t) => !t.deleted && t.data)
          .map((t) => t.data as LocalAiThread);

        if (pulled.exists && pulled.profile && hasLocalData) {
          setConflictState({
            localProfile,
            cloudProfile: pulled.profile,
            localThreads,
            cloudThreads,
            cloudProfileVersion: pulled.version,
            cloudThreadsMaxVer: pulledThreadsRes.maxVersion,
          });
          setSyncStatus('idle');
          return;
        }
        if (pulled.exists && pulled.profile) {
          applyBundleToState(pulled.profile);
          if (cloudThreads.length > 0) writeLocalThreads(cloudThreads);
          const now = Date.now();
          setSyncMeta({
            userId: activeUser.id,
            profileVersion: pulled.version,
            threadsMaxVersion: pulledThreadsRes.maxVersion,
            lastSyncedAt: now,
          });
          setLastSyncedAt(now);
          setSyncStatus('synced');
          return;
        }
      }

      let nextProfileVer = meta.profileVersion;
      let nextThreadsVer = meta.threadsMaxVersion;

      // Pull newer cloud profile if available
      if (hb.hasCloudProfile && hb.profileVersion > meta.profileVersion) {
        const pulled = await pullCloudProfile();
        if (pulled.exists && pulled.profile) {
          applyBundleToState(pulled.profile);
          nextProfileVer = pulled.version;
        }
      } else if (!hb.hasCloudProfile) {
        // First time pushing local profile to empty cloud
        const pushed = await pushCloudProfile(exportUserProfile(true));
        nextProfileVer = pushed.version;
      }

      // Pull incremental AI threads if cloud is ahead
      if (hb.threadsMaxVersion > meta.threadsMaxVersion) {
        const pulledT = await pullCloudThreads(meta.threadsMaxVersion);
        const incoming = pulledT.threads
          .filter((t) => !t.deleted && t.data)
          .map((t) => t.data as LocalAiThread);
        if (incoming.length > 0) {
          const merged = mergeAiThreads(readLocalThreads(), incoming);
          writeLocalThreads(merged);
        }
        nextThreadsVer = pulledT.maxVersion;
      }

      const now = Date.now();
      setSyncMeta({
        userId: activeUser.id,
        profileVersion: nextProfileVer,
        threadsMaxVersion: nextThreadsVer,
        lastSyncedAt: now,
      });
      setLastSyncedAt(now);
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
    }
  };

  const handleResolveConflict = async (strategy: ConflictStrategy) => {
    if (!conflictState || !cloudUser) return;
    setResolvingConflict(true);
    try {
      let finalProfile: IsshUserProfileBundle;
      let finalThreads: LocalAiThread[];

      if (strategy === 'cloud') {
        finalProfile = conflictState.cloudProfile;
        finalThreads = conflictState.cloudThreads;
      } else if (strategy === 'local') {
        finalProfile = conflictState.localProfile;
        finalThreads = conflictState.localThreads;
      } else {
        finalProfile = mergeUserProfiles(
          conflictState.localProfile,
          conflictState.cloudProfile
        );
        finalThreads = mergeAiThreads(
          conflictState.localThreads,
          conflictState.cloudThreads
        );
      }

      applyBundleToState(finalProfile);
      writeLocalThreads(finalThreads);

      let profileVer = conflictState.cloudProfileVersion;
      let threadsVer = conflictState.cloudThreadsMaxVer;
      if (strategy !== 'cloud') {
        const pushed = await pushCloudProfile(finalProfile);
        profileVer = pushed.version;
        if (finalThreads.length > 0) {
          const pushedT = await pushCloudThreads(
            finalThreads.map((t) => ({
              threadId: t.id,
              deleted: false,
              updatedAt: t.updatedAt ?? Date.now(),
              data: t,
            }))
          );
          threadsVer = pushedT.maxVersion;
        }
      }

      const now = Date.now();
      setSyncMeta({
        userId: cloudUser.id,
        profileVersion: profileVer,
        threadsMaxVersion: threadsVer,
        lastSyncedAt: now,
      });
      setLastSyncedAt(now);
      setSyncStatus('synced');
      setConflictState(null);
    } catch {
      setSyncStatus('error');
    } finally {
      setResolvingConflict(false);
    }
  };

  // Silent startup update check (server-cached GitHub Releases -> fallback direct GitHub)
  useEffect(() => {
    void checkAppUpdate(false)
      .then((res) => setUpdateInfo(res))
      .catch(() => {});
  }, []);

  // Refresh user profile on startup if logged in
  useEffect(() => {
    if (!getCloudToken()) return;
    fetchMe()
      .then((u) => {
        setCloudUser(u);
        void runSyncCycle(false, u);
      })
      .catch(() => {
        // offline or token expired; keep local usage unrestricted
      });
  }, []);

  // 30-second lightweight heartbeat sync for logged-in users
  useEffect(() => {
    if (!cloudUser) return;
    const timer = window.setInterval(() => {
      void runSyncCycle(false);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [cloudUser]);

  // Debounced silent push (2.5s) when VIP user modifies hosts/AI settings/theme
  useEffect(() => {
    if (!cloudUser?.vipActive || suppressNextPushRef.current || conflictState) return;
    if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        const pushed = await pushCloudProfile(exportUserProfile(true));
        const localT = readLocalThreads().filter((t) => (t.messages?.length ?? 0) > 0);
        let threadsVer = getSyncMeta().threadsMaxVersion;
        if (localT.length > 0) {
          const pt = await pushCloudThreads(
            localT.map((t) => ({
              threadId: t.id,
              deleted: false,
              updatedAt: t.updatedAt ?? Date.now(),
              data: t,
            }))
          );
          threadsVer = pt.maxVersion;
        }
        const now = Date.now();
        setSyncMeta({
          userId: cloudUser.id,
          profileVersion: pushed.version,
          threadsMaxVersion: threadsVer,
          lastSyncedAt: now,
        });
        setLastSyncedAt(now);
        setSyncStatus('synced');
      } catch {
        setSyncStatus('error');
      }
    }, 2500);
    return () => {
      if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
    };
  }, [hosts, aiSettings, uiMode, themeId, cloudUser?.vipActive]);

  const handleUpdateAiSettings = (next: AiSettingsState) => {
    setAiSettings(next);
    saveAiSettings(next);
  };

  const openSettings = (tab: SettingsTab = 'providers') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  useEffect(() => {
    const root = document.documentElement;
    if (uiMode === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
    localStorage.setItem(UI_MODE_STORAGE_KEY, uiMode);
  }, [uiMode]);

  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;
  const currentTheme = getTerminalThemeById(themeId);

  const buildConnectedContexts = () =>
    tabs
      .filter((t) => t.status === 'connected' && t.sessionId)
      .map((t) => {
        const ctxHandle = termContextMapRef.current.get(t.tabId);
        return {
          sessionId: t.sessionId!,
          targetName: t.host.name,
          hostLabel: `${t.host.username}@${t.host.host}:${t.host.port}`,
          host: t.host.host,
          port: t.host.port,
          username: t.host.username,
          cwd: t.cwd,
          osName: t.tabId === activeTab?.tabId ? metrics?.osName : undefined,
          metrics: t.tabId === activeTab?.tabId ? metrics : undefined,
          selectedText: ctxHandle?.getSelection(),
          recentOutput: ctxHandle?.getRecentOutput(150),
        };
      });

  const buildContextsRef = useRef(buildConnectedContexts);
  buildContextsRef.current = buildConnectedContexts;
  const syncMetaRef = useRef({
    activeSessionId: activeTab?.sessionId ?? null,
    uiMode,
    themeId,
  });
  syncMetaRef.current = {
    activeSessionId: activeTab?.sessionId ?? null,
    uiMode,
    themeId,
  };

  // Broadcast live SSH contexts & UI theme to the standalone AI OS window (Desktop only)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const payload: AiContextSyncPayload = {
      activeSessionId: activeTab?.sessionId ?? null,
      connectedContexts: buildConnectedContexts(),
      uiMode,
      terminalThemeId: themeId,
    };
    void emit('issh-ai-context-sync', payload);
  }, [tabs, activeTabId, metrics, uiMode, themeId]);

  // Handle requests & redock events from the standalone AI OS window + localStorage sync
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  const connectRef = useRef<(host: HostConfig) => Promise<void>>(async () => {});

  useEffect(() => {
    let unlistenReq: (() => void) | null = null;
    let unlistenRedock: (() => void) | null = null;
    let unlistenConnect: (() => void) | null = null;

    if (isTauriRuntime()) {
      void listen('issh-ai-request-context', () => {
        const payload: AiContextSyncPayload = {
          activeSessionId: syncMetaRef.current.activeSessionId,
          connectedContexts: buildContextsRef.current(),
          uiMode: syncMetaRef.current.uiMode,
          terminalThemeId: syncMetaRef.current.themeId,
        };
        void emit('issh-ai-context-sync', payload);
      }).then((fn) => {
        unlistenReq = fn;
      });

      void listen('issh-ai-redock', () => {
        setShowAi(true);
      }).then((fn) => {
        unlistenRedock = fn;
      });

      void listen<{ hostId: string }>('issh-ai-connect-host', (event) => {
        const target = hostsRef.current.find((h) => h.id === event.payload.hostId);
        if (target) {
          void connectRef.current(target);
        }
      }).then((fn) => {
        unlistenConnect = fn;
      });
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'issh.ai_settings.v1') {
        setAiSettings(loadAiSettings());
      } else if (e.key === UI_MODE_STORAGE_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
        setUiMode(e.newValue);
      } else if (e.key === THEME_STORAGE_KEY && e.newValue) {
        setThemeId(e.newValue);
      } else if (e.key === HOSTS_STORAGE_KEY) {
        setHosts(loadSavedHosts());
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      unlistenReq?.();
      unlistenRedock?.();
      unlistenConnect?.();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Disable default browser context menu & Ctrl+Shift+C/I DevTools shortcut
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyC' || e.code === 'KeyI')) {
        e.preventDefault();
      }
    };
    window.addEventListener('contextmenu', onCtx);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  const handleThemeChange = (id: string) => {
    setThemeId(id);
    localStorage.setItem(THEME_STORAGE_KEY, id);
  };

  const handleOpenProcessManager = () => {
    if (!activeTab?.sessionId) return;
    if (!processTabIds.includes(activeTab.tabId)) {
      setProcessTabIds((prev) => [...prev, activeTab.tabId]);
    }
    setActiveView('process');
  };

  const handleCloseProcessTab = (tabId: string) => {
    setProcessTabIds((prev) => prev.filter((id) => id !== tabId));
    if (activeTabId === tabId) {
      setActiveView('terminal');
    }
  };

  const handleSendCommand = (command: string, execute: boolean) => {
    if (!activeTab?.sessionId) return;
    void appTransport.writePty(
      activeTab.sessionId,
      execute ? `${command}\r` : command
    );
  };

  const saveHost = (host: HostConfig) => {
    setHosts((prev) => {
      const idx = prev.findIndex((h) => h.id === host.id);
      const next =
        idx >= 0
          ? prev.map((h) => (h.id === host.id ? host : h))
          : [host, ...prev];
      localStorage.setItem(HOSTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const duplicateHost = (host: HostConfig) => {
    const now = Date.now();
    saveHost({
      ...host,
      id: crypto.randomUUID(),
      name: `${host.name} (副本)`,
      createdAt: now,
      updatedAt: now,
    });
  };

  const deleteHost = (id: string) => {
    setHosts((prev) => {
      const next = prev.filter((h) => h.id !== id);
      localStorage.setItem(HOSTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleConnect = async (host: HostConfig) => {
    const tabId = crypto.randomUUID();
    const newTab: SessionTab = {
      tabId,
      host,
      sessionId: null,
      status: 'connecting',
      cwd: '~',
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setActiveView('terminal');
    setMobileTab('terminal');
    setMetrics(null);

    try {
      const sessionId = await appTransport.connect(host, ptySize);
      setTabs((prev) =>
        prev.map((t) =>
          t.tabId === tabId ? { ...t, sessionId, status: 'connected' } : t
        )
      );

      appTransport.onStatusChange(sessionId, (status, error) => {
        setTabs((prev) =>
          prev.map((t) => (t.tabId === tabId ? { ...t, status, error } : t))
        );
      });

      appTransport.onCwdChange(sessionId, (cwd) => {
        setTabs((prev) =>
          prev.map((t) => (t.tabId === tabId ? { ...t, cwd } : t))
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTabs((prev) =>
        prev.map((t) =>
          t.tabId === tabId ? { ...t, status: 'error', error: msg } : t
        )
      );
    }
  };
  connectRef.current = handleConnect;

  const handleCloseTab = async (tab: SessionTab) => {
    if (tab.sessionId) {
      await appTransport.disconnect(tab.sessionId).catch(() => {});
    }
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.tabId !== tab.tabId);
      if (activeTabId === tab.tabId) {
        const fallback = remaining[remaining.length - 1]?.tabId ?? null;
        setActiveTabId(fallback);
        if (!fallback) setActiveView('hosts');
      }
      return remaining;
    });
  };

  // Poll zero-intrusion system metrics every 1.5s for the active connected tab
  useEffect(() => {
    const sid = activeTab?.status === 'connected' ? activeTab.sessionId : null;
    if (!sid) {
      setMetrics(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const data = await appTransport.fetchMetrics(sid);
        if (!cancelled) setMetrics(data);
      } catch {
        // ignore transient poll errors
      }
    };

    void poll();
    const timer = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab?.sessionId, activeTab?.status]);

  // On Web browser, require login before entering workspace (Desktop stays 100% free & offline)
  if (!isTauriRuntime() && !cloudUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0b0f17] text-slate-200">
        <AccountAuthModal
          open={true}
          required={true}
          hideServerUrl={true}
          onClose={() => {}}
          onAuthenticated={(u) => {
            setCloudUser(u);
            if (!u.vipActive) {
              setHosts([]);
            } else {
              void runSyncCycle(true, u);
            }
          }}
        />
      </div>
    );
  }

  // Dedicated Termius-style Touch Shell for Android/iOS Phones & Tablets
  if (isMobileOrTablet) {
    return (
      <>
        <MobileShell
          isTablet={deviceMode === 'tablet'}
          keyboardOpen={keyboardOpen}
          activeTab={mobileTab}
          onChangeTab={setMobileTab}
          hosts={hosts}
          tabs={tabs}
          activeSessionTabId={activeTabId}
          onSelectSessionTab={(id) => {
            setActiveTabId(id);
            setActiveView('terminal');
          }}
          onCloseSessionTab={(tabId) => {
            const target = tabs.find((t) => t.tabId === tabId);
            if (target) void handleCloseTab(target);
          }}
          metrics={metrics}
          terminalTheme={currentTheme.theme}
          transport={appTransport}
          onReadyPty={setPtySize}
          onRegisterTermContext={(tabId, handle) => {
            termContextMapRef.current.set(tabId, handle);
          }}
          connectedContexts={buildConnectedContexts()}
          aiSettings={aiSettings}
          onChangeAiSettings={handleUpdateAiSettings}
          onConnectHost={(h) => void handleConnect(h)}
          onNewHost={() => {
            setEditingHost(null);
            setConnectModalOpen(true);
          }}
          onEditHost={(h) => {
            setEditingHost(h);
            setConnectModalOpen(true);
          }}
          onDuplicateHost={duplicateHost}
          onDeleteHost={deleteHost}
          onSendCommand={handleSendCommand}
          uiMode={uiMode}
          onToggleUiMode={() =>
            setUiMode((m) => (m === 'dark' ? 'light' : 'dark'))
          }
          onOpenSettings={openSettings}
          onOpenAuth={() => setAuthModalOpen(true)}
          cloudUser={cloudUser}
          updateInfo={updateInfo}
        />

        <SettingsModal
          open={settingsOpen}
          initialTab={settingsTab}
          settings={aiSettings}
          uiMode={uiMode}
          terminalThemeId={themeId}
          onChangeSettings={handleUpdateAiSettings}
          onChangeUiMode={setUiMode}
          onChangeTerminalTheme={handleThemeChange}
          onProfileImported={(bundle: IsshUserProfileBundle) => {
            setHosts(bundle.hosts);
            setAiSettings(bundle.aiSettings);
            setUiMode(bundle.appearance.uiMode);
            setThemeId(bundle.appearance.terminalThemeId);
          }}
          cloudUser={cloudUser}
          syncStatus={syncStatus}
          lastSyncedAt={lastSyncedAt}
          onOpenAuth={() => setAuthModalOpen(true)}
          onCloudUserChange={(nextUser) => {
            setCloudUser(nextUser);
            if (!nextUser) setSyncStatus('idle');
          }}
          onManualSync={() => void runSyncCycle(true)}
          updateInfo={updateInfo}
          onUpdateChecked={setUpdateInfo}
          onClose={() => setSettingsOpen(false)}
        />

        <AccountAuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={(u) => {
            setCloudUser(u);
            void runSyncCycle(true, u);
          }}
        />

        {conflictState && (
          <SyncConflictModal
            open={true}
            localProfile={conflictState.localProfile}
            cloudProfile={conflictState.cloudProfile}
            localThreadsCount={conflictState.localThreads.length}
            cloudThreadsCount={conflictState.cloudThreads.length}
            busy={resolvingConflict}
            onResolve={(strategy) => void handleResolveConflict(strategy)}
            onCancel={() => setConflictState(null)}
          />
        )}

        <ConnectModal
          open={connectModalOpen}
          editingHost={editingHost}
          existingGroups={Array.from(
            new Set(hosts.map((h) => h.group?.trim()).filter(Boolean) as string[])
          )}
          onClose={() => {
            setConnectModalOpen(false);
            setEditingHost(null);
          }}
          onSaveHost={(h, connectNow) => {
            saveHost(h);
            if (connectNow) void handleConnect(h);
          }}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0b0f17] text-slate-200">
      {/* Top Tab Bar */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[#101622]/90 px-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveView('hosts')}
            className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
              activeView === 'hosts' || tabs.length === 0
                ? 'border-sky-500/40 bg-sky-500/20 text-sky-300'
                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
            title="打开主机管理（分组 / 标签）"
          >
            <Server className="h-3.5 w-3.5" />
            <span>主机管理</span>
          </button>

          {tabs.map((tab) => {
            const isActive = tab.tabId === activeTabId && activeView === 'terminal';
            const dotColor =
              tab.status === 'connected'
                ? 'bg-emerald-400'
                : tab.status === 'connecting'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-rose-400';

            return (
              <div key={tab.tabId} className="flex shrink-0 items-center gap-1.5">
                <div
                  className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition ${
                    isActive
                      ? 'border-sky-500/40 bg-white/10 text-white'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTabId(tab.tabId);
                      setActiveView('terminal');
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                    <span className="max-w-[140px] truncate">{tab.host.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCloseTab(tab)}
                    className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                {processTabIds.includes(tab.tabId) && (
                  <div
                    className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition ${
                      tab.tabId === activeTabId && activeView === 'process'
                        ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                        : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTabId(tab.tabId);
                        setActiveView('process');
                      }}
                    >
                      进程-{tab.host.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCloseProcessTab(tab.tabId)}
                      className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setEditingHost(null);
              setConnectModalOpen(true);
            }}
            className="flex shrink-0 items-center gap-1 rounded-md border border-dashed border-white/15 px-2 py-1 text-xs text-slate-400 transition hover:border-sky-400/50 hover:text-sky-300"
            title="新建主机"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建主机</span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
          {activeView !== 'hosts' && tabs.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMetrics((v) => !v)}
              className={`rounded-md border p-1 transition ${
                showMetrics
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'
              }`}
              title="显示/隐藏左侧监控栏"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAi((v) => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-0.5 transition ${
              showAi
                ? 'border-violet-500/40 bg-violet-500/20 text-violet-300'
                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
            title="展开/收起 AI 助手"
          >
            <Bot className="h-3.5 w-3.5 text-violet-400" />
            <span>AI</span>
          </button>
          <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
            <Palette className="h-3.5 w-3.5 text-sky-400" />
            <select
              value={themeId}
              onChange={(e) => handleThemeChange(e.target.value)}
              className="bg-transparent text-xs text-slate-200 outline-none"
              title="切换终端主题"
            >
              {TERMINAL_THEMES.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#111827] text-slate-200">
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setUiMode((m) => (m === 'dark' ? 'light' : 'dark'))}
            className="rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10"
            title={uiMode === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {uiMode === 'light' ? (
              <Sun className="h-3.5 w-3.5 text-amber-400" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-indigo-400" />
            )}
          </button>
          <button
            type="button"
            onClick={() => openSettings(updateInfo?.hasUpdate ? 'about' : 'providers')}
            className="relative rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            title={
              updateInfo?.hasUpdate
                ? `发现新版本 ${updateInfo.tagName}（点击查看）`
                : '软件设置 (AI 模型 / Skills / 权限 / 外观 / 账号 / 关于)'
            }
          >
            <Settings className="h-3.5 w-3.5" />
            {updateInfo?.hasUpdate && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-[#101622]" />
            )}
          </button>

          {/* Compact User Avatar + VIP Badge + Sync Indicator Pill */}
          {cloudUser ? (
            <button
              type="button"
              onClick={() => openSettings('sync')}
              className="flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] pl-1 pr-2.5 text-[11px] text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
              title={
                cloudUser.vipActive
                  ? syncStatus === 'syncing'
                    ? '云同步中...'
                    : 'VIP 无感云同步已开启'
                  : '普通用户 / VIP 已过期（点击管理账号与激活卡密）'
              }
            >
              {cloudUser.avatarUrl ? (
                <img
                  src={resolveAvatarUrl(cloudUser.avatarUrl)}
                  alt=""
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/25 text-[10px] font-semibold text-sky-300">
                  {(cloudUser.nickname || cloudUser.email)[0]?.toUpperCase()}
                </span>
              )}
              <span className="max-w-[72px] truncate font-medium">
                {cloudUser.nickname || cloudUser.email}
              </span>
              {cloudUser.vipActive ? (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/35 bg-amber-500/15 px-1.5 py-[1px] text-[9px] font-semibold leading-none text-amber-300">
                  <Crown className="h-2.5 w-2.5" />
                  VIP
                </span>
              ) : null}
              {cloudUser.vipActive ? (
                <Cloud
                  className={`h-3 w-3 ${
                    syncStatus === 'syncing'
                      ? 'animate-pulse text-sky-400'
                      : syncStatus === 'error'
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                  }`}
                />
              ) : (
                <CloudOff className="h-3 w-3 text-slate-500" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-slate-300 transition hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-300"
              title="登录云账号（本地功能免费无限制）"
            >
              <User className="h-3.5 w-3.5" />
              <span>登录</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex min-h-0 flex-1">
        {/* Left: Real-time System Metrics (hidden in Hosts Manager view) */}
        {activeView !== 'hosts' && tabs.length > 0 && showMetrics && (
          <MetricsSidebar
            metrics={metrics}
            connected={activeTab?.status === 'connected'}
            onOpenProcessManager={handleOpenProcessManager}
          />
        )}

        {/* Center: Hosts Manager / Process Manager / Terminal+File Pane */}
        {(activeView === 'hosts' || tabs.length === 0) && (
          <main className="flex min-w-0 flex-1 flex-col">
            <HostsManagerPane
              hosts={hosts}
              onConnect={(h) => void handleConnect(h)}
              onNewHost={() => {
                setEditingHost(null);
                setConnectModalOpen(true);
              }}
              onEditHost={(h) => {
                setEditingHost(h);
                setConnectModalOpen(true);
              }}
              onDuplicateHost={duplicateHost}
              onDeleteHost={deleteHost}
            />
          </main>
        )}
        {activeView === 'process' && activeTab?.sessionId && (
          <main className="flex min-w-0 flex-1 flex-col">
            <ProcessManagerPane
              sessionId={activeTab.sessionId}
              transport={appTransport}
            />
          </main>
        )}
        <main
          className={`min-w-0 flex-1 flex-col ${
            activeView !== 'terminal' || tabs.length === 0 ? 'hidden' : 'flex'
          }`}
        >
          {/* Terminal Pane */}
          <section className="flex min-h-0 flex-[3] flex-col border-b border-white/10 bg-[#090d14]">
            <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <TerminalIcon className="h-3.5 w-3.5 text-emerald-400" />
                <span>
                  {activeTab
                    ? `${activeTab.host.username}@${activeTab.host.host}`
                    : 'SSH 终端 (xterm.js WebGL)'}
                </span>
              </div>
              {activeTab?.error && (
                <span className="truncate text-rose-400">{activeTab.error}</span>
              )}
            </div>

            <div className="min-h-0 flex-1">
              {tabs.length > 0 ? (
                tabs.map((tab) => (
                  <TerminalPane
                    key={tab.tabId}
                    sessionId={tab.sessionId}
                    status={tab.status}
                    error={tab.error}
                    hostLabel={`${tab.host.username}@${tab.host.host}:${tab.host.port}`}
                    active={tab.tabId === activeTabId}
                    theme={currentTheme.theme}
                    transport={appTransport}
                    onReady={setPtySize}
                    onRegisterContext={(handle) => {
                      termContextMapRef.current.set(tab.tabId, handle);
                    }}
                  />
                ))
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-slate-500">
                  <p>点击上方「新建连接」开始连接你的 Linux 服务器</p>
                  <button
                    type="button"
                    onClick={() => setConnectModalOpen(true)}
                    className="rounded-lg bg-sky-500/20 px-3.5 py-2 text-sky-300 transition hover:bg-sky-500/30"
                  >
                    + 添加 / 选择主机
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* File Manager & Saved Commands Pane */}
          <section className="flex min-h-0 flex-[2] flex-col bg-[#0d121c]">
            <div className="flex items-center justify-between border-b border-white/5 px-3 py-1 text-xs text-slate-400">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setBottomTab('files')}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition ${
                    bottomTab === 'files'
                      ? 'bg-white/10 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FolderTree className="h-3.5 w-3.5 text-amber-400" />
                  <span>文件管理</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBottomTab('commands')}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition ${
                    bottomTab === 'commands'
                      ? 'bg-white/10 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <TerminalSquare className="h-3.5 w-3.5 text-sky-400" />
                  <span>命令</span>
                </button>
              </div>
              <span className="font-mono text-slate-400">
                {activeTab?.cwd ?? '~'}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <div className={`h-full ${bottomTab === 'files' ? 'block' : 'hidden'}`}>
                <FileManagerPane
                  sessionId={activeTab?.sessionId ?? null}
                  terminalCwd={activeTab?.cwd ?? '~'}
                  transport={appTransport}
                />
              </div>
              <div className={`h-full ${bottomTab === 'commands' ? 'block' : 'hidden'}`}>
                <SavedCommandsPane
                  connected={activeTab?.status === 'connected'}
                  onSendCommand={handleSendCommand}
                />
              </div>
            </div>
          </section>
        </main>

        {/* Right: Global Multi-Thread / Multi-Host AI Copilot (collapsed by default) */}
        {showAi && (
          <AiSidebar
            activeSessionId={activeTab?.sessionId ?? null}
            connectedContexts={buildConnectedContexts()}
            savedHosts={hosts}
            onConnectHost={(h) => void handleConnect(h)}
            settings={aiSettings}
            transport={appTransport}
            onChangeSettings={handleUpdateAiSettings}
            onOpenSettings={openSettings}
            onInsertCommand={(cmd) => {
              if (activeTab?.sessionId) {
                void appTransport.writePty(activeTab.sessionId, cmd);
              }
            }}
            onDetachWindow={
              isTauriRuntime()
                ? () => {
                    setShowAi(false);
                    void invoke('open_ai_window', { dark: uiMode === 'dark' });
                  }
                : undefined
            }
            onClose={() => setShowAi(false)}
          />
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        settings={aiSettings}
        uiMode={uiMode}
        terminalThemeId={themeId}
        onChangeSettings={handleUpdateAiSettings}
        onChangeUiMode={setUiMode}
        onChangeTerminalTheme={handleThemeChange}
        onProfileImported={(bundle: IsshUserProfileBundle) => {
          setHosts(bundle.hosts);
          setAiSettings(bundle.aiSettings);
          setUiMode(bundle.appearance.uiMode);
          setThemeId(bundle.appearance.terminalThemeId);
        }}
        cloudUser={cloudUser}
        syncStatus={syncStatus}
        lastSyncedAt={lastSyncedAt}
        onOpenAuth={() => setAuthModalOpen(true)}
        onCloudUserChange={(nextUser) => {
          setCloudUser(nextUser);
          if (!nextUser) {
            setSyncStatus('idle');
          }
        }}
        onManualSync={() => void runSyncCycle(true)}
        updateInfo={updateInfo}
        onUpdateChecked={setUpdateInfo}
        onClose={() => setSettingsOpen(false)}
      />

      <AccountAuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={(u) => {
          setCloudUser(u);
          void runSyncCycle(true, u);
        }}
      />

      {conflictState && (
        <SyncConflictModal
          open={true}
          localProfile={conflictState.localProfile}
          cloudProfile={conflictState.cloudProfile}
          localThreadsCount={conflictState.localThreads.length}
          cloudThreadsCount={conflictState.cloudThreads.length}
          busy={resolvingConflict}
          onResolve={(strategy) => void handleResolveConflict(strategy)}
          onCancel={() => setConflictState(null)}
        />
      )}

      <ConnectModal
        open={connectModalOpen}
        editingHost={editingHost}
        existingGroups={Array.from(
          new Set(hosts.map((h) => h.group?.trim()).filter(Boolean) as string[])
        )}
        onClose={() => {
          setConnectModalOpen(false);
          setEditingHost(null);
        }}
        onSaveHost={(h, connectNow) => {
          saveHost(h);
          if (connectNow) void handleConnect(h);
        }}
      />
    </div>
  );
}

export default App;
