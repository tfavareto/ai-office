// Top bar: brand, connection pill, counters (with jump-to-next), usage cards and the main action buttons.
import { t, type UiKey } from '../../i18n';
import type { CameraMode } from '../../world/api';
import type { AppContext, Component } from '../context';
import { h, setAttr, setText, toggleClass } from '../dom';
import { formatDateKey } from '../format';
import { icon, type IconName } from '../icons';
import { logo } from '../logo';
import { computeCounters, type Counters } from '../model/counters';
import type { InboxCounts } from '../model/inbox';
import { unreadCount } from '../model/notifications';
import type { PopoverId } from '../state';
import { iconButton, setPressed } from '../widgets';
import { UsageCards } from './usage-cards';

interface CounterDef {
  key: keyof Counters;
  icon: IconName;
  /** Catalog key of the label; plural-aware ("sala" / "salas"). */
  label: UiKey;
  jump?: 'shell' | 'inbox';
}

const COUNTERS: readonly CounterDef[] = [
  { key: 'rooms', icon: 'building', label: 'topbar.counter.rooms' },
  { key: 'agents', icon: 'users', label: 'topbar.counter.agents' },
  { key: 'working', icon: 'bolt', label: 'topbar.counter.working' },
  { key: 'subagents', icon: 'layers', label: 'topbar.counter.subagents' },
  { key: 'shells', icon: 'terminal', label: 'topbar.counter.shells', jump: 'shell' },
  { key: 'needsYou', icon: 'alert', label: 'topbar.counter.needsYou', jump: 'inbox' },
];

const CAMERA_LABEL: Record<CameraMode, UiKey> = {
  overview: 'camera.overview',
  'first-person': 'camera.firstPerson',
  shoulder: 'camera.shoulder',
};

interface CounterView {
  def: CounterDef;
  el: HTMLElement;
  value: HTMLElement;
  text: HTMLElement;
  /** Inbox button only: unseen finished work, next to the count of what needs the user. */
  finished?: HTMLElement;
  finishedValue?: HTMLElement;
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
  private readonly boardBtn: HTMLButtonElement;
  private readonly dayBtn: HTMLButtonElement;
  private readonly progressBtn: HTMLButtonElement;
  private readonly progressLevel: HTMLElement;
  private readonly helpBtn: HTMLButtonElement;

  constructor(private readonly ctx: AppContext) {
    this.sidebarBtn = iconButton({
      icon: 'sidebar',
      label: t('topbar.sidebar'),
      onClick: () => ctx.ui.set({ sidebarOpen: !ctx.ui.get().sidebarOpen }),
    });
    this.pillText = h('span', null, t('topbar.connection.connecting'));
    this.pill = h(
      'div',
      { class: 'ao-pill ao-pill--connecting', role: 'status' },
      h('span', { class: 'ao-pill-dot' }),
      this.pillText,
    );
    this.counters = COUNTERS.map((def) => this.createCounter(def));
    this.usage = new UsageCards(ctx);

    this.cameraLabel = h('span', { class: 'ao-camera-label' }, t(CAMERA_LABEL.overview));
    this.cameraBtn = h(
      'button',
      {
        type: 'button',
        class: 'ao-btn ao-btn--ghost ao-camera-btn',
        hidden: true,
        title: t('topbar.camera.cycle'),
        onclick: () => this.cycleCamera(),
      },
      icon('camera', 16),
      this.cameraLabel,
    );

    this.feedBtn = iconButton({
      icon: 'feed',
      label: t('topbar.feed'),
      pressed: false,
      onClick: () => ctx.ui.set({ feedOpen: !ctx.ui.get().feedOpen }),
    });
    this.bellBadge = h('span', { class: 'ao-badge', hidden: true });
    this.bellBtn = iconButton({
      icon: 'bell',
      label: t('topbar.notifications'),
      onClick: () => ctx.togglePopover('notifications'),
    });
    this.bellBtn.dataset.popoverTrigger = 'notifications';
    this.bellBtn.appendChild(this.bellBadge);
    this.boardBtn = iconButton({ icon: 'board', label: t('topbar.board'), onClick: () => ctx.openDialog('board') });
    this.dayBtn = iconButton({ icon: 'calendar', label: t('topbar.day'), onClick: () => ctx.openDay('time') });
    this.progressBtn = iconButton({
      icon: 'trophy',
      label: t('topbar.progress'),
      onClick: () => ctx.openDialog('achievements'),
    });
    this.progressBtn.classList.add('ao-progress-btn');
    this.progressLevel = h('span', { class: 'ao-topbar-level', hidden: true });
    this.progressBtn.append(this.progressLevel);
    this.helpBtn = iconButton({
      icon: 'help',
      label: t('topbar.help'),
      className: 'ao-help-btn',
      onClick: () => ctx.openDialog('help'),
    });

    this.el.append(
      h('div', { class: 'ao-topbar-group ao-topbar-left' }, this.sidebarBtn, this.brand(), this.pill),
      h(
        'div',
        { class: 'ao-topbar-group ao-topbar-center' },
        h('div', { class: 'ao-counters', role: 'list' }, ...this.counters.map((c) => c.el)),
        this.usage.el,
      ),
      h(
        'div',
        { class: 'ao-topbar-group ao-topbar-right' },
        iconButton({ icon: 'fit', label: t('topbar.overview'), onClick: () => ctx.world.overview() }),
        iconButton({ icon: 'zoomOut', label: t('topbar.zoomOut'), onClick: () => ctx.world.zoomBy(1 / 1.25) }),
        iconButton({ icon: 'zoomIn', label: t('topbar.zoomIn'), onClick: () => ctx.world.zoomBy(1.25) }),
        this.cameraBtn,
        h('span', { class: 'ao-topbar-sep', 'aria-hidden': 'true' }),
        this.bellBtn,
        this.boardBtn,
        this.dayBtn,
        this.progressBtn,
        this.popoverButton('sessions', 'history', t('topbar.sessions')),
        this.feedBtn,
        this.popoverButton('settings', 'settings', t('topbar.settings')),
        this.helpBtn,
      ),
    );
  }

  private brand(): HTMLElement {
    return h(
      'div',
      { class: 'ao-brand' },
      logo(28),
      h('span', { class: 'ao-wordmark' }, 'AI ', h('span', null, 'Office')),
    );
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
    const text = h('span', { class: 'ao-counter-label' }, t(def.label, { n: 0 }));
    const inner = [icon(def.icon, 16), value, text];
    if (!def.jump) {
      const el = h('div', { class: `ao-counter ao-counter--${def.key}`, role: 'listitem' }, ...inner);
      return { def, el, value, text };
    }
    if (def.jump === 'inbox') return this.createInboxCounter(def, inner, value, text);
    const el = h(
      'button',
      {
        type: 'button',
        class: `ao-counter ao-counter--${def.key} is-action`,
        role: 'listitem',
        onclick: () => this.ctx.jumpToShell(),
      },
      ...inner,
    );
    return { def, el, value, text };
  }

  /** The "needs you" counter is the button of the inbox. */
  private createInboxCounter(def: CounterDef, inner: Node[], value: HTMLElement, text: HTMLElement): CounterView {
    const finishedValue = h('span');
    const finished = h('span', { class: 'ao-counter-finished', hidden: true }, icon('check', 12), finishedValue);
    const el = h(
      'button',
      {
        type: 'button',
        class: `ao-counter ao-counter--${def.key} is-action`,
        role: 'listitem',
        'aria-haspopup': 'dialog',
        'data-popover-trigger': 'inbox',
        onclick: () => this.ctx.togglePopover('inbox'),
      },
      ...inner,
      finished,
    );
    return { def, el, value, text, finished, finishedValue };
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
    const replay = this.ctx.replay.get();
    if (this.ctx.replay.engaged) {
      kind = 'replay';
      text = t('replay.pill', { date: formatDateKey(replay.date) });
      setAttr(this.pill, 'title', t('replay.pill.hint'));
    } else if (connection === 'live') {
      kind = mock ? 'mock' : 'live';
      text = mock
        ? t('topbar.connection.mock')
        : this.ctx.snapshot?.meta.demo
          ? t('topbar.connection.liveDemo')
          : t('topbar.connection.live');
    } else if (connection === 'reconnecting') {
      kind = 'warn';
      text = t('topbar.connection.reconnecting');
    } else {
      kind = 'connecting';
      text = t('topbar.connection.connecting');
    }
    if (kind !== 'replay') setAttr(this.pill, 'title', null);
    const next = `ao-pill ao-pill--${kind}`;
    if (this.pill.className !== next) this.pill.className = next;
    setText(this.pillText, text);
  }

  private renderCounters(): void {
    const counters = computeCounters(this.ctx.snapshot);
    const inbox = this.ctx.inbox.view().counts;
    for (const view of this.counters) {
      if (view.def.jump === 'inbox') {
        this.renderInboxCounter(view, inbox);
        continue;
      }
      const value = counters[view.def.key];
      setText(view.value, String(value));
      const label = t(view.def.label, { n: value });
      setText(view.text, label);
      const attention = view.def.key === 'needsYou' && value > 0;
      toggleClass(view.el, 'is-attention', attention);
      toggleClass(view.el, 'is-zero', value === 0);
      if (view.el instanceof HTMLButtonElement) {
        view.el.disabled = value === 0;
        view.el.title = value === 0 ? t('topbar.counter.none', { label }) : t('topbar.counter.next', { label });
      } else {
        view.el.title = `${value} ${label}`;
      }
    }
  }

  private renderInboxCounter(view: CounterView, counts: InboxCounts): void {
    const value = counts.urgent;
    const label = t(view.def.label, { n: value });
    setText(view.value, String(value));
    setText(view.text, label);
    toggleClass(view.el, 'is-attention', value > 0);
    toggleClass(view.el, 'is-zero', value === 0);
    setPressed(view.el, this.ctx.ui.get().popover === 'inbox');
    if (view.finished && view.finishedValue) {
      view.finished.hidden = counts.finished === 0;
      setText(view.finishedValue, String(counts.finished));
      view.finished.title = t('topbar.inbox.finished', { n: counts.finished });
    }
    const finishedHint = counts.finished > 0 ? ` · ${t('topbar.inbox.finished', { n: counts.finished })}` : '';
    view.el.title = `${t('topbar.inbox.open')} · ${value} ${label}${finishedHint}`;
  }

  private renderButtons(): void {
    const ui = this.ctx.ui.get();
    setPressed(this.sidebarBtn, ui.sidebarOpen);
    setPressed(this.feedBtn, ui.feedOpen);
    for (const [id, btn] of this.popoverButtons) setPressed(btn, ui.popover === id);
    setPressed(this.bellBtn, ui.popover === 'notifications');
    setPressed(this.boardBtn, ui.dialog === 'board');
    setPressed(this.dayBtn, ui.dialog === 'day');
    setPressed(this.helpBtn, ui.dialog === 'help');
    setPressed(this.progressBtn, ui.dialog === 'achievements');
    const level = this.ctx.liveSnapshot?.progress?.level;
    this.progressLevel.hidden = level === undefined || !this.ctx.prefs.get().evolution;
    if (level !== undefined) setText(this.progressLevel, String(level));

    const unread = unreadCount(this.ctx.notifications.get());
    this.bellBadge.hidden = unread === 0;
    setText(this.bellBadge, unread > 9 ? '9+' : String(unread));
    this.bellBtn.setAttribute(
      'aria-label',
      unread > 0 ? t('topbar.notifications.unread', { n: unread }) : t('topbar.notifications'),
    );

    const modes = this.ctx.world.cameraModes();
    this.cameraBtn.hidden = modes.length < 2;
    if (modes.length >= 2) setText(this.cameraLabel, t(CAMERA_LABEL[this.ctx.world.cameraMode()]));
  }
}
