// Task list extraction from TodoWrite and the TaskCreate / TaskUpdate tools (pure functions).
import type { TaskItem } from '@ai-office/shared';
import { asArray, asRecord, asString } from '../util/fs-safe';

const STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);

function normalizeStatus(value: unknown): TaskItem['status'] {
  const status = asString(value);
  return status !== undefined && STATUSES.has(status) ? (status as TaskItem['status']) : 'pending';
}

/** TodoWrite replaces the whole list. */
export function tasksFromTodoWrite(input: Record<string, unknown>): TaskItem[] {
  const tasks: TaskItem[] = [];
  for (const raw of asArray(input.todos)) {
    const todo = asRecord(raw);
    const title = asString(todo.content) ?? asString(todo.subject) ?? asString(todo.title);
    if (title === undefined || title.trim().length === 0) continue;
    const activeForm = asString(todo.activeForm);
    tasks.push({
      id: asString(todo.id) ?? String(tasks.length + 1),
      title: title.trim(),
      ...(activeForm !== undefined ? { activeForm } : {}),
      status: normalizeStatus(todo.status),
    });
  }
  return tasks;
}

/** TaskCreate appends a pending task. `id` is provisional until the tool result reveals the real one. */
export function appendTask(tasks: readonly TaskItem[], input: Record<string, unknown>, id: string): TaskItem[] {
  const title = asString(input.subject) ?? asString(input.title) ?? asString(input.content) ?? asString(input.description);
  if (title === undefined || title.trim().length === 0) return [...tasks];
  const activeForm = asString(input.activeForm);
  return [...tasks, { id, title: title.trim(), ...(activeForm !== undefined ? { activeForm } : {}), status: 'pending' }];
}

/** TaskUpdate changes status/title of an existing task (status "deleted" removes it). */
export function updateTask(tasks: readonly TaskItem[], input: Record<string, unknown>): TaskItem[] {
  const rawId = input.taskId ?? input.id;
  const id = typeof rawId === 'number' ? String(rawId) : asString(rawId);
  if (id === undefined) return [...tasks];
  if (input.status === 'deleted') return tasks.filter((task) => task.id !== id);
  return tasks.map((task) => {
    if (task.id !== id) return task;
    const title = asString(input.subject) ?? task.title;
    const activeForm = asString(input.activeForm) ?? task.activeForm;
    return {
      ...task,
      title,
      ...(activeForm !== undefined ? { activeForm } : {}),
      status: input.status === undefined ? task.status : normalizeStatus(input.status),
    };
  });
}

/** Renames a provisional task id once the real one is known. */
export function renameTask(tasks: readonly TaskItem[], from: string, to: string): TaskItem[] {
  return tasks.map((task) => (task.id === from ? { ...task, id: to } : task));
}

/**
 * Records when each task entered its current status: tasks that kept their title and status keep their stamp, new or
 * changed ones get `at` (the time of the tool call that changed the list). Pure; the input is not modified.
 */
export function stampTaskChanges(previous: readonly TaskItem[], next: readonly TaskItem[], at: number): TaskItem[] {
  const before = new Map(previous.map((task) => [task.id, task]));
  return next.map((task) => {
    const old = before.get(task.id);
    const unchanged = old !== undefined && old.status === task.status && old.title === task.title;
    return { ...task, changedAt: unchanged ? (old.changedAt ?? at) : at };
  });
}
