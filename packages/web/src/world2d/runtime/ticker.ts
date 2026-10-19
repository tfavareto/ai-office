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

export function tickerText(rooms: number, agents: number, working: number, waiting: number, shells: number): string {
  const parts = ['AI OFFICE', `${rooms} ${rooms === 1 ? 'SALA' : 'SALAS'}`, `${agents} ${agents === 1 ? 'AGENTE' : 'AGENTES'}`, `${working} TRABALHANDO`];
  if (shells) parts.push(`${shells} ${shells === 1 ? 'SHELL RODANDO' : 'SHELLS RODANDO'}`);
  parts.push(waiting ? `${waiting} PRECISA DE VOCE` : 'TUDO EM ORDEM', 'CAFE FRESCO NA COPA');
  return parts.join('  *  ');
}
