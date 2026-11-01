import type { PermissionRequest } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import {
  ASK_NONE,
  askView,
  canAlwaysAllow,
  canSend,
  followRequest,
  sending,
  settled,
  terminalRequest,
  type AskState,
} from './ask';

const NOW = 1_000_000;

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: 'req-1',
    agentId: 'a1',
    toolName: 'Bash',
    summary: 'npm test',
    suggestions: ['Bash(npm test:*)'],
    createdAt: NOW - 1000,
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

const CONTEXT = { local: true, now: NOW };

describe('terminalRequest', () => {
  it('shows the request the terminal’s own agent waits on', () => {
    const permission = request();
    expect(terminalRequest({ status: 'waiting', permission }, false)).toBe(permission);
  });

  it('shows nothing for a finished subagent, an agent that does not wait, a question or a Codex session', () => {
    const permission = request();
    expect(terminalRequest({ status: 'waiting', permission }, true)).toBeNull();
    expect(terminalRequest({ status: 'working', permission }, false)).toBeNull();
    expect(terminalRequest({ status: 'waiting' }, false)).toBeNull();
    expect(terminalRequest({ status: 'waiting', permission, source: 'codex' }, false)).toBeNull();
  });
});

describe('the answer state', () => {
  it('keeps the state for the same request and starts over for a new one or none', () => {
    // Arrange
    const shown = followRequest(ASK_NONE, 'req-1');
    const busy = sending(shown, 'allow');

    // Act and assert
    expect(followRequest(busy, 'req-1')).toBe(busy);
    expect(followRequest(busy, 'req-2')).toEqual({ ...ASK_NONE, requestId: 'req-2' });
    expect(followRequest(busy, null)).toEqual(ASK_NONE);
  });

  it('sends only for the request the agent still waits on, once at a time', () => {
    const shown = followRequest(ASK_NONE, 'req-1');
    expect(canSend(shown, { permission: request() })).toBe(true);
    expect(canSend(shown, { permission: request({ id: 'req-2' }) })).toBe(false);
    expect(canSend(shown, { permission: undefined })).toBe(false);
    expect(canSend(shown, undefined)).toBe(false);
    expect(canSend(sending(shown, 'deny'), { permission: request() })).toBe(false);
    expect(canSend(ASK_NONE, { permission: request() })).toBe(false);
  });

  it('settles on sent, answered first or failed, and lets a failed answer try again', () => {
    // Arrange
    const busy = sending(followRequest(ASK_NONE, 'req-1'), 'allow');

    // Act
    const ok = settled(busy, 'req-1', { kind: 'ok' });
    const first = settled(busy, 'req-1', { kind: 'already-answered' });
    const failed = settled(busy, 'req-1', { kind: 'failed', message: 'offline' });

    // Assert
    expect(ok.phase).toBe('sent');
    expect(first.phase).toBe('answered');
    expect(failed).toMatchObject({ phase: 'failed', error: 'offline' });
    expect(canSend(failed, { permission: request() })).toBe(true);
    expect(canSend(ok, { permission: request() })).toBe(false);
  });

  it('ignores an answer that comes back after the terminal moved on to another request', () => {
    const moved: AskState = followRequest(sending(followRequest(ASK_NONE, 'req-1'), 'allow'), 'req-2');
    expect(settled(moved, 'req-1', { kind: 'ok' })).toBe(moved);
  });
});

describe('askView', () => {
  it('offers the buttons, with "always allow" only when Claude Code suggested a rule', () => {
    const shown = followRequest(ASK_NONE, 'req-1');
    expect(askView(request(), shown, CONTEXT)).toEqual({
      showButtons: true,
      enabled: true,
      always: true,
      pressed: null,
      note: { kind: 'none' },
    });
    expect(askView(request({ suggestions: [] }), shown, CONTEXT).always).toBe(false);
  });

  it('never offers "always allow" for a risky request', () => {
    const risky = request({ summary: 'rm -rf dist', input: { command: 'rm -rf dist' } });
    expect(canAlwaysAllow(risky)).toBe(false);
  });

  it('disables the buttons while sending and after sending, showing the answer that went out', () => {
    const busy = sending(followRequest(ASK_NONE, 'req-1'), 'deny');
    expect(askView(request(), busy, CONTEXT)).toMatchObject({
      enabled: false,
      pressed: 'deny',
      note: { kind: 'sending' },
    });
    expect(askView(request(), settled(busy, 'req-1', { kind: 'ok' }), CONTEXT)).toMatchObject({
      enabled: false,
      note: { kind: 'sent' },
    });
  });

  it('hides the buttons when someone answered first or the request expired', () => {
    const busy = sending(followRequest(ASK_NONE, 'req-1'), 'allow');
    const first = settled(busy, 'req-1', { kind: 'already-answered' });
    expect(askView(request(), first, CONTEXT)).toMatchObject({ showButtons: false, note: { kind: 'answered' } });
    const expired = request({ expiresAt: NOW - 1 });
    expect(askView(expired, followRequest(ASK_NONE, 'req-1'), CONTEXT)).toMatchObject({
      showButtons: false,
      note: { kind: 'expired' },
    });
  });

  it('shows the error of a failed answer with the buttons back on, and explains a page that is not local', () => {
    const failed = settled(sending(followRequest(ASK_NONE, 'req-1'), 'allow'), 'req-1', {
      kind: 'failed',
      message: 'Sem conexão',
    });
    expect(askView(request(), failed, CONTEXT)).toMatchObject({
      enabled: true,
      note: { kind: 'failed', error: 'Sem conexão' },
    });
    expect(askView(request(), followRequest(ASK_NONE, 'req-1'), { ...CONTEXT, local: false })).toMatchObject({
      enabled: false,
      note: { kind: 'local-only' },
    });
  });
});
