// Hiring an agent: validates the request, opens a terminal window running Claude Code in the project folder and
// registers the pending hire the office draws as a placeholder. Demo mode simulates the hire instead of opening anything.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Account,
  type DemoSimulator,
  type HireCheckResponse,
  type HireErrorCode,
  type HireRequest,
  type PendingHire,
} from '@ai-office/shared';
import { accountsFromDirs } from '../claude/accounts';
import { HttpError } from '../http/respond';
import type { Logger } from '../log';
import type { RateLimiter } from '../util/rate-limit';
import { UnquotableError, buildLauncherScript } from './command';
import { type FolderCheck, checkFolder, normalizeFolderInput } from './folder';
import type { HireRegistry } from './registry';
import { LaunchError, type TerminalLauncher } from './terminals';

/** A launcher nobody ran (the terminal never started it) is removed after this long. */
export const LAUNCHER_LIFETIME_MS = 10 * 60_000;
export const LAUNCHER_FILE = 'launch.sh';

export interface HireServiceDeps {
  now: () => number;
  log: Logger;
  homeDir: string;
  /** Where private launcher directories are created (the system temp dir). */
  tmpDir: string;
  /** Real Claude Code accounts discovered on this computer. */
  accounts: () => Account[];
  /** Ids of the rooms that hold real sessions. */
  realProjectIds: () => readonly string[];
  /** The demo simulator, when demo mode is on. */
  demo: () => DemoSimulator | undefined;
  registry: HireRegistry;
  launcher: TerminalLauncher;
  /** Absolute path of the `claude` executable, if there is one. */
  resolveClaude: () => string | undefined;
  /** Allows at most a few launches per minute. */
  launchLimiter: RateLimiter;
  /** Recomputes the office state, so a simulated hire shows up in the next snapshot. */
  refresh: () => void;
}

function fail(status: number, code: HireErrorCode): never {
  throw new HttpError(status, code);
}

function folderFailure(check: Extract<FolderCheck, { ok: false }>): never {
  switch (check.reason) {
    case 'not-absolute':
      return fail(400, 'invalid-projectPath');
    case 'not-found':
      return fail(404, 'project-not-found');
    case 'not-directory':
      return fail(400, 'project-not-directory');
    case 'not-readable':
      return fail(403, 'project-not-readable');
  }
}

const LAUNCH_STATUS: Record<LaunchError['code'], number> = {
  'no-terminal': 503,
  'terminal-failed': 502,
  'unsupported-platform': 501,
};

export class HireService {
  constructor(private readonly deps: HireServiceDeps) {}

  /** Can this folder host a new agent? (Feedback for the path field; demo rooms are always fine.) */
  async check(path: string): Promise<HireCheckResponse> {
    const normalized = normalizeFolderInput(path, this.deps.homeDir);
    if (normalized === undefined) return { ok: false, reason: 'not-absolute' };
    if (this.simulates(normalized)) return { ok: true };
    const result = await checkFolder(normalized, this.deps.homeDir);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  /** Demo mode simulates hires everywhere except in rooms that hold real sessions. */
  private simulates(path: string): boolean {
    return this.deps.demo() !== undefined && !this.deps.realProjectIds().includes(path);
  }

  async hire(request: HireRequest): Promise<PendingHire> {
    const demo = this.deps.demo();
    const requested = normalizeFolderInput(request.projectPath, this.deps.homeDir);
    if (requested === undefined) return fail(400, 'invalid-projectPath');
    if (demo !== undefined && this.simulates(requested)) return this.hireDemo(demo, requested, request);
    const folder = await checkFolder(requested, this.deps.homeDir);
    if (!folder.ok) return folderFailure(folder);
    const account = this.accountFor(request.accountId);
    const claudePath = this.deps.resolveClaude();
    if (claudePath === undefined) return fail(503, 'claude-not-found');
    if (!this.deps.launchLimiter.tryAcquire()) return fail(429, 'rate-limited');
    await this.launch({
      request,
      claudePath,
      projectPath: folder.path,
      configDir: account.isDefault === true ? undefined : account.dir,
    });
    const rooms = this.deps.realProjectIds();
    const projectId = rooms.find((id) => id === folder.path || id === folder.realPath) ?? folder.realPath;
    return this.deps.registry.create({
      projectId,
      accountId: account.id,
      deskIndex: request.deskIndex,
      matchPaths: [folder.path, folder.realPath, projectId],
    });
  }

  private hireDemo(demo: DemoSimulator, path: string, request: HireRequest): PendingHire {
    if (!this.deps.launchLimiter.tryAcquire()) return fail(429, 'rate-limited');
    const hire = demo.hire({
      project: path,
      now: this.deps.now(),
      ...(request.accountId !== undefined ? { accountId: request.accountId } : {}),
      ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
      ...(request.deskIndex !== undefined ? { deskIndex: request.deskIndex } : {}),
    });
    this.deps.refresh();
    return hire;
  }

  /** The requested account; without a request, the default one (a computer that never ran Claude Code has none yet). */
  private accountFor(requested: string | undefined): Account {
    const accounts = this.deps.accounts();
    if (requested !== undefined)
      return accounts.find((account) => account.id === requested) ?? fail(400, 'unknown-account');
    const fallback = accountsFromDirs([join(this.deps.homeDir, '.claude')], this.deps.homeDir)[0] as Account;
    return accounts.find((account) => account.isDefault === true) ?? accounts[0] ?? fallback;
  }

  private async launch(input: {
    request: HireRequest;
    claudePath: string;
    projectPath: string;
    configDir: string | undefined;
  }): Promise<void> {
    const workDir = await mkdtemp(join(this.deps.tmpDir, 'ai-office-hire-'));
    const { request } = input;
    try {
      const script = buildLauncherScript({
        projectPath: input.projectPath,
        claudePath: input.claudePath,
        configDir: input.configDir,
        prompt: request.prompt,
        model: request.model,
        permissionMode: request.permissionMode,
        locale: request.locale ?? 'pt-BR',
        workDir,
      });
      const scriptPath = join(workDir, LAUNCHER_FILE);
      await writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o600 });
      const terminal = await this.deps.launcher.open(scriptPath);
      this.deps.log.debug(`Contratação: terminal aberto (${terminal})`);
      setTimeout(() => void rm(workDir, { recursive: true, force: true }), LAUNCHER_LIFETIME_MS).unref();
    } catch (error) {
      await rm(workDir, { recursive: true, force: true });
      if (error instanceof LaunchError) {
        this.deps.log.warn(`Contratação: ${error.message}`);
        return fail(LAUNCH_STATUS[error.code], error.code);
      }
      if (error instanceof UnquotableError) return fail(400, 'invalid-prompt');
      throw error;
    }
  }
}
