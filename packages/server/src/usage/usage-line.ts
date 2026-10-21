// Extracts the usage record of one transcript line: numbers, model, message id and working directory, never text.
import { parseUsage } from '../claude/line-parser';
import type { UsageInfo } from '../claude/types';
import { asRecord, asString } from '../util/fs-safe';

export interface UsageSample {
  /** Epoch ms of the line. */
  at: number;
  /** Claude Code writes one line per content block of a message; they all carry the same message id. */
  messageId: string | undefined;
  model: string;
  usage: UsageInfo;
  cwd: string | undefined;
}

const TYPE_MARK = '"type":"assistant"';
const USAGE_MARK = '"usage"';

/** The usage of an assistant line, or undefined for any other line, for synthetic messages and for bad JSON. */
export function parseUsageLine(raw: string): UsageSample | undefined {
  if (!raw.includes(USAGE_MARK) || !raw.includes(TYPE_MARK)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const line = asRecord(value);
  if (line.type !== 'assistant') return undefined;
  const at = Date.parse(asString(line.timestamp) ?? '');
  if (!Number.isFinite(at)) return undefined;
  const message = asRecord(line.message);
  const model = asString(message.model);
  if (model === undefined || model.startsWith('<')) return undefined;
  const usage = parseUsage(message.usage);
  if (usage === undefined) return undefined;
  return { at, messageId: asString(message.id), model, usage, cwd: asString(line.cwd) };
}
