// Contract of the day report: what each agent did on one local day, built by the server from the transcripts and the
// usage index. No message bodies: the optional `requests` (first lines of the user's prompts) are only sent on request.
// Every timestamp is epoch milliseconds.

/** The day picker offers today and the six days before it. */
export const REPORT_DAYS = 7;
/** Activity buckets per day (30 minutes each; a 25-hour day folds its last hour into the final bucket). */
export const REPORT_BUCKETS = 48;
export const REPORT_BUCKET_MS = 30 * 60_000;

/** Tool calls are grouped by the kind the office already uses for activities. */
export type ReportToolKind =
  'read' | 'search' | 'edit' | 'write' | 'bash' | 'web' | 'task' | 'subagent' | 'mcp' | 'question' | 'other';

export const REPORT_TOOL_KINDS: readonly ReportToolKind[] = [
  'read',
  'search',
  'edit',
  'write',
  'bash',
  'web',
  'task',
  'subagent',
  'mcp',
  'question',
  'other',
];

export interface ReportFileChange {
  /** Relative to the project folder when inside it, absolute otherwise. */
  path: string;
  /** Successful Edit / Write / MultiEdit / NotebookEdit calls on the file. */
  edits: number;
  added: number;
  removed: number;
}

export interface ReportCommand {
  /** First line, secrets masked, at most 160 characters. */
  command: string;
  runs: number;
}

export type ReportTestOutcome = 'passed' | 'failed' | 'unknown';

export interface ReportTestRun {
  /** "vitest", "pytest", "npm test"... */
  runner: string;
  at: number;
  outcome: ReportTestOutcome;
  passed?: number;
  failed?: number;
}

export interface ReportCommit {
  /** Abbreviated or full hash as Git printed it. */
  hash: string;
  subject: string;
  branch?: string;
  at: number;
  /** `transcript`: seen in a `git commit` tool call. `git`: filled from the Git integration. */
  source: 'transcript' | 'git';
}

export interface ReportTask {
  title: string;
  at: number;
}

export interface ReportUsage {
  /** Input + output + cache writes (cache reads are not counted), like the usage cards. */
  tokens: number;
  /** Estimated with public list prices. */
  costUSD: number;
}

export interface ReportAgent {
  /** Office agent id of the session (`<account>:<session>`). */
  agentId: string;
  accountId: string;
  sessionId: string;
  name: string;
  firstAt: number;
  lastAt: number;
  /** Time with the agent at work: gaps between events up to a few minutes count, longer pauses do not. */
  activeMs: number;
  /** Time per status recorded by the office while it was running; absent when it was not. */
  statusMs?: { working: number; waiting: number; idle: number };
  prompts: number;
  /** First line of each user prompt, truncated. Only present when the caller asked for it. */
  requests?: string[];
  toolCalls: Partial<Record<ReportToolKind, number>>;
  files: ReportFileChange[];
  commands: ReportCommand[];
  tests: ReportTestRun[];
  commits: ReportCommit[];
  tasks: ReportTask[];
  subagents: { count: number; types: string[] };
  usage: ReportUsage;
  /** Active milliseconds in each half hour of the day ({@link REPORT_BUCKETS} values). */
  activity: number[];
}

export interface ReportProject {
  /** The working directory. */
  id: string;
  name: string;
  agents: ReportAgent[];
  /** Commits from the Git integration (merged with the ones seen in transcripts by hash). */
  gitCommits?: ReportCommit[];
}

export interface DayReport {
  /** Local date, YYYY-MM-DD. */
  date: string;
  generatedAt: number;
  /** An account id or "all". */
  account: string;
  includeRequests: boolean;
  projects: ReportProject[];
  /** The scan hit a time or size limit: numbers may be incomplete. */
  truncated?: boolean;
  /** Tokens and cost come from the usage index, which was still building when the report was made. */
  usageIndexing?: boolean;
  demo?: boolean;
}

export interface ReportTotals {
  agents: number;
  activeMs: number;
  prompts: number;
  toolCalls: number;
  files: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  testsPassed: number;
  testsFailed: number;
  testsUnknown: number;
  tasks: number;
  subagents: number;
  tokens: number;
  costUSD: number;
}
