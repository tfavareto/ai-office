import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { linkLabel, linkPath, linkState } from './links';

beforeEach(() => setLocale('pt-BR'));

describe('linkState', () => {
  it('flows while the subagent works and turns amber when it waits for the user', () => {
    expect(linkState({ status: 'working' }, false)).toBe('flowing');
    expect(linkState({ status: 'waiting' }, false)).toBe('waiting');
    expect(linkState({ status: 'idle' }, false)).toBe('idle');
  });

  it('dims once finished, whatever the last known status was', () => {
    expect(linkState({ status: 'done' }, false)).toBe('done');
    expect(linkState({ status: 'offline' }, false)).toBe('done');
    expect(linkState({ status: 'working' }, true)).toBe('done');
  });
});

describe('linkPath', () => {
  const orchestrator = { x: 0, y: 0, width: 680, height: 460 };

  it('leaves the facing side of the orchestrator and arrives on the facing side of a subagent on its right', () => {
    const sub = { x: 756, y: -120, width: 320, height: 240 };
    const link = linkPath(orchestrator, sub);
    expect(link.start.x).toBe(680);
    expect(link.end.x).toBe(756);
    expect(link.d.startsWith('M680')).toBe(true);
    expect(link.mid.x).toBeGreaterThan(680);
    expect(link.mid.x).toBeLessThan(756);
  });

  it('uses the left and the vertical sides for subagents on the left, above and below', () => {
    const left = linkPath(orchestrator, { x: -396, y: 110, width: 320, height: 240 });
    expect(left.start.x).toBe(0);
    expect(left.end.x).toBe(-76);
    const above = linkPath(orchestrator, { x: 180, y: -316, width: 320, height: 240 });
    expect(above.start.y).toBe(0);
    expect(above.end.y).toBe(-76);
    const below = linkPath(orchestrator, { x: 180, y: 536, width: 320, height: 240 });
    expect(below.start.y).toBe(460);
    expect(below.end.y).toBe(536);
  });

  it('keeps its attachment points away from the corners', () => {
    const farRight = linkPath(orchestrator, { x: 3000, y: 900, width: 320, height: 240 });
    expect(farRight.start.y).toBeLessThanOrEqual(460 - 36);
    expect(farRight.end.y).toBeGreaterThanOrEqual(900 + 36);
  });
});

describe('linkLabel', () => {
  it('names the subagent type and its task', () => {
    expect(linkLabel({ role: 'Explore', title: 'Mapear os módulos' })).toEqual({
      role: 'Explore',
      task: 'Mapear os módulos',
    });
    expect(linkLabel({ role: 'Explore' })).toEqual({ role: 'Explore', task: '' });
  });

  it('cuts a long task', () => {
    const label = linkLabel({ role: 'general-purpose', title: 'x'.repeat(200) });
    expect(label.task.length).toBeLessThanOrEqual(60);
    expect(label.task.endsWith('…')).toBe(true);
  });
});
