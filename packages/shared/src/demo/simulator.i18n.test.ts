import { describe, expect, test } from 'vitest';
import { truncate } from '../format';
import { type Locale, type Msg, sourceText, translateShared } from '../i18n';
import type { Agent, FeedItem, Notice } from '../model';
import { ACTIVITY_TEXT_MAX } from '../activities';
import { DEMO_ACCOUNTS, DEMO_PROJECTS } from './content';
import { createDemoSimulator } from './simulator';

const T0 = 1_800_000_000_000;
const RAW_KEY = /\b(activity|notice|demo|perm|waiting|agent|duration|account|transcript)\.[a-z][\w.]*/;

function run(seed: number, seconds: number) {
  let clock = T0;
  const sim = createDemoSimulator({ seed, now: () => clock, sessions: 6 });
  const feed: FeedItem[] = [];
  const notices: Notice[] = [];
  const seen = new Map<string, Agent>();
  for (let t = 0; t <= seconds * 1000; t += 250) {
    clock = T0 + t;
    const result = sim.tick(clock);
    feed.push(...result.feed);
    notices.push(...result.notices);
    for (const agent of sim.agents()) seen.set(`${agent.id}:${agent.status}:${agent.waitingFor ?? ''}:${agent.permission?.id ?? ''}`, agent);
  }
  return { sim, feed, notices, agents: [...seen.values()] };
}

/** Every localizable message the demo produced, with its pt-BR text. */
function collectMessages({ feed, notices, agents }: ReturnType<typeof run>): { message: Msg; text: string }[] {
  const pairs: { message: Msg; text: string }[] = [];
  const add = (message: Msg | undefined, text: string | undefined): void => {
    if (message !== undefined && text !== undefined) pairs.push({ message, text });
  };
  for (const item of feed) {
    add(item.activity.msg, item.activity.text);
    add(item.activity.detailMsg, item.activity.detail);
  }
  for (const notice of notices) add(notice.msg, notice.text);
  for (const agent of agents) {
    add(agent.roleMsg, agent.role);
    add(agent.titleMsg, agent.title);
    add(agent.waitingForMsg, agent.waitingFor);
    for (const task of agent.tasks) {
      add(task.titleMsg, task.title);
      add(task.activeFormMsg, task.activeForm);
    }
    for (const shell of agent.shells) add(shell.labelMsg, shell.label);
    add(agent.permission?.summaryMsg, agent.permission?.summary);
    agent.permission?.suggestionMsgs?.forEach((message, index) => add(message, agent.permission?.suggestions[index]));
  }
  return pairs;
}

describe('demo content is localizable', () => {
  const result = run(1, 900);
  const second = run(7, 900);

  test('every activity and notice carries a message whose pt-BR rendering is the text', () => {
    for (const { activity } of [...result.feed, ...second.feed]) {
      expect(activity.msg, activity.text).toBeDefined();
      const rendered = truncate(sourceText(activity.msg as Msg), ACTIVITY_TEXT_MAX);
      // Generated prompts nest their message, so only the label is comparable there.
      if (activity.kind === 'prompt') expect(activity.text.startsWith('Nova tarefa: “')).toBe(true);
      else expect(rendered, activity.text).toBe(activity.text);
    }
    for (const notice of [...result.notices, ...second.notices]) {
      expect(notice.msg, notice.text).toBeDefined();
      expect(sourceText(notice.msg as Msg)).toBe(notice.text);
    }
  });

  test('agents carry messages for roles, generated titles, tasks, shells, waiting reasons and permissions', () => {
    const agents = [...result.agents, ...second.agents];
    expect(agents.filter((a) => a.kind === 'main').every((a) => a.roleMsg !== undefined && a.titleMsg !== undefined)).toBe(true);
    expect(agents.filter((a) => a.kind === 'sub').every((a) => a.titleMsg !== undefined)).toBe(true);
    expect(agents.some((a) => a.tasks.length > 0)).toBe(true);
    expect(agents.flatMap((a) => a.tasks).every((t) => t.titleMsg !== undefined && t.activeFormMsg !== undefined)).toBe(true);
    expect(agents.flatMap((a) => a.shells).every((s) => s.labelMsg !== undefined)).toBe(true);
    expect(agents.some((a) => a.waitingForMsg !== undefined)).toBe(true);
    const permissions = agents.flatMap((a) => (a.permission ? [a.permission] : []));
    expect(permissions.length).toBeGreaterThan(0);
    expect(permissions.every((p) => (p.suggestionMsgs?.length ?? 0) === p.suggestions.length)).toBe(true);
  });

  test('every message of the story renders in Portuguese as its text, and in English and Spanish without leaking keys', () => {
    // Distinct messages only: a long story repeats the same ones thousands of times.
    const distinct = new Map<string, { message: Msg; text: string }>();
    for (const pair of [...collectMessages(result), ...collectMessages(second)]) distinct.set(JSON.stringify([pair.message, pair.text]), pair);
    const pairs = [...distinct.values()];
    expect(pairs.length).toBeGreaterThan(100);
    for (const { message, text } of pairs) {
      for (const locale of ['en', 'es'] as Locale[]) {
        const rendered = translateShared(locale, message);
        expect(rendered, `${locale} ${message.key}`).not.toMatch(RAW_KEY);
        expect(rendered, `${locale} ${message.key}`).not.toMatch(/[{}]/);
        expect(rendered.length).toBeGreaterThan(0);
      }
      // pt-BR rendering equals the text, apart from truncated labels.
      const pt = translateShared('pt-BR', message);
      expect(pt === text || pt.startsWith(text.split('…')[0] as string)).toBe(true);
    }
  });

  test('notices read naturally in English and Spanish', () => {
    const texts = (locale: Locale): string[] => result.notices.map((notice) => translateShared(locale, notice.msg as Msg));
    expect(texts('en').some((text) => /^.+ finished in \d+ (s|min)/.test(text))).toBe(true);
    expect(texts('es').some((text) => /^.+ terminó en \d+ (s|min)/.test(text))).toBe(true);
    expect(texts('en').some((text) => /^.+ needs you: /.test(text))).toBe(true);
    expect(texts('en').some((text) => /^.+ opened a session in /.test(text))).toBe(true);
  });

  test('catalog prompts have a message for every project', () => {
    for (const project of DEMO_PROJECTS) {
      expect(project.prompts.length).toBeGreaterThan(0);
      for (const prompt of project.prompts) {
        expect(sourceText(prompt.msg)).toBe(prompt.text);
        expect(translateShared('en', prompt.msg)).not.toBe(prompt.text);
      }
    }
  });

  test('the default demo account is flagged so the client localizes "Pessoal"', () => {
    expect(DEMO_ACCOUNTS.find((account) => account.id === 'demo-pessoal')).toMatchObject({ label: 'Pessoal', isDefault: true });
  });

  test('permission suggestions have messages that render in English', () => {
    const permissions = result.agents.flatMap((a) => (a.permission ? [a.permission] : []));
    const labels = permissions.flatMap((p) => (p.suggestionMsgs ?? []).map((message) => translateShared('en', message)));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => /^(Always allow|Allow edits)/.test(label))).toBe(true);
    expect(permissions.some((p) => p.summaryMsg !== undefined && /^(Edit|Access) /.test(translateShared('en', p.summaryMsg)))).toBe(true);
  });

  test('a denial leaves an activity with a message', () => {
    let clock = T0;
    const sim = createDemoSimulator({ seed: 1, now: () => clock });
    for (let t = 0; t <= 6000; t += 250) {
      clock = T0 + t;
      sim.tick(clock);
    }
    const waiting = sim.agents().find((a) => a.permission !== undefined) as Agent;
    expect(sim.decidePermission((waiting.permission as { id: string }).id, { behavior: 'deny', message: 'não', locale: 'en' })).toBe(true);
    clock += 250;
    const denied = sim.tick(clock).feed.find((item) => item.activity.icon === '🚫');
    expect(denied?.activity).toMatchObject({ text: 'Pedido recusado por você', detail: 'não', msg: { key: 'activity.denied' } });
    expect(translateShared('en', denied?.activity.msg as Msg)).toBe('Request denied by you');
  });

  test('messages keep the sender locale and a denial is an activity with a message', () => {
    const sim = createDemoSimulator({ seed: 1, now: () => T0 });
    const target = sim.agents().find((a) => a.kind === 'main') as Agent;
    const [sent] = sim.sendMessage([target.id], 'Hello', T0, 'en');
    expect(sent).toMatchObject({ text: 'Hello', locale: 'en' });
    const [plain] = sim.sendMessage([target.id], 'Oi', T0);
    expect(plain?.locale).toBeUndefined();
  });
});
