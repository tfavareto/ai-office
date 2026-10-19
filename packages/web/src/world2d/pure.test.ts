import { describe, expect, it } from 'vitest';
import { makeAgent } from '../sim/testkit';
import { lookFor } from './chars/looks';
import { mix, shade, hexToRgb } from './color';
import { foldText, textWidth } from './font';
import { DayNight, nightFromHour, skyColors } from './lighting';
import { roomInfoKey, summarizeRoom } from './runtime/boards';
import { desksScreens } from './runtime/screens';
import { tickerText } from './runtime/ticker';
import { hslToHex } from '../layout/color';

describe('day and night', () => {
  it('is bright at noon, dark at midnight and ramps at dusk and dawn', () => {
    expect(nightFromHour(12)).toBe(0);
    expect(nightFromHour(0)).toBe(1);
    expect(nightFromHour(23)).toBe(1);
    const dusk = nightFromHour(18.5);
    expect(dusk).toBeGreaterThan(0.1);
    expect(dusk).toBeLessThan(0.9);
    expect(nightFromHour(6.5)).toBeGreaterThan(0.1);
    expect(nightFromHour(6.5)).toBeLessThan(0.9);
  });

  it('forces day or night regardless of the clock and eases toward the target', () => {
    const noon = new Date(2026, 0, 1, 12, 0, 0);
    const forced = new DayNight();
    forced.setMode('night');
    forced.update(0, noon);
    expect(forced.night).toBe(1);
    forced.setMode('day');
    for (let i = 0; i < 400; i++) forced.update(1 / 30, noon);
    expect(forced.night).toBe(0);
    const auto = new DayNight();
    auto.setMode('auto');
    auto.update(0, new Date(2026, 0, 1, 2, 0, 0));
    expect(auto.night).toBe(1);
  });

  it('darkens the sky at night', () => {
    expect(skyColors(1)[0]).not.toBe(skyColors(0)[0]);
  });
});

describe('looks', () => {
  it('is deterministic per seed and varies between seeds', () => {
    expect(lookFor(42, 'f', false)).toEqual(lookFor(42, 'f', false));
    const keys = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const l = lookFor(seed * 977, seed % 2 ? 'f' : 'm', false);
      keys.add(`${l.skin}${l.hair}${l.jacket}${l.shirt}${l.hairStyle}`);
    }
    expect(keys.size).toBeGreaterThan(40);
  });

  it('gives men ties sometimes, skirts only to women and a badge to subagents', () => {
    const looks = Array.from({ length: 200 }, (_, i) => lookFor(i * 131 + 5, i % 2 ? 'f' : 'm', false));
    expect(looks.some((l) => l.gender === 'm' && l.tie)).toBe(true);
    expect(looks.filter((l) => l.gender === 'm').every((l) => !l.skirt)).toBe(true);
    expect(looks.some((l) => l.skirt)).toBe(true);
    expect(lookFor(7, 'm', true).badge).toBe(true);
  });
});

describe('monitor screens', () => {
  it('shows live content only while somebody sits at the desk', () => {
    expect(desksScreens(null, undefined, false)).toEqual(['off', 'off', 'off', 'off']);
    expect(desksScreens('working', 'edit', false)).toContain('code');
    expect(desksScreens('working', 'bash', false)[1]).toBe('term');
    expect(desksScreens('working', 'edit', true)[1]).toBe('term');
    expect(desksScreens('waiting', undefined, false)).toContain('wait');
    expect(desksScreens('idle', undefined, false)).toContain('idle');
  });
});

describe('boards and ticker', () => {
  it('summarises a room from its agents, ignoring the ones that left', () => {
    const main = makeAgent('a', 0, 'working', {
      tasks: [
        { id: '1', title: 'Um', status: 'completed' },
        { id: '2', title: 'Dois', activeForm: 'Fazendo dois', status: 'in_progress' },
      ],
    });
    const waiting = makeAgent('b', 0, 'waiting');
    const gone = makeAgent('c', 0, 'offline');
    const info = summarizeRoom([main, waiting, gone]);
    expect(info).toMatchObject({ agents: 2, working: 1, waiting: 1, tasksTotal: 2, tasksDone: 1, current: 'Fazendo dois' });
    expect(roomInfoKey(info)).toContain('1/2');
  });

  it('writes the ticker in Portuguese without accents the pixel font cannot draw', () => {
    const text = tickerText(1, 1, 1, 0, 0);
    expect(text).toContain('1 SALA');
    expect(text).toContain('1 AGENTE');
    expect(tickerText(3, 5, 2, 2, 1)).toContain('2 PRECISA DE VOCE');
    expect(foldText('Recepção')).toBe('RECEPCAO');
    expect(textWidth('AB')).toBe(7);
  });
});

describe('colour helpers', () => {
  it('mixes, shades and converts', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
  });
});
