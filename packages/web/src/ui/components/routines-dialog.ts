// Routines: prompts that run on a schedule in a project. The list says when each runs next and how the last run went.
import type { Routine, RoutineOutcome, RoutineSchedule } from '@ai-office/shared';
import { t, type TextKey } from '../../i18n';
import { describeError } from '../../net/backend';
import type { AppContext } from '../context';
import { h, setText } from '../dom';
import { formatClock } from '../format';
import { icon } from '../icons';
import { button } from '../widgets';
import { Dialog, closeButton } from './overlay';

const OUTCOME_KEY: Record<RoutineOutcome, TextKey> = {
  sent: 'routines.outcome.sent',
  started: 'routines.outcome.started',
  'skipped-busy': 'routines.outcome.skippedBusy',
  'skipped-off': 'routines.outcome.skippedOff',
  failed: 'routines.outcome.failed',
};

const DEFAULT_MINUTES = 60;
const DEFAULT_TIME = '09:00';
const ERROR_KEY: Readonly<Record<string, TextKey>> = {
  'invalid-routine': 'routines.error.invalid',
  'unknown-project': 'routines.error.unknownProject',
  'too-many-routines': 'routines.error.tooMany',
  'rate-limited': 'routines.error.rateLimited',
  demo: 'routines.error.demo',
};

function errorText(error: unknown): string {
  const key = error instanceof Error ? ERROR_KEY[error.message] : undefined;
  return key !== undefined ? t(key) : describeError(error);
}

export class RoutinesDialog extends Dialog {
  private readonly list = h('ul', { class: 'ao-roles-list' });
  private readonly empty = h('p', { class: 'ao-note' }, t('routines.empty'));
  private readonly error = h('p', { class: 'ao-error', role: 'alert', hidden: true });
  private readonly nameInput = h('input', { id: 'ao-routine-name', type: 'text', class: 'ao-input', maxlength: 80 });
  private readonly promptInput = h('textarea', {
    id: 'ao-routine-prompt',
    class: 'ao-textarea',
    rows: 4,
    maxlength: 8000,
  });
  private readonly projectSelect = h('select', { id: 'ao-routine-project', class: 'ao-select' });
  private readonly minutesInput = h('input', {
    id: 'ao-routine-minutes',
    type: 'number',
    class: 'ao-input',
    min: 5,
    value: String(DEFAULT_MINUTES),
  });
  private readonly timeInput = h('input', {
    id: 'ao-routine-time',
    type: 'time',
    class: 'ao-input',
    value: DEFAULT_TIME,
  });
  private readonly kindSelect = h(
    'select',
    { id: 'ao-routine-kind', class: 'ao-select', onchange: () => this.syncKind() },
    h('option', { value: 'interval' }, t('routines.kind.interval')),
    h('option', { value: 'daily' }, t('routines.kind.daily')),
  );
  private readonly minutesField = h(
    'div',
    null,
    h('label', { class: 'ao-hire-label', for: 'ao-routine-minutes' }, t('routines.every')),
    this.minutesInput,
  );
  private readonly timeField = h(
    'div',
    { hidden: true },
    h('label', { class: 'ao-hire-label', for: 'ao-routine-time' }, t('routines.at')),
    this.timeInput,
  );
  private routines: readonly Routine[] = [];
  private signature: string | null = null;

  constructor(ctx: AppContext) {
    super(ctx, 'routines', 'ao-routines-title', 'ao-dialog--roles');
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head' },
        h('h2', { id: 'ao-routines-title' }, t('routines.title')),
        closeButton(t('common.close'), () => ctx.closeDialog()),
      ),
      h(
        'div',
        { class: 'ao-roles-body' },
        h('p', { class: 'ao-note' }, t('routines.note')),
        this.empty,
        this.list,
        h('label', { class: 'ao-hire-label', for: 'ao-routine-name' }, t('roles.name')),
        this.nameInput,
        h('label', { class: 'ao-hire-label', for: 'ao-routine-project' }, t('routines.project')),
        this.projectSelect,
        h('label', { class: 'ao-hire-label', for: 'ao-routine-prompt' }, t('routines.prompt')),
        this.promptInput,
        h('label', { class: 'ao-hire-label', for: 'ao-routine-kind' }, t('routines.when')),
        this.kindSelect,
        this.minutesField,
        this.timeField,
        this.error,
      ),
      h(
        'footer',
        { class: 'ao-dialog-foot' },
        button({ label: t('routines.save'), variant: 'primary', onClick: () => void this.save() }),
      ),
    );
  }

  protected onOpen(): void {
    this.error.hidden = true;
    this.projectSelect.replaceChildren(
      ...(this.ctx.liveSnapshot?.projects ?? []).map((project) => h('option', { value: project.path }, project.name)),
    );
    void this.load();
  }

  protected update(): void {
    const signature = JSON.stringify(this.routines);
    if (signature === this.signature) return;
    this.signature = signature;
    this.empty.hidden = this.routines.length > 0;
    this.list.replaceChildren(...this.routines.map((routine) => this.row(routine)));
  }

  private syncKind(): void {
    const daily = this.kindSelect.value === 'daily';
    this.timeField.hidden = !daily;
    this.minutesField.hidden = daily;
  }

  private schedule(): RoutineSchedule {
    if (this.kindSelect.value !== 'daily') return { kind: 'interval', minutes: Number(this.minutesInput.value) };
    const [hour, minute] = this.timeInput.value.split(':').map(Number);
    return { kind: 'daily', hour: hour ?? Number.NaN, minute: minute ?? Number.NaN };
  }

  private async load(): Promise<void> {
    if (!this.ctx.isLocal) return;
    this.routines = await this.ctx.store.backend.routines().catch(() => []);
    this.ctx.refresh();
  }

  private scheduleText(schedule: RoutineSchedule): string {
    return schedule.kind === 'interval'
      ? t('routines.everyMinutes', { n: schedule.minutes })
      : t('routines.daily', {
          time: `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`,
        });
  }

  private row(routine: Routine): HTMLElement {
    const last = routine.history[0];
    const act = (run: () => Promise<unknown>): void => {
      run()
        .then(() => this.load())
        .catch((error: unknown) => this.showError(errorText(error)));
    };
    const backend = this.ctx.store.backend;
    const label = routine.enabled ? t('routines.pause') : t('routines.resume');
    return h(
      'li',
      { class: 'ao-roles-row' },
      h(
        'div',
        { class: 'ao-routine-text' },
        h('strong', null, routine.name),
        h(
          'span',
          { class: 'ao-note' },
          [
            this.scheduleText(routine.schedule),
            routine.enabled ? t('routines.next', { time: formatClock(routine.nextRunAt) }) : t('routines.paused'),
            ...(last !== undefined ? [t(OUTCOME_KEY[last.outcome])] : []),
          ].join(' · '),
        ),
      ),
      button({
        label: t('routines.runNow'),
        variant: 'ghost',
        onClick: () => act(() => backend.runRoutine(routine.id)),
      }),
      button({
        label,
        variant: 'ghost',
        onClick: () => act(() => backend.setRoutineEnabled(routine.id, !routine.enabled)),
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'ao-pro-menu-remove',
          title: t('roles.remove', { name: routine.name }),
          'aria-label': t('roles.remove', { name: routine.name }),
          onclick: () => act(() => backend.removeRoutine(routine.id)),
        },
        icon('x', 12),
      ),
    );
  }

  private showError(message: string): void {
    setText(this.error, message);
    this.error.hidden = false;
  }

  private async save(): Promise<void> {
    this.error.hidden = true;
    try {
      await this.ctx.store.backend.addRoutine({
        name: this.nameInput.value,
        prompt: this.promptInput.value,
        projectPath: this.projectSelect.value,
        schedule: this.schedule(),
      });
      this.nameInput.value = '';
      this.promptInput.value = '';
      await this.load();
    } catch (error) {
      this.showError(errorText(error));
    }
  }
}
