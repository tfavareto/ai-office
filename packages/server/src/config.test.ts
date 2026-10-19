import { describe, expect, test } from 'vitest';
import { ConfigError, isLoopbackHost, isWildcardHost, loadConfig, parseFlags } from './config';

const load = (env: NodeJS.ProcessEnv, argv: string[] = []) => loadConfig({ HOME: '/home/u', ...env }, argv, '/web/dist');

describe('loadConfig', () => {
  test('uses the documented defaults', () => {
    expect(load({})).toMatchObject({
      port: 4848,
      host: '127.0.0.1',
      allowRemote: false,
      claudeDirs: undefined,
      stateDir: '/home/u/.ai-office',
      demo: false,
      webDir: '/web/dist',
      logLevel: 'info',
    });
  });

  test('reads environment variables', () => {
    const config = load({ AI_OFFICE_PORT: '4899', AI_OFFICE_HOST: 'localhost', AI_OFFICE_CLAUDE_DIRS: '~/.claude, /tmp/c2 ,', AI_OFFICE_STATE_DIR: '/tmp/state', AI_OFFICE_DEMO: '1', AI_OFFICE_LOG: 'debug' });
    expect(config).toMatchObject({ port: 4899, host: 'localhost', claudeDirs: ['/home/u/.claude', '/tmp/c2'], stateDir: '/tmp/state', demo: true, logLevel: 'debug' });
  });

  test('flags win over the environment', () => {
    const config = load({ AI_OFFICE_PORT: '1111' }, ['--port', '2222', '--demo', '--quiet', '--state-dir=/tmp/x']);
    expect(config).toMatchObject({ port: 2222, demo: true, logLevel: 'quiet', stateDir: '/tmp/x' });
  });

  test('rejects invalid ports and unknown flags', () => {
    expect(() => load({ AI_OFFICE_PORT: 'abc' })).toThrow(ConfigError);
    expect(() => load({ AI_OFFICE_PORT: '70000' })).toThrow(ConfigError);
    expect(() => parseFlags(['--wat'])).toThrow(ConfigError);
    expect(() => parseFlags(['--port'])).toThrow(ConfigError);
  });

  test('AI_OFFICE_DEMO=0 keeps demo off', () => {
    expect(load({ AI_OFFICE_DEMO: '0' }).demo).toBe(false);
  });

  test('refuses a non-loopback host unless remote access is explicitly allowed', () => {
    expect(() => load({ AI_OFFICE_HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(() => load({ AI_OFFICE_HOST: '192.168.1.5' }, [])).toThrow(/AI_OFFICE_ALLOW_REMOTE/);
    expect(() => load({}, ['--host', '::'])).toThrow(ConfigError);
    expect(() => load({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '0' })).toThrow(ConfigError);
    expect(load({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' })).toMatchObject({ host: '0.0.0.0', allowRemote: true });
    expect(load({ AI_OFFICE_HOST: '10.0.0.2' }, ['--allow-remote'])).toMatchObject({ host: '10.0.0.2', allowRemote: true });
    expect(load({ AI_OFFICE_HOST: '::1' })).toMatchObject({ allowRemote: false });
  });

  test('host classification', () => {
    expect(['localhost', '127.0.0.1', '::1', '[::1]', '127.0.0.5'].every(isLoopbackHost)).toBe(true);
    expect(isLoopbackHost('192.168.0.2')).toBe(false);
    expect(isWildcardHost('0.0.0.0')).toBe(true);
    expect(isWildcardHost('127.0.0.1')).toBe(false);
  });
});
