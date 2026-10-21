// Test helper: runs a test file in a fixed time zone (the local day, week and month boundaries depend on it).
// Call it at the top of the file, before any date is built.
import { afterAll, vi } from 'vitest';

export function useTimeZone(zone: string): void {
  vi.stubEnv('TZ', zone);
  afterAll(() => {
    vi.unstubAllEnvs();
  });
}
