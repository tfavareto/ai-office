// The customization dialog: one shell for the agent, room and layout editors (what it edits comes from the UI state).
import type { AppContext } from '../context';
import { h, setText } from '../dom';
import type { CustomizeTarget } from '../state';
import { AgentCustomizer } from './customize-agent';
import { LayoutEditor } from './customize-layout';
import { RoomCustomizer } from './customize-room';
import { Dialog, closeButton } from './overlay';
import { t } from '../../i18n';

type Editor = AgentCustomizer | RoomCustomizer | LayoutEditor;

export class CustomizeDialog extends Dialog {
  private readonly title = h('h2', { id: 'ao-cz-title' });
  private readonly agent: AgentCustomizer;
  private readonly room: RoomCustomizer;
  private readonly layout: LayoutEditor;
  private active: Editor | null = null;

  constructor(ctx: AppContext) {
    super(ctx, 'customize', 'ao-cz-title', 'ao-dialog--customize');
    const close = (): void => ctx.closeDialog();
    this.agent = new AgentCustomizer(ctx, close);
    this.room = new RoomCustomizer(ctx, close);
    this.layout = new LayoutEditor(ctx, close);
    this.panel.append(
      h('header', { class: 'ao-dialog-head' }, this.title, closeButton(t('common.close'), close)),
      this.agent.el,
      this.room.el,
      this.layout.el,
    );
    for (const editor of [this.agent, this.room, this.layout]) editor.el.hidden = true;
  }

  protected onOpen(): void {
    const target: CustomizeTarget = this.ctx.ui.get().customize;
    this.active = target.kind === 'agent' ? this.agent : target.kind === 'room' ? this.room : this.layout;
    if (target.kind === 'agent') this.agent.open(target.id);
    else if (target.kind === 'room') this.room.open(target.id);
    else this.layout.open();
    for (const editor of [this.agent, this.room, this.layout]) editor.el.hidden = editor !== this.active;
  }

  protected update(): void {
    if (this.active === null) return;
    setText(this.title, this.active.title());
    this.active.update();
  }
}
