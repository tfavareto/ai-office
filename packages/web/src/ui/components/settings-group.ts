// One collapsible group of the settings popover: a header button (aria-expanded) over a body of rows.
import { t } from '../../i18n';
import { h, toggleClass } from '../dom';
import { icon } from '../icons';
import type { SettingsGroupId } from '../model/settings-groups';

export class SettingsGroup {
  readonly el: HTMLElement;
  private readonly head: HTMLButtonElement;
  private readonly body: HTMLElement;

  constructor(
    readonly id: SettingsGroupId,
    rows: readonly HTMLElement[],
    onToggle: (id: SettingsGroupId) => void,
  ) {
    const headId = `ao-settings-group-${id}`;
    const bodyId = `ao-settings-group-body-${id}`;
    this.head = h(
      'button',
      {
        type: 'button',
        id: headId,
        class: 'ao-setting-group-head',
        'aria-expanded': 'false',
        'aria-controls': bodyId,
        onclick: () => onToggle(id),
      },
      h('span', { class: 'ao-setting-group-title' }, t(`settings.group.${id}`)),
      h('span', { class: 'ao-setting-group-chevron', 'aria-hidden': 'true' }, icon('chevronDown', 16)),
    );
    this.body = h(
      'div',
      { id: bodyId, class: 'ao-setting-group-body', role: 'group', 'aria-labelledby': headId },
      ...rows,
    );
    this.body.hidden = true;
    this.el = h(
      'section',
      { class: 'ao-setting-group' },
      h('h3', { class: 'ao-setting-group-h' }, this.head),
      this.body,
    );
  }

  setOpen(open: boolean): void {
    this.head.setAttribute('aria-expanded', String(open));
    this.body.hidden = !open;
    toggleClass(this.el, 'is-open', open);
  }
}
