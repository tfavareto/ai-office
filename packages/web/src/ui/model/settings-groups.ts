// The groups of the settings popover: which exist, which start open, and how the open ones are remembered.

export const SETTINGS_GROUP_IDS = ['general', 'office', 'sound', 'data', 'automation', 'team', 'about'] as const;

export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number];

/** Only the first group starts open, so the popover opens short. */
export const DEFAULT_OPEN_GROUPS: readonly SettingsGroupId[] = ['general'];

function isGroupId(value: unknown): value is SettingsGroupId {
  return typeof value === 'string' && (SETTINGS_GROUP_IDS as readonly string[]).includes(value);
}

/** Open groups from stored data: unknown ids and repeats are dropped, a missing or malformed value gives the default. */
export function parseOpenGroups(raw: unknown): readonly SettingsGroupId[] {
  if (!Array.isArray(raw)) return DEFAULT_OPEN_GROUPS;
  const open = new Set(raw.filter(isGroupId));
  return SETTINGS_GROUP_IDS.filter((id) => open.has(id));
}

/** The open groups after opening or closing one; the result keeps the order of the groups. */
export function toggleGroup(open: readonly SettingsGroupId[], id: SettingsGroupId): readonly SettingsGroupId[] {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return SETTINGS_GROUP_IDS.filter((groupId) => next.has(groupId));
}
