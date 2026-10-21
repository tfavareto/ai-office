import { describe, expect, test } from 'vitest';
import { type TimelapseEvent } from '@ai-office/shared';
import { fitEvents } from './fit';

const activity = (agent: number, at: number, kind: 'read' | 'edit' | 'prompt' | 'done' = 'read'): TimelapseEvent => ({ at, type: 'activity', agent, kind, icon: '📖', text: 't', msg: { key: 'activity.read' } });
const status = (agent: number, at: number): TimelapseEvent => ({ at, type: 'status', agent, status: 'working' });

describe('fitEvents', () => {
  test('leaves a day within the budget exactly as it is', () => {
    const events = [status(0, 1), activity(0, 2), activity(0, 3)];

    expect(fitEvents(events, 10)).toEqual({ events, trimmed: false });
  });

  test('thins ordinary activities first, with a growing gap per agent, and keeps the structure of the day', () => {
    const events: TimelapseEvent[] = [status(0, 0), status(1, 0)];
    for (let i = 1; i <= 400; i++) events.push(activity(0, i * 1000), activity(1, i * 1000));
    const fitted = fitEvents(events, 200);

    expect(fitted.trimmed).toBe(true);
    expect(fitted.events.length).toBeLessThanOrEqual(200);
    expect(fitted.events.filter((event) => event.type === 'status')).toHaveLength(2);
    expect(fitted.events.filter((event) => event.type === 'activity' && event.agent === 0).length).toBeGreaterThan(5);
  });

  test('keeps the key activities (prompts, completions) when everything ordinary has to go', () => {
    const events: TimelapseEvent[] = [];
    for (let i = 0; i < 300; i++) events.push(activity(0, i * 60_000, i % 10 === 0 ? 'prompt' : 'read'));
    const fitted = fitEvents(events, 40);

    expect(fitted.events.length).toBeLessThanOrEqual(40);
    expect(fitted.events.filter((event) => event.type === 'activity' && event.kind === 'prompt')).toHaveLength(30);
  });

  test('as a last resort drops activities altogether and never exceeds the budget', () => {
    const events: TimelapseEvent[] = [];
    for (let i = 0; i < 100; i++) events.push(status(i, i), activity(i, i + 0.5, 'prompt'));
    const fitted = fitEvents(events, 100);

    expect(fitted.events.length).toBeLessThanOrEqual(100);
    expect(fitted.events.every((event) => event.type === 'status')).toBe(true);
    expect(fitted.trimmed).toBe(true);
  });

  test('keeps only the last task list change of each minute when it comes to that', () => {
    const tasks = (at: number): TimelapseEvent => ({ at, type: 'tasks', agent: 0, tasks: [] });
    const events: TimelapseEvent[] = Array.from({ length: 60 }, (_, i) => tasks(i * 1000));
    const fitted = fitEvents(events, 5);

    expect(fitted.events).toHaveLength(1);
    expect(fitted.events[0]?.at).toBe(59_000);
  });
});
