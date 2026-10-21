// Synthetic builders for the rules tests (never real data). Not exported from the package.
import type { Rule } from '../model';
import type { RuleRequest } from './request';

export const PROJECT = '/demo/loja';

export function bash(command: string, over: Partial<RuleRequest> = {}): RuleRequest {
  return { toolName: 'Bash', input: { command }, summary: command, projectPath: PROJECT, accountId: 'acc1', ...over };
}

export function file(toolName: string, path: string, over: Partial<RuleRequest> = {}): RuleRequest {
  return { toolName, input: { file_path: path }, summary: path, projectPath: PROJECT, accountId: 'acc1', ...over };
}

export function fetchUrl(url: string, over: Partial<RuleRequest> = {}): RuleRequest {
  return { toolName: 'WebFetch', input: { url }, summary: url, projectPath: PROJECT, accountId: 'acc1', ...over };
}

let counter = 0;

export function rule(over: Partial<Rule> = {}): Rule {
  counter += 1;
  return {
    id: `r${counter}`,
    effect: 'allow',
    tool: 'Bash',
    matcher: { kind: 'command-prefix', value: 'npm test' },
    scope: {},
    enabled: true,
    createdAt: counter,
    hits: 0,
    ...over,
  };
}
