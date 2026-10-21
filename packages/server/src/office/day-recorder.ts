// "Meu dia": time per status per agent, recorded every 5 s into <stateDir>/days/YYYY-MM-DD.json.
import { join } from 'node:path';
import type { Agent, AgentStatus, DayStats } from '@ai-office/shared';
import type { Logger } from '../log';
import { asArray, asNumber, asRecord, asString, readJsonFile, writeJsonAtomic } from '../util/fs-safe';
import { localDateString } from '../util/ids';

export const RECORD_INTERVAL_MS = 5000;
export const FLUSH_INTERVAL_MS = 30_000;
const STATUSES: readonly AgentStatus[] = ['working', 'waiting', 'idle', 'done', 'offline'];

type Entry = DayStats['agents'][number];

function emptyMs(): Record<AgentStatus, number> {
  return { working: 0, waiting: 0, idle: 0, done: 0, offline: 0 };
}

function parseDay(date: string, value: unknown): DayStats {
  const agents: Entry[] = [];
  for (const raw of asArray(asRecord(value).agents)) {
    const entry = asRecord(raw);
    const agentId = asString(entry.agentId);
    if (agentId === undefined) continue;
    const ms = emptyMs();
    const stored = asRecord(entry.ms);
    for (const status of STATUSES) ms[status] = asNumber(stored[status]) ?? 0;
    agents.push({ agentId, name: asString(entry.name) ?? agentId, projectId: asString(entry.projectId) ?? '', ms });
  }
  return { date, agents };
}

export class DayRecorder {
  private current: DayStats | undefined;
  private lastRecordAt: number | undefined;
  private lastFlushAt = 0;
  private dirty = false;

  constructor(
    private readonly dir: string,
    private readonly log: Logger,
  ) {}

  private fileFor(date: string): string {
    return join(this.dir, 'days', `${date}.json`);
  }

  /** Adds the elapsed time (capped to one interval) to each present agent's status bucket. */
  async record(agents: readonly Agent[], now: number): Promise<void> {
    const date = localDateString(now);
    if (this.current?.date !== date) {
      await this.flush();
      this.current = await this.read(date);
      this.lastRecordAt = undefined;
    }
    const elapsed = this.lastRecordAt === undefined ? 0 : Math.min(now - this.lastRecordAt, RECORD_INTERVAL_MS * 2);
    this.lastRecordAt = now;
    if (elapsed <= 0) return;
    const byId = new Map(this.current.agents.map((entry) => [entry.agentId, entry]));
    for (const agent of agents) {
      const entry = byId.get(agent.id) ?? {
        agentId: agent.id,
        name: agent.name,
        projectId: agent.projectId,
        ms: emptyMs(),
      };
      byId.set(agent.id, {
        ...entry,
        name: agent.name,
        projectId: agent.projectId,
        ms: { ...entry.ms, [agent.status]: entry.ms[agent.status] + elapsed },
      });
    }
    this.current = { date, agents: [...byId.values()] };
    this.dirty = true;
    if (now - this.lastFlushAt >= FLUSH_INTERVAL_MS) await this.flush(now);
  }

  async get(date: string): Promise<DayStats> {
    return this.current?.date === date ? this.current : this.read(date);
  }

  private async read(date: string): Promise<DayStats> {
    return parseDay(date, await readJsonFile(this.fileFor(date)));
  }

  async flush(now = Date.now()): Promise<void> {
    if (!this.dirty || this.current === undefined) return;
    this.dirty = false;
    this.lastFlushAt = now;
    try {
      await writeJsonAtomic(this.fileFor(this.current.date), this.current);
    } catch (error) {
      this.dirty = true;
      this.log.warn(`Não foi possível salvar o dia: ${String(error)}`);
    }
  }
}
