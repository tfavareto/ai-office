// What the drawn layers under the terminals show, from the scene and its layout: one name line per room (with its
// counts) and one connector per subagent. Pure.
import { t } from '../../i18n';
import type { Rect } from './geometry';
import type { Layout } from './layout';
import { linkState, type LinkState } from './links';
import { peerPairs } from './roles';
import type { Scene } from './scene';

export interface FrameModel {
  roomId: string;
  name: string;
  /** The room's area (no box is drawn: its name line sits at the top left). */
  rect: Rect;
  meta: string;
}

export interface LinkModel {
  /** The subagent's id, or the two agents' for a connection between terminals. */
  id: string;
  from: Rect;
  to: Rect;
  state: LinkState | 'peer';
}

export function frameModels(scene: Scene, layout: Layout): FrameModel[] {
  return layout.frames.flatMap((frame) => {
    const room = scene.rooms.find((candidate) => candidate.project.id === frame.roomId);
    if (room === undefined) return [];
    const agents = room.clusters.flatMap((cluster) => [cluster.main, ...cluster.subs.map((sub) => sub.agent)]);
    const working = agents.filter((agent) => agent.status === 'working').length;
    const waiting = agents.filter((agent) => agent.status === 'waiting').length;
    return [
      {
        roomId: frame.roomId,
        name: room.project.name,
        rect: frame.rect,
        meta: t('pro.frame.meta', { sessions: room.clusters.length, working, waiting }),
      },
    ];
  });
}

/** The lines between terminals the person connected. */
function peerLinks(scene: Scene, layout: Layout): LinkModel[] {
  const mains = scene.rooms.flatMap((room) => room.clusters.map((cluster) => cluster.main));
  return peerPairs(mains).flatMap(({ from, to }) => {
    const fromRect = layout.nodes.get(from);
    const toRect = layout.nodes.get(to);
    return fromRect === undefined || toRect === undefined
      ? []
      : [{ id: `peer:${from}|${to}`, from: fromRect, to: toRect, state: 'peer' as const }];
  });
}

export function linkModels(scene: Scene, layout: Layout): LinkModel[] {
  return [...delegationLinks(scene, layout), ...peerLinks(scene, layout)];
}

function delegationLinks(scene: Scene, layout: Layout): LinkModel[] {
  return scene.rooms.flatMap((room) =>
    room.clusters.flatMap((cluster) => {
      const from = layout.nodes.get(cluster.main.id);
      if (from === undefined) return [];
      return cluster.subs.flatMap((sub) => {
        const to = layout.nodes.get(sub.agent.id);
        return to === undefined
          ? []
          : [{ id: sub.agent.id, from, to, state: linkState(sub.agent, sub.finishedAt !== undefined) }];
      });
    }),
  );
}
