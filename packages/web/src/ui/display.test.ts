import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { account, agent } from '../test/fixtures';
import {
  accountInitial,
  accountLabel,
  activityText,
  agentKindLabel,
  agentTitle,
  agentWaitingFor,
  isMsg,
  localized,
  permissionSuggestion,
  taskLabel,
  toolSummary,
} from './display';

afterEach(() => setLocale('pt-BR'));

describe('isMsg', () => {
  it('accepts keys with string, number and nested message parameters', () => {
    expect(isMsg({ key: 'a' })).toBe(true);
    expect(isMsg({ key: 'a', params: { n: 1, s: 'x', m: { key: 'b' } } })).toBe(true);
  });

  it('rejects anything else coming over the network', () => {
    expect(isMsg(null)).toBe(false);
    expect(isMsg('a')).toBe(false);
    expect(isMsg({ key: 3 })).toBe(false);
    expect(isMsg({ key: 'a', params: [1] })).toBe(false);
    expect(isMsg({ key: 'a', params: { n: { oops: true } } })).toBe(false);
  });
});

describe('localized', () => {
  const doing = { key: 'activity.read', params: { file: 'App.tsx' } };

  it('renders the message in the current language', () => {
    setLocale('en');
    expect(localized(doing, 'Lendo App.tsx')).toBe('Reading App.tsx');
    setLocale('es');
    expect(localized(doing, 'Lendo App.tsx')).toBe('Leyendo App.tsx');
  });

  it('shows the server text when there is no message or it is malformed', () => {
    setLocale('en');
    expect(localized(undefined, 'Lendo App.tsx')).toBe('Lendo App.tsx');
    expect(localized({ key: 7 }, 'Lendo App.tsx')).toBe('Lendo App.tsx');
    expect(localized({ key: 'unknown.key' }, 'Lendo App.tsx')).toBe('Lendo App.tsx');
  });

  it('translates activities, titles and waiting texts only when they carry a message', () => {
    setLocale('en');
    expect(activityText({ text: 'Pensando…', msg: { key: 'activity.think' } })).toBe('Thinking…');
    expect(activityText({ text: 'Corrigir o bug' })).toBe('Corrigir o bug');
    expect(agentTitle({ title: 'Corrigir o bug' })).toBe('Corrigir o bug');
    expect(agentTitle({})).toBeUndefined();
    expect(agentWaitingFor({ waitingFor: 'Responder uma pergunta', waitingForMsg: { key: 'waiting.answerQuestion' } })).toBe('Answer a question');
  });
});

describe('model labels', () => {
  it('labels the default account by language and keeps the folder name of the others', () => {
    expect(accountLabel(account({ label: 'Pessoal', isDefault: true }))).toBe('Pessoal');
    setLocale('en');
    expect(accountLabel(account({ label: 'Pessoal', isDefault: true }))).toBe('Personal');
    expect(accountLabel(account({ label: 'trabalho' }))).toBe('trabalho');
    setLocale('es');
    expect(accountLabel(account({ label: 'Pessoal', isDefault: true }))).toBe('Personal');
  });

  it('keeps the account initial in line with the localized label', () => {
    setLocale('en');
    expect(accountInitial(account({ label: 'Pessoal', initial: 'P', isDefault: true }))).toBe('P');
    expect(accountInitial(account({ label: 'trabalho', initial: 'T' }))).toBe('T');
  });

  it('names the kind of agent in the current language', () => {
    setLocale('en');
    expect(agentKindLabel(agent({ kind: 'main' }))).toBe('Main');
    expect(agentKindLabel(agent({ kind: 'sub', role: 'Explore' }))).toBe('Explore');
  });

  it('shows the "doing" form of a task while it is in progress', () => {
    const task = { title: 'Escrever testes', titleMsg: { key: 'demo.task.3.title' }, activeForm: 'Escrevendo testes', activeFormMsg: { key: 'demo.task.3.active' } };
    setLocale('en');
    expect(taskLabel({ ...task, status: 'in_progress' })).toBe('Writing the tests');
    expect(taskLabel({ ...task, status: 'pending' })).toBe('Write the tests');
    expect(taskLabel({ title: 'Sem mensagem', status: 'pending' })).toBe('Sem mensagem');
  });

  it('prefers the localized suggestion of a permission', () => {
    const permission = { suggestions: ['Sempre permitir Edit'], suggestionMsgs: [{ key: 'perm.suggestion.remember', params: { scope: 'session' } }] };
    setLocale('en');
    expect(permissionSuggestion(permission, 0)).toBe('Remember this decision for this session');
    expect(permissionSuggestion({ suggestions: ['Sempre permitir Edit'] }, 0)).toBe('Sempre permitir Edit');
  });
});

describe('toolSummary', () => {
  const tool = { kind: 'tool' as const, at: 1, id: 't', name: 'Read', summary: '📖 Lendo App.tsx' };

  it('renders the icon and the localized text when the entry carries a message', () => {
    setLocale('en');
    expect(toolSummary({ ...tool, icon: '📖', summaryMsg: { key: 'activity.read', params: { file: 'App.tsx' } } })).toBe('📖 Reading App.tsx');
  });

  it('keeps the server summary otherwise', () => {
    setLocale('en');
    expect(toolSummary(tool)).toBe('📖 Lendo App.tsx');
  });
});

describe('account labels from the server', () => {
  it('translates a non-default account that carries a label message', () => {
    setLocale('en');
    expect(accountLabel(account({ label: 'Trabalho', labelMsg: { key: 'account.default' } }))).toBe('Personal');
    expect(accountLabel(account({ label: 'Trabalho' }))).toBe('Trabalho');
  });
});
