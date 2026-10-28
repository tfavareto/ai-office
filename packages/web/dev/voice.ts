// Dev harness: the voice input and the mic button over a text field, against a running AI Office server (vite proxies /api).
// Query: ?lang=pt-BR|en|es (the interface language), ?size=tiny|base|small|turbo (the model to use).
// `window.voice` and `window.recorder` expose the engine and the bare recorder for scripted checks.
import '../src/styles/index.css';
import { LOCALES, isVoiceModelSize, type Locale } from '@ai-office/shared';
import { setLocale } from '../src/i18n';
import { h } from '../src/ui/dom';
import { createMicButton, createVoice } from '../src/voice';
import { createBrowserWhisperWorker } from '../src/voice/browser';
import { createRecorder } from '../src/voice/recorder';
import { browserRecorderEnv } from '../src/voice/web-audio-capture';

const params = new URLSearchParams(location.search);
const lang = params.get('lang');
if (lang !== null && (LOCALES as readonly string[]).includes(lang)) setLocale(lang as Locale);
const size = params.get('size');

const voice = createVoice();
if (size !== null && isVoiceModelSize(size)) voice.preference.setSize(size);

const field = h('textarea', { class: 'ao-textarea', rows: 3, 'aria-label': 'text', placeholder: '…' });
const log = h('pre', { style: 'color:#9aa6b8;font-size:11px;white-space:pre-wrap' });
const mic = createMicButton({
  ...voice,
  onText: (text) => {
    field.value = `${field.value}${field.value === '' ? '' : ' '}${text}`;
  },
});
voice.input.onStatus((status) => {
  log.textContent =
    `${new Date().toISOString().slice(11, 23)} ${JSON.stringify(status)}\n${log.textContent ?? ''}`.slice(0, 1500);
});

const app = document.getElementById('app');
app?.classList.add('ao-root');
app?.append(field, mic.el, log);
Object.assign(window, { voice, field, recorder: createRecorder(browserRecorderEnv()), createBrowserWhisperWorker });
