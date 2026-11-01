// Real terminals that have no session in the office yet, in a window of their own at the corner of the canvas. Claude
// Code only registers a session after its first questions (does it trust this folder?), and nobody could answer them
// if the terminal only appeared once the session did. When the session shows up, the terminal moves to the canvas.
import type { TerminalInfo } from '@ai-office/shared';
import { t } from '../../i18n';
import { h, setAttr, setText } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { XtermView } from './xterm-view';
import type { TerminalHub } from '../model/terminal-hub';

interface DockWindow {
  el: HTMLElement;
  view: XtermView;
  title: HTMLElement;
  action: HTMLButtonElement;
}

function folderName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}

export class TerminalDock {
  readonly el = h('div', { class: 'ao-pro-dock', hidden: true });
  private readonly windows = new Map<string, DockWindow>();

  constructor(
    private readonly hub: TerminalHub,
    private readonly onDismiss: (id: string) => void,
    private readonly onKillError: (error: unknown) => void,
  ) {}

  /** Shows these terminals, and only these. */
  sync(terminals: readonly TerminalInfo[]): void {
    const wanted = new Set(terminals.map((terminal) => terminal.id));
    for (const [id, window] of this.windows) {
      if (wanted.has(id)) continue;
      window.view.dispose();
      window.el.remove();
      this.windows.delete(id);
    }
    for (const terminal of terminals) this.update(this.windows.get(terminal.id) ?? this.open(terminal), terminal);
    this.el.hidden = terminals.length === 0;
  }

  dispose(): void {
    this.sync([]);
  }

  private open(terminal: TerminalInfo): DockWindow {
    const title = h('span', { class: 'ao-pro-dock-title' });
    const action = h(
      'button',
      {
        type: 'button',
        class: 'ao-pro-action',
        onclick: () => this.onAction(terminal.id),
      },
      icon('x', 13),
    );
    const view = new XtermView(
      terminal.id,
      this.hub,
      () => action.focus(),
      () => undefined,
    );
    const el = h(
      'section',
      { class: 'ao-pro-dock-window', 'aria-label': t('pro.terminal.starting', { folder: folderName(terminal.cwd) }) },
      h('header', { class: 'ao-pro-dock-head' }, title, action),
      view.el,
    );
    this.el.append(el);
    const window: DockWindow = { el, view, title, action };
    this.windows.set(terminal.id, window);
    return window;
  }

  private update(window: DockWindow, terminal: TerminalInfo): void {
    setText(window.title, t('pro.terminal.starting', { folder: folderName(terminal.cwd) }));
    const label = terminal.exitCode === undefined ? t('pro.terminal.kill') : t('common.close');
    setAttr(window.action, 'title', label);
    setAttr(window.action, 'aria-label', label);
    window.el.dataset.ended = String(terminal.exitCode !== undefined);
  }

  /** Stops a running one; an ended one only leaves the screen. */
  private onAction(id: string): void {
    if (this.windows.get(id)?.el.dataset.ended === 'true') {
      this.onDismiss(id);
      return;
    }
    this.hub.kill(id).catch((error: unknown) => this.onKillError(error));
  }
}
