// The room panel of the Pro view: opened from a room frame's header (or a room in the sidebar), dev-style. It lists the
// room's orchestrators (pick one), how long the chosen one has been running (session and current turn), its model,
// branch and spend, the subagents it delegated to, and a prompt that sends to it. Esc or the close button closes it.
import { FloorSection } from './floor-section';
import { NoteSection } from './note-section';
import { changedFiles } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../../ui/context';
import { h, setText } from '../../ui/dom';
import { formatCost, formatElapsed, formatTokens } from '../../ui/format';
import { icon } from '../../ui/icons';
import { liveText } from '../../ui/widgets';
import type { VoiceInput } from '../../voice/types';
import { statusLine } from '../model/cli-format';
import { buildTargets } from '../model/command';
import { roomPanelModel, type PanelOrchestrator, type PanelSub, type RoomPanelModel } from '../model/room-panel';
import type { SceneRoom } from '../model/scene';
import { PromptBox } from './prompt-box';

export interface RoomPanelHost {
  close(): void;
  /** A subagent or the orchestrator was picked in the lists: bring its terminal into view. */
  reveal(agentId: string): void;
}

function glyph(status: PanelSub['status']): HTMLElement {
  const line = statusLine(status);
  return h('span', { class: `ao-pro-panel-glyph tone-${line.tone}`, 'aria-hidden': 'true' }, line.glyph);
}

export class RoomPanel {
  readonly el = h('aside', { class: 'ao-pro-panel', hidden: true, tabindex: '-1' });
  private readonly title = h('h2', { class: 'ao-pro-panel-title', id: 'ao-pro-panel-title' });
  private readonly path = h('p', { class: 'ao-pro-panel-path' });
  private readonly picker = h('div', { class: 'ao-pro-panel-picker', role: 'radiogroup' });
  private readonly facts = h('dl', { class: 'ao-pro-panel-facts' });
  private readonly subsTitle = h('h3', { class: 'ao-pro-panel-h' });
  private readonly subs = h('ul', { class: 'ao-pro-panel-subs' });
  private readonly prompt: PromptBox;
  private readonly floor: FloorSection;
  private readonly note: NoteSection;
  private roomId: string | null = null;
  private chosenId: string | null = null;
  private signature = '';

  constructor(
    private readonly ctx: AppContext,
    voice: VoiceInput | null,
    private readonly host: RoomPanelHost,
  ) {
    this.el.setAttribute('aria-labelledby', this.title.id);
    this.prompt = new PromptBox(ctx, voice, { label: t('pro.panel.prompt'), quick: false });
    this.floor = new FloorSection(ctx);
    this.note = new NoteSection(ctx);
    const close = h(
      'button',
      {
        type: 'button',
        class: 'ao-pro-action ao-pro-panel-close',
        'aria-label': t('pro.panel.close'),
        title: t('pro.panel.close'),
        onclick: () => this.host.close(),
      },
      icon('x', 15),
    );
    this.picker.setAttribute('aria-label', t('pro.panel.pick'));
    this.el.append(
      h(
        'header',
        { class: 'ao-pro-panel-head' },
        h('div', { class: 'ao-pro-panel-name' }, this.title, this.path),
        close,
      ),
      h(
        'div',
        { class: 'ao-pro-panel-scroll' },
        h('h3', { class: 'ao-pro-panel-h' }, t('pro.panel.orchestrators')),
        this.picker,
        this.facts,
        this.subsTitle,
        this.subs,
        this.note.el,
        this.floor.el,
      ),
      h('footer', { class: 'ao-pro-panel-foot' }, this.prompt.el),
    );
  }

  dispose(): void {
    this.prompt.dispose();
  }

  get openRoom(): string | null {
    return this.roomId;
  }

  open(roomId: string): void {
    if (this.roomId !== roomId) {
      this.roomId = roomId;
      this.chosenId = null;
      this.signature = '';
      this.floor.show(roomId);
      this.note.show(roomId);
    }
    this.el.hidden = false;
    this.el.focus({ preventScroll: true });
  }

  close(): void {
    this.roomId = null;
    this.el.hidden = true;
  }

  render(room: SceneRoom | undefined): void {
    if (this.roomId === null) return;
    const model = roomPanelModel(room, this.chosenId);
    if (model === null) {
      this.host.close();
      return;
    }
    setText(this.title, model.name);
    setText(this.path, room?.project.path ?? '');
    const chosen = model.orchestrators.find((one) => one.id === model.selectedId);
    const signature = JSON.stringify([model, this.ctx.prefs.get().language]);
    if (signature !== this.signature) {
      this.signature = signature;
      // The lists are drawn again: a button that had the keyboard keeps it.
      const active = document.activeElement;
      const focusedId = active instanceof HTMLElement && this.el.contains(active) ? active.dataset.panelId : undefined;
      this.renderPicker(model);
      this.renderFacts(model, chosen);
      this.renderSubs(chosen);
      if (focusedId !== undefined)
        this.el
          .querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(focusedId)}"]`)
          ?.focus({ preventScroll: true });
    }
    const targets = buildTargets(this.ctx.liveSnapshot, this.ctx.now(), this.ctx.isLocal);
    this.prompt.setTarget(
      chosen === undefined ? undefined : targets.find((target) => target.key === `agent:${chosen.id}`),
    );
  }

  private renderPicker(model: RoomPanelModel): void {
    this.picker.replaceChildren(
      ...model.orchestrators.map((one) => {
        const selected = one.id === model.selectedId;
        const button = h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: `ao-pro-panel-orch ${selected ? 'is-selected' : ''}`.trim(),
            'data-panel-id': `orch:${one.id}`,
            'aria-checked': String(selected),
            onclick: () => {
              this.chosenId = one.id;
              this.signature = '';
              this.host.reveal(one.id);
              this.ctx.refresh();
            },
          },
          glyph(one.status),
          h('span', { class: 'ao-pro-panel-orch-name' }, one.name),
          h('span', { class: 'ao-pro-panel-orch-status' }, statusLine(one.status).text),
          h('span', { class: 'ao-pro-panel-orch-count' }, t('pro.panel.subCount', { n: one.active.length })),
        );
        return button;
      }),
    );
  }

  private renderFacts(model: RoomPanelModel, one: PanelOrchestrator | undefined): void {
    if (one === undefined) {
      this.facts.replaceChildren();
      return;
    }
    const line = statusLine(one.status);
    const git = model.git;
    const branchParts: (string | Node)[] = [one.branch ?? '—'];
    if (git !== undefined) {
      if ((git.ahead ?? 0) > 0) branchParts.push(` ↑${git.ahead ?? 0}`);
      if ((git.behind ?? 0) > 0) branchParts.push(` ↓${git.behind ?? 0}`);
      const changed = changedFiles(git);
      if (changed > 0) branchParts.push(` · ${t('pro.panel.changed', { n: changed })}`);
    }
    const rows: [string, (string | Node)[]][] = [
      [t('pro.panel.status'), [h('span', { class: `tone-${line.tone}` }, `${line.glyph} ${line.text}`)]],
      [t('pro.panel.session'), [liveText('elapsed', one.startedAt)]],
      [t('pro.panel.turn'), [one.turnSince === null ? '—' : liveText('elapsed', one.turnSince)]],
      [t('pro.panel.model'), [one.model ?? '—']],
      [t('pro.panel.branch'), branchParts],
      [
        t('pro.panel.tokens'),
        [t('pro.panel.tokensValue', { input: formatTokens(one.tokensIn), output: formatTokens(one.tokensOut) })],
      ],
      [t('pro.panel.cost'), [formatCost(one.costUSD)]],
      [t('pro.panel.tools'), [t('pro.panel.toolsValue', { n: one.toolCalls, sub: one.delegated })]],
    ];
    if (one.codex) rows.push([t('pro.panel.source'), [t('codex.badge')]]);
    this.facts.replaceChildren(...rows.flatMap(([label, value]) => [h('dt', null, label), h('dd', null, ...value)]));
  }

  private renderSubs(one: PanelOrchestrator | undefined): void {
    const active = one?.active ?? [];
    const finished = one?.finished ?? [];
    setText(
      this.subsTitle,
      t('pro.panel.subagents', { active: active.length, finished: finished.length + (one?.moreFinished ?? 0) }),
    );
    if (active.length === 0 && finished.length === 0) {
      this.subs.replaceChildren(h('li', { class: 'ao-pro-panel-empty' }, t('pro.panel.noSubs')));
      return;
    }
    const rows = [...active, ...finished].map((sub) =>
      h(
        'li',
        null,
        h(
          'button',
          {
            type: 'button',
            class: `ao-pro-panel-sub ${sub.finishedAt !== undefined ? 'is-finished' : ''}`.trim(),
            'data-panel-id': `sub:${sub.id}`,
            title: sub.task,
            onclick: () => this.host.reveal(sub.id),
          },
          glyph(sub.status),
          h('span', { class: 'ao-pro-panel-sub-type' }, sub.type),
          h('span', { class: 'ao-pro-panel-sub-task' }, sub.task || sub.name),
          sub.finishedAt !== undefined
            ? h('span', { class: 'ao-pro-panel-sub-time' }, formatElapsed(sub.finishedAt - sub.startedAt))
            : liveText('elapsed', sub.startedAt, 'ao-pro-panel-sub-time'),
        ),
      ),
    );
    if ((one?.moreFinished ?? 0) > 0)
      rows.push(h('li', { class: 'ao-pro-panel-empty' }, t('pro.panel.moreFinished', { n: one?.moreFinished ?? 0 })));
    this.subs.replaceChildren(...rows);
  }
}
