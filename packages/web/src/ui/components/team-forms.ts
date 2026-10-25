// The two forms of the team dialog: host a team, and join one. They keep what is typed while the dialog refreshes.
import {
  TEAM_DEFAULT_PORT,
  TEAM_DEVICE_MAX,
  TEAM_NAME_MAX,
  TEAM_TEAMNAME_MAX,
  normalizePairingCode,
  type LanInterface,
} from '@ai-office/shared';
import { t } from '../../i18n';
import { h } from '../dom';
import { button } from '../widgets';

const NAME_KEY = 'ai-office:team-name';

/** The name typed last time, so a returning person does not retype it. */
export function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage may be blocked; the name is just not remembered.
  }
}

function field(id: string, label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'ao-hire-field' }, h('label', { class: 'ao-hire-label', for: id }, label), control);
}

function input(id: string, extra: Record<string, string | number | boolean> = {}): HTMLInputElement {
  return h('input', { id, class: 'ao-input', autocomplete: 'off', spellcheck: 'false', ...extra });
}

export interface HostValues {
  name: string;
  teamName: string;
  address: string;
  port: number;
  /** Empty: the server picks a neutral label. */
  device: string;
  allowShared: boolean;
}

export class HostForm {
  readonly el: HTMLFormElement;
  private readonly name: HTMLInputElement;
  private readonly teamName: HTMLInputElement;
  private readonly network: HTMLSelectElement;
  private readonly port: HTMLInputElement;
  private readonly device: HTMLInputElement;
  private readonly shared = h('input', { type: 'checkbox', class: 'ao-team-shared-check' });
  private readonly sharedRow = h(
    'label',
    { class: 'ao-team-shared ao-note ao-team-warn', hidden: true },
    this.shared,
    h('span', null, t('team.field.shared')),
  );
  readonly submit: HTMLButtonElement;
  private readonly noNetwork = h('p', { class: 'ao-note ao-team-warn', hidden: true }, t('team.host.noInterface'));
  private interfaces = '';
  private sharedAddresses: ReadonlySet<string> = new Set();

  constructor(label: string, onSubmit: (values: HostValues) => void, idPrefix = 'ao-team-host') {
    this.name = input(`${idPrefix}-name`, {
      maxlength: TEAM_NAME_MAX,
      placeholder: t('team.field.name.placeholder'),
    });
    this.teamName = input(`${idPrefix}-team`, { maxlength: TEAM_TEAMNAME_MAX });
    this.network = h('select', { id: `${idPrefix}-net`, class: 'ao-select' });
    this.port = input(`${idPrefix}-port`, { inputmode: 'numeric', maxlength: 5 });
    this.port.value = String(TEAM_DEFAULT_PORT);
    this.device = input(`${idPrefix}-device`, {
      maxlength: TEAM_DEVICE_MAX,
      placeholder: t('team.field.device.placeholder'),
    });
    this.name.value = rememberedName();
    this.submit = button({ label, variant: 'primary', onClick: () => undefined });
    this.submit.type = 'submit';
    this.el = h(
      'form',
      { class: 'ao-team-form', novalidate: true },
      field(`${idPrefix}-name`, t('team.field.name'), this.name),
      field(`${idPrefix}-team`, t('team.field.teamName'), this.teamName),
      h(
        'div',
        { class: 'ao-team-form-row' },
        field(`${idPrefix}-net`, t('team.field.interface'), this.network),
        field(`${idPrefix}-port`, t('team.field.port'), this.port),
      ),
      field(`${idPrefix}-device`, t('team.field.device'), this.device),
      this.sharedRow,
      this.noNetwork,
      this.submit,
    );
    this.network.addEventListener('change', () => this.refreshShared());
    this.shared.addEventListener('change', () => this.refreshShared());
    this.el.addEventListener('submit', (event) => {
      event.preventDefault();
      onSubmit(this.values());
    });
  }

  values(): HostValues {
    return {
      name: this.name.value.trim(),
      teamName: this.teamName.value.trim(),
      address: this.network.value,
      port: Number(this.port.value),
      device: this.device.value.trim(),
      allowShared: this.isShared() && this.shared.checked,
    };
  }

  private isShared(): boolean {
    return this.sharedAddresses.has(this.network.value);
  }

  /** The warning about a shared address shows only for one, and the form waits for the person to tick it. */
  private refreshShared(): void {
    this.sharedRow.hidden = !this.isShared();
    this.submit.disabled = this.interfaces === '' || (this.isShared() && !this.shared.checked);
  }

  /** Fills the network list (keeping the choice) and, once, the names the form starts with. */
  update(interfaces: readonly LanInterface[], defaults: { name?: string; teamName?: string; port?: number }): void {
    const signature = interfaces.map((entry) => `${entry.name}${entry.address}`).join('|');
    if (signature !== this.interfaces) {
      const chosen = this.network.value;
      this.interfaces = signature;
      this.sharedAddresses = new Set(interfaces.filter((entry) => entry.shared === true).map((entry) => entry.address));
      this.network.replaceChildren(
        ...interfaces.map((entry) =>
          h(
            'option',
            { value: entry.address },
            entry.shared === true
              ? t('team.network.shared', { name: entry.name, address: entry.address })
              : `${entry.name} · ${entry.address}`,
          ),
        ),
      );
      if (interfaces.some((entry) => entry.address === chosen)) this.network.value = chosen;
    }
    this.noNetwork.hidden = interfaces.length > 0;
    this.refreshShared();
    if (defaults.name !== undefined && this.name.value === '') this.name.value = defaults.name;
    if (defaults.teamName !== undefined && this.teamName.value === '') this.teamName.value = defaults.teamName;
    if (defaults.port !== undefined && this.port.value === String(TEAM_DEFAULT_PORT))
      this.port.value = String(defaults.port);
  }

  setBusy(busy: boolean): void {
    for (const control of [this.name, this.teamName, this.network, this.port, this.device, this.shared])
      control.disabled = busy;
    this.submit.disabled = busy || this.interfaces === '' || (this.isShared() && !this.shared.checked);
  }
}

export interface JoinValues {
  name: string;
  address: string;
  code: string;
  device: string;
}

export class JoinForm {
  readonly el: HTMLFormElement;
  private readonly name = input('ao-team-join-name', {
    maxlength: TEAM_NAME_MAX,
    placeholder: t('team.field.name.placeholder'),
  });
  private readonly address = input('ao-team-join-address', {
    placeholder: t('team.field.address.placeholder'),
    inputmode: 'decimal',
  });
  private readonly code = input('ao-team-join-code', {
    maxlength: 12,
    placeholder: t('team.field.code.placeholder'),
    autocapitalize: 'characters',
  });
  private readonly device = input('ao-team-join-device', {
    maxlength: TEAM_DEVICE_MAX,
    placeholder: t('team.field.device.placeholder'),
  });
  readonly submit: HTMLButtonElement;

  constructor(onSubmit: (values: JoinValues) => void) {
    this.name.value = rememberedName();
    this.code.classList.add('ao-team-code-input');
    this.submit = button({ label: t('team.join.start'), variant: 'primary', onClick: () => undefined });
    this.submit.type = 'submit';
    this.code.addEventListener('input', () => {
      const start = this.code.selectionStart;
      this.code.value = this.code.value.toUpperCase();
      this.code.setSelectionRange(start, start);
    });
    this.el = h(
      'form',
      { class: 'ao-team-form', novalidate: true },
      field('ao-team-join-name', t('team.field.name'), this.name),
      field('ao-team-join-address', t('team.field.address'), this.address),
      field('ao-team-join-code', t('team.field.code'), this.code),
      field('ao-team-join-device', t('team.field.device'), this.device),
      this.submit,
    );
    this.el.addEventListener('submit', (event) => {
      event.preventDefault();
      onSubmit(this.values());
    });
  }

  values(): JoinValues {
    return {
      name: this.name.value.trim(),
      address: this.address.value.trim(),
      code: normalizePairingCode(this.code.value),
      device: this.device.value.trim(),
    };
  }

  /** The code is single use: clear it after an attempt. */
  clearCode(): void {
    this.code.value = '';
  }

  setBusy(busy: boolean): void {
    for (const control of [this.name, this.address, this.code, this.device]) control.disabled = busy;
    this.submit.disabled = busy;
    const label = this.submit.querySelector('span');
    if (label !== null) label.textContent = busy ? t('team.working') : t('team.join.start');
  }
}
