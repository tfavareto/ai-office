// Everything the HTTP handlers need, assembled by the app.
import type { Engine } from '../claude/engine';
import type { TranscriptCache } from '../claude/transcript';
import type { ServerConfig } from '../config';
import type { Logger } from '../log';
import type { DayRecorder } from '../office/day-recorder';
import type { Office } from '../office/office';
import type { AttentionRegistry } from '../registries/attention';
import type { MessageRegistry } from '../registries/messages';
import type { PermissionRegistry } from '../registries/permissions';
import type { ReportService } from '../report/service';
import type { UsageIndexer } from '../usage/indexer';
import type { RulesStore } from '../rules/rules-store';
import type { GitSettingsStore } from '../git/settings-store';
import type { GitWatcher } from '../git/watcher';
import type { HireService } from '../hire/service';
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
  hub: SseHub;
  snapshots: SnapshotPublisher;
  permissions: PermissionRegistry;
  rules: RulesStore;
  messages: MessageRegistry;
  attention: AttentionRegistry;
  hires: HireService;
  git: GitWatcher;
  gitSettings: GitSettingsStore;
  day: DayRecorder;
  usage: UsageIndexer;
  report: ReportService;
  transcripts: TranscriptCache;
  isDemo: () => boolean;
  setDemo: (on: boolean) => void;
}
