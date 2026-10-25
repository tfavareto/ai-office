// Changes to a customization document as a JSON merge patch (RFC 7386): an object merges into the document, `null`
// removes a key, anything else replaces. A request names only what it changes, and `null` is "reset this".
import { type ReadResult, isPlainObject, readCustomization } from './validate';
import { MAX_CUSTOM_AGENTS, type Customization } from './types';

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['version', 'agents', 'rooms', 'accounts', 'order']);

function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function mergeValue(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = {};
  if (isPlainObject(target)) for (const [key, value] of Object.entries(target)) assign(out, key, value);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else assign(out, key, mergeValue(out[key], value));
  }
  return out;
}

/** The oldest customizations of agents go first when a patch would pass the cap: sessions come and go. */
function evictOldAgents(agents: unknown): unknown {
  if (!isPlainObject(agents)) return agents;
  const entries = Object.entries(agents);
  return entries.length <= MAX_CUSTOM_AGENTS ? agents : Object.fromEntries(entries.slice(-MAX_CUSTOM_AGENTS));
}

/** `current` with `patch` applied, validated like a request. */
export function applyCustomizationPatch(current: Customization, patch: unknown): ReadResult {
  if (!isPlainObject(patch)) return { ok: false, error: { error: 'invalid-body' } };
  const unknownKey = Object.keys(patch).find((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknownKey !== undefined) return { ok: false, error: { error: 'invalid-body', field: unknownKey } };
  const merged = mergeValue(current, { ...patch, version: current.version });
  if (!isPlainObject(merged)) return { ok: false, error: { error: 'invalid-body' } };
  const withCaps = { ...merged, agents: evictOldAgents(merged.agents) };
  return readCustomization(withCaps, true);
}
