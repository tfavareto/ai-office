import { describe, expect, test } from 'vitest';
import { PENDING_TOOL_WAIT_MS, STALE_WORKING_MS, STALE_WORKING_NO_REGISTRY_MS, type StatusInput, deriveStatus } from './status';

const NOW = 1_000_000;
const base = (over: Partial<StatusInput>): StatusInput => ({ now: NOW, turn: 'idle', lastEventAt: NOW - 1000, permissionPending: false, ...over });

describe('deriveStatus', () => {
  test('idle when the turn ended and nothing else says otherwise', () => {
    expect(deriveStatus(base({}))).toEqual({ status: 'idle' });
    expect(deriveStatus(base({ registryStatus: 'idle' }))).toEqual({ status: 'idle' });
  });

  test('working while a turn is being processed', () => {
    expect(deriveStatus(base({ turn: 'working' })).status).toBe('working');
    expect(deriveStatus(base({ turn: 'working', registryStatus: 'busy' })).status).toBe('working');
  });

  test('a pending permission wins and has no waitingFor text', () => {
    expect(deriveStatus(base({ turn: 'working', permissionPending: true }))).toEqual({ status: 'waiting' });
  });

  test('attention marks and pending questions wait with their text', () => {
    expect(deriveStatus(base({ attentionMessage: 'Precisa de você' }))).toEqual({ status: 'waiting', waitingFor: 'Precisa de você' });
    expect(deriveStatus(base({ turn: 'working', pendingUserTool: 'Responder uma pergunta' }))).toEqual({ status: 'waiting', waitingFor: 'Responder uma pergunta' });
  });

  test('a tool pending over 8 s while the registry says idle means "Aprovar <ferramenta>"', () => {
    const old = { name: 'Bash', at: NOW - PENDING_TOOL_WAIT_MS - 1 };
    expect(deriveStatus(base({ turn: 'working', registryStatus: 'idle', blockingTool: old }))).toEqual({
      status: 'waiting',
      waitingFor: 'Aprovar Bash',
      waitingForMsg: { key: 'waiting.approve', params: { tool: 'Bash' } },
    });
    const fresh = { name: 'Bash', at: NOW - 2000 };
    expect(deriveStatus(base({ turn: 'working', registryStatus: 'idle', blockingTool: fresh })).status).toBe('working');
    expect(deriveStatus(base({ turn: 'working', registryStatus: 'busy', blockingTool: old })).status).toBe('working');
  });

  test('registry "waiting" is surfaced', () => {
    expect(deriveStatus(base({ turn: 'working', registryStatus: 'waiting' })).status).toBe('waiting');
  });

  test('a turn that stalled while the registry says idle is considered finished', () => {
    expect(deriveStatus(base({ turn: 'working', registryStatus: 'idle', lastEventAt: NOW - STALE_WORKING_MS - 1 })).status).toBe('idle');
    expect(deriveStatus(base({ turn: 'working', lastEventAt: NOW - STALE_WORKING_NO_REGISTRY_MS - 1 })).status).toBe('idle');
    expect(deriveStatus(base({ turn: 'working', lastEventAt: NOW - 60_000 })).status).toBe('working');
  });

  test('registry busy after the turn ended means new work, unless it is stale news', () => {
    expect(deriveStatus(base({ registryStatus: 'busy', registryStatusAt: NOW - 500, lastEventAt: NOW - 20_000 })).status).toBe('working');
    // Busy flag older than the end of the turn: hooks (e.g. a Stop standby) are running, not work.
    expect(deriveStatus(base({ registryStatus: 'busy', registryStatusAt: NOW - 5000, lastEventAt: NOW - 1000 })).status).toBe('idle');
  });
});
