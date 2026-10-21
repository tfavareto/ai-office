// Reads the slice of one transcript that belongs to a local day. Seeks close to the start of the day with a binary
// search over line timestamps (big files are not read from the top), stops at the end of the day, resumes where a
// previous read stopped, and hands the event loop back between slices.
import { type FileHandle, open } from 'node:fs/promises';
import { JsonlTailer } from '../claude/jsonl-tailer';
import { parseLine } from '../claude/line-parser';
import { asRecord, asString } from '../util/fs-safe';
import { TraceRecorder } from '../timelapse/recorder';
import { type DayWindow, FileDayAccumulator, type FileRole } from './accumulator';

const SLICE_BYTES = 1024 * 1024;
const LINES_PER_TURN = 200;
/** The binary search stops when the bracket is this small; the lines between are simply read and filtered. */
const SEEK_PRECISION_BYTES = 64 * 1024;
const PROBE_CHUNK_BYTES = 64 * 1024;
const PROBE_MAX_LINE_BYTES = 4 * 1024 * 1024;
const PROBE_MAX_LINES = 8;

export interface FileStamp {
  size: number;
  mtimeMs: number;
  ino: number;
}

/** Where a read of one file stands: enough to continue when the file grows. */
export interface ReadState extends FileStamp {
  /** Bytes consumed, always the end of a complete line. */
  offset: number;
  /** A line at or after the end of the day was reached: appending to the file changes nothing. */
  done: boolean;
  /** Stopped at the byte budget: the numbers cover only part of the day. */
  truncated: boolean;
  acc: FileDayAccumulator;
  /** The moments of the day (time-lapse), kept up to date alongside `acc` once someone asked for them. */
  trace?: TraceRecorder;
}

export interface ReadBudget {
  /** Most bytes read from one file for one day. */
  maxBytes: number;
  /** Epoch ms after which no more file is read. */
  deadline: number;
  now: () => number;
  yieldTurn: () => Promise<void>;
}

// ---- seeking ----------------------------------------------------------------------------------------------------

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** The end of the line that contains or follows `from` (index of its newline), or -1 at the end of the file. */
async function newlineFrom(handle: FileHandle, from: number, size: number): Promise<number> {
  let position = from;
  while (position < size) {
    const chunk = await readAt(handle, position, Math.min(PROBE_CHUNK_BYTES, size - position));
    if (chunk.length === 0) return -1;
    const index = chunk.indexOf(0x0a);
    if (index >= 0) return position + index;
    position += chunk.length;
  }
  return -1;
}

function timestampOf(text: string): number | undefined {
  try {
    const at = Date.parse(asString(asRecord(JSON.parse(text)).timestamp) ?? '');
    return Number.isFinite(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

/** Timestamp of the first line that starts after `offset` (or at 0 when `offset` is 0), with where it starts. */
async function probe(
  handle: FileHandle,
  offset: number,
  size: number,
): Promise<{ at: number; lineStart: number } | undefined> {
  let lineStart = offset;
  if (offset > 0) {
    const newline = await newlineFrom(handle, offset, size);
    if (newline < 0) return undefined;
    lineStart = newline + 1;
  }
  for (let i = 0; i < PROBE_MAX_LINES && lineStart < size; i++) {
    const end = await newlineFrom(handle, lineStart, size);
    const lineEnd = end < 0 ? size : end;
    if (lineEnd - lineStart <= PROBE_MAX_LINE_BYTES) {
      const at = timestampOf((await readAt(handle, lineStart, lineEnd - lineStart)).toString('utf8'));
      if (at !== undefined) return { at, lineStart };
    }
    if (end < 0) return undefined;
    lineStart = end + 1;
  }
  return undefined;
}

/**
 * A byte offset, at the start of a line, from which every line of the day is still ahead (lines before the day may
 * follow it), and whether the file itself began during the day.
 */
export async function seekDayStart(
  path: string,
  size: number,
  window: DayWindow,
): Promise<{ offset: number; startedInDay: boolean }> {
  const handle = await open(path, 'r');
  try {
    const first = await probe(handle, 0, size);
    if (first === undefined) return { offset: 0, startedInDay: false };
    if (first.at >= window.start) return { offset: 0, startedInDay: true };
    let low = 0;
    let high = size;
    while (high - low > SEEK_PRECISION_BYTES) {
      const middle = Math.floor((low + high) / 2);
      const found = await probe(handle, middle, size);
      if (found === undefined || found.at >= window.start) high = middle;
      else low = found.lineStart;
    }
    return { offset: low, startedInDay: false };
  } finally {
    await handle.close();
  }
}

// ---- reading ----------------------------------------------------------------------------------------------------

/** The earlier state still describes this file (same file, only appended to). */
export function isResumable(previous: ReadState, stamp: FileStamp): boolean {
  return previous.ino === stamp.ino && stamp.size >= previous.offset;
}

export interface ReadOptions {
  /** Also record the moments of the day. A cached read without them is read again from the start of the day. */
  trace?: boolean;
}

/**
 * Brings the accumulator of one file up to date for the day. `previous` is resumed when the file only grew (and, when
 * the moments are wanted, already has them); otherwise the file is read again from the start of the day.
 */
export async function readFileDay(
  path: string,
  stamp: FileStamp,
  window: DayWindow,
  role: FileRole,
  previous: ReadState | undefined,
  budget: ReadBudget,
  options: ReadOptions = {},
): Promise<ReadState> {
  const resume =
    previous !== undefined && isResumable(previous, stamp) && (options.trace !== true || previous.trace !== undefined)
      ? previous
      : undefined;
  if (resume !== undefined && (resume.done || (resume.size === stamp.size && !resume.truncated)))
    return { ...resume, ...stamp };
  let acc = resume?.acc;
  let trace = resume?.trace;
  let startOffset = resume?.offset ?? 0;
  if (acc === undefined) {
    const seek = await seekDayStart(path, stamp.size, window);
    acc = new FileDayAccumulator(window, role, seek.startedInDay);
    trace = options.trace === true ? new TraceRecorder(window, role === 'sub') : undefined;
    startOffset = seek.offset;
  }
  const tailer = new JsonlTailer(path, { startOffset, maxBytesPerRead: SLICE_BYTES });
  let done = false;
  let truncated = false;
  while (!done) {
    const read = await tailer.read();
    if (read === undefined || read.reset) break;
    for (let i = 0; i < read.lines.length && !done; i++) {
      const line = parseLine(read.lines[i] as string);
      if (line !== undefined && 'at' in line && line.at >= window.end) done = true;
      else if (line !== undefined) {
        acc.ingest(line);
        trace?.ingest(line);
      }
      if (i % LINES_PER_TURN === LINES_PER_TURN - 1) await budget.yieldTurn();
    }
    if (tailer.atEnd || done) break;
    if (tailer.position - startOffset >= budget.maxBytes || budget.now() >= budget.deadline) {
      truncated = true;
      break;
    }
    await budget.yieldTurn();
  }
  return { ...stamp, offset: tailer.position, done, truncated, acc, ...(trace !== undefined ? { trace } : {}) };
}
