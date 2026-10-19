import type { Activity, ActivityKind, Agent, AgentStatus, OfficeSnapshot, Project, ShellJob } from '@ai-office/shared';

const ACTIVITIES: [ActivityKind, string, string][] = [
  ['edit', '✏️', 'Editando App.tsx'], ['read', '📖', 'Lendo package.json'], ['bash', '⚡', 'Rodando os testes'],
  ['search', '🔎', 'Buscando "useStore"'], ['write', '📝', 'Criando store.ts'], ['web', '🌐', 'Pesquisando na web'],
  ['think', '💭', 'Pensando no plano'], ['task', '✅', 'Atualizando tarefas'], ['edit', '✏️', 'Editando layout.css'],
];
const NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Heitor', 'Iara', 'João', 'Karen', 'Léo', 'Marina', 'Nando', 'Olívia', 'Paulo', 'Quésia', 'Rafa', 'Sofia', 'Tiago'];
const PROJECTS = ['ai-office', 'loja-online', 'api-pagamentos', 'site-institucional', 'app-mobile', 'data-pipeline', 'design-system', 'infra-k8s', 'blog-tech', 'crm-interno', 'bot-slack', 'docs-portal'];

export interface FixtureOptions {
  projects: number;
  agents: number;
  /** Seconds per status cycle step. */
  step: number;
  /** Project indices that are closed (their agents are gone too). */
  skip?: number[];
  /** Force every agent into one status. */
  force?: AgentStatus;
  /** Agents without tasks: boards show the room state instead of a task. */
  noTasks?: boolean;
}

function activity(i: number, now: number): Activity {
  const [kind, icon, text] = ACTIVITIES[i % ACTIVITIES.length];
  return { id: `act-${i}`, at: now, kind, icon, text };
}

/** Deterministic synthetic office: agents cycle through statuses as time passes. */
export function makeFixture(opts: FixtureOptions, now: number): OfficeSnapshot {
  const all: Project[] = Array.from({ length: opts.projects }, (_, i) => ({
    id: `/work/${PROJECTS[i % PROJECTS.length]}${i >= PROJECTS.length ? i : ''}`,
    name: PROJECTS[i % PROJECTS.length] + (i >= PROJECTS.length ? `-${i}` : ''),
    path: `/work/${PROJECTS[i % PROJECTS.length]}`,
    seed: 31337 + i * 104729,
    order: i,
  }));
  const projects = all.filter((_, i) => !opts.skip?.includes(i));
  const tick = Math.floor(now / 1000 / opts.step);
  const agents: Agent[] = [];
  for (let i = 0; i < opts.agents; i++) {
    const projectIndex = i % opts.projects;
    if (opts.skip?.includes(projectIndex)) continue;
    const project = all[projectIndex];
    const phase = (tick + i * 3) % 14;
    const status: AgentStatus = opts.force ?? (phase < 7 ? 'working' : phase < 8 ? 'waiting' : phase < 12 ? 'idle' : 'working');
    const sub = i >= opts.projects * 2 && i % 3 === 0;
    const shells: ShellJob[] = !sub && phase === 12 ? [{ id: 's', label: 'npm test', background: false, kind: 'shell', startedAt: now - 70_000 }] : [];
    agents.push({
      id: `agent-${i}`,
      kind: sub ? 'sub' : 'main',
      sessionId: `session-${i}`,
      accountId: i % 3 === 0 ? 'work' : 'personal',
      projectId: project.id,
      parentId: sub ? `agent-${i % opts.projects}` : undefined,
      name: NAMES[i % NAMES.length],
      role: sub ? 'Explore' : 'Principal',
      look: i % 2 === 0 ? 'f' : 'm',
      seed: 1000 + i * 7717,
      status,
      statusSince: now - 5000,
      activity: status === 'working' ? activity(tick + i, now) : undefined,
      recent: [],
      tasks: sub || opts.noTasks ? [] : [
        { id: 't1', title: 'Criar a loja', status: 'completed' },
        { id: 't2', title: 'Ligar o carrinho', activeForm: 'Ligando o carrinho', status: 'in_progress' },
        { id: 't3', title: 'Publicar', status: 'pending' },
      ],
      shells,
      stats: { toolCalls: 12, tokensIn: 1000, tokensOut: 400, linesAdded: 12, linesRemoved: 3, subagents: 0 },
      startedAt: now - 600_000,
      lastEventAt: now,
      waitingFor: status === 'waiting' ? 'Aprovar um comando' : undefined,
    });
  }
  return {
    rev: tick,
    serverTime: now,
    meta: { version: 'dev', startedAt: now - 3600_000, local: true, demo: true },
    accounts: [
      { id: 'personal', label: 'Pessoal', initial: 'P', color: '#4f86f7', dir: '/tmp/a' },
      { id: 'work', label: 'Trabalho', initial: 'T', color: '#e0795a', dir: '/tmp/b' },
    ],
    projects,
    agents,
    usage: [],
  };
}
