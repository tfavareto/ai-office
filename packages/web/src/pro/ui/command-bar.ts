// The optional command bar at the bottom of the Pro view: a selector with every orchestrator (and the team of rooms
// with several) over the shared prompt. Hidden by default; the canvas toolbar and `N` show it.
import { t } from '../../i18n';
import type { AppContext } from '../../ui/context';
import { h } from '../../ui/dom';
import type { VoiceInput } from '../../voice/types';
import { buildTargets, defaultTargetKey, resolveTargetKey, type CommandTarget } from '../model/command';
import { PromptBox, targetLabel } from './prompt-box';

export class CommandBar {
  readonly el = h('section', { class: 'ao-pro-command', 'aria-label': t('pro.command.label'), hidden: true });
  private readonly select = h('select', { class: 'ao-select ao-pro-target', 'aria-label': t('pro.command.target') });
  private readonly prompt: PromptBox;
  private targets: CommandTarget[] = [];
  private chosenKey: string | null = null;
  private optionsSignature = '';
  private lastFocusToken = 0;

  constructor(
    private readonly ctx: AppContext,
    voice: VoiceInput | null,
  ) {
    this.prompt = new PromptBox(ctx, voice, { label: t('pro.command.label'), head: this.select, quick: true });
    this.select.addEventListener('change', () => {
      this.chosenKey = this.select.value;
      this.render();
    });
    this.el.append(this.prompt.el);
  }

  dispose(): void {
    this.prompt.dispose();
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  setShown(shown: boolean): void {
    this.el.hidden = !shown;
  }

  focus(): void {
    this.prompt.focus();
  }

  /** Called when the selection moves: the target follows it again. */
  followSelection(): void {
    this.chosenKey = null;
  }

  render(): void {
    if (this.el.hidden) return;
    const snapshot = this.ctx.liveSnapshot;
    this.targets = buildTargets(snapshot, this.ctx.now(), this.ctx.isLocal);
    const selected = this.ctx.ui.get().selection;
    const fallback = defaultTargetKey(this.targets, snapshot, selected?.type === 'agent' ? selected.id : null);
    // A new selection on the canvas or in the sidebar moves the target, unless the user picked one in the list.
    const key = resolveTargetKey(this.targets, this.chosenKey, fallback);
    this.syncOptions();
    this.select.value = key ?? '';
    this.prompt.setTarget(this.targets.find((target) => target.key === key));
    this.honorFocusRequest();
  }

  private syncOptions(): void {
    const signature = this.targets.map((target) => `${target.key}:${target.label}:${target.roomName}`).join('|');
    if (signature === this.optionsSignature) return;
    this.optionsSignature = signature;
    const groups = new Map<string, HTMLOptGroupElement>();
    const children: Node[] = [];
    for (const target of this.targets) {
      let group = groups.get(target.roomName);
      if (group === undefined) {
        group = h('optgroup', { label: target.roomName });
        groups.set(target.roomName, group);
        children.push(group);
      }
      group.appendChild(h('option', { value: target.key }, targetLabel(target)));
    }
    if (this.targets.length === 0) children.push(h('option', { value: '' }, t('pro.command.noTarget')));
    this.select.replaceChildren(...children);
  }

  private honorFocusRequest(): void {
    const token = this.ctx.ui.get().composerFocus;
    if (token === this.lastFocusToken) return;
    this.lastFocusToken = token;
    if (this.el.offsetParent !== null) this.focus();
  }
}
