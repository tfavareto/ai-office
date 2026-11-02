// Squads: saved groups of roles started together in a project, each in a real terminal and connected to the others. They
// stay in this browser. Saving under a name that exists replaces it.
import { SQUAD_MAX_MEMBERS } from '@ai-office/shared';
import { t, type TextKey } from '../../i18n';
import { describeError, BackendError } from '../../net/backend';
import { addSquad, removeSquad, validSquad, type SavedSquad } from '../../pro/model/squads';
import type { AppContext } from '../context';
import { h, setText } from '../dom';
import { icon } from '../icons';
import { button } from '../widgets';
import { Dialog, closeButton } from './overlay';

const ERROR_KEY: Readonly<Record<string, TextKey>> = {
  'terminals-off': 'squads.error.terminalsOff',
  'terminals-limit': 'squads.error.tooMany',
  'rate-limited': 'routines.error.rateLimited',
  demo: 'squads.error.demo',
};

function errorText(error: unknown): string {
  const key = error instanceof BackendError ? ERROR_KEY[error.message] : undefined;
  return key !== undefined ? t(key) : describeError(error);
}

export class SquadsDialog extends Dialog {
  private readonly list = h('ul', { class: 'ao-roles-list' });
  private readonly empty = h('p', { class: 'ao-note' }, t('squads.empty'));
  private readonly error = h('p', { class: 'ao-error', role: 'alert', hidden: true });
  private readonly projectSelect = h('select', { id: 'ao-squad-project', class: 'ao-select' });
  private readonly taskInput = h('textarea', { id: 'ao-squad-task', class: 'ao-textarea', rows: 2, maxlength: 8000 });
  private readonly nameInput = h('input', { id: 'ao-squad-name', type: 'text', class: 'ao-input', maxlength: 48 });
  private readonly roles = h('div', { class: 'ao-squad-roles' });
  private readonly saveButton: HTMLButtonElement;
  private signature: string | null = null;

  constructor(ctx: AppContext) {
    super(ctx, 'squads', 'ao-squads-title', 'ao-dialog--roles');
    this.saveButton = button({ label: t('squads.save'), variant: 'primary', onClick: () => this.save() });
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head' },
        h('h2', { id: 'ao-squads-title' }, t('squads.title')),
        closeButton(t('common.close'), () => ctx.closeDialog()),
      ),
      h(
        'div',
        { class: 'ao-roles-body' },
        h('p', { class: 'ao-note' }, t('squads.note')),
        this.empty,
        this.list,
        h('label', { class: 'ao-hire-label', for: 'ao-squad-project' }, t('routines.project')),
        this.projectSelect,
        h('label', { class: 'ao-hire-label', for: 'ao-squad-task' }, t('squads.task')),
        this.taskInput,
        this.error,
        h('h3', { class: 'ao-hire-label' }, t('squads.new')),
        h('label', { class: 'ao-hire-label', for: 'ao-squad-name' }, t('roles.name')),
        this.nameInput,
        h('p', { class: 'ao-hire-label' }, t('squads.members', { n: SQUAD_MAX_MEMBERS })),
        this.roles,
      ),
      h('footer', { class: 'ao-dialog-foot' }, this.saveButton),
    );
    this.nameInput.addEventListener('input', () => this.syncSave());
  }

  protected onOpen(): void {
    this.error.hidden = true;
    this.signature = null;
    this.projectSelect.replaceChildren(
      ...(this.ctx.liveSnapshot?.projects ?? []).map((project) => h('option', { value: project.path }, project.name)),
    );
    this.syncSave();
  }

  protected update(): void {
    const { proSquads, proRoles } = this.ctx.prefs.get();
    const signature = JSON.stringify([proSquads.map((squad) => squad.id), proRoles.map((role) => role.id)]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.empty.hidden = proSquads.length > 0;
    this.list.replaceChildren(...proSquads.map((squad) => this.row(squad)));
    this.roles.replaceChildren(
      ...(proRoles.length === 0
        ? [
            h(
              'button',
              { type: 'button', class: 'ao-quick-chip', onclick: () => this.ctx.openDialog('roles') },
              t('squads.needRoles'),
            ),
          ]
        : proRoles.map((role) =>
            h(
              'label',
              { class: 'ao-squad-role' },
              h('input', { type: 'checkbox', value: role.id, onchange: () => this.syncSave() }),
              h('span', null, role.name),
            ),
          )),
    );
    this.syncSave();
  }

  private row(squad: SavedSquad): HTMLElement {
    return h(
      'li',
      { class: 'ao-roles-row' },
      h(
        'div',
        { class: 'ao-routine-text' },
        h('strong', null, squad.name),
        h('span', { class: 'ao-note' }, squad.members.map((member) => member.name).join(' · ')),
      ),
      button({ label: t('squads.start'), variant: 'ghost', onClick: () => void this.start(squad) }),
      h(
        'button',
        {
          type: 'button',
          class: 'ao-pro-menu-remove',
          title: t('roles.remove', { name: squad.name }),
          'aria-label': t('roles.remove', { name: squad.name }),
          onclick: () => this.ctx.prefs.set({ proSquads: removeSquad(this.ctx.prefs.get().proSquads, squad.id) }),
        },
        icon('x', 12),
      ),
    );
  }

  private chosenRoles(): SavedSquad['members'] {
    const ids = new Set(
      [...this.roles.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value),
    );
    return this.ctx.prefs
      .get()
      .proRoles.filter((role) => ids.has(role.id))
      .map(({ name, instructions }) => ({ name, instructions }));
  }

  private syncSave(): void {
    this.saveButton.disabled = !validSquad(this.nameInput.value, this.chosenRoles());
  }

  private save(): void {
    const name = this.nameInput.value;
    const members = this.chosenRoles();
    if (!validSquad(name, members)) return;
    this.ctx.prefs.set({
      proSquads: addSquad(this.ctx.prefs.get().proSquads, { id: crypto.randomUUID(), name, members }),
    });
    this.nameInput.value = '';
    for (const input of this.roles.querySelectorAll<HTMLInputElement>('input:checked')) input.checked = false;
    this.syncSave();
  }

  private async start(squad: SavedSquad): Promise<void> {
    this.error.hidden = true;
    const task = this.taskInput.value.trim();
    try {
      await this.ctx.store.backend.startSquad({
        projectPath: this.projectSelect.value,
        members: [...squad.members],
        ...(task !== '' ? { task } : {}),
      });
      this.taskInput.value = '';
      this.ctx.closeDialog();
    } catch (error) {
      setText(this.error, errorText(error));
      this.error.hidden = false;
    }
  }
}
