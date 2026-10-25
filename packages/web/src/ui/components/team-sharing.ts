// "What I share": the pause switch and one switch per optional category, with what is always and never shared spelled out.
import { SHARE_CATEGORIES, type ShareCategory, type TeamSharePrefs } from '@ai-office/shared';
import { t, type UiKey } from '../../i18n';
import { h } from '../dom';
import { createSwitch, sectionTitle, type Switch } from '../widgets';

const LABELS: Readonly<Record<ShareCategory, { label: UiKey; hint: UiKey }>> = {
  projectNames: { label: 'team.share.projectNames', hint: 'team.share.projectNames.hint' },
  activityText: { label: 'team.share.activityText', hint: 'team.share.activityText.hint' },
  titles: { label: 'team.share.titles', hint: 'team.share.titles.hint' },
  branches: { label: 'team.share.branches', hint: 'team.share.branches.hint' },
  usage: { label: 'team.share.usage', hint: 'team.share.usage.hint' },
};

function line(label: string, control: HTMLElement, hint: string): HTMLElement {
  return h(
    'div',
    { class: 'ao-setting ao-team-share-row' },
    h('div', { class: 'ao-setting-main' }, h('span', { class: 'ao-setting-label' }, label), control),
    h('p', { class: 'ao-setting-hint' }, hint),
  );
}

export class TeamSharing {
  readonly el: HTMLElement;
  private readonly pause: Switch;
  private readonly categories = new Map<ShareCategory, Switch>();
  private current: TeamSharePrefs | null = null;

  constructor(private readonly onChange: (prefs: TeamSharePrefs) => void) {
    this.pause = createSwitch(t('team.share.pause'), (on) => this.change({ paused: on }));
    const rows = SHARE_CATEGORIES.map((category) => {
      const toggle = createSwitch(t(LABELS[category].label), (on) => this.change({ [category]: on }));
      this.categories.set(category, toggle);
      return line(t(LABELS[category].label), toggle.el, t(LABELS[category].hint));
    });
    this.el = h(
      'section',
      { class: 'ao-block ao-team-sharing', 'aria-label': t('team.share.title') },
      sectionTitle(t('team.share.title')),
      h('p', { class: 'ao-note' }, t('team.share.always')),
      h('p', { class: 'ao-note' }, t('team.share.never')),
      h('p', { class: 'ao-note ao-team-visible' }, t('team.share.visible')),
      line(t('team.share.pause'), this.pause.el, t('team.share.pause.hint')),
      h('div', { class: 'ao-section-title ao-team-optin' }, h('span', null, t('team.share.optin'))),
      ...rows,
    );
  }

  /** Shows the preferences the server has; `busy` locks the switches while a change is on its way. */
  update(prefs: TeamSharePrefs, busy: boolean): void {
    this.current = prefs;
    this.pause.set(prefs.paused);
    this.pause.el.disabled = busy;
    for (const [category, toggle] of this.categories) {
      toggle.set(prefs[category]);
      toggle.el.disabled = busy;
    }
  }

  private change(patch: Partial<TeamSharePrefs>): void {
    if (this.current !== null) this.onChange({ ...this.current, ...patch });
  }
}
