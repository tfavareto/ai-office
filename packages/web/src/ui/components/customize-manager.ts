// The "Personalização" section of the settings popover: how much is customized, the arrangement of the rooms, a list of
// what was changed with a reset for each item, and "Restaurar tudo" (asks to be confirmed).
import { t } from '../../i18n';
import { localOnlyHint, type AppContext } from '../context';
import { h, setText } from '../dom';
import { icon } from '../icons';
import { type CustomizedItem, customizationCount, customizedItems, resetPatch } from '../model/customize';
import { button, setDisabled } from '../widgets';

const KIND_TABLE = { room: 'rooms', agent: 'agents', account: 'accounts' } as const;

export class CustomizationManager {
  readonly el = h('div', { class: 'ao-cz-manager' });
  private confirming = false;
  private signature = '';

  private readonly count = h('p', { class: 'ao-setting-hint', role: 'status' });
  private readonly layoutBtn = button({
    label: t('settings.custom.layout'),
    icon: 'building',
    variant: 'soft',
    className: 'ao-btn--small',
    onClick: () => this.ctx.openCustomize({ kind: 'layout' }),
  });
  private readonly restoreBtn = button({
    label: t('settings.custom.restoreAll'),
    icon: 'reset',
    variant: 'ghost',
    className: 'ao-btn--small',
    onClick: () => void this.restoreAll(),
  });
  private readonly restoreLabel = this.restoreBtn.querySelector('span') as HTMLElement;
  private readonly items = h('ul', { class: 'ao-cz-items' });
  private readonly details = h(
    'details',
    null,
    h('summary', { class: 'ao-setting-hint' }, t('settings.custom.items')),
    this.items,
  );
  private readonly error = h('p', { class: 'ao-setting-hint ao-setting-hint--warn', role: 'alert', hidden: true });

  constructor(private readonly ctx: AppContext) {
    this.el.append(
      this.count,
      h('div', { class: 'ao-cz-manager-actions' }, this.layoutBtn, this.restoreBtn),
      this.details,
      this.error,
    );
  }

  /** The popover opened: read the document again (it may have changed in another tab). */
  onOpen(): void {
    this.confirming = false;
    this.error.hidden = true;
    if (this.ctx.isLocal) void this.ctx.customization.load(true);
  }

  private async restoreAll(): Promise<void> {
    if (!this.confirming) {
      this.confirming = true;
      this.ctx.refresh();
      return;
    }
    this.confirming = false;
    const outcome = await this.ctx.customization.resetAll();
    if (outcome.ok) this.ctx.announce(t('announce.customize.restored'));
    else this.showError(outcome.message);
    this.ctx.refresh();
  }

  private async restore(item: CustomizedItem): Promise<void> {
    const outcome = await this.ctx.customization.change(resetPatch(KIND_TABLE[item.kind], item.id));
    if (!outcome.ok) this.showError(outcome.message);
    this.ctx.refresh();
  }

  private showError(message: string): void {
    this.error.hidden = false;
    setText(this.error, message);
  }

  private row(item: CustomizedItem): HTMLElement {
    const name = item.label;
    const reset = h(
      'button',
      {
        type: 'button',
        class: 'ao-iconbtn ao-iconbtn--small',
        'aria-label': t('settings.custom.reset', { name }),
        title: t('settings.custom.reset', { name }),
      },
      icon('reset', 14),
    );
    reset.addEventListener('click', () => void this.restore(item));
    const kind = t(`settings.custom.kind.${item.kind}`);
    const changes = item.changes.map((change) => t(`settings.custom.change.${change}`)).join(', ');
    return h(
      'li',
      { class: 'ao-cz-item' },
      h(
        'span',
        { class: 'ao-cz-itemtext' },
        h('strong', null, name),
        h('span', null, changes ? `${kind} · ${changes}` : kind),
      ),
      reset,
    );
  }

  update(): void {
    const state = this.ctx.customization.get();
    const local = this.ctx.isLocal;
    const total = customizationCount(state.document);
    const list = customizedItems(state.document, this.ctx.snapshot, t('agent.fallback'));
    const signature = JSON.stringify([list.map((item) => [item.kind, item.id, item.label, item.changes]), total]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.items.replaceChildren(...list.map((item) => this.row(item)));
    }
    setText(this.count, local ? t('settings.custom.count', { n: total }) : localOnlyHint());
    this.details.hidden = list.length === 0;
    const busy = state.busy;
    setDisabled(this.layoutBtn, !local || busy, localOnlyHint());
    setDisabled(this.restoreBtn, !local || busy || total === 0, !local ? localOnlyHint() : undefined);
    setText(this.restoreLabel, this.confirming ? t('settings.custom.confirm') : t('settings.custom.restoreAll'));
    if (total === 0) this.confirming = false;
  }
}
