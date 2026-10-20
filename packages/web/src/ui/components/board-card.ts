// One card of the task board: the task, who has it, where, how old it is, and the "message sent" state.
import type { Agent } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { h } from '../dom';
import { icon } from '../icons';
import type { BoardCard } from '../model/board';
import { roomColor } from '../model/rooms';
import { accountChip, createAvatar, liveText, type Avatar } from '../widgets';

export const COLUMN_KEYS = {
  pending: 'board.column.pending',
  in_progress: 'board.column.in_progress',
  completed: 'board.column.completed',
} as const;

export interface CardHandlers {
  open(card: BoardCard): void;
  /** Opens the "move to…" menu next to `anchor`. */
  move(card: BoardCard, anchor: HTMLElement): void;
  dragStart(card: BoardCard): void;
  dragEnd(): void;
}

export interface CardView {
  el: HTMLElement;
  /** Refreshes the portrait of the agent (it may load after the card was built). */
  refreshAvatar(): void;
}

/** Builds the card. Cards are rebuilt when the board changes, so nothing here needs to be updated in place. */
export function createCard(ctx: AppContext, card: BoardCard, handlers: CardHandlers, opts: { showRoom: boolean }): CardView {
  const agent = ctx.agent(card.agentId);
  const project = ctx.project(card.projectId);
  const column = t(COLUMN_KEYS[card.status]);
  const avatar = createAvatar(20);

  const meta = h('div', { class: 'ao-bcard-meta' }, agent ? agentTag(avatar, agent) : null, accountChip(ctx.account(card.accountId)));
  if (opts.showRoom && project) meta.append(roomTag(project.name, project.seed));
  if (card.changedAt !== undefined && !card.ghost) meta.append(liveText('ago', card.changedAt, 'ao-bcard-age'));

  const face = h(
    'button',
    {
      type: 'button',
      class: 'ao-bcard-face',
      'aria-label': t('board.card.aria', { task: card.label, agent: agent?.name ?? '', room: project?.name ?? '', column }),
      title: card.ghost ? undefined : t('board.card.hint'),
      'data-card': card.key,
    },
    h('span', { class: 'ao-bcard-title' }, card.label),
    meta,
    card.sent ? h('span', { class: 'ao-bcard-sent' }, icon('send', 12), t('board.card.sent')) : null,
  );

  const item = h('li', { class: `ao-bcard is-${card.status}${card.ghost ? ' is-ghost' : ''}${card.sent ? ' is-sent' : ''}`, 'data-key': card.key }, face);
  if (!card.ghost) {
    face.addEventListener('click', () => handlers.open(card));
    face.addEventListener('keydown', (event) => {
      if ((event.key === 'm' || event.key === 'M') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        handlers.move(card, face);
      }
    });
    const moveBtn = h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small ao-bcard-move', 'aria-label': t('board.card.moveAria', { task: card.label }), title: t('board.card.moveAria', { task: card.label }) }, icon('chevronDown', 14));
    moveBtn.addEventListener('click', () => handlers.move(card, moveBtn));
    item.append(moveBtn);
    item.draggable = true;
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', card.key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      item.classList.add('is-dragging');
      handlers.dragStart(card);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('is-dragging');
      handlers.dragEnd();
    });
  }
  return {
    el: item,
    refreshAvatar() {
      if (agent) avatar.update(agent, ctx.world.portrait(agent.id, 48));
    },
  };
}

function agentTag(avatar: Avatar, agent: Agent): HTMLElement {
  return h('span', { class: 'ao-bcard-agent' }, avatar.el, h('span', { class: 'ao-bcard-name' }, agent.name));
}

export function roomTag(name: string, seed: number): HTMLElement {
  const dot = h('span', { class: 'ao-bcard-roomdot', 'aria-hidden': 'true' });
  dot.style.background = roomColor(seed);
  return h('span', { class: 'ao-bcard-room' }, dot, h('span', { class: 'ao-bcard-roomname' }, name));
}
