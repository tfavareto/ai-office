// Settings popover: visual, day/night, names, bubbles, animation, sounds, browser notifications, demo mode, about.
import { describeError } from '../../net/backend';
import { notifyPermission, requestNotifyPermission } from '../browser-notify';
import { LOCAL_ONLY_HINT, type AppContext } from '../context';
import { h, setText } from '../dom';
import { createSegmented, createSwitch } from '../widgets';
import { Popover } from './overlay';

interface Row {
  el: HTMLElement;
  hint: HTMLElement;
}

function row(label: string, control: HTMLElement, hint = ''): Row {
  const hintEl = h('p', { class: 'ao-setting-hint', hidden: hint === '' }, hint);
  return { el: h('div', { class: 'ao-setting' }, h('div', { class: 'ao-setting-main' }, h('span', { class: 'ao-setting-label' }, label), control), hintEl), hint: hintEl };
}

export class Settings extends Popover {
  private readonly visual = createSegmented('Visual', [{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }] as const, (value) => ctxPrefs(this.ctx, { visual: value }));
  private readonly daylight = createSegmented('Dia e noite', [{ value: 'auto', label: 'Automático' }, { value: 'day', label: 'Dia' }, { value: 'night', label: 'Noite' }] as const, (value) => ctxPrefs(this.ctx, { daylight: value }));
  private readonly names = createSwitch('Nomes sobre as pessoas', (on) => ctxPrefs(this.ctx, { showNames: on }));
  private readonly bubbles = createSegmented('Balões', [{ value: 'all', label: 'Todos' }, { value: 'important', label: 'Importantes' }, { value: 'none', label: 'Nenhum' }] as const, (value) => ctxPrefs(this.ctx, { bubbles: value }));
  private readonly animation = createSegmented('Animação', [{ value: 'calm', label: 'Calma' }, { value: 'normal', label: 'Normal' }, { value: 'lively', label: 'Animada' }] as const, (value) => ctxPrefs(this.ctx, { animation: value }));
  private readonly sounds = createSwitch('Sons', (on) => {
    this.ctx.prefs.set({ sounds: on });
    if (on) this.ctx.cue('success');
  });
  private readonly volume = h('input', { type: 'range', min: 0, max: 100, step: 5, class: 'ao-range', 'aria-label': 'Volume dos sons' });
  private readonly browser = createSwitch('Notificações do navegador', (on) => void this.toggleBrowser(on));
  private readonly demo = createSwitch('Modo demonstração', (on) => void this.toggleDemo(on));
  private readonly visualRow = row('Visual', this.visual.el);
  private readonly soundRow: Row;
  private readonly browserRow = row('Notificações do navegador', this.browser.el);
  private readonly demoRow = row('Modo demonstração', this.demo.el);
  private readonly about = h('p', { class: 'ao-setting-about' });
  private busy = false;

  constructor(ctx: AppContext) {
    super(ctx, 'settings', 'Configurações', 'ao-popover--settings');
    this.volume.addEventListener('input', () => ctx.prefs.set({ volume: Number(this.volume.value) / 100 }));
    this.volume.addEventListener('change', () => ctx.cue('info'));
    this.soundRow = row('Sons', h('div', { class: 'ao-sound-control' }, this.volume, this.sounds.el));
    this.el.append(
      h('header', { class: 'ao-popover-head' }, h('strong', null, 'Configurações')),
      h(
        'div',
        { class: 'ao-settings-body' },
        this.visualRow.el,
        row('Dia e noite', this.daylight.el).el,
        row('Nomes sobre as pessoas', this.names.el).el,
        row('Balões', this.bubbles.el).el,
        row('Animação', this.animation.el).el,
        this.soundRow.el,
        this.browserRow.el,
        this.demoRow.el,
        h('div', { class: 'ao-setting ao-setting--about' }, h('span', { class: 'ao-setting-label' }, 'Sobre'), this.about),
      ),
    );
  }

  protected onOpen(): void {
    // Nothing to load: values come from the preferences store.
  }

  protected update(): void {
    const prefs = this.ctx.prefs.get();
    this.visual.set(prefs.visual);
    this.daylight.set(prefs.daylight);
    this.names.set(prefs.showNames);
    this.bubbles.set(prefs.bubbles);
    this.animation.set(prefs.animation);
    this.sounds.set(prefs.sounds);
    this.volume.value = String(Math.round(prefs.volume * 100));
    this.volume.disabled = !prefs.sounds;

    const permission = notifyPermission();
    this.browser.set(prefs.browserNotifications && permission === 'granted');
    this.browser.el.disabled = permission === 'unsupported' || permission === 'denied';
    this.browserRow.hint.hidden = permission === 'granted' || permission === 'default';
    setText(this.browserRow.hint, permission === 'denied' ? 'O navegador bloqueou as notificações deste site. Libere nas configurações do navegador.' : 'Este navegador não oferece notificações.');

    const mock = this.ctx.store.mode === 'mock';
    const local = this.ctx.isLocal;
    this.demo.set(mock || this.ctx.snapshot?.meta.demo === true);
    this.demo.el.disabled = mock || !local || this.busy;
    this.demoRow.hint.hidden = !mock && local;
    setText(this.demoRow.hint, mock ? 'Você está na demonstração local (?mock=1): tudo é simulado no navegador.' : LOCAL_ONLY_HINT);

    const meta = this.ctx.snapshot?.meta;
    setText(this.about, meta ? `AI Office ${meta.version}${meta.build ? ` · build ${meta.build}` : ''} · tudo roda neste computador, nada sai dele.` : 'AI Office · tudo roda neste computador, nada sai dele.');
  }

  private async toggleBrowser(on: boolean): Promise<void> {
    if (!on) {
      this.ctx.prefs.set({ browserNotifications: false });
      return;
    }
    const permission = await requestNotifyPermission();
    this.ctx.prefs.set({ browserNotifications: permission === 'granted' });
    this.ctx.refresh();
  }

  private async toggleDemo(on: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.ctx.setDemo(on);
    } catch (error) {
      this.ctx.notifyLocal('warn', describeError(error));
    } finally {
      this.busy = false;
      this.ctx.refresh();
    }
  }
}

function ctxPrefs(ctx: AppContext, patch: Parameters<AppContext['prefs']['set']>[0]): void {
  ctx.prefs.set(patch);
}
