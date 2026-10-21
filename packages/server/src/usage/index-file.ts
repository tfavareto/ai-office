// Persistence of the usage index in <stateDir>/usage-index: one shard per UTC month with the hourly rows, plus
// `meta.json` with what was read of each transcript. Compact (dictionary-coded rows), versioned, written atomically
// with mode 0600. A shard newer than `meta.json` (a crash between the two writes) or any damaged file means "rebuild".
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageRow } from '@ai-office/shared';
import { asArray, asNumber, asRecord, asString, writeJsonAtomic } from '../util/fs-safe';

export const INDEX_VERSION = 1;
export const INDEX_DIR_NAME = 'usage-index';
const META_FILE = 'meta.json';
const HOUR_MS = 3_600_000;
const MONTH_FILE = /^(\d{4}-\d{2})\.json$/;

/** What is known about one transcript file. */
export interface FileState {
  account: string;
  /** Path relative to the account directory. */
  rel: string;
  session: string;
  /** Subagent id; "" for a main transcript. */
  agent: string;
  /** Working directory seen in the file ("" until one is seen). */
  project: string;
  /** Bytes consumed, always the end of a complete line. */
  offset: number;
  mtimeMs: number;
  ino: number;
  /** Hash of the first bytes: tells a replaced file from a longer one. */
  head: number;
  /** Last few messages seen: a message split across lines is counted once. */
  recent: RecentMessage[];
}

export interface RecentMessage {
  id: string;
  hour: number;
  model: string;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface LoadedIndex {
  rows: UsageRow[];
  files: FileState[];
  generation: number;
}

export interface IndexSnapshot {
  generation: number;
  /** Rows of every month that must be written, by month key. */
  months: ReadonlyMap<string, readonly UsageRow[]>;
  /** Months that no longer have rows (their shards are removed). */
  emptyMonths: readonly string[];
  /** Row count of every month that exists. */
  rowCounts: ReadonlyMap<string, number>;
  files: readonly FileState[];
}

class Dict {
  readonly items: string[] = [];
  private readonly index = new Map<string, number>();

  id(value: string): number {
    let found = this.index.get(value);
    if (found === undefined) {
      found = this.items.length;
      this.items.push(value);
      this.index.set(value, found);
    }
    return found;
  }
}

function encodeMonth(month: string, generation: number, rows: readonly UsageRow[]): unknown {
  const accounts = new Dict();
  const projects = new Dict();
  const models = new Dict();
  const sessions = new Dict();
  const agents = new Dict();
  const encoded = rows.map((row) => [
    row.hour / HOUR_MS,
    accounts.id(row.account),
    projects.id(row.project),
    models.id(row.model),
    sessions.id(row.session),
    agents.id(row.agent),
    row.input,
    row.output,
    row.cacheWrite,
    row.cacheRead,
    row.costUSD,
  ]);
  return { v: INDEX_VERSION, gen: generation, month, a: accounts.items, p: projects.items, m: models.items, s: sessions.items, g: agents.items, rows: encoded };
}

function lookup(items: readonly unknown[], index: unknown): string | undefined {
  return typeof index === 'number' ? asString(items[index]) : undefined;
}

function decodeRow(raw: unknown, tables: Record<'a' | 'p' | 'm' | 's' | 'g', unknown[]>): UsageRow | undefined {
  const cells = asArray(raw);
  const hours = asNumber(cells[0]);
  const account = lookup(tables.a, cells[1]);
  const project = lookup(tables.p, cells[2]);
  const model = lookup(tables.m, cells[3]);
  const session = lookup(tables.s, cells[4]);
  const agent = lookup(tables.g, cells[5]);
  const numbers = [6, 7, 8, 9, 10].map((i) => asNumber(cells[i]));
  if (hours === undefined || account === undefined || project === undefined || model === undefined || session === undefined || agent === undefined || numbers.some((n) => n === undefined)) return undefined;
  const [input, output, cacheWrite, cacheRead, costUSD] = numbers as number[];
  return { hour: hours * HOUR_MS, account, project, model, session, agent, input: input as number, output: output as number, cacheWrite: cacheWrite as number, cacheRead: cacheRead as number, costUSD: costUSD as number };
}

interface DecodedMonth {
  generation: number;
  rows: UsageRow[];
}

/** undefined when the shard is damaged in any way. */
function decodeMonth(value: unknown): DecodedMonth | undefined {
  const shard = asRecord(value);
  const generation = asNumber(shard.gen);
  if (shard.v !== INDEX_VERSION || generation === undefined) return undefined;
  const tables = { a: asArray(shard.a), p: asArray(shard.p), m: asArray(shard.m), s: asArray(shard.s), g: asArray(shard.g) };
  const rows: UsageRow[] = [];
  for (const raw of asArray(shard.rows)) {
    const row = decodeRow(raw, tables);
    if (row === undefined) return undefined;
    rows.push(row);
  }
  return { generation, rows };
}

function encodeFile(file: FileState): unknown {
  return {
    a: file.account,
    r: file.rel,
    s: file.session,
    g: file.agent,
    p: file.project,
    o: file.offset,
    m: file.mtimeMs,
    i: file.ino,
    h: file.head,
    d: file.recent.map((m) => [m.id, m.hour / HOUR_MS, m.model, m.input, m.output, m.cacheWrite5m, m.cacheWrite1h, m.cacheRead]),
  };
}

function decodeRecent(raw: unknown): RecentMessage | undefined {
  const cells = asArray(raw);
  const id = asString(cells[0]);
  const hours = asNumber(cells[1]);
  const model = asString(cells[2]);
  const numbers = [3, 4, 5, 6, 7].map((i) => asNumber(cells[i]));
  if (id === undefined || hours === undefined || model === undefined || numbers.some((n) => n === undefined)) return undefined;
  const [input, output, cacheWrite5m, cacheWrite1h, cacheRead] = numbers as number[];
  return { id, hour: hours * HOUR_MS, model, input: input as number, output: output as number, cacheWrite5m: cacheWrite5m as number, cacheWrite1h: cacheWrite1h as number, cacheRead: cacheRead as number };
}

function decodeFile(value: unknown): FileState | undefined {
  const file = asRecord(value);
  const account = asString(file.a);
  const rel = asString(file.r);
  const session = asString(file.s);
  const agent = asString(file.g);
  const project = asString(file.p);
  const offset = asNumber(file.o);
  const mtimeMs = asNumber(file.m);
  const ino = asNumber(file.i);
  const head = asNumber(file.h);
  if (account === undefined || rel === undefined || session === undefined || agent === undefined || project === undefined) return undefined;
  if (offset === undefined || mtimeMs === undefined || ino === undefined || head === undefined) return undefined;
  const recent = asArray(file.d).flatMap((raw) => decodeRecent(raw) ?? []);
  return { account, rel, session, agent, project, offset, mtimeMs, ino, head, recent };
}

async function readShard(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

/**
 * Loads the index. Returns undefined when there is none or when it cannot be trusted: the caller then starts from
 * scratch (the index is only a cache of the transcripts).
 */
export async function loadIndex(stateDir: string): Promise<LoadedIndex | undefined> {
  const dir = join(stateDir, INDEX_DIR_NAME);
  let meta: Record<string, unknown>;
  try {
    meta = asRecord(await readShard(join(dir, META_FILE)));
  } catch {
    return undefined;
  }
  const generation = asNumber(meta.gen);
  const months = asRecord(meta.months);
  if (meta.v !== INDEX_VERSION || generation === undefined) return undefined;
  const files = asArray(meta.files).map(decodeFile);
  if (files.some((file) => file === undefined)) return undefined;
  const rows: UsageRow[] = [];
  const seen = new Set<string>();
  try {
    for (const name of await readdir(dir)) {
      const match = MONTH_FILE.exec(name);
      if (match?.[1] === undefined) continue;
      seen.add(match[1]);
      const expected = asNumber(months[match[1]]);
      const decoded = decodeMonth(await readShard(join(dir, name)));
      // A shard that meta does not list, that is newer than meta, or that lost rows means a write was interrupted.
      if (expected === undefined || decoded === undefined || decoded.generation > generation || decoded.rows.length !== expected) return undefined;
      rows.push(...decoded.rows);
    }
  } catch {
    return undefined;
  }
  if (Object.keys(months).some((month) => !seen.has(month))) return undefined;
  return { rows, files: files as FileState[], generation };
}

/** Writes the changed shards first and `meta.json` last, so a crash in between is detected on the next load. */
export async function saveIndex(stateDir: string, snapshot: IndexSnapshot): Promise<void> {
  const dir = join(stateDir, INDEX_DIR_NAME);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [month, rows] of snapshot.months) await writeJsonAtomic(join(dir, `${month}.json`), encodeMonth(month, snapshot.generation, rows));
  const months: Record<string, number> = {};
  for (const [month, count] of snapshot.rowCounts) months[month] = count;
  await writeJsonAtomic(join(dir, META_FILE), { v: INDEX_VERSION, gen: snapshot.generation, months, files: snapshot.files.map(encodeFile) });
  for (const month of snapshot.emptyMonths) await unlink(join(dir, `${month}.json`)).catch(() => undefined);
}
