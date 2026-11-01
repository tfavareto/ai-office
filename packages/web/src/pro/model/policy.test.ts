import { describe, expect, it } from 'vitest';
import {
  LIVE_MIN_SCREEN_WIDTH,
  LIVE_MIN_ZOOM,
  MAX_LIVE_TERMINALS,
  POLL_ACTIVE_MS,
  POLL_CALM_MS,
  planTerminals,
  pollFor,
  type PolicyNode,
} from './policy';

const visible = { x: 0, y: 0, width: 2000, height: 1200 };

function node(id: string, over: Partial<PolicyNode> = {}): PolicyNode {
  return {
    id,
    rect: { x: 100, y: 100, width: 320, height: 240 },
    status: 'working',
    focused: false,
    finished: false,
    isOrchestrator: false,
    ...over,
  };
}

describe('pollFor', () => {
  it('polls busy terminals fast, calm ones slowly and finished ones never', () => {
    expect(pollFor('working', false)).toBe(POLL_ACTIVE_MS);
    expect(pollFor('waiting', false)).toBe(POLL_ACTIVE_MS);
    expect(pollFor('idle', false)).toBe(POLL_CALM_MS);
    expect(pollFor('done', false)).toBe(0);
    expect(pollFor('working', true)).toBe(0);
  });
});

describe('planTerminals', () => {
  it('leaves terminals off the screen alone: no render and no polling', () => {
    const plan = planTerminals({
      nodes: [node('away', { rect: { x: 9000, y: 9000, width: 320, height: 240 } })],
      visible,
      zoom: 1,
      paused: false,
    });
    expect(plan.get('away')).toEqual({ detail: 'hidden', pollMs: 0 });
  });

  it('shows only the last activity of a terminal too small to read', () => {
    const zoom = (LIVE_MIN_SCREEN_WIDTH - 10) / 320;
    const plan = planTerminals({ nodes: [node('small')], visible, zoom, paused: false });
    expect(plan.get('small')).toEqual({ detail: 'summary', pollMs: 0 });
    const readable = planTerminals({
      nodes: [node('small')],
      visible,
      zoom: LIVE_MIN_SCREEN_WIDTH / 320,
      paused: false,
    });
    expect(readable.get('small')?.detail).toBe('live');
  });

  it('keeps even a wide terminal as a summary when the zoom is too low to read its text', () => {
    const wide = { ...node('wide'), rect: { x: 100, y: 100, width: 2000, height: 900 } };
    const plan = planTerminals({ nodes: [wide], visible, zoom: LIVE_MIN_ZOOM - 0.05, paused: false });
    expect(plan.get('wide')?.detail).toBe('summary');
  });

  it('goes quiet when paused (hidden page, not local, time-lapse)', () => {
    const plan = planTerminals({ nodes: [node('a')], visible, zoom: 1, paused: true });
    expect(plan.get('a')).toEqual({ detail: 'summary', pollMs: 0 });
  });

  it('lets only the best few terminals be live, preferring what the user looks at, then who is busy', () => {
    const nodes = [
      ...Array.from({ length: 14 }, (_, i) =>
        node(`idle${i}`, { status: 'idle', rect: { x: 100 + i * 10, y: 100, width: 320, height: 240 } }),
      ),
      node('busy', { status: 'working' }),
      node('focused', { status: 'idle', focused: true, rect: { x: 1800, y: 900, width: 320, height: 240 } }),
    ];
    const plan = planTerminals({ nodes, visible: { x: 0, y: 0, width: 3000, height: 1500 }, zoom: 1, paused: false });
    const live = [...plan.entries()].filter(([, policy]) => policy.detail === 'live');
    expect(live).toHaveLength(MAX_LIVE_TERMINALS);
    expect(plan.get('focused')?.detail).toBe('live');
    expect(plan.get('busy')?.detail).toBe('live');
    expect(plan.get('idle0')?.detail).toBe('summary');
  });

  it('puts a finished terminal after the ones that can still change', () => {
    const nodes = [node('finished', { finished: true, status: 'done' }), node('running')];
    const plan = planTerminals({ nodes, visible, zoom: 1, paused: false, maxLive: 1 });
    expect(plan.get('running')?.detail).toBe('live');
    expect(plan.get('finished')?.detail).toBe('summary');
  });
});
