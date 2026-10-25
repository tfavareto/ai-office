// Reads the new lines of one transcript into the usage store, resuming where the last read stopped.
import { open } from 'node:fs/promises';
import { type UsageRow, fnv1a } from '@ai-office/shared';
import { JsonlTailer } from '../claude/jsonl-tailer';
import { mergeUsage, usageCostUSD } from '../claude/cost';
import type { UsageInfo } from '../claude/types';
import type { TranscriptFile } from './discover';
import type { FileState, RecentMessage } from './index-file';
import { applyCodexLine } from './codex-usage';
import { parseUsageLine, type UsageSample } from './usage-line';
import type { UsageStore } from './usage-store';

const HEAD_BYTES = 256;
const READ_BYTES = 1024 * 1024;
const LINES_PER_TURN = 200;
/** Messages remembered while a file is read (a message spans consecutive lines, so a few are enough). */
const RECENT_WHILE_READING = 2048;
/** Messages kept in the index between runs. */
export const RECENT_PERSISTED = 16;
const HOUR_MS = 3_600_000;

export interface ScanContext {
  store: UsageStore;
  /** Lines older than this are not part of the index. */
  floor: number;
  /** A change of usage, for the burn rate. */
  onChange(account: string, at: number, tokens: number, costUSD: number): void;
  stopped(): boolean;
  /** Lets the rest of the server run between slices of work. */
  yieldTurn(): Promise<void>;
}

export interface ScanResult {
  state: FileState;
  /** Bytes consumed by this scan. */
  bytes: number;
  /** The file is not the one the state describes any more: the index has to be rebuilt. */
  replaced: boolean;
}

export function newFileState(file: TranscriptFile): FileState {
  return {
    account: file.account,
    rel: file.rel,
    session: file.session,
    agent: file.agent,
    project: '',
    offset: 0,
    mtimeMs: file.mtimeMs,
    ino: file.ino,
    head: 0,
    recent: [],
  };
}

export async function headHash(path: string): Promise<number> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    // A file still shorter than the sample has no stable fingerprint yet.
    return bytesRead < HEAD_BYTES ? 0 : fnv1a(buffer.toString('latin1', 0, bytesRead));
  } finally {
    await handle.close();
  }
}

const usageOf = (message: RecentMessage): UsageInfo => ({
  input: message.input,
  output: message.output,
  cacheWrite5m: message.cacheWrite5m,
  cacheWrite1h: message.cacheWrite1h,
  cacheRead: message.cacheRead,
});

function recentOf(id: string, hour: number, model: string, usage: UsageInfo): RecentMessage {
  return {
    id,
    hour,
    model,
    input: usage.input,
    output: usage.output,
    cacheWrite5m: usage.cacheWrite5m,
    cacheWrite1h: usage.cacheWrite1h,
    cacheRead: usage.cacheRead,
  };
}

interface Counted {
  row: UsageRow;
  tokens: number;
}

/** Row delta of a sample (the whole message, or the growth of one already seen) and the message to remember. */
function countSample(
  state: FileState,
  sample: UsageSample,
  previous: RecentMessage | undefined,
): { counted: Counted; remember: RecentMessage | undefined } {
  const model = previous?.model ?? sample.model;
  const hour = previous?.hour ?? Math.floor(sample.at / HOUR_MS) * HOUR_MS;
  const before: UsageInfo =
    previous === undefined
      ? { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }
      : usageOf(previous);
  const after = previous === undefined ? sample.usage : mergeUsage(before, sample.usage);
  const cost = (usageCostUSD(model, after) ?? 0) - (previous === undefined ? 0 : (usageCostUSD(model, before) ?? 0));
  const writes = after.cacheWrite5m + after.cacheWrite1h - (before.cacheWrite5m + before.cacheWrite1h);
  const row: UsageRow = {
    hour,
    account: state.account,
    project: state.project,
    model,
    session: state.session,
    agent: state.agent,
    input: after.input - before.input,
    output: after.output - before.output,
    cacheWrite: writes,
    cacheRead: after.cacheRead - before.cacheRead,
    costUSD: cost,
  };
  return {
    counted: { row, tokens: row.input + row.output + row.cacheWrite },
    remember: sample.messageId === undefined ? undefined : recentOf(sample.messageId, hour, model, after),
  };
}

function applySample(
  state: FileState,
  sample: UsageSample,
  memory: Map<string, RecentMessage>,
  context: ScanContext,
): void {
  if (state.project === '' && sample.cwd !== undefined) state.project = sample.cwd;
  const previous = sample.messageId === undefined ? undefined : memory.get(sample.messageId);
  const { counted, remember } = countSample(state, sample, previous);
  context.store.add(counted.row);
  context.onChange(state.account, sample.at, counted.tokens, counted.row.costUSD);
  if (remember === undefined) return;
  memory.delete(remember.id);
  memory.set(remember.id, remember);
  if (memory.size > RECENT_WHILE_READING) memory.delete(memory.keys().next().value as string);
}

/**
 * Indexes the lines written since `previous.offset`. A file whose inode, size or first bytes no longer match what the
 * index remembers has been replaced: nothing is counted and `replaced` is true.
 */
export async function scanTranscript(
  file: TranscriptFile,
  previous: FileState | undefined,
  context: ScanContext,
  verifyHead: boolean,
): Promise<ScanResult> {
  const state: FileState = previous === undefined ? newFileState(file) : { ...previous, recent: [...previous.recent] };
  const head =
    previous === undefined || verifyHead || previous.head === 0
      ? await headHash(file.path).catch(() => undefined)
      : previous.head;
  if (head === undefined) return { state, bytes: 0, replaced: false };
  if (
    previous !== undefined &&
    (file.ino !== previous.ino || file.size < previous.offset || (previous.head !== 0 && head !== previous.head))
  )
    return { state, bytes: 0, replaced: true };
  state.head = head;
  const tailer = new JsonlTailer(file.path, { startOffset: state.offset, maxBytesPerRead: READ_BYTES });
  const memory = new Map(state.recent.map((message) => [message.id, message]));
  for (;;) {
    const read = await tailer.read();
    if (read === undefined) break;
    if (read.reset) return { state, bytes: 0, replaced: true };
    for (let i = 0; i < read.lines.length; i++) {
      const line = read.lines[i] as string;
      if (file.source === 'codex') applyCodexLine(line, state, memory, context);
      else {
        const sample = parseUsageLine(line);
        if (sample !== undefined && sample.at >= context.floor) applySample(state, sample, memory, context);
      }
      if (i % LINES_PER_TURN === LINES_PER_TURN - 1) await context.yieldTurn();
    }
    if (tailer.atEnd || context.stopped()) break;
    await context.yieldTurn();
  }
  const bytes = tailer.position - state.offset;
  state.offset = tailer.position;
  state.mtimeMs = file.mtimeMs;
  state.ino = file.ino;
  state.recent = [...memory.values()].slice(-RECENT_PERSISTED);
  return { state, bytes, replaced: false };
}
