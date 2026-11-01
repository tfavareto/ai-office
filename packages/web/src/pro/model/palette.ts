// The search of the Pro view (Cmd/Ctrl+P): every agent, project and action, found by name with accents and gaps
// forgiven. Pure: the view builds the items from the snapshot and shows what this returns.

export type PaletteKind = 'agent' | 'room' | 'action';

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  title: string;
  /** The second line: an agent's project and activity, a room's counts. */
  detail: string;
  /** Other words that find it, not shown. */
  words: string;
  /** An agent waiting on the person: listed first when nothing is typed. */
  waiting: boolean;
}

/** Results shown at most. */
export const PALETTE_LIMIT = 30;

const START_SCORE = 1000;
const WORD_START_SCORE = 800;
const CONTAINS_SCORE = 600;
const GAPS_SCORE = 300;
/** A match in the second line or the hidden words counts less than one in the name. */
const SECONDARY_WEIGHT = 0.5;

export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** The letters of `query` in order inside `text`, fewer gaps first; null when they are not all there. */
function gapsScore(query: string, text: string): number | null {
  let at = -1;
  let gaps = 0;
  for (const letter of query) {
    const next = text.indexOf(letter, at + 1);
    if (next === -1) return null;
    if (at !== -1) gaps += next - at - 1;
    at = next;
  }
  return Math.max(1, GAPS_SCORE - gaps);
}

/** The query as written inside `text`; a word start counts more than the middle of a word. */
function exactScore(query: string, text: string): number | null {
  const index = text.indexOf(query);
  if (index === 0) return START_SCORE;
  if (index > 0) return /[\s\-_/.]/.test(text[index - 1] ?? '') ? WORD_START_SCORE : CONTAINS_SCORE;
  return null;
}

function wordScore(word: string, item: PaletteItem): number | null {
  const title = foldText(item.title);
  const inTitle = exactScore(word, title) ?? gapsScore(word, title);
  if (inTitle !== null) return inTitle;
  // Letters with gaps only count in the name: a long second line would match almost anything.
  const inOther = exactScore(word, foldText(`${item.detail} ${item.words}`));
  return inOther === null ? null : inOther * SECONDARY_WEIGHT;
}

function itemScore(words: readonly string[], item: PaletteItem): number | null {
  let total = 0;
  for (const word of words) {
    const score = wordScore(word, item);
    if (score === null) return null;
    total += score;
  }
  return total;
}

/** The items that match every word of the query, best first; with no query, whoever waits on the person first. */
export function searchPalette(
  items: readonly PaletteItem[],
  query: string,
  limit: number = PALETTE_LIMIT,
): PaletteItem[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...items.filter((item) => item.waiting), ...items.filter((item) => !item.waiting)].slice(0, limit);
  }
  return items
    .flatMap((item) => {
      const score = itemScore(words, item);
      return score === null ? [] : [{ item, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/** The id after `current` in the list, wrapping around (the "next one waiting on you" key). */
export function nextInCycle(ids: readonly string[], current: string | null): string | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  return ids[(index + 1) % ids.length] ?? null;
}
