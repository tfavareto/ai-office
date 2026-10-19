import { svg } from './dom';

/** AI Office logo: rounded square in brand blue with a minimal tower glyph. */
export function logo(size = 28): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 32 32', width: size, height: size, 'aria-hidden': 'true', class: 'ao-logo' });
  const gradient = svg('linearGradient', { id: 'ao-logo-g', x1: 0, y1: 0, x2: 1, y2: 1 });
  gradient.appendChild(svg('stop', { offset: '0', 'stop-color': '#4f86f7' }));
  gradient.appendChild(svg('stop', { offset: '1', 'stop-color': '#2f6fed' }));
  root.appendChild(svg('defs', null, gradient));
  root.appendChild(svg('rect', { width: 32, height: 32, rx: 8, fill: 'url(#ao-logo-g)' }));
  root.appendChild(svg('path', { d: 'M9 25V10.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V25', fill: 'none', stroke: '#fff', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  root.appendChild(svg('path', { d: 'M17 14.5h4a1 1 0 0 1 1 1V25M7 25h18', fill: 'none', stroke: '#fff', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.85 }));
  root.appendChild(svg('path', { d: 'M12 13.5h2M12 17h2M12 20.5h2', fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.8 }));
  return root;
}
