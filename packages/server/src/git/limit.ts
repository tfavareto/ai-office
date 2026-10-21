// Keeps the number of programs running at the same time under a cap, whoever asks (the watcher, the day report).
import type { Runner } from './run';

/** A runner that never has more than `max` programs running; the others wait their turn, first come first served. */
export function limitRunner(run: Runner, max: number): Runner {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    const next = waiting.shift();
    // The slot passes straight to the next one in line, so nobody can slip in between.
    if (next === undefined) active--;
    else next();
  };
  return async (file, args, options) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await run(file, args, options);
    } finally {
      release();
    }
  };
}
