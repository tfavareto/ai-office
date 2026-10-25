// The choices a person can make for an agent's look and a room's finish. Both worlds read the same ids: 2D paints
// the hex values, 3D tints its models with them. Ids are stable and stored in `customization.json`, so a palette may
// only grow at the end.

export interface Swatch<Id extends string = string> {
  readonly id: Id;
  readonly hex: string;
}

export const SKIN_TONES = [
  { id: 'fair', hex: '#f6d4b8' },
  { id: 'light', hex: '#eab894' },
  { id: 'medium', hex: '#d99b72' },
  { id: 'tan', hex: '#bd7d54' },
  { id: 'brown', hex: '#93583a' },
  { id: 'deep', hex: '#6a3d28' },
] as const satisfies readonly Swatch[];

export const HAIR_COLORS = [
  { id: 'black', hex: '#1b1411' },
  { id: 'espresso', hex: '#2d1f17' },
  { id: 'brown', hex: '#3b2a1e' },
  { id: 'chestnut', hex: '#5a3a22' },
  { id: 'copper', hex: '#7a4a26' },
  { id: 'honey', hex: '#a8742f' },
  { id: 'blond', hex: '#c9a14e' },
  { id: 'red', hex: '#7a2f1f' },
  { id: 'grey', hex: '#9a9a9a' },
] as const satisfies readonly Swatch[];

/** Jacket and suit colors; vivid ones double as "team colors". */
export const OUTFITS = [
  { id: 'navy', hex: '#1f2a44' },
  { id: 'charcoal', hex: '#2b2f37' },
  { id: 'wine', hex: '#5a2f3a' },
  { id: 'forest', hex: '#304a3f' },
  { id: 'camel', hex: '#7a5a3c' },
  { id: 'plum', hex: '#3d3a52' },
  { id: 'crimson', hex: '#b3282d' },
  { id: 'tangerine', hex: '#d9792b' },
  { id: 'gold', hex: '#c9a227' },
  { id: 'teal', hex: '#1f8a8a' },
  { id: 'azure', hex: '#2f6fed' },
  { id: 'violet', hex: '#7b4fd1' },
] as const satisfies readonly Swatch[];

/** Hair styles a person can choose (four per look, each one a model of the 3D world and a cut of the 2D sprites). */
export const HAIR_STYLE_COUNT = 4;

export const ACCESSORIES = ['none', 'glasses', 'headphones', 'cap'] as const;

export const ROOM_COLORS = [
  { id: 'rose', hex: '#e0577a' },
  { id: 'orange', hex: '#e9853b' },
  { id: 'amber', hex: '#e0b13a' },
  { id: 'lime', hex: '#8cc152' },
  { id: 'green', hex: '#37b27a' },
  { id: 'teal', hex: '#27b5c4' },
  { id: 'sky', hex: '#4a9be8' },
  { id: 'indigo', hex: '#5f6fe0' },
  { id: 'violet', hex: '#9a65e0' },
  { id: 'magenta', hex: '#d457c0' },
  { id: 'brick', hex: '#b5513c' },
  { id: 'slate', hex: '#7b8798' },
] as const satisfies readonly Swatch[];

export const ROOM_FLOORS = ['wood', 'carpet', 'tiles', 'concrete'] as const;
export const ROOM_WALLS = ['wood', 'plaster', 'brick', 'concrete'] as const;
export const PLANT_DENSITIES = ['few', 'normal', 'lush'] as const;
export const SIGN_STYLES = ['brass', 'neon', 'wood', 'minimal'] as const;

export type SkinId = (typeof SKIN_TONES)[number]['id'];
export type HairColorId = (typeof HAIR_COLORS)[number]['id'];
export type OutfitId = (typeof OUTFITS)[number]['id'];
export type HairStyleId = 0 | 1 | 2 | 3;
export type AccessoryId = (typeof ACCESSORIES)[number];
export type RoomFloor = (typeof ROOM_FLOORS)[number];
export type RoomWall = (typeof ROOM_WALLS)[number];
export type PlantDensity = (typeof PLANT_DENSITIES)[number];
export type SignStyle = (typeof SIGN_STYLES)[number];

/** The hex of a swatch id, or undefined for an id the palette does not know. */
export function swatchHex(palette: readonly Swatch[], id: string | undefined): string | undefined {
  return palette.find((swatch) => swatch.id === id)?.hex;
}
