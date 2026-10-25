import { describe, expect, it } from 'vitest';
import { cardLayout } from './layout';
import { renderCard } from './render';
import type { CardModel, CardTheme } from './types';

const MODEL: CardModel = {
  title: 'My office today',
  date: 'October 25, 2026',
  brand: 'AI Office',
  stats: [
    { id: 'agents', value: '8', label: 'Agents', tone: 'blue' },
    { id: 'time', value: '6 h 12 min', label: 'Active time', tone: 'green' },
    { id: 'tasks', value: '23', label: 'Tasks done', tone: 'amber' },
    { id: 'commits', value: '9', label: 'Commits', tone: 'violet' },
  ],
  highlight: 'A whole office of AI agents working in parallel',
  url: 'github.com/tfavareto/ai-office',
  tag: 'Open source · MIT',
};

/** A canvas context that records the texts it is asked to draw and the images it draws; measures 8 px a letter. */
function recorder(): { ctx: CanvasRenderingContext2D; texts: string[]; images: number } {
  const state = { texts: [] as string[], images: 0 };
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: text.length * 8 }),
    fillText: (text: string) => state.texts.push(text),
    drawImage: () => {
      state.images++;
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  const ctx = new Proxy(target, {
    get: (obj, key: string) => (key in obj ? obj[key] : () => undefined),
    set: (obj, key: string, value: unknown) => {
      obj[key] = value;
      return true;
    },
  });
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    get texts() {
      return state.texts;
    },
    get images() {
      return state.images;
    },
  };
}

describe('renderCard', () => {
  it('writes exactly what the model says, and nothing else', () => {
    // Arrange
    const rec = recorder();

    // Act
    renderCard(rec.ctx, MODEL, cardLayout('landscape', MODEL.stats.length), 'dark', null);

    // Assert
    expect([...rec.texts].sort()).toEqual(
      [
        'AI Office',
        'October 25, 2026',
        'My office today',
        '8',
        '6 h 12 min',
        '23',
        '9',
        'AGENTS',
        'ACTIVE TIME',
        'TASKS DONE',
        'COMMITS',
        MODEL.highlight,
        MODEL.url,
        MODEL.tag,
      ].sort(),
    );
  });

  it.each<CardTheme>(['dark', 'light'])('draws the %s theme in both formats without failing', (theme) => {
    for (const format of ['landscape', 'square'] as const) {
      const rec = recorder();

      expect(() => renderCard(rec.ctx, MODEL, cardLayout(format, MODEL.stats.length), theme, null)).not.toThrow();
    }
  });

  it('draws the picture of the office when there is one', () => {
    const rec = recorder();

    renderCard(rec.ctx, MODEL, cardLayout('landscape', 4), 'dark', {} as CanvasImageSource);

    expect(rec.images).toBe(1);
  });

  it('draws no highlight when there is none', () => {
    const rec = recorder();

    renderCard(rec.ctx, { ...MODEL, highlight: null }, cardLayout('landscape', 4), 'dark', null);

    expect(rec.texts).not.toContain(MODEL.highlight);
  });
});
