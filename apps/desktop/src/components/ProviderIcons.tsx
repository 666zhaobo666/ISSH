export function ProviderIcon({
  presetId,
  className = 'h-6 w-6 shrink-0',
}: {
  presetId: string;
  className?: string;
}) {
  const id = presetId.toLowerCase();

  if (id.includes('deepseek')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#2563eb" />
        <path
          d="M5.5 13.5C7 9.5 11.5 7.5 16 9C17.5 9.5 18.5 11 18.5 12.5C18.5 15 15.8 16.5 12 16.5C8.5 16.5 6.2 15.2 5.5 13.5Z"
          fill="#93c5fd"
        />
        <circle cx="14.5" cy="11.5" r="1.2" fill="#1e3a8a" />
      </svg>
    );
  }

  if (id.includes('openai') && !id.includes('custom')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#0f766e" />
        <circle cx="12" cy="12" r="5.5" stroke="#ccfbf1" strokeWidth="1.6" />
        <path
          d="M12 6.5V17.5M7.2 9.2L16.8 14.8M16.8 9.2L7.2 14.8"
          stroke="#5eead4"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (id.includes('gemini')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#1e1b4b" />
        <path
          d="M12 4.5C12.7 8.8 15.2 11.3 19.5 12C15.2 12.7 12.7 15.2 12 19.5C11.3 15.2 8.8 12.7 4.5 12C8.8 11.3 11.3 8.8 12 4.5Z"
          fill="#60a5fa"
        />
      </svg>
    );
  }

  if (id.includes('kimi') || id.includes('moonshot')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#111827" stroke="#334155" />
        <path
          d="M8 7V17M8 12L14.5 7M10.5 10.5L15.5 17"
          stroke="#f8fafc"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="17.5" cy="7.5" r="1.5" fill="#38bdf8" />
      </svg>
    );
  }

  if (id.includes('qwen') || id.includes('dashscope')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#6d28d9" />
        <polygon
          points="12,5 17.5,8.5 17.5,15.5 12,19 6.5,15.5 6.5,8.5"
          stroke="#e9d5ff"
          strokeWidth="1.6"
          fill="#8b5cf6"
        />
        <circle cx="12" cy="12" r="2.2" fill="#ffffff" />
      </svg>
    );
  }

  if (id.includes('zhipu') || id.includes('glm')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#312e81" />
        <path
          d="M7 8H17L7 16H17"
          stroke="#818cf8"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (id.includes('xai') || id.includes('grok')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#18181b" stroke="#3f3f46" />
        <path
          d="M7 7L17 17M17 7L7 17"
          stroke="#f4f4f5"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (id.includes('openrouter')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#4f46e5" />
        <circle cx="7" cy="12" r="2" fill="#e0e7ff" />
        <circle cx="17" cy="7.5" r="2" fill="#a5b4fc" />
        <circle cx="17" cy="16.5" r="2" fill="#a5b4fc" />
        <path
          d="M9 11.2L15 8.3M9 12.8L15 15.7"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (id.includes('silicon')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#7c3aed" />
        <path
          d="M6.5 14.5C8.5 9.5 15.5 9.5 17.5 14.5"
          stroke="#ddd6fe"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M8.5 16.5C10 13 14 13 15.5 16.5"
          stroke="#38bdf8"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (id.includes('ollama')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#0f172a" stroke="#475569" />
        <rect x="7" y="9" width="10" height="8" rx="3" fill="#e2e8f0" />
        <path d="M9 9V6.5M15 9V6.5" stroke="#e2e8f0" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="10" cy="12.5" r="1" fill="#0f172a" />
        <circle cx="14" cy="12.5" r="1" fill="#0f172a" />
      </svg>
    );
  }

  if (id.includes('lmstudio')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <rect width="24" height="24" rx="6" fill="#0369a1" />
        <path
          d="M12 5.5L18 9V15L12 18.5L6 15V9L12 5.5Z"
          stroke="#e0f2fe"
          strokeWidth="1.6"
          fill="#38bdf8"
          fillOpacity="0.3"
        />
      </svg>
    );
  }

  // Custom OpenAI compatible
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <rect width="24" height="24" rx="6" fill="#334155" />
      <path
        d="M8 12H16M12 8V16"
        stroke="#38bdf8"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
