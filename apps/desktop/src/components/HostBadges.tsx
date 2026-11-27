import type { HostConfig } from '@issh/core';

export const OS_OPTIONS = [
  { id: 'auto', label: '自动识别' },
  { id: 'debian', label: 'Debian' },
  { id: 'ubuntu', label: 'Ubuntu' },
  { id: 'centos', label: 'CentOS' },
  { id: 'alpine', label: 'Alpine' },
  { id: 'arch', label: 'Arch Linux' },
  { id: 'rocky', label: 'Rocky / Alma' },
  { id: 'redhat', label: 'Red Hat / Fedora' },
  { id: 'linux', label: '通用 Linux' },
] as const;

export const COUNTRY_OPTIONS = [
  { code: '', label: '自动识别 / 无' },
  { code: 'CN', label: 'CN 中国大陆' },
  { code: 'HK', label: 'HK 中国香港' },
  { code: 'TW', label: 'TW 中国台湾' },
  { code: 'JP', label: 'JP 日本' },
  { code: 'SG', label: 'SG 新加坡' },
  { code: 'US', label: 'US 美国' },
  { code: 'KR', label: 'KR 韩国' },
  { code: 'GB', label: 'GB 英国' },
  { code: 'DE', label: 'DE 德国' },
  { code: 'FR', label: 'FR 法国' },
  { code: 'NL', label: 'NL 荷兰' },
  { code: 'CA', label: 'CA 加拿大' },
  { code: 'AU', label: 'AU 澳大利亚' },
] as const;

export function inferOsType(osName?: string): string | undefined {
  if (!osName) return undefined;
  const s = osName.toLowerCase();
  if (s.includes('debian')) return 'debian';
  if (s.includes('ubuntu')) return 'ubuntu';
  if (s.includes('centos')) return 'centos';
  if (s.includes('alpine')) return 'alpine';
  if (s.includes('arch')) return 'arch';
  if (s.includes('rocky') || s.includes('alma')) return 'rocky';
  if (s.includes('red hat') || s.includes('rhel') || s.includes('fedora')) return 'redhat';
  return 'linux';
}

export function inferCountryCode(host: Pick<HostConfig, 'name' | 'countryCode' | 'tags'>): string {
  if (host.countryCode) return host.countryCode.toUpperCase();
  const hay = `${host.name} ${(host.tags ?? []).join(' ')}`.toUpperCase();
  if (/(^|[^A-Z])HK([^A-Z]|$)|香港/.test(hay)) return 'HK';
  if (/(^|[^A-Z])JP([^A-Z]|$)|日本|东京|大阪|TOKYO|OSAKA/.test(hay)) return 'JP';
  if (/(^|[^A-Z])US([^A-Z]|$)|美国|美西|美东|洛杉矶|硅谷|西雅图|LA/.test(hay)) return 'US';
  if (/(^|[^A-Z])SG([^A-Z]|$)|新加坡|狮城/.test(hay)) return 'SG';
  if (/(^|[^A-Z])TW([^A-Z]|$)|台湾|台北/.test(hay)) return 'TW';
  if (/(^|[^A-Z])KR([^A-Z]|$)|韩国|首尔/.test(hay)) return 'KR';
  if (/(^|[^A-Z])DE([^A-Z]|$)|德国|法兰克福/.test(hay)) return 'DE';
  if (/(^|[^A-Z])GB([^A-Z]|$)|UK|英国|伦敦/.test(hay)) return 'GB';
  if (/(^|[^A-Z])FR([^A-Z]|$)|法国|巴黎/.test(hay)) return 'FR';
  if (/(^|[^A-Z])NL([^A-Z]|$)|荷兰|阿姆斯特丹/.test(hay)) return 'NL';
  if (/(^|[^A-Z])CN([^A-Z]|$)|中国|北京|上海|广州|深圳|杭州|国内/.test(hay)) return 'CN';
  return '';
}

function MiniCountryFlag({ code }: { code: string }) {
  const c = code.toUpperCase();
  if (!c) return null;

  // Crisp 18x13 SVG flags (works uniformly on Windows, Android, Web)
  const renderSvg = () => {
    switch (c) {
      case 'US':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="12" fill="#b91c1c" />
            <rect y="2" width="18" height="1.5" fill="#fff" />
            <rect y="5" width="18" height="1.5" fill="#fff" />
            <rect y="8" width="18" height="1.5" fill="#fff" />
            <rect y="10.5" width="18" height="1.5" fill="#fff" />
            <rect width="8" height="6.5" fill="#1e3a8a" />
            <circle cx="2" cy="2" r="0.7" fill="#fff" />
            <circle cx="4.5" cy="2" r="0.7" fill="#fff" />
            <circle cx="6.5" cy="2" r="0.7" fill="#fff" />
            <circle cx="3.2" cy="4.2" r="0.7" fill="#fff" />
            <circle cx="5.5" cy="4.2" r="0.7" fill="#fff" />
          </svg>
        );
      case 'JP':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="12" fill="#f8fafc" />
            <circle cx="9" cy="6" r="3.4" fill="#dc2626" />
          </svg>
        );
      case 'HK':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="12" fill="#dc2626" />
            <circle cx="9" cy="6" r="2.6" fill="none" stroke="#fff" strokeWidth="1.2" strokeDasharray="1.8 1.2" />
            <circle cx="9" cy="6" r="0.9" fill="#fff" />
          </svg>
        );
      case 'CN':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="12" fill="#dc2626" />
            <circle cx="4.2" cy="4.2" r="1.6" fill="#facc15" />
            <circle cx="7.4" cy="2.4" r="0.55" fill="#facc15" />
            <circle cx="8.2" cy="4.2" r="0.55" fill="#facc15" />
            <circle cx="7.4" cy="6" r="0.55" fill="#facc15" />
          </svg>
        );
      case 'SG':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="6" fill="#dc2626" />
            <rect y="6" width="18" height="6" fill="#f8fafc" />
            <circle cx="4.5" cy="3" r="1.8" fill="#fff" />
            <circle cx="5.3" cy="3" r="1.5" fill="#dc2626" />
          </svg>
        );
      case 'DE':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="4" fill="#111827" />
            <rect y="4" width="18" height="4" fill="#dc2626" />
            <rect y="8" width="18" height="4" fill="#facc15" />
          </svg>
        );
      case 'FR':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="6" height="12" fill="#1d4ed8" />
            <rect x="6" width="6" height="12" fill="#f8fafc" />
            <rect x="12" width="6" height="12" fill="#dc2626" />
          </svg>
        );
      case 'NL':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="4" fill="#dc2626" />
            <rect y="4" width="18" height="4" fill="#f8fafc" />
            <rect y="8" width="18" height="4" fill="#1d4ed8" />
          </svg>
        );
      case 'GB':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="12" fill="#1e3a8a" />
            <path d="M0 0L18 12M18 0L0 12" stroke="#fff" strokeWidth="2" />
            <path d="M9 0V12M0 6H18" stroke="#fff" strokeWidth="3" />
            <path d="M9 0V12M0 6H18" stroke="#dc2626" strokeWidth="1.6" />
          </svg>
        );
      case 'KR':
        return (
          <svg viewBox="0 0 18 12" className="h-full w-full">
            <rect width="18" height="12" fill="#f8fafc" />
            <circle cx="9" cy="6" r="2.8" fill="#dc2626" />
            <path d="M6.2 6A2.8 2.8 0 0 0 11.8 6Z" fill="#2563eb" />
          </svg>
        );
      default:
        return (
          <span className="flex h-full w-full items-center justify-center bg-slate-800 text-[7px] font-bold text-slate-200">
            {c}
          </span>
        );
    }
  };

  return (
    <span
      title={c}
      className="absolute -left-1 -top-1 flex h-[13px] w-[19px] overflow-hidden rounded-[3px] border border-black/40 shadow-sm ring-1 ring-white/25"
    >
      {renderSvg()}
    </span>
  );
}

function OsBrandSvg({ osType }: { osType?: string }) {
  const os = (osType || 'linux').toLowerCase();

  if (os === 'debian') {
    return (
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none">
        <rect width="32" height="32" rx="9" fill="#4c0519" />
        <path
          d="M17.5 8.5C12.2 8.5 8.5 12.2 8.5 17C8.5 21.6 12 24.5 16.2 24.5C19.8 24.5 22.5 22 22.5 18.6C22.5 15.6 20.3 13.6 17.6 13.6C15.2 13.6 13.6 15.2 13.6 17.2C13.6 18.9 14.9 20.1 16.5 20.1C17.8 20.1 18.7 19.2 18.7 18"
          stroke="#fb7185"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (os === 'ubuntu') {
    return (
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none">
        <rect width="32" height="32" rx="9" fill="#7c2d12" />
        <circle cx="16" cy="16" r="6.8" stroke="#fb923c" strokeWidth="2.4" />
        <circle cx="16" cy="8.2" r="2.2" fill="#fed7aa" />
        <circle cx="9.4" cy="19.8" r="2.2" fill="#fed7aa" />
        <circle cx="22.6" cy="19.8" r="2.2" fill="#fed7aa" />
      </svg>
    );
  }

  if (os === 'centos') {
    return (
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none">
        <rect width="32" height="32" rx="9" fill="#1e1b4b" />
        <rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1.2" fill="#a855f7" />
        <rect x="17" y="8.5" width="6.5" height="6.5" rx="1.2" fill="#facc15" />
        <rect x="8.5" y="17" width="6.5" height="6.5" rx="1.2" fill="#22c55e" />
        <rect x="17" y="17" width="6.5" height="6.5" rx="1.2" fill="#38bdf8" />
      </svg>
    );
  }

  if (os === 'alpine') {
    return (
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none">
        <rect width="32" height="32" rx="9" fill="#0c4a6e" />
        <path d="M6 22L13 11L19 20L22.5 15L26 22H6Z" fill="#7dd3fc" />
      </svg>
    );
  }

  if (os === 'arch') {
    return (
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none">
        <rect width="32" height="32" rx="9" fill="#083344" />
        <path d="M16 7L24.5 24L18.8 21.5L16 15.5L13.2 21.5L7.5 24L16 7Z" fill="#22d3ee" />
      </svg>
    );
  }

  if (os === 'rocky') {
    return (
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none">
        <rect width="32" height="32" rx="9" fill="#064e3b" />
        <circle cx="16" cy="16" r="8" stroke="#34d399" strokeWidth="2.4" />
        <path d="M11 20L17 13L22 18" stroke="#6ee7b7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (os === 'redhat') {
    return (
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none">
        <rect width="32" height="32" rx="9" fill="#450a0a" />
        <ellipse cx="16" cy="19.5" rx="9" ry="3.5" fill="#ef4444" />
        <path d="M11 18C11.5 13 13 11 16 11C19 11 20.5 13 21 18" fill="#dc2626" />
      </svg>
    );
  }

  // Generic sleek Linux server badge
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full" fill="none">
      <rect width="32" height="32" rx="9" fill="#0f172a" stroke="#1e293b" />
      <path d="M9.5 12L14 16L9.5 20" stroke="#38bdf8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.5 20H22.5" stroke="#38bdf8" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Large OS brand icon with optional mini country flag pinned at top-left corner.
 * Shared across PC Desktop, Web, Android Phone, and Android Tablet.
 */
export function HostBadgeIcon({
  host,
  size = 'md',
}: {
  host: Pick<HostConfig, 'name' | 'osType' | 'countryCode' | 'tags'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const country = inferCountryCode(host);
  const dim =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';

  return (
    <div className={`relative shrink-0 ${dim}`}>
      <OsBrandSvg osType={host.osType} />
      {country && <MiniCountryFlag code={country} />}
    </div>
  );
}
