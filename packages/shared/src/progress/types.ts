// Contract of "an office that grows": lifetime counters, the office level, achievements and unlockable decoration.
// The server derives it from the day reports and persists it in `<state dir>/progress.json`; the page draws it.
// Dates are local calendar days (YYYY-MM-DD); every timestamp is epoch milliseconds.

export const PROGRESS_VERSION = 1;

/** Things that appear in the office once the level that unlocks them is reached. */
export type DecorId =
  | 'wallArt'
  | 'employeePlaque'
  | 'aquarium'
  | 'trophyCabinet'
  | 'pet'
  | 'neonSign'
  | 'arcade'
  | 'stringLights'
  | 'goldFinish';

export type AchievementId =
  | 'firstSession'
  | 'sessions50'
  | 'firstCommit'
  | 'commits100'
  | 'firstTestPass'
  | 'tests100'
  | 'tasks10'
  | 'tasks100'
  | 'tasks1000'
  | 'streak7'
  | 'streak30'
  | 'days30'
  | 'hours100'
  | 'tokens10m'
  | 'tokens1b'
  | 'nightOwl'
  | 'earlyBird'
  | 'weekend'
  | 'team5'
  | 'subagents10'
  | 'timelapse'
  | 'share';

export type AchievementTier = 'bronze' | 'silver' | 'gold';

/** Things only the page can tell the server it did (the first time counts). */
export type ProgressEventName = 'timelapse' | 'share';
export const PROGRESS_EVENTS: readonly ProgressEventName[] = ['timelapse', 'share'];

/** One agent's share of a day's completed tasks. The project is the folder's name, never its path. */
export interface DayWorker {
  name: string;
  project: string;
  tasks: number;
}

/** What one finished local day contributes. Replacing a day's facts replaces its contribution: processing is idempotent. */
export interface DayFacts {
  date: string;
  sessions: number;
  activeMs: number;
  tasks: number;
  commits: number;
  testsPassed: number;
  tokens: number;
  subagents: number;
  /** Most sessions with activity in the same half hour. */
  peakAgents: number;
  /** Activity between 00:00 and 05:00. */
  night: boolean;
  /** Activity between 05:00 and 07:00. */
  early: boolean;
  /** The agents that completed tasks, most tasks first (at most {@link MAX_DAY_WORKERS}). */
  workers: DayWorker[];
}

export const MAX_DAY_WORKERS = 6;

/** The sums of every day plus the high-water marks; the numbers achievements are measured by. */
export interface Cumulative {
  sessions: number;
  activeHours: number;
  tasks: number;
  commits: number;
  testsPassed: number;
  tokens: number;
  subagents: number;
  daysActive: number;
  bestStreak: number;
  peakAgents: number;
  /** Most subagents in one day. */
  peakSubagents: number;
  nightDays: number;
  earlyDays: number;
  weekendDays: number;
  timelapseSeen: number;
  shareSeen: number;
}

export type CumulativeKey = keyof Cumulative;

export interface AchievementDef {
  id: AchievementId;
  metric: CumulativeKey;
  target: number;
  tier: AchievementTier;
}

export interface LevelInfo {
  level: number;
  xp: number;
  /** XP at which this level began. */
  from: number;
  /** XP of the next level; null at the last level. */
  to: number | null;
}

export interface AchievementState {
  id: AchievementId;
  tier: AchievementTier;
  /** Epoch ms of the unlock; absent while locked. */
  unlockedAt?: number;
  /** Where the metric stands and where it unlocks (locked ones show the progress). */
  value: number;
  target: number;
}

export interface EmployeeOfTheMonth {
  name: string;
  tasks: number;
  /** Only when the page asked for it (`?project=1`). */
  project?: string;
}

export interface ProgressStats {
  sessions: number;
  activeMs: number;
  tasks: number;
  commits: number;
  testsPassed: number;
  tokens: number;
  subagents: number;
  daysActive: number;
  currentStreak: number;
  bestStreak: number;
  peakAgents: number;
}

/** `GET /api/progress`. */
export interface Progress {
  level: LevelInfo;
  stats: ProgressStats;
  achievements: AchievementState[];
  employee?: EmployeeOfTheMonth;
  /** The first day counted, YYYY-MM-DD; absent while nothing has been counted. */
  since?: string;
  /** The history is still being read: the numbers can only grow. */
  counting?: boolean;
  demo?: boolean;
}

export interface RecentUnlock {
  id: AchievementId;
  at: number;
}

/** What the snapshot carries: enough to draw the decoration and to announce a level or an unlock. */
export interface ProgressSummary {
  level: number;
  xp: number;
  /** XP where the level began and where the next begins (null at the last level). */
  from: number;
  to: number | null;
  achievements: number;
  total: number;
  /** The latest unlocks, newest first (at most {@link MAX_RECENT_UNLOCKS}). */
  recent: RecentUnlock[];
  /** Agent name only: the project is never in the snapshot. */
  employee?: string;
  demo?: boolean;
}

export const MAX_RECENT_UNLOCKS = 4;
