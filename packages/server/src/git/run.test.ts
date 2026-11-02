import { describe, expect, test } from 'vitest';
import { ghEnvironment } from './run';

describe('ghEnvironment', () => {
  test('the git that gh runs by itself starts no fsmonitor and no hooks from the repository', () => {
    // Act
    const env = ghEnvironment({ PATH: '/usr/bin' });

    // Assert
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect([env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_VALUE_0]).toEqual(['core.fsmonitor', 'false']);
    expect([env.GIT_CONFIG_KEY_1, env.GIT_CONFIG_VALUE_1]).toEqual(['core.hooksPath', '/dev/null']);
  });
});
