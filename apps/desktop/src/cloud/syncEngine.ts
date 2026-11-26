import type { IsshUserProfileBundle } from '../ai/profileBundle';

export interface LocalAiThread {
  id: string;
  title: string;
  messages: unknown[];
  updatedAt: number;
}

const AI_THREADS_KEY = 'issh.ai_threads.v1';

export function readLocalThreads(): LocalAiThread[] {
  try {
    const raw = localStorage.getItem(AI_THREADS_KEY);
    return raw ? (JSON.parse(raw) as LocalAiThread[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalThreads(threads: LocalAiThread[]) {
  localStorage.setItem(AI_THREADS_KEY, JSON.stringify(threads.slice(0, 60)));
  // Notify AiSidebar in the same window
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: AI_THREADS_KEY,
      newValue: JSON.stringify(threads.slice(0, 60)),
    })
  );
}

function mergeById<T extends { id: string; updatedAt?: number }>(
  localList: T[],
  cloudList: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of cloudList) {
    map.set(item.id, item);
  }
  for (const item of localList) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      const localTs = item.updatedAt ?? 0;
      const cloudTs = existing.updatedAt ?? 0;
      if (localTs >= cloudTs) {
        map.set(item.id, item);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Smart 3-way merge for VIP renewal / login conflict resolution:
 * - Hosts, Saved Commands, AI Providers, Skills: union by ID (newer wins)
 * - Appearance & Approval Policy: keep local preference
 */
export function mergeUserProfiles(
  local: IsshUserProfileBundle,
  cloud: IsshUserProfileBundle
): IsshUserProfileBundle {
  const mergedHosts = mergeById(local.hosts ?? [], cloud.hosts ?? []);
  const mergedCommands = mergeById(
    local.savedCommands ?? [],
    cloud.savedCommands ?? []
  );
  const mergedProviders = mergeById(
    local.aiSettings?.providers ?? [],
    cloud.aiSettings?.providers ?? []
  );
  const mergedSkills = mergeById(
    local.aiSettings?.skills ?? [],
    cloud.aiSettings?.skills ?? []
  );

  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    hosts: mergedHosts,
    savedCommands: mergedCommands,
    aiSettings: {
      ...cloud.aiSettings,
      ...local.aiSettings,
      providers: mergedProviders,
      skills: mergedSkills,
    },
    appearance: local.appearance ?? cloud.appearance,
  };
}

export function mergeAiThreads(
  localThreads: LocalAiThread[],
  cloudThreads: LocalAiThread[]
): LocalAiThread[] {
  const merged = mergeById(localThreads, cloudThreads);
  return merged.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 60);
}
