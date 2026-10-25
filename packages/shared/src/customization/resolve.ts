import type { AgentLook, Customization } from './types';

export interface LookLayers {
  /** The agent's own choices. */
  agent?: AgentLook | undefined;
  /** The default of everybody in its room. */
  room?: AgentLook | undefined;
  /** The default of everybody of its account. */
  account?: AgentLook | undefined;
}

const LOOK_KEYS = ['skin', 'hairStyle', 'hairColor', 'outfit', 'accessory'] as const;

/** Field by field, the first layer that says something wins; undefined when no layer says anything. */
export function resolveLook(layers: LookLayers): AgentLook | undefined {
  const out: Record<string, unknown> = {};
  for (const layer of [layers.agent, layers.room, layers.account]) {
    if (layer === undefined) continue;
    for (const key of LOOK_KEYS) if (out[key] === undefined && layer[key] !== undefined) out[key] = layer[key];
  }
  return Object.keys(out).length === 0 ? undefined : (out as AgentLook);
}

/** Whether two looks say the same thing (the sprite and model caches key on this). */
export function sameLook(a: AgentLook | undefined, b: AgentLook | undefined): boolean {
  return lookSignature(a) === lookSignature(b);
}

export function lookSignature(look: AgentLook | undefined): string {
  if (look === undefined || LOOK_KEYS.every((key) => look[key] === undefined)) return '';
  return LOOK_KEYS.map((key) => String(look[key] ?? '')).join('|');
}

/** The layers that apply to an agent whose room and account are known. */
export function lookLayers(
  customization: Customization,
  agentId: string,
  projectId: string,
  accountId: string,
): LookLayers {
  return {
    agent: customization.agents[agentId]?.look,
    room: customization.rooms[projectId]?.look,
    account: customization.accounts[accountId]?.look,
  };
}
