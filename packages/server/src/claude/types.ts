// Typed view of the Claude Code transcript lines the office cares about (everything else is ignored).

export interface LineMeta {
  /** Epoch ms of the line's timestamp. */
  at: number;
  cwd?: string;
  gitBranch?: string;
  /** Present on subagent transcripts. */
  agentId?: string;
  permissionMode?: string;
}

/** Token usage of one assistant message. Cache writes are split by TTL because they are priced differently. */
export interface UsageInfo {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface ToolResultInfo {
  toolUseId: string;
  /** Flattened text of the result (images become "[imagem]"). */
  text: string;
  isError: boolean;
}

/** Facts extracted from the structured `toolUseResult` of a user line. */
export interface StructuredResult {
  linesAdded: number;
  linesRemoved: number;
  /** Background Bash/Monitor task id (used by KillShell / TaskStop). */
  backgroundTaskId?: string;
  /** The Task/Agent tool returned immediately because the subagent runs in the background. */
  asyncAgent: boolean;
  agentId?: string;
  /** Id assigned to a task created by TaskCreate. */
  createdTaskId?: string;
}

export type ParsedLine =
  | ({ kind: 'prompt'; text: string } & LineMeta)
  | ({ kind: 'interrupt' } & LineMeta)
  | ({ kind: 'tool-results'; results: ToolResultInfo[]; structured?: StructuredResult } & LineMeta)
  | ({
      kind: 'assistant';
      messageId?: string;
      model?: string;
      stopReason?: string;
      blocks: AssistantBlock[];
      usage?: UsageInfo;
      apiError: boolean;
    } & LineMeta)
  | ({ kind: 'notification'; toolUseId?: string; taskId?: string; status: string; summary?: string } & LineMeta)
  | ({ kind: 'system'; subtype: string; text?: string } & LineMeta)
  | { kind: 'title'; title: string }
  | { kind: 'last-prompt'; text: string }
  | { kind: 'mode'; mode: string }
  | { kind: 'cost-state'; costUSD: number; linesAdded: number; linesRemoved: number };

export const END_STOP_REASONS: ReadonlySet<string> = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'refusal']);
