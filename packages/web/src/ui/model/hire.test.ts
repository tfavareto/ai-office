import type { Account, RecentSession } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { BackendError } from '../../net/backend';
import { agent, snapshot } from '../../test/fixtures';
import {
  type HireForm,
  buildHireRequest,
  defaultAccountId,
  folderReasonKey,
  hireAccounts,
  hireErrorKey,
  isSimulatedHire,
  isSubmitShortcut,
  localPathProblem,
  promptTooLong,
  realRoomPaths,
  recentFolders,
} from './hire';

function session(projectPath: string, lastAt: number, projectName = projectPath.split('/').pop() ?? ''): RecentSession {
  return {
    accountId: 'a1',
    sessionId: `s-${projectPath}-${lastAt}`,
    projectPath,
    projectName,
    firstAt: lastAt - 10,
    lastAt,
    open: false,
  };
}

const PERSONAL: Account = {
  id: 'personal',
  label: 'Pessoal',
  initial: 'P',
  color: '#4f86f7',
  dir: '/h/.claude',
  isDefault: true,
};
const WORK: Account = { id: 'work', label: 'work', initial: 'W', color: '#f5a623', dir: '/h/.claude-work' };
const DEMO: Account = {
  id: 'demo-pessoal',
  label: 'Pessoal',
  initial: 'P',
  color: '#4f86f7',
  dir: '~/.claude',
  isDefault: true,
};

describe('recentFolders', () => {
  it('lists the newest folders first, once each', () => {
    const folders = recentFolders([session('/w/a', 100), session('/w/b', 300), session('/w/a', 200)], []);

    expect(folders.map((folder) => folder.path)).toEqual(['/w/b', '/w/a']);
  });

  it('leaves out folders that already are rooms and folders without a path', () => {
    const folders = recentFolders(
      [
        session('/w/a', 100),
        session('/w/b', 200),
        { ...session('', 300), projectPath: undefined as unknown as string },
      ],
      ['/w/a'],
    );

    expect(folders.map((folder) => folder.path)).toEqual(['/w/b']);
  });

  it('keeps only the first few', () => {
    const many = Array.from({ length: 20 }, (_, i) => session(`/w/p${i}`, i));

    expect(recentFolders(many, [])).toHaveLength(6);
    expect(recentFolders(many, [], 3).map((folder) => folder.path)).toEqual(['/w/p19', '/w/p18', '/w/p17']);
  });
});

describe('real and simulated hires', () => {
  const demoOffice = snapshot({
    meta: { version: 't', startedAt: 0, local: true, demo: true },
    projects: [
      { id: '/work/real', name: 'real', path: '/work/real', seed: 1, order: 0 },
      { id: '/demo/loja', name: 'loja', path: '/demo/loja', seed: 2, order: 1 },
    ],
    agents: [agent({ id: 'r', projectId: '/work/real' }), agent({ id: 'd', projectId: '/demo/loja', demo: true })],
  });

  it('knows the rooms that hold real sessions', () => {
    expect(realRoomPaths(demoOffice)).toEqual(['/work/real']);
    expect(realRoomPaths(null)).toEqual([]);
  });

  it('simulates in demo mode everywhere but in real rooms', () => {
    expect(isSimulatedHire(demoOffice, '/demo/loja')).toBe(true);
    expect(isSimulatedHire(demoOffice, '/somewhere/new')).toBe(true);
    expect(isSimulatedHire(demoOffice, '/work/real')).toBe(false);
  });

  it('never simulates outside demo mode', () => {
    const real = snapshot({ agents: [agent({ id: 'r' })] });

    expect(isSimulatedHire(real, '/anything')).toBe(false);
  });

  it('offers the demo accounts for a simulated hire and the real ones otherwise', () => {
    const office = snapshot({ accounts: [PERSONAL, WORK, DEMO] });

    expect(hireAccounts(office, false).map((account) => account.id)).toEqual(['personal', 'work']);
    expect(hireAccounts(office, true).map((account) => account.id)).toEqual(['demo-pessoal']);
    expect(hireAccounts(null, false)).toEqual([]);
  });
});

describe('defaultAccountId', () => {
  const accounts = [PERSONAL, WORK];

  it('prefers the account that started a session most recently in the room', () => {
    const office = snapshot({
      agents: [
        agent({ id: 'old', accountId: 'personal', projectId: '/w/a', startedAt: 100 }),
        agent({ id: 'new', accountId: 'work', projectId: '/w/a', startedAt: 900 }),
        agent({ id: 'other', accountId: 'personal', projectId: '/w/b', startedAt: 5000 }),
      ],
    });

    expect(defaultAccountId(office, '/w/a', accounts)).toBe('work');
  });

  it('falls back to the default account, then the first one', () => {
    const office = snapshot({ agents: [] });

    expect(defaultAccountId(office, '/w/a', accounts)).toBe('personal');
    expect(defaultAccountId(office, undefined, [WORK])).toBe('work');
    expect(defaultAccountId(office, undefined, [])).toBe('');
  });

  it('ignores subagents and accounts that are not offered', () => {
    const office = snapshot({
      agents: [
        agent({ id: 'sub', kind: 'sub', accountId: 'work', projectId: '/w/a', startedAt: 900 }),
        agent({ id: 'gone', accountId: 'elsewhere', projectId: '/w/a', startedAt: 800 }),
      ],
    });

    expect(defaultAccountId(office, '/w/a', accounts)).toBe('personal');
  });
});

describe('localPathProblem', () => {
  it.each(['/work/app', '~', '~/code', '  /work/app  ', ''])('accepts %j', (path) => {
    expect(localPathProblem(path)).toBeNull();
  });

  it.each(['work/app', './app', '../app', 'C:\\work', '~other/app'])('flags %j as not absolute', (path) => {
    expect(localPathProblem(path)).toBe('not-absolute');
  });
});

describe('buildHireRequest', () => {
  const base: HireForm = {
    roomPath: '/work/app',
    path: '',
    accountId: 'work',
    prompt: '',
    model: 'default',
    permissionMode: 'default',
  };

  it('sends only what differs from the defaults', () => {
    expect(buildHireRequest(base)).toEqual({ projectPath: '/work/app', accountId: 'work' });
  });

  it('sends everything that was chosen, with the prompt trimmed', () => {
    const request = buildHireRequest({
      ...base,
      prompt: '  Fix the login  ',
      model: 'opus',
      permissionMode: 'plan',
      deskIndex: 2,
    });

    expect(request).toEqual({
      projectPath: '/work/app',
      accountId: 'work',
      prompt: 'Fix the login',
      model: 'opus',
      permissionMode: 'plan',
      deskIndex: 2,
    });
  });

  it('uses the typed path for a new project and leaves out an empty account', () => {
    expect(buildHireRequest({ ...base, roomPath: undefined, path: '  ~/code/new  ', accountId: '' })).toEqual({
      projectPath: '~/code/new',
    });
  });
});

describe('prompt length and the submit shortcut', () => {
  it('allows 8000 characters and no more', () => {
    expect(promptTooLong('x'.repeat(8000))).toBe(false);
    expect(promptTooLong('x'.repeat(8001))).toBe(true);
  });

  it('submits with Cmd+Enter or Ctrl+Enter only', () => {
    const key = { key: 'Enter', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

    expect(isSubmitShortcut({ ...key, metaKey: true })).toBe(true);
    expect(isSubmitShortcut({ ...key, ctrlKey: true })).toBe(true);
    expect(isSubmitShortcut(key)).toBe(false);
    expect(isSubmitShortcut({ ...key, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isSubmitShortcut({ ...key, key: 'a', metaKey: true })).toBe(false);
  });
});

describe('error texts', () => {
  it('maps the codes the server sends to catalog keys', () => {
    expect(hireErrorKey(new BackendError('rate-limited', 429))).toBe('hire.error.rateLimited');
    expect(hireErrorKey(new BackendError('claude-not-found', 503))).toBe('hire.error.claudeNotFound');
    expect(hireErrorKey(new BackendError('no-terminal', 503))).toBe('hire.error.noTerminal');
    expect(hireErrorKey(new BackendError('project-not-found', 404))).toBe('hire.error.projectNotFound');
  });

  it('has no text for codes it does not know, or for other errors', () => {
    expect(hireErrorKey(new BackendError('local-only', 403))).toBeNull();
    expect(hireErrorKey(new Error('rate-limited'))).toBeNull();
  });

  it('maps every folder problem to a text', () => {
    expect(folderReasonKey('not-found')).toBe('hire.path.notFound');
    expect(folderReasonKey('not-absolute')).toBe('hire.path.notAbsolute');
    expect(folderReasonKey('not-directory')).toBe('hire.path.notDirectory');
    expect(folderReasonKey('not-readable')).toBe('hire.path.notReadable');
  });
});
