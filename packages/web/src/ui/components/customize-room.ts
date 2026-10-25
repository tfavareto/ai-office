// Customization of one room: the name shown, its color, floor, walls, plants and sign, the outfit the whole team
// wears, and whether it is pinned to the front or hidden from the building.
import {
  MAX_ALIAS_LENGTH,
  OUTFITS,
  PLANT_DENSITIES,
  ROOM_COLORS,
  ROOM_FLOORS,
  ROOM_WALLS,
  SIGN_STYLES,
  type OutfitId,
  type PlantDensity,
  type Project,
  type RoomFloor,
  type RoomTheme,
  type RoomWall,
  type SignStyle,
} from '@ai-office/shared';
import { t, type UiKey } from '../../i18n';
import type { AppContext } from '../context';
import { h, setText } from '../dom';
import { type RoomDraft, aliasProblem, resetPatch, roomDraft, roomPatch } from '../model/customize';
import { roomColor } from '../model/rooms';
import { button, createSwitch } from '../widgets';
import { createChoiceGroup, fieldRow, type ChoiceGroup } from './customize-widgets';

const EMPTY_DRAFT: RoomDraft = { alias: '', theme: {}, teamOutfit: undefined, pinned: false, hidden: false };

export class RoomCustomizer {
  readonly el = h('div', { class: 'ao-cz-body' });
  private roomId = '';
  private draft: RoomDraft = EMPTY_DRAFT;
  private saving = false;
  private error = '';

  private readonly swatch = h('span', { class: 'ao-cz-roomswatch', 'aria-hidden': 'true' });
  private readonly heroName = h('strong', { class: 'ao-cz-heroname' });
  private readonly heroPath = h('code', { class: 'ao-cz-heronote' });
  private readonly aliasInput = h('input', {
    id: 'ao-cz-alias',
    type: 'text',
    class: 'ao-input',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-describedby': 'ao-cz-alias-hint',
  });
  private readonly aliasHint = h('p', { id: 'ao-cz-alias-hint', class: 'ao-cz-hint', role: 'status' });
  private readonly groups: {
    color: ChoiceGroup<string>;
    floor: ChoiceGroup<RoomFloor>;
    wall: ChoiceGroup<RoomWall>;
    plants: ChoiceGroup<PlantDensity>;
    sign: ChoiceGroup<SignStyle>;
    team: ChoiceGroup<OutfitId>;
  };
  private readonly pinSwitch = createSwitch(t('customize.room.pin'), (on) => this.setFlag('pinned', on));
  private readonly hideSwitch = createSwitch(t('customize.room.hide'), (on) => this.setFlag('hidden', on));
  private readonly errorBox = h('p', { class: 'ao-error', role: 'alert', hidden: true });
  private readonly saveBtn: HTMLButtonElement;
  private readonly saveLabel: HTMLElement;
  private readonly resetBtn: HTMLButtonElement;

  constructor(
    private readonly ctx: AppContext,
    private readonly close: () => void,
  ) {
    const theme =
      <K extends keyof RoomTheme>(key: K) =>
      (value: RoomTheme[K] | undefined): void => {
        const next = { ...this.draft.theme };
        if (value === undefined) delete next[key];
        else next[key] = value;
        this.draft = { ...this.draft, theme: next };
        this.ctx.refresh();
      };
    this.groups = {
      color: createChoiceGroup(
        'ao-cz-color',
        ROOM_COLORS.map((color) => ({ value: color.hex, label: t(`customize.color.${color.id}`), swatch: color.hex })),
        theme('color'),
      ),
      floor: createChoiceGroup(
        'ao-cz-floor',
        ROOM_FLOORS.map((floor) => ({ value: floor, label: t(`customize.floor.${floor}`) })),
        theme('floor'),
      ),
      wall: createChoiceGroup(
        'ao-cz-wall',
        ROOM_WALLS.map((wall) => ({ value: wall, label: t(`customize.wall.${wall}`) })),
        theme('wall'),
      ),
      plants: createChoiceGroup(
        'ao-cz-plants',
        PLANT_DENSITIES.map((plants) => ({ value: plants, label: t(`customize.plants.${plants}`) })),
        theme('plants'),
      ),
      sign: createChoiceGroup(
        'ao-cz-sign',
        SIGN_STYLES.map((sign) => ({ value: sign, label: t(`customize.sign.${sign}`) })),
        theme('sign'),
      ),
      team: createChoiceGroup(
        'ao-cz-team',
        OUTFITS.map((outfit) => ({ value: outfit.id, label: t(`customize.outfit.${outfit.id}`), swatch: outfit.hex })),
        (value) => {
          this.draft = { ...this.draft, teamOutfit: value };
          this.ctx.refresh();
        },
      ),
    };
    this.aliasInput.addEventListener('input', () => {
      this.draft = { ...this.draft, alias: this.aliasInput.value };
      this.ctx.refresh();
    });
    this.aliasInput.addEventListener('keydown', (event) => {
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
    const toggle = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
      h(
        'div',
        { class: 'ao-cz-toggle' },
        h(
          'div',
          { class: 'ao-cz-toggletext' },
          h('span', { class: 'ao-cz-label' }, label),
          hint ? h('span', { class: 'ao-cz-hint' }, hint) : null,
        ),
        control,
      );
    this.el.append(
      h(
        'div',
        { class: 'ao-cz-hero' },
        this.swatch,
        h('div', { class: 'ao-cz-heroinfo' }, this.heroName, this.heroPath),
      ),
      fieldRow(t('customize.alias'), this.aliasInput, 'ao-cz-alias-label', this.aliasHint),
      fieldRow(t('customize.room.color'), this.groups.color.el, 'ao-cz-color'),
      fieldRow(t('customize.room.floor'), this.groups.floor.el, 'ao-cz-floor'),
      fieldRow(t('customize.room.wall'), this.groups.wall.el, 'ao-cz-wall'),
      fieldRow(t('customize.room.plants'), this.groups.plants.el, 'ao-cz-plants'),
      fieldRow(t('customize.room.sign'), this.groups.sign.el, 'ao-cz-sign'),
      fieldRow(
        t('customize.room.team'),
        this.groups.team.el,
        'ao-cz-team',
        h('p', { class: 'ao-cz-hint' }, t('customize.room.team.hint')),
      ),
      toggle(t('customize.room.pin'), this.pinSwitch.el, t('customize.room.pin.hint')),
      toggle(t('customize.room.hide'), this.hideSwitch.el, t('customize.room.hide.hint')),
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

  private get project(): Project | undefined {
    return this.ctx.project(this.roomId);
  }

  open(roomId: string): void {
    this.roomId = roomId;
    this.saving = false;
    this.error = '';
    void this.ctx.customization.load().then(() => this.loadDraft());
    this.loadDraft();
  }

  private loadDraft(): void {
    const project = this.project;
    if (!project) return;
    this.draft = roomDraft(this.ctx.customization.get().document, project);
    this.aliasInput.value = this.draft.alias;
    this.ctx.refresh();
  }

  title(): string {
    const project = this.project;
    return t('customize.room.title', { name: project?.originalName ?? project?.name ?? t('agent.room') });
  }

  private setFlag(flag: 'pinned' | 'hidden', on: boolean): void {
    this.draft = { ...this.draft, [flag]: on };
    this.ctx.refresh();
  }

  private async save(): Promise<void> {
    const project = this.project;
    if (!project || this.saving || aliasProblem(this.draft.alias) !== null) return;
    const patch = roomPatch(this.ctx.customization.get().document, project, this.draft);
    if (patch === null) return this.close();
    await this.send(patch, 'announce.customize.saved');
  }

  private async restore(): Promise<void> {
    if (!this.saving) await this.send(resetPatch('rooms', this.roomId), 'announce.customize.restored');
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
    const project = this.project;
    const state = this.ctx.customization.get();
    if (!project) {
      setText(this.heroName, t('room.gone'));
      return;
    }
    const problem = aliasProblem(this.draft.alias);
    this.swatch.style.background = this.draft.theme.color ?? roomColor(project.seed);
    setText(this.heroName, this.draft.alias.trim() || (project.originalName ?? project.name));
    setText(this.heroPath, project.path);
    this.aliasInput.placeholder = t('customize.alias.placeholder', { name: project.originalName ?? project.name });
    this.aliasInput.setAttribute('aria-invalid', String(problem !== null));
    this.aliasHint.className = `ao-cz-hint ${problem !== null ? 'is-error' : ''}`.trim();
    setText(
      this.aliasHint,
      problem === 'too-long'
        ? t('customize.alias.error.tooLong', { max: MAX_ALIAS_LENGTH })
        : problem === 'invalid-chars'
          ? t('customize.alias.error.invalidChars')
          : t('customize.alias.hint'),
    );
    const busy = this.saving || state.busy;
    const loading = state.status !== 'ready';
    this.groups.color.set(this.draft.theme.color);
    this.groups.floor.set(this.draft.theme.floor);
    this.groups.wall.set(this.draft.theme.wall);
    this.groups.plants.set(this.draft.theme.plants);
    this.groups.sign.set(this.draft.theme.sign);
    this.groups.team.set(this.draft.teamOutfit);
    for (const group of Object.values(this.groups)) group.setDisabled(busy || loading);
    this.pinSwitch.set(this.draft.pinned);
    this.hideSwitch.set(this.draft.hidden);
    this.pinSwitch.el.disabled = busy || loading;
    this.hideSwitch.el.disabled = busy || loading;
    this.errorBox.hidden = this.error === '' && state.status !== 'error';
    setText(this.errorBox, this.error || state.error);
    this.saveBtn.disabled = busy || loading || problem !== null;
    this.resetBtn.disabled = busy || loading || state.document.rooms[project.id] === undefined;
    setText(this.saveLabel, this.saving ? t('customize.saving') : t('customize.save'));
  }
}
