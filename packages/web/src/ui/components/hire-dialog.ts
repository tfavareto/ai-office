// "Hire an agent": choose the project folder (an existing room or a new folder), the account, a first task, the model
// and the permission mode, then open a terminal window with Claude Code for it. Cmd/Ctrl+Enter submits.
import {
  type Account,
  HIRE_MAX_PROMPT,
  type HireCheckReason,
  type HireModel,
  type HirePermissionMode,
  type Project,
} from '@ai-office/shared';
import { type UiKey, t } from '../../i18n';
import { describeError } from '../../net/backend';
import { localOnlyHint, type AppContext } from '../context';
import { accountLabel } from '../display';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import {
  type HireForm,
  buildHireRequest,
  defaultAccountId,
  folderReasonKey,
  hireAccounts,
  hireErrorKey,
  isSimulatedHire,
  isSubmitShortcut,
  localPathProblem,
  promptTooLong,
  recentFolders,
} from '../model/hire';
import { accountChip, button } from '../widgets';
import { Dialog, closeButton } from './overlay';

/** The project <select> value that means "a folder with no room yet". */
const NEW_PROJECT = '__new__';
const CHECK_DELAY_MS = 300;

const MODELS: readonly [HireModel, UiKey][] = [
  ['default', 'hire.model.default'],
  ['opus', 'hire.model.opus'],
  ['sonnet', 'hire.model.sonnet'],
  ['haiku', 'hire.model.haiku'],
];

const MODES: readonly [HirePermissionMode, UiKey][] = [
  ['default', 'hire.mode.default'],
  ['acceptEdits', 'hire.mode.acceptEdits'],
  ['plan', 'hire.mode.plan'],
];

const MODE_HINTS: Readonly<Record<HirePermissionMode, UiKey>> = {
  default: 'hire.mode.hint.default',
  acceptEdits: 'hire.mode.hint.acceptEdits',
  plan: 'hire.mode.hint.plan',
};

type PathCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok' }
  | { state: 'bad'; reason: HireCheckReason }
  | { state: 'unknown' };

function field(label: string, control: HTMLElement, id: string, extra?: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'ao-hire-field' },
    h('label', { class: 'ao-hire-label', for: id }, label),
    control,
    extra ?? null,
  );
}

function selectOf<T extends string>(
  id: string,
  options: readonly (readonly [T, UiKey])[],
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = h(
    'select',
    { id, class: 'ao-select ao-hire-select' },
    ...options.map(([value, key]) => h('option', { value }, t(key))),
  );
  select.addEventListener('change', () => onChange(select.value as T));
  return select;
}

export class HireDialog extends Dialog {
  private form: HireForm = {
    roomPath: undefined,
    path: '',
    accountId: '',
    prompt: '',
    model: 'default',
    permissionMode: 'default',
  };
  private check: PathCheck = { state: 'idle' };
  private recent: { path: string; name: string }[] = [];
  private busy = false;
  private error = '';
  private checkTimer: ReturnType<typeof setTimeout> | undefined;
  private checkToken = 0;
  private recentToken = 0;
  private roomsSignature = '';
  private accountsSignature = '';
  private recentSignature = '';

  private readonly projectSelect = h('select', { id: 'ao-hire-project', class: 'ao-select ao-hire-select' });
  private readonly roomPath = h('code', { class: 'ao-hire-path' });
  private readonly newProject = h('div', { class: 'ao-hire-newproject' });
  private readonly pathInput = h('input', {
    id: 'ao-hire-path',
    type: 'text',
    class: 'ao-input',
    placeholder: t('hire.path.placeholder'),
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-describedby': 'ao-hire-path-feedback',
  });
  private readonly pathFeedback = h('p', {
    id: 'ao-hire-path-feedback',
    class: 'ao-hire-feedback',
    role: 'status',
    'aria-live': 'polite',
  });
  private readonly recentBlock = h('div', { class: 'ao-hire-recent' });
  private readonly accountField = h('div', { class: 'ao-hire-field' });
  private readonly accountGroup = h('div', {
    class: 'ao-chips ao-hire-accounts',
    role: 'radiogroup',
    'aria-label': t('hire.account'),
  });
  private readonly promptInput = h('textarea', {
    id: 'ao-hire-prompt',
    class: 'ao-textarea ao-hire-prompt',
    rows: 4,
    placeholder: t('hire.prompt.placeholder'),
    spellcheck: 'true',
    'aria-describedby': 'ao-hire-prompt-count',
  });
  private readonly promptCount = h('span', { id: 'ao-hire-prompt-count', class: 'ao-hire-count' });
  private readonly modelSelect: HTMLSelectElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly modeHint = h('p', { class: 'ao-note ao-hire-modehint' });
  private readonly errorBox = h('p', { class: 'ao-error ao-hire-error', role: 'alert', hidden: true });
  private readonly submitBtn: HTMLButtonElement;
  private readonly submitLabel: HTMLElement;

  constructor(ctx: AppContext) {
    super(ctx, 'hire', 'ao-hire-title', 'ao-dialog--hire');
    this.modelSelect = selectOf('ao-hire-model', MODELS, (model) => (this.form = { ...this.form, model }));
    this.modeSelect = selectOf('ao-hire-mode', MODES, (permissionMode) => {
      this.form = { ...this.form, permissionMode };
      this.ctx.refresh();
    });
    this.submitBtn = button({
      label: t('hire.submit'),
      icon: 'plus',
      variant: 'primary',
      onClick: () => void this.submit(),
    });
    this.submitLabel = this.submitBtn.querySelector('span') as HTMLElement;
    this.submitBtn.append(h('kbd', { class: 'ao-kbd ao-hire-kbd', 'aria-hidden': 'true' }, '⌘↵'));
    this.projectSelect.addEventListener('change', () => this.chooseProject(this.projectSelect.value));
    this.pathInput.addEventListener('input', () => this.onPathInput());
    this.promptInput.addEventListener('input', () => {
      this.form = { ...this.form, prompt: this.promptInput.value };
      this.ctx.refresh();
    });
    this.newProject.append(field(t('hire.path'), this.pathInput, 'ao-hire-path', this.pathFeedback), this.recentBlock);
    this.accountField.append(
      h('span', { class: 'ao-hire-label', id: 'ao-hire-account-label' }, t('hire.account')),
      this.accountGroup,
    );
    this.accountGroup.setAttribute('aria-labelledby', 'ao-hire-account-label');
    this.panel.addEventListener('keydown', (event) => {
      if (!isSubmitShortcut(event)) return;
      event.preventDefault();
      void this.submit();
    });
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head' },
        h('h2', { id: 'ao-hire-title' }, t('hire.title')),
        closeButton(t('common.close'), () => ctx.closeDialog()),
      ),
      h(
        'form',
        {
          class: 'ao-hire-body',
          novalidate: true,
          onsubmit: ((event: Event) => event.preventDefault()) as EventListener,
        },
        field(t('hire.project'), this.projectSelect, 'ao-hire-project', this.roomPath),
        this.newProject,
        this.accountField,
        field(t('hire.prompt'), this.promptInput, 'ao-hire-prompt', this.promptCount),
        h(
          'div',
          { class: 'ao-hire-row' },
          field(t('hire.model'), this.modelSelect, 'ao-hire-model'),
          field(t('hire.mode'), this.modeSelect, 'ao-hire-mode'),
        ),
        this.modeHint,
        h('p', { class: 'ao-hire-note' }, icon('terminal', 16), h('span', null, t('hire.note'))),
        this.errorBox,
      ),
      h(
        'footer',
        { class: 'ao-dialog-foot' },
        button({ label: t('common.cancel'), variant: 'ghost', onClick: () => ctx.closeDialog() }),
        this.submitBtn,
      ),
    );
  }

  // --- lifecycle -----------------------------------------------------------------------------------------------------

  protected onOpen(): void {
    const snapshot = this.ctx.snapshot;
    const target = this.ctx.ui.get().hire;
    const rooms = this.rooms();
    const presetIsRoom = target.projectPath !== undefined && rooms.some((room) => room.path === target.projectPath);
    // Without a place to start from (sidebar button, shortcut) the first room is the likely one; a folder that is no room yet goes to the path field.
    const roomPath = presetIsRoom ? target.projectPath : target.projectPath === undefined ? rooms[0]?.path : undefined;
    const path = target.projectPath !== undefined && !presetIsRoom ? target.projectPath : '';
    const accounts = hireAccounts(snapshot, isSimulatedHire(snapshot, roomPath ?? path));
    this.form = {
      roomPath,
      path,
      accountId: defaultAccountId(snapshot, roomPath, accounts),
      prompt: '',
      model: 'default',
      permissionMode: 'default',
      ...(target.deskIndex !== undefined ? { deskIndex: target.deskIndex } : {}),
    };
    this.busy = false;
    this.error = '';
    this.check = { state: 'idle' };
    this.roomsSignature = '';
    this.accountsSignature = '';
    this.recentSignature = '';
    this.recent = [];
    this.promptInput.value = '';
    this.pathInput.value = path;
    this.modelSelect.value = 'default';
    this.modeSelect.value = 'default';
    if (roomPath === undefined && path !== '') this.onPathInput();
    void this.loadRecent();
    requestAnimationFrame(() =>
      (roomPath === undefined ? this.pathInput : this.promptInput).focus({ preventScroll: true }),
    );
  }

  protected update(): void {
    this.syncProjects();
    this.syncAccounts();
    this.syncRecent();
    const isNew = this.form.roomPath === undefined;
    this.newProject.hidden = !isNew;
    this.roomPath.hidden = isNew;
    setText(this.roomPath, this.form.roomPath ?? '');
    this.renderFeedback();
    setText(this.promptCount, t('hire.prompt.count', { n: this.form.prompt.length, max: HIRE_MAX_PROMPT }));
    toggleClass(this.promptCount, 'is-over', promptTooLong(this.form.prompt));
    setText(this.modeHint, t(MODE_HINTS[this.form.permissionMode]));
    this.errorBox.hidden = this.error === '';
    setText(this.errorBox, this.error);
    setText(this.submitLabel, this.busy ? t('hire.submitting') : t('hire.submit'));
    const blocked = !this.ctx.isLocal ? localOnlyHint() : null;
    this.submitBtn.disabled = blocked !== null || !this.canSubmit();
    this.submitBtn.title = blocked ?? '';
    for (const control of [this.projectSelect, this.pathInput, this.promptInput, this.modelSelect, this.modeSelect])
      control.disabled = this.busy;
  }

  // --- data ----------------------------------------------------------------------------------------------------------

  private rooms(): Project[] {
    return [...(this.ctx.snapshot?.projects ?? [])].sort((a, b) => a.order - b.order);
  }

  private accounts(): Account[] {
    const path = this.form.roomPath ?? this.form.path.trim();
    return hireAccounts(this.ctx.snapshot, isSimulatedHire(this.ctx.snapshot, path));
  }

  private async loadRecent(): Promise<void> {
    const token = ++this.recentToken;
    try {
      const sessions = await this.ctx.store.backend.sessions();
      if (token !== this.recentToken) return;
      this.recent = recentFolders(
        sessions,
        this.rooms().map((room) => room.path),
      );
    } catch {
      this.recent = [];
    }
    this.ctx.refresh();
  }

  // --- project -------------------------------------------------------------------------------------------------------

  private syncProjects(): void {
    const rooms = this.rooms();
    const signature = `${rooms.map((room) => `${room.path}|${room.name}`).join(',')}|${this.form.roomPath ?? NEW_PROJECT}`;
    if (signature === this.roomsSignature) return;
    this.roomsSignature = signature;
    this.projectSelect.replaceChildren(
      ...rooms.map((room) => h('option', { value: room.path }, room.name)),
      h('option', { value: NEW_PROJECT }, t('hire.project.new')),
    );
    this.projectSelect.value =
      this.form.roomPath !== undefined && rooms.some((room) => room.path === this.form.roomPath)
        ? this.form.roomPath
        : NEW_PROJECT;
  }

  private chooseProject(value: string): void {
    const roomPath = value === NEW_PROJECT ? undefined : value;
    const accounts = hireAccounts(
      this.ctx.snapshot,
      isSimulatedHire(this.ctx.snapshot, roomPath ?? this.form.path.trim()),
    );
    this.form = {
      ...this.form,
      roomPath,
      accountId:
        accounts.some((account) => account.id === this.form.accountId) && roomPath === undefined
          ? this.form.accountId
          : defaultAccountId(this.ctx.snapshot, roomPath, accounts),
    };
    this.error = '';
    if (roomPath === undefined) this.onPathInput();
    this.update();
    if (roomPath === undefined) this.pathInput.focus({ preventScroll: true });
    this.ctx.refresh();
  }

  private onPathInput(): void {
    const path = this.pathInput.value;
    this.form = { ...this.form, path };
    this.error = '';
    if (this.checkTimer !== undefined) clearTimeout(this.checkTimer);
    const token = ++this.checkToken;
    const problem = localPathProblem(path);
    if (path.trim() === '') this.check = { state: 'idle' };
    else if (problem !== null) this.check = { state: 'bad', reason: problem };
    else {
      this.check = { state: 'checking' };
      this.checkTimer = setTimeout(() => void this.verify(path, token), CHECK_DELAY_MS);
    }
    this.ctx.refresh();
  }

  private async verify(path: string, token: number): Promise<void> {
    let next: PathCheck;
    try {
      const result = await this.ctx.store.backend.checkFolder(path.trim());
      next = result.ok ? { state: 'ok' } : { state: 'bad', reason: result.reason ?? 'not-found' };
    } catch {
      next = { state: 'unknown' };
    }
    if (token !== this.checkToken) return;
    this.check = next;
    this.ctx.refresh();
  }

  private renderFeedback(): void {
    const check = this.check;
    const text =
      check.state === 'idle'
        ? t('hire.path.hint')
        : check.state === 'checking'
          ? t('hire.path.checking')
          : check.state === 'ok'
            ? t('hire.path.ok')
            : check.state === 'bad'
              ? t(folderReasonKey(check.reason))
              : t('hire.path.unknown');
    setText(this.pathFeedback, text);
    this.pathFeedback.className = `ao-hire-feedback is-${check.state}`;
    this.pathInput.setAttribute('aria-invalid', String(check.state === 'bad'));
  }

  private syncRecent(): void {
    const signature = `${this.recent.map((folder) => folder.path).join('|')}`;
    if (signature === this.recentSignature) return;
    this.recentSignature = signature;
    this.recentBlock.hidden = this.recent.length === 0;
    this.recentBlock.replaceChildren(
      h('span', { class: 'ao-hire-label' }, t('hire.recent')),
      h(
        'div',
        { class: 'ao-chip-row' },
        ...this.recent.map((folder) =>
          h(
            'button',
            {
              type: 'button',
              class: 'ao-chip ao-hire-folder',
              title: folder.path,
              onclick: () => {
                this.pathInput.value = folder.path;
                this.onPathInput();
              },
            },
            icon('folder', 14),
            h('span', null, folder.name),
          ),
        ),
      ),
    );
  }

  // --- account -------------------------------------------------------------------------------------------------------

  private syncAccounts(): void {
    const accounts = this.accounts();
    const signature = `${accounts.map((account) => `${account.id}|${account.label}|${account.color}`).join(',')}|${this.form.accountId}`;
    if (signature === this.accountsSignature) return;
    this.accountsSignature = signature;
    if (accounts.length > 0 && !accounts.some((account) => account.id === this.form.accountId)) {
      this.form = { ...this.form, accountId: defaultAccountId(this.ctx.snapshot, this.form.roomPath, accounts) };
    }
    this.accountField.hidden = accounts.length < 2;
    this.accountGroup.replaceChildren(
      ...accounts.map((account) => {
        const on = account.id === this.form.accountId;
        return h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(on),
            class: `ao-chip ${on ? 'is-on' : ''}`.trim(),
            onclick: () => {
              this.form = { ...this.form, accountId: account.id };
              this.ctx.refresh();
            },
          },
          accountChip(account),
          h('span', null, accountLabel(account)),
        );
      }),
    );
  }

  // --- submit --------------------------------------------------------------------------------------------------------

  private canSubmit(): boolean {
    if (this.busy || !this.ctx.isLocal || promptTooLong(this.form.prompt)) return false;
    return this.form.roomPath !== undefined || this.check.state === 'ok';
  }

  private async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.busy = true;
    this.error = '';
    this.ctx.refresh();
    try {
      await this.ctx.hireAgent(buildHireRequest(this.form));
      this.busy = false;
      this.ctx.closeDialog();
    } catch (error) {
      this.busy = false;
      const key = hireErrorKey(error);
      this.error = key !== null ? t(key) : describeError(error);
      this.ctx.announce(this.error);
    }
    this.ctx.refresh();
  }
}
