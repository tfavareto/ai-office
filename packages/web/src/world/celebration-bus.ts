// A tiny bridge from the worlds to the page: a celebration asks for its sound here, and the page plays it (only when
// sounds are on). The worlds do not know about preferences or audio.
export type CelebrationListener = (event: { big: boolean }) => void;

const listeners = new Set<CelebrationListener>();

export function onCelebration(listener: CelebrationListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitCelebration(big: boolean): void {
  for (const listener of listeners) listener({ big });
}
