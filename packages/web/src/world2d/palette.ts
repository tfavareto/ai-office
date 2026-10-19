// Named colours of the premium-corporate palette: walnut, marble, brass, graphite, glass, soft greens, navy/teal LED.

export const WALNUT = { dark: '#3f2717', base: '#6a432a', mid: '#80532f', light: '#9a6a40', hi: '#b98557' } as const;
export const OAK = { dark: '#7a5a38', base: '#b58a58', mid: '#c89f6c', light: '#dbb988', hi: '#ecd2a6' } as const;
export const EBONY = { dark: '#16110f', base: '#241b18', mid: '#33271f', light: '#4a3a2e', hi: '#62503f' } as const;
export const WOODS = [WALNUT, OAK, EBONY] as const;

export const MARBLE = { base: '#ece7dd', light: '#f6f2ea', shade: '#d8d1c3', vein: '#c3baa8', beige: '#ddd0b8' } as const;
export const BRASS = { dark: '#7d5f22', base: '#b8923f', light: '#dcb862', hi: '#f2dc96' } as const;
export const GRAPHITE = { deep: '#1b1e24', dark: '#272b33', base: '#383d47', mid: '#515866', light: '#7b8392', hi: '#a4acba' } as const;
export const PLANT = { dark: '#25502f', base: '#3b7a46', mid: '#4f9559', light: '#74b872', hi: '#a2d68f', pot: '#b9b2a4', potDark: '#8c8578' } as const;
export const GLASS = { tint: 'rgba(168,208,224,0.30)', frost: 'rgba(238,246,250,0.72)', edge: '#cfe6ee', dark: '#7aa4b5' } as const;
export const LED = { navy: '#1d3a63', teal: '#27c6cc', tealDim: '#17757a', warm: '#ffd9a0', white: '#f4f8ff' } as const;
export const SKIN_TONES = ['#f6d4b8', '#eab894', '#d99b72', '#bd7d54', '#93583a', '#6a3d28'] as const;
export const STATUS_COLORS = {
  working: '#3ecf8e', waiting: '#f5b544', idle: '#8d99ad', done: '#6ea2ff', offline: '#8d99ad', shell: '#38c9d3', error: '#ef6b6b',
} as const;
