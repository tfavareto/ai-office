// Urgent cards at the top of the agent drawer: permission request, "Precisa de você", "Esperando o shell".
import type { Agent, PermissionRequest } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { agentWaitingFor, permissionSuggestion, permissionSummary, shellLabel } from '../display';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { SHELL_STAGES, shellStage, shellStageLabel } from '../model/status';
import { truncate } from '../format';
import { button, liveText, setDisabled, setLive } from '../widgets';

const INPUT_PREVIEW_CHARS = 2400;

function prettyInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return truncate(input, INPUT_PREVIEW_CHARS);
  try {
    return truncate(JSON.stringify(input, null, 2), INPUT_PREVIEW_CHARS);
  } catch {
    return '';
  }
}

export class PermissionCard {
  readonly el = h('section', { class: 'ao-urgent ao-permission', 'aria-label': t('permission.title') });
  private readonly tool = h('span', { class: 'ao-tool-chip' });
  private readonly summary = h('p', { class: 'ao-permission-summary' });
  private readonly expires = liveText('until', 0, 'ao-permission-expires');
  private readonly details = h('pre', { class: 'ao-permission-input', hidden: true });
  private readonly detailsBtn: HTMLButtonElement;
  private readonly actions = h('div', { class: 'ao-permission-actions' });
  private readonly rememberBox = h('div', { class: 'ao-permission-remember' });
  private readonly denyBox: HTMLElement;
  private readonly reason: HTMLTextAreaElement;
  private readonly interrupt: HTMLInputElement;
  private readonly status = h('p', { class: 'ao-permission-status', role: 'status', hidden: true });
  private allowBtn: HTMLButtonElement;
  private denyBtn: HTMLButtonElement;
  private terminalBtn: HTMLButtonElement;
  private ruleBtn: HTMLButtonElement;
  private permission: PermissionRequest | null = null;
  private requestId = '';
  private agent: Agent | null = null;
  private busy = false;

  constructor(private readonly ctx: AppContext) {
    this.detailsBtn = h('button', { type: 'button', class: 'ao-link', 'aria-expanded': 'false', onclick: () => this.toggleDetails() }, t('permission.details.show'));
    this.reason = h('textarea', { class: 'ao-textarea ao-textarea--small', rows: 2, placeholder: t('permission.deny.placeholder'), 'aria-label': t('permission.deny.reason') });
    this.interrupt = h('input', { type: 'checkbox', id: 'ao-deny-interrupt' });
    this.denyBox = h(
      'div',
      { class: 'ao-permission-deny', hidden: true },
      this.reason,
      h('label', { class: 'ao-check', for: 'ao-deny-interrupt' }, this.interrupt, h('span', null, t('permission.deny.interrupt'))),
      h(
        'div',
        { class: 'ao-row-actions' },
        button({ label: t('permission.deny.confirm'), variant: 'danger', onClick: () => void this.deny() }),
        button({ label: t('common.cancel'), variant: 'ghost', onClick: () => this.toggleDeny(false) }),
      ),
    );
    this.allowBtn = button({ label: t('permission.allow'), icon: 'check', variant: 'primary', onClick: () => void this.decide({ behavior: 'allow' }) });
    this.denyBtn = button({ label: t('permission.deny'), icon: 'x', variant: 'soft', onClick: () => this.toggleDeny(Boolean(this.denyBox.hidden)) });
    this.terminalBtn = button({
      label: t('permission.terminal'),
      icon: 'terminal',
      variant: 'ghost',
      title: t('permission.terminal.hint'),
      onClick: () => void this.answerInTerminal(),
    });
    this.ruleBtn = button({
      label: t('rules.create'),
      icon: 'shield',
      variant: 'ghost',
      title: t('rules.create.title'),
      onClick: () => this.agent && this.permission && void this.ctx.openRuleEditor(this.agent, this.permission),
    });
    this.actions.append(this.allowBtn, this.denyBtn, this.terminalBtn, this.ruleBtn);
    this.el.append(
      h('header', { class: 'ao-urgent-head' }, icon('shield', 18), h('strong', null, t('permission.title')), h('span', { class: 'ao-urgent-spacer' }), h('span', { class: 'ao-urgent-sub' }, t('permission.expiresIn'), this.expires)),
      h('div', { class: 'ao-permission-tool' }, this.tool, this.summary),
      this.detailsBtn,
      this.details,
      this.rememberBox,
      this.actions,
      this.denyBox,
      this.status,
    );
  }

  update(agent: Agent, permission: PermissionRequest): void {
    this.agent = agent;
    this.permission = permission;
    if (permission.id !== this.requestId) {
      this.requestId = permission.id;
      this.busy = false;
      this.reason.value = '';
      this.interrupt.checked = false;
      this.toggleDeny(false);
      this.status.hidden = true;
      this.details.hidden = true;
      this.detailsBtn.setAttribute('aria-expanded', 'false');
      setText(this.detailsBtn, t('permission.details.show'));
      this.buildRemember(permission);
    }
    setText(this.tool, permission.toolName);
    setText(this.summary, permissionSummary(permission));
    setLive(this.expires, 'until', permission.expiresAt);
    const input = prettyInput(permission.input);
    this.detailsBtn.hidden = input.length === 0;
    if (this.details.textContent !== input) this.details.textContent = input;
    this.syncDisabled();
  }

  private buildRemember(permission: PermissionRequest): void {
    this.rememberBox.hidden = permission.suggestions.length === 0;
    this.rememberBox.replaceChildren(
      ...permission.suggestions.map((_, index) => {
        const label = permissionSuggestion(permission, index);
        return h(
          'button',
          { type: 'button', class: 'ao-remember', title: t('permission.remember.title', { rule: label }), onclick: () => void this.decide({ behavior: 'allow', suggestion: index }) },
          icon('check', 14),
          h('span', { class: 'ao-remember-text' }, h('strong', null, t('permission.remember')), h('span', null, label)),
        );
      }),
    );
  }

  private syncDisabled(): void {
    const reason = this.ctx.isLocal ? undefined : t('permission.localOnly');
    const off = this.busy || !this.ctx.isLocal;
    for (const btn of [this.allowBtn, this.denyBtn, this.terminalBtn, this.ruleBtn]) setDisabled(btn, off, reason);
    for (const btn of this.rememberBox.querySelectorAll('button')) setDisabled(btn, off, reason);
  }

  private toggleDetails(): void {
    const open = this.details.hidden;
    this.details.hidden = !open;
    this.detailsBtn.setAttribute('aria-expanded', String(open));
    setText(this.detailsBtn, open ? t('permission.details.hide') : t('permission.details.show'));
  }

  private toggleDeny(open: boolean): void {
    this.denyBox.hidden = !open;
    toggleClass(this.denyBtn, 'is-on', open);
    if (open) this.reason.focus();
  }

  private async deny(): Promise<void> {
    const message = this.reason.value.trim();
    await this.decide({ behavior: 'deny', message: message || undefined, interrupt: this.interrupt.checked || undefined });
  }

  private async answerInTerminal(): Promise<void> {
    const agent = this.agent;
    const ok = await this.decide({ behavior: 'terminal' });
    if (ok && agent) this.ctx.openTerminalForAgent(agent);
  }

  private async decide(decision: Parameters<AppContext['decidePermission']>[1]): Promise<boolean> {
    const agent = this.agent;
    if (!agent || this.busy) return false;
    this.busy = true;
    this.syncDisabled();
    this.showStatus(t('permission.sending'));
    const ok = await this.ctx.decidePermission(agent, decision);
    // On success the next snapshot removes the card; keep it locked meanwhile. On failure let the user retry.
    if (!ok) {
      this.busy = false;
      this.status.hidden = true;
      this.syncDisabled();
    } else {
      this.showStatus(t('permission.sent'));
    }
    return ok;
  }

  private showStatus(text: string): void {
    this.status.hidden = false;
    setText(this.status, text);
  }
}

export class WaitingCard {
  readonly el = h('section', { class: 'ao-urgent ao-waiting', 'aria-label': t('waiting.title') });
  private readonly text = h('p', { class: 'ao-urgent-text' });
  private readonly since = liveText('ago', 0);
  private agent: Agent | null = null;

  constructor(ctx: AppContext) {
    const terminal = button({
      label: t('permission.terminal'),
      icon: 'terminal',
      variant: 'primary',
      onClick: () => this.agent && ctx.openTerminalForAgent(this.agent),
    });
    this.el.append(
      h('header', { class: 'ao-urgent-head' }, icon('alert', 18), h('strong', null, t('waiting.title')), h('span', { class: 'ao-urgent-spacer' }), h('span', { class: 'ao-urgent-sub' }, this.since)),
      this.text,
      h('div', { class: 'ao-row-actions' }, terminal),
    );
  }

  update(agent: Agent): void {
    this.agent = agent;
    setText(this.text, agentWaitingFor(agent) ?? t('waiting.default'));
    setLive(this.since, 'ago', agent.statusSince);
  }
}

export class ShellCard {
  readonly el = h('section', { class: 'ao-urgent ao-shell', 'aria-label': t('shell.title') });
  private readonly list = h('div', { class: 'ao-shell-list' });
  private signature = '';

  constructor(private readonly ctx: AppContext) {
    this.el.append(
      h('header', { class: 'ao-urgent-head' }, icon('terminal', 18), h('strong', null, t('shell.title'))),
      h('p', { class: 'ao-urgent-text' }, t('shell.note')),
      this.list,
    );
  }

  update(agent: Agent): void {
    const now = this.ctx.now();
    const signature = agent.shells.map((s) => `${s.id}:${shellStage(s, now).index}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.replaceChildren(
      ...agent.shells.map((shell) => {
        const stage = shellStage(shell, now);
        return h(
          'div',
          { class: 'ao-shell-job' },
          h('div', { class: 'ao-shell-job-head' }, h('strong', null, shellLabel(shell)), h('span', { class: 'ao-shell-kind' }, shell.kind === 'monitor' ? t('shell.kind.monitor') : shell.background ? t('shell.kind.background') : t('shell.kind.foreground')), liveText('elapsed', shell.startedAt, 'ao-shell-elapsed')),
          shell.command ? h('code', { class: 'ao-shell-command' }, truncate(shell.command, 160)) : null,
          h(
            'ol',
            { class: 'ao-stages', 'aria-label': t('shell.stage.label', { stage: stage.label }) },
            ...SHELL_STAGES.map((s, index) => h('li', { class: `ao-stage ${index < stage.index ? 'is-past' : index === stage.index ? 'is-current' : ''}`.trim(), 'aria-current': index === stage.index ? 'step' : null }, h('span', { class: 'ao-stage-dot' }), h('span', null, shellStageLabel(s.id)))),
          ),
        );
      }),
    );
  }
}
