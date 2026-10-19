// Defensive validation of request bodies and query parameters.
import type { PermissionDecision, PermissionHookRequest } from '@ai-office/shared';
import { asArray, asNumber, asRecord, asString } from '../util/fs-safe';
import { HttpError } from './respond';

const MAX_ID = 300;

function requiredString(value: unknown, name: string, max = MAX_ID): string {
  const text = asString(value);
  if (text === undefined || text.length === 0 || text.length > max) throw new HttpError(400, `invalid-${name}`);
  return text;
}

function optionalString(value: unknown, name: string, max = MAX_ID): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, name, max);
}

export function parsePermissionHookRequest(body: unknown): PermissionHookRequest {
  const raw = asRecord(body);
  const request: PermissionHookRequest = {
    session_id: requiredString(raw.session_id, 'session_id'),
    tool_name: requiredString(raw.tool_name, 'tool_name', 200),
    tool_input: raw.tool_input,
  };
  if (Array.isArray(raw.permission_suggestions)) request.permission_suggestions = raw.permission_suggestions.slice(0, 20);
  const agentId = optionalString(raw.agent_id, 'agent_id');
  if (agentId !== undefined) request.agent_id = agentId;
  const cwd = optionalString(raw.cwd, 'cwd', 2000);
  if (cwd !== undefined) request.cwd = cwd;
  const timeout = asNumber(raw.timeout_ms);
  if (timeout !== undefined) request.timeout_ms = timeout;
  return request;
}

export function parseDecision(body: unknown, suggestionCount: number): PermissionDecision {
  const raw = asRecord(body);
  const behavior = raw.behavior;
  if (behavior !== 'allow' && behavior !== 'deny' && behavior !== 'terminal') throw new HttpError(400, 'invalid-behavior');
  const decision: PermissionDecision = { behavior };
  if (raw.suggestion !== undefined) {
    const index = asNumber(raw.suggestion);
    if (behavior !== 'allow' || index === undefined || !Number.isInteger(index) || index < 0 || index >= suggestionCount) {
      throw new HttpError(400, 'invalid-suggestion');
    }
    decision.suggestion = index;
  }
  if (raw.message !== undefined) decision.message = requiredString(raw.message, 'message', 2000);
  if (raw.interrupt !== undefined) {
    if (typeof raw.interrupt !== 'boolean') throw new HttpError(400, 'invalid-interrupt');
    decision.interrupt = raw.interrupt;
  }
  return decision;
}

export function parseSendMessage(body: unknown, maxAgents: number, maxText: number): { agents: string[]; text: string } {
  const raw = asRecord(body);
  const agents = asArray(raw.agents).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID);
  if (agents.length === 0) throw new HttpError(400, 'invalid-agents');
  const text = requiredString(typeof raw.text === 'string' ? raw.text.trim() : undefined, 'text', maxText);
  return { agents: agents.slice(0, maxAgents), text };
}

export function parseInboxRequest(body: unknown): { sessionId: string; agentId?: string; via: 'tool' | 'stop' } {
  const raw = asRecord(body);
  const agentId = optionalString(raw.agent, 'agent');
  return { sessionId: requiredString(raw.session, 'session'), ...(agentId !== undefined ? { agentId } : {}), via: raw.via === 'stop' ? 'stop' : 'tool' };
}

export function parseAttention(body: unknown): { sessionId: string; agentId?: string; message?: string; type?: string } {
  const raw = asRecord(body);
  const result: { sessionId: string; agentId?: string; message?: string; type?: string } = { sessionId: requiredString(raw.session_id, 'session_id') };
  const agentId = optionalString(raw.agent_id, 'agent_id');
  if (agentId !== undefined) result.agentId = agentId;
  const message = asString(raw.message);
  if (message !== undefined) result.message = message.slice(0, 500);
  const type = asString(raw.notification_type);
  if (type !== undefined) result.type = type.slice(0, 60);
  return result;
}

/** Seconds query parameter converted to milliseconds, clamped to [0, maxSeconds]. */
export function parseTimeoutMs(raw: string | null, maxSeconds: number, fallbackSeconds: number): number {
  const seconds = raw === null ? fallbackSeconds : Number(raw);
  if (!Number.isFinite(seconds)) return fallbackSeconds * 1000;
  return Math.min(Math.max(seconds, 0), maxSeconds) * 1000;
}
