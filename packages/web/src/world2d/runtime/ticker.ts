import type { OfficeSnapshot } from '@ai-office/shared';
import { type WorldText, worldText } from '../../i18n/world/translate';
import { drawPixelText, textWidth } from '../font';
import { context2d, makeCanvas } from '../paint/ctx';

export const TICKER_H = 7;
const GAP = 48;

export interface TickerStrip {
  canvas: HTMLCanvasElement;
  text: string;
  /** Pixel width of one repetition (text + gap). */
  period: number;
}

/** Pre-render the LED ticker text once per change; scrolling is a cheap offset at draw time. */
export function renderTicker(text: string): TickerStrip {
  const period = textWidth(text) + GAP;
  const canvas = makeCanvas(period, TICKER_H);
  const ctx = context2d(canvas);
  drawPixelText(ctx, text, 0, 1, '#ffb347');
  return { canvas, text, period };
}

/** Numbers the ticker reports. */
export interface TickerStats {
  rooms: number;
  agents: number;
  working: number;
  waiting: number;
  shells: number;
}

export function tickerFromSnapshot(snapshot: OfficeSnapshot): TickerStats {
  const live = snapshot.agents.filter((a) => a.status !== 'done' && a.status !== 'offline');
  return {
    rooms: snapshot.projects.length,
    agents: live.length,
    working: live.filter((a) => a.status === 'working').length,
    waiting: live.filter((a) => a.status === 'waiting').length,
    shells: live.reduce((n, a) => n + a.shells.filter((s) => !s.background).length, 0),
  };
}

/** Separator between ticker items. */
export const TICKER_SEPARATOR = '  *  ';

/**
 * Text of the LED ticker (corridor, 2D and 3D) in upper case. The brand and the order of the items are the same in every
 * language; the 2D pixel font folds accents, the 3D texture draws them.
 */
export function tickerText(rooms: number, agents: number, working: number, waiting: number, shells: number, text: WorldText = worldText('pt-BR')): string {
  const parts = ['AI OFFICE', text.t('count.rooms', { n: rooms }), text.t('count.agents', { n: agents }), text.t('ticker.working', { n: working })];
  if (shells) parts.push(text.t('ticker.shells', { n: shells }));
  parts.push(waiting ? text.t('count.needsYou', { n: waiting }) : text.t('ticker.allGood'), text.t('ticker.coffee'));
  return parts.join(TICKER_SEPARATOR).toLocaleUpperCase(text.locale);
}
