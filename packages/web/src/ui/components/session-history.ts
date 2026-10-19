// Popover with the sessions of the last 7 days, grouped by day and searchable; closed sessions open read-only.
import type { RecentSession } from '@ai-office/shared';
import { t } from '../../i18n';
import { describeError } from '../../net/backend';
import { localOnlyHint, type AppContext } from '../context';
import { localizedOptional } from '../display';
import { h } from '../dom';
import { formatClock } from '../format';
import { icon } from '../icons';
import { filterSessions, groupSessionsByDay } from '../model/sessions';
import { accountChip, emptyNote } from '../widgets';
import { Popover } from './overlay';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export class SessionHistory extends Popover {
  private readonly input: HTMLInputElement;
  private readonly body = h('div', { class: 'ao-sessions-body' });
  private sessions: RecentSession[] = [];
  private state: LoadState = 'idle';
  private error = '';
  private signature = '';

  constructor(ctx: AppContext) {
    super(ctx, 'sessions', t('topbar.sessions'), 'ao-popover--sessions');
    this.input = h('input', { type: 'search', class: 'ao-search-input ao-input', placeholder: t('sessions.search'), 'aria-label': t('sessions.search.label'), autocomplete: 'off' });
    this.input.addEventListener('input', () => {
      this.signature = '';
      this.ctx.refresh();
    });
    this.el.append(
      h('header', { class: 'ao-popover-head' }, h('strong', null, t('topbar.sessions')), h('span', { class: 'ao-popover-hint' }, t('sessions.range'))),
      h('div', { class: 'ao-popover-sub' }, this.input),
      this.body,
    );
  }

  override focusTarget(): HTMLElement {
    return this.ctx.isLocal ? this.input : this.el;
  }

  protected onOpen(): void {
    this.input.value = '';
    this.signature = '';
    if (!this.ctx.isLocal) return;
    void this.load();
  }

  private async load(): Promise<void> {
    this.state = 'loading';
    this.signature = '';
    try {
      this.sessions = await this.ctx.store.backend.sessions();
      this.state = 'ready';
    } catch (error) {
      this.state = 'error';
      this.error = describeError(error);
    }
    this.signature = '';
    this.ctx.refresh();
  }

  protected update(): void {
    const local = this.ctx.isLocal;
    this.input.disabled = !local;
    const signature = `${local}|${this.state}|${this.input.value}|${this.sessions.length}|${this.ctx.snapshot?.rev ?? 0}`;
    if (signature === this.signature) return;
    this.signature = signature;
    if (!local) {
      this.body.replaceChildren(emptyNote(localOnlyHint()));
      return;
    }
    if (this.state === 'loading') {
      this.body.replaceChildren(emptyNote(t('sessions.loading')));
      return;
    }
    if (this.state === 'error') {
      this.body.replaceChildren(h('p', { class: 'ao-error' }, this.error), h('button', { type: 'button', class: 'ao-btn ao-btn--soft', onclick: () => void this.load() }, t('common.retry')));
      return;
    }
    const groups = groupSessionsByDay(filterSessions(this.sessions, this.input.value), this.ctx.now());
    if (groups.length === 0) {
      this.body.replaceChildren(emptyNote(this.input.value ? t('sessions.empty.search') : t('sessions.empty.range')));
      return;
    }
    this.body.replaceChildren(
      ...groups.map((group) =>
        h('section', { class: 'ao-session-group' }, h('h3', { class: 'ao-session-day' }, group.label), h('ul', { class: 'ao-session-list' }, ...group.sessions.map((s) => h('li', null, this.row(s))))),
      ),
    );
  }

  private row(session: RecentSession): HTMLElement {
    const row = h(
      'button',
      { type: 'button', class: 'ao-session', title: session.projectPath },
      accountChip(this.ctx.account(session.accountId)),
      h('span', { class: 'ao-session-body' }, h('strong', null, session.projectName), h('span', null, localizedOptional(session.titleMsg, session.title) ?? t('sessions.untitled'))),
      h('span', { class: 'ao-session-meta' }, session.open ? h('span', { class: 'ao-tag ao-tag--live' }, t('sessions.open')) : null, h('span', null, `${formatClock(session.firstAt)}–${formatClock(session.lastAt)}`)),
      icon('chevronRight', 14),
    );
    row.addEventListener('click', () => {
      this.ctx.closePopover();
      this.ctx.openTerminalForSession(session);
    });
    return row;
  }
}
