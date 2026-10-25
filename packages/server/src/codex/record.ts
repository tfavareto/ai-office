// Reads the envelope of one Codex rollout line: `{ "timestamp": ISO, "type": ..., "payload": {...} }`. Everything that is
// not a JSON object with a known time is dropped; unknown record types are the caller's business.
import { asRecord, asString } from '../util/fs-safe';

export interface RolloutRecord {
  type: string;
  /** Epoch ms of the record. */
  at: number;
  payload: Record<string, unknown>;
}

/** Longest line parsed. The tailer already caps lines; this keeps one huge record from costing a full JSON parse. */
export const MAX_RECORD_CHARS = 6 * 1024 * 1024;

/** Record types that carry nothing the office shows: skipped before any JSON work. */
const SKIPPED_TYPES: ReadonlySet<string> = new Set(['token_usage_record', 'world_state']);
const HEAD = /^\{"timestamp":"([^"]{10,40})","type":"([a-z_]+)"/;

/** The record, or undefined for blank, malformed, oversized, untimed or skippable lines. Never throws. */
export function readRecord(raw: string): RolloutRecord | undefined {
  if (raw.length === 0 || raw.length > MAX_RECORD_CHARS || raw.charCodeAt(0) !== 0x7b) return undefined;
  const head = HEAD.exec(raw.slice(0, 120));
  if (head?.[2] !== undefined && SKIPPED_TYPES.has(head[2])) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const line = asRecord(value);
  const type = asString(line.type);
  const at = Date.parse(asString(line.timestamp) ?? '');
  if (type === undefined || !Number.isFinite(at)) return undefined;
  return { type, at, payload: asRecord(line.payload) };
}
