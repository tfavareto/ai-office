// Composition root: wires the office, registries, ingest engine, SSE hub and HTTP server together.
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoAnswer, createDemoSimulator, messageDraft, msg, sourceText } from '@ai-office/shared';
import { Engine } from './claude/engine';
import type { PidCheck } from './claude/registry';
import type { ApplyEffects } from './claude/transcript-state';
import { TranscriptCache } from './claude/transcript';
import type { ServerConfig } from './config';
import { TokenAuth } from './http/auth';
import type { AppContext } from './http/context';
import { resolveClaudeExecutable } from './hire/claude-path';
import { HIRE_LAUNCH_LIMIT, HIRE_LAUNCH_WINDOW_MS } from './hire/limits';
import { HireRegistry } from './hire/registry';
import { HireService } from './hire/service';
import { SystemTerminalLauncher, type TerminalLauncher } from './hire/terminals';
import { type HttpLimits, createHttpServer } from './http/server';
import { SseHub } from './http/sse';
import type { Logger } from './log';
import { DayRecorder, RECORD_INTERVAL_MS } from './office/day-recorder';
import { NameStore } from './office/name-store';
import { Office } from './office/office';
import { SnapshotPublisher } from './office/snapshot';
import { AttentionRegistry } from './registries/attention';
import { MessageRegistry } from './registries/messages';
import { PermissionRegistry } from './registries/permissions';
import { UsageIndexer } from './usage/indexer';
import { RulesStore } from './rules/rules-store';
import { asString } from './util/fs-safe';
import { newId } from './util/ids';
import { RateLimiter } from './util/rate-limit';

const TICK_MS = 250;
const SLOW_TICK_EVERY = 4;
const BUILD_CHECK_MS = 5000;

export interface AppOptions {
  now?: () => number;
  pidAlive?: PidCheck;
  /** Value of CLAUDE_CONFIG_DIR. */
  envDir?: string;
  /** Process environment (default: process.env); the PATH is used to find `claude`. */
  env?: NodeJS.ProcessEnv;
  version?: string;
  /** Overrides the HTTP request timeouts (tests). */
  httpLimits?: HttpLimits;
  /** Hiring agents: tests replace the launcher, so no terminal is ever opened. */
  hire?: {
    launcher?: TerminalLauncher;
    /** Absolute path of `claude`, or undefined when there is none. */
    resolveClaude?: () => string | undefined;
    /** Where private launcher folders are created. */
    tmpDir?: string;
  };
}

export interface App {
  context: AppContext;
  /** The underlying HTTP server (tests). */
  server: Server;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Port the server listens on (useful when started with port 0 in tests). */
  port(): number;
}

/** Directory with the built web app, relative to this module (works from src/ and from dist/). */
export function defaultWebDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
}

export async function readVersion(): Promise<string> {
  try {
    const text = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8');
    return asString((JSON.parse(text) as { version?: unknown }).version) ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** A permission request is stale once the session moved on after it was created. */
function movedOn(effects: ApplyEffects, toolName: string): boolean {
  return effects.promptSeen || effects.interrupted || effects.newAssistantMessage || effects.toolResults.some((result) => result.name === toolName);
}

export function createApp(config: ServerConfig, log: Logger, options: AppOptions = {}): App {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const version = options.version ?? '0.0.0';
  let demoOn = false;
  let build: string | undefined;

  const auth = new TokenAuth();
  const names = NameStore.forStateDir(config.stateDir, log);
  const day = new DayRecorder(config.stateDir, log);
  const indexer = new UsageIndexer({ stateDir: config.stateDir, accounts: () => engine.accountList(), log, now });
  const rules = new RulesStore(config.stateDir, log, now);

  // The registries and the office reference each other through callbacks; `office` is assigned before any call.
  const refresh = (): void => office.refresh(now());
  const attention = new AttentionRegistry(now, refresh);
  const permissions = new PermissionRegistry({
    now,
    resolveAgent: (sessionId, rawAgentId) => office.findAgent(sessionId, rawAgentId)?.id,
    onChange: refresh,
  });
  const messages = new MessageRegistry({
    now,
    onChange: refresh,
    onDelivered: (message) => void office.addExternalActivity(message.agentId, messageDraft(message.text)),
  });
  const hireRegistry = new HireRegistry({
    now,
    newId: () => `hire-${newId(6)}`,
    onChange: () => snapshots.markDirty(),
    onExpired: (hire) => {
      const message = msg('notice.hire.timeout', { project: hire.projectId.split('/').filter(Boolean).pop() ?? hire.projectId });
      hub.broadcastNotice({ id: `n-${newId(6)}`, at: now(), level: 'warn', text: sourceText(message), msg: message, projectId: hire.projectId });
    },
  });
  const hub: SseHub = new SseHub({ snapshot: () => snapshots.build(), backlog: () => office.recentFeed() });
  const office: Office = new Office({
    now,
    names,
    log,
    overlays: { permissionFor: (id) => permissions.pendingFor(id), attentionFor: (id) => attention.messageFor(id) },
    events: {
      onChange: () => snapshots.markDirty(),
      onFeed: (items) => hub.broadcastFeed(items),
      onNotice: (notice) => hub.broadcastNotice(notice),
      onAgentEvent: (agentId, effects, at) => {
        attention.clearIfEventAfter(agentId, at);
        const pending = permissions.pendingFor(agentId);
        if (pending !== undefined && at > pending.createdAt && movedOn(effects, pending.toolName)) permissions.cancelFor(agentId);
      },
    },
  });
  const snapshots: SnapshotPublisher = new SnapshotPublisher({
    office,
    usage: indexer,
    now,
    meta: () => ({ version, startedAt, demo: demoOn, ...(build !== undefined ? { build } : {}) }),
    hires: (time) => hireRegistry.list(time),
    emit: (snapshot) => hub.broadcastSnapshot(snapshot),
  });
  const engine: Engine = new Engine({
    discover: { homeDir: config.homeDir, explicitDirs: config.claudeDirs, envDir: options.envDir },
    office,
    log,
    now,
    ...(options.pidAlive !== undefined ? { pidAlive: options.pidAlive } : {}),
  });

  const setDemo = (on: boolean): void => {
    demoOn = on;
    office.setDemo(
      on
        ? createDemoSimulator({
            now,
            // Demo requests go through the same rules as real ones.
            autoDecide: (request, agent) =>
              autoAnswer(rules.book, {
                toolName: request.toolName,
                input: request.input,
                summary: request.summary,
                projectPath: agent.projectId,
                accountId: agent.accountId,
                agentId: agent.id,
                agentName: agent.name,
                demo: true,
              })?.decision,
          })
        : undefined,
    );
    refresh();
  };

  const env = options.env ?? process.env;
  const hires = new HireService({
    now,
    log,
    homeDir: config.homeDir,
    tmpDir: options.hire?.tmpDir ?? tmpdir(),
    accounts: () => engine.accountList(),
    realProjectIds: () => {
      const simulated = new Set((office.demoSimulator?.projects() ?? []).map((project) => project.id));
      return office.state().projects.filter((project) => !simulated.has(project.id)).map((project) => project.id);
    },
    demo: () => office.demoSimulator,
    registry: hireRegistry,
    launcher: options.hire?.launcher ?? new SystemTerminalLauncher({ platform: process.platform, env }),
    resolveClaude: options.hire?.resolveClaude ?? (() => resolveClaudeExecutable({ env, home: config.homeDir })),
    launchLimiter: new RateLimiter(HIRE_LAUNCH_LIMIT, HIRE_LAUNCH_WINDOW_MS, now),
    refresh,
  });

  const context: AppContext = {
    config,
    version,
    log,
    auth,
    now,
    office,
    engine,
    hub,
    snapshots,
    permissions,
    rules,
    messages,
    attention,
    hires,
    day,
    usage: indexer,
    transcripts: new TranscriptCache(),
    isDemo: () => demoOn,
    setDemo,
  };
  const http = createHttpServer(context, undefined, options.httpLimits);
  let ticker: NodeJS.Timeout | undefined;
  let buildTimer: NodeJS.Timeout | undefined;
  let ticks = 0;
  let lastDayRecord = 0;

  const tick = (): void => {
    const time = now();
    office.tickDemo(time);
    office.refresh(time);
    if (++ticks % SLOW_TICK_EVERY !== 0) return;
    permissions.sweep();
    messages.expire();
    hireRegistry.sweep(office.state().agents, time);
    if (time - lastDayRecord >= RECORD_INTERVAL_MS) {
      lastDayRecord = time;
      void day.record(office.state().agents.filter((agent) => agent.demo !== true), time).catch((error: unknown) => log.debug(`Meu dia: ${String(error)}`));
    }
  };

  const refreshBuild = async (): Promise<void> => {
    const id = await http.statics.buildId();
    if (id === build) return;
    build = id;
    snapshots.markDirty();
  };

  return {
    context,
    server: http.server,
    port: () => {
      const address = http.server.address();
      return typeof address === 'object' && address !== null ? address.port : config.port;
    },
    async start() {
      // Creates the state dir (0700) and the access token (0600) before anything is served.
      await auth.load(config.stateDir);
      await names.load();
      await rules.load();
      setDemo(config.demo);
      await refreshBuild();
      await new Promise<void>((resolveListen, rejectListen) => {
        http.server.once('error', (error: NodeJS.ErrnoException) => {
          rejectListen(error.code === 'EADDRINUSE' ? new Error(`A porta ${config.port} já está em uso. Use AI_OFFICE_PORT ou --port.`) : error);
        });
        http.server.listen(config.port, config.host, resolveListen);
      });
      await engine.start();
      await indexer.start();
      ticker = setInterval(tick, TICK_MS);
      buildTimer = setInterval(() => void refreshBuild(), BUILD_CHECK_MS);
      log.info(`AI Office em http://${config.host}:${this.port()}`);
    },
    async stop() {
      if (ticker !== undefined) clearInterval(ticker);
      if (buildTimer !== undefined) clearInterval(buildTimer);
      engine.stop();
      await indexer.stop();
      snapshots.stop();
      hub.closeAll();
      await new Promise<void>((resolveClose) => {
        http.server.close(() => resolveClose());
        http.server.closeAllConnections();
      });
      await Promise.all([day.flush(), names.flush(), rules.flush()]);
    },
  };
}
