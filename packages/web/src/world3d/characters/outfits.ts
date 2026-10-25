// Deterministic looks: which model, outfit tint and size an agent gets from its seed. Pure, so it is unit tested.
import { HAIR_COLORS, OUTFITS, SKIN_TONES, swatchHex, type AccessoryId, type AgentLook } from '@ai-office/shared';
import { hash32 } from '../../layout/rng';

export const MALE_MODELS = ['humans/m1_lod', 'humans/m2_lod', 'humans/m3', 'humans/m4_lod'] as const;
export const FEMALE_MODELS = ['humans/f1', 'humans/f2', 'humans/f3', 'humans/f4'] as const;

/** Tints multiplied on a neutral-grey suit texture. */
export const OUTFIT_COLORS = [
  '#1f2a44',
  '#2b2f37',
  '#4a3b34',
  '#304a3f',
  '#5a2f3a',
  '#3c4f6e',
  '#6b6358',
  '#2f3f4a',
  '#7a5a3c',
  '#3d3a52',
  '#8a8f98',
  '#243a58',
] as const;

export interface LookChoice {
  model: string;
  outfit: string;
  /** Height multiplier around 1. */
  scale: number;
  /** Per-agent animation phase offset in [0, 1). */
  phase: number;
  /** Skin color the person chose; the model keeps its own skin without one. */
  skin?: string;
  /** Hair color the person chose; the model keeps its own hair without one. */
  hair?: string;
  /** Worn on the head; absent unless the person chose one. */
  accessory?: Exclude<AccessoryId, 'none'>;
  /** Cap color: the outfit's. */
  capColor?: string;
}

/**
 * The model (its hair style, build and face come together), the outfit tint, the size and the walking phase. Without a
 * `appearance` everything is drawn from the seed; with one, the person's choices replace the matching parts.
 */
export function chooseLook(look: 'f' | 'm', seed: number, appearance?: AgentLook): LookChoice {
  const models = look === 'f' ? FEMALE_MODELS : MALE_MODELS;
  const outfit = swatchHex(OUTFITS, appearance?.outfit);
  const skin = swatchHex(SKIN_TONES, appearance?.skin);
  const hair = swatchHex(HAIR_COLORS, appearance?.hairColor);
  const accessory = appearance?.accessory;
  const chosenOutfit = outfit ?? OUTFIT_COLORS[hash32(seed, 2) % OUTFIT_COLORS.length];
  return {
    model: appearance?.hairStyle === undefined ? models[hash32(seed, 1) % models.length] : models[appearance.hairStyle],
    outfit: chosenOutfit,
    scale: 0.97 + (hash32(seed, 3) % 7) / 100,
    phase: (hash32(seed, 4) % 1000) / 1000,
    ...(skin !== undefined ? { skin } : {}),
    ...(hair !== undefined ? { hair } : {}),
    ...(accessory !== undefined && accessory !== 'none' ? { accessory, capColor: chosenOutfit } : {}),
  };
}

/** What makes two choices draw the same person (the portrait cache keys on it). */
export function choiceKey(choice: LookChoice): string {
  return [choice.model, choice.outfit, choice.skin ?? '', choice.hair ?? '', choice.accessory ?? ''].join('|');
}
