// The "Registro" tab: every decision a rule made for you (or declined to make because the request was risky), newest
// first, with filters by outcome, by text and by rule.
import type { AutoDecision } from '@ai-office/shared';
import { t, type TextKey } from '../../i18n';
import type { AppContext, Component } from '../context';
import { KeyedList, h, setAttr, setText, toggleClass, type KeyedEntry } from '../dom';
import { formatAgo } from '../format';
import { filterLog, folderName, type OutcomeFilter } from '../model/rules';
import { ruleLabel } from '../rules-text';
import { button, createSegmented, emptyNote } from '../widgets';

const OUTCOMES: readonly OutcomeFilter[] = ['all', 'allow', 'deny', 'ask'];
const RISK_KEYS = ['delete', 'sudo', 'force-push', 'reset', 'permissions', 'pipe-shell', 'disk', 'data', 'sensitive-file'];

function riskText(reason: string): string {
  if (RISK_KEYS.includes(reason)) return t(`inbox.risk.${reason}` as TextKey);
  return t(reason === 'inline-code' ? 'rules.danger.inlineCode' : 'rules.danger.command');
}

class LogRow {
  private readonly el = h('li', { class: 'ao-log-row' });
  private readonly badge = h('span', { class: 'ao-rule-badge' });
  private readonly who = h('strong', { class: 'ao-log-who' });
  private readonly tool = h('span', { class: 'ao-tool-chip' });
  private readonly subject = h('code', { class: 'ao-log-subject' });
  private readonly demo = h('span', { class: 'ao-log-demo', hidden: true }, t('rules.log.demo'));
  private readonly time = h('span', { class: 'ao-log-time' });
  private readonly rule = h('span', { class: 'ao-log-rule' });
  private readonly why = h('p', { class: 'ao-log-why', hidden: true });

  constructor(private readonly ctx: AppContext) {
    this.el.append(
      h('div', { class: 'ao-log-head' }, this.badge, this.who, this.tool, this.demo, h('span', { class: 'ao-inbox-spacer' }), this.time),
      this.subject,
      h('div', { class: 'ao-log-meta' }, this.rule),
      this.why,
    );
  }

  entry(): KeyedEntry<AutoDecision> {
    return { el: this.el, update: (entry) => this.update(entry) };
  }

  private update(entry: AutoDecision): void {
    setText(this.badge, t(`rules.log.badge.${entry.outcome}` as TextKey));
    this.badge.className = `ao-rule-badge ao-rule-badge--${entry.outcome}`;
    setText(this.who, entry.projectPath === undefined ? entry.agentName : `${entry.agentName} · ${folderName(entry.projectPath)}`);
    setText(this.tool, entry.requestTool);
    setText(this.subject, entry.subject);
    this.demo.hidden = entry.demo !== true;
    setText(this.time, formatAgo(this.ctx.now() - entry.at));
    setAttr(this.time, 'title', new Date(entry.at).toLocaleString());
    setText(this.rule, t('rules.log.byRule', { rule: ruleLabel(entry) }));
    this.why.hidden = entry.blockedBy === undefined;
    if (entry.blockedBy !== undefined) setText(this.why, t('rules.log.askedWhy', { reason: riskText(entry.blockedBy) }));
    toggleClass(this.el, 'is-ask', entry.outcome === 'ask');
  }
}

export class RulesLog implements Component {
  readonly el = h('div', { class: 'ao-rules-log' });
  private readonly outcome = createSegmented<OutcomeFilter>(
    t('rules.log.outcome'),
    OUTCOMES.map((value) => ({ value, label: t(`rules.log.outcome.${value}` as TextKey) })),
    (value) => this.ctx.rules.setFilter({ outcome: value }),
  );
  private readonly search = h('input', { type: 'search', class: 'ao-input ao-log-search', placeholder: t('rules.log.search'), 'aria-label': t('rules.log.search'), autocomplete: 'off' });
  private readonly ruleChip = h('button', { type: 'button', class: 'ao-log-rulechip', hidden: true });
  private readonly count = h('span', { class: 'ao-log-count' });
  private readonly clearBtn: HTMLButtonElement;
  private readonly list = h('ul', { class: 'ao-log-list', 'aria-label': t('rules.log.list') });
  private readonly empty = emptyNote('', 'ao-log-empty');
  private readonly rows: KeyedList<AutoDecision>;

  constructor(private readonly ctx: AppContext) {
    this.rows = new KeyedList(
      this.list,
      (entry) => entry.id,
      () => new LogRow(ctx).entry(),
    );
    this.search.addEventListener('input', () => ctx.rules.setFilter({ query: this.search.value }));
    this.ruleChip.addEventListener('click', () => ctx.rules.setFilter({ ruleId: null }));
    this.clearBtn = button({ label: t('rules.log.clear'), icon: 'eraser', variant: 'ghost', className: 'ao-btn--small', title: t('rules.log.clear.title'), onClick: () => void this.clear() });
    this.el.append(h('div', { class: 'ao-log-tools' }, this.outcome.el, this.search, this.ruleChip), h('div', { class: 'ao-log-bar' }, this.count, h('span', { class: 'ao-inbox-spacer' }), this.clearBtn), this.empty, this.list);
  }

  private async clear(): Promise<void> {
    const result = await this.ctx.rules.clearLog();
    if (result.ok) this.ctx.announce(t('announce.rules.logCleared'));
    else if (result.message !== '') this.ctx.notifyLocal('warn', result.message);
  }

  render(): void {
    const { log, filter, rules } = this.ctx.rules.get();
    const shown = filterLog(log, filter);
    this.outcome.set(filter.outcome);
    if (this.search.value !== filter.query && document.activeElement !== this.search) this.search.value = filter.query;
    const filtered = rules.find((rule) => rule.id === filter.ruleId);
    const filteredEntry = log.find((entry) => entry.ruleId === filter.ruleId);
    this.ruleChip.hidden = filter.ruleId === null;
    if (filter.ruleId !== null) {
      const label = filtered !== undefined ? ruleLabel(filtered) : filteredEntry !== undefined ? ruleLabel(filteredEntry) : filter.ruleId;
      setText(this.ruleChip, t('rules.log.ruleFilter', { rule: label }));
      setAttr(this.ruleChip, 'title', t('rules.log.ruleFilter.remove'));
    }
    setText(this.count, t('rules.log.count', { n: shown.length }));
    this.clearBtn.disabled = log.length === 0 || this.ctx.rules.get().busy || !this.ctx.isLocal;
    this.empty.hidden = shown.length > 0;
    setText(this.empty, log.length === 0 ? t('rules.log.empty') : t('rules.log.noMatch'));
    this.list.hidden = shown.length === 0;
    this.rows.sync(shown);
  }
}
