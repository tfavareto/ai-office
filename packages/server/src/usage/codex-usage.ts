// Usage of a Codex rollout: the `token_count` events carry the running totals of the whole thread, so the usage of a
// moment is the growth of the total since the previous event. The total (and the model it was last priced with) is kept
// in the file's `recent` list under a fixed id, so a scan that resumes in the middle of the file picks up where it was.
import type { UsageRow } from '@ai-office/shared';
import { mergeUsage, usageCostUSD } from '../claude/cost';
import type { UsageInfo } from '../claude/types';
import { readRecord } from '../codex/record';
import { usageOf } from '../codex/translate';
import { asRecord, asString } from '../util/fs-safe';
import type { FileState, RecentMessage } from './index-file';
import type { ScanContext } from './scan-file';

export const CODEX_TOTAL_ID = 'codex-session-total';
const HOUR_MS = 3_600_000;
/** Only these records can matter: everything else is skipped without parsing it. */
const MARKS = ['"token_count"', '"turn_context"', '"session_meta"'];
const UNKNOWN_MODEL = 'codex';
const ZERO: UsageInfo = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

function totalOf(message: RecentMessage | undefined): UsageInfo {
  return message === undefined
    ? ZERO
    : {
        input: message.input,
        output: message.output,
        cacheWrite5m: message.cacheWrite5m,
        cacheWrite1h: message.cacheWrite1h,
        cacheRead: message.cacheRead,
      };
}

function remembered(model: string, total: UsageInfo): RecentMessage {
  return { id: CODEX_TOTAL_ID, hour: 0, model, ...total };
}

function difference(after: UsageInfo, before: UsageInfo): UsageInfo {
  return {
    input: after.input - before.input,
    output: after.output - before.output,
    cacheWrite5m: after.cacheWrite5m - before.cacheWrite5m,
    cacheWrite1h: after.cacheWrite1h - before.cacheWrite1h,
    cacheRead: after.cacheRead - before.cacheRead,
  };
}

const isEmpty = (usage: UsageInfo): boolean =>
  usage.input + usage.output + usage.cacheWrite5m + usage.cacheWrite1h + usage.cacheRead <= 0;

/** Reads one rollout line into the index. */
export function applyCodexLine(
  raw: string,
  state: FileState,
  memory: Map<string, RecentMessage>,
  context: ScanContext,
): void {
  if (!MARKS.some((mark) => raw.includes(mark))) return;
  const record = readRecord(raw);
  if (record === undefined) return;
  const previous = memory.get(CODEX_TOTAL_ID);
  const { payload } = record;
  if (record.type === 'session_meta' || record.type === 'turn_context') {
    const cwd = asString(payload.cwd);
    if (state.project === '' && cwd !== undefined) state.project = cwd;
    const model = asString(payload.model);
    if (model !== undefined) memory.set(CODEX_TOTAL_ID, remembered(model, totalOf(previous)));
    return;
  }
  if (record.type !== 'event_msg' || payload.type !== 'token_count') return;
  const total = usageOf(asRecord(asRecord(payload.info).total_token_usage));
  if (total === undefined) return;
  const before = totalOf(previous);
  const merged = mergeUsage(before, total);
  const model = previous?.model ?? UNKNOWN_MODEL;
  memory.set(CODEX_TOTAL_ID, remembered(model, merged));
  const delta = difference(merged, before);
  if (record.at < context.floor || isEmpty(delta)) return;
  const row: UsageRow = {
    hour: Math.floor(record.at / HOUR_MS) * HOUR_MS,
    account: state.account,
    project: state.project,
    model,
    session: state.session,
    agent: state.agent,
    input: delta.input,
    output: delta.output,
    cacheWrite: delta.cacheWrite5m + delta.cacheWrite1h,
    cacheRead: delta.cacheRead,
    costUSD: usageCostUSD(model, delta) ?? 0,
  };
  context.store.add(row);
  context.onChange(state.account, record.at, row.input + row.output + row.cacheWrite, row.costUSD);
}
