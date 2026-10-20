import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { worldText } from '../../i18n/world/translate';
import { fitFontSize } from './textFit';

/** A 2D context that records the texts painted and measures 10 px per character at the current font size of 10. */
function recordingContext() {
  const texts: string[] = [];
  let font = '10px sans-serif';
  const size = (): number => Number(/(\d+)px/.exec(font)?.[1] ?? 10);
  const base = {
    measureText: (text: string) => ({ width: text.length * size() * 0.5 }),
    fillText: (text: string) => void texts.push(text),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    save: () => undefined, restore: () => undefined, beginPath: () => undefined, rect: () => undefined, clip: () => undefined,
    clearRect: () => undefined, translate: () => undefined, fillRect: () => undefined, strokeRect: () => undefined,
    arc: () => undefined, fill: () => undefined, drawImage: () => undefined,
  };
  const ctx = new Proxy(base as unknown as CanvasRenderingContext2D, {
    get: (target, key) => (key === 'font' ? font : (target as never)[key]),
    set: (_target, key, value) => {
      if (key === 'font') font = value as string;
      return true;
    },
  });
  return { ctx, texts };
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => recordingContext().ctx }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('fitFontSize', () => {
  it('keeps the size when the text fits', () => {
    expect(fitFontSize(300, 400, 44, 28)).toBe(44);
  });

  it('scales down proportionally and never below the minimum', () => {
    expect(fitFontSize(800, 400, 44, 20)).toBe(22);
    expect(fitFontSize(8000, 400, 44, 28)).toBe(28);
  });
});

describe('3D canvas texts', () => {
  it('paints the pantry menu in the language of the world', async () => {
    const { paintMenu } = await import('./screens');
    for (const [locale, title, price] of [['pt-BR', 'CAFÉ DA COPA', 'R$ 4'], ['en', 'PANTRY CAFÉ', '$4'], ['es', 'CAFÉ DE LA COCINA', '$4']] as const) {
      const { ctx, texts } = recordingContext();
      paintMenu(ctx, 512, 256, worldText(locale));
      expect(texts).toContain(title);
      expect(texts).toContain(price);
    }
  });

  it('paints the room board and meeting TV in the language of the world', async () => {
    const { paintBoard, paintMeetingTv } = await import('./screens');
    const info = { agents: 3, working: 1, waiting: 2, tasksTotal: 4, tasksDone: 1, current: null };
    const board = recordingContext();
    paintBoard(board.ctx, 512, 287, 'loja', info, '#fff', worldText('en'));
    expect(board.texts).toEqual(expect.arrayContaining(['3 agents', 'IN PROGRESS', 'Waiting for you', '1/4 tasks', '2 need you']));
    const tv = recordingContext();
    paintMeetingTv(tv.ctx, 614, 346, ['Ana', 'Léo'], worldText('es'));
    expect(tv.texts).toContain('EN LA SALA · 2');
  });

  it('paints the whiteboard task board in the language of the world, with the demo titles translated', async () => {
    const { paintTaskBoard } = await import('./taskBoardScreen');
    const summary = { pending: 2, active: 1, done: 7, top: [{ text: 'Implementando a mudança', msg: { key: 'demo.task.2.active' } }, { text: 'Escrito pelo usuário' }] };
    for (const [locale, labels, title] of [
      ['pt-BR', ['QUADRO DE TAREFAS', 'PENDENTE', 'EM ANDAMENTO', 'CONCLUÍDO'], 'Implementando a mudança'],
      ['en', ['TASK BOARD', 'PENDING', 'IN PROGRESS', 'COMPLETED'], 'Implementing the change'],
      ['es', ['TABLERO DE TAREAS', 'PENDIENTE', 'EN CURSO', 'COMPLETADA'], 'Implementando el cambio'],
    ] as const) {
      const { ctx, texts } = recordingContext();
      paintTaskBoard(ctx, 486, 269, summary, worldText(locale));
      expect(texts, locale).toEqual(expect.arrayContaining([...labels, '2', '1', '7', title, 'Escrito pelo usuário']));
    }
  });

  it('says there are no tasks when the whiteboard has none', async () => {
    const { paintTaskBoard } = await import('./taskBoardScreen');
    const { ctx, texts } = recordingContext();
    paintTaskBoard(ctx, 486, 269, { pending: 0, active: 0, done: 0, top: [] }, worldText('en'));
    expect(texts).toContain('No tasks');
  });

  it('repaints only the localized decor when the language changes', async () => {
    const { DecorAtlas } = await import('./screens');
    const atlas = new DecorAtlas(worldText('pt-BR'));
    const plain = vi.fn();
    const words = vi.fn();
    atlas.add(1, 1, plain);
    atlas.add(1, 1, words, true);
    expect(plain).toHaveBeenCalledTimes(1);
    atlas.setText(worldText('pt-BR'));
    expect(words).toHaveBeenCalledTimes(1);
    atlas.setText(worldText('en'));
    expect(plain).toHaveBeenCalledTimes(1);
    expect(words).toHaveBeenCalledTimes(2);
    expect(words.mock.lastCall?.[3]).toBe(worldText('en'));
  });
});
