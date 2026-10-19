// Scripted content used by the demo simulator: projects, prompts, files, commands, permission requests.
// Generated human text is a `DemoText`: the pt-BR rendering (kept in the `text` fields) plus the shared message key.
import type { Account } from '../model';
import { accountColor } from '../colors';
import { type Msg, msg, sourceText } from '../i18n';
import type { SharedMessageKey } from '../i18n/messages/pt-BR';

/** A generated text: pt-BR rendering plus its localizable message. */
export interface DemoText {
  text: string;
  msg: Msg;
}

function localized(key: SharedMessageKey, params?: Readonly<Record<string, string | number>>): DemoText {
  const message = msg(key, params);
  return { text: sourceText(message), msg: message };
}

export interface DemoProjectSpec {
  name: string;
  path: string;
  files: readonly string[];
  prompts: readonly DemoText[];
}

const ROOT = '/Users/demo/projetos';

function project(name: string, files: readonly string[], prompts: readonly SharedMessageKey[]): DemoProjectSpec {
  return { name, path: `${ROOT}/${name}`, files: files.map((file) => `${ROOT}/${name}/${file}`), prompts: prompts.map((key) => localized(key)) };
}

export const DEMO_PROJECTS: readonly DemoProjectSpec[] = [
  project('loja-online', ['src/carrinho/Carrinho.tsx', 'src/checkout/Pagamento.tsx', 'src/api/pedidos.ts', 'src/estoque/estoque.ts', 'package.json', 'src/tema.css'], [
    'demo.prompt.store.1',
    'demo.prompt.store.2',
    'demo.prompt.store.3',
  ]),
  project('api-pagamentos', ['src/rotas/cobranca.ts', 'src/servicos/pix.ts', 'src/db/schema.sql', 'src/webhooks/gateway.ts', 'tests/cobranca.test.ts', 'README.md'], [
    'demo.prompt.payments.1',
    'demo.prompt.payments.2',
    'demo.prompt.payments.3',
  ]),
  project('app-mobile', ['src/telas/Inicio.tsx', 'src/telas/Perfil.tsx', 'src/navegacao/rotas.ts', 'src/hooks/useSessao.ts', 'app.json', 'src/componentes/Botao.tsx'], [
    'demo.prompt.mobile.1',
    'demo.prompt.mobile.2',
    'demo.prompt.mobile.3',
  ]),
  project('painel-admin', ['src/paginas/Usuarios.vue', 'src/paginas/Relatorios.vue', 'src/store/sessao.ts', 'src/api/cliente.ts', 'vite.config.ts', 'src/estilos/base.css'], [
    'demo.prompt.admin.1',
    'demo.prompt.admin.2',
    'demo.prompt.admin.3',
  ]),
  project('blog-pessoal', ['content/posts/ola-mundo.md', 'src/layouts/Post.astro', 'src/paginas/index.astro', 'astro.config.mjs', 'src/componentes/Cabecalho.astro', 'public/rss.xml'], [
    'demo.prompt.blog.1',
    'demo.prompt.blog.2',
    'demo.prompt.blog.3',
  ]),
  project('pipeline-dados', ['dags/ingestao.py', 'dags/limpeza.py', 'src/transformacoes.py', 'tests/test_limpeza.py', 'pyproject.toml', 'docs/arquitetura.md'], [
    'demo.prompt.pipeline.1',
    'demo.prompt.pipeline.2',
    'demo.prompt.pipeline.3',
  ]),
  project('design-system', ['packages/ui/Botao.tsx', 'packages/ui/Modal.tsx', 'packages/tokens/cores.ts', 'docs/guia.mdx', 'packages/ui/Campo.tsx', 'package.json'], [
    'demo.prompt.design.1',
    'demo.prompt.design.2',
    'demo.prompt.design.3',
  ]),
  project('bot-atendimento', ['src/fluxos/saudacao.ts', 'src/fluxos/pedido.ts', 'src/nlp/intencoes.ts', 'src/canais/whatsapp.ts', 'tests/fluxos.test.ts', 'config/respostas.json'], [
    'demo.prompt.bot.1',
    'demo.prompt.bot.2',
    'demo.prompt.bot.3',
  ]),
  project('infra-terraform', ['main.tf', 'modulos/rede/main.tf', 'modulos/banco/main.tf', 'variaveis.tf', 'ambientes/prod.tfvars', 'README.md'], [
    'demo.prompt.infra.1',
    'demo.prompt.infra.2',
    'demo.prompt.infra.3',
  ]),
  project('landing-page', ['index.html', 'css/estilo.css', 'js/formulario.js', 'js/animacoes.js', 'imagens/hero.svg', 'sitemap.xml'], [
    'demo.prompt.landing.1',
    'demo.prompt.landing.2',
    'demo.prompt.landing.3',
  ]),
  project('crm-vendas', ['src/negocios/funil.ts', 'src/contatos/lista.tsx', 'src/relatorios/metas.ts', 'src/api/rdstation.ts', 'prisma/schema.prisma', 'src/auth/sessao.ts'], [
    'demo.prompt.crm.1',
    'demo.prompt.crm.2',
    'demo.prompt.crm.3',
  ]),
  project('jogo-puzzle', ['src/jogo/tabuleiro.ts', 'src/jogo/fases.json', 'src/ui/Menu.ts', 'src/audio/efeitos.ts', 'index.html', 'src/jogo/pontuacao.ts'], [
    'demo.prompt.game.1',
    'demo.prompt.game.2',
    'demo.prompt.game.3',
  ]),
];

/** Prompt of projects that are not in the catalog above (spawned by name). */
export const DEMO_GENERIC_PROMPT: DemoText = localized('demo.prompt.generic');

/** The default demo account is flagged `isDefault`, so the client shows its label in the user's language. */
export const DEMO_ACCOUNTS: readonly Account[] = [
  { id: 'demo-pessoal', label: 'Pessoal', initial: 'P', color: accountColor(0), dir: '~/.claude', isDefault: true },
  { id: 'demo-trabalho', label: 'Trabalho', labelMsg: msg('demo.account.work'), initial: 'T', color: accountColor(1), dir: '~/.claude-trabalho' },
];

export interface DemoCommand {
  command: string;
  description: DemoText;
  /** Rough duration in ms (long commands become foreground shells). */
  durationMs: number;
}

export const DEMO_COMMANDS: readonly DemoCommand[] = [
  { command: 'npm test', description: localized('demo.cmd.test'), durationMs: 16000 },
  { command: 'npm run build', description: localized('demo.cmd.build'), durationMs: 14000 },
  { command: 'npx tsc --noEmit', description: localized('demo.cmd.types'), durationMs: 5000 },
  { command: 'git status --short', description: localized('demo.cmd.status'), durationMs: 1200 },
  { command: 'npm run lint', description: localized('demo.cmd.lint'), durationMs: 4000 },
  { command: 'git diff --stat', description: localized('demo.cmd.diff'), durationMs: 1500 },
  { command: 'ls -la src', description: localized('demo.cmd.ls'), durationMs: 900 },
];

export const DEMO_LONG_SHELLS: readonly { command: string; label: DemoText }[] = [
  { command: 'npm run dev', label: localized('demo.shell.dev') },
  { command: 'npx vitest --watch', label: localized('demo.shell.watch') },
  { command: 'docker compose up', label: localized('demo.shell.docker') },
];

export const DEMO_TASK_PLAN: readonly { title: DemoText; activeForm: DemoText }[] = [
  { title: localized('demo.task.1.title'), activeForm: localized('demo.task.1.active') },
  { title: localized('demo.task.2.title'), activeForm: localized('demo.task.2.active') },
  { title: localized('demo.task.3.title'), activeForm: localized('demo.task.3.active') },
  { title: localized('demo.task.4.title'), activeForm: localized('demo.task.4.active') },
  { title: localized('demo.task.5.title'), activeForm: localized('demo.task.5.active') },
];

export const DEMO_SUBAGENTS: readonly { type: string; description: DemoText }[] = [
  { type: 'Explore', description: localized('demo.sub.1') },
  { type: 'general-purpose', description: localized('demo.sub.2') },
  { type: 'code-reviewer', description: localized('demo.sub.3') },
  { type: 'test-writer', description: localized('demo.sub.4') },
  { type: 'Explore', description: localized('demo.sub.5') },
];

export const DEMO_SEARCHES: readonly string[] = ['useEffect', 'TODO', 'export default', 'async function', 'class .*Service', 'fetch\\('];

export const DEMO_WEB: readonly { url: string; query: string }[] = [
  { url: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Fetch_API', query: 'fetch api timeout' },
  { url: 'https://nodejs.org/docs/latest/api/fs.html', query: 'node fs watch' },
  { url: 'https://vitest.dev/guide/mocking', query: 'vitest mock modules' },
];

export const DEMO_MCP: readonly string[] = ['mcp__github__list_issues', 'mcp__postgres__query', 'mcp__figma__get_node', 'mcp__sentry__list_errors'];

export interface DemoError {
  tool: string;
  /** Raw tool output (data), or the pt-BR rendering of `message`. */
  detail: string;
  /** Present when `detail` is a generated sentence. */
  message?: Msg;
}

function generatedError(tool: string, key: SharedMessageKey): DemoError {
  const text = localized(key);
  return { tool, detail: text.text, message: text.msg };
}

export const DEMO_ERRORS: readonly DemoError[] = [
  generatedError('Bash', 'demo.error.tests'),
  { tool: 'Bash', detail: 'npx tsc: Property "total" does not exist on type "Pedido"' },
  generatedError('Edit', 'demo.error.edit'),
  { tool: 'Bash', detail: 'npm run build: Module not found: ./estilos' },
];

export interface DemoPermissionSpec {
  toolName: string;
  /** A shell command (data) or the pt-BR rendering of `summaryMsg`. */
  summary: string;
  /** Present when `summary` is a generated sentence. */
  summaryMsg?: Msg;
  input: Record<string, unknown>;
  suggestions: readonly DemoText[];
}

function allowRule(rules: string): DemoText {
  return localized('perm.suggestion.allow', { rules, scope: 'none' });
}

function generatedSummary(text: DemoText): Pick<DemoPermissionSpec, 'summary' | 'summaryMsg'> {
  return { summary: text.text, summaryMsg: text.msg };
}

export const DEMO_PERMISSIONS: readonly DemoPermissionSpec[] = [
  { toolName: 'Bash', summary: 'npm install zod', input: { command: 'npm install zod' }, suggestions: [allowRule('Bash(npm install:*)')] },
  { toolName: 'Bash', summary: 'rm -rf dist', input: { command: 'rm -rf dist', description: 'Limpar a pasta de build' }, suggestions: [allowRule('Bash(rm -rf dist)')] },
  { toolName: 'Edit', ...generatedSummary(localized('perm.edit', { file: 'src/config.ts' })), input: { file_path: 'src/config.ts' }, suggestions: [localized('demo.perm.allowEdits')] },
  { toolName: 'WebFetch', ...generatedSummary(localized('perm.web.fetch', { host: 'docs.stripe.com' })), input: { url: 'https://docs.stripe.com/api' }, suggestions: [allowRule('WebFetch(docs.stripe.com)')] },
  { toolName: 'Bash', summary: 'git push origin feat/cupom', input: { command: 'git push origin feat/cupom' }, suggestions: [] },
];

export const DEMO_QUESTION: DemoText = localized('waiting.answerQuestion');

export const DEMO_BRANCHES: readonly string[] = ['main', 'feat/cupom', 'fix/frete', 'feat/perfil', 'chore/deps'];
export const DEMO_MODELS: readonly string[] = ['claude-opus-5-5', 'claude-sonnet-5-5'];
