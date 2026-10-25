// Validation of everything a person (or a file on disk) can say about customization. One reader serves both uses:
// strict for requests (the first problem is reported, with its field) and lenient for the stored file (a bad entry is
// dropped, the rest survives).
import {
  ACCESSORIES,
  HAIR_COLORS,
  HAIR_STYLE_COUNT,
  OUTFITS,
  PLANT_DENSITIES,
  ROOM_FLOORS,
  ROOM_WALLS,
  SIGN_STYLES,
  SKIN_TONES,
  type Swatch,
} from './palettes';
import {
  CUSTOMIZATION_VERSION,
  MAX_ALIAS_LENGTH,
  MAX_CUSTOMIZATION_BYTES,
  MAX_CUSTOM_ACCOUNTS,
  MAX_CUSTOM_AGENTS,
  MAX_CUSTOM_ORDER,
  MAX_CUSTOM_ROOMS,
  MAX_KEY_LENGTH,
  MAX_NAME_LENGTH,
  type AgentCustomization,
  type AgentLook,
  type Customization,
  type CustomizationErrorBody,
  type CustomizationErrorCode,
  type RoomCustomization,
  type RoomTheme,
  emptyCustomization,
} from './types';

export type LabelCheck = { ok: true; value: string } | { ok: false; reason: 'empty' | 'too-long' | 'invalid-chars' };

/** Control characters, bidirectional overrides and line or paragraph separators. */
const FORBIDDEN_CHARS = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Trims and checks a display name: 1 to `max` characters, no control characters. */
export function checkLabel(raw: unknown, max: number): LabelCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const value = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (value.length === 0) return { ok: false, reason: 'empty' };
  if (FORBIDDEN_CHARS.test(raw)) return { ok: false, reason: 'invalid-chars' };
  if ([...value].length > max) return { ok: false, reason: 'too-long' };
  return { ok: true, value };
}

export function checkName(raw: unknown): LabelCheck {
  return checkLabel(raw, MAX_NAME_LENGTH);
}

export function checkAlias(raw: unknown): LabelCheck {
  return checkLabel(raw, MAX_ALIAS_LENGTH);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An id of an agent, project or account: text without control characters, of a sensible length. */
export function isValidKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_KEY_LENGTH &&
    !FORBIDDEN_KEYS.has(value) &&
    !FORBIDDEN_CHARS.test(value)
  );
}

interface Reading {
  strict: boolean;
  error: CustomizationErrorBody | undefined;
  dropped: number;
}

function reject(reading: Reading, code: CustomizationErrorCode, field: string): void {
  reading.dropped++;
  if (reading.strict && reading.error === undefined) reading.error = { error: code, field };
}

function hasId(palette: readonly Swatch[], value: unknown): boolean {
  return typeof value === 'string' && palette.some((swatch) => swatch.id === value);
}

function oneOf(list: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && list.includes(value);
}

const LOOK_FIELDS: readonly (readonly [keyof AgentLook, (value: unknown) => boolean])[] = [
  ['skin', (value) => hasId(SKIN_TONES, value)],
  ['hairStyle', (value) => Number.isInteger(value) && (value as number) >= 0 && (value as number) < HAIR_STYLE_COUNT],
  ['hairColor', (value) => hasId(HAIR_COLORS, value)],
  ['outfit', (value) => hasId(OUTFITS, value)],
  ['accessory', (value) => oneOf(ACCESSORIES, value)],
];

const THEME_FIELDS: readonly (readonly [keyof RoomTheme, (value: unknown) => boolean])[] = [
  ['color', (value) => typeof value === 'string' && HEX_COLOR.test(value)],
  ['floor', (value) => oneOf(ROOM_FLOORS, value)],
  ['wall', (value) => oneOf(ROOM_WALLS, value)],
  ['plants', (value) => oneOf(PLANT_DENSITIES, value)],
  ['sign', (value) => oneOf(SIGN_STYLES, value)],
];

function readFields<T extends object>(
  raw: unknown,
  fields: readonly (readonly [keyof T & string, (value: unknown) => boolean])[],
  reading: Reading,
  code: CustomizationErrorCode,
  path: string,
): T | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    reject(reading, code, path);
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!fields.some(([name]) => name === key)) reject(reading, code, `${path}.${key}`);
  }
  for (const [name, valid] of fields) {
    const value = raw[name];
    if (value === undefined) continue;
    if (valid(value)) out[name] = name === 'color' ? (value as string).toLowerCase() : value;
    else reject(reading, code, `${path}.${name}`);
  }
  return Object.keys(out).length === 0 ? undefined : (out as T);
}

function readLook(raw: unknown, reading: Reading, path: string): AgentLook | undefined {
  return readFields<AgentLook>(raw, LOOK_FIELDS, reading, 'invalid-look', path);
}

function readTheme(raw: unknown, reading: Reading, path: string): RoomTheme | undefined {
  return readFields<RoomTheme>(raw, THEME_FIELDS, reading, 'invalid-theme', path);
}

function readLabel(raw: unknown, max: number, code: CustomizationErrorCode, reading: Reading, path: string) {
  if (raw === undefined) return undefined;
  const checked = checkLabel(raw, max);
  if (checked.ok) return checked.value;
  reject(reading, code, path);
  return undefined;
}

/** The valid fields of a look that came over the network; undefined when none is valid. */
export function parseLook(raw: unknown): AgentLook | undefined {
  return readLook(raw, { strict: false, error: undefined, dropped: 0 }, 'look');
}

/** The valid fields of a room theme that came over the network; undefined when none is valid. */
export function parseTheme(raw: unknown): RoomTheme | undefined {
  return readTheme(raw, { strict: false, error: undefined, dropped: 0 }, 'theme');
}

function readAgent(raw: unknown, reading: Reading, path: string): AgentCustomization | undefined {
  if (!isPlainObject(raw)) {
    reject(reading, 'invalid-body', path);
    return undefined;
  }
  for (const key of Object.keys(raw))
    if (key !== 'name' && key !== 'look') reject(reading, 'invalid-body', `${path}.${key}`);
  const name = readLabel(raw.name, MAX_NAME_LENGTH, 'invalid-name', reading, `${path}.name`);
  const look = readLook(raw.look, reading, `${path}.look`);
  return { ...(name !== undefined ? { name } : {}), ...(look !== undefined ? { look } : {}) };
}

const ROOM_KEYS: ReadonlySet<string> = new Set(['alias', 'theme', 'look', 'pinned', 'hidden']);

function readFlag(raw: unknown, reading: Reading, path: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') return raw;
  reject(reading, 'invalid-body', path);
  return undefined;
}

function readRoom(raw: unknown, reading: Reading, path: string): RoomCustomization | undefined {
  if (!isPlainObject(raw)) {
    reject(reading, 'invalid-body', path);
    return undefined;
  }
  for (const key of Object.keys(raw)) if (!ROOM_KEYS.has(key)) reject(reading, 'invalid-body', `${path}.${key}`);
  const alias = readLabel(raw.alias, MAX_ALIAS_LENGTH, 'invalid-alias', reading, `${path}.alias`);
  const theme = readTheme(raw.theme, reading, `${path}.theme`);
  const look = readLook(raw.look, reading, `${path}.look`);
  const pinned = readFlag(raw.pinned, reading, `${path}.pinned`);
  const hidden = readFlag(raw.hidden, reading, `${path}.hidden`);
  return {
    ...(alias !== undefined ? { alias } : {}),
    ...(theme !== undefined ? { theme } : {}),
    ...(look !== undefined ? { look } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
  };
}

function readTable<T>(
  raw: unknown,
  reading: Reading,
  path: string,
  max: number,
  read: (value: unknown, reading: Reading, path: string) => T | undefined,
): Record<string, T> {
  const out: Record<string, T> = {};
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) {
    reject(reading, 'invalid-body', path);
    return out;
  }
  const entries = Object.entries(raw);
  if (entries.length > max) reject(reading, 'too-many-items', path);
  // A file with too many entries keeps the newest ones (they come last).
  for (const [key, value] of entries.slice(-max)) {
    if (!isValidKey(key)) {
      reject(reading, 'invalid-key', path);
      continue;
    }
    const item = read(value, reading, `${path}.${key}`);
    if (item !== undefined) out[key] = item;
  }
  return out;
}

function readOrder(raw: unknown, reading: Reading): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    reject(reading, 'invalid-order', 'order');
    return [];
  }
  if (raw.length > MAX_CUSTOM_ORDER) reject(reading, 'too-many-items', 'order');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [index, id] of raw.slice(0, MAX_CUSTOM_ORDER).entries()) {
    if (!isValidKey(id) || seen.has(id)) {
      reject(reading, 'invalid-order', `order.${index}`);
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type ReadResult =
  { ok: true; value: Customization; dropped: number } | { ok: false; error: CustomizationErrorBody };

/** Removes what says nothing: empty entries, `false` flags. */
export function pruneCustomization(customization: Customization): Customization {
  const nonEmpty = <T extends object>(table: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(table).filter(([, value]) => Object.keys(value).length > 0));
  const rooms = Object.fromEntries(
    Object.entries(customization.rooms).map(([id, room]) => {
      const { pinned, hidden, ...rest } = room;
      return [id, { ...rest, ...(pinned === true ? { pinned } : {}), ...(hidden === true ? { hidden } : {}) }];
    }),
  );
  return {
    ...customization,
    agents: nonEmpty(customization.agents),
    rooms: nonEmpty(rooms),
    accounts: nonEmpty(customization.accounts),
  };
}

/** Reads a customization document of the current version. `strict` fails on the first problem; otherwise bad entries are dropped. */
export function readCustomization(raw: unknown, strict: boolean): ReadResult {
  const reading: Reading = { strict, error: undefined, dropped: 0 };
  if (!isPlainObject(raw)) return { ok: false, error: { error: 'invalid-body' } };
  if (raw.version !== CUSTOMIZATION_VERSION)
    return { ok: false, error: { error: 'unsupported-version', field: 'version' } };
  const value = pruneCustomization({
    version: CUSTOMIZATION_VERSION,
    agents: readTable(raw.agents, reading, 'agents', MAX_CUSTOM_AGENTS, readAgent),
    rooms: readTable(raw.rooms, reading, 'rooms', MAX_CUSTOM_ROOMS, readRoom),
    accounts: readTable(
      raw.accounts,
      reading,
      'accounts',
      MAX_CUSTOM_ACCOUNTS,
      (item, ctx, path): { look: AgentLook } | undefined => {
        if (!isPlainObject(item)) {
          reject(ctx, 'invalid-body', path);
          return undefined;
        }
        for (const key of Object.keys(item)) if (key !== 'look') reject(ctx, 'invalid-body', `${path}.${key}`);
        const look = readLook(item.look, ctx, `${path}.look`);
        return look === undefined ? undefined : { look };
      },
    ),
    order: readOrder(raw.order, reading),
  });
  if (reading.error !== undefined) return { ok: false, error: reading.error };
  if (jsonBytes(value) > MAX_CUSTOMIZATION_BYTES) return { ok: false, error: { error: 'too-large' } };
  return { ok: true, value, dropped: reading.dropped };
}

/** Size of the document once saved (UTF-8). */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export type StoredOutcome =
  | { status: 'empty'; value: Customization }
  | { status: 'ok' | 'migrated'; value: Customization; dropped: number }
  /** Written by a newer AI Office: left alone. */
  | { status: 'newer' }
  | { status: 'invalid' };

type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

/** `MIGRATIONS[n]` turns a document of version n into one of version n + 1. Version 0 is a file without `version`. */
const MIGRATIONS: Readonly<Record<number, Migration>> = {
  0: (document) => ({ ...document, version: 1 }),
};

function migrate(document: Record<string, unknown>, from: number): Record<string, unknown> {
  let current = document;
  for (let version = from; version < CUSTOMIZATION_VERSION; version++) {
    const step = MIGRATIONS[version];
    if (step === undefined) return current;
    current = step(current);
  }
  return current;
}

/** Reads the content of `customization.json`: migrates old versions, drops invalid entries, never throws. */
export function readStoredCustomization(raw: unknown): StoredOutcome {
  if (raw === undefined) return { status: 'empty', value: emptyCustomization() };
  if (!isPlainObject(raw)) return { status: 'invalid' };
  const version = raw.version === undefined ? 0 : raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return { status: 'invalid' };
  if (version > CUSTOMIZATION_VERSION) return { status: 'newer' };
  const document = version < CUSTOMIZATION_VERSION ? migrate(raw, version) : raw;
  const read = readCustomization(document, false);
  if (!read.ok) return { status: 'invalid' };
  return { status: version < CUSTOMIZATION_VERSION ? 'migrated' : 'ok', value: read.value, dropped: read.dropped };
}
