import type { HostConfig } from '@issh/core';
import type { AiSettingsState } from './settingsStore';
import { loadAiSettings, saveAiSettings } from './settingsStore';

/**
 * Account-ready unified user profile bundle (Schema v1).
 * Used for:
 * 1. Local Export / Import migration (.json)
 * 2. Phase 4 E2EE Cloud Account Sync payload
 */
export interface IsshUserProfileBundle {
  schemaVersion: 1;
  exportedAt: number;
  accountId?: string;
  hosts: HostConfig[];
  savedCommands: Array<{
    id: string;
    title: string;
    command: string;
    category: string;
  }>;
  aiSettings: AiSettingsState;
  appearance: {
    uiMode: 'dark' | 'light';
    terminalThemeId: string;
  };
}

const HOSTS_KEY = 'issh.hosts.v1';
const COMMANDS_KEY = 'issh.saved_commands.v1';
const UI_MODE_KEY = 'issh.ui_mode.v1';
const THEME_KEY = 'issh.terminal_theme.v1';

export function exportUserProfile(includeSecrets: boolean): IsshUserProfileBundle {
  const hosts: HostConfig[] = (() => {
    try {
      const raw = localStorage.getItem(HOSTS_KEY);
      const list = raw ? (JSON.parse(raw) as HostConfig[]) : [];
      if (includeSecrets) return list;
      return list.map((h) => ({
        ...h,
        auth:
          h.auth.type === 'password'
            ? { type: 'password', password: '' }
            : h.auth.type === 'privateKey'
              ? { type: 'privateKey', privateKey: '', passphrase: '' }
              : h.auth,
      }));
    } catch {
      return [];
    }
  })();

  const savedCommands = (() => {
    try {
      const raw = localStorage.getItem(COMMANDS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })();

  const aiSettings = loadAiSettings();
  const sanitizedAi: AiSettingsState = includeSecrets
    ? aiSettings
    : {
        ...aiSettings,
        providers: aiSettings.providers.map((p) => ({ ...p, apiKey: '' })),
      };

  const uiMode =
    (localStorage.getItem(UI_MODE_KEY) as 'dark' | 'light') ?? 'dark';
  const terminalThemeId = localStorage.getItem(THEME_KEY) ?? 'tokyo-night';

  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    hosts,
    savedCommands,
    aiSettings: sanitizedAi,
    appearance: { uiMode, terminalThemeId },
  };
}

export function importUserProfile(rawJson: string): IsshUserProfileBundle {
  const parsed = JSON.parse(rawJson) as Partial<IsshUserProfileBundle>;
  if (parsed.schemaVersion !== 1) {
    throw new Error('不支持的配置文件格式或版本号');
  }

  if (Array.isArray(parsed.hosts)) {
    localStorage.setItem(HOSTS_KEY, JSON.stringify(parsed.hosts));
  }
  if (Array.isArray(parsed.savedCommands)) {
    localStorage.setItem(COMMANDS_KEY, JSON.stringify(parsed.savedCommands));
  }
  if (parsed.aiSettings) {
    saveAiSettings(parsed.aiSettings);
  }
  if (parsed.appearance?.uiMode) {
    localStorage.setItem(UI_MODE_KEY, parsed.appearance.uiMode);
  }
  if (parsed.appearance?.terminalThemeId) {
    localStorage.setItem(THEME_KEY, parsed.appearance.terminalThemeId);
  }

  return exportUserProfile(true);
}
