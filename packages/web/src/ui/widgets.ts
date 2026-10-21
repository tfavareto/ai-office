// Small reusable UI pieces: buttons, chips, avatars, segmented controls, switches, live-updating times.
import type { Account, Agent } from '@ai-office/shared';
import { t } from '../i18n';
import { accountInitial, accountLabel } from './display';
import { compact, h, setAttr, toggleClass } from './dom';
import { formatAgo, formatDuration, formatElapsed, initials } from './format';
import { icon, type IconName } from './icons';
import type { DisplayStatus } from './model/status';

export interface IconButtonOptions {
  icon: IconName;
  label: string;
  onClick: (event: MouseEvent) => void;
  className?: string;
  size?: number;
  pressed?: boolean;
}

export function iconButton(opts: IconButtonOptions): HTMLButtonElement {
  const button = h(
    'button',
    {
      type: 'button',
      class: `ao-iconbtn ${opts.className ?? ''}`.trim(),
      'aria-label': opts.label,
      title: opts.label,
      'data-base-title': opts.label,
      onclick: opts.onClick as EventListener,
    },
    icon(opts.icon, opts.size ?? 18),
  );
  if (opts.pressed !== undefined) button.setAttribute('aria-pressed', String(opts.pressed));
  return button;
}

export function setPressed(button: HTMLElement, pressed: boolean): void {
  setAttr(button, 'aria-pressed', String(pressed));
  toggleClass(button, 'is-on', pressed);
}

export interface ButtonOptions {
  label: string;
  onClick: (event: MouseEvent) => void;
  icon?: IconName;
  variant?: 'primary' | 'soft' | 'ghost' | 'danger';
  title?: string;
  className?: string;
}

export function button(opts: ButtonOptions): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: `ao-btn ao-btn--${opts.variant ?? 'soft'} ${opts.className ?? ''}`.trim(),
      title: opts.title,
      'data-base-title': opts.title,
      onclick: opts.onClick as EventListener,
    },
    opts.icon ? icon(opts.icon, 16) : null,
    h('span', null, opts.label),
  );
}

/** Enables/disables a control and explains why through its tooltip (falling back to its normal tooltip). */
export function setDisabled(
  el: HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement,
  disabled: boolean,
  reason?: string,
): void {
  if (el.disabled !== disabled) el.disabled = disabled;
  const title = disabled && reason ? reason : (el.dataset.baseTitle ?? '');
  setAttr(el, 'title', title || null);
}

export function statusDot(status: DisplayStatus): HTMLSpanElement {
  return h('span', { class: `ao-dot ao-dot--${status}`, 'aria-hidden': 'true' });
}

export function setStatusDot(dot: HTMLElement, status: DisplayStatus): void {
  const next = `ao-dot ao-dot--${status}`;
  if (dot.className !== next) dot.className = next;
}

export function accountChip(account: Account | undefined, withLabel = false): HTMLSpanElement {
  const chip = h('span', { class: 'ao-account' });
  updateAccountChip(chip, account, withLabel);
  return chip;
}

export function updateAccountChip(chip: HTMLElement, account: Account | undefined, withLabel = false): void {
  const color = account?.color ?? '#8d99ad';
  chip.style.setProperty('--account', color);
  chip.title = account ? t('account.chip', { label: accountLabel(account) }) : t('account.unknown');
  chip.replaceChildren(
    ...compact(
      h('span', { class: 'ao-account-initial' }, account ? accountInitial(account) : '?'),
      withLabel ? h('span', { class: 'ao-account-label' }, account ? accountLabel(account) : '') : null,
    ),
  );
}

export interface Avatar {
  el: HTMLElement;
  update(agent: Pick<Agent, 'id' | 'name' | 'seed'>, portrait: string | null): void;
}

export function createAvatar(size: number): Avatar {
  const image = h('img', { alt: '', draggable: 'false', decoding: 'async' });
  const letter = h('span', { class: 'ao-avatar-letter' });
  const el = h('span', { class: 'ao-avatar', 'aria-hidden': 'true' }, letter, image);
  el.style.setProperty('--avatar-size', `${size}px`);
  let lastPortrait: string | null = null;
  let lastKey = '';
  return {
    el,
    update(agent, portrait) {
      const key = `${agent.name}|${agent.seed}`;
      if (key !== lastKey) {
        lastKey = key;
        const hue = Math.abs(agent.seed) % 360;
        el.style.setProperty('--avatar-a', `hsl(${hue} 55% 48%)`);
        el.style.setProperty('--avatar-b', `hsl(${(hue + 36) % 360} 60% 34%)`);
        setLetter(letter, initials(agent.name));
      }
      if (portrait !== lastPortrait) {
        lastPortrait = portrait;
        if (portrait) image.src = portrait;
        else image.removeAttribute('src');
        toggleClass(el, 'has-image', portrait !== null);
      }
    },
  };
}

function setLetter(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

// --- live times ------------------------------------------------------------------------------------------------------

/** ago: "há 3 min" · elapsed: stopwatch since · duration: "3 min" since · until: countdown to the timestamp. */
export type LiveKind = 'ago' | 'elapsed' | 'duration' | 'until';

function formatLive(kind: LiveKind, ms: number): string {
  switch (kind) {
    case 'ago':
      return formatAgo(ms);
    case 'elapsed':
      return formatElapsed(ms);
    case 'duration':
      return formatDuration(ms);
    case 'until':
      return formatElapsed(ms);
  }
}

/** A text node that the clock keeps fresh without re-rendering. */
export function liveText(kind: LiveKind, since: number, className = ''): HTMLSpanElement {
  const el = h('span', { class: `ao-live ${className}`.trim(), 'data-live': kind });
  setLive(el, kind, since);
  return el;
}

export function setLive(el: HTMLElement, kind: LiveKind, since: number): void {
  el.dataset.live = kind;
  el.dataset.since = String(since);
}

export function tickLive(root: ParentNode, now: number): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-live]')) {
    const since = Number(el.dataset.since);
    if (!Number.isFinite(since)) continue;
    const kind = el.dataset.live as LiveKind;
    const text = formatLive(kind, kind === 'until' ? since - now : now - since);
    if (el.textContent !== text) el.textContent = text;
  }
}

// --- form controls ---------------------------------------------------------------------------------------------------

export interface Segmented<T extends string> {
  el: HTMLElement;
  set(value: T): void;
}

export function createSegmented<T extends string>(
  label: string,
  options: readonly { value: T; label: string }[],
  onChange: (value: T) => void,
): Segmented<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h('div', { class: 'ao-segmented', role: 'radiogroup', 'aria-label': label });
  for (const option of options) {
    const btn = h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        class: 'ao-segmented-item',
        onclick: () => onChange(option.value),
      },
      option.label,
    );
    buttons.set(option.value, btn);
    el.appendChild(btn);
  }
  return {
    el,
    set(value) {
      for (const [key, btn] of buttons) {
        const on = key === value;
        setAttr(btn, 'aria-checked', String(on));
        toggleClass(btn, 'is-on', on);
      }
    },
  };
}

export interface Switch {
  el: HTMLButtonElement;
  set(on: boolean): void;
}

export function createSwitch(label: string, onChange: (on: boolean) => void): Switch {
  const el = h(
    'button',
    { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': label, class: 'ao-switch' },
    h('span', { class: 'ao-switch-knob' }),
  );
  el.addEventListener('click', () => {
    if (el.disabled) return;
    onChange(el.getAttribute('aria-checked') !== 'true');
  });
  return {
    el,
    set(on) {
      setAttr(el, 'aria-checked', String(on));
      toggleClass(el, 'is-on', on);
    },
  };
}

export function emptyNote(text: string, className = ''): HTMLElement {
  return h('p', { class: `ao-note ${className}`.trim() }, text);
}

export function sectionTitle(text: string, trailing?: Node | null): HTMLElement {
  return h('div', { class: 'ao-section-title' }, h('span', null, text), trailing ?? null);
}
