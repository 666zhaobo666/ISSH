import { getCloudServerUrl } from '../cloud/cloudClient';
import { isTauriRuntime } from '../transport/runtime';

export const APP_VERSION = '0.1.1';
export const GITHUB_REPO_URL = 'https://github.com/666zhaobo666/ISSH';

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface UpdateCheckResult {
  hasRelease: boolean;
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  tagName: string;
  notes: string;
  publishedAt: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
  source: 'server' | 'github';
}

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Checks for newer ISSH releases:
 * 1. First queries the ISSH Go backend (/api/app/latest, cached 5m, fast in China, no GitHub rate limit).
 * 2. Falls back directly to GitHub Releases API if the backend is unreachable.
 */
export async function checkAppUpdate(forceRefresh = false): Promise<UpdateCheckResult> {
  const base = getCloudServerUrl();
  const serverEndpoint = `${base}/api/app/latest${forceRefresh ? '?refresh=1' : ''}`;

  try {
    const res = await fetch(serverEndpoint);
    if (res.ok) {
      const data = (await res.json()) as {
        hasRelease: boolean;
        version?: string;
        tagName?: string;
        notes?: string;
        publishedAt?: string;
        htmlUrl?: string;
        assets?: ReleaseAsset[];
      };
      const latest = data.version ?? '';
      return {
        hasRelease: Boolean(data.hasRelease),
        hasUpdate:
          Boolean(data.hasRelease) &&
          latest.length > 0 &&
          compareSemver(latest, APP_VERSION) > 0,
        currentVersion: APP_VERSION,
        latestVersion: latest || APP_VERSION,
        tagName: data.tagName ?? `v${APP_VERSION}`,
        notes: data.notes ?? '',
        publishedAt: data.publishedAt ?? '',
        htmlUrl: data.htmlUrl ?? `${GITHUB_REPO_URL}/releases`,
        assets: data.assets ?? [],
        source: 'server',
      };
    }
  } catch {
    // fallback to direct GitHub API below
  }

  const ghRes = await fetch(
    'https://api.github.com/repos/666zhaobo666/ISSH/releases/latest',
    { headers: { Accept: 'application/vnd.github+json' } }
  );
  if (ghRes.status === 404) {
    return {
      hasRelease: false,
      hasUpdate: false,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      tagName: `v${APP_VERSION}`,
      notes: '',
      publishedAt: '',
      htmlUrl: `${GITHUB_REPO_URL}/releases`,
      assets: [],
      source: 'github',
    };
  }
  if (!ghRes.ok) {
    throw new Error(`检查更新失败 (HTTP ${ghRes.status})`);
  }
  const gh = (await ghRes.json()) as {
    tag_name: string;
    body: string;
    published_at: string;
    html_url: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  };
  const latest = (gh.tag_name ?? '').replace(/^v/i, '');
  return {
    hasRelease: true,
    hasUpdate: latest.length > 0 && compareSemver(latest, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion: latest || APP_VERSION,
    tagName: gh.tag_name,
    notes: gh.body ?? '',
    publishedAt: gh.published_at ?? '',
    htmlUrl: gh.html_url ?? `${GITHUB_REPO_URL}/releases`,
    assets: (gh.assets ?? []).map((a) => ({
      name: a.name,
      downloadUrl: a.browser_download_url,
      size: a.size,
    })),
    source: 'github',
  };
}

/**
 * Desktop-only one-click signed update via Tauri Updater plugin.
 * Downloads installer, verifies cryptographic signature, installs, and relaunches.
 */
export async function installDesktopUpdate(
  onProgress?: (percent: number, phase: 'checking' | 'downloading' | 'installing') => void
): Promise<boolean> {
  if (!isTauriRuntime()) {
    throw new Error('仅桌面客户端支持一键自动安装更新');
  }
  const { check } = await import('@tauri-apps/plugin-updater');
  const { relaunch } = await import('@tauri-apps/plugin-process');

  onProgress?.(0, 'checking');
  const update = await check();
  if (!update) {
    return false;
  }

  let totalBytes = 0;
  let downloadedBytes = 0;

  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      totalBytes = event.data.contentLength ?? 0;
      downloadedBytes = 0;
      onProgress?.(0, 'downloading');
    } else if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength;
      const pct =
        totalBytes > 0
          ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100))
          : 50;
      onProgress?.(pct, 'downloading');
    } else if (event.event === 'Finished') {
      onProgress?.(100, 'installing');
    }
  });

  await relaunch();
  return true;
}
