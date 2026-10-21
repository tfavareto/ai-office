// Cost estimates from public API list prices, per model family. Always an estimate (plans bill differently).

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/** The five token counters a price applies to. */
export interface PricedTokens {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

const MILLION = 1_000_000;
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

function price(input: number, output: number): ModelPrice {
  return {
    input,
    output,
    cacheWrite5m: round(input * 1.25),
    cacheWrite1h: round(input * 2),
    cacheRead: round(input * 0.1),
  };
}

const OPUS_LEGACY = price(15, 75);
const OPUS = price(5, 25);
const SONNET = price(3, 15);
const HAIKU = price(1, 5);
const HAIKU_LEGACY = price(0.8, 4);
/** Fable is priced like the current Opus tier (estimate). */
const FABLE = OPUS;

/** Price table lookup by model id ("claude-opus-5-5", "claude-3-5-haiku-20241022"...). */
export function priceFor(model: string | undefined): ModelPrice | undefined {
  if (model === undefined) return undefined;
  const id = model.toLowerCase();
  if (id.includes('opus')) {
    return /opus-4(-1)?(-\d{8})?$/.test(id) || id.includes('3-opus') || id.includes('opus-3') ? OPUS_LEGACY : OPUS;
  }
  if (id.includes('sonnet')) return SONNET;
  if (id.includes('haiku')) return /3-5-haiku|haiku-3/.test(id) ? HAIKU_LEGACY : HAIKU;
  if (id.includes('fable')) return FABLE;
  return undefined;
}

/** Estimated cost in USD of one message, or undefined when the model has no known price. */
export function tokensCostUSD(model: string | undefined, tokens: PricedTokens): number | undefined {
  const table = priceFor(model);
  if (table === undefined) return undefined;
  return (
    (tokens.input * table.input +
      tokens.output * table.output +
      tokens.cacheWrite5m * table.cacheWrite5m +
      tokens.cacheWrite1h * table.cacheWrite1h +
      tokens.cacheRead * table.cacheRead) /
    MILLION
  );
}

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other';

export function modelFamily(model: string): ModelFamily {
  const id = model.toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  if (id.includes('fable')) return 'fable';
  return 'other';
}

const FAMILY_NAMES: Record<Exclude<ModelFamily, 'other'>, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
};
const VERSION_PATTERN = /(\d+)(?:-(\d+))?/;

/**
 * Short display name of a model id: "claude-opus-5-5" -> "Opus 5.5", "claude-3-5-haiku-20241022" -> "Haiku 3.5".
 * Unknown ids are returned as they are.
 */
export function modelLabel(model: string): string {
  const family = modelFamily(model);
  if (family === 'other') return model;
  const id = model
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$/, '');
  const at = id.indexOf(family);
  const match =
    VERSION_PATTERN.exec(id.slice(at + family.length)) ??
    VERSION_PATTERN.exec(id.slice(0, at).replace(/^claude-?/, ''));
  const version = match === null ? '' : match[2] === undefined ? (match[1] as string) : `${match[1]}.${match[2]}`;
  return version === '' ? FAMILY_NAMES[family] : `${FAMILY_NAMES[family]} ${version}`;
}
