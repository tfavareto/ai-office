// Status derivation: a pure function from transcript/registry/overlay facts to the agent status.
import { type AgentStatus, type Msg, msg, sourceText } from '@ai-office/shared';

/** "Needs you": the generic reason when something blocks the agent and we cannot say what. */
export const NEEDS_YOU_MSG: Msg = msg('waiting.needsYou');
export const NEEDS_YOU_TEXT = sourceText(NEEDS_YOU_MSG);

/** A tool_use pending longer than this while the registry says idle means a permission prompt is open. */
export const PENDING_TOOL_WAIT_MS = 8000;
/** Transcript says "working" but nothing happened for this long while the registry says idle: the turn was cut. */
export const STALE_WORKING_MS = 15_000;
/** Without a registry, a "working" turn with no events for this long is considered finished. */
export const STALE_WORKING_NO_REGISTRY_MS = 10 * 60_000;
/** Registry "busy" updates this close to the end of a turn do not count as new work. */
const REGISTRY_GRACE_MS = 3000;

export interface StatusInput {
  now: number;
  turn: 'working' | 'idle';
  lastEventAt: number;
  /** Registry status ('busy', 'idle', 'waiting'...) when the session has a registry entry. */
  registryStatus?: string;
  registryStatusAt?: number;
  permissionPending: boolean;
  attentionMessage?: string;
  /** Localizable form of `attentionMessage`, when it is a generated text. */
  attentionMsg?: Msg;
  /** Text for a pending user-facing tool (question, plan approval). */
  pendingUserTool?: string;
  pendingUserToolMsg?: Msg;
  /** Oldest pending tool that normally finishes fast. */
  blockingTool?: { name: string; at: number };
}

export interface DerivedStatus {
  status: Extract<AgentStatus, 'working' | 'waiting' | 'idle'>;
  waitingFor?: string;
  waitingForMsg?: Msg;
}

function approveTool(name: string): Pick<DerivedStatus, 'waitingFor' | 'waitingForMsg'> {
  const message = msg('waiting.approve', { tool: name });
  return { waitingFor: sourceText(message), waitingForMsg: message };
}

function withMsg(waitingFor: string, waitingForMsg: Msg | undefined): Pick<DerivedStatus, 'waitingFor' | 'waitingForMsg'> {
  return { waitingFor, ...(waitingForMsg !== undefined ? { waitingForMsg } : {}) };
}

export function deriveStatus(input: StatusInput): DerivedStatus {
  const registry = input.registryStatus;
  if (input.permissionPending) return { status: 'waiting' };
  if (input.attentionMessage !== undefined) return { status: 'waiting', ...withMsg(input.attentionMessage, input.attentionMsg) };
  if (input.pendingUserTool !== undefined) return { status: 'waiting', ...withMsg(input.pendingUserTool, input.pendingUserToolMsg) };
  if (registry === 'waiting') {
    return { status: 'waiting', ...(input.blockingTool ? approveTool(input.blockingTool.name) : withMsg(NEEDS_YOU_TEXT, NEEDS_YOU_MSG)) };
  }
  const tool = input.blockingTool;
  if (registry === 'idle' && tool !== undefined && input.now - tool.at > PENDING_TOOL_WAIT_MS) {
    return { status: 'waiting', ...approveTool(tool.name) };
  }
  const registryKnown = registry !== undefined;
  const idleFor = input.now - input.lastEventAt;
  let working = input.turn === 'working';
  if (working && registry === 'idle' && idleFor > STALE_WORKING_MS) working = false;
  if (working && !registryKnown && idleFor > STALE_WORKING_NO_REGISTRY_MS) working = false;
  if (registry === 'busy') {
    const turnEnded = input.turn === 'idle';
    const registryAt = input.registryStatusAt ?? input.now;
    working = working || !(turnEnded && registryAt <= input.lastEventAt + REGISTRY_GRACE_MS);
  }
  return { status: working ? 'working' : 'idle' };
}
