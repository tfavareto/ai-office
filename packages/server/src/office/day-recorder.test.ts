import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Agent } from '@ai-office/shared';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { localDateString } from '../util/ids';
import { DayRecorder } from './day-recorder';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir();
});
afterEach(async () => {
  await removeDir(dir);
});

const agent = (id: string, status: Agent['status']): Agent =>
  ({ id, name: id.toUpperCase(), projectId: '/p', status }) as unknown as Agent;

const NOON = new Date(2026, 9, 19, 12, 0, 0).getTime();

describe('DayRecorder', () => {
  test('accumulates time per status for each present agent', async () => {
    const recorder = new DayRecorder(dir, silentLogger);
    await recorder.record([agent('a', 'working'), agent('b', 'idle')], NOON);
    await recorder.record([agent('a', 'working'), agent('b', 'idle')], NOON + 5000);
    await recorder.record([agent('a', 'waiting'), agent('b', 'idle')], NOON + 10_000);
    const day = await recorder.get(localDateString(NOON));
    expect(day.date).toBe('2026-10-19');
    expect(day.agents.find((a) => a.agentId === 'a')).toMatchObject({
      name: 'A',
      projectId: '/p',
      ms: { working: 5000, waiting: 5000, idle: 0 },
    });
    expect(day.agents.find((a) => a.agentId === 'b')?.ms.idle).toBe(10_000);
  });

  test('caps long gaps (the computer slept) to two intervals', async () => {
    const recorder = new DayRecorder(dir, silentLogger);
    await recorder.record([agent('a', 'working')], NOON);
    await recorder.record([agent('a', 'working')], NOON + 3_600_000);
    const day = await recorder.get('2026-10-19');
    expect(day.agents[0]?.ms.working).toBe(10_000);
  });

  test('flushes to <stateDir>/days/YYYY-MM-DD.json and a new recorder reads it back', async () => {
    const recorder = new DayRecorder(dir, silentLogger);
    await recorder.record([agent('a', 'working')], NOON);
    await recorder.record([agent('a', 'working')], NOON + 5000);
    await recorder.flush(NOON + 5000);
    const saved = JSON.parse(await readFile(join(dir, 'days', '2026-10-19.json'), 'utf8')) as { agents: unknown[] };
    expect(saved.agents).toHaveLength(1);
    const reader = new DayRecorder(dir, silentLogger);
    expect((await reader.get('2026-10-19')).agents[0]?.ms.working).toBe(5000);
  });

  test('unknown or corrupt days come back empty', async () => {
    const recorder = new DayRecorder(dir, silentLogger);
    expect(await recorder.get('2020-01-01')).toEqual({ date: '2020-01-01', agents: [] });
  });

  test('rolls over to a new file at midnight', async () => {
    const recorder = new DayRecorder(dir, silentLogger);
    const night = new Date(2026, 9, 19, 23, 59, 58).getTime();
    await recorder.record([agent('a', 'working')], night);
    await recorder.record([agent('a', 'working')], night + 1000);
    await recorder.record([agent('a', 'working')], night + 6000);
    await recorder.record([agent('a', 'working')], night + 11_000);
    await recorder.flush();
    expect((await recorder.get('2026-10-19')).agents[0]?.ms.working).toBe(1000);
    expect((await recorder.get('2026-10-20')).agents[0]?.ms.working).toBe(5000);
  });
});
