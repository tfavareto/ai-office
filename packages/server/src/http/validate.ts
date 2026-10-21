// Defensive validation of request bodies and query parameters.
import {
  HIRE_MAX_DESK_INDEX,
  HIRE_MAX_PATH,
  HIRE_MAX_PROMPT,
  HIRE_MODELS,
  HIRE_PERMISSION_MODES,
  type HireModel,
  type HirePermissionMode,
  type HireRequest,
  type Locale,
  type PermissionDecision,
  type PermissionHookRequest,
  isLocale,
} from '@ai-office/shared';
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

/** Optional `locale` field: absent is fine, anything but a supported locale is a 400. */
function optionalLocale(value: unknown): Locale | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isLocale(value)) throw new HttpError(400, 'invalid-locale');
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], code: string): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new HttpError(400, code);
  return value as T;
}

/** Body of POST /api/agents/hire: types, enums and sizes only; the folder and the account are checked by the service. */
export function parseHireRequest(body: unknown): HireRequest {
  const raw = asRecord(body);
  const projectPath = asString(raw.projectPath);
  if (projectPath === undefined || projectPath.trim().length === 0 || projectPath.length > HIRE_MAX_PATH) throw new HttpError(400, 'invalid-projectPath');
  const request: HireRequest = { projectPath };
  const accountId = optionalString(raw.accountId, 'accountId');
  if (accountId !== undefined) request.accountId = accountId;
  if (raw.prompt !== undefined && raw.prompt !== null) {
    if (typeof raw.prompt !== 'string' || raw.prompt.length > HIRE_MAX_PROMPT || raw.prompt.includes('\0')) throw new HttpError(400, 'invalid-prompt');
    const prompt = raw.prompt.trim();
    if (prompt.length > 0) request.prompt = prompt;
  }
  const model = oneOf<HireModel>(raw.model, HIRE_MODELS, 'invalid-model');
  if (model !== undefined) request.model = model;
  const permissionMode = oneOf<HirePermissionMode>(raw.permissionMode, HIRE_PERMISSION_MODES, 'invalid-permissionMode');
  if (permissionMode !== undefined) request.permissionMode = permissionMode;
  if (raw.deskIndex !== undefined && raw.deskIndex !== null) {
    const desk = asNumber(raw.deskIndex);
    if (desk === undefined || !Number.isInteger(desk) || desk < 0 || desk > HIRE_MAX_DESK_INDEX) throw new HttpError(400, 'invalid-deskIndex');
    request.deskIndex = desk;
  }
  const locale = optionalLocale(raw.locale);
  if (locale !== undefined) request.locale = locale;
  return request;
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
  const locale = optionalLocale(raw.locale);
  if (locale !== undefined) decision.locale = locale;
  return decision;
}

export function parseSendMessage(body: unknown, maxAgents: number, maxText: number): { agents: string[]; text: string; locale?: Locale } {
  const raw = asRecord(body);
  const agents = asArray(raw.agents).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID);
  if (agents.length === 0) throw new HttpError(400, 'invalid-agents');
  const text = requiredString(typeof raw.text === 'string' ? raw.text.trim() : undefined, 'text', maxText);
  const locale = optionalLocale(raw.locale);
  return { agents: agents.slice(0, maxAgents), text, ...(locale !== undefined ? { locale } : {}) };
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

const DEFAULT_LOG_LIMIT = 500;

/** `limit` of the rule log: a whole number from 1 to 500 (500 when absent or unreadable). */
export function parseLogLimit(raw: string | null): number {
  const limit = raw === null ? DEFAULT_LOG_LIMIT : Number(raw);
  return Number.isInteger(limit) && limit >= 1 ? Math.min(limit, DEFAULT_LOG_LIMIT) : DEFAULT_LOG_LIMIT;
}

/** Seconds query parameter converted to milliseconds, clamped to [0, maxSeconds]. */
export function parseTimeoutMs(raw: string | null, maxSeconds: number, fallbackSeconds: number): number {
  const seconds = raw === null ? fallbackSeconds : Number(raw);
  if (!Number.isFinite(seconds)) return fallbackSeconds * 1000;
  return Math.min(Math.max(seconds, 0), maxSeconds) * 1000;
}
