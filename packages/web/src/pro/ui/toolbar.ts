// The canvas tools: fit everything, focus the orchestrator, zoom, theme, reset of the dragged positions, and the switch
// of the optional command bar.
import { t } from '../../i18n';
import { h, setText } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { iconButton, setDisabled, setPressed } from '../../ui/widgets';
import type { ProTheme } from '../../prefs/prefs';

export interface ToolbarActions {
  fitAll(): void;
  focusOrchestrator(): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  toggleTheme(): void;
  resetLayout(): void;
  toggleCommandBar(): void;
}

export class Toolbar {
  readonly el = h('div', { class: 'ao-pro-toolbar', role: 'toolbar', 'aria-label': t('pro.toolbar.label') });
  private readonly zoom = h('button', {
    type: 'button',
    class: 'ao-pro-zoom',
    title: t('pro.toolbar.resetZoom'),
    'aria-label': t('pro.toolbar.resetZoom'),
  });
  private readonly theme: HTMLButtonElement;
  private readonly reset: HTMLButtonElement;
  private readonly command: HTMLButtonElement;
  private shownTheme: ProTheme | null = null;

  constructor(actions: ToolbarActions) {
    this.zoom.addEventListener('click', actions.resetZoom);
    this.theme = iconButton({
      icon: 'moon',
      label: t('pro.toolbar.theme'),
      onClick: actions.toggleTheme,
      pressed: false,
    });
    this.reset = iconButton({ icon: 'reset', label: t('pro.toolbar.resetLayout'), onClick: actions.resetLayout });
    this.command = iconButton({
      icon: 'terminal',
      label: t('pro.toolbar.command'),
      onClick: actions.toggleCommandBar,
      pressed: false,
    });
    this.el.append(
      iconButton({ icon: 'fit', label: t('pro.toolbar.fit'), onClick: actions.fitAll }),
      iconButton({ icon: 'target', label: t('pro.toolbar.focus'), onClick: actions.focusOrchestrator }),
      h('span', { class: 'ao-pro-toolbar-sep', 'aria-hidden': 'true' }),
      iconButton({ icon: 'zoomOut', label: t('pro.toolbar.zoomOut'), onClick: actions.zoomOut }),
      this.zoom,
      iconButton({ icon: 'zoomIn', label: t('pro.toolbar.zoomIn'), onClick: actions.zoomIn }),
      h('span', { class: 'ao-pro-toolbar-sep', 'aria-hidden': 'true' }),
      this.theme,
      this.reset,
      h('span', { class: 'ao-pro-toolbar-sep', 'aria-hidden': 'true' }),
      this.command,
    );
  }

  render(state: { zoom: number; theme: ProTheme; canReset: boolean; commandBar: boolean }): void {
    setPressed(this.command, state.commandBar);
    setText(this.zoom, `${Math.round(state.zoom * 100)}%`);
    setPressed(this.theme, state.theme === 'light');
    if (this.shownTheme !== state.theme) {
      this.shownTheme = state.theme;
      this.theme.replaceChildren(icon(state.theme === 'light' ? 'sun' : 'moon', 18));
    }
    const label = t(state.theme === 'light' ? 'pro.toolbar.themeDark' : 'pro.toolbar.themeLight');
    this.theme.title = label;
    this.theme.setAttribute('aria-label', label);
    setDisabled(this.reset, !state.canReset, t('pro.toolbar.resetLayout.none'));
    if (state.canReset) this.reset.title = t('pro.toolbar.resetLayout');
  }
}
