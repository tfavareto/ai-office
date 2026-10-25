import { describe, expect, test } from 'vitest';
import { ConfigError, isLoopbackHost, isWildcardHost, loadConfig, parseFlags } from './config';

const load = (env: NodeJS.ProcessEnv, argv: string[] = []) =>
  loadConfig({ HOME: '/home/u', ...env }, argv, '/web/dist');

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
    const config = load({
      AI_OFFICE_PORT: '4899',
      AI_OFFICE_HOST: 'localhost',
      AI_OFFICE_CLAUDE_DIRS: '~/.claude, /tmp/c2 ,',
      AI_OFFICE_STATE_DIR: '/tmp/state',
      AI_OFFICE_DEMO: '1',
      AI_OFFICE_LOG: 'debug',
    });
    expect(config).toMatchObject({
      port: 4899,
      host: 'localhost',
      claudeDirs: ['/home/u/.claude', '/tmp/c2'],
      stateDir: '/tmp/state',
      demo: true,
      logLevel: 'debug',
    });
  });

  test('Codex: no extra homes and Codex on by default', () => {
    expect(load({})).toMatchObject({ codexDirs: [], codexHomeEnv: undefined, codexDisabled: false });
  });

  test('Codex: CODEX_HOME, extra homes and the switch that turns it off', () => {
    expect(load({ CODEX_HOME: '~/work-codex', AI_OFFICE_CODEX_DIRS: '~/.codex-b, /tmp/c3 ,' })).toMatchObject({
      codexHomeEnv: '/home/u/work-codex',
      codexDirs: ['/home/u/.codex-b', '/tmp/c3'],
    });
    expect(load({ AI_OFFICE_CODEX: '0' }).codexDisabled).toBe(true);
    expect(load({ AI_OFFICE_CODEX: 'false' }).codexDisabled).toBe(true);
    expect(load({ AI_OFFICE_CODEX: '1' }).codexDisabled).toBe(false);
    expect(load({}, ['--codex-dirs', '/tmp/x']).codexDirs).toEqual(['/tmp/x']);
    expect(load({ CODEX_HOME: '  ' }).codexHomeEnv).toBeUndefined();
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
    expect(load({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' })).toMatchObject({
      host: '0.0.0.0',
      allowRemote: true,
    });
    expect(load({ AI_OFFICE_HOST: '10.0.0.2' }, ['--allow-remote'])).toMatchObject({
      host: '10.0.0.2',
      allowRemote: true,
    });
    expect(load({ AI_OFFICE_HOST: '::1' })).toMatchObject({ allowRemote: false });
  });

  test('host classification', () => {
    expect(['localhost', '127.0.0.1', '::1', '[::1]', '127.0.0.5'].every(isLoopbackHost)).toBe(true);
    expect(isLoopbackHost('192.168.0.2')).toBe(false);
    expect(isWildcardHost('0.0.0.0')).toBe(true);
    expect(isWildcardHost('127.0.0.1')).toBe(false);
  });

  test('team mode is off by default only through its own switches, and a team never widens the main bind', () => {
    expect(load({})).toMatchObject({ teamDisabled: false, teamLoopback: false, teamDevice: undefined });
    expect(load({ AI_OFFICE_TEAM: '0' })).toMatchObject({ teamDisabled: true });
    expect(
      load({ AI_OFFICE_TEAM: '1', AI_OFFICE_TEAM_LOOPBACK: '1', AI_OFFICE_TEAM_DEVICE: ' Mesa 2 ' }),
    ).toMatchObject({
      teamDisabled: false,
      teamLoopback: true,
      teamDevice: 'Mesa 2',
      host: '127.0.0.1',
    });
    expect(() => load({ AI_OFFICE_TEAM_LOOPBACK: '1', AI_OFFICE_HOST: '192.168.1.5' })).toThrow(ConfigError);
  });
});
