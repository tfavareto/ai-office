import type { Agent } from '@ai-office/shared';
import type { Pose, WorkMood } from './types';

/** Errors among the last activities that make a person look frustrated, and how fresh the latest one must be. */
const FRUSTRATION_WINDOW = 6;
const FRUSTRATION_ERRORS = 2;
const FRUSTRATION_MAX_AGE_MS = 90_000;

export interface MoodContext {
  /** Server clock (ms). */
  now: number;
  /** A foreground shell command is running. */
  foregroundShell: boolean;
  /** At least one subagent of this agent is working. */
  workingSubagents: boolean;
}

/** True when the agent hit repeated errors recently (two or more among its last few activities). */
export function isFrustrated(agent: Agent, now: number): boolean {
  const recent = agent.recent.slice(-FRUSTRATION_WINDOW);
  const errors = recent.filter((a) => a.error === true || a.kind === 'error');
  if (errors.length < FRUSTRATION_ERRORS) return false;
  const latest = errors[errors.length - 1];
  return latest !== undefined && now - latest.at < FRUSTRATION_MAX_AGE_MS;
}

/** What the person is busy with. Pure: the same agent and context always give the same mood. */
export function workMood(agent: Agent, ctx: MoodContext): WorkMood {
  if (agent.status === 'waiting') return 'waiting';
  if (agent.status !== 'working') return 'idle';
  if (isFrustrated(agent, ctx.now)) return 'frustrated';
  const kind = agent.activity?.kind;
  if (kind === 'subagent' || ctx.workingSubagents) return 'delegating';
  if (kind === 'bash' || ctx.foregroundShell) return 'terminal';
  switch (kind) {
    case 'read':
    case 'search':
      return 'reading';
    case 'web':
      return 'web';
    case 'think':
    case 'prompt':
      return 'thinking';
    default:
      return 'typing';
  }
}

/** The seated work pose for a mood (shell stages are chosen by the caller: lean, stretch, popcorn, sleep). */
export function seatedPoseFor(mood: WorkMood, kind: string | undefined): Pose {
  switch (mood) {
    case 'reading':
      return 'readDoc';
    case 'thinking':
      return 'think';
    case 'delegating':
      return 'point';
    case 'frustrated':
      return 'scratch';
    case 'waiting':
      return 'hand';
    case 'terminal':
      return 'lean';
    case 'typing':
      return kind === 'edit' || kind === 'write' ? 'typeFast' : 'type';
    default:
      return 'type';
  }
}
