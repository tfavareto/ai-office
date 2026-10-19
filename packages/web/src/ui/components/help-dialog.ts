// Help dialog: status legend, UI icon legend, keyboard shortcuts and how to install the Claude Code plugin.
import { t, type UiKey } from '../../i18n';
import type { AppContext } from '../context';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import { statusHint, statusLabel, type DisplayStatus } from '../model/status';
import { statusDot } from '../widgets';
import { Dialog, closeButton } from './overlay';

const LEGEND_STATUSES: readonly DisplayStatus[] = ['working', 'waiting', 'shell', 'idle', 'done', 'error'];

const SHORTCUTS: readonly [string, UiKey][] = [
  ['/', 'help.shortcut.search'],
  ['F', 'help.shortcut.follow'],
  ['T', 'help.shortcut.terminal'],
  ['N', 'help.shortcut.message'],
  ['P', 'help.shortcut.permission'],
  ['M', 'help.shortcut.day'],
  ['O', 'help.shortcut.overview'],
  ['[', 'help.shortcut.sidebar'],
  [']', 'help.shortcut.feed'],
  ['?', 'help.shortcut.help'],
  ['⌘/Ctrl + Enter', 'help.shortcut.send'],
  ['⌘/Ctrl + F', 'help.shortcut.find'],
  ['Esc', 'help.shortcut.escape'],
];

const ICON_LEGEND: readonly [IconName, UiKey][] = [
  ['fit', 'help.icon.fit'],
  ['bell', 'help.icon.bell'],
  ['calendar', 'help.icon.calendar'],
  ['history', 'help.icon.history'],
  ['feed', 'help.icon.feed'],
  ['terminal', 'help.icon.terminal'],
  ['target', 'help.icon.target'],
  ['follow', 'help.icon.follow'],
];

const INSTALL_COMMAND = 'npm run plugin:install';

export class HelpDialog extends Dialog {
  constructor(ctx: AppContext) {
    super(ctx, 'help', 'ao-help-title', 'ao-dialog--help');
    const copy = h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': t('help.install.copy'), title: t('help.install.copy'), onclick: () => ctx.copy(INSTALL_COMMAND, t('help.install.copied')) }, icon('copy', 14));
    this.panel.append(
      h('header', { class: 'ao-dialog-head' }, h('h2', { id: 'ao-help-title' }, t('help.title')), closeButton(t('common.close'), () => ctx.closeDialog())),
      h(
        'div',
        { class: 'ao-help-body' },
        h(
          'section',
          { class: 'ao-help-section' },
          h('h3', null, t('help.status.title')),
          h('ul', { class: 'ao-legend' }, ...LEGEND_STATUSES.map((s) => h('li', null, statusDot(s), h('strong', null, statusLabel(s)), h('span', null, statusHint(s))))),
          h('p', { class: 'ao-note' }, t('help.status.note')),
        ),
        h('section', { class: 'ao-help-section' }, h('h3', null, t('help.icons.title')), h('ul', { class: 'ao-legend' }, ...ICON_LEGEND.map(([name, key]) => h('li', null, icon(name, 16), h('span', null, t(key)))))),
        h('section', { class: 'ao-help-section' }, h('h3', null, t('help.shortcuts.title')), h('dl', { class: 'ao-shortcuts' }, ...SHORTCUTS.flatMap(([keys, text]) => [h('dt', null, h('kbd', { class: 'ao-kbd' }, keys)), h('dd', null, t(text))]))),
        h(
          'section',
          { class: 'ao-help-section' },
          h('h3', null, t('help.install.title')),
          h('p', { class: 'ao-note' }, t('help.install.intro')),
          h('div', { class: 'ao-code' }, h('code', null, INSTALL_COMMAND), copy),
          h('p', { class: 'ao-note' }, t('help.install.outro')),
        ),
      ),
    );
  }

  protected onOpen(): void {
    // Static content.
  }

  protected update(): void {
    // Static content.
  }
}
