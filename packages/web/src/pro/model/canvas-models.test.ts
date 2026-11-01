import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { agent, project } from '../../test/fixtures';
import { frameModels, linkModels } from './canvas-models';
import { computeLayout } from './layout';
import { layoutRooms, type Scene } from './scene';

beforeEach(() => setLocale('en'));

function scene(): Scene {
  const main = agent({ id: 'm1', kind: 'main', status: 'working' });
  const busy = agent({ id: 's1', kind: 'sub', status: 'working', parentId: 'm1' });
  const asking = agent({ id: 's2', kind: 'sub', status: 'waiting', parentId: 'm1' });
  const done = agent({ id: 's3', kind: 'sub', status: 'done', parentId: 'm1' });
  return {
    rooms: [
      {
        project: project({ id: 'p1', name: 'shop' }),
        clusters: [
          {
            main,
            subs: [
              { agent: busy, slot: 0 },
              { agent: asking, slot: 1 },
              { agent: done, slot: 2, finishedAt: 5 },
            ],
            collapsed: [],
            layout: { id: 'm1', rows: 1, slots: { s1: 0, s2: 1, s3: 2 } },
          },
        ],
      },
    ],
    memory: new Map(),
  };
}

describe('canvas models', () => {
  it('gives each room a name line with its counts', () => {
    // Arrange
    const current = scene();
    const layout = computeLayout(layoutRooms(current));

    // Act
    const frames = frameModels(current, layout);

    // Assert
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ roomId: 'p1', name: 'shop', meta: '1 session · 2 working · 1 waiting' });
  });

  it('draws one connector per subagent, in the state of that subagent', () => {
    const current = scene();
    const layout = computeLayout(layoutRooms(current));
    const links = linkModels(current, layout);
    expect(links.map((link) => [link.id, link.state])).toEqual([
      ['s1', 'flowing'],
      ['s2', 'waiting'],
      ['s3', 'done'],
    ]);
    expect(links[0]?.from).toEqual(layout.nodes.get('m1'));
    expect(links[0]?.to).toEqual(layout.nodes.get('s1'));
  });
});
