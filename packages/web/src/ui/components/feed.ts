// Feed: collapsible bottom panel with the latest activities of the whole office.
import type { FeedItem } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext, Component } from '../context';
import { activityText } from '../display';
import { KeyedList, h, setText, toggleClass, type KeyedEntry } from '../dom';
import { formatClockSeconds } from '../format';
import { icon } from '../icons';
import { createAvatar } from '../widgets';

const RENDER_LIMIT = 60;
const AVATAR_SIZE = 20;

export class Feed implements Component {
  readonly el = h('section', { class: 'ao-feed', 'aria-label': t('topbar.feed.label') });
  private readonly toggle: HTMLButtonElement;
  private readonly latest = h('span', { class: 'ao-feed-latest' });
  private readonly count = h('span', { class: 'ao-section-count' });
  private readonly chevron = h('span', { class: 'ao-feed-chevron' }, icon('chevronUp', 16));
  private readonly list = h('ol', { class: 'ao-feed-list' });
  private readonly empty = h('p', { class: 'ao-note ao-feed-empty' }, t('feed.empty'));
  private readonly items: KeyedList<FeedItem>;
  private lastId = '';
  private lastOpen: boolean | null = null;

  constructor(private readonly ctx: AppContext) {
    this.toggle = h(
      'button',
      {
        type: 'button',
        class: 'ao-feed-bar',
        'aria-expanded': 'false',
        onclick: () => ctx.ui.set({ feedOpen: !ctx.ui.get().feedOpen }),
      },
      h('strong', null, t('feed.title')),
      this.count,
      this.latest,
      this.chevron,
    );
    this.el.append(this.toggle, h('div', { class: 'ao-feed-body' }, this.list, this.empty));
    this.items = new KeyedList(
      this.list,
      (item) => item.id,
      (item) => this.createItem(item),
    );
  }

  render(): void {
    const open = this.ctx.ui.get().feedOpen;
    const feed = this.ctx.feed();
    const newest = feed[feed.length - 1];
    if (open !== this.lastOpen) {
      this.lastOpen = open;
      toggleClass(this.el, 'is-open', open);
      this.toggle.setAttribute('aria-expanded', String(open));
      this.toggle.title = open ? t('feed.collapse') : t('feed.expand');
    }
    setText(this.count, String(feed.length));
    if (newest) {
      setText(this.latest, `${newest.agentName}: ${newest.activity.icon} ${activityText(newest.activity)}`);
    } else {
      setText(this.latest, t('feed.none'));
    }
    this.empty.hidden = feed.length > 0;
    if (!open || (newest?.id ?? '') === this.lastId) return;
    this.lastId = newest?.id ?? '';
    this.items.sync(feed.slice(-RENDER_LIMIT).reverse());
  }

  private createItem(initial: FeedItem): KeyedEntry<FeedItem> {
    const avatar = createAvatar(AVATAR_SIZE);
    const time = h('span', { class: 'ao-feed-time' });
    const who = h('strong', { class: 'ao-feed-who' });
    const what = h('span', { class: 'ao-feed-what' });
    const el = h(
      'li',
      { class: 'ao-feed-item' },
      h('button', { type: 'button', class: 'ao-feed-row' }, time, avatar.el, who, what),
    );
    let agentId = initial.agentId;
    el.querySelector('button')?.addEventListener('click', () => {
      if (this.ctx.agent(agentId)) this.ctx.selectAgent(agentId, { focus: true });
    });
    return {
      el,
      update: (item) => {
        agentId = item.agentId;
        const agent = this.ctx.agent(item.agentId);
        avatar.update(
          agent ?? { id: item.agentId, name: item.agentName, seed: 0 },
          agent ? this.ctx.world.portrait(agent.id, AVATAR_SIZE * 2) : null,
        );
        setText(time, formatClockSeconds(item.activity.at));
        setText(who, item.agentName);
        setText(what, `${item.activity.icon} ${activityText(item.activity)}`);
        toggleClass(el, 'is-error', item.activity.error === true);
      },
    };
  }
}
