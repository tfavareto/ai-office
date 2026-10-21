import { describe, expect, test } from 'vitest';
import { HIRE_MAX_DESK_INDEX, HIRE_MAX_PATH, HIRE_MAX_PROMPT } from '@ai-office/shared';
import { HttpError } from './respond';
import { parseHireRequest } from './validate';

const errorOf = (body: unknown): string | undefined => {
  try {
    parseHireRequest(body);
  } catch (error) {
    return error instanceof HttpError ? `${error.status} ${error.message}` : String(error);
  }
  return undefined;
};

describe('parseHireRequest', () => {
  test('accepts the minimal body', () => {
    expect(parseHireRequest({ projectPath: '/work/app' })).toEqual({ projectPath: '/work/app' });
  });

  test('accepts every field and trims the prompt', () => {
    const body = {
      projectPath: '/work/app',
      accountId: 'claude-work',
      prompt: '  Fix the login\n',
      model: 'opus',
      permissionMode: 'acceptEdits',
      deskIndex: 3,
      locale: 'es',
    };

    expect(parseHireRequest(body)).toEqual({ ...body, prompt: 'Fix the login' });
  });

  test('treats null and empty optional values as absent', () => {
    expect(
      parseHireRequest({
        projectPath: '/work/app',
        prompt: '   ',
        accountId: null,
        model: null,
        permissionMode: null,
        deskIndex: null,
        locale: null,
      }),
    ).toEqual({ projectPath: '/work/app' });
  });

  test.each([
    [{}, '400 invalid-projectPath'],
    [{ projectPath: 42 }, '400 invalid-projectPath'],
    [{ projectPath: '   ' }, '400 invalid-projectPath'],
    [{ projectPath: `/${'x'.repeat(HIRE_MAX_PATH)}` }, '400 invalid-projectPath'],
    [{ projectPath: '/a', accountId: 5 }, '400 invalid-accountId'],
    [{ projectPath: '/a', accountId: 'x'.repeat(301) }, '400 invalid-accountId'],
    [{ projectPath: '/a', prompt: 5 }, '400 invalid-prompt'],
    [{ projectPath: '/a', prompt: 'x'.repeat(HIRE_MAX_PROMPT + 1) }, '400 invalid-prompt'],
    [{ projectPath: '/a', prompt: 'a\0b' }, '400 invalid-prompt'],
    [{ projectPath: '/a', model: 'gpt-4' }, '400 invalid-model'],
    [{ projectPath: '/a', model: 'claude-opus-5' }, '400 invalid-model'],
    [{ projectPath: '/a', model: ['opus'] }, '400 invalid-model'],
    [{ projectPath: '/a', permissionMode: 'bypassPermissions' }, '400 invalid-permissionMode'],
    [{ projectPath: '/a', permissionMode: 'dontAsk' }, '400 invalid-permissionMode'],
    [{ projectPath: '/a', deskIndex: -1 }, '400 invalid-deskIndex'],
    [{ projectPath: '/a', deskIndex: 1.5 }, '400 invalid-deskIndex'],
    [{ projectPath: '/a', deskIndex: HIRE_MAX_DESK_INDEX + 1 }, '400 invalid-deskIndex'],
    [{ projectPath: '/a', deskIndex: '2' }, '400 invalid-deskIndex'],
    [{ projectPath: '/a', locale: 'fr' }, '400 invalid-locale'],
  ])('rejects %j with %s', (body, expected) => {
    expect(errorOf(body)).toBe(expected);
  });

  test('accepts the largest allowed prompt and desk index', () => {
    const request = parseHireRequest({
      projectPath: '/a',
      prompt: 'x'.repeat(HIRE_MAX_PROMPT),
      deskIndex: HIRE_MAX_DESK_INDEX,
    });

    expect(request.prompt).toHaveLength(HIRE_MAX_PROMPT);
    expect(request.deskIndex).toBe(HIRE_MAX_DESK_INDEX);
  });

  test('ignores unknown fields instead of passing them on', () => {
    expect(
      parseHireRequest({
        projectPath: '/a',
        claudePath: '/bin/evil',
        args: ['--dangerously-skip-permissions'],
        env: { A: '1' },
      }),
    ).toEqual({ projectPath: '/a' });
  });
});
