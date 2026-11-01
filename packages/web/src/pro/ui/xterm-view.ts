// A real terminal on screen: xterm.js connected to a terminal of the hub. The library only loads when the first one
// opens, so nobody who never uses real terminals pays for it. While it has the keyboard every key belongs to the
// program (a TUI needs Esc and the arrows), except Ctrl+] that gives the keyboard back to the page.
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { t } from '../../i18n';
import { h } from '../../ui/dom';
import type { TerminalHub } from '../model/terminal-hub';

const FIT_DEBOUNCE_MS = 120;
const SCROLLBACK_LINES = 5000;
const RELEASE_KEY = ']';
const THEME = {
  background: '#0a0a0a',
  foreground: '#d6d6d6',
  cursor: '#d6d6d6',
  selectionBackground: 'rgba(255, 255, 255, 0.25)',
};

function isReleaseKey(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && event.key === RELEASE_KEY;
}

export class XtermView {
  readonly el = h('div', { class: 'ao-pro-xterm', 'data-no-drag': '' });
  private term: Terminal | null = null;
  private fit: FitAddon | null = null;
  private detach: (() => void) | null = null;
  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly observer = new ResizeObserver(() => this.scheduleFit());
  private disposed = false;
  private wantsFocus = false;

  constructor(
    private readonly id: string,
    private readonly hub: TerminalHub,
    private readonly onRelease: () => void,
    private readonly onFocusChange: (focused: boolean) => void,
  ) {
    this.observer.observe(this.el);
    this.el.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.el.addEventListener('focusin', () => this.onFocusChange(true));
    this.el.addEventListener('focusout', () => this.onFocusChange(false));
    void this.load();
  }

  focus(): void {
    if (this.term === null) this.wantsFocus = true;
    else this.term.focus();
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    if (this.fitTimer !== null) clearTimeout(this.fitTimer);
    this.detach?.();
    this.term?.dispose();
    this.term = null;
  }

  private async load(): Promise<void> {
    const [{ Terminal: TerminalClass }, { FitAddon: FitClass }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css'),
    ]);
    if (this.disposed) return;
    const term = new TerminalClass({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      scrollback: SCROLLBACK_LINES,
      theme: THEME,
      cursorBlink: true,
    });
    const fit = new FitClass();
    term.loadAddon(fit);
    term.open(this.el);
    this.term = term;
    this.fit = fit;
    // xterm reads the key before the page sees it: the release key has to be taken from it here.
    term.attachCustomKeyEventHandler((event) => {
      if (!isReleaseKey(event)) return true;
      if (event.type === 'keydown') {
        event.preventDefault();
        this.onRelease();
      }
      return false;
    });
    term.onData((data) => this.hub.send(this.id, data));
    this.detach = this.hub.attach(this.id, {
      write: (bytes) => term.write(bytes),
      reset: () => term.reset(),
      ended: (code) => term.write(`\r\n\x1b[2m${t('pro.terminal.ended', { code })}\x1b[0m\r\n`),
    });
    this.scheduleFit();
    if (this.wantsFocus) term.focus();
  }

  private scheduleFit(): void {
    if (this.fitTimer !== null) clearTimeout(this.fitTimer);
    this.fitTimer = setTimeout(() => this.applyFit(), FIT_DEBOUNCE_MS);
  }

  private applyFit(): void {
    const term = this.term;
    const fit = this.fit;
    if (term === null || fit === null || this.el.offsetParent === null) return;
    const size = fit.proposeDimensions();
    if (size === undefined || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return;
    if (size.cols === term.cols && size.rows === term.rows) return;
    term.resize(size.cols, size.rows);
    void this.hub.resize(this.id, size.cols, size.rows).catch(() => undefined);
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Cmd stays with the page and the browser (copy, paste, search); everything else was for the program.
    if (!event.metaKey) event.stopPropagation();
  }
}
