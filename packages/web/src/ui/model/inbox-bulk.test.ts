import type { Agent } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { agent, permission, snapshot } from '../../test/fixtures';
import { buildInbox, type InboxItem } from './inbox';
import { groupOf, planBulk, similarGroups } from './inbox-bulk';
import { EMPTY_INBOX_STATE } from './inbox-state';

const NOW = 10_000;

function request(id: string, command: string, over: { expiresAt?: number; toolName?: string; input?: unknown; summary?: string } = {}): Agent {
  return agent({
    id,
    status: 'waiting',
    statusSince: 1_000,
    permission: permission({ id: `perm-${id}`, agentId: id, toolName: over.toolName ?? 'Bash', summary: over.summary ?? command, input: over.input ?? { command }, expiresAt: over.expiresAt ?? 60_000 }),
  });
}

function itemsOf(agents: Agent[]): InboxItem[] {
  return buildInbox({ snapshot: snapshot({ agents }), notifications: [], state: EMPTY_INBOX_STATE, now: NOW }).items;
}

describe('planBulk', () => {
  const items = itemsOf([request('a', 'npm test'), request('b', 'sudo make install'), request('c', 'ls', { expiresAt: 5_000 }), agent({ id: 'q', status: 'waiting', statusSince: 2_000 })]);

  it('approves ordinary requests and leaves risky, expired and non-permission items out with a reason', () => {
    const plan = planBulk('approve', items);
    expect(plan.include.map((item) => item.agentId)).toEqual(['a']);
    expect(plan.skipped.map((skip) => [skip.item.agentId, skip.reason])).toEqual([
      ['b', 'risky'],
      ['c', 'expired'],
      ['q', 'not-permission'],
    ]);
  });

  it('denies risky requests too, since refusing is always safe', () => {
    const plan = planBulk('deny', items);
    expect(plan.include.map((item) => item.agentId)).toEqual(['a', 'b']);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(['expired', 'not-permission']);
  });
});

describe('similarGroups', () => {
  it('groups identical requests and reports the group size', () => {
    const groups = similarGroups(itemsOf([request('a', 'npm test'), request('b', 'npm  test'), request('c', 'npm test'), request('d', 'npm run build')]));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ toolName: 'Bash', label: 'npm test' });
    expect(groups[0]?.items.map((item) => item.agentId)).toEqual(['a', 'b', 'c']);
  });

  it('never groups dangerous commands, even when identical', () => {
    const groups = similarGroups(itemsOf([request('a', 'rm -rf dist'), request('b', 'rm -rf dist'), request('c', 'git push --force'), request('d', 'git push --force')]));
    expect(groups).toEqual([]);
  });

  it('does not group a lone request, expired requests, or different tools with the same text', () => {
    const groups = similarGroups(
      itemsOf([
        request('a', 'npm test'),
        request('b', 'ls', { expiresAt: 5_000 }),
        request('c', 'ls', { expiresAt: 5_000 }),
        request('d', 'x', { toolName: 'Other', summary: 'npm test', input: undefined }),
      ]),
    );
    expect(groups).toEqual([]);
  });

  it('groups file edits of the same folder and extension, largest group first', () => {
    const edit = (id: string, path: string) => request(id, '', { toolName: 'Edit', summary: path, input: { file_path: path } });
    const groups = similarGroups(itemsOf([edit('a', 'src/a.ts'), edit('b', 'src/b.ts'), request('c', 'npm test'), request('d', 'npm test'), request('e', 'npm test')]));
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ['npm test', 3],
      ['src/*.ts', 2],
    ]);
  });

  it('finds the group of an item', () => {
    const items = itemsOf([request('a', 'npm test'), request('b', 'npm test'), request('c', 'ls')]);
    const groups = similarGroups(items);
    expect(groupOf(groups, items[0]?.id ?? '')?.items).toHaveLength(2);
    expect(groupOf(groups, items[2]?.id ?? '')).toBeUndefined();
  });
});
