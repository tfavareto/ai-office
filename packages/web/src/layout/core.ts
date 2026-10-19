import { AreaBuilder } from './builder';
import { CORE_W } from './constants';
import type { AreaLayout, AreaTheme } from './types';

const MARBLE: AreaTheme = { floor: 'marble', hue: 38, accent: '#c8a45a', carpet: '#d9cbb0', carpetAlt: '#b89a62', pattern: 0, wood: 0 };
const TILE_THEME: AreaTheme = { floor: 'tile', hue: 190, accent: '#38b6c2', carpet: '#cfd8d8', carpetAlt: '#b4c4c4', pattern: 0, wood: 1 };
const WOOD_THEME: AreaTheme = { floor: 'wood', hue: 28, accent: '#2f6fed', carpet: '#33415c', carpetAlt: '#27324a', pattern: 1, wood: 0 };
const BATH_THEME: AreaTheme = { floor: 'tile', hue: 200, accent: '#4aa3c8', carpet: '#dfe7ea', carpetAlt: '#c3d1d6', pattern: 2, wood: 1 };
const PARQUET_THEME: AreaTheme = { floor: 'parquet', hue: 24, accent: '#e0795a', carpet: '#7a3f35', carpetAlt: '#5d2f2a', pattern: 3, wood: 0 };

/** A pair of facing "talk" spots whose centre is (fx, fy) in floor-local coordinates. */
function talkPair(b: AreaBuilder, fx: number, fy: number, group: string): void {
  b.spot('talk', fx - 0.5, fy + 0.55, 'e', { group, approach: { x: Math.floor(fx - 0.5), y: Math.floor(fy) } });
  b.spot('talk', fx + 0.5, fy + 0.55, 'w', { group, approach: { x: Math.floor(fx + 0.5), y: Math.floor(fy) } });
}

export function layoutReception(): AreaLayout {
  const b = new AreaBuilder({ id: 'reception', kind: 'reception', label: 'Recepção', row: 'north', x: 0, width: CORE_W, theme: MARBLE });
  b.wallItem('elevator', 4, 2);
  b.wallItem('elevator', 9, 2);
  b.wallItem('logoSign', 6, 3);
  b.wallItem('clock', 12, 1);
  b.wallItem('poster', 1, 2, 0);
  b.wallItem('glassDoor', 3, 4, 0, 'west');
  b.put('rug', 0, 5, 5, 4, { variant: 0, walk: true });
  b.put('rug', 10, 5, 5, 4, { variant: 1, walk: true });
  b.put('receptionDesk', 4, 3, 7, 2);
  b.put('plantTall', 0, 0, 1, 1, { variant: 0 });
  b.put('plantTall', 14, 0, 1, 1, { variant: 1 });
  b.put('lamp', 2, 0, 1, 1);
  b.put('lamp', 12, 0, 1, 1);
  for (const side of [1, 11]) {
    const sofa = b.put('sofa', side, 7, 3, 1, { facing: 'n', variant: side === 1 ? 0 : 1 });
    b.put('coffeeTable', side + 1, 6, 2, 1);
    for (let i = 0; i < 3; i++) {
      b.spot('sofa', side + i + 0.5, 7.6, 'n', { seat: true, approach: { x: side + i, y: 8 }, itemId: sofa.id });
    }
  }
  b.put('plant', 0, 8, 1, 1, { variant: 2 });
  b.put('plant', 14, 8, 1, 1, { variant: 3 });
  b.put('sideTable', 5, 8, 1, 1);
  b.put('sideTable', 9, 8, 1, 1);
  b.spot('wait', 5.5, 5.6, 'n', { group: 'desk' });
  b.spot('wait', 7.5, 5.6, 'n', { group: 'desk' });
  b.spot('wait', 9.5, 5.6, 'n', { group: 'desk' });
  talkPair(b, 12, 5, 'reception-talk');
  b.door(6, 2, 'glass');
  return b.build();
}

export function layoutCopa(x0: number): AreaLayout {
  const b = new AreaBuilder({ id: 'copa', kind: 'copa', label: 'Copa', row: 'north', x: x0, width: CORE_W, theme: TILE_THEME });
  b.wallItem('menu', 3, 4);
  b.wallItem('clock', 9, 1);
  b.wallItem('poster', 11, 2, 1);
  b.put('counter', 0, 0, 9, 1);
  b.put('coffeeMachine', 2, 0, 1, 1, { walk: true });
  b.put('fridge', 10, 0, 2, 1);
  b.put('bin', 12, 0, 1, 1);
  b.put('vending', 13, 0, 2, 1);
  b.spot('coffee', 2.5, 1.6, 'n', { approach: { x: 2, y: 1 } });
  b.spot('fridge', 10.5, 1.6, 'n', { approach: { x: 10, y: 1 } });
  b.spot('vending', 13.5, 1.6, 'n', { approach: { x: 13, y: 1 } });
  b.put('rug', 1, 3, 7, 4, { variant: 2, walk: true });
  for (const fx of [2, 5]) {
    const table = b.put('highTable', fx, 4, 2, 1);
    for (let i = 0; i < 2; i++) {
      b.put('stool', fx + i, 3, 1, 1);
      b.spot('stool', fx + i + 0.5, 3.55, 's', { seat: true, approach: { x: fx + i, y: 2 }, itemId: table.id });
      b.put('stool', fx + i, 5, 1, 1);
      b.spot('stool', fx + i + 0.5, 5.55, 'n', { seat: true, approach: { x: fx + i, y: 6 }, itemId: table.id });
    }
  }
  const round = b.put('roundTable', 10, 5, 2, 2);
  const chairs: [number, number, 'n' | 'e' | 's' | 'w', number, number][] = [
    [9, 5, 'e', 8, 5],
    [12, 6, 'w', 13, 6],
    [10, 4, 's', 10, 3],
    [11, 7, 'n', 11, 8],
  ];
  for (const [cx, cy, facing, ax, ay] of chairs) {
    b.put('cafeChair', cx, cy, 1, 1, { facing });
    b.spot('cafe', cx + 0.5, cy + 0.55, facing, { seat: true, approach: { x: ax, y: ay }, itemId: round.id });
  }
  b.put('plantTall', 0, 8, 1, 1, { variant: 0 });
  b.put('plantTall', 14, 8, 1, 1, { variant: 1 });
  b.put('plant', 14, 3, 1, 1, { variant: 2 });
  talkPair(b, 12, 2, 'copa-talk');
  b.door(7, 2, 'glass');
  return b.build();
}

export function layoutMeeting(x0: number): AreaLayout {
  const b = new AreaBuilder({ id: 'meeting', kind: 'meeting', label: 'Sala de reunião', row: 'north', x: x0, width: CORE_W, theme: WOOD_THEME });
  b.wallItem('tv', 4, 6);
  b.wallItem('whiteboard', 11, 3);
  b.wallItem('clock', 1, 1);
  b.put('rug', 2, 1, 11, 7, { variant: 3, walk: true });
  const table = b.put('meetingTable', 3, 3, 9, 2);
  for (let i = 0; i < 7; i++) {
    const fx = 4 + i;
    b.put('meetChair', fx, 2, 1, 1, { facing: 's', variant: i % 3 });
    b.spot('meeting', fx + 0.5, 2.5, 's', { seat: true, approach: { x: fx, y: 1 }, itemId: table.id });
    b.put('meetChair', fx, 5, 1, 1, { facing: 'n', variant: (i + 1) % 3 });
    b.spot('meeting', fx + 0.5, 5.6, 'n', { seat: true, approach: { x: fx, y: 6 }, itemId: table.id });
  }
  b.put('plantTall', 0, 0, 1, 1, { variant: 0 });
  b.put('plantTall', 14, 0, 1, 1, { variant: 1 });
  b.put('plant', 0, 8, 1, 1, { variant: 2 });
  b.put('plant', 14, 8, 1, 1, { variant: 3 });
  b.put('sideTable', 13, 1, 1, 1);
  b.spot('whiteboard', 12.5, 1.6, 'n', { approach: { x: 12, y: 1 } });
  b.spot('whiteboard', 11.5, 1.6, 'n', { approach: { x: 11, y: 1 } });
  talkPair(b, 2, 6, 'meeting-talk');
  b.door(6, 2, 'glass');
  return b.build();
}

export function layoutBathrooms(): AreaLayout {
  const b = new AreaBuilder({ id: 'bathrooms', kind: 'bathrooms', label: 'Banheiros', row: 'south', x: 0, width: CORE_W, theme: BATH_THEME });
  b.wallItem('mirror', 9, 6);
  b.wallItem('clock', 2, 1);
  for (let i = 0; i < 3; i++) b.put('stall', i * 2, 0, 2, 2, { variant: i });
  for (let i = 0; i < 5; i++) b.put('stall', i * 2, 6, 2, 2, { variant: i + 1 });
  for (const fx of [9, 11, 13]) {
    b.put('sink', fx, 0, 1, 1);
    b.spot('sink', fx + 0.5, 1.6, 'n', { approach: { x: fx, y: 1 } });
  }
  b.put('bin', 14, 3, 1, 1);
  b.put('plantTall', 14, 8, 1, 1, { variant: 0 });
  b.put('plant', 10, 6, 1, 1, { variant: 1 });
  talkPair(b, 11, 4, 'bath-talk');
  b.door(6, 2, 'door');
  return b.build();
}

export function layoutLounge(x0: number): AreaLayout {
  const b = new AreaBuilder({ id: 'lounge', kind: 'lounge', label: 'Lounge', row: 'south', x: x0, width: CORE_W, theme: PARQUET_THEME });
  b.wallItem('tv', 3, 4);
  b.wallItem('clock', 9, 1);
  b.wallItem('poster', 10, 2, 2);
  b.put('rug', 0, 2, 5, 5, { variant: 4, walk: true });
  b.put('bookshelf', 0, 0, 3, 1);
  b.spot('bookshelf', 1.5, 1.6, 'n', { approach: { x: 1, y: 1 } });
  for (const fx of [12, 13]) {
    b.put('arcade', fx, 0, 1, 1, { variant: fx - 12 });
    b.spot('arcade', fx + 0.5, 1.6, 'n', { approach: { x: fx, y: 1 } });
  }
  const sofaA = b.put('sofa', 1, 2, 3, 1, { facing: 's', variant: 2 });
  b.put('coffeeTable', 1, 4, 3, 1);
  const sofaB = b.put('sofa', 1, 6, 3, 1, { facing: 'n', variant: 3 });
  for (let i = 0; i < 3; i++) {
    b.spot('sofa', 1 + i + 0.5, 2.6, 's', { seat: true, approach: { x: 1 + i, y: 3 }, itemId: sofaA.id });
    b.spot('sofa', 1 + i + 0.5, 6.6, 'n', { seat: true, approach: { x: 1 + i, y: 5 }, itemId: sofaB.id });
  }
  b.put('pingpong', 8, 4, 5, 3);
  b.spot('pingpong', 7.5, 5.55, 'e', { group: 'pingpong', approach: { x: 7, y: 5 } });
  b.spot('pingpong', 13.5, 5.55, 'w', { group: 'pingpong', approach: { x: 13, y: 5 } });
  b.put('beanbag', 5, 6, 1, 1, { variant: 0 });
  b.put('beanbag', 5, 8, 1, 1, { variant: 1 });
  b.spot('beanbag', 5.5, 6.55, 'n', { seat: true, approach: { x: 6, y: 6 } });
  b.spot('beanbag', 5.5, 8.55, 'n', { seat: true, approach: { x: 6, y: 8 } });
  b.put('plantTall', 14, 8, 1, 1, { variant: 1 });
  b.put('plantTall', 0, 8, 1, 1, { variant: 0 });
  b.put('plant', 14, 2, 1, 1, { variant: 2 });
  talkPair(b, 10, 2, 'lounge-talk');
  b.door(7, 2, 'archway');
  return b.build();
}
