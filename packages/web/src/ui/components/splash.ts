// Splash ("Conectando ao escritório…") and the connection banner shown when the stream drops.
import { t } from '../../i18n';
import type { AppContext, Component } from '../context';
import { h, setText, toggleClass } from '../dom';
import { formatElapsed } from '../format';
import { logo } from '../logo';

const SLOW_CONNECT_MS = 8000;

export class Splash implements Component {
  readonly el = h('div', { class: 'ao-splash', role: 'status' });
  private readonly text = h('p', { class: 'ao-splash-text' }, t('splash.connecting'));
  private readonly hint = h('p', { class: 'ao-splash-hint', hidden: true });
  private readonly startedAt = Date.now();
  private hidden = false;

  constructor(private readonly ctx: AppContext) {
    this.el.append(h('div', { class: 'ao-splash-card' }, logo(56), h('div', { class: 'ao-wordmark ao-wordmark--big' }, 'AI ', h('span', null, 'Office')), this.text, this.hint));
  }

  render(): void {
    if (this.hidden) return;
    if (this.ctx.snapshot) {
      this.hidden = true;
      toggleClass(this.el, 'is-hidden', true);
      this.el.setAttribute('aria-hidden', 'true');
      window.setTimeout(() => this.el.remove(), 500);
      return;
    }
    const slow = Date.now() - this.startedAt > SLOW_CONNECT_MS || this.ctx.store.data.connection === 'reconnecting';
    this.hint.hidden = !slow;
    if (slow) {
      setText(this.text, t('splash.slow'));
      setText(this.hint, t('splash.hint'));
    }
  }
}

export class ConnectionBanner implements Component {
  readonly el = h('div', { class: 'ao-banner', role: 'alert', hidden: true });
  private readonly text = h('span');
  private readonly countdown = h('span', { class: 'ao-banner-count' });

  constructor(private readonly ctx: AppContext) {
    this.el.append(h('span', { class: 'ao-banner-dot', 'aria-hidden': 'true' }), this.text, this.countdown, h('button', { type: 'button', class: 'ao-btn ao-btn--soft ao-btn--small', onclick: () => ctx.store.retryNow() }, t('banner.retry')));
  }

  render(): void {
    const { connection, retryAt, everConnected } = this.ctx.store.data;
    const show = connection === 'reconnecting' && everConnected;
    this.el.hidden = !show;
    if (!show) return;
    setText(this.text, t('banner.lost'));
    const left = retryAt === null ? 0 : Math.max(0, retryAt - Date.now());
    setText(this.countdown, left > 0 ? t('banner.retryIn', { time: formatElapsed(left) }) : t('topbar.connection.reconnecting'));
  }
}
