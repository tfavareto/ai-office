// One entry of a conversation as a terminal line: what Claude Code shows (the prompt, the answer, the collapsed
// thinking, a tool call with its result), as the read-only terminal panel draws it. The Pro canvas prints sessions with
// its own CLI-style formatter (`pro/model/cli-format.ts`).
import type { TranscriptEntry } from '@ai-office/shared';
import { t } from '../../i18n';
import { localized, toolSummary } from '../display';
import { h } from '../dom';
import { formatClock } from '../format';
import { icon } from '../icons';
import { splitFences, toolPreview } from '../model/terminal';

/** Writes text into an element (the terminal panel wraps search hits in <mark>). */
export interface EntryText {
  append(parent: HTMLElement, text: string): void;
}

export const plainText: EntryText = {
  append: (parent, text) => {
    parent.appendChild(document.createTextNode(text));
  },
};

/** What an entry needs from the view that shows it. */
export interface EntryView {
  /** How to write the text of the entry at `index` (a fresh writer per entry). */
  text(index: number): EntryText;
  isExpanded(index: number, entry: TranscriptEntry): boolean;
  /** The user opened or closed a thinking block or a long result. */
  toggle(index: number): void;
}

export function entryElement(entry: TranscriptEntry, index: number, view: EntryView): HTMLElement {
  const text = view.text(index);
  switch (entry.kind) {
    case 'user':
      return userEl(entry, text);
    case 'assistant':
      return assistantEl(entry, text);
    case 'thinking':
      return thinkingEl(entry, index, text, view);
    case 'tool':
      return toolEl(entry, index, text, view);
    case 'system': {
      const el = h('div', { class: 'ao-term-entry ao-term-system' });
      text.append(el, localized(entry.msg, entry.text));
      return el;
    }
  }
}

function userEl(entry: Extract<TranscriptEntry, { kind: 'user' }>, writer: EntryText): HTMLElement {
  const text = h('div', { class: 'ao-term-text' });
  writer.append(text, entry.text);
  return h(
    'div',
    { class: 'ao-term-entry ao-term-user' },
    h('span', { class: 'ao-term-prompt', 'aria-hidden': 'true' }, '❯'),
    text,
    h('time', { class: 'ao-term-time' }, formatClock(entry.at)),
  );
}

function assistantEl(entry: Extract<TranscriptEntry, { kind: 'assistant' }>, writer: EntryText): HTMLElement {
  const text = h('div', { class: 'ao-term-text' });
  for (const block of splitFences(entry.text)) {
    const el = h(block.kind === 'code' ? 'pre' : 'p', {
      class: block.kind === 'code' ? 'ao-term-code' : 'ao-term-para',
    });
    writer.append(el, block.text);
    text.appendChild(el);
  }
  return h(
    'div',
    { class: 'ao-term-entry ao-term-assistant' },
    h('span', { class: 'ao-term-bullet', 'aria-hidden': 'true' }, '●'),
    text,
  );
}

function thinkingEl(
  entry: Extract<TranscriptEntry, { kind: 'thinking' }>,
  index: number,
  writer: EntryText,
  view: EntryView,
): HTMLElement {
  const open = view.isExpanded(index, entry);
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'ao-term-toggle',
      'aria-expanded': String(open),
      onclick: () => view.toggle(index),
    },
    icon(open ? 'chevronDown' : 'chevronRight', 12),
    h('span', null, t('terminal.thinking')),
  );
  const el = h('div', { class: `ao-term-entry ao-term-thinking ${open ? 'is-open' : ''}`.trim() }, toggle);
  if (open) {
    const text = h('div', { class: 'ao-term-text' });
    writer.append(text, entry.text);
    el.appendChild(text);
  }
  return el;
}

function toolEl(
  entry: Extract<TranscriptEntry, { kind: 'tool' }>,
  index: number,
  writer: EntryText,
  view: EntryView,
): HTMLElement {
  const open = view.isExpanded(index, entry);
  const name = h('strong', { class: 'ao-term-tool-name' });
  writer.append(name, entry.name);
  const summary = h('span', { class: 'ao-term-tool-summary' });
  writer.append(summary, toolSummary(entry));
  const head = h(
    'div',
    { class: 'ao-term-tool-head' },
    h('span', { class: `ao-term-bullet ${entry.error ? 'is-error' : ''}`.trim(), 'aria-hidden': 'true' }, '●'),
    name,
    summary,
  );
  const el = h(
    'div',
    { class: `ao-term-entry ao-term-tool ${entry.error ? 'is-error' : ''} ${open ? 'is-open' : ''}`.trim() },
    head,
  );
  if (entry.result) {
    const { preview, hiddenLines } = toolPreview(entry.result);
    const result = h('pre', { class: 'ao-term-result' });
    if (open) writer.append(result, entry.result);
    else result.textContent = preview;
    el.appendChild(result);
    if (hiddenLines > 0 || open) {
      el.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: 'ao-term-toggle',
            'aria-expanded': String(open),
            onclick: () => view.toggle(index),
          },
          icon(open ? 'chevronUp' : 'chevronDown', 12),
          h('span', null, open ? t('terminal.collapse') : t('terminal.moreLines', { n: hiddenLines })),
        ),
      );
    }
  }
  return el;
}
