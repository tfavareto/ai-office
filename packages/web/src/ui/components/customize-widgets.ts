// Controls of the customization dialog: a group of choices (color swatches or labelled buttons) that behaves as one
// radio group (arrow keys move the choice), with an "automatic" option that leaves the field to the defaults.
import { t } from '../../i18n';
import { h, setAttr, toggleClass } from '../dom';

export interface Choice<T extends string | number> {
  value: T;
  /** Spoken and shown as the tooltip; shown as the text of a button without a swatch. */
  label: string;
  /** Fill color: the choice is drawn as a swatch. */
  swatch?: string;
}

export interface ChoiceGroup<T extends string | number> {
  el: HTMLElement;
  /** `undefined` selects "automatic". */
  set(value: T | undefined): void;
  setDisabled(disabled: boolean): void;
}

/** A labelled row: the label above, the controls below. */
export function fieldRow(label: string, control: HTMLElement, id: string, hint?: HTMLElement): HTMLElement {
  return h('div', { class: 'ao-cz-field' }, h('span', { class: 'ao-cz-label', id }, label), control, hint ?? null);
}

export function createChoiceGroup<T extends string | number>(
  labelId: string,
  choices: readonly Choice<T>[],
  onChange: (value: T | undefined) => void,
): ChoiceGroup<T> {
  const entries: { value: T | undefined; button: HTMLButtonElement }[] = [];
  const el = h('div', { class: 'ao-cz-choices', role: 'radiogroup', 'aria-labelledby': labelId });
  let current: T | undefined;
  const make = (value: T | undefined, label: string, swatch: string | undefined): HTMLButtonElement => {
    const button = h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        class: `ao-cz-choice ${swatch !== undefined ? 'is-swatch' : ''}`.trim(),
        title: label,
        'aria-label': swatch !== undefined ? label : null,
        tabindex: '-1',
      },
      swatch !== undefined ? h('span', { class: 'ao-cz-swatch', style: `background:${swatch}` }) : label,
    );
    button.addEventListener('click', () => onChange(value));
    entries.push({ value, button });
    el.appendChild(button);
    return button;
  };
  make(undefined, t('customize.auto'), undefined).classList.add('is-auto');
  for (const choice of choices) make(choice.value, choice.label, choice.swatch);

  const paint = (): void => {
    const selected = entries.find((entry) => entry.value === current) ?? entries[0];
    for (const entry of entries) {
      const on = entry === selected;
      setAttr(entry.button, 'aria-checked', String(on));
      setAttr(entry.button, 'tabindex', on ? '0' : '-1');
      toggleClass(entry.button, 'is-on', on);
    }
  };
  el.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = entries.findIndex((entry) => entry.button === document.activeElement);
    if (index < 0) return;
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = entries[(index + step + entries.length) % entries.length];
    if (!next) return;
    next.button.focus();
    onChange(next.value);
  });
  paint();
  return {
    el,
    set(value) {
      if (value === current && el.querySelector('[aria-checked="true"]')) return;
      current = value;
      paint();
    },
    setDisabled(disabled) {
      for (const entry of entries) entry.button.disabled = disabled;
    },
  };
}
