// pt-BR summaries for permission requests and labels for Claude Code's "always allow" suggestions.
import { basename, parseMcpName, truncate } from '@ai-office/shared';
import { asArray, asRecord, asString } from '../util/fs-safe';

const SUMMARY_MAX = 100;
const MAX_STRING = 2000;
const MAX_ITEMS = 50;
const MAX_DEPTH = 6;

/** Short human summary of what the tool wants to do. */
export function summarizePermission(toolName: string, rawInput: unknown): string {
  const input = asRecord(rawInput);
  const file = asString(input.file_path) ?? asString(input.path) ?? asString(input.notebook_path);
  switch (toolName) {
    case 'Bash':
      return truncate(asString(input.command) ?? 'Executar um comando', SUMMARY_MAX);
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editar ${file === undefined ? 'um arquivo' : truncate(file, 80)}`;
    case 'Write':
      return `Escrever ${file === undefined ? 'um arquivo' : truncate(file, 80)}`;
    case 'Read':
      return `Ler ${file === undefined ? 'um arquivo' : truncate(file, 80)}`;
    case 'WebFetch': {
      const url = asString(input.url) ?? '';
      const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url)?.[1];
      return `Acessar ${host ?? truncate(url, 60)}`;
    }
    case 'WebSearch':
      return `Pesquisar “${truncate(asString(input.query) ?? '', 60)}”`;
    default: {
      const mcp = parseMcpName(toolName);
      if (mcp !== undefined) return `${mcp.server}: ${mcp.tool}`;
      return truncate(`${toolName}${file !== undefined ? ` ${basename(file)}` : ''}`, SUMMARY_MAX);
    }
  }
}

function scopeLabel(destination: string | undefined): string {
  if (destination === 'session') return ' nesta sessão';
  if (destination === 'localSettings' || destination === 'projectSettings') return ' neste projeto';
  if (destination === 'userSettings') return ' sempre';
  return '';
}

/** Label for one `permission_suggestions` entry, e.g. "Sempre permitir Bash(npm test:*) neste projeto". */
export function suggestionLabel(raw: unknown): string {
  const suggestion = asRecord(raw);
  const scope = scopeLabel(asString(suggestion.destination));
  switch (suggestion.type) {
    case 'addRules': {
      const rules = asArray(suggestion.rules)
        .map((rule) => {
          const record = asRecord(rule);
          const tool = asString(record.toolName) ?? 'ferramenta';
          const content = asString(record.ruleContent);
          return content === undefined ? tool : `${tool}(${content})`;
        })
        .join(', ');
      const verb = suggestion.behavior === 'deny' ? 'Sempre recusar' : 'Sempre permitir';
      return truncate(`${verb} ${rules}${scope}`, 120);
    }
    case 'setMode':
      return `Mudar para o modo ${asString(suggestion.mode) ?? 'novo'}${scope}`;
    case 'addDirectories':
      return truncate(`Permitir acesso a ${asArray(suggestion.directories).filter((d) => typeof d === 'string').join(', ')}${scope}`, 120);
    default:
      return truncate(`Lembrar esta decisão${scope}`, 120);
  }
}

/** Deep-trims untrusted tool input: long strings are cut, arrays and depth are capped. */
export function trimInput(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => trimInput(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS)) result[key] = trimInput(item, depth + 1);
  return result;
}
