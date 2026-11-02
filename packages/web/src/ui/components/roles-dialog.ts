// Roles: reusable instructions an agent starts with (Reviewer, Tester...). They stay in this browser and are chosen when
// hiring an agent. Saving under a name that exists replaces it.
import { t } from '../../i18n';
import { addRole, removeRole, validRole } from '../model/roles';
import type { AppContext } from '../context';
import { h } from '../dom';
import { icon } from '../icons';
import { button } from '../widgets';
import { Dialog, closeButton } from './overlay';

export class RolesDialog extends Dialog {
  private readonly list = h('ul', { class: 'ao-roles-list' });
  private readonly empty = h('p', { class: 'ao-note' }, t('roles.empty'));
  private readonly nameInput = h('input', {
    id: 'ao-role-name',
    type: 'text',
    class: 'ao-input',
    maxlength: 48,
    autocomplete: 'off',
  });
  private readonly instructionsInput = h('textarea', {
    id: 'ao-role-instructions',
    class: 'ao-textarea',
    rows: 6,
    maxlength: 8000,
  });
  private readonly saveButton: HTMLButtonElement;
  private signature: string | null = null;

  constructor(ctx: AppContext) {
    super(ctx, 'roles', 'ao-roles-title', 'ao-dialog--roles');
    this.saveButton = button({ label: t('roles.save'), variant: 'primary', onClick: () => this.save() });
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head' },
        h('h2', { id: 'ao-roles-title' }, t('roles.title')),
        closeButton(t('common.close'), () => ctx.closeDialog()),
      ),
      h(
        'div',
        { class: 'ao-roles-body' },
        this.empty,
        this.list,
        h('label', { class: 'ao-hire-label', for: 'ao-role-name' }, t('roles.name')),
        this.nameInput,
        h('label', { class: 'ao-hire-label', for: 'ao-role-instructions' }, t('roles.instructions')),
        this.instructionsInput,
      ),
      h('footer', { class: 'ao-dialog-foot' }, this.saveButton),
    );
    for (const field of [this.nameInput, this.instructionsInput])
      field.addEventListener('input', () => this.syncSave());
  }

  protected onOpen(): void {
    this.nameInput.value = '';
    this.instructionsInput.value = '';
    this.signature = null;
    this.syncSave();
  }

  protected update(): void {
    const roles = this.ctx.prefs.get().roles;
    const signature = roles.map((role) => `${role.id}:${role.name}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.empty.hidden = roles.length > 0;
    this.list.replaceChildren(
      ...roles.map((role) =>
        h(
          'li',
          { class: 'ao-roles-row' },
          h(
            'button',
            {
              type: 'button',
              class: 'ao-roles-name',
              onclick: () => {
                this.nameInput.value = role.name;
                this.instructionsInput.value = role.instructions;
                this.syncSave();
              },
            },
            role.name,
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ao-roles-remove',
              title: t('roles.remove', { name: role.name }),
              'aria-label': t('roles.remove', { name: role.name }),
              onclick: () => {
                this.ctx.prefs.set({ roles: removeRole(this.ctx.prefs.get().roles, role.id) });
                this.ctx.refresh();
              },
            },
            icon('x', 12),
          ),
        ),
      ),
    );
  }

  private syncSave(): void {
    this.saveButton.disabled = !validRole(this.nameInput.value, this.instructionsInput.value);
  }

  private save(): void {
    const name = this.nameInput.value;
    const instructions = this.instructionsInput.value;
    if (!validRole(name, instructions)) return;
    const role = { id: `r${this.ctx.now()}`, name, instructions };
    this.ctx.prefs.set({ roles: addRole(this.ctx.prefs.get().roles, role) });
    this.nameInput.value = '';
    this.instructionsInput.value = '';
    this.syncSave();
    this.ctx.announce(t('roles.saved', { name: name.trim() }));
    this.ctx.refresh();
  }
}
