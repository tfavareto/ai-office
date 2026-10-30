// The permission prompt inside a terminal, answered right there: which request a terminal shows, and the state of its
// buttons while an answer goes out. The answer itself goes through the same client and endpoint as the inbox and the
// drawer (`AppContext.answerPermission` → `POST /api/permissions/:id/decision`). Pure.
import { detectRisk, isCodex, type Agent, type PermissionRequest } from '@ai-office/shared';
import type { PermissionOutcome } from '../../ui/context';

/** ready: the buttons answer · sending: one answer is on its way · sent: the agent was told, waiting for the snapshot ·
 * answered: someone answered first (here, in the inbox or in the session's terminal) · failed: try again. */
export type AskPhase = 'ready' | 'sending' | 'sent' | 'answered' | 'failed';

export type AskAction = 'allow' | 'always' | 'deny';

export interface AskState {
  /** The request the buttons answer; null when the terminal shows none. */
  requestId: string | null;
  phase: AskPhase;
  /** The answer being sent or sent. */
  action: AskAction | null;
  /** Why the last answer failed (already localized by the client). */
  error: string | null;
}

export const ASK_NONE: AskState = { requestId: null, phase: 'ready', action: null, error: null };

/**
 * The request this terminal answers: the one its own agent waits on, while it is still on the canvas as a live agent.
 * A finished subagent, an agent waiting on a question rather than a permission, or a Codex session (AI Office only
 * watches those) has none.
 */
export function terminalRequest(
  agent: Pick<Agent, 'status' | 'permission' | 'source'>,
  finished: boolean,
): PermissionRequest | null {
  if (finished || agent.status !== 'waiting' || isCodex(agent)) return null;
  return agent.permission ?? null;
}

/** Follows the request on screen: the same request keeps its state, a new one (or none) starts over. */
export function followRequest(state: AskState, requestId: string | null): AskState {
  if (state.requestId === requestId) return state;
  return { ...ASK_NONE, requestId };
}

/** Whether an answer may go out now for the request on screen (and the agent still waits on that same one). */
export function canSend(state: AskState, current: Pick<Agent, 'permission'> | undefined): boolean {
  if (state.requestId === null || state.phase === 'sending' || state.phase === 'sent' || state.phase === 'answered')
    return false;
  return current?.permission?.id === state.requestId;
}

export function sending(state: AskState, action: AskAction): AskState {
  return { ...state, phase: 'sending', action, error: null };
}

/** The state after the client answered; ignored when the terminal moved on to another request meanwhile. */
export function settled(state: AskState, requestId: string, outcome: PermissionOutcome): AskState {
  if (state.requestId !== requestId) return state;
  switch (outcome.kind) {
    case 'ok':
      return { ...state, phase: 'sent', error: null };
    case 'already-answered':
      return { ...state, phase: 'answered', error: null };
    case 'failed':
      return { ...state, phase: 'failed', error: outcome.message };
  }
}

/** "Always allow" is offered as in the inbox: only with a rule Claude Code suggested, never for a risky request. */
export function canAlwaysAllow(permission: PermissionRequest): boolean {
  return permission.suggestions.length > 0 && detectRisk(permission) === null;
}

export type AskNote =
  | { kind: 'none' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'answered' }
  | { kind: 'failed'; error: string }
  | { kind: 'expired' }
  | { kind: 'local-only' };

export interface AskView {
  /** The buttons are shown (not for a request that expired or was answered first). */
  showButtons: boolean;
  /** The buttons take a click. */
  enabled: boolean;
  always: boolean;
  /** The answer that is on its way or was sent (its button shows it). */
  pressed: AskAction | null;
  note: AskNote;
}

export interface AskContext {
  /** Answers only go out from the computer AI Office runs on. */
  local: boolean;
  now: number;
}

/** What the box shows for a request and the state of its answer. */
export function askView(permission: PermissionRequest, state: AskState, context: AskContext): AskView {
  const always = canAlwaysAllow(permission);
  const base = { always, pressed: state.action };
  if (state.phase === 'answered') return { ...base, showButtons: false, enabled: false, note: { kind: 'answered' } };
  if (state.phase === 'sent') return { ...base, showButtons: true, enabled: false, note: { kind: 'sent' } };
  if (state.phase === 'sending') return { ...base, showButtons: true, enabled: false, note: { kind: 'sending' } };
  if (permission.expiresAt <= context.now)
    return { ...base, showButtons: false, enabled: false, pressed: null, note: { kind: 'expired' } };
  if (!context.local)
    return { ...base, showButtons: true, enabled: false, pressed: null, note: { kind: 'local-only' } };
  const note: AskNote = state.phase === 'failed' ? { kind: 'failed', error: state.error ?? '' } : { kind: 'none' };
  return { ...base, showButtons: true, enabled: true, pressed: null, note };
}
