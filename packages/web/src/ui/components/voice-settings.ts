// The "Voz" row of the settings: whether the speech model is on this computer, which size, and the buttons that
// download and remove it. Nothing is downloaded until the person presses the button.
import { VOICE_MODEL_SIZES, type VoiceModelSize, type VoiceModelStatus } from '@ai-office/shared';
import { t } from '../../i18n';
import { downloadErrorKey } from '../../voice/errors';
import { formatMegabytes, isVoiceSize, percentOf, sizeOptionLabel, voiceErrorText } from '../../voice/mic-view';
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
  private readonly status = h('span', { class: 'ao-voice-status', role: 'status' });
  private readonly sizeHint = h('p', { class: 'ao-setting-hint' });
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
      h('div', { class: 'ao-voice-row' }, this.status, this.download, this.cancelDownload, this.removeButton),
      this.progress,
      this.error,
      h('p', { class: 'ao-setting-hint' }, t('settings.voice.hint')),
    );
    this.unsubscribe = voice.models.onChange(() => ctx.refresh());
    voice.preference.onChange(() => ctx.refresh());
  }

  /** The popover opened: read what the server says now. */
  onOpen(): void {
    if (this.ctx.isLocal) void this.voice.models.refresh();
  }

  dispose(): void {
    this.unsubscribe();
  }

  private async remove(): Promise<void> {
    try {
      await this.voice.models.remove(this.voice.preference.size());
    } catch {
      this.ctx.notifyLocal('warn', t('error.generic'));
    }
  }

  update(): void {
    const size = this.voice.preference.size();
    const models = this.voice.models;
    const current = models.current();
    const model = models.statusOf(size);
    const local = this.ctx.isLocal;
    if (this.select.value !== size) this.select.value = size;
    this.select.disabled = !local;
    for (const option of Array.from(this.select.options)) {
      const optionSize = option.value as VoiceModelSize;
      setText(option, sizeOptionLabel(optionSize, models.statusOf(optionSize)?.bytes));
    }
    setText(this.sizeHint, t(`voice.size.${size}.hint`));
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
