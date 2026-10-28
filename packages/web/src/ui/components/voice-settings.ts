// The "Voz" row of the settings: which model, whether it is on this computer, where it runs (graphics card or
// processor) and how fast, the spoken language, and the buttons that download and remove it. Nothing is downloaded
// until the person presses the button.
import { VOICE_MODEL_SIZES, type VoiceModelSize, type VoiceModelStatus } from '@ai-office/shared';
import { t } from '../../i18n';
import { activeVoiceModel, type ActiveVoiceModel } from '../../voice/engine';
import { engineView } from '../../voice/engine-view';
import { downloadErrorKey } from '../../voice/errors';
import { formatMegabytes, isVoiceSize, percentOf, sizeOptionLabel, voiceErrorText } from '../../voice/mic-view';
import { VOICE_LANGUAGE_CHOICES, type VoiceLanguageChoice } from '../../voice/preference';
import type { VoiceHandle } from '../../voice';
import { localOnlyHint, type AppContext } from '../context';
import { h, setAttr, setText } from '../dom';
import { button } from '../widgets';

export class VoiceSettings {
  readonly el: HTMLElement;
  private readonly select = h('select', {
    class: 'ao-select',
    'aria-label': t('settings.voice.sizeLabel'),
  });
  private readonly languageSelect = h('select', {
    class: 'ao-select',
    'aria-label': t('settings.voice.languageLabel'),
  });
  private readonly status = h('span', { class: 'ao-voice-status', role: 'status' });
  private readonly sizeHint = h('p', { class: 'ao-setting-hint' });
  private readonly engine = h('p', { class: 'ao-setting-hint ao-voice-engine' });
  private readonly fallback = h('p', { class: 'ao-setting-hint ao-setting-hint--warn', hidden: true });
  private readonly speed = h('p', { class: 'ao-setting-hint' });
  private readonly error = h('p', { class: 'ao-setting-hint ao-setting-hint--warn', role: 'alert', hidden: true });
  private readonly download = button({
    label: t('voice.download'),
    variant: 'primary',
    className: 'ao-btn--small',
    icon: 'arrowDown',
    onClick: () => void this.voice.input.prepare(),
  });
  private readonly cancelDownload = button({
    label: t('voice.cancelDownload'),
    variant: 'soft',
    className: 'ao-btn--small',
    onClick: () => void this.remove(),
  });
  private readonly removeButton = button({
    label: t('voice.remove'),
    variant: 'soft',
    className: 'ao-btn--small',
    icon: 'trash',
    onClick: () => void this.remove(),
  });
  private readonly progress = h(
    'span',
    { class: 'ao-progress ao-progress--wide', 'aria-hidden': 'true' },
    h('span', { class: 'ao-progress-bar' }),
  );
  private readonly unsubscribe: () => void;

  constructor(
    private readonly ctx: AppContext,
    private readonly voice: VoiceHandle,
  ) {
    for (const size of VOICE_MODEL_SIZES)
      this.select.append(h('option', { value: size }, sizeOptionLabel(size, undefined)));
    this.select.addEventListener('change', () => {
      if (isVoiceSize(this.select.value)) this.voice.preference.setSize(this.select.value);
    });
    for (const choice of VOICE_LANGUAGE_CHOICES) this.languageSelect.append(h('option', { value: choice }));
    this.languageSelect.addEventListener('change', () => {
      const choice = VOICE_LANGUAGE_CHOICES.find((value) => value === this.languageSelect.value);
      if (choice !== undefined) this.voice.preference.setLanguage(choice);
    });
    this.el = h(
      'div',
      { class: 'ao-setting ao-setting--voice' },
      h(
        'div',
        { class: 'ao-setting-main' },
        h('span', { class: 'ao-setting-label' }, t('settings.voice.label')),
        this.select,
      ),
      this.sizeHint,
      this.engine,
      this.fallback,
      this.speed,
      h('div', { class: 'ao-voice-row' }, this.status, this.download, this.cancelDownload, this.removeButton),
      this.progress,
      this.error,
      h(
        'div',
        { class: 'ao-setting-main' },
        h('span', { class: 'ao-setting-label' }, t('settings.voice.languageLabel')),
        this.languageSelect,
      ),
      h('p', { class: 'ao-setting-hint' }, t('settings.voice.hint')),
    );
    const refresh = (): void => ctx.refresh();
    const unsubscribers = [
      voice.models.onChange(refresh),
      voice.preference.onChange(refresh),
      voice.engine.onChange(refresh),
    ];
    this.unsubscribe = () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  /** The model that will run for the size picked, once the browser was checked. */
  private active(): ActiveVoiceModel | undefined {
    const capabilities = this.voice.engine.capabilities();
    return capabilities === undefined ? undefined : activeVoiceModel(this.voice.preference.size(), capabilities);
  }

  /** The popover opened: read what the server says now, and check where the model can run. */
  onOpen(): void {
    if (!this.ctx.isLocal) return;
    void this.voice.models.refresh();
    void this.voice.engine.ready();
  }

  dispose(): void {
    this.unsubscribe();
  }

  private async remove(): Promise<void> {
    try {
      await this.voice.models.remove(this.active()?.size ?? this.voice.preference.size());
    } catch {
      this.ctx.notifyLocal('warn', t('error.generic'));
    }
  }

  update(): void {
    const size = this.voice.preference.size();
    const active = this.active();
    const models = this.voice.models;
    const current = models.current();
    const model = models.statusOf(active?.size ?? size);
    const local = this.ctx.isLocal;
    if (this.select.value !== size) this.select.value = size;
    this.select.disabled = !local;
    for (const option of Array.from(this.select.options)) {
      const optionSize = option.value as VoiceModelSize;
      setText(option, sizeOptionLabel(optionSize, models.statusOf(optionSize)?.bytes));
    }
    setText(this.sizeHint, t(`voice.size.${size}.hint`));
    this.renderEngine(active);
    this.renderLanguage(local);
    this.renderState(model, current?.enabled !== false, local);
    const busy = model?.state === 'downloading';
    this.download.hidden = model?.state === 'ready' || busy;
    this.download.disabled = !local || current === null || current.enabled === false;
    this.cancelDownload.hidden = !busy;
    this.removeButton.hidden = model?.state !== 'ready';
    const bar = this.progress.firstElementChild as HTMLElement;
    this.progress.hidden = !busy;
    bar.style.width = `${percentOf(model === undefined || model.bytes === 0 ? 0 : model.downloadedBytes / model.bytes)}%`;
  }

  private renderEngine(active: ActiveVoiceModel | undefined): void {
    const view = engineView(active, this.voice.engine.lastTake());
    setText(this.engine, view.engine);
    this.fallback.hidden = view.fallback === undefined;
    setText(this.fallback, view.fallback ?? '');
    const speed = [view.speed, view.last].filter((line) => line !== undefined).join(' ');
    this.speed.hidden = speed === '';
    setText(this.speed, speed);
  }

  private renderLanguage(local: boolean): void {
    const choice: VoiceLanguageChoice = this.voice.preference.language();
    if (this.languageSelect.value !== choice) this.languageSelect.value = choice;
    this.languageSelect.disabled = !local;
    for (const option of Array.from(this.languageSelect.options))
      setText(option, t(option.value === 'auto' ? 'voice.language.auto' : 'voice.language.interface'));
  }

  private renderState(model: VoiceModelStatus | undefined, enabled: boolean, local: boolean): void {
    let message: string;
    if (!local) message = localOnlyHint();
    else if (!enabled) message = voiceErrorText('voice.error.disabled');
    else if (model === undefined) message = t('voice.status.unreachable');
    else if (model.state === 'ready') message = t('voice.status.ready');
    else if (model.state === 'downloading')
      message = t('voice.status.downloading', { percent: percentOf(model.downloadedBytes / Math.max(1, model.bytes)) });
    else message = t('voice.status.missing', { size: formatMegabytes(model.bytes) });
    setText(this.status, message);
    const key = model?.state === 'error' && model.error !== undefined ? downloadErrorKey(model.error) : undefined;
    this.error.hidden = key === undefined;
    setText(this.error, key === undefined ? '' : t(key));
    setAttr(this.download, 'title', local ? null : localOnlyHint());
  }
}
