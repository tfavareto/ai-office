// Top bar: brand, connection pill, counters (with jump-to-next), usage cards and the main action buttons.
import type { CameraMode } from '../../world/api';
import type { AppContext, Component } from '../context';
import { h, setText, toggleClass } from '../dom';
import { icon, type IconName } from '../icons';
import { logo } from '../logo';
import { computeCounters, type Counters } from '../model/counters';
import { unreadCount } from '../model/notifications';
import type { PopoverId } from '../state';
import { iconButton, setPressed } from '../widgets';
import { UsageCards } from './usage-cards';

interface CounterDef {
  key: keyof Counters;
  icon: IconName;
  label: string;
  singular?: string;
  jump?: 'shell' | 'needs';
}

const COUNTERS: readonly CounterDef[] = [
  { key: 'rooms', icon: 'building', label: 'salas', singular: 'sala' },
  { key: 'agents', icon: 'users', label: 'agentes', singular: 'agente' },
  { key: 'working', icon: 'bolt', label: 'trabalhando' },
  { key: 'subagents', icon: 'layers', label: 'subagentes', singular: 'subagente' },
  { key: 'shells', icon: 'terminal', label: 'shells rodando', singular: 'shell rodando', jump: 'shell' },
  { key: 'needsYou', icon: 'alert', label: 'precisam de você', singular: 'precisa de você', jump: 'needs' },
];

const CAMERA_LABEL: Record<CameraMode, string> = {
  overview: 'Visão geral',
  'first-person': 'Primeira pessoa',
  shoulder: 'Sobre o ombro',
};

interface CounterView {
  def: CounterDef;
  el: HTMLElement;
  value: HTMLElement;
  text: HTMLElement;
}

export class TopBar implements Component {
  readonly el = h('header', { class: 'ao-topbar', role: 'banner' });
  private readonly pill: HTMLElement;
  private readonly pillText: HTMLElement;
  private readonly counters: CounterView[];
  private readonly usage: UsageCards;
  private readonly sidebarBtn: HTMLButtonElement;
  private readonly cameraBtn: HTMLButtonElement;
  private readonly cameraLabel: HTMLElement;
  private readonly feedBtn: HTMLButtonElement;
  private readonly bellBtn: HTMLButtonElement;
  private readonly bellBadge: HTMLElement;
  private readonly popoverButtons = new Map<PopoverId, HTMLButtonElement>();
  private readonly dayBtn: HTMLButtonElement;
  private readonly helpBtn: HTMLButtonElement;

  constructor(private readonly ctx: AppContext) {
    this.sidebarBtn = iconButton({
      icon: 'sidebar',
      label: 'Mostrar ou ocultar a barra lateral ([)',
      onClick: () => ctx.ui.set({ sidebarOpen: !ctx.ui.get().sidebarOpen }),
    });
    this.pillText = h('span', null, 'Conectando…');
    this.pill = h('div', { class: 'ao-pill ao-pill--connecting', role: 'status' }, h('span', { class: 'ao-pill-dot' }), this.pillText);
    this.counters = COUNTERS.map((def) => this.createCounter(def));
    this.usage = new UsageCards(ctx);

    this.cameraLabel = h('span', { class: 'ao-camera-label' }, CAMERA_LABEL.overview);
    this.cameraBtn = h('button', { type: 'button', class: 'ao-btn ao-btn--ghost ao-camera-btn', hidden: true, title: 'Trocar o modo de câmera', onclick: () => this.cycleCamera() }, icon('camera', 16), this.cameraLabel);

    this.feedBtn = iconButton({ icon: 'feed', label: 'Atividade do escritório (])', pressed: false, onClick: () => ctx.ui.set({ feedOpen: !ctx.ui.get().feedOpen }) });
    this.bellBadge = h('span', { class: 'ao-badge', hidden: true });
    this.bellBtn = iconButton({ icon: 'bell', label: 'Notificações', onClick: () => ctx.togglePopover('notifications') });
    this.bellBtn.dataset.popoverTrigger = 'notifications';
    this.bellBtn.appendChild(this.bellBadge);
    this.dayBtn = iconButton({ icon: 'calendar', label: 'Meu dia (M)', onClick: () => ctx.openDialog('day') });
    this.helpBtn = iconButton({ icon: 'help', label: 'Ajuda e atalhos (?)', onClick: () => ctx.openDialog('help') });

    this.el.append(
      h('div', { class: 'ao-topbar-group ao-topbar-left' }, this.sidebarBtn, this.brand(), this.pill),
      h('div', { class: 'ao-topbar-group ao-topbar-center' }, h('div', { class: 'ao-counters', role: 'list' }, ...this.counters.map((c) => c.el)), this.usage.el),
      h(
        'div',
        { class: 'ao-topbar-group ao-topbar-right' },
        iconButton({ icon: 'fit', label: 'Visão geral (O)', onClick: () => ctx.world.overview() }),
        iconButton({ icon: 'zoomOut', label: 'Afastar (-)', onClick: () => ctx.world.zoomBy(1 / 1.25) }),
        iconButton({ icon: 'zoomIn', label: 'Aproximar (+)', onClick: () => ctx.world.zoomBy(1.25) }),
        this.cameraBtn,
        h('span', { class: 'ao-topbar-sep', 'aria-hidden': 'true' }),
        this.bellBtn,
        this.dayBtn,
        this.popoverButton('sessions', 'history', 'Histórico de sessões'),
        this.feedBtn,
        this.popoverButton('settings', 'settings', 'Configurações'),
        this.helpBtn,
      ),
    );
  }

  private brand(): HTMLElement {
    return h('div', { class: 'ao-brand' }, logo(28), h('span', { class: 'ao-wordmark' }, 'AI ', h('span', null, 'Office')));
  }

  private popoverButton(id: PopoverId, name: IconName, label: string): HTMLButtonElement {
    const btn = iconButton({ icon: name, label, pressed: false, onClick: () => this.ctx.togglePopover(id) });
    btn.dataset.popoverTrigger = id;
    btn.setAttribute('aria-haspopup', 'dialog');
    this.popoverButtons.set(id, btn);
    return btn;
  }

  private createCounter(def: CounterDef): CounterView {
    const value = h('span', { class: 'ao-counter-value' }, '0');
    const text = h('span', { class: 'ao-counter-label' }, def.label);
    const inner = [icon(def.icon, 16), value, text];
    if (!def.jump) {
      const el = h('div', { class: `ao-counter ao-counter--${def.key}`, role: 'listitem' }, ...inner);
      return { def, el, value, text };
    }
    const el = h(
      'button',
      {
        type: 'button',
        class: `ao-counter ao-counter--${def.key} is-action`,
        role: 'listitem',
        onclick: () => (def.jump === 'shell' ? this.ctx.jumpToShell() : this.ctx.jumpToNeedsYou()),
      },
      ...inner,
    );
    return { def, el, value, text };
  }

  private cycleCamera(): void {
    const modes = this.ctx.world.cameraModes();
    if (modes.length < 2) return;
    const next = modes[(modes.indexOf(this.ctx.world.cameraMode()) + 1) % modes.length];
    this.ctx.world.setCameraMode(next);
  }

  render(): void {
    this.renderPill();
    this.renderCounters();
    this.usage.render();
    this.renderButtons();
  }

  private renderPill(): void {
    const { connection } = this.ctx.store.data;
    const mock = this.ctx.store.mode === 'mock';
    let kind: string;
    let text: string;
    if (connection === 'live') {
      kind = mock ? 'mock' : 'live';
      text = mock ? 'Demonstração local' : this.ctx.snapshot?.meta.demo ? 'Ao vivo · demo' : 'Ao vivo';
    } else if (connection === 'reconnecting') {
      kind = 'warn';
      text = 'Reconectando…';
    } else {
      kind = 'connecting';
      text = 'Conectando…';
    }
    const next = `ao-pill ao-pill--${kind}`;
    if (this.pill.className !== next) this.pill.className = next;
    setText(this.pillText, text);
  }

  private renderCounters(): void {
    const counters = computeCounters(this.ctx.snapshot);
    for (const view of this.counters) {
      const value = counters[view.def.key];
      setText(view.value, String(value));
      setText(view.text, value === 1 && view.def.singular ? view.def.singular : view.def.label);
      const attention = view.def.key === 'needsYou' && value > 0;
      toggleClass(view.el, 'is-attention', attention);
      toggleClass(view.el, 'is-zero', value === 0);
      if (view.el instanceof HTMLButtonElement) {
        view.el.disabled = value === 0;
        view.el.title = value === 0 ? `Nenhum item em "${view.def.label}"` : `Ir para o próximo (${view.def.label})`;
      } else {
        view.el.title = `${value} ${value === 1 && view.def.singular ? view.def.singular : view.def.label}`;
      }
    }
  }

  private renderButtons(): void {
    const ui = this.ctx.ui.get();
    setPressed(this.sidebarBtn, ui.sidebarOpen);
    setPressed(this.feedBtn, ui.feedOpen);
    for (const [id, btn] of this.popoverButtons) setPressed(btn, ui.popover === id);
    setPressed(this.bellBtn, ui.popover === 'notifications');
    setPressed(this.dayBtn, ui.dialog === 'day');
    setPressed(this.helpBtn, ui.dialog === 'help');

    const unread = unreadCount(this.ctx.notifications.get());
    this.bellBadge.hidden = unread === 0;
    setText(this.bellBadge, unread > 9 ? '9+' : String(unread));
    this.bellBtn.setAttribute('aria-label', unread > 0 ? `Notificações, ${unread} não lidas` : 'Notificações');

    const modes = this.ctx.world.cameraModes();
    this.cameraBtn.hidden = modes.length < 2;
    if (modes.length >= 2) setText(this.cameraLabel, CAMERA_LABEL[this.ctx.world.cameraMode()]);
  }
}
