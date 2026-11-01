// What the settings row says about the engine: where the model runs, which model stands in for the one picked when this
// browser cannot run it, how fast to expect it to be and how fast the last take really was. Pure, so it is testable.
import { t, type TextKey } from '../i18n';
import { formatDecimal } from '../ui/format';
import type { ActiveVoiceModel, VoiceTakeTiming } from './engine';

export interface EngineView {
  /** "Engine: graphics card (WebGPU)". */
  engine: string;
  /** Why another model is used than the one picked, when that is the case. */
  fallback?: string;
  /** What to expect, by engine and model. */
  speed?: string;
  /** How long the last take took, when it ran on the model shown. */
  last?: string;
}

const MS_PER_SECOND = 1000;

function speedKey(model: ActiveVoiceModel): TextKey {
  if (model.backend === 'webgpu') return 'voice.speed.gpu';
  if (model.backend === 'wasm') return 'voice.speed.oneThread';
  return model.size === 'small' ? 'voice.speed.cpuSmall' : 'voice.speed.cpuLight';
}

function engineText(model: ActiveVoiceModel): string {
  if (model.backend === 'webgpu') return t('voice.engine.webgpu');
  if (model.backend === 'wasm-threads') return t('voice.engine.wasmThreads', { threads: model.threads });
  return t('voice.engine.wasm');
}

/** The lines for the model that will run (`undefined` while the browser is being checked). */
export function engineView(model: ActiveVoiceModel | undefined, lastTake: VoiceTakeTiming | undefined): EngineView {
  if (model === undefined) return { engine: t('voice.engine.detecting') };
  const view: EngineView = { engine: engineText(model), speed: t(speedKey(model)) };
  if (model.fallbackFrom !== undefined)
    view.fallback = t('voice.engine.fallback', {
      preferred: t(`voice.size.${model.fallbackFrom}`),
      name: t(`voice.size.${model.size}`),
    });
  if (lastTake !== undefined && lastTake.size === model.size && lastTake.backend === model.backend)
    view.last = t('voice.speed.last', {
      audio: formatDecimal(lastTake.audioMs / MS_PER_SECOND, 1),
      seconds: formatDecimal(lastTake.ms / MS_PER_SECOND, 1),
    });
  return view;
}
