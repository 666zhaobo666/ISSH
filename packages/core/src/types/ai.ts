export type AiMode = 'ask' | 'agent';

export type ApprovalPolicy = 'manual' | 'custom' | 'auto';

export type CommandRiskLevel =
  | 'readonly'
  | 'file_write'
  | 'normal_exec'
  | 'system_ops'
  | 'destructive';

export interface AiProviderConfig {
  id: string;
  name: string;
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  /** Default/selected model (kept for compatibility) */
  model: string;
  /** Available models fetched from /models or manually added */
  models?: string[];
  temperature?: number;
  enabled?: boolean;
}

export interface ActiveModelRef {
  providerId: string;
  model: string;
}

export interface AiSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  updatedAt: number;
}

export interface CustomApprovalRules {
  autoApproveLevels: Record<CommandRiskLevel, boolean>;
  /** Independent toggle for Auto mode: whether to auto-approve destructive commands */
  autoApproveDestructive?: boolean;
  /** Command prefixes automatically approved in Custom mode (unless destructive) */
  allowPrefixes: string[];
  /** Regex patterns that always force manual approval across all modes */
  denyPatterns: string[];
}

export type AiToolName =
  | 'ssh_exec'
  | 'sftp_read'
  | 'sftp_write'
  | 'sftp_edit'
  | 'sftp_list'
  | 'sftp_grep'
  | 'get_terminal_context';

export interface AiToolCall {
  id: string;
  name: AiToolName;
  arguments: Record<string, unknown>;
}

export interface AiApprovalRequest {
  requestId: string;
  sessionId: string;
  toolCall: AiToolCall;
  riskLevel: CommandRiskLevel;
  /** True if matched by local dangerous-command safety guardrail */
  isHighRisk: boolean;
  riskReason?: string;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
  createdAt: number;
}
