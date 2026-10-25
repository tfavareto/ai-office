// Settings popover: language, visual, day/night, names, bubbles, animation, sounds, browser notifications, demo mode, about.
import { LOCALES, LOCALE_NAMES, type GitSettings } from '@ai-office/shared';
import { t } from '../../i18n';
import { describeError } from '../../net/backend';
import type { LanguagePref } from '../../prefs/prefs';
import { notifyPermission, requestNotifyPermission } from '../browser-notify';
import { localOnlyHint, type AppContext } from '../context';
import { h, setAttr, setText } from '../dom';
import { button, createSegmented, createSwitch } from '../widgets';
import { Popover } from './overlay';

interface Row {
  el: HTMLElement;
  hint: HTMLElement;
}

function row(label: string, control: HTMLElement, hint = ''): Row {
  const hintEl = h('p', { class: 'ao-setting-hint', hidden: hint === '' }, hint);
  return {
    el: h(
      'div',
      { class: 'ao-setting' },
      h('div', { class: 'ao-setting-main' }, h('span', { class: 'ao-setting-label' }, label), control),
      hintEl,
    ),
    hint: hintEl,
  };
}

/** Marks controls that keep keyboard focus when the interface is rebuilt after a language change. */
export const FOCUS_KEY_ATTR = 'data-focus-key';
export const LANGUAGE_FOCUS_KEY = 'settings-language';

export class Settings extends Popover {
  private readonly language = this.createLanguageSelect();
  private readonly visual = createSegmented(
    t('settings.visual'),
    [
      { value: '2d', label: '2D' },
      { value: '3d', label: '3D' },
    ] as const,
    (value) => ctxPrefs(this.ctx, { visual: value }),
  );
  private readonly daylight = createSegmented(
    t('settings.daylight'),
    [
      { value: 'auto', label: t('settings.daylight.auto') },
      { value: 'day', label: t('settings.daylight.day') },
      { value: 'night', label: t('settings.daylight.night') },
    ] as const,
    (value) => ctxPrefs(this.ctx, { daylight: value }),
  );
  private readonly names = createSwitch(t('settings.names'), (on) => ctxPrefs(this.ctx, { showNames: on }));
  private readonly bubbles = createSegmented(
    t('settings.bubbles'),
    [
      { value: 'all', label: t('settings.bubbles.all') },
      { value: 'important', label: t('settings.bubbles.important') },
      { value: 'none', label: t('settings.bubbles.none') },
    ] as const,
    (value) => ctxPrefs(this.ctx, { bubbles: value }),
  );
  private readonly animation = createSegmented(
    t('settings.animation'),
    [
      { value: 'calm', label: t('settings.animation.calm') },
      { value: 'normal', label: t('settings.animation.normal') },
      { value: 'lively', label: t('settings.animation.lively') },
    ] as const,
    (value) => ctxPrefs(this.ctx, { animation: value }),
  );
  private readonly sounds = createSwitch(t('settings.sounds'), (on) => {
    this.ctx.prefs.set({ sounds: on });
    if (on) this.ctx.cue('success');
  });
  private readonly volume = h('input', {
    type: 'range',
    min: 0,
    max: 100,
    step: 5,
    class: 'ao-range',
    'aria-label': t('settings.volume'),
  });
  private readonly browser = createSwitch(t('settings.browser'), (on) => void this.toggleBrowser(on));
  private readonly demo = createSwitch(t('settings.demo'), (on) => void this.toggleDemo(on));
  private readonly evolution = createSwitch(t('settings.evolution'), (on) => ctxPrefs(this.ctx, { evolution: on }));
  private readonly employeeProject = createSwitch(t('settings.employeeProject'), (on) =>
    ctxPrefs(this.ctx, { employeeProject: on }),
  );
  private readonly celebrations = createSwitch(t('settings.celebrations'), (on) =>
    ctxPrefs(this.ctx, { celebrations: on }),
  );
  private readonly repo = createSwitch(t('settings.git'), (on) => ctxPrefs(this.ctx, { showGit: on }));
  private readonly pullRequests = createSwitch(t('settings.gitPr'), (on) => void this.togglePullRequests(on));
  private readonly celebrationsRow = row(
    t('settings.celebrations'),
    this.celebrations.el,
    t('settings.celebrations.hint'),
  );
  private readonly languageRow = row(t('settings.language'), this.language);
  private readonly visualRow = row(t('settings.visual'), this.visual.el);
  private readonly soundRow: Row;
  private readonly browserRow = row(t('settings.browser'), this.browser.el);
  private readonly demoRow = row(t('settings.demo'), this.demo.el);
  private readonly evolutionRow = row(t('settings.evolution'), this.evolution.el, t('settings.evolution.hint'));
  private readonly employeeProjectRow = row(
    t('settings.employeeProject'),
    this.employeeProject.el,
    t('settings.employeeProject.hint'),
  );
  private readonly repoRow = row(t('settings.git'), this.repo.el);
  private readonly pullRequestsRow = row(t('settings.gitPr'), this.pullRequests.el, t('settings.gitPr.hint'));
  private readonly ghHint = h('p', { class: 'ao-setting-hint ao-setting-hint--warn', hidden: true });
  private readonly rulesButton = button({
    label: t('rules.settings.button'),
    variant: 'soft',
    className: 'ao-btn--small',
    onClick: () => this.ctx.openRules(),
  });
  private readonly rulesRow = row(t('rules.settings.label'), this.rulesButton, t('rules.settings.hint'));
  private readonly about = h('p', { class: 'ao-setting-about' });
  private busy = false;
  /** What the server says about the pull request lookup (read when the popover opens). */
  private gitSettings: GitSettings | null = null;

  constructor(ctx: AppContext) {
    super(ctx, 'settings', t('topbar.settings'), 'ao-popover--settings');
    this.pullRequestsRow.el.append(this.ghHint);
    this.volume.addEventListener('input', () => ctx.prefs.set({ volume: Number(this.volume.value) / 100 }));
    this.volume.addEventListener('change', () => ctx.cue('info'));
    this.soundRow = row(t('settings.sounds'), h('div', { class: 'ao-sound-control' }, this.volume, this.sounds.el));
    this.el.append(
      h('header', { class: 'ao-popover-head' }, h('strong', null, t('topbar.settings'))),
      h(
        'div',
        { class: 'ao-settings-body' },
        this.languageRow.el,
        this.visualRow.el,
        row(t('settings.daylight'), this.daylight.el).el,
        row(t('settings.names'), this.names.el).el,
        row(t('settings.bubbles'), this.bubbles.el).el,
        row(t('settings.animation'), this.animation.el).el,
        this.celebrationsRow.el,
        this.soundRow.el,
        this.browserRow.el,
        this.evolutionRow.el,
        this.employeeProjectRow.el,
        this.repoRow.el,
        this.pullRequestsRow.el,
        this.rulesRow.el,
        this.demoRow.el,
        h(
          'div',
          { class: 'ao-setting ao-setting--about' },
          h('span', { class: 'ao-setting-label' }, t('settings.about')),
          this.about,
        ),
      ),
    );
  }

  /** "Automático (sistema)" plus each language under its own name, so it is findable whatever the current one is. */
  private createLanguageSelect(): HTMLSelectElement {
    const select = h(
      'select',
      { class: 'ao-select', 'aria-label': t('settings.language'), [FOCUS_KEY_ATTR]: LANGUAGE_FOCUS_KEY },
      h('option', { value: 'auto' }, t('settings.language.auto')),
      ...LOCALES.map((code) => h('option', { value: code, lang: code }, LOCALE_NAMES[code])),
    );
    select.addEventListener('change', () => ctxPrefs(this.ctx, { language: select.value as LanguagePref }));
    return select;
  }

  protected onOpen(): void {
    void this.loadGitSettings();
  }

  private async loadGitSettings(): Promise<void> {
    if (!this.ctx.isLocal) return;
    try {
      this.gitSettings = await this.ctx.gitSettings();
    } catch {
      this.gitSettings = null;
    }
    this.ctx.refresh();
  }

  private async togglePullRequests(on: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.gitSettings = await this.ctx.setGitPullRequests(on);
    } catch (error) {
      this.ctx.notifyLocal('warn', describeError(error));
    } finally {
      this.busy = false;
      this.ctx.refresh();
    }
  }

  protected update(): void {
    const prefs = this.ctx.prefs.get();
    if (this.language.value !== prefs.language) this.language.value = prefs.language;
    this.visual.set(prefs.visual);
    this.daylight.set(prefs.daylight);
    this.names.set(prefs.showNames);
    this.bubbles.set(prefs.bubbles);
    this.animation.set(prefs.animation);
    this.celebrations.set(prefs.celebrations);
    this.sounds.set(prefs.sounds);
    this.volume.value = String(Math.round(prefs.volume * 100));
    this.volume.disabled = !prefs.sounds;

    const permission = notifyPermission();
    this.browser.set(prefs.browserNotifications && permission === 'granted');
    this.browser.el.disabled = permission === 'unsupported' || permission === 'denied';
    this.browserRow.hint.hidden = permission === 'granted' || permission === 'default';
    setText(
      this.browserRow.hint,
      permission === 'denied' ? t('settings.browser.blocked') : t('settings.browser.unsupported'),
    );

    this.evolution.set(prefs.evolution);
    this.employeeProject.set(prefs.employeeProject);
    this.repo.set(prefs.showGit);
    const lookup = this.gitSettings?.pullRequests ?? this.ctx.snapshot?.meta.gitPullRequests === true;
    this.pullRequests.set(lookup);
    this.pullRequests.el.disabled = !this.ctx.isLocal || this.busy;
    const gh = lookup ? this.gitSettings?.gh : undefined;
    this.ghHint.hidden = gh !== 'missing' && gh !== 'unauthenticated';
    setText(this.ghHint, gh === 'unauthenticated' ? t('settings.gitPr.unauthenticated') : t('settings.gitPr.missing'));
    this.pullRequestsRow.hint.hidden = false;
    setText(this.pullRequestsRow.hint, this.ctx.isLocal ? t('settings.gitPr.hint') : localOnlyHint());

    this.rulesButton.disabled = !this.ctx.isLocal;
    setAttr(this.rulesButton, 'title', this.ctx.isLocal ? null : localOnlyHint());

    const mock = this.ctx.store.mode === 'mock';
    const local = this.ctx.isLocal;
    this.demo.set(mock || this.ctx.snapshot?.meta.demo === true);
    this.demo.el.disabled = mock || !local || this.busy;
    this.demoRow.hint.hidden = !mock && local;
    setText(this.demoRow.hint, mock ? t('settings.demo.mock') : localOnlyHint());

    const meta = this.ctx.snapshot?.meta;
    setText(
      this.about,
      meta
        ? t('settings.about.text', {
            version: meta.version,
            build: meta.build ? t('settings.about.build', { build: meta.build }) : '',
          })
        : t('settings.about.textNoVersion'),
    );
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
