// Believable days for the time-lapse in demo mode (server `AI_OFFICE_DEMO=1` and the page's `?mock=1`): people walk in
// for their shifts, work in turns (read, search, edit, run the tests), call subagents who join a meeting, wait for a
// permission, commit, and one test run fails. Deterministic for a date and an agent, and told in message keys, so the
// activities are rendered in the user's language by the page.
import { type ActivityDraft, describeToolUse, doneDraft, errorDraft, localizeDraft, replyDraft, thinkingDraft } from '../activities';
import { fnv1a, mulberry32 } from '../hash';
import { type Locale, type Msg, msg, sourceText, translateShared } from '../i18n';
import type { SharedMessageKey } from '../i18n/messages/pt-BR';
import type { Agent } from '../model';
import { findPerson, pickName } from '../names';
import type { DayRange } from '../report/range';
import { basename } from '../format';
import { sortEvents } from '../timelapse/order';
import type { Timelapse, TimelapseAgent, TimelapseEvent, TimelapseProject, TimelapseTask } from '../timelapse/types';
import { DEMO_ACCOUNTS, DEMO_BRANCHES, DEMO_COMMANDS, DEMO_PROJECTS, DEMO_SEARCHES, DEMO_SUBAGENTS, DEMO_TASK_PLAN, DEMO_WEB, type DemoProjectSpec } from './content';
import { type Shift, demoShiftPlan } from './report';

const SEC = 1000;
const MIN = 60 * SEC;
const COMMIT_KEYS = 8;
const MAX_VISITORS = 3;
const TAIL_MS = 2 * MIN;
/** A shift that ends this close to now is still going on. */
const OPEN_SHIFT_MS = 12 * MIN;

type Rng = () => number;
const between = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const chance = (rng: Rng, probability: number): boolean => rng() < probability;

export interface DemoTimelapseInput {
  range: DayRange;
  now: number;
  /** Language of the commit subjects (they are plain text, not messages). */
  locale: Locale;
  /** The demo office's people: its main agents work the day, subagents are invented. */
  agents: readonly Agent[];
  /** An account id or "all". */
  account: string;
}

/** A person of the day before their events are told. */
interface Person {
  id: string;
  name: string;
  look: 'f' | 'm';
  accountId: string;
  spec: DemoProjectSpec;
  parentId?: string;
  role: string;
  roleMsg?: Msg;
  title?: Msg;
}

interface Day {
  range: DayRange;
  now: number;
  locale: Locale;
  agents: TimelapseAgent[];
  events: TimelapseEvent[];
  /** Which main agent has already had its failing test run. */
  failedTests: Set<string>;
}

const activity = (agent: number, at: number, draft: ActivityDraft): TimelapseEvent => ({
  at,
  type: 'activity',
  agent,
  kind: draft.kind,
  icon: draft.icon,
  text: draft.text,
  msg: draft.msg,
  ...(draft.error === true ? { error: true } : {}),
});

function promptActivity(agent: number, at: number): TimelapseEvent {
  const message = msg('timelapse.activity.prompt');
  return { at, type: 'activity', agent, kind: 'prompt', icon: '📨', text: sourceText(message), msg: message };
}

const commandDraft = (command: (typeof DEMO_COMMANDS)[number]): ActivityDraft => localizeDraft(describeToolUse('Bash', { command: command.command }), msg('activity.bash.run', { text: command.description.msg }));

/** One tool call of an agent working on `spec`: mostly reading and editing, sometimes searching or thinking. */
function toolDraft(rng: Rng, spec: DemoProjectSpec, allowCommand: boolean): { draft: ActivityDraft; command?: (typeof DEMO_COMMANDS)[number] } {
  const roll = rng();
  const file = spec.files[between(rng, 0, spec.files.length - 1)] as string;
  if (roll < 0.3) return { draft: describeToolUse('Read', { file_path: file }) };
  if (roll < 0.43) return { draft: describeToolUse('Grep', { pattern: DEMO_SEARCHES[between(rng, 0, DEMO_SEARCHES.length - 1)], path: basename(spec.path) }) };
  if (roll < 0.68) return { draft: describeToolUse('Edit', { file_path: file }) };
  if (roll < 0.74) return { draft: describeToolUse('Write', { file_path: file }) };
  if (roll < 0.8) return { draft: thinkingDraft() };
  if (roll < 0.84) return { draft: describeToolUse('WebFetch', { url: (DEMO_WEB[between(rng, 0, DEMO_WEB.length - 1)] as (typeof DEMO_WEB)[number]).url }) };
  if (roll < 0.9) return { draft: replyDraft() };
  if (!allowCommand) return { draft: describeToolUse('Read', { file_path: file }) };
  const command = DEMO_COMMANDS[between(rng, 0, DEMO_COMMANDS.length - 1)] as (typeof DEMO_COMMANDS)[number];
  return { draft: commandDraft(command), command };
}

function tasksOf(rng: Rng, done: number, total: number): TimelapseTask[] {
  const first = between(rng, 0, DEMO_TASK_PLAN.length - 1);
  return Array.from({ length: total }, (_, i) => {
    const plan = DEMO_TASK_PLAN[(first + i) % DEMO_TASK_PLAN.length] as (typeof DEMO_TASK_PLAN)[number];
    return {
      title: plan.title.text,
      titleMsg: plan.title.msg,
      activeForm: plan.activeForm.text,
      activeFormMsg: plan.activeForm.msg,
      status: i < done ? ('completed' as const) : i === done ? ('in_progress' as const) : ('pending' as const),
    };
  });
}

function commitSubject(locale: Locale, rng: Rng): string {
  return translateShared(locale, msg(`demo.report.commit.${between(rng, 1, COMMIT_KEYS)}` as SharedMessageKey));
}

// ---- one subagent ------------------------------------------------------------------------------------------------

/** A subagent walks in at `at`, works for a while on the same project and leaves; returns when it left. */
function runSubagent(day: Day, rng: Rng, parent: Person, parentIndex: number, spec: DemoProjectSpec, at: number, until: number): number {
  const kind = DEMO_SUBAGENTS[between(rng, 0, DEMO_SUBAGENTS.length - 1)] as (typeof DEMO_SUBAGENTS)[number];
  const id = `${parent.id}:sub-${day.agents.length}`;
  const taken = new Set(day.agents.map((agent) => agent.name));
  const person = pickName(id, taken);
  const index = day.agents.length;
  const stay = Math.min(between(rng, 50, 180) * SEC, until - at);
  day.agents.push({
    id,
    kind: 'sub',
    parentId: day.agents[parentIndex]?.id ?? parent.id,
    name: person.name,
    role: kind.type,
    title: kind.description.text,
    titleMsg: kind.description.msg,
    accountId: parent.accountId,
    projectId: spec.path,
    look: person.look,
    seed: fnv1a(id),
  });
  day.events.push({ at, type: 'arrive', agent: index }, { at, type: 'status', agent: index, status: 'working' });
  for (let t = at + between(rng, 4, 9) * SEC; t < at + stay; t += between(rng, 6, 16) * SEC) day.events.push(activity(index, t, toolDraft(rng, spec, false).draft));
  const leaveAt = at + stay;
  day.events.push({ at: leaveAt, type: 'leave', agent: index });
  return leaveAt;
}

// ---- one turn ----------------------------------------------------------------------------------------------------

interface TurnPlan {
  index: number;
  person: Person;
  projectIndex: number;
  /** Where in the turn a permission wait happens (step number), or -1. */
  waitAt: number;
  /** Where a subagent is called (step number), or -1. */
  subAt: number;
  commit: boolean;
}

function runShell(day: Day, rng: Rng, plan: TurnPlan, at: number, command: (typeof DEMO_COMMANDS)[number], until: number): number {
  const long = chance(rng, 0.18);
  const length = long ? between(rng, 150, 330) * SEC : between(rng, 18, 70) * SEC;
  const end = Math.min(until, at + length);
  const id = `shell-${plan.index}-${at}`;
  day.events.push({ at, type: 'shell', agent: plan.index, on: true, id, background: false, label: command.description.text, labelMsg: command.description.msg });
  day.events.push({ at: end, type: 'shell', agent: plan.index, on: false, id, background: false });
  if (command.command === 'npm test') {
    const failing = !day.failedTests.has(plan.person.id) && chance(rng, 0.45);
    if (failing) day.failedTests.add(plan.person.id);
    day.events.push({ at: end, type: 'test', agent: plan.index, runner: 'npm test', outcome: failing ? 'failed' : 'passed', passed: between(rng, 30, 70), ...(failing ? { failed: between(rng, 1, 3) } : {}) });
    if (failing) day.events.push(activity(plan.index, end + SEC, errorDraft('Bash')));
  }
  return end;
}

function runWait(day: Day, rng: Rng, plan: TurnPlan, at: number, until: number): number {
  const length = chance(rng, 0.3) ? between(rng, 150, 330) * SEC : between(rng, 20, 90) * SEC;
  const end = Math.min(until, at + length);
  const tool = chance(rng, 0.5) ? 'Edit' : 'Bash';
  const waitingForMsg = msg('waiting.approve', { tool });
  day.events.push({ at, type: 'status', agent: plan.index, status: 'waiting', waitingFor: sourceText(waitingForMsg), waitingForMsg });
  day.events.push({ at, type: 'permission', agent: plan.index, tool, durationMs: end - at });
  day.events.push({ at: end, type: 'status', agent: plan.index, status: 'working' });
  return end;
}

/** One request from the person: the agent works through a few dozen steps and rests. Returns when it finished. */
function runTurn(day: Day, rng: Rng, plan: TurnPlan, startAt: number, until: number): number {
  const { index, person } = plan;
  const steps = between(rng, 14, 34);
  const total = between(rng, 3, 5);
  let t = startAt;
  day.events.push(promptActivity(index, t), { at: t, type: 'status', agent: index, status: 'working' }, { at: t + SEC, type: 'tasks', agent: index, tasks: tasksOf(rng, 0, total) });
  let doneTasks = 0;
  let subs = 0;
  for (let step = 0; step < steps && t < until; step++) {
    t += between(rng, 5, 20) * SEC;
    if (t >= until) break;
    if (step === plan.waitAt) t = runWait(day, rng, plan, t, until);
    if (step === plan.subAt && subs < 2) {
      const call = DEMO_SUBAGENTS[between(rng, 0, DEMO_SUBAGENTS.length - 1)] as (typeof DEMO_SUBAGENTS)[number];
      day.events.push(activity(index, t, localizeDraft(describeToolUse('Task', { description: call.description.text }), msg('activity.subagent', { description: call.description.msg }))));
      runSubagent(day, rng, person, index, person.spec, t + 3 * SEC, until);
      subs++;
    }
    const tool = toolDraft(rng, person.spec, true);
    day.events.push(activity(index, t, tool.draft));
    if (tool.command !== undefined) t = runShell(day, rng, plan, t, tool.command, until);
    if (doneTasks < total - 1 && step > 0 && step % Math.ceil(steps / total) === 0) {
      doneTasks++;
      day.events.push({ at: t + SEC, type: 'tasks', agent: index, tasks: tasksOf(rng, doneTasks, total) });
    }
  }
  const end = Math.min(until, t + between(rng, 4, 12) * SEC);
  day.events.push(activity(index, end, doneDraft(end - startAt)), { at: end, type: 'status', agent: index, status: 'idle' }, { at: end, type: 'tasks', agent: index, tasks: tasksOf(rng, total, total).map((task) => ({ ...task, status: 'completed' as const })) });
  if (plan.commit && end - startAt > MIN) {
    const hash = fnv1a(`${person.id}|${end}`).toString(16).padStart(8, '0').slice(0, 7);
    day.events.push({ at: end - 4 * SEC, type: 'commit', project: plan.projectIndex, agent: index, hash, subject: commitSubject(day.locale, rng), branch: DEMO_BRANCHES[0] as string });
  }
  return end;
}

// ---- one person's day --------------------------------------------------------------------------------------------

function runShift(day: Day, rng: Rng, person: Person, index: number, projectIndex: number, shift: Shift, open: boolean): void {
  day.events.push({ at: shift.from, type: 'arrive', agent: index }, { at: shift.from, type: 'status', agent: index, status: 'idle' });
  let t = shift.from + between(rng, 20, 90) * SEC;
  let turns = 0;
  while (t < shift.to - MIN) {
    const plan: TurnPlan = {
      index,
      person,
      projectIndex,
      waitAt: chance(rng, 0.3) ? between(rng, 2, 6) : -1,
      subAt: chance(rng, 0.45) ? between(rng, 1, 5) : -1,
      commit: chance(rng, 0.45),
    };
    t = runTurn(day, rng, plan, t, shift.to - 10 * SEC);
    turns++;
    t += between(rng, turns % 3 === 0 ? 14 : 4, turns % 3 === 0 ? 38 : 14) * MIN;
  }
  if (!open) day.events.push({ at: shift.to, type: 'leave', agent: index });
}

function rosterOf(input: DemoTimelapseInput): Person[] {
  const mains = input.agents.filter((agent) => agent.kind === 'main' && (input.account === 'all' || agent.accountId === input.account));
  const people: Person[] = [];
  for (const agent of mains) {
    const spec = DEMO_PROJECTS.find((candidate) => candidate.path === agent.projectId);
    if (spec !== undefined) people.push({ id: agent.id, name: agent.name, look: agent.look, accountId: agent.accountId, spec, role: 'Principal', roleMsg: msg('agent.role.main') });
  }
  const account = DEMO_ACCOUNTS[0];
  if (account === undefined || (input.account !== 'all' && input.account !== account.id)) return people;
  // Colleagues of other projects who worked that day and are gone now: the office has more rooms than people today.
  const used = new Set(people.map((person) => person.spec.path));
  const rng = mulberry32(fnv1a(`visitors|${input.range.date}`));
  const spare = DEMO_PROJECTS.filter((spec) => !used.has(spec.path));
  const taken = new Set(people.map((person) => person.name));
  for (let i = 0; i < MAX_VISITORS && spare.length > 0; i++) {
    const spec = spare.splice(between(rng, 0, spare.length - 1), 1)[0] as DemoProjectSpec;
    const id = `${account.id}:visitor-${input.range.date}-${spec.name}`;
    const named = pickName(id, taken);
    taken.add(named.name);
    people.push({ id, name: named.name, look: findPerson(named.name)?.look ?? named.look, accountId: account.id, spec, role: 'Principal', roleMsg: msg('agent.role.main') });
  }
  return people;
}

/** The time-lapse of a day for the demo office. */
export function demoTimelapse(input: DemoTimelapseInput): Timelapse {
  const base = { date: input.range.date, generatedAt: input.now, account: input.account, start: input.range.start, end: input.range.end, demo: true as const };
  const day: Day = { range: input.range, now: input.now, locale: input.locale, agents: [], events: [], failedTests: new Set() };
  const mainIndexes: { person: Person; index: number; plan: NonNullable<ReturnType<typeof demoShiftPlan>> }[] = [];
  for (const person of rosterOf(input)) {
    const plan = demoShiftPlan(person.id, input.range, input.now);
    if (plan === undefined) continue;
    const index = day.agents.length;
    day.agents.push({ id: person.id, kind: 'main', name: person.name, role: person.role, ...(person.roleMsg !== undefined ? { roleMsg: person.roleMsg } : {}), accountId: person.accountId, projectId: person.spec.path, look: person.look, seed: fnv1a(person.id) });
    mainIndexes.push({ person, index, plan });
  }
  const firstArrival = new Map<string, number>();
  for (const { person, plan } of mainIndexes) firstArrival.set(person.spec.path, Math.min(firstArrival.get(person.spec.path) ?? Infinity, (plan.plan[0] as Shift).from));
  const projects: TimelapseProject[] = [...firstArrival]
    .sort((a, b) => a[1] - b[1])
    .map(([path], order) => ({ id: path, name: basename(path), order, seed: fnv1a(path) }));
  const projectIndex = new Map(projects.map((project, order) => [project.id, order]));
  for (const { person, index, plan } of mainIndexes) {
    const rng = mulberry32(fnv1a(`${person.id}|${input.range.date}|timelapse`));
    for (const shift of plan.plan) runShift(day, rng, person, index, projectIndex.get(person.spec.path) ?? 0, shift, input.now < input.range.end && input.now - shift.to < OPEN_SHIFT_MS);
  }
  const events = sortEvents(day.events.filter((event) => event.at < input.range.end && event.at <= input.now));
  if (events.length === 0) return { ...base, projects: [], agents: [], events: [] };
  const from = (events[0] as TimelapseEvent).at;
  const to = Math.min(input.range.end, input.now, Math.max(...events.map((event) => event.at)) + TAIL_MS);
  return { ...base, from, to, projects, agents: day.agents, events };
}
