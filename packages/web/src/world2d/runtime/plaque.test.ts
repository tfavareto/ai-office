import { describe, expect, it } from 'vitest';
import type { RoomGit } from '../../world/roomGit';
import { textWidth } from '../font';
import { PLAQUE_W, plaqueLayout } from './plaque';

const info = (patch: Partial<RoomGit> = {}): RoomGit => ({ ref: 'main', detached: false, dirty: false, conflicted: false, ahead: 0, behind: 0, op: null, ci: 'none', ...patch });

describe('plaqueLayout', () => {
  it('keeps a short branch whole and leaves no room for a light that is not there', () => {
    const layout = plaqueLayout(info({ ref: 'main' }));
    expect(layout).toMatchObject({ text: 'MAIN', lightX: null });
  });

  it('puts the light at the right end and keeps the text clear of it', () => {
    const layout = plaqueLayout(info({ ref: 'feat/cupom', ci: 'failure' }));
    expect(layout.lightX).not.toBeNull();
    expect(layout.textX + textWidth(layout.text)).toBeLessThan(layout.lightX as number);
  });

  it.each(['feat/a-very-long-branch-name', 'chore/dependency-updates-for-october', 'ação/configuração-ñ', 'x'.repeat(80)])('never draws %s outside the plate', (ref) => {
    for (const ci of ['none', 'success'] as const) {
      const layout = plaqueLayout(info({ ref, ci }));
      const right = layout.lightX ?? PLAQUE_W;
      expect(layout.textX + textWidth(layout.text)).toBeLessThanOrEqual(right);
    }
  });

  it('folds accents to the letters the pixel font has', () => {
    expect(plaqueLayout(info({ ref: 'ação' })).text).toBe('ACAO');
  });
});
