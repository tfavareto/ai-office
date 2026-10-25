// The team dialog's state: what the server says about team mode (refreshed every two seconds while the dialog is open)
// and the actions that change it. Every action answers with the new status, which replaces what is held here.
import type { TeamHostStartRequest, TeamJoinRequest, TeamSharePrefs, TeamStatus } from '@ai-office/shared';
import type { Backend } from '../net/backend';
import { Observable } from './observable';
import { teamErrorText } from './model/team-text';

export const TEAM_POLL_MS = 2000;

export interface TeamData {
  status: TeamStatus | null;
  loading: boolean;
  /** An action is waiting for the server. */
  busy: boolean;
  /** Why the last load or action failed (in the user's language); empty when it did not. */
  error: string;
}

export type TeamOutcome = { ok: true } | { ok: false; message: string };

const INITIAL: TeamData = { status: null, loading: false, busy: false, error: '' };

export class TeamController extends Observable<TeamData> {
  private timer: ReturnType<typeof setInterval> | undefined;
  private token = 0;

  constructor(private readonly backend: () => Backend) {
    super(INITIAL);
  }

  private patch(change: Partial<TeamData>): void {
    this.replace({ ...this.value, ...change });
  }

  /** Reads the status now and keeps reading it while the dialog is open. */
  start(): void {
    this.stop();
    void this.load(false);
    this.timer = setInterval(() => void this.load(true), TEAM_POLL_MS);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.token++;
  }

  async load(quiet: boolean): Promise<void> {
    const token = ++this.token;
    if (!quiet) this.patch({ loading: true, error: '' });
    try {
      const status = await this.backend().teamStatus();
      if (token !== this.token) return;
      // A refresh never wipes the explanation of an action that failed: it stays until the next action.
      this.patch({ status, loading: false, ...(quiet ? {} : { error: '' }) });
    } catch (error) {
      if (token !== this.token) return;
      // A failed refresh keeps what is shown; only a first load reports the problem.
      this.patch({ loading: false, ...(quiet && this.value.status !== null ? {} : { error: teamErrorText(error) }) });
    }
  }

  hostStart(request: TeamHostStartRequest): Promise<TeamOutcome> {
    return this.act((backend) => backend.teamHostStart(request));
  }

  hostStop(): Promise<TeamOutcome> {
    return this.act((backend) => backend.teamHostStop());
  }

  newCode(): Promise<TeamOutcome> {
    return this.act((backend) => backend.teamNewCode());
  }

  revoke(memberId: string): Promise<TeamOutcome> {
    return this.act((backend) => backend.teamRevoke(memberId));
  }

  end(): Promise<TeamOutcome> {
    return this.act((backend) => backend.teamEnd());
  }

  join(request: TeamJoinRequest): Promise<TeamOutcome> {
    return this.act((backend) => backend.teamJoin(request));
  }

  leave(): Promise<TeamOutcome> {
    return this.act((backend) => backend.teamLeave());
  }

  setSharing(prefs: TeamSharePrefs): Promise<TeamOutcome> {
    return this.act((backend) => backend.teamSharing(prefs));
  }

  private async act(request: (backend: Backend) => Promise<TeamStatus>): Promise<TeamOutcome> {
    this.patch({ busy: true, error: '' });
    this.token++;
    try {
      const status = await request(this.backend());
      this.patch({ busy: false, status, error: '' });
      return { ok: true };
    } catch (error) {
      const message = teamErrorText(error);
      this.patch({ busy: false, error: message });
      return { ok: false, message };
    }
  }
}
