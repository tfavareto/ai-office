// Shown over the world when no session is open: how to start, plus a shortcut to demo mode.
import { describeError } from '../../net/backend';
import { LOCAL_ONLY_HINT, type AppContext, type Component } from '../context';
import { h, toggleClass } from '../dom';
import { computeCounters } from '../model/counters';
import { button } from '../widgets';

export class EmptyState implements Component {
  readonly el = h('div', { class: 'ao-empty', hidden: true });
  private readonly demoBtn: HTMLButtonElement;
  private busy = false;

  constructor(private readonly ctx: AppContext) {
    this.demoBtn = button({ label: 'Ver em modo demonstração', icon: 'play', variant: 'primary', onClick: () => void this.enableDemo() });
    this.el.append(
      h(
        'div',
        { class: 'ao-empty-card' },
        h('h2', null, 'Nenhuma sessão aberta'),
        h('p', null, 'Cada projeto aberto no Claude Code vira uma sala, e cada sessão vira uma pessoa trabalhando nela.'),
        h('ol', { class: 'ao-empty-steps' }, h('li', null, 'Abra um terminal na pasta de um projeto.'), h('li', null, h('span', null, 'Rode '), h('code', null, 'claude'), h('span', null, ' e peça algo ao agente.')), h('li', null, 'A sala aparece aqui em instantes.')),
        h('div', { class: 'ao-row-actions' }, this.demoBtn),
        h('p', { class: 'ao-note' }, 'O modo demonstração cria agentes fictícios só para você conhecer o escritório.'),
      ),
    );
  }

  private async enableDemo(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.ctx.setDemo(true);
    } catch (error) {
      this.ctx.notifyLocal('warn', describeError(error));
    } finally {
      this.busy = false;
      this.ctx.refresh();
    }
  }

  render(): void {
    const snapshot = this.ctx.snapshot;
    const empty = snapshot !== null && computeCounters(snapshot).agents === 0 && snapshot.agents.every((agent) => agent.status === 'offline' || agent.status === 'done');
    this.el.hidden = !empty;
    if (!empty) return;
    const canDemo = this.ctx.isLocal && this.ctx.store.mode === 'live';
    this.demoBtn.disabled = !canDemo || this.busy;
    this.demoBtn.title = canDemo ? '' : LOCAL_ONLY_HINT;
    toggleClass(this.el, 'is-narrow', this.ctx.ui.get().narrow);
  }
}
