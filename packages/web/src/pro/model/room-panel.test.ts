import type { Agent } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { agent, project } from '../../test/fixtures';
import { MAX_PANEL_FINISHED, roomPanelModel } from './room-panel';
import type { SceneCluster, SceneRoom } from './scene';

function cluster(
  main: Agent,
  subs: SceneCluster['subs'] = [],
  collapsed: SceneCluster['collapsed'] = [],
): SceneCluster {
  return { main, subs, collapsed, layout: { id: main.id, rows: 1, slots: {} } };
}

const git = {
  branch: 'feat/cart',
  staged: 1,
  unstaged: 2,
  untracked: 0,
  conflicted: 0,
  insertions: 0,
  deletions: 0,
  stash: 0,
  ahead: 2,
};

describe('roomPanelModel', () => {
  it('describes the chosen orchestrator: time, model, branch, spend and its subagents', () => {
    // Arrange
    const main = agent({
      id: 'm',
      name: 'Ana',
      status: 'working',
      startedAt: 100,
      statusSince: 900,
      model: 'claude-opus-4-1',
      stats: {
        toolCalls: 12,
        tokensIn: 5000,
        tokensOut: 300,
        costUSD: 1.5,
        linesAdded: 0,
        linesRemoved: 0,
        subagents: 1,
      },
    });
    const sub = agent({
      id: 's',
      kind: 'sub',
      parentId: 'm',
      role: 'Explore',
      title: 'Map it',
      status: 'working',
      startedAt: 800,
    });
    const room: SceneRoom = { project: project({ git }), clusters: [cluster(main, [{ agent: sub, slot: 0 }])] };

    // Act
    const model = roomPanelModel(room, null);

    // Assert
    expect(model?.selectedId).toBe('m');
    expect(model?.orchestrators[0]).toMatchObject({
      startedAt: 100,
      turnSince: 900,
      model: 'claude-opus-4-1',
      branch: 'feat/cart',
      tokensIn: 5000,
      costUSD: 1.5,
      active: [{ id: 's', type: 'Explore', task: 'Map it', status: 'working', startedAt: 800 }],
      finished: [],
    });
  });

  it('keeps the orchestrator the user picked, and otherwise prefers the one that waits, then a busy one', () => {
    // Arrange
    const idle = agent({ id: 'a', status: 'idle' });
    const busy = agent({ id: 'b', status: 'working' });
    const waiting = agent({ id: 'c', status: 'waiting' });
    const room: SceneRoom = { project: project(), clusters: [cluster(idle), cluster(busy), cluster(waiting)] };

    // Act, Assert
    expect(roomPanelModel(room, null)?.selectedId).toBe('c');
    expect(roomPanelModel(room, 'a')?.selectedId).toBe('a');
    expect(roomPanelModel(room, 'gone')?.selectedId).toBe('c');
  });

  it('has no turn time while the orchestrator is idle', () => {
    // Arrange
    const room: SceneRoom = { project: project(), clusters: [cluster(agent({ status: 'idle' }))] };

    // Act, Assert
    expect(roomPanelModel(room, null)?.orchestrators[0]?.turnSince).toBeNull();
  });

  it('lists finished subagents newest first, faded ones and folded ones together, up to a limit', () => {
    // Arrange
    const main = agent({ id: 'm' });
    const faded = { agent: agent({ id: 'f', kind: 'sub' }), slot: 0, finishedAt: 50 };
    const folded = Array.from({ length: MAX_PANEL_FINISHED + 2 }, (_, i) => ({
      agent: agent({ id: `old${i}`, kind: 'sub' }),
      finishedAt: 10 + i,
    }));
    const room: SceneRoom = { project: project(), clusters: [cluster(main, [faded], folded)] };

    // Act
    const one = roomPanelModel(room, null)?.orchestrators[0];

    // Assert
    expect(one?.finished[0]?.id).toBe('f');
    expect(one?.finished).toHaveLength(MAX_PANEL_FINISHED);
    expect(one?.moreFinished).toBe(3);
  });

  it('is nothing when the room is gone', () => {
    expect(roomPanelModel(undefined, null)).toBeNull();
  });
});
