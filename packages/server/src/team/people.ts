// From the merged view of the team (ages, as the host sent it) to the people the page draws (times on this computer's
// clock). Pure.
import type { TeamPerson, TeamViewMember } from '@ai-office/shared';

/** `receivedAt` is when the view arrived here; every age counts back from it. */
export function peopleFromView(members: readonly TeamViewMember[], receivedAt: number): TeamPerson[] {
  return members.map((member) => {
    const share = member.online ? member.share : undefined;
    return {
      id: member.id,
      name: member.name,
      device: member.device,
      host: member.host,
      online: member.online,
      ...(!member.online && member.lastSeenAgoMs !== undefined
        ? { lastSeenAt: receivedAt - member.lastSeenAgoMs }
        : {}),
      paused: share?.paused === true,
      rooms: share?.rooms ?? [],
      agents: (share?.agents ?? []).map((agent) => ({ ...agent, since: receivedAt - agent.sinceAgeMs })),
    };
  });
}
