import {
  HAIR_COLORS as HAIR_CHOICES,
  OUTFITS,
  SKIN_TONES as SKIN_CHOICES,
  lookSignature,
  swatchHex,
  type AgentLook,
} from '@ai-office/shared';
import { Rng, hash32 } from '../../layout/rng';
import { SKIN_TONES } from '../palette';
import { shade } from '../color';

/** 0-5 are drawn from the seed; 6 is the round, full cut that only a person's choice gives. */
export type HairStyle = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The sprite cut that stands for each of the four hair styles a person can choose, by look. */
export const SPRITE_HAIR_STYLES: Readonly<Record<'f' | 'm', readonly HairStyle[]>> = {
  f: [1, 6, 0, 5],
  m: [0, 1, 2, 3],
};

export interface Look {
  key: string;
  gender: 'f' | 'm';
  skin: string;
  skinShade: string;
  hairStyle: HairStyle;
  hair: string;
  hairShade: string;
  hairLight: string;
  /** Outer garment (suit jacket / blazer), or null for shirt-sleeves. */
  jacket: string | null;
  shirt: string;
  tie: string | null;
  bottom: string;
  /** Skirt instead of trousers. */
  skirt: boolean;
  /** Bare skin legs below a skirt. */
  bareLegs: boolean;
  shoes: string;
  glasses: boolean;
  headphones: boolean;
  cap: boolean;
  /** Color of the cap when there is one. */
  capColor: string;
  beard: boolean;
  /** Small ID badge on the chest (subagents). */
  badge: boolean;
}

const HAIR_COLORS = ['#1b1411', '#2d1f17', '#3b2a1e', '#5a3a22', '#7a4a26', '#a8742f', '#c9a14e', '#7a2f1f', '#9a9a9a'];
const SUIT_COLORS = ['#22262e', '#2b3a55', '#4a4a52', '#5a4636', '#1f3a3a', '#3a2f4a', '#36404f'];
const SHIRTS = ['#f4f6f8', '#cfe3f6', '#f2d9de', '#dff0e0', '#f6efd2', '#e6e9f5'];
const TIES = ['#b8312f', '#2f6fed', '#1f7a5a', '#c8a24e', '#6b3fa0', '#1a1a1a', '#e0795a'];
const BLAZERS = ['#2b3a55', '#6b2f3f', '#2d2d33', '#c9b79c', '#3b6a5a', '#7a5a9a', '#a14a3a'];
const BLOUSES = ['#f4f6f8', '#f2d9de', '#cfe3f6', '#e8d8f2', '#fff3d6', '#2d2d33'];
const SKIRTS = ['#22262e', '#3a3f5a', '#5a3a30', '#2f4a40', '#6b5a4a'];

const cache = new Map<string, Look>();

function weighted(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

/** What a person's choices change on top of the look the seed gave. */
function withAppearance(look: Look, appearance: AgentLook): Look {
  const skin = swatchHex(SKIN_CHOICES, appearance.skin) ?? look.skin;
  const hair = swatchHex(HAIR_CHOICES, appearance.hairColor) ?? look.hair;
  const outfit = swatchHex(OUTFITS, appearance.outfit);
  const jacket = outfit ?? look.jacket;
  const accessory = appearance.accessory;
  return {
    ...look,
    skin,
    skinShade: shade(skin, -0.16),
    hair,
    hairShade: shade(hair, -0.3),
    hairLight: shade(hair, 0.25),
    hairStyle:
      appearance.hairStyle === undefined ? look.hairStyle : SPRITE_HAIR_STYLES[look.gender][appearance.hairStyle],
    jacket,
    bottom: outfit === undefined || look.skirt ? look.bottom : shade(outfit, -0.1),
    glasses: accessory === undefined ? look.glasses : accessory === 'glasses',
    headphones: accessory === 'headphones',
    cap: accessory === 'cap',
    capColor: jacket ?? look.capColor,
  };
}

/** Deterministic appearance from the agent seed and look (f/m), with the choices the person made on top. */
export function lookFor(seed: number, gender: 'f' | 'm', badge: boolean, appearance?: AgentLook): Look {
  const key = `${seed}|${gender}|${badge ? 1 : 0}|${lookSignature(appearance)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = new Rng(hash32(seed, gender === 'f' ? 7 : 13));
  const skin = SKIN_TONES[weighted(rng, [3, 4, 3, 3, 2, 2])];
  const hairIndex = weighted(rng, [4, 4, 4, 3, 2, 2, 1.5, 1, 0.6]);
  const hair = HAIR_COLORS[hairIndex];
  const wearsJacket = gender === 'f' ? rng.chance(0.8) : rng.chance(0.78);
  const skirt = gender === 'f' && rng.chance(0.5);
  const jacket = wearsJacket ? (gender === 'f' ? rng.pick(BLAZERS) : rng.pick(SUIT_COLORS)) : null;
  const look: Look = {
    key,
    gender,
    skin,
    skinShade: shade(skin, -0.16),
    hairStyle: rng.int(6) as HairStyle,
    hair,
    hairShade: shade(hair, -0.3),
    hairLight: shade(hair, 0.25),
    jacket,
    shirt: gender === 'f' ? rng.pick(BLOUSES) : rng.pick(SHIRTS),
    tie: gender === 'm' && rng.chance(0.78) ? rng.pick(TIES) : null,
    bottom: skirt ? rng.pick(SKIRTS) : jacket ? shade(jacket, -0.1) : rng.pick(SUIT_COLORS),
    skirt,
    bareLegs: skirt && rng.chance(0.6),
    shoes: gender === 'f' && rng.chance(0.3) ? '#8a2f3a' : rng.chance(0.5) ? '#1b1613' : '#3a271a',
    glasses: rng.chance(0.25),
    headphones: false,
    cap: false,
    capColor: '#2b3a55',
    beard: gender === 'm' && rng.chance(0.18),
    badge,
  };
  const result = appearance === undefined ? look : withAppearance(look, appearance);
  cache.set(key, result);
  return result;
}
