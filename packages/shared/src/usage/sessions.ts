// Names the sessions of a usage view after the people of the office who work (or worked) in them.
import type { Agent } from '../model';
import type { UsageDetail, UsageSessionRow } from './types';

/** Office agent of a session row: the main agent, or the subagent with that id. */
function agentOf(row: UsageSessionRow, agents: readonly Agent[]): Agent | undefined {
  return agents.find((agent) => {
    if (agent.accountId !== row.account || agent.sessionId !== row.session) return false;
    if (row.agent === undefined) return agent.kind === 'main';
    return agent.kind === 'sub' && agent.id.endsWith(`:${row.agent}`);
  });
}

function describeSession(row: UsageSessionRow, agents: readonly Agent[]): UsageSessionRow {
  const agent = agentOf(row, agents);
  if (agent === undefined) return row;
  return {
    ...row,
    officeId: agent.id,
    ...(agent.title !== undefined ? { title: agent.title } : {}),
    ...(agent.titleMsg !== undefined ? { titleMsg: agent.titleMsg } : {}),
    ...(agent.kind === 'sub' ? { role: agent.role, ...(agent.roleMsg !== undefined ? { roleMsg: agent.roleMsg } : {}) } : {}),
  };
}

/** The view with a title and a link to the person for every session the office knows. */
export function withOfficeSessions(detail: UsageDetail, agents: readonly Agent[]): UsageDetail {
  return { ...detail, bySession: detail.bySession.map((row) => describeSession(row, agents)) };
}
