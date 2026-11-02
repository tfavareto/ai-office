import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTempDir, removeDir } from '../test-helpers';
import { UnquotableError, buildLauncherScript, claudeArguments, shellQuote, type LaunchSpec } from './command';

/** Values that break naive quoting: quotes, spaces, expansions, newlines, backslashes, unicode, leading dashes. */
const NASTY = [
  'plain',
  'with space',
  "it's",
  'say "hi"',
  '$(echo pwned)',
  '`echo pwned`',
  '${HOME} $HOME $((1+1))',
  'line one\nline two\n',
  'tab\tand\rcarriage',
  'back\\slash \\n \\\\',
  "'; rm -rf / #",
  'ünïcödé 日本語 💥',
  '-n --help',
  '*',
  '',
];

describe('shellQuote', () => {
  test.each(NASTY)('round-trips %j through sh unchanged', (value) => {
    const out = execFileSync('/bin/sh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' });

    expect(out).toBe(value);
  });

  test('refuses a NUL byte, which no shell word or process argument can carry', () => {
    expect(() => shellQuote('a\0b')).toThrow(UnquotableError);
  });
});

describe('claudeArguments', () => {
  test('passes nothing for the defaults', () => {
    expect(claudeArguments({})).toEqual([]);
    expect(claudeArguments({ model: 'default', permissionMode: 'default', prompt: '' })).toEqual([]);
  });

  test('maps the model and the permission mode to Claude Code options and puts the prompt last', () => {
    expect(claudeArguments({ model: 'opus', permissionMode: 'acceptEdits', prompt: 'Fix the login' })).toEqual([
      '--model',
      'opus',
      '--permission-mode',
      'acceptEdits',
      'Fix the login',
    ]);
    expect(claudeArguments({ model: 'haiku', permissionMode: 'plan' })).toEqual([
      '--model',
      'haiku',
      '--permission-mode',
      'plan',
    ]);
  });

  test('ends the options before a prompt that starts with a dash', () => {
    expect(claudeArguments({ prompt: '--dangerously-skip-permissions please' })).toEqual([
      '--',
      '--dangerously-skip-permissions please',
    ]);
  });
});

describe('buildLauncherScript run by a real sh', () => {
  let root: string;
  let projects: string;
  let workDir: string;
  let record: string;
  let stub: string;

  beforeEach(async () => {
    root = await makeTempDir('ai-office-launch-');
    projects = join(root, 'projects');
    workDir = join(root, 'work');
    record = join(root, 'record.json');
    stub = join(root, 'claude');
    await mkdir(projects);
    await mkdir(workDir);
    const script = [
      '#!/bin/sh',
      `{ printf '%s\\0' "$(pwd -P)" "\${CLAUDE_CONFIG_DIR-__unset__}"; for arg in "$@"; do printf '%s\\0' "$arg"; done; } > ${shellQuote(record)}`,
      '',
    ].join('\n');
    await writeFile(stub, script);
    await chmod(stub, 0o755);
  });
  afterEach(async () => removeDir(root));

  const spec = (project: string, extra: Partial<LaunchSpec> = {}): LaunchSpec => ({
    projectPath: project,
    claudePath: stub,
    locale: 'en',
    workDir,
    ...extra,
  });

  async function run(launcher: LaunchSpec): Promise<{ status: number | null; stdout: string }> {
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, 'launch.sh'), buildLauncherScript(launcher), { mode: 0o600 });
    const result = spawnSync('/bin/sh', [join(workDir, 'launch.sh')], {
      encoding: 'utf8',
      input: '\n',
      env: { ...process.env, CLAUDE_CONFIG_DIR: 'leaked-from-the-server' },
    });
    return { status: result.status, stdout: result.stdout };
  }

  /** What the stub saw: its working directory, CLAUDE_CONFIG_DIR (null when unset) and arguments. */
  const recorded = async (): Promise<{ cwd: string; config: string | null; args: string[] }> => {
    const [cwd = '', config = '', ...args] = (await readFile(record, 'utf8')).split('\0').slice(0, -1);
    return { cwd, config: config === '__unset__' ? null : config, args };
  };

  test('starts claude in the project with the options and the prompt as separate, untouched arguments', async () => {
    const project = join(projects, 'plain');
    await mkdir(project);

    const result = await run(spec(project, { model: 'sonnet', permissionMode: 'plan', prompt: 'Refactor the cart' }));

    expect(result.status).toBe(0);
    const seen = await recorded();
    expect(seen.cwd).toBe(await realpath(project));
    expect(seen.args).toEqual(['--model', 'sonnet', '--permission-mode', 'plan', 'Refactor the cart']);
  });

  test.each(NASTY.filter((value) => value !== ''))(
    'delivers the prompt %j byte for byte and runs nothing from it',
    async (prompt) => {
      const project = join(projects, 'safe');
      await mkdir(project);
      const marker = join(root, 'pwned');
      const hostile = `${prompt} $(touch ${marker}) \`touch ${marker}\``;

      await run(spec(project, { prompt: hostile }));

      expect((await recorded()).args.at(-1)).toBe(hostile);
      expect(existsSync(marker)).toBe(false);
    },
  );

  test.each([
    "quote'dir",
    'dir with spaces',
    '$(touch hacked)',
    '`touch hacked`',
    'new\nline',
    'ünï 日本',
    '--option-like',
    'semi;colon && amp | pipe',
  ])('enters the folder named %j', async (name) => {
    const project = join(projects, name);
    await mkdir(project);

    const result = await run(spec(project));

    expect(result.status).toBe(0);
    expect((await recorded()).cwd).toBe(await realpath(project));
    expect(existsSync(join(project, 'hacked'))).toBe(false);
  });

  test('exports CLAUDE_CONFIG_DIR for an account and removes a leaked one for the default account', async () => {
    const project = join(projects, 'accounts');
    await mkdir(project);
    const configDir = join(root, "work 'account'");

    await run(spec(project, { configDir }));
    expect((await recorded()).config).toBe(configDir);

    await run(spec(project));
    expect((await recorded()).config).toBeNull();
  });

  test('deletes its own directory (and the prompt it carries) as soon as it starts', async () => {
    const project = join(projects, 'cleanup');
    await mkdir(project);

    await run(spec(project, { prompt: 'secret plan' }));

    expect(existsSync(workDir)).toBe(false);
  });

  test('tells the person when the folder disappeared and does not start claude', async () => {
    const result = await run(spec(join(projects, 'gone'), { locale: 'pt-BR' }));

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('a pasta do projeto não existe mais');
    expect(existsSync(record)).toBe(false);
  });

  test('tells the person when claude cannot be started', async () => {
    const project = join(projects, 'noclaude');
    await mkdir(project);

    const result = await run(spec(project, { claudePath: join(root, 'missing-claude'), locale: 'es' }));

    expect(result.status).toBe(127);
    expect(result.stdout).toContain('no se pudo iniciar Claude Code');
  });

  test('keeps the exit status of claude', async () => {
    const project = join(projects, 'status');
    await mkdir(project);
    await writeFile(stub, '#!/bin/sh\nexit 3\n');

    const result = await run(spec(project));

    expect(result.status).toBe(3);
  });
});
