// Maps Claude Code tool calls and session events to the pt-BR activity texts shown in the office.
// Used by the server (real transcripts) and by the demo simulator, so both speak the same language.
import type { Activity, ActivityKind } from './model';
import { basename, formatDuration, oneLine, truncate } from './format';

export const ACTIVITY_TEXT_MAX = 60;
export const ACTIVITY_DETAIL_MAX = 400;

/** An activity before it gets an id and a timestamp. */
export interface ActivityDraft {
  kind: ActivityKind;
  icon: string;
  text: string;
  detail?: string;
  error?: boolean;
  durationMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function draft(kind: ActivityKind, icon: string, text: string, detail?: string): ActivityDraft {
  const result: ActivityDraft = { kind, icon, text: truncate(text, ACTIVITY_TEXT_MAX) };
  if (detail !== undefined && detail.length > 0) result.detail = truncate(detail, ACTIVITY_DETAIL_MAX);
  return result;
}

function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url);
  return match?.[1] !== undefined ? match[1].replace(/^www\./i, '') : truncate(url, 30);
}

/** "mcp__server__tool" -> { server, tool }. Server names lose the "claude_ai_" style prefixes. */
export function parseMcpName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined;
  const rest = name.slice(5);
  const split = rest.indexOf('__');
  if (split < 0) return { server: rest, tool: rest };
  return { server: rest.slice(0, split), tool: rest.slice(split + 2) };
}

function fileLabel(input: Record<string, unknown>): { label: string; path?: string } {
  const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  return path === undefined ? { label: 'arquivo' } : { label: basename(path), path };
}

/** Activity for a tool_use block: `name` is the tool name, `input` its (untrusted) input object. */
export function describeToolUse(name: string, input: unknown): ActivityDraft {
  const args = asRecord(input);
  switch (name) {
    case 'Read': {
      const file = fileLabel(args);
      return draft('read', '📖', `Lendo ${file.label}`, file.path);
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const file = fileLabel(args);
      return draft('edit', '✏️', `Editando ${file.label}`, file.path);
    }
    case 'Write': {
      const file = fileLabel(args);
      return draft('write', '📝', `Escrevendo ${file.label}`, file.path);
    }
    case 'Bash': {
      const command = str(args.command) ?? '';
      const description = str(args.description);
      const head = oneLine(command.split('\n')[0] ?? '');
      return draft('bash', '💻', description ?? (head || 'Executando um comando'), command);
    }
    case 'BashOutput':
    case 'TaskOutput':
      return draft('bash', '📤', 'Lendo a saída de um processo');
    case 'KillShell':
    case 'TaskStop':
      return draft('bash', '⏹️', 'Encerrando um processo');
    case 'Monitor': {
      const label = str(args.description) ?? str(args.command) ?? 'processo';
      return draft('bash', '👀', `Monitorando: ${label}`, str(args.command));
    }
    case 'Grep':
    case 'Glob': {
      const pattern = str(args.pattern) ?? '';
      return draft('search', '🔎', `Buscando “${pattern}”`, [pattern, str(args.path)].filter(Boolean).join(' em '));
    }
    case 'WebFetch': {
      const url = str(args.url) ?? '';
      return draft('web', '🌐', `Consultando ${hostOf(url)}`, url);
    }
    case 'WebSearch': {
      const query = str(args.query) ?? '';
      return draft('web', '🌐', `Pesquisando “${query}”`, query);
    }
    case 'Task':
    case 'Agent': {
      const description = str(args.description) ?? str(args.subagent_type) ?? 'uma tarefa';
      return draft('subagent', '👥', `Delegando: ${description}`, str(args.prompt));
    }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
      return draft('task', '📋', 'Atualizando a lista de tarefas');
    case 'AskUserQuestion':
      return draft('question', '❓', 'Fazendo uma pergunta a você');
    case 'ExitPlanMode':
      return draft('question', '🗺️', 'Apresentando o plano para aprovação', str(args.plan));
    case 'EnterPlanMode':
      return draft('other', '🗺️', 'Planejando antes de agir');
    case 'Skill':
      return draft('other', '🧩', `Usando a skill ${str(args.skill) ?? ''}`.trim());
    case 'ToolSearch':
      return draft('other', '🧰', 'Procurando ferramentas', str(args.query));
    default: {
      const mcp = parseMcpName(name);
      if (mcp !== undefined) return draft('mcp', '🔌', `${mcp.server}: ${mcp.tool}`);
      return draft('other', '⚙️', `Usando ${name}`);
    }
  }
}

export function thinkingDraft(): ActivityDraft {
  return draft('think', '💭', 'Pensando…');
}

export function replyDraft(detail?: string): ActivityDraft {
  return draft('reply', '💬', 'Escrevendo a resposta', detail);
}

export function promptDraft(prompt: string): ActivityDraft {
  // Reserve room for the label and the quotes so the whole text stays within the limit.
  return draft('prompt', '📨', `Nova tarefa: “${truncate(prompt, 40)}”`, prompt);
}

export function errorDraft(toolName: string, detail?: string): ActivityDraft {
  return { ...draft('error', '⚠️', `Erro em ${toolName}`, detail), error: true };
}

export function doneDraft(durationMs: number): ActivityDraft {
  return { ...draft('done', '✅', `Concluiu em ${formatDuration(durationMs)}`), durationMs };
}

export function messageDraft(text: string): ActivityDraft {
  return draft('message', '📨', `Mensagem sua: ${truncate(text, 45)}`, text);
}

export function permissionDraft(summary: string): ActivityDraft {
  return draft('permission', '🔐', `Pedindo permissão: ${summary}`, summary);
}

/** Gives a draft its id and timestamp. */
export function toActivity(draftValue: ActivityDraft, id: string, at: number): Activity {
  return { id, at, ...draftValue };
}
