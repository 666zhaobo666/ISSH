import type { IsshUserProfileBundle } from '../ai/profileBundle';

export interface CloudThreadRecord {
  threadId: string;
  version?: number;
  deleted: boolean;
  updatedAt: number;
  data?: unknown;
}

export interface LocalAiThread {
  id: string;
  title: string;
  messages: unknown[];
  updatedAt: number;
}

export const AI_THREADS_KEY = 'issh.ai_threads.v1';
const AI_DELETED_TOMBSTONES_KEY = 'issh.ai_deleted_threads.v1';
const AI_PUSHED_FP_KEY = 'issh.ai_threads_pushed_fp.v1';
export const AI_THREADS_UPDATED_EVENT = 'issh-ai-threads-updated';
export const AI_THREAD_DELETED_EVENT = 'issh-ai-thread-deleted';
// Fired when the user mutates AI threads locally (new thread / new or edited message).
// Consumed ONLY by App.tsx to trigger an immediate cloud push; AiSidebar must NOT listen
// to this event, otherwise its reload-from-storage handler would loop on every keystroke.
export const AI_THREADS_LOCAL_CHANGED_EVENT = 'issh-ai-threads-local-changed';
export const SAVED_COMMANDS_UPDATED_EVENT = 'issh-saved-commands-updated';
export const PROFILE_LOCAL_CHANGED_EVENT = 'issh-profile-local-changed';

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function readLocalThreads(): LocalAiThread[] {
  try {
    const raw = localStorage.getItem(AI_THREADS_KEY);
    return raw ? (JSON.parse(raw) as LocalAiThread[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalThreads(threads: LocalAiThread[]) {
  const sliced = threads.slice(0, 60);
  const serialized = JSON.stringify(sliced);
  localStorage.setItem(AI_THREADS_KEY, serialized);
  // Notify AiSidebar in the same window reliably (CustomEvent + StorageEvent)
  window.dispatchEvent(new CustomEvent(AI_THREADS_UPDATED_EVENT));
  try {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: AI_THREADS_KEY,
        newValue: serialized,
      })
    );
  } catch {
    // Some WebViews restrict synthetic StorageEvent; CustomEvent above handles same-window sync
  }
}

export function readDeletedThreadTombstones(): Record<string, number> {
  try {
    const raw = localStorage.getItem(AI_DELETED_TOMBSTONES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    const clean: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && ts > cutoff) {
        clean[id] = ts;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function writeDeletedThreadTombstones(map: Record<string, number>) {
  localStorage.setItem(AI_DELETED_TOMBSTONES_KEY, JSON.stringify(map));
}

export function recordDeletedThreadTombstone(threadId: string, deletedAt = Date.now()) {
  if (!threadId) return;
  const map = readDeletedThreadTombstones();
  map[threadId] = Math.max(map[threadId] ?? 0, deletedAt);
  writeDeletedThreadTombstones(map);
  window.dispatchEvent(
    new CustomEvent(AI_THREAD_DELETED_EVENT, { detail: { threadId, deletedAt } })
  );
}

export function clearThreadSyncTracking() {
  localStorage.removeItem(AI_PUSHED_FP_KEY);
}

function readPushedFingerprints(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AI_PUSHED_FP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writePushedFingerprints(map: Record<string, string>) {
  localStorage.setItem(AI_PUSHED_FP_KEY, JSON.stringify(map));
}

function threadFingerprint(t: LocalAiThread): string {
  const msgCount = Array.isArray(t.messages) ? t.messages.length : 0;
  const lastContentLen =
    msgCount > 0
      ? String((t.messages[msgCount - 1] as { content?: string })?.content ?? '').length
      : 0;
  return `LIVE:${t.updatedAt ?? 0}:${t.title ?? ''}:${msgCount}:${lastContentLen}`;
}

function deletedFingerprint(deletedAt: number): string {
  return `DEL:${deletedAt}`;
}

export interface DirtyThreadPushItem {
  threadId: string;
  deleted: boolean;
  updatedAt: number;
  data?: LocalAiThread;
  _fp: string;
}

/**
 * Returns ONLY locally created/modified threads (with >=1 message) and newly deleted tombstones
 * that differ from what has already been synced with the cloud.
 */
export function getDirtyThreadsToPush(): DirtyThreadPushItem[] {
  const pushed = readPushedFingerprints();
  const tombstones = readDeletedThreadTombstones();
  const local = readLocalThreads();
  const dirty: DirtyThreadPushItem[] = [];

  for (const t of local) {
    if (!t.id || !Array.isArray(t.messages) || t.messages.length === 0) continue;
    const delAt = tombstones[t.id] ?? 0;
    if (delAt >= (t.updatedAt ?? 0)) continue; // deleted locally or remotely
    const fp = threadFingerprint(t);
    if (pushed[t.id] !== fp) {
      dirty.push({
        threadId: t.id,
        deleted: false,
        updatedAt: t.updatedAt ?? Date.now(),
        data: t,
        _fp: fp,
      });
    }
  }

  for (const [threadId, delAt] of Object.entries(tombstones)) {
    const fp = deletedFingerprint(delAt);
    if (pushed[threadId] !== fp) {
      dirty.push({
        threadId,
        deleted: true,
        updatedAt: delAt,
        _fp: fp,
      });
    }
  }

  return dirty;
}

export function markThreadsPushed(items: DirtyThreadPushItem[]) {
  if (items.length === 0) return;
  const pushed = readPushedFingerprints();
  for (const it of items) {
    pushed[it.threadId] = it._fp;
  }
  writePushedFingerprints(pushed);
}

/**
 * Applies incremental or full cloud thread records (including deleted tombstones) onto local threads.
 * - Cloud `deleted: true` removes matching local thread (if cloud deletion is newer) and records tombstone.
 * - Cloud live thread is ignored if local has a newer deletion tombstone.
 * - Marks accepted cloud states in pushed fingerprints so we never echo pulled threads back to cloud.
 */
export function applyCloudThreadRecords(
  localThreads: LocalAiThread[],
  cloudRecords: CloudThreadRecord[]
): { threads: LocalAiThread[]; changed: boolean } {
  const tombstones = readDeletedThreadTombstones();
  const pushed = readPushedFingerprints();
  const map = new Map<string, LocalAiThread>();
  for (const t of localThreads) {
    map.set(t.id, t);
  }

  let changed = false;

  for (const rec of cloudRecords) {
    if (!rec.threadId) continue;
    if (rec.deleted) {
      const prevDel = tombstones[rec.threadId] ?? 0;
      const delTs = Math.max(prevDel, rec.updatedAt || Date.now());
      tombstones[rec.threadId] = delTs;
      pushed[rec.threadId] = deletedFingerprint(delTs);

      const existing = map.get(rec.threadId);
      if (existing && (existing.updatedAt ?? 0) <= delTs) {
        map.delete(rec.threadId);
        changed = true;
      }
      continue;
    }

    const data = rec.data as LocalAiThread | undefined;
    if (!data || !data.id) continue;
    const cloudTs = Math.max(rec.updatedAt ?? 0, data.updatedAt ?? 0);
    const localDel = tombstones[data.id] ?? 0;
    if (localDel >= cloudTs) {
      // Locally deleted more recently; ignore stale cloud copy
      continue;
    }

    const normalized: LocalAiThread = {
      ...data,
      updatedAt: cloudTs,
    };
    const existing = map.get(data.id);
    const existingTs = existing?.updatedAt ?? 0;
    const existingLen = Array.isArray(existing?.messages) ? existing!.messages.length : 0;
    const cloudLen = Array.isArray(normalized.messages) ? normalized.messages.length : 0;

    if (!existing || cloudTs > existingTs || (cloudTs === existingTs && cloudLen > existingLen)) {
      map.set(data.id, normalized);
      pushed[data.id] = threadFingerprint(normalized);
      changed = true;
    } else if (existing) {
      // Local is equal or newer; if identical fingerprint, mark as synced
      const existingFp = threadFingerprint(existing);
      if (existingFp === threadFingerprint(normalized)) {
        pushed[data.id] = existingFp;
      }
    }
  }

  writeDeletedThreadTombstones(tombstones);
  writePushedFingerprints(pushed);

  const merged = Array.from(map.values())
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 60);

  return { threads: merged, changed };
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
