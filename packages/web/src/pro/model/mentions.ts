// What the Pro view's prompt completes while typing: `@` for a file of the project, `$` for a saved prompt. Pure.

export type TokenTrigger = '@' | '$';

export interface PromptToken {
  trigger: TokenTrigger;
  query: string;
  start: number;
  end: number;
}

export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
}

export const MAX_PROMPTS = 100;
/** The longest saved prompt: what a message to an agent can hold. */
export const MAX_PROMPT_LENGTH = 4000;
const MAX_PROMPT_NAME = 48;

/** The mention being typed right before the cursor, if any. It must start a word, so `me@x.com` is not one. */
export function activeToken(text: string, caret: number): PromptToken | null {
  let start = caret - 1;
  while (start >= 0 && !/\s/.test(text[start] ?? '')) start -= 1;
  const word = text.slice(start + 1, caret);
  const trigger = word[0];
  if (trigger !== '@' && trigger !== '$') return null;
  return { trigger, query: word.slice(1), start: start + 1, end: caret };
}

export function replaceToken(text: string, token: PromptToken, insert: string): { text: string; caret: number } {
  return {
    text: `${text.slice(0, token.start)}${insert}${text.slice(token.end)}`,
    caret: token.start + insert.length,
  };
}

export function promptNameOf(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.slice(0, MAX_PROMPT_NAME);
}

export function addPrompt(list: readonly SavedPrompt[], id: string, text: string): SavedPrompt[] {
  if (list.some((prompt) => prompt.text === text)) return [...list];
  return [{ id, name: promptNameOf(text), text }, ...list].slice(0, MAX_PROMPTS);
}

export function removePrompt(list: readonly SavedPrompt[], id: string): SavedPrompt[] {
  return list.filter((prompt) => prompt.id !== id);
}
