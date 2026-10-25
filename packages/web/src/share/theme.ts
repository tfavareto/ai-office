// Colours of the card, per theme. They follow the app's brand: navy and glass panels in the dark theme, soft blue and
// white in the light one, the brand blue (#2f6fed) as the accent in both.
import type { CardTheme, StatTone } from './types';

export interface CardPalette {
  bgTop: string;
  bgBottom: string;
  /** Soft glows over the background (top right, bottom left). */
  glowA: string;
  glowB: string;
  panel: string;
  panelBorder: string;
  tile: string;
  text: string;
  muted: string;
  faint: string;
  heroBorder: string;
  heroShadow: string;
  brand: string;
  brandHigh: string;
  tones: Readonly<Record<StatTone, string>>;
}

const DARK: CardPalette = {
  bgTop: '#09111f',
  bgBottom: '#111b35',
  glowA: 'rgba(79, 134, 247, 0.30)',
  glowB: 'rgba(183, 156, 255, 0.12)',
  panel: 'rgba(255, 255, 255, 0.06)',
  panelBorder: 'rgba(255, 255, 255, 0.12)',
  tile: 'rgba(255, 255, 255, 0.045)',
  text: '#eef3fb',
  muted: '#a3b3cf',
  faint: '#7f90ad',
  heroBorder: 'rgba(255, 255, 255, 0.18)',
  heroShadow: 'rgba(2, 6, 18, 0.55)',
  brand: '#2f6fed',
  brandHigh: '#4f86f7',
  tones: { blue: '#6ea2ff', green: '#3ecf8e', amber: '#f5b544', cyan: '#38c9d3', violet: '#b79cff' },
};

const LIGHT: CardPalette = {
  bgTop: '#f6f9ff',
  bgBottom: '#dde7f8',
  glowA: 'rgba(47, 111, 237, 0.18)',
  glowB: 'rgba(122, 86, 214, 0.08)',
  panel: 'rgba(255, 255, 255, 0.82)',
  panelBorder: 'rgba(15, 23, 42, 0.10)',
  tile: 'rgba(47, 111, 237, 0.06)',
  text: '#0f172a',
  muted: '#475572',
  faint: '#6b7a96',
  heroBorder: 'rgba(15, 23, 42, 0.16)',
  heroShadow: 'rgba(30, 52, 100, 0.30)',
  brand: '#2f6fed',
  brandHigh: '#4f86f7',
  tones: { blue: '#2f6fed', green: '#12a36a', amber: '#c77f0a', cyan: '#0e8f9c', violet: '#7a56d6' },
};

export function cardPalette(theme: CardTheme): CardPalette {
  return theme === 'light' ? LIGHT : DARK;
}
