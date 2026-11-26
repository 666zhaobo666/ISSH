export function FolderIcon({
  open = false,
  symlink = false,
  dimmed = false,
  className = 'h-4 w-4 shrink-0',
}: {
  open?: boolean;
  symlink?: boolean;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} ${dimmed ? 'opacity-45 saturate-75' : ''}`}
      fill="none"
    >
      {/* Back tab */}
      <path
        d="M2.5 6.2C2.5 5.0 3.4 4.1 4.6 4.1H9.3L11.2 6.2H19.4C20.6 6.2 21.5 7.1 21.5 8.3V17.8C21.5 19.0 20.6 19.9 19.4 19.9H4.6C3.4 19.9 2.5 19.0 2.5 17.8V6.2Z"
        fill="#d97706"
      />
      {/* Front flap (gives 3D depth) */}
      {open ? (
        <path
          d="M2.5 9.2C2.5 8.4 3.2 7.8 4.0 7.8H20.0C20.9 7.8 21.6 8.6 21.4 9.5L19.8 18.4C19.6 19.3 18.8 19.9 17.9 19.9H4.6C3.4 19.9 2.5 19.0 2.5 17.8V9.2Z"
          fill="#fbbf24"
        />
      ) : (
        <path
          d="M2.5 8.5C2.5 7.7 3.2 7.0 4.0 7.0H20.0C20.8 7.0 21.5 7.7 21.5 8.5V17.8C21.5 19.0 20.6 19.9 19.4 19.9H4.6C3.4 19.9 2.5 19.0 2.5 17.8V8.5Z"
          fill="#f59e0b"
        />
      )}
      {/* Top highlight edge */}
      <path
        d="M3.5 7.6H20.5"
        stroke="#fde68a"
        strokeWidth="0.9"
        strokeOpacity="0.7"
        strokeLinecap="round"
      />
      {symlink && (
        <g>
          <rect x="13" y="13" width="9" height="8" rx="2" fill="#0f172a" />
          <path
            d="M15.5 18.5L19.5 14.5M19.5 14.5H16.5M19.5 14.5V17.5"
            stroke="#38bdf8"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
}

function getFilePalette(filename: string): {
  body: string;
  fold: string;
  badge?: string;
  badgeColor?: string;
} {
  const lower = filename.toLowerCase();
  if (/\.(md|markdown)$/.test(lower)) {
    return { body: '#0ea5e9', fold: '#7dd3fc', badge: 'MD', badgeColor: '#ffffff' };
  }
  if (/\.(py|pyw)$/.test(lower)) {
    return { body: '#3b82f6', fold: '#93c5fd', badge: 'PY', badgeColor: '#fef08a' };
  }
  if (/\.java$/.test(lower)) {
    return { body: '#ea580c', fold: '#fdba74', badge: 'JV', badgeColor: '#ffffff' };
  }
  if (/\.(ts|tsx)$/.test(lower)) {
    return { body: '#2563eb', fold: '#93c5fd', badge: 'TS', badgeColor: '#ffffff' };
  }
  if (/\.(js|jsx|mjs)$/.test(lower)) {
    return { body: '#eab308', fold: '#fef08a', badge: 'JS', badgeColor: '#1e293b' };
  }
  if (/\.(json|ya?ml|toml|conf|ini|env)$/.test(lower)) {
    return { body: '#8b5cf6', fold: '#c4b5fd', badge: '{}', badgeColor: '#ffffff' };
  }
  if (/\.(sh|bash|zsh)$/.test(lower)) {
    return { body: '#10b981', fold: '#6ee7b7', badge: '>_', badgeColor: '#ffffff' };
  }
  if (/\.(tar|gz|zip|rar|7z|xz|bz2)$/.test(lower)) {
    return { body: '#e11d48', fold: '#fda4af', badge: 'ZIP', badgeColor: '#ffffff' };
  }
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(lower)) {
    return { body: '#ec4899', fold: '#f9a8d4', badge: 'IMG', badgeColor: '#ffffff' };
  }
  return { body: '#64748b', fold: '#cbd5e1' };
}

export function FileTypeIcon({
  filename,
  className = 'h-4 w-4 shrink-0',
}: {
  filename: string;
  className?: string;
}) {
  const { body, fold, badge, badgeColor } = getFilePalette(filename);
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      {/* Page body */}
      <path
        d="M5 3.5C5 2.7 5.7 2 6.5 2H14.2L19 6.8V20.5C19 21.3 18.3 22 17.5 22H6.5C5.7 22 5 21.3 5 20.5V3.5Z"
        fill={body}
      />
      {/* Folded corner */}
      <path d="M14.2 2V6.2C14.2 6.5 14.5 6.8 14.8 6.8H19L14.2 2Z" fill={fold} />
      {badge ? (
        <text
          x="12"
          y="16.5"
          textAnchor="middle"
          fill={badgeColor ?? '#fff'}
          fontSize="6.2"
          fontWeight="700"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {badge}
        </text>
      ) : (
        <g stroke="#e2e8f0" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.7">
          <line x1="8" y1="11.5" x2="16" y2="11.5" />
          <line x1="8" y1="14.5" x2="16" y2="14.5" />
          <line x1="8" y1="17.5" x2="13" y2="17.5" />
        </g>
      )}
    </svg>
  );
}
