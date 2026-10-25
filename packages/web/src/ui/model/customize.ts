// What the customization editors do with the data: drafts of the agent and the room forms, the look a draft would
// give (for the live preview), the patch a draft turns into, and the list the settings manager shows. Pure.
import {
  type Agent,
  type AgentLook,
  type Customization,
  type OfficeSnapshot,
  type Project,
  type RoomCustomization,
  type RoomTheme,
  checkAlias,
  checkName,
  resolveLook,
} from '@ai-office/shared';

/** Where an agent's look choices are kept: for it alone, for its whole room, or for its account. */
export type LookScope = 'agent' | 'room' | 'account';

export interface AgentDraft {
  /** The name typed; empty means the name the office picked. */
  name: string;
  scope: LookScope;
  look: AgentLook;
}

export interface RoomDraft {
  alias: string;
  theme: RoomTheme;
  /** The outfit the whole team wears (the room's default look). */
  teamOutfit: AgentLook['outfit'] | undefined;
  pinned: boolean;
  hidden: boolean;
}

export type LabelProblem = 'empty' | 'too-long' | 'invalid-chars';

const LOOK_KEYS = ['skin', 'hairStyle', 'hairColor', 'outfit', 'accessory'] as const;

/** The main agent a subagent takes its team (room and account) defaults from. */
function teamOf(agent: Agent, agents: readonly Agent[]): Agent {
  return (
    (agent.parentId !== undefined ? agents.find((candidate) => candidate.id === agent.parentId) : undefined) ?? agent
  );
}

export function lookOfScope(
  custom: Customization,
  agent: Agent,
  agents: readonly Agent[],
  scope: LookScope,
): AgentLook {
  const team = teamOf(agent, agents);
  if (scope === 'room') return custom.rooms[team.projectId]?.look ?? {};
  if (scope === 'account') return custom.accounts[team.accountId]?.look ?? {};
  return custom.agents[agent.id]?.look ?? {};
}

export function agentDraft(
  custom: Customization,
  agent: Agent,
  agents: readonly Agent[],
  scope: LookScope,
): AgentDraft {
  return { name: custom.agents[agent.id]?.name ?? '', scope, look: { ...lookOfScope(custom, agent, agents, scope) } };
}

/** The look the agent would have with the draft saved: the draft replaces the layer it is for. */
export function previewLook(
  custom: Customization,
  agent: Agent,
  agents: readonly Agent[],
  draft: AgentDraft,
): AgentLook | undefined {
  const team = teamOf(agent, agents);
  const layer = (scope: LookScope, stored: AgentLook | undefined): AgentLook | undefined =>
    draft.scope === scope ? draft.look : stored;
  return resolveLook({
    agent: layer('agent', custom.agents[agent.id]?.look),
    room: layer('room', custom.rooms[team.projectId]?.look),
    account: layer('account', custom.accounts[team.accountId]?.look),
  });
}

export function labelProblem(check: ReturnType<typeof checkName>): LabelProblem | null {
  return check.ok ? null : check.reason;
}

/** Why a name cannot be used, or null; an empty name is allowed (it brings the picked one back). */
export function nameProblem(name: string): LabelProblem | null {
  return name.trim() === '' ? null : labelProblem(checkName(name));
}

export function aliasProblem(alias: string): LabelProblem | null {
  return alias.trim() === '' ? null : labelProblem(checkAlias(alias));
}

/** The merge-patch entries for fields of `next` that differ from `stored`: a cleared field becomes null. */
function fieldPatch<T extends object>(stored: T, next: T, keys: readonly (keyof T)[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (stored[key] === next[key]) continue;
    out[key as string] = next[key] === undefined ? null : next[key];
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** The patch that saves an agent draft, or null when nothing changed. */
export function agentPatch(
  custom: Customization,
  agent: Agent,
  agents: readonly Agent[],
  draft: AgentDraft,
): object | null {
  const team = teamOf(agent, agents);
  const look = fieldPatch(lookOfScope(custom, agent, agents, draft.scope), draft.look, LOOK_KEYS);
  const trimmed = checkName(draft.name);
  const stored = custom.agents[agent.id]?.name;
  const name = draft.name.trim() === '' ? undefined : trimmed.ok ? trimmed.value : stored;
  const nameChange = name === stored ? null : { name: name ?? null };
  const patch: Record<string, unknown> = {};
  if (nameChange !== null) patch.agents = { [agent.id]: nameChange };
  if (look !== null) {
    if (draft.scope === 'agent') patch.agents = { [agent.id]: { ...nameChange, look } };
    else if (draft.scope === 'room') patch.rooms = { [team.projectId]: { look } };
    else patch.accounts = { [team.accountId]: { look } };
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

export function roomDraft(custom: Customization, project: Project): RoomDraft {
  const room: RoomCustomization = custom.rooms[project.id] ?? {};
  // What the room shows now: a finish the demo gave it counts too, with the person's choices on top.
  return {
    alias: room.alias ?? (project.originalName !== undefined ? project.name : ''),
    theme: { ...project.theme, ...room.theme },
    teamOutfit: room.look?.outfit,
    pinned: room.pinned === true,
    hidden: room.hidden === true,
  };
}

const THEME_KEYS = ['color', 'floor', 'wall', 'plants', 'sign'] as const;

/** The patch that saves a room draft, or null when nothing changed. */
export function roomPatch(custom: Customization, project: Project, draft: RoomDraft): object | null {
  const stored = roomDraft(custom, project);
  const out: Record<string, unknown> = {};
  const alias = checkAlias(draft.alias);
  const nextAlias = draft.alias.trim() === '' ? undefined : alias.ok ? alias.value : stored.alias || undefined;
  if (nextAlias !== (stored.alias || undefined)) out.alias = nextAlias ?? null;
  const theme = fieldPatch(stored.theme, draft.theme, THEME_KEYS);
  if (theme !== null) out.theme = theme;
  if (draft.teamOutfit !== stored.teamOutfit) out.look = { outfit: draft.teamOutfit ?? null };
  if (draft.pinned !== stored.pinned) out.pinned = draft.pinned ? true : null;
  if (draft.hidden !== stored.hidden) out.hidden = draft.hidden ? true : null;
  return Object.keys(out).length === 0 ? null : { rooms: { [project.id]: out } };
}

/** Patch that resets one agent, room or account entirely. */
export function resetPatch(kind: 'agents' | 'rooms' | 'accounts', id: string): object {
  return { [kind]: { [id]: null } };
}

export interface CustomizedItem {
  kind: 'agent' | 'room' | 'account';
  id: string;
  /** The name to show: the chosen one, the alias, or the account's label. */
  label: string;
  /** What was changed, as catalog keys of the kinds of change (name, look, theme...). */
  changes: readonly ('name' | 'look' | 'alias' | 'theme' | 'team' | 'pinned' | 'hidden')[];
}

/** The things the person changed, for the settings manager: rooms, agents (of the office now first), accounts. */
export function customizedItems(
  custom: Customization,
  snapshot: OfficeSnapshot | null,
  unknown: string,
): CustomizedItem[] {
  const present = new Map((snapshot?.agents ?? []).map((agent) => [agent.id, agent]));
  const rooms = new Map((snapshot?.projects ?? []).map((project) => [project.id, project]));
  const accounts = new Map((snapshot?.accounts ?? []).map((account) => [account.id, account]));
  const items: CustomizedItem[] = [];
  for (const [id, room] of Object.entries(custom.rooms)) {
    const changes: CustomizedItem['changes'][number][] = [];
    if (room.alias !== undefined) changes.push('alias');
    if (room.theme !== undefined) changes.push('theme');
    if (room.look !== undefined) changes.push('team');
    if (room.pinned === true) changes.push('pinned');
    if (room.hidden === true) changes.push('hidden');
    const label =
      room.alias ?? rooms.get(id)?.originalName ?? rooms.get(id)?.name ?? id.split('/').filter(Boolean).pop() ?? id;
    items.push({ kind: 'room', id, label, changes });
  }
  const agentEntries = Object.entries(custom.agents).sort(
    ([a], [b]) => Number(present.has(b)) - Number(present.has(a)),
  );
  for (const [id, agent] of agentEntries) {
    const changes: CustomizedItem['changes'][number][] = [];
    if (agent.name !== undefined) changes.push('name');
    if (agent.look !== undefined) changes.push('look');
    items.push({ kind: 'agent', id, label: agent.name ?? present.get(id)?.name ?? unknown, changes });
  }
  for (const [id, account] of Object.entries(custom.accounts)) {
    items.push({
      kind: 'account',
      id,
      label: accounts.get(id)?.label ?? id,
      changes: account.look !== undefined ? ['look'] : [],
    });
  }
  return items;
}

/** How many things are customized (rooms, agents, accounts and the order). */
export function customizationCount(custom: Customization): number {
  return (
    Object.keys(custom.agents).length +
    Object.keys(custom.rooms).length +
    Object.keys(custom.accounts).length +
    (custom.order.length > 0 ? 1 : 0)
  );
}
