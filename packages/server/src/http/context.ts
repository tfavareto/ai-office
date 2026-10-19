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
import type { SseHub } from './sse';
import type { SnapshotPublisher } from '../office/snapshot';

export interface AppContext {
  config: ServerConfig;
  version: string;
  log: Logger;
  now: () => number;
  office: Office;
  engine: Engine;
  hub: SseHub;
  snapshots: SnapshotPublisher;
  permissions: PermissionRegistry;
  messages: MessageRegistry;
  attention: AttentionRegistry;
  day: DayRecorder;
  transcripts: TranscriptCache;
  isDemo: () => boolean;
  setDemo: (on: boolean) => void;
}
