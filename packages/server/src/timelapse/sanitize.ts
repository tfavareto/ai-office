// What the time-lapse keeps of an activity: what the agent was doing, never what anybody said. Prompts lose their text,
// reply and error details are dropped, and every free-text parameter (a command, a file, a query) is masked for
// credentials and cut short.
import {
  type Activity,
  type Msg,
  type MsgParam,
  type ShellJob,
  type TimelapseActivity,
  type TimelapseTask,
  type TaskItem,
  ACTIVITY_TEXT_MAX,
  msg,
  sourceText,
  truncate,
} from '@ai-office/shared';
import { maskSecrets } from '../report/commands';

export const PARAM_MAX = 80;
export const TASK_TITLE_MAX = 80;
export const MAX_TASKS_PER_EVENT = 12;

function cleanParam(value: MsgParam): MsgParam {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return truncate(maskSecrets(value), PARAM_MAX);
  return cleanMsg(value);
}

/** A copy of the message with every string parameter masked and cut (nested messages included). */
export function cleanMsg(message: Msg): Msg {
  if (message.params === undefined) return message;
  const params: Record<string, MsgParam> = {};
  for (const [name, value] of Object.entries(message.params)) params[name] = cleanParam(value);
  return { key: message.key, params };
}

/** The activity as the time-lapse stores it (without the event's agent and time). */
export function safeActivity(activity: Activity): Omit<TimelapseActivity, 'type' | 'at' | 'agent'> {
  const message =
    activity.kind === 'prompt'
      ? msg('timelapse.activity.prompt')
      : cleanMsg(activity.msg ?? msg('activity.other', { name: activity.kind }));
  return {
    kind: activity.kind,
    icon: activity.icon,
    text: truncate(sourceText(message), ACTIVITY_TEXT_MAX),
    msg: message,
    ...(activity.error === true ? { error: true } : {}),
  };
}

/** The task list as the time-lapse stores it: at most a dozen tasks, titles cut. */
export function safeTasks(tasks: readonly TaskItem[]): TimelapseTask[] {
  return tasks.slice(0, MAX_TASKS_PER_EVENT).map((task) => ({
    title: truncate(maskSecrets(task.title), TASK_TITLE_MAX),
    ...(task.activeForm !== undefined ? { activeForm: truncate(maskSecrets(task.activeForm), TASK_TITLE_MAX) } : {}),
    status: task.status,
  }));
}

/** The label of a shell job, masked, with its message cleaned the same way. */
export function safeShellLabel(job: ShellJob): { label: string; labelMsg?: Msg } {
  if (job.labelMsg === undefined) return { label: truncate(maskSecrets(job.label), ACTIVITY_TEXT_MAX) };
  const labelMsg = cleanMsg(job.labelMsg);
  return { label: truncate(sourceText(labelMsg), ACTIVITY_TEXT_MAX), labelMsg };
}
