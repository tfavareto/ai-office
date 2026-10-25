// Customization of one agent: its name and its look (skin, hair, outfit, accessory), with a live preview made by the
// renderer in use. The look can be kept for this agent, for everybody in its room or for everybody of its account.
import {
  ACCESSORIES,
  HAIR_COLORS,
  HAIR_STYLE_COUNT,
  MAX_NAME_LENGTH,
  OUTFITS,
  SKIN_TONES,
  type AccessoryId,
  type Agent,
  type AgentLook,
  type HairColorId,
  type HairStyleId,
  type OutfitId,
  type SkinId,
} from '@ai-office/shared';
import { t, type UiKey } from '../../i18n';
import type { AppContext } from '../context';
import { h, setText, toggleClass } from '../dom';
import {
  type AgentDraft,
  type LookScope,
  agentDraft,
  agentPatch,
  nameProblem,
  previewLook,
  resetPatch,
} from '../model/customize';
import { button, createAvatar } from '../widgets';
import { createChoiceGroup, fieldRow, type ChoiceGroup } from './customize-widgets';

const PREVIEW_SIZE = 112;

const SCOPES: readonly { value: LookScope; label: UiKey }[] = [
  { value: 'agent', label: 'customize.scope.agent' },
  { value: 'room', label: 'customize.scope.room' },
  { value: 'account', label: 'customize.scope.account' },
];

export class AgentCustomizer {
  readonly el = h('div', { class: 'ao-cz-body' });
  private agentId = '';
  private draft: AgentDraft = { name: '', scope: 'agent', look: {} };
  private saving = false;
  private error = '';
  private previewKey = '';

  private readonly avatar = createAvatar(PREVIEW_SIZE);
  private readonly heroName = h('strong', { class: 'ao-cz-heroname' });
  private readonly heroNote = h('span', { class: 'ao-cz-heronote' });
  private readonly nameInput = h('input', {
    id: 'ao-cz-name',
    type: 'text',
    class: 'ao-input',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-describedby': 'ao-cz-name-hint',
  });
  private readonly nameHint = h('p', { id: 'ao-cz-name-hint', class: 'ao-cz-hint', role: 'status' });
  private readonly scopeGroup = h('div', {
    class: 'ao-cz-choices',
    role: 'radiogroup',
    'aria-labelledby': 'ao-cz-scope',
  });
  private readonly scopeButtons = new Map<LookScope, HTMLButtonElement>();
  private readonly scopeHint = h('p', { class: 'ao-cz-hint' });
  private readonly groups: {
    skin: ChoiceGroup<SkinId>;
    hairStyle: ChoiceGroup<HairStyleId>;
    hairColor: ChoiceGroup<HairColorId>;
    outfit: ChoiceGroup<OutfitId>;
    accessory: ChoiceGroup<AccessoryId>;
  };
  private readonly errorBox = h('p', { class: 'ao-error', role: 'alert', hidden: true });
  private readonly saveBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly saveLabel: HTMLElement;

  constructor(
    private readonly ctx: AppContext,
    private readonly close: () => void,
  ) {
    const choose =
      <K extends keyof AgentLook>(key: K) =>
      (value: AgentLook[K] | undefined): void => {
        const look = { ...this.draft.look };
        if (value === undefined) delete look[key];
        else look[key] = value;
        this.draft = { ...this.draft, look };
        this.ctx.refresh();
      };
    this.groups = {
      skin: createChoiceGroup(
        'ao-cz-skin',
        SKIN_TONES.map((tone) => ({ value: tone.id, label: t(`customize.skin.${tone.id}`), swatch: tone.hex })),
        choose('skin'),
      ),
      hairStyle: createChoiceGroup(
        'ao-cz-hairStyle',
        Array.from({ length: HAIR_STYLE_COUNT }, (_, i) => ({
          value: i as HairStyleId,
          label: t('customize.hairStyle.n', { n: i + 1 }),
        })),
        choose('hairStyle'),
      ),
      hairColor: createChoiceGroup(
        'ao-cz-hairColor',
        HAIR_COLORS.map((color) => ({ value: color.id, label: t(`customize.hair.${color.id}`), swatch: color.hex })),
        choose('hairColor'),
      ),
      outfit: createChoiceGroup(
        'ao-cz-outfit',
        OUTFITS.map((outfit) => ({ value: outfit.id, label: t(`customize.outfit.${outfit.id}`), swatch: outfit.hex })),
        choose('outfit'),
      ),
      accessory: createChoiceGroup(
        'ao-cz-accessory',
        ACCESSORIES.map((accessory) => ({ value: accessory, label: t(`customize.accessory.${accessory}`) })),
        choose('accessory'),
      ),
    };
    for (const scope of SCOPES) {
      const btn = h(
        'button',
        { type: 'button', role: 'radio', 'aria-checked': 'false', class: 'ao-cz-choice', tabindex: '-1' },
        t(scope.label),
      );
      btn.addEventListener('click', () => this.chooseScope(scope.value));
      this.scopeButtons.set(scope.value, btn);
      this.scopeGroup.appendChild(btn);
    }
    this.scopeGroup.addEventListener('keydown', (event) => this.onScopeKey(event));
    this.nameInput.addEventListener('input', () => {
      this.draft = { ...this.draft, name: this.nameInput.value };
      this.ctx.refresh();
    });
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.save();
      }
    });
    this.saveBtn = button({
      label: t('customize.save'),
      icon: 'check',
      variant: 'primary',
      onClick: () => void this.save(),
    });
    this.saveLabel = this.saveBtn.querySelector('span') as HTMLElement;
    this.resetBtn = button({
      label: t('customize.reset'),
      icon: 'reset',
      variant: 'ghost',
      onClick: () => void this.restore(),
    });
    const hero = h(
      'div',
      { class: 'ao-cz-hero' },
      this.avatar.el,
      h('div', { class: 'ao-cz-heroinfo' }, this.heroName, this.heroNote),
    );
    this.el.append(
      hero,
      fieldRow(t('customize.name'), this.nameInput, 'ao-cz-name-label', this.nameHint),
      fieldRow(t('customize.scope'), this.scopeGroup, 'ao-cz-scope', this.scopeHint),
      fieldRow(t('customize.look.skin'), this.groups.skin.el, 'ao-cz-skin'),
      fieldRow(t('customize.look.hairStyle'), this.groups.hairStyle.el, 'ao-cz-hairStyle'),
      fieldRow(t('customize.look.hairColor'), this.groups.hairColor.el, 'ao-cz-hairColor'),
      fieldRow(t('customize.look.outfit'), this.groups.outfit.el, 'ao-cz-outfit'),
      fieldRow(t('customize.look.accessory'), this.groups.accessory.el, 'ao-cz-accessory'),
      this.errorBox,
      h(
        'div',
        { class: 'ao-cz-foot' },
        this.resetBtn,
        h('span', { class: 'ao-cz-spacer' }),
        button({ label: t('common.cancel'), variant: 'ghost', onClick: () => this.close() }),
        this.saveBtn,
      ),
    );
  }

  private get agent(): Agent | undefined {
    return this.ctx.agent(this.agentId);
  }

  private get agents(): readonly Agent[] {
    return this.ctx.snapshot?.agents ?? [];
  }

  open(agentId: string): void {
    this.agentId = agentId;
    this.saving = false;
    this.error = '';
    this.previewKey = '';
    void this.ctx.customization.load();
    this.loadDraft('agent');
  }

  title(): string {
    return t('customize.agent.title', { name: this.agent?.defaultName ?? this.agent?.name ?? t('agent.fallback') });
  }

  private loadDraft(scope: LookScope): void {
    const agent = this.agent;
    if (!agent) return;
    this.draft = agentDraft(this.ctx.customization.get().document, agent, this.agents, scope);
    this.nameInput.value = this.draft.name;
  }

  private chooseScope(scope: LookScope): void {
    if (scope === this.draft.scope) return;
    const name = this.draft.name;
    this.loadDraft(scope);
    this.draft = { ...this.draft, name };
    this.ctx.refresh();
  }

  private onScopeKey(event: KeyboardEvent): void {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = SCOPES.findIndex((scope) => this.scopeButtons.get(scope.value) === document.activeElement);
    if (index < 0) return;
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = SCOPES[(index + step + SCOPES.length) % SCOPES.length];
    if (!next) return;
    this.scopeButtons.get(next.value)?.focus();
    this.chooseScope(next.value);
  }

  private async save(): Promise<void> {
    const agent = this.agent;
    if (!agent || this.saving || nameProblem(this.draft.name) !== null) return;
    const patch = agentPatch(this.ctx.customization.get().document, agent, this.agents, this.draft);
    if (patch === null) return this.close();
    await this.send(patch, 'announce.customize.saved');
  }

  private async restore(): Promise<void> {
    if (this.agent && !this.saving) await this.send(resetPatch('agents', this.agentId), 'announce.customize.restored');
  }

  private async send(patch: object, announce: UiKey): Promise<void> {
    this.saving = true;
    this.error = '';
    this.ctx.refresh();
    const outcome = await this.ctx.customization.change(patch);
    this.saving = false;
    if (outcome.ok) {
      this.ctx.announce(t(announce));
      this.close();
    } else {
      this.error = outcome.message;
      this.ctx.announce(outcome.message);
    }
    this.ctx.refresh();
  }

  update(): void {
    const agent = this.agent;
    const state = this.ctx.customization.get();
    this.el.hidden = false;
    if (!agent) {
      setText(this.heroName, t('agent.left'));
      return;
    }
    const problem = nameProblem(this.draft.name);
    const look = previewLook(state.document, agent, this.agents, this.draft);
    const key = `${agent.id}|${agent.seed}|${JSON.stringify(look ?? null)}|${this.draft.name}`;
    if (key !== this.previewKey) {
      this.previewKey = key;
      const shown = { ...agent, name: this.draft.name.trim() || (agent.defaultName ?? agent.name) };
      this.avatar.update(
        shown,
        this.ctx.world.previewPortrait(
          { seed: agent.seed, look: agent.look, kind: agent.kind },
          look,
          PREVIEW_SIZE * 2,
        ),
      );
      setText(this.heroName, shown.name);
    }
    setText(this.heroNote, agent.kind === 'sub' ? t('customize.agent.sub') : t('customize.agent.main'));
    this.nameInput.placeholder = t('customize.name.placeholder', { name: agent.defaultName ?? agent.name });
    this.nameInput.setAttribute('aria-invalid', String(problem !== null));
    const count = [...this.draft.name].length;
    this.nameHint.className = `ao-cz-hint ${problem !== null ? 'is-error' : ''}`.trim();
    setText(
      this.nameHint,
      problem === 'too-long'
        ? t('customize.name.error.tooLong', { max: MAX_NAME_LENGTH })
        : problem === 'invalid-chars'
          ? t('customize.name.error.invalidChars')
          : t('customize.name.hint', { n: count, max: MAX_NAME_LENGTH }),
    );
    for (const scope of SCOPES) {
      const btn = this.scopeButtons.get(scope.value);
      if (!btn) continue;
      const on = scope.value === this.draft.scope;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
      toggleClass(btn, 'is-on', on);
    }
    setText(this.scopeHint, t(`customize.scope.hint.${this.draft.scope}` as UiKey));
    const busy = this.saving || state.busy;
    const loading = state.status !== 'ready';
    for (const key of ['skin', 'hairStyle', 'hairColor', 'outfit', 'accessory'] as const) {
      this.groups[key].set(this.draft.look[key] as never);
      this.groups[key].setDisabled(busy || loading);
    }
    this.errorBox.hidden = this.error === '' && state.status !== 'error';
    setText(this.errorBox, this.error || state.error);
    this.saveBtn.disabled = busy || loading || problem !== null;
    this.resetBtn.disabled = busy || loading || state.document.agents[agent.id] === undefined;
    setText(this.saveLabel, this.saving ? t('customize.saving') : t('customize.save'));
  }
}
