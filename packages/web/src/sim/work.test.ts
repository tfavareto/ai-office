import type { Activity } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { makeAgent } from './testkit';
import { seatedPoseFor, workMood, type MoodContext } from './work';

const ctx = (over: Partial<MoodContext> = {}): MoodContext => ({
  now: 100_000,
  foregroundShell: false,
  workingSubagents: false,
  ...over,
});

const act = (kind: Activity['kind'], over: Partial<Activity> = {}): Activity => ({
  id: `${kind}-${over.at ?? 0}`,
  at: 99_000,
  kind,
  icon: 'x',
  text: kind,
  ...over,
});

describe('work mood', () => {
  it('maps the latest activity to a mood', () => {
    const cases: [Activity['kind'], string][] = [
      ['read', 'reading'],
      ['search', 'reading'],
      ['edit', 'typing'],
      ['write', 'typing'],
      ['bash', 'terminal'],
      ['web', 'web'],
      ['think', 'thinking'],
      ['subagent', 'delegating'],
    ];
    for (const [kind, mood] of cases) {
      const agent = makeAgent('ana', 0, 'working', { activity: act(kind) });
      expect(workMood(agent, ctx())).toBe(mood);
    }
  });

  it('just types when a working agent has no activity yet', () => {
    expect(workMood(makeAgent('ana', 0, 'working'), ctx())).toBe('typing');
  });

  it('is waiting when the agent needs the user and idle otherwise', () => {
    expect(workMood(makeAgent('ana', 0, 'waiting'), ctx())).toBe('waiting');
    expect(workMood(makeAgent('ana', 0, 'idle'), ctx())).toBe('idle');
  });

  it('delegates while subagents work and stays at the terminal during a foreground shell', () => {
    const agent = makeAgent('ana', 0, 'working', { activity: act('edit') });
    expect(workMood(agent, ctx({ workingSubagents: true }))).toBe('delegating');
    expect(workMood(agent, ctx({ foregroundShell: true }))).toBe('terminal');
  });

  it('gets frustrated after repeated recent errors, but not by one old or single error', () => {
    const errors = [
      act('error', { id: 'e1', at: 95_000, error: true }),
      act('error', { id: 'e2', at: 98_000, error: true }),
    ];
    const frustrated = makeAgent('ana', 0, 'working', { activity: act('edit'), recent: errors });
    expect(workMood(frustrated, ctx())).toBe('frustrated');
    const single = makeAgent('ana', 0, 'working', { activity: act('edit'), recent: errors.slice(1) });
    expect(workMood(single, ctx())).toBe('typing');
    const old = makeAgent('ana', 0, 'working', { activity: act('edit'), recent: errors });
    expect(workMood(old, ctx({ now: 400_000 }))).toBe('typing');
  });

  it('picks a seated pose for each mood and types faster while editing', () => {
    expect(seatedPoseFor('reading', 'read')).toBe('readDoc');
    expect(seatedPoseFor('thinking', undefined)).toBe('think');
    expect(seatedPoseFor('typing', 'edit')).toBe('typeFast');
    expect(seatedPoseFor('typing', 'reply')).toBe('type');
    expect(seatedPoseFor('frustrated', 'error')).toBe('scratch');
    expect(seatedPoseFor('delegating', 'subagent')).toBe('point');
  });
});
