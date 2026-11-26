import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import type { HostConfig } from '@issh/core';
import { tauriTransport } from '../transport/TauriSshTransport';
import type { TerminalSnapshotContext } from '../ai/aiClient';
import {
  loadAiSettings,
  saveAiSettings,
  type AiSettingsState,
} from '../ai/settingsStore';
import type { IsshUserProfileBundle } from '../ai/profileBundle';
import { AiSidebar } from './AiSidebar';
import { SettingsModal, type SettingsTab } from './SettingsModal';

export interface AiContextSyncPayload {
  activeSessionId: string | null;
  connectedContexts: TerminalSnapshotContext[];
  uiMode: 'dark' | 'light';
  terminalThemeId: string;
}

const UI_MODE_STORAGE_KEY = 'issh.ui_mode.v1';
const THEME_STORAGE_KEY = 'issh.terminal_theme.v1';
const HOSTS_STORAGE_KEY = 'issh.hosts.v1';

function loadSavedHosts(): HostConfig[] {
  try {
    const raw = localStorage.getItem(HOSTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HostConfig[]) : [];
  } catch {
    return [];
  }
}

export function AiStandaloneWindow() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [connectedContexts, setConnectedContexts] = useState<
    TerminalSnapshotContext[]
  >([]);
  const [savedHosts, setSavedHosts] = useState<HostConfig[]>(loadSavedHosts);
  const [aiSettings, setAiSettings] = useState<AiSettingsState>(loadAiSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers');
  const [uiMode, setUiMode] = useState<'dark' | 'light'>(
    () => (localStorage.getItem(UI_MODE_STORAGE_KEY) as 'dark' | 'light') ?? 'dark'
  );
  const [themeId, setThemeId] = useState<string>(
    () => localStorage.getItem(THEME_STORAGE_KEY) ?? 'tokyo-night'
  );

  // Reveal native window only after first paint (eliminates white flash)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      void invoke('show_ai_window');
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Sync light/dark class on <html>
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

  // Listen for live SSH contexts & UI mode from the main ISSH window
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<AiContextSyncPayload>('issh-ai-context-sync', (event) => {
      setActiveSessionId(event.payload.activeSessionId);
      setConnectedContexts(event.payload.connectedContexts);
      if (event.payload.uiMode) {
        setUiMode(event.payload.uiMode);
      }
      if (event.payload.terminalThemeId) {
        setThemeId(event.payload.terminalThemeId);
      }
    }).then((fn) => {
      unlisten = fn;
      void emit('issh-ai-request-context');
    });

    // Request fresh terminal snapshots whenever user focuses the AI window
    const onFocus = () => {
      void emit('issh-ai-request-context');
    };
    window.addEventListener('focus', onFocus);

    // Sync settings & theme changes made in the main window via localStorage
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'issh.ai_settings.v1') {
        setAiSettings(loadAiSettings());
      } else if (e.key === UI_MODE_STORAGE_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
        setUiMode(e.newValue);
      } else if (e.key === THEME_STORAGE_KEY && e.newValue) {
        setThemeId(e.newValue);
      } else if (e.key === HOSTS_STORAGE_KEY) {
        setSavedHosts(loadSavedHosts());
      }
    };
    window.addEventListener('storage', onStorage);

    // Disable default browser context menu
    const onCtx = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onCtx);

    return () => {
      unlisten?.();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('contextmenu', onCtx);
    };
  }, []);

  const handleUpdateAiSettings = (next: AiSettingsState) => {
    setAiSettings(next);
    saveAiSettings(next);
  };

  const handleRedock = async () => {
    await emit('issh-ai-redock');
    await invoke('close_ai_window');
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0c1018] text-slate-100">
      <AiSidebar
        standalone
        activeSessionId={activeSessionId}
        connectedContexts={connectedContexts}
        savedHosts={savedHosts}
        onConnectHost={(h) => void emit('issh-ai-connect-host', { hostId: h.id })}
        settings={aiSettings}
        transport={tauriTransport}
        onChangeSettings={handleUpdateAiSettings}
        onOpenSettings={(tab = 'providers') => {
          setSettingsTab(tab);
          setSettingsOpen(true);
        }}
        onInsertCommand={(cmd) => {
          const sid = activeSessionId ?? connectedContexts[0]?.sessionId;
          if (sid) {
            void tauriTransport.writePty(sid, cmd);
          }
        }}
        onRedock={() => void handleRedock()}
      />

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        settings={aiSettings}
        uiMode={uiMode}
        terminalThemeId={themeId}
        onChangeSettings={handleUpdateAiSettings}
        onChangeUiMode={setUiMode}
        onChangeTerminalTheme={(id) => {
          setThemeId(id);
          localStorage.setItem(THEME_STORAGE_KEY, id);
        }}
        onProfileImported={(bundle: IsshUserProfileBundle) => {
          setAiSettings(bundle.aiSettings);
          setUiMode(bundle.appearance.uiMode);
          setThemeId(bundle.appearance.terminalThemeId);
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
