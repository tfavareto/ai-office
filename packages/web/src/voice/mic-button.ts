// A small, reusable microphone control for any text field: asks to download the model, shows the progress, records
// (with a timer and a level meter), shows a spinner while transcribing and hands the text to `onText`.
import { onLocaleChange, t } from '../i18n';
import { h, setAttr, setText, toggleClass } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { micView, type MicView } from './mic-view';
import type { VoiceModels } from './models';
import type { VoicePreference } from './preference';
import type { VoiceInput } from './types';

export interface MicButtonOptions {
  input: VoiceInput;
  models: VoiceModels;
  preference: VoicePreference;
  /** Receives the transcribed text (never empty). The person reviews it before anything is sent. */
  onText: (text: string) => void;
  className?: string;
}

export interface MicButton {
  readonly el: HTMLElement;
  destroy(): void;
}

const EMPTY_NOTE_MS = 3500;
const ICON_SIZE = 18;
const LABELLED_KINDS: ReadonlySet<MicView['kind']> = new Set(['download', 'error']);

export function createMicButton(options: MicButtonOptions): MicButton {
  const { input, models, preference } = options;
  let currentIcon: IconName | undefined;
  let lastKind: MicView['kind'] | undefined;
  let note: string | undefined;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let view = micView(input.status());

  const iconHolder = h('span', { class: 'ao-mic-icon', 'aria-hidden': 'true' });
  const label = h('span', { class: 'ao-mic-label' });
  const main = h('button', { type: 'button', class: 'ao-mic-main' }, iconHolder, label);
  const text = h('span', { class: 'ao-mic-text' });
  const meterFill = h('span', { class: 'ao-mic-meter-fill' });
  const meter = h('span', { class: 'ao-mic-meter', 'aria-hidden': 'true' }, meterFill);
  const barFill = h('span', { class: 'ao-progress-bar' });
  const bar = h('span', { class: 'ao-progress ao-mic-progress', 'aria-hidden': 'true' }, barFill);
  const cancel = h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small ao-mic-cancel' }, icon('x', 14));
  const live = h('span', { class: 'ao-visually-hidden', role: 'status', 'aria-live': 'polite' });
  const el = h(
    'div',
    { class: `ao-mic ${options.className ?? ''}`.trim() },
    main,
    h('span', { class: 'ao-mic-body' }, text, meter, bar),
    cancel,
    live,
  );

  function clearNote(): void {
    clearTimeout(noteTimer);
    note = undefined;
  }

  function render(): void {
    view = micView(input.status(), models.statusOf(preference.size())?.bytes);
    if (view.kind !== 'record') clearNote();
    el.dataset.kind = view.kind;
    if (currentIcon !== view.icon) {
      currentIcon = view.icon;
      iconHolder.replaceChildren(icon(view.icon, ICON_SIZE));
    }
    setText(label, LABELLED_KINDS.has(view.kind) ? view.actionLabel : '');
    setAttr(main, 'aria-label', view.actionLabel);
    setAttr(main, 'title', view.kind === 'unavailable' ? view.text : view.actionLabel);
    setAttr(main, 'aria-pressed', view.kind === 'listening' ? 'true' : null);
    main.disabled = view.disabled;
    toggleClass(main, 'is-busy', view.kind === 'working' || view.kind === 'progress');
    toggleClass(main, 'is-listening', view.kind === 'listening');
    const shown = note ?? (view.kind === 'unavailable' ? '' : view.text);
    setText(text, shown);
    text.hidden = shown === '';
    toggleClass(text, 'is-error', view.kind === 'error');
    meter.hidden = view.meter === undefined;
    setAttr(meter, 'title', t('voice.mic.meter'));
    meterFill.style.setProperty('--level', String(view.meter ?? 0));
    bar.hidden = view.progress === undefined;
    barFill.style.width = `${Math.round((view.progress ?? 0) * 100)}%`;
    cancel.hidden = !view.cancellable;
    setAttr(cancel, 'aria-label', t('voice.mic.cancel'));
    setAttr(cancel, 'title', t('voice.mic.cancel'));
    // Announce a change of situation, not every tick of the timer or of a progress bar.
    if (view.kind !== lastKind) {
      lastKind = view.kind;
      setText(live, shown);
    }
  }

  async function stopAndInsert(): Promise<void> {
    const transcript = await input.stop();
    if (transcript !== '') return options.onText(transcript);
    if (input.status().state !== 'ready') return;
    note = t('voice.mic.empty');
    noteTimer = setTimeout(() => {
      note = undefined;
      render();
    }, EMPTY_NOTE_MS);
    render();
    setText(live, note);
  }

  main.addEventListener('click', () => {
    if (view.kind === 'download') void input.prepare();
    else if (view.kind === 'record') void input.start();
    else if (view.kind === 'listening') void stopAndInsert();
    else if (view.kind === 'error') void (view.retry === 'prepare' ? input.prepare() : input.start());
  });
  cancel.addEventListener('click', () => input.cancel());
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !view.cancellable) return;
    event.stopPropagation();
    input.cancel();
  });

  const unsubscribers = [
    input.onStatus(render),
    models.onChange(render),
    preference.onChange(render),
    // Texts are written when the control is built: a new language needs them again.
    onLocaleChange(render),
  ];
  render();

  return {
    el,
    destroy() {
      clearNote();
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}
