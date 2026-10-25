// "Compartilhar": a card with a picture of the office and the numbers of a day, made for LinkedIn and X. A live preview,
// the format and theme, what to include, the download and copy buttons and a caption ready to paste.
import { type DayReport, hasActivity } from '@ai-office/shared';
import { t } from '../../i18n';
import { buildCaption, buildCardModel, buildCardStats, type CardInput } from '../../share/model';
import { canvasToBlob, cardFilename, copyImage, downloadBlob } from '../../share/export';
import { cardLayout, heroPixels } from '../../share/layout';
import { renderCard } from '../../share/render';
import {
  CARD_SIZES,
  DEFAULT_SHARE_OPTIONS,
  type CardFormat,
  type CardTheme,
  type ShareOptions,
} from '../../share/types';
import type { CaptureMode } from '../../world/capture';
import type { WorldKind } from '../../world/load';
import type { AppContext } from '../context';
import { toDateKey } from '../format';
import { h, setAttr, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { button, createSegmented, createSwitch, setDisabled } from '../widgets';
import { Dialog, closeButton } from './overlay';

type LoadState = 'loading' | 'ready' | 'error';
type HeroState = 'idle' | 'loading' | 'ready' | 'error';

interface Hero {
  /** What the picture was made with, to know when it is stale. */
  key: string;
  canvas: HTMLCanvasElement;
}

type FeedbackTone = 'ok' | 'bad' | '';

export class ShareDialog extends Dialog {
  private options: ShareOptions = { ...DEFAULT_SHARE_OPTIONS, visual: '2d' };
  private report: DayReport | null = null;
  private reportState: LoadState = 'loading';
  private hero: Hero | null = null;
  private heroState: HeroState = 'idle';
  private heroKeyAsked = '';
  private composed = '';
  private token = 0;
  private busy = false;

  private readonly preview = h('canvas', { class: 'ao-share-canvas', role: 'img', 'aria-label': t('share.preview') });
  private readonly status = h('p', { class: 'ao-share-status', role: 'status' });
  private readonly feedback = h('p', { class: 'ao-share-feedback', role: 'status', 'aria-live': 'polite' });
  private readonly caption = h('textarea', {
    class: 'ao-textarea ao-share-caption',
    rows: '4',
    'aria-label': t('share.caption.label'),
  });
  private readonly formatSegment = createSegmented<CardFormat>(
    t('share.format'),
    [
      { value: 'landscape', label: t('share.format.landscape') },
      { value: 'square', label: t('share.format.square') },
    ],
    (format) => this.setOptions({ format }),
  );
  private readonly themeSegment = createSegmented<CardTheme>(
    t('share.theme'),
    [
      { value: 'dark', label: t('share.theme.dark') },
      { value: 'light', label: t('share.theme.light') },
    ],
    (theme) => this.setOptions({ theme }),
  );
  private readonly visualSegment = createSegmented<WorldKind>(
    t('share.visual'),
    [
      { value: '2d', label: '2D' },
      { value: '3d', label: '3D' },
    ],
    (visual) => this.setOptions({ visual }),
  );
  private readonly framingSegment = createSegmented<CaptureMode>(
    t('share.framing'),
    [
      { value: 'overview', label: t('share.framing.overview') },
      { value: 'current', label: t('share.framing.current') },
    ],
    (framing) => this.setOptions({ framing }),
  );
  private readonly namesSwitch = createSwitch(t('share.option.names'), (on) =>
    this.setOptions({ showProjectNames: on }),
  );
  private readonly usageSwitch = createSwitch(t('share.option.usage'), (on) => this.setOptions({ showUsage: on }));
  private readonly visualField: HTMLElement;
  private readonly framingField: HTMLElement;
  private readonly downloadBtn = button({
    label: t('share.download'),
    icon: 'arrowDown',
    variant: 'primary',
    onClick: () => void this.download(),
  });
  private readonly copyImageBtn = button({
    label: t('share.copyImage'),
    icon: 'copy',
    onClick: () => void this.copyPicture(),
  });
  private readonly retryBtn = button({
    label: t('common.retry'),
    variant: 'soft',
    className: 'ao-share-retry',
    onClick: () => this.retry(),
  });
  private readonly copyCaptionBtn = button({
    label: t('share.caption.copy'),
    icon: 'copy',
    onClick: () => this.copyCaption(),
  });

  constructor(ctx: AppContext) {
    super(ctx, 'share', 'ao-share-title', 'ao-dialog--share');
    this.visualField = this.field(t('share.visual'), this.visualSegment.el);
    this.framingField = this.field(t('share.framing'), this.framingSegment.el);
    const switchRow = (label: string, control: HTMLElement, hint: string): HTMLElement =>
      h(
        'div',
        { class: 'ao-share-switch' },
        h('label', { class: 'ao-switch-row', title: hint }, h('span', null, label), control),
        h('p', { class: 'ao-setting-hint' }, hint),
      );
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head' },
        h('h2', { id: 'ao-share-title' }, t('share.title')),
        closeButton(t('common.close'), () => ctx.closeDialog()),
      ),
      h(
        'div',
        { class: 'ao-share-body' },
        h(
          'div',
          { class: 'ao-share-stage' },
          this.preview,
          h('div', { class: 'ao-share-overlay' }, this.status, this.retryBtn),
        ),
        h(
          'div',
          { class: 'ao-share-side' },
          this.field(t('share.format'), this.formatSegment.el),
          this.field(t('share.theme'), this.themeSegment.el),
          this.visualField,
          this.framingField,
          switchRow(t('share.option.names'), this.namesSwitch.el, t('share.option.names.hint')),
          switchRow(t('share.option.usage'), this.usageSwitch.el, t('share.option.usage.hint')),
          h('p', { class: 'ao-share-privacy' }, icon('shield', 14), h('span', null, t('share.privacy'))),
          h('div', { class: 'ao-share-actions' }, this.downloadBtn, this.copyImageBtn),
          this.feedback,
          h(
            'div',
            { class: 'ao-share-captionbox' },
            h('span', { class: 'ao-share-label' }, t('share.caption.label')),
            this.caption,
            this.copyCaptionBtn,
          ),
        ),
      ),
    );
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    return h('div', { class: 'ao-share-field' }, h('span', { class: 'ao-share-label' }, label), control);
  }

  protected onOpen(): void {
    this.token++;
    this.report = null;
    this.reportState = 'loading';
    this.hero = null;
    this.heroState = 'idle';
    this.heroKeyAsked = '';
    this.composed = '';
    this.busy = false;
    this.options = { ...DEFAULT_SHARE_OPTIONS, visual: this.ctx.world.kind };
    this.setFeedback('', '');
    void this.loadReport();
  }

  protected override onClose(): void {
    this.token++;
    this.hero = null;
    this.report = null;
  }

  /** After an error: ask for the numbers or the picture again. */
  private retry(): void {
    if (this.reportState === 'error') {
      this.reportState = 'loading';
      void this.loadReport();
    } else {
      this.heroState = 'idle';
      this.heroKeyAsked = '';
    }
    this.ctx.refresh();
  }

  private setOptions(patch: Partial<ShareOptions>): void {
    this.options = { ...this.options, ...patch };
    this.ctx.refresh();
  }

  private setFeedback(text: string, tone: FeedbackTone): void {
    setText(this.feedback, text);
    toggleClass(this.feedback, 'is-ok', tone === 'ok');
    toggleClass(this.feedback, 'is-bad', tone === 'bad');
  }

  private account(): string {
    const filter = this.ctx.ui.get().accountFilter;
    return filter.length === 1 ? (filter[0] as string) : 'all';
  }

  /** The day being shared (today when none was given). */
  private day(): string {
    return this.ctx.ui.get().shareDate || toDateKey(this.ctx.store.now());
  }

  private async loadReport(): Promise<void> {
    const token = this.token;
    try {
      const report = await this.ctx.store.backend.dayReport({
        date: this.day(),
        account: this.account(),
        includeRequests: false,
      });
      if (token !== this.token) return;
      this.report = report;
      this.reportState = 'ready';
    } catch {
      if (token !== this.token) return;
      this.reportState = 'error';
    }
    this.ctx.refresh();
  }

  private input(report: DayReport): CardInput {
    return {
      report,
      options: { showProjectNames: this.options.showProjectNames, showUsage: this.options.showUsage },
      now: this.ctx.store.now(),
    };
  }

  /** The picture changes with these and nothing else (theme, text and numbers are drawn over it). */
  private heroKey(report: DayReport): string {
    const o = this.options;
    const size = heroPixels(cardLayout(o.format, buildCardStats(this.input(report)).length));
    return `${o.visual}|${o.framing}|${o.showProjectNames}|${size.width}x${size.height}`;
  }

  private async makeHero(report: DayReport): Promise<void> {
    const token = this.token;
    const key = this.heroKey(report);
    this.heroKeyAsked = key;
    this.heroState = 'loading';
    const size = heroPixels(cardLayout(this.options.format, buildCardStats(this.input(report)).length));
    try {
      const canvas = await this.ctx.world.capture({
        ...size,
        mode: this.options.visual === this.ctx.world.kind ? this.options.framing : 'overview',
        showProjectNames: this.options.showProjectNames,
        kind: this.options.visual,
      });
      if (token !== this.token || key !== this.heroKeyAsked) return;
      this.hero = { key, canvas };
      this.heroState = 'ready';
    } catch {
      if (token !== this.token || key !== this.heroKeyAsked) return;
      this.heroState = 'error';
    }
    this.composed = '';
    this.ctx.refresh();
  }

  // ---- render -----------------------------------------------------------------------------------------------

  protected update(): void {
    const kinds = this.ctx.world.captureKinds();
    if (kinds.length > 0 && !kinds.includes(this.options.visual))
      this.options = { ...this.options, visual: kinds[0] as WorldKind };
    const live = this.options.visual === this.ctx.world.kind;
    this.visualField.hidden = kinds.length < 2;
    this.framingField.hidden = !live;
    this.formatSegment.set(this.options.format);
    this.themeSegment.set(this.options.theme);
    this.visualSegment.set(this.options.visual);
    this.framingSegment.set(this.options.framing);
    this.namesSwitch.set(this.options.showProjectNames);
    this.usageSwitch.set(this.options.showUsage);

    const report = this.report;
    const ready = this.reportState === 'ready' && report !== null && hasActivity(report);
    if (ready && report !== null && this.heroState !== 'loading' && this.heroKey(report) !== this.heroKeyAsked) {
      void this.makeHero(report);
    }
    this.syncStatus(ready);
    const picture = ready && this.hero !== null && this.heroState !== 'error';
    setDisabled(this.downloadBtn, !picture || this.busy);
    setDisabled(this.copyImageBtn, !picture || this.busy);
    setDisabled(this.copyCaptionBtn, !ready);
    if (ready && report !== null) this.compose(report);
  }

  private syncStatus(ready: boolean): void {
    let text = '';
    if (this.reportState === 'loading') text = t('share.preview.loading');
    else if (this.reportState === 'error') text = t('share.loadError');
    else if (!ready) text = t('share.empty');
    else if (this.heroState === 'error') text = t('share.error');
    else if (this.heroState !== 'ready') text = t('share.preview.loading');
    setText(this.status, text);
    this.status.hidden = text === '';
    this.retryBtn.hidden = this.reportState !== 'error' && this.heroState !== 'error';
    toggleClass(this.preview, 'is-hidden', !ready || this.hero === null);
    setAttr(this.preview, 'aria-busy', String(this.heroState === 'loading'));
  }

  /** Draws the card again when something it shows changed; the caption follows the same numbers. */
  private compose(report: DayReport): void {
    const o = this.options;
    const input = this.input(report);
    const signature = `${report.generatedAt}|${o.format}|${o.theme}|${o.showProjectNames}|${o.showUsage}|${this.hero?.key ?? ''}`;
    if (signature === this.composed) return;
    this.composed = signature;
    const model = buildCardModel(input);
    const layout = cardLayout(o.format, model.stats.length);
    const { width, height } = CARD_SIZES[o.format];
    if (this.preview.width !== width) this.preview.width = width;
    if (this.preview.height !== height) this.preview.height = height;
    const ctx = this.preview.getContext('2d');
    if (!ctx) return;
    renderCard(ctx, model, layout, o.theme, this.hero?.canvas ?? null);
    this.preview.style.aspectRatio = `${width} / ${height}`;
    const caption = buildCaption(input);
    if (this.caption.dataset.generated !== caption) {
      this.caption.dataset.generated = caption;
      this.caption.value = caption;
    }
  }

  // ---- actions ----------------------------------------------------------------------------------------------

  private async download(): Promise<void> {
    if (this.report === null) return;
    this.busy = true;
    try {
      const name = cardFilename(this.report.date);
      downloadBlob(await canvasToBlob(this.preview), name);
      this.setFeedback(t('share.downloaded', { name }), 'ok');
    } catch {
      this.setFeedback(t('share.error'), 'bad');
    } finally {
      this.busy = false;
      this.ctx.refresh();
    }
  }

  private async copyPicture(): Promise<void> {
    this.busy = true;
    try {
      const result = await copyImage(await canvasToBlob(this.preview));
      if (result === 'copied') this.setFeedback(t('share.copyImage.done'), 'ok');
      else
        this.setFeedback(t(result === 'unsupported' ? 'share.copyImage.unsupported' : 'share.copyImage.failed'), 'bad');
    } catch {
      this.setFeedback(t('share.copyImage.failed'), 'bad');
    } finally {
      this.busy = false;
      this.ctx.refresh();
    }
  }

  private copyCaption(): void {
    if (this.caption.value !== '') this.ctx.copy(this.caption.value, t('share.caption.copied'));
  }
}
