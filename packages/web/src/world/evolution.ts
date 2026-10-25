// What the world draws of the office's growth: the decoration the level has unlocked, the employee of the month and the
// cups in the trophy cabinet. Pure: both renderers derive the same thing from the snapshot and the "evolution" setting.
import { MAX_LEVEL, decorForLevel, type DecorId, type ProgressSummary } from '@ai-office/shared';

export type CupTier = 'bronze' | 'silver' | 'gold';

export interface Evolution {
  level: number;
  decor: ReadonlySet<DecorId>;
  /** Agent name on the reception plaque; null while nobody has finished a task this month. */
  employee: string | null;
  /** The cups in the cabinet, from the first one earned. */
  cups: readonly CupTier[];
}

export const BASE_EVOLUTION: Evolution = { level: 1, decor: new Set(), employee: null, cups: [] };

/** One cup per two achievements, at most this many. */
export const MAX_CUPS = 8;

/** Bronze for the first few, then silver, then gold: the cabinet fills up with shinier cups. */
export function cupsFor(achievements: number): CupTier[] {
  const count = Math.min(MAX_CUPS, Math.ceil(Math.max(0, achievements) / 2));
  return Array.from({ length: count }, (_, index) => (index < 3 ? 'bronze' : index < 6 ? 'silver' : 'gold'));
}

/** The decoration of the office: the plain office when the setting is off or there is no progress yet. */
export function evolutionOf(progress: ProgressSummary | undefined, enabled: boolean): Evolution {
  if (!enabled || progress === undefined) return BASE_EVOLUTION;
  const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(progress.level)));
  return {
    level,
    decor: decorForLevel(level),
    employee: progress.employee ?? null,
    cups: cupsFor(progress.achievements),
  };
}

const keys = new WeakMap<Evolution, string>();

/** A stable text that changes when anything the world would redraw changes (a cache key, computed once per value). */
export function evolutionKey(evolution: Evolution): string {
  let key = keys.get(evolution);
  if (key === undefined) {
    key = `${[...evolution.decor].sort().join(',')}|${evolution.employee ?? ''}|${evolution.cups.join(',')}`;
    keys.set(evolution, key);
  }
  return key;
}
