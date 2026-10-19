// Help dialog: status legend, UI icon legend, keyboard shortcuts and how to install the Claude Code plugin.
import type { AppContext } from '../context';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import { STATUS_HINT, STATUS_LABEL, type DisplayStatus } from '../model/status';
import { statusDot } from '../widgets';
import { Dialog, closeButton } from './overlay';

const LEGEND_STATUSES: readonly DisplayStatus[] = ['working', 'waiting', 'shell', 'idle', 'done', 'error'];

const SHORTCUTS: readonly [string, string][] = [
  ['/', 'Buscar agente, projeto ou conta'],
  ['F', 'Seguir o agente selecionado'],
  ['T', 'Abrir ou fechar o terminal do agente'],
  ['N', 'Enviar mensagem ao agente ou à equipe da sala'],
  ['P', 'Ir para o próximo pedido de permissão'],
  ['M', 'Abrir "Meu dia"'],
  ['O', 'Visão geral do escritório'],
  ['[', 'Mostrar ou ocultar a barra lateral'],
  [']', 'Expandir ou recolher a atividade'],
  ['?', 'Abrir esta ajuda'],
  ['⌘/Ctrl + Enter', 'Enviar a mensagem escrita'],
  ['⌘/Ctrl + F', 'Buscar dentro do terminal'],
  ['Esc', 'Fechar o item do topo: busca, terminal, painéis, seleção'],
];

const ICON_LEGEND: readonly [IconName, string][] = [
  ['fit', 'Visão geral: enquadra todo o escritório'],
  ['bell', 'Notificações e "Não perturbe"'],
  ['calendar', 'Meu dia: tempo de cada agente por status'],
  ['history', 'Histórico de sessões dos últimos 7 dias'],
  ['feed', 'Atividade de todo o escritório'],
  ['terminal', 'Terminal somente leitura da sessão'],
  ['target', 'Centralizar a câmera no agente'],
  ['follow', 'Seguir o agente com a câmera'],
];

const INSTALL_COMMAND = 'npm run plugin:install';

export class HelpDialog extends Dialog {
  constructor(ctx: AppContext) {
    super(ctx, 'help', 'ao-help-title', 'ao-dialog--help');
    const copy = h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': 'Copiar comando', title: 'Copiar comando', onclick: () => ctx.copy(INSTALL_COMMAND, 'Comando copiado.') }, icon('copy', 14));
    this.panel.append(
      h('header', { class: 'ao-dialog-head' }, h('h2', { id: 'ao-help-title' }, 'Ajuda'), closeButton('Fechar', () => ctx.closeDialog())),
      h(
        'div',
        { class: 'ao-help-body' },
        h(
          'section',
          { class: 'ao-help-section' },
          h('h3', null, 'Status das pessoas'),
          h('ul', { class: 'ao-legend' }, ...LEGEND_STATUSES.map((s) => h('li', null, statusDot(s), h('strong', null, STATUS_LABEL[s]), h('span', null, STATUS_HINT[s])))),
          h('p', { class: 'ao-note' }, 'Cada projeto aberto é uma sala; cada sessão do Claude Code é uma pessoa. Subagentes chegam, trabalham e saem.'),
        ),
        h('section', { class: 'ao-help-section' }, h('h3', null, 'Ícones'), h('ul', { class: 'ao-legend' }, ...ICON_LEGEND.map(([name, text]) => h('li', null, icon(name, 16), h('span', null, text))))),
        h('section', { class: 'ao-help-section' }, h('h3', null, 'Atalhos'), h('dl', { class: 'ao-shortcuts' }, ...SHORTCUTS.flatMap(([key, text]) => [h('dt', null, h('kbd', { class: 'ao-kbd' }, key)), h('dd', null, text)]))),
        h(
          'section',
          { class: 'ao-help-section' },
          h('h3', null, 'Instalar o plugin do Claude Code'),
          h('p', { class: 'ao-note' }, 'O plugin permite responder permissões e enviar mensagens pelo escritório. Na pasta do AI Office, rode:'),
          h('div', { class: 'ao-code' }, h('code', null, INSTALL_COMMAND), copy),
          h('p', { class: 'ao-note' }, 'Ele instala em todas as contas detectadas. Para conferir use npm run plugin:status; para remover, npm run plugin:uninstall. Reinicie as sessões abertas do Claude Code depois.'),
        ),
      ),
    );
  }

  protected onOpen(): void {
    // Static content.
  }

  protected update(): void {
    // Static content.
  }
}
