// Everything the HTTP handlers need, assembled by the app.
import type { NoteStore } from '../notes/service';
import type { RoutineService } from '../routines/service';
import type { ResumableSession } from '../terminal/resume';
import type { TerminalService } from '../terminal/service';
import type { TerminalSettingsStore } from '../terminal/settings-store';
import type { TerminalStreams } from '../terminal/stream';
import type { Runner } from '../git/run';
import type { Engine } from '../claude/engine';
import type { CodexEngine } from '../codex/engine';
import type { CodexSettingsStore } from '../codex/settings-store';
import type { Account } from '@ai-office/shared';
import type { TranscriptCache } from '../claude/transcript';
import type { ServerConfig } from '../config';
import type { Logger } from '../log';
import type { CustomizationStore } from '../customization/store';
import type { DayRecorder } from '../office/day-recorder';
import type { Office } from '../office/office';
import type { AttentionRegistry } from '../registries/attention';
import type { MessageRegistry } from '../registries/messages';
import type { PermissionRegistry } from '../registries/permissions';
import type { Progress } from '@ai-office/shared';
import type { ProgressService } from '../progress/service';
import type { ReportService } from '../report/service';
import type { UsageIndexer } from '../usage/indexer';
import type { RulesStore } from '../rules/rules-store';
import type { GitSettingsStore } from '../git/settings-store';
import type { GitWatcher } from '../git/watcher';
import type { HireService } from '../hire/service';
import type { TeamService } from '../team/service';
import type { VoiceModelStore } from '../voice/model-store';
import type { TokenAuth } from './auth';
import type { SseHub } from './sse';
import type { SnapshotPublisher } from '../office/snapshot';

export interface AppContext {
  config: ServerConfig;
  version: string;
  log: Logger;
  auth: TokenAuth;
  now: () => number;
  office: Office;
  engine: Engine;
  codex: CodexEngine;
  codexSettings: CodexSettingsStore;
  /** Every account whose sessions the office reads: Claude Code configuration dirs and Codex homes. */
  sourceAccounts: () => Account[];
  hub: SseHub;
  snapshots: SnapshotPublisher;
  permissions: PermissionRegistry;
  rules: RulesStore;
  customization: CustomizationStore;
  messages: MessageRegistry;
  attention: AttentionRegistry;
  hires: HireService;
  terminals: TerminalService;
  routines: RoutineService;
  notes: NoteStore;
  /** Real terminals open when the office last stopped, not brought back yet. */
  resumable: () => readonly ResumableSession[];
  dismissResumable: (sessionId: string | undefined) => void;
  terminalSettings: TerminalSettingsStore;
  terminalStreams: TerminalStreams;
  team: TeamService;
  voice: VoiceModelStore;
  git: GitWatcher;
  /** Starts `git` on the user's repositories, under the same cap as the watcher. */
  runGit: Runner;
  /** Starts `gh` and pushes, with the person's own environment: their logins are needed there. */
  runGh: Runner;
  gitSettings: GitSettingsStore;
  day: DayRecorder;
  usage: UsageIndexer;
  progress: ProgressService;
  /** The progress the page sees: the demo's while demo mode is on, else the real one. */
  progressView: (includeProject: boolean) => Progress;
  report: ReportService;
  transcripts: TranscriptCache;
  isDemo: () => boolean;
  setDemo: (on: boolean) => void;
}
