// A tasteful little celebration for a level up or an achievement: a burst of sparkles over the trophy button. Pure CSS
// (see progress.css); with reduced motion there is nothing to animate, so nothing is drawn.
import { h } from '../dom';

const SPARKLES = 14;
const LIFETIME_MS = 1600;
const COLORS = ['#f2c94c', '#ffe08a', '#27c6cc', '#ff8fb7', '#9ad8ff'] as const;

/** Sparkles flying out of the middle of `anchor` (or of the top bar when there is none). */
export function celebrate(root: HTMLElement, anchor: HTMLElement | null, reducedMotion: boolean): void {
  if (reducedMotion) return;
  const box = anchor?.getBoundingClientRect();
  const x = box ? box.left + box.width / 2 : window.innerWidth / 2;
  const y = box ? box.top + box.height / 2 : 40;
  const burst = h('div', { class: 'ao-celebrate', 'aria-hidden': 'true', style: `left:${x}px;top:${y}px` });
  for (let i = 0; i < SPARKLES; i++) {
    const angle = (i / SPARKLES) * Math.PI * 2 + (i % 2) * 0.2;
    const distance = 34 + (i % 3) * 14;
    burst.append(
      h('span', {
        class: 'ao-spark',
        style: `--dx:${Math.round(Math.cos(angle) * distance)}px;--dy:${Math.round(Math.sin(angle) * distance)}px;--c:${COLORS[i % COLORS.length]};--d:${(i % 4) * 40}ms`,
      }),
    );
  }
  root.append(burst);
  window.setTimeout(() => burst.remove(), LIFETIME_MS);
}
