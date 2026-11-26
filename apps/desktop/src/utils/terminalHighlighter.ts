const ANSI_SEQ_REGEX =
  /(\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_])/g;

/**
 * Boundary-aware semantic rules (inspired by WindTerm / MobaXterm):
 * Every rule requires clean whitespace/delimiter boundaries so filenames like
 * `1panel-v2.2.3-linux-amd64` are never partially recolored.
 */
const TOKEN_REGEX = new RegExp(
  [
    // 1. Shell prompt: user@host:path(#|$)
    `((?:^|\\n)[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\\s#$]+[#\\$])`,
    // 2. Quoted strings
    `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`,
    // 3. URLs
    `(https?:\\/\\/[^\\s"'<>\\)]+)`,
    // 4. Shell variables ($VAR, ${VAR}, $1)
    `((?:^|(?<=[\\s"'=(:]))(?:\\$\\{[A-Za-z_][A-Za-z0-9_]*\\}|\\$[A-Za-z_][A-Za-z0-9_]*|\\$[0-9@#?!*$]))`,
    // 5. ISO timestamps (2026-11-24 or 22:30:00)
    `((?:^|(?<=\\s))\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z?)?(?=$|\\s|[,;]))`,
    `((?:^|(?<=\\s))\\d{2}:\\d{2}:\\d{2}(?=$|\\s|[,;]))`,
    // 6. IPv4 (+ optional :port)
    `((?:^|(?<=[\\s"'=(:]))(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d+)?(?=$|[\\s"'),;\\]]))`,
    // 7. ENV KEY= (at start of line)
    `((?:^|\\n)[A-Z_][A-Z0-9_]{1,}=)`,
    // 8. Status keywords
    `(\\b(?:ERROR|FATAL|FAILED|CRITICAL|Exception|denied|timeout)\\b)`,
    `(\\b(?:WARN|WARNING|DEPRECATED)\\b)`,
    `(\\b(?:SUCCESS|OK|PASSED|RUNNING|active)\\b)`,
    // 9. CLI flags (--flag, -la)
    `((?:^|(?<=\\s))--?[A-Za-z0-9][A-Za-z0-9_-]*(?=$|\\s|=))`,
    // 10. Unix paths (/etc/nginx, ~/app)
    `((?:^|(?<=[\\s:=('"]))(?:~\\/[A-Za-z0-9._\\/-]*|\\/[A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+)*\\/?)(?=$|[\\s"'),;:]))`,
    // 11. Standalone numbers / sizes / percentages (never inside identifiers like v2.2.3)
    `((?:^|(?<=[\\s:=(\\[,]))\\d+(?:\\.\\d+)?(?:%|B|KB|MB|GB|TB|ms|s)?(?=$|[\\s)\\],;]))`,
  ].join('|'),
  'g'
);

export class TerminalSemanticHighlighter {
  private decoder = new TextDecoder('utf-8', { fatal: false });
  private inAlternateScreen = false;
  private serverHasActiveColor = false;

  process(chunk: Uint8Array): Uint8Array | string {
    const text = this.decoder.decode(chunk, { stream: true });
    if (!text) return chunk;

    let out = '';
    let lastIndex = 0;
    ANSI_SEQ_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = ANSI_SEQ_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        out += this.highlightPlain(text.slice(lastIndex, match.index));
      }

      const seq = match[0];
      this.trackAnsiSeq(seq);
      out += seq;
      lastIndex = match.index + seq.length;
    }

    if (lastIndex < text.length) {
      out += this.highlightPlain(text.slice(lastIndex));
    }

    return out;
  }

  private trackAnsiSeq(seq: string) {
    if (seq === '\x1b[?1049h' || seq === '\x1b[?47h') {
      this.inAlternateScreen = true;
      return;
    }
    if (seq === '\x1b[?1049l' || seq === '\x1b[?47l') {
      this.inAlternateScreen = false;
      return;
    }
    if (seq.startsWith('\x1b[') && seq.endsWith('m')) {
      const body = seq.slice(2, -1);
      this.serverHasActiveColor = !(body === '' || body === '0');
    }
  }

  private highlightPlain(plain: string): string {
    if (this.inAlternateScreen || this.serverHasActiveColor || plain.length <= 1) {
      return plain;
    }

    return plain.replace(
      TOKEN_REGEX,
      (
        full,
        promptTok,
        strTok,
        urlTok,
        varTok,
        dateTok,
        timeTok,
        ipTok,
        envKeyTok,
        errTok,
        warnTok,
        okTok,
        flagTok,
        pathTok,
        numTok
      ) => {
        if (promptTok) {
          const colonIdx = full.indexOf(':');
          const userHost = full.slice(0, colonIdx);
          const rest = full.slice(colonIdx + 1, -1);
          const sigil = full.slice(-1);
          return `\x1b[32;1m${userHost}\x1b[0m:\x1b[34;1m${rest}\x1b[0m${sigil}`;
        }
        if (strTok) return `\x1b[32m${full}\x1b[0m`;
        if (urlTok) return `\x1b[36;4m${full}\x1b[0m`;
        if (varTok) return `\x1b[35m${full}\x1b[0m`;
        if (dateTok || timeTok) return `\x1b[90m${full}\x1b[0m`;
        if (ipTok) return `\x1b[33m${full}\x1b[0m`;
        if (envKeyTok) return `\x1b[36m${full.slice(0, -1)}\x1b[0m=`;
        if (errTok) return `\x1b[31;1m${full}\x1b[0m`;
        if (warnTok) return `\x1b[33;1m${full}\x1b[0m`;
        if (okTok) return `\x1b[32;1m${full}\x1b[0m`;
        if (flagTok) return `\x1b[36m${full}\x1b[0m`;
        if (pathTok) return `\x1b[34m${full}\x1b[0m`;
        if (numTok) return `\x1b[33m${full}\x1b[0m`;
        return full;
      }
    );
  }
}
