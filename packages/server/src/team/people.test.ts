import { describe, expect, test } from 'vitest';
import type { TeamViewMember } from '@ai-office/shared';
import { peopleFromView } from './people';

const member = (extra: Partial<TeamViewMember> = {}): TeamViewMember => ({
  id: 'm1',
  name: 'Ana',
  device: 'pc',
  host: false,
  online: true,
  ...extra,
});

describe('peopleFromView', () => {
  test('counts ages back from the moment the view arrived, so clocks need not agree', () => {
    const people = peopleFromView(
      [
        member({
          share: {
            rooms: [{ key: 'r', index: 1 }],
            agents: [
              { key: 'a', name: 'Bia', roomKey: 'r', kind: 'main', status: 'idle', sinceAgeMs: 4000, look: 'f' },
            ],
          },
        }),
        member({ id: 'm2', online: false, lastSeenAgoMs: 60_000 }),
      ],
      100_000,
    );

    expect(people[0]?.agents[0]?.since).toBe(96_000);
    expect(people[1]).toMatchObject({ online: false, lastSeenAt: 40_000, agents: [], rooms: [] });
  });

  test('an offline member shows nothing even if a stale share came along; a paused one is marked', () => {
    const share = { rooms: [], agents: [], paused: true as const };
    expect(peopleFromView([member({ online: false, share })], 0)[0]?.paused).toBe(false);
    expect(peopleFromView([member({ share })], 0)[0]?.paused).toBe(true);
  });
});
