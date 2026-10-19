import type { LineMeta, ParsedLine, UsageInfo } from './types';
export declare function parseUsage(value: unknown): UsageInfo | undefined;
/** Flattens a tool_result content (string or blocks) to text. */
export declare function flattenContent(content: unknown): string;
/** Parses the `<task-notification>` block Claude Code injects when a background task ends. */
export declare function parseNotificationText(text: string, meta: LineMeta): ParsedLine | undefined;
/** Parses one raw JSONL line. Returns undefined for lines that are not relevant or not valid JSON. */
export declare function parseLine(raw: string): ParsedLine | undefined;
