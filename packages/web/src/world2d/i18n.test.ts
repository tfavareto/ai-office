import { LOCALES, type Locale } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { areaLabel } from '../i18n/world/areaLabel';
import { WORLD_CATALOGS } from '../i18n/world';
import { worldPtBR, type WorldKey } from '../i18n/world/pt-BR';
import { worldText } from '../i18n/world/translate';
import { computeBuilding } from '../layout/building';
import { bubbleText, clipText } from '../sim/bubbles';
import { makeAgent } from '../sim/testkit';
import { DEFAULT_WORLD_OPTIONS } from '../world/api';
import { areaKey } from './layers/areaLayer';
import { foldText, textWidth, unsupportedChars } from './font';
import { menuLayout } from './paint/wallitems';
import { boardLineForms, fit, pickFitting, roomInfoKey, summarizeRoom, type RoomInfo } from './runtime/boards';
import { tickerText } from './runtime/ticker';

const KEYS = Object.keys(worldPtBR) as WorldKey[];
const placeholders = (template: string): string[] => [...template.matchAll(/\{(\w+)/g)].map((m) => m[1] as string).sort();

/** Inner width (px) of a project room's wall board and of the meeting-room TV header. */
const BOARD_W = 3 * 16 - 4 - 4;
const BOARD_TEXT_PX = BOARD_W - 5;
const MENU_W = 4 * 16 - 2;

const info = (patch: Partial<RoomInfo> = {}): RoomInfo => ({ agents: 2, working: 1, waiting: 0, tasksTotal: 0, tasksDone: 0, current: null, ...patch });

describe('world catalogs', () => {
  it('define every key in every locale with the same placeholders', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        const text = WORLD_CATALOGS[locale][key];
        expect(text, `${locale}:${key}`).toBeTypeOf('string');
        expect(placeholders(text as string), `${locale}:${key}`).toEqual(placeholders(worldPtBR[key]));
      }
    }
  });

  it('keeps pt-BR wording for the texts the world drew before', () => {
    const pt = worldText('pt-BR');
    expect(pt.t('count.agents', { n: 0 })).toBe('0 agentes');
    expect(pt.t('count.agents', { n: 1 })).toBe('1 agente');
    expect(pt.t('bubble.needsYou')).toBe('Precisa de você');
    expect(pt.t('menu3d.price', { price: 4 })).toBe('R$ 4');
    expect(pt.t('menu2d.coffeePrice')).toBe('3,00');
  });

  it('pluralizes counts in en and es', () => {
    expect(worldText('en').t('count.agents', { n: 1 })).toBe('1 agent');
    expect(worldText('en').t('count.agents', { n: 3 })).toBe('3 agents');
    expect(worldText('en').t('count.needsYou', { n: 2 })).toBe('2 need you');
    expect(worldText('es').t('count.rooms', { n: 0 })).toBe('0 salas');
    expect(worldText('es').t('ticker.shells', { n: 1 })).toBe('1 shell en ejecución');
  });

  it('renders server messages with tm and falls back to the pt-BR text', () => {
    const msg = { key: 'bubble.done' };
    expect(worldText('en').tm(msg, 'Terminei!')).toBe('Done!');
    expect(worldText('es').tm(msg, 'Terminei!')).toBe('¡Terminé!');
    expect(worldText('en').tm(undefined, 'Lendo App.tsx')).toBe('Lendo App.tsx');
    expect(worldText('en').tm({ key: 'unknown.key' }, 'Lendo App.tsx')).toBe('Lendo App.tsx');
  });
});

describe('area names', () => {
  it('translate the common areas and keep project names', () => {
    const building = computeBuilding([{ id: 'p1', seed: 1, name: 'loja-online', slot: 0 }]);
    const byKind = (kind: string) => building.areas.find((a) => a.kind === kind)!;
    expect(areaLabel(byKind('meeting'), worldText('en'))).toBe('Meeting room');
    expect(areaLabel(byKind('meeting'), worldText('es'))).toBe('Sala de reuniones');
    expect(areaLabel(byKind('meeting'), worldText('pt-BR'))).toBe(byKind('meeting').label);
    expect(areaLabel(byKind('project'), worldText('es'))).toBe('loja-online');
  });
});

describe('locale change invalidation', () => {
  const building = computeBuilding([{ id: 'p1', seed: 1, name: 'loja-online', slot: 0 }]);
  const key = (kind: string, locale: Locale): string => areaKey(building.areas.find((a) => a.kind === kind)!, '', locale);

  it('redraws the area that paints translated words (the pantry menu) when the language changes', () => {
    expect(key('copa', 'en')).not.toBe(key('copa', 'pt-BR'));
    expect(key('copa', 'es')).not.toBe(key('copa', 'en'));
    expect(key('copa', 'en')).toBe(key('copa', 'en'));
  });

  it('leaves the other cached area layers alone', () => {
    for (const kind of ['reception', 'meeting', 'lounge', 'bathrooms', 'project']) expect(key(kind, 'en')).toBe(key(kind, 'es'));
  });

  it('keys boards by language and by the localizable task message', () => {
    const a = summarizeRoom([makeAgent('a', 0, 'working', { tasks: [{ id: '1', title: 'x', status: 'in_progress', titleMsg: { key: 'bubble.done' } }] })]);
    const b = summarizeRoom([makeAgent('a', 0, 'working', { tasks: [{ id: '1', title: 'x', status: 'in_progress' }] })]);
    expect(a.currentMsg).toEqual({ key: 'bubble.done' });
    expect(roomInfoKey(a)).not.toBe(roomInfoKey(b));
  });

  it('shows a task message in the language of the world', () => {
    const current = info({ current: 'Terminei!', currentMsg: { key: 'bubble.done' } });
    expect(boardLineForms(current, worldText('en'))).toEqual(['Done!']);
    expect(boardLineForms(current, worldText('pt-BR'))).toEqual(['Terminei!']);
  });

  it('defaults the world language to pt-BR', () => {
    expect(DEFAULT_WORLD_OPTIONS.locale).toBe('pt-BR');
  });
});

describe('bubbles', () => {
  it('shows the localized message, clipped, or the pt-BR text without one', () => {
    const tm = worldText('en').tm;
    expect(bubbleText({ text: 'Terminei!', msg: { key: 'bubble.done' } }, tm)).toBe('Done!');
    expect(bubbleText({ text: 'Lendo App.tsx' }, tm)).toBe('Lendo App.tsx');
    expect(bubbleText({ text: 'x', msg: { key: 'bubble.done' } }, () => 'y'.repeat(80))).toBe(clipText('y'.repeat(80)));
  });
});

describe('pixel font coverage', () => {
  it('draws accented capitals, inverted marks and the bullet', () => {
    expect(unsupportedChars('ÁÉÍÓÚ ÂÊÔ ÃÕ Ç Ñ Ü ¿Qué? ¡Hola! • …')).toEqual([]);
    expect(foldText('Menú Café Cocina…')).toBe('MENU CAFE COCINA...');
    expect(textWidth('¿!')).toBe(7);
  });

  it('flags characters outside the font', () => {
    expect(unsupportedChars('AB€')).toEqual(['€']);
  });

  const pixelTexts = (locale: Locale): string[] => {
    const text = worldText(locale);
    const states = [info({ waiting: 1 }), info(), info({ working: 0 }), info({ agents: 0, working: 0 })];
    const keys: WorldKey[] = [
      'menu2d.title', 'menu2d.coffee', 'menu2d.juice', 'menu2d.coffeePrice', 'menu2d.juicePrice', 'meeting.free', 'area.reception', 'area.copa',
      'area.meeting', 'area.bathrooms', 'area.lounge',
    ];
    return [
      ...keys.map((key) => text.t(key)),
      text.t('meeting.inRoom', { n: 12 }),
      tickerText(12, 20, 7, 3, 2, text),
      tickerText(1, 0, 0, 0, 0, text),
      ...states.flatMap((state) => boardLineForms(state, text)),
    ];
  };

  it.each(LOCALES)('has a glyph for every pixel-font text in %s', (locale) => {
    for (const text of pixelTexts(locale)) expect(unsupportedChars(text), text).toEqual([]);
  });
});

describe('text fitting in the 2D world', () => {
  it.each(LOCALES)('cuts with a dot and never leaves a trailing space (%s)', (locale) => {
    const long = worldText(locale).t('board.waiting');
    const cut = fit(long, 20);
    expect(textWidth(cut)).toBeLessThanOrEqual(20);
    expect(cut.endsWith(' .')).toBe(false);
  });

  it('picks the first form that fits', () => {
    expect(pickFitting(['AGUARDANDO VOCE', 'AGUARDA'], BOARD_TEXT_PX)).toBe('AGUARDA');
    expect(pickFitting(['OCIOSO', 'X'], BOARD_TEXT_PX)).toBe('OCIOSO');
    expect(pickFitting(['AGUARDANDO VOCE', 'AGUARDANDO'], BOARD_TEXT_PX)).toBe('AGUARDAN.');
  });

  it.each(LOCALES)('fits every room state on the narrow wall board (%s)', (locale) => {
    const text = worldText(locale);
    const states = [info({ waiting: 1 }), info(), info({ working: 0 }), info({ agents: 0, working: 0 })];
    for (const state of states) {
      const line = pickFitting(boardLineForms(state, text), BOARD_TEXT_PX);
      expect(textWidth(line), `${locale}: ${line}`).toBeLessThanOrEqual(BOARD_TEXT_PX);
      expect(line.endsWith('.'), `${locale}: ${line} was cut`).toBe(false);
    }
  });

  it.each(LOCALES)('keeps the pantry menu words inside the board and apart from the prices (%s)', (locale) => {
    const layout = menuLayout(MENU_W, worldText(locale));
    expect(layout.title.x).toBeGreaterThanOrEqual(0);
    expect(layout.title.x + textWidth(layout.title.text)).toBeLessThanOrEqual(MENU_W);
    for (const row of layout.rows) {
      expect(row.labelX + textWidth(row.label) + 3).toBeLessThanOrEqual(row.priceX);
      expect(row.priceX + textWidth(row.price)).toBeLessThanOrEqual(MENU_W - 4);
    }
  });
});
