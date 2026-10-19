import type { TaskItem } from '@ai-office/shared';
/** TodoWrite replaces the whole list. */
export declare function tasksFromTodoWrite(input: Record<string, unknown>): TaskItem[];
/** TaskCreate appends a pending task. `id` is provisional until the tool result reveals the real one. */
export declare function appendTask(tasks: readonly TaskItem[], input: Record<string, unknown>, id: string): TaskItem[];
/** TaskUpdate changes status/title of an existing task (status "deleted" removes it). */
export declare function updateTask(tasks: readonly TaskItem[], input: Record<string, unknown>): TaskItem[];
/** Renames a provisional task id once the real one is known. */
export declare function renameTask(tasks: readonly TaskItem[], from: string, to: string): TaskItem[];
