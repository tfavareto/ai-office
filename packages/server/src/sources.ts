// The line parsers of the supported CLIs: one function per transcript file turns raw lines into the office's events.
import type { AgentSource } from '@ai-office/shared';
import { readFirstRecord } from './codex/rollouts';
import { RolloutTranslator } from './codex/translate';
import { parseLine } from './claude/line-parser';
import type { LineParser } from './claude/types';

/** Parser for Claude Code transcripts: one event per line, no memory between lines. */
export const parseClaudeLine: LineParser = (raw) => {
  const line = parseLine(raw);
  return line === undefined ? [] : [line];
};

/** A fresh parser for a Codex rollout (it must see the file in order, and remembers open tool calls). */
export function codexParser(): LineParser {
  const translator = new RolloutTranslator();
  return (raw) => translator.translate(raw);
}

/**
 * A fresh parser for a file of the given source. A Codex parser started in the middle of a file does not know the
 * folder yet, so it is first fed the session_meta line (its events are dropped here; the line is read again if the
 * parser does start at the top, which changes nothing).
 */
export async function parserFor(source: AgentSource | undefined, path: string): Promise<LineParser> {
  if (source !== 'codex') return parseClaudeLine;
  const parser = codexParser();
  const first = await readFirstRecord(path);
  if (first !== undefined) parser(first);
  return parser;
}
