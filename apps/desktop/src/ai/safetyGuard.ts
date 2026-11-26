import type {
  ApprovalPolicy,
  CommandRiskLevel,
  CustomApprovalRules,
} from '@issh/core';

export interface RiskAssessment {
  level: CommandRiskLevel;
  isHighRisk: boolean;
  reason?: string;
}

export const RISK_LEVEL_META: Record<
  CommandRiskLevel,
  { label: string; description: string; badgeClass: string }
> = {
  readonly: {
    label: '只读探测',
    description: '读取文件、列目录、搜索、ls/cat/ps/df/git status/docker ps 等',
    badgeClass: 'bg-emerald-500/15 text-emerald-300',
  },
  file_write: {
    label: '文件写入与编辑',
    description: '通过 SFTP 新建、覆写或局部修改普通项目/配置文件',
    badgeClass: 'bg-sky-500/15 text-sky-300',
  },
  normal_exec: {
    label: '常规命令与构建',
    description: '运行 npm/pip/uv/cargo/python/git/mkdir/cp/mv 等常规开发命令',
    badgeClass: 'bg-indigo-500/15 text-indigo-300',
  },
  system_ops: {
    label: '系统服务与权限变更',
    description: 'systemctl/service/apt/yum/chmod/chown/kill/ufw/sudo/docker rm 等',
    badgeClass: 'bg-amber-500/15 text-amber-300',
  },
  destructive: {
    label: '高危破坏性操作',
    description: 'rm -rf /、mkfs、dd 写设备、关机重启、改写 /etc/passwd 等（默认拦截，可由用户手动勾选放行）',
    badgeClass: 'bg-rose-500/20 text-rose-300',
  },
};

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+\/(\s|$|\*)/,
    reason: '高危指令：试图强制递归删除根目录 (rm -rf /)',
  },
  {
    pattern: /\bmkfs(\.[a-z0-9]+)?\b/,
    reason: '高危指令：格式化磁盘分区 (mkfs)',
  },
  {
    pattern: /\bdd\b.*\bof=\/dev\/[sh]d[a-z0-9]*/,
    reason: '高危指令：直接向块设备写入数据 (dd of=/dev/...)',
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: '高危指令：Fork 炸弹',
  },
  {
    pattern: /\b(shutdown|poweroff|halt|reboot|init\s+0|init\s+6)\b/,
    reason: '高危指令：关闭或重启服务器',
  },
  {
    pattern: />\s*\/etc\/(passwd|shadow|sudoers|fstab)\b/,
    reason: '高危指令：直接覆盖系统核心认证/挂载文件',
  },
  {
    pattern: /\bchmod\s+(-R\s+)?777\s+\/\s*$/,
    reason: '高危指令：修改根目录权限为 777',
  },
];

const SYSTEM_OPS_PATTERN =
  /\b(systemctl|service|apt|apt-get|yum|dnf|apk|pacman|chmod|chown|kill|pkill|killall|iptables|ufw|firewall-cmd|useradd|userdel|usermod|passwd|sudo|su|mount|umount|crontab|docker\s+(rm|rmi|stop|restart|kill|prune))\b/;

const READONLY_CMD_PATTERN =
  /^\s*(ls|ll|pwd|cat|head|tail|less|wc|stat|file|which|whereis|whoami|id|uname|uptime|df|du|free|ps|ss|netstat|ip\s+a|ifconfig|env|printenv|echo|grep|rg|find|tree|journalctl|git\s+(status|log|diff|branch|show)|docker\s+(ps|images|logs|inspect))\b/;

const READONLY_TOOLS = new Set(['sftp_list', 'sftp_read', 'sftp_grep']);

export function classifyToolRisk(
  toolName: string,
  args: Record<string, unknown>
): RiskAssessment {
  if (READONLY_TOOLS.has(toolName)) {
    return { level: 'readonly', isHighRisk: false };
  }

  if (toolName === 'sftp_write' || toolName === 'sftp_edit') {
    const path = String(args.path ?? '').trim();
    if (/^\/etc\/(passwd|shadow|sudoers|fstab|ssh\/sshd_config)$/.test(path)) {
      return {
        level: 'destructive',
        isHighRisk: true,
        reason: `高危写入：正在修改系统核心文件 ${path}`,
      };
    }
    return { level: 'file_write', isHighRisk: false };
  }

  if (toolName === 'ssh_exec') {
    const cmd = String(args.command ?? '').trim();
    for (const rule of DESTRUCTIVE_PATTERNS) {
      if (rule.pattern.test(cmd)) {
        return { level: 'destructive', isHighRisk: true, reason: rule.reason };
      }
    }
    if (SYSTEM_OPS_PATTERN.test(cmd)) {
      return { level: 'system_ops', isHighRisk: false };
    }
    // Check if command is purely read-only (no redirection/chaining to writes)
    if (READONLY_CMD_PATTERN.test(cmd) && !/[>;`]|&&|\|\|/.test(cmd)) {
      return { level: 'readonly', isHighRisk: false };
    }
    return { level: 'normal_exec', isHighRisk: false };
  }

  return { level: 'normal_exec', isHighRisk: false };
}

export function evaluateApproval(
  policy: ApprovalPolicy,
  customRules: CustomApprovalRules,
  toolName: string,
  args: Record<string, unknown>
): { autoApprove: boolean; risk: RiskAssessment } {
  const risk = classifyToolRisk(toolName, args);

  // Check custom deny regex patterns first
  if (toolName === 'ssh_exec' && customRules.denyPatterns.length > 0) {
    const cmd = String(args.command ?? '');
    for (const raw of customRules.denyPatterns) {
      const pat = raw.trim();
      if (!pat) continue;
      try {
        if (new RegExp(pat, 'i').test(cmd)) {
          return {
            autoApprove: false,
            risk: {
              level: 'destructive',
              isHighRisk: true,
              reason: `命中自定义黑名单规则：/${pat}/`,
            },
          };
        }
      } catch {
        // ignore invalid user regex
      }
    }
  }

  if (policy === 'auto') {
    if (risk.level === 'destructive' || risk.isHighRisk) {
      return {
        autoApprove: Boolean(customRules.autoApproveDestructive),
        risk,
      };
    }
    return { autoApprove: true, risk };
  }

  if (policy === 'manual') {
    return { autoApprove: READONLY_TOOLS.has(toolName), risk };
  }

  // Custom policy: check allowPrefixes first (for non-destructive), then level toggle
  if (
    risk.level !== 'destructive' &&
    toolName === 'ssh_exec' &&
    customRules.allowPrefixes.length > 0
  ) {
    const cmd = String(args.command ?? '').trim();
    const matchedAllow = customRules.allowPrefixes.some((prefix) => {
      const p = prefix.trim();
      return p.length > 0 && (cmd === p || cmd.startsWith(`${p} `));
    });
    if (matchedAllow) {
      return { autoApprove: true, risk };
    }
  }

  return {
    autoApprove: Boolean(customRules.autoApproveLevels[risk.level]),
    risk,
  };
}
