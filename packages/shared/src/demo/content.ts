// Scripted pt-BR content used by the demo simulator: projects, prompts, files, commands, permission requests.
import type { Account } from '../model';
import { accountColor } from '../colors';

export interface DemoProjectSpec {
  name: string;
  path: string;
  files: readonly string[];
  prompts: readonly string[];
}

const ROOT = '/Users/demo/projetos';

function project(name: string, files: readonly string[], prompts: readonly string[]): DemoProjectSpec {
  return { name, path: `${ROOT}/${name}`, files: files.map((file) => `${ROOT}/${name}/${file}`), prompts };
}

export const DEMO_PROJECTS: readonly DemoProjectSpec[] = [
  project('loja-online', ['src/carrinho/Carrinho.tsx', 'src/checkout/Pagamento.tsx', 'src/api/pedidos.ts', 'src/estoque/estoque.ts', 'package.json', 'src/tema.css'], [
    'Adicionar cupom de desconto no carrinho',
    'Corrigir o cálculo do frete para pedidos internacionais',
    'Migrar a tela de checkout para o novo design',
  ]),
  project('api-pagamentos', ['src/rotas/cobranca.ts', 'src/servicos/pix.ts', 'src/db/schema.sql', 'src/webhooks/gateway.ts', 'tests/cobranca.test.ts', 'README.md'], [
    'Implementar o webhook de confirmação de Pix',
    'Adicionar idempotência nas cobranças',
    'Escrever testes para o serviço de estorno',
  ]),
  project('app-mobile', ['src/telas/Inicio.tsx', 'src/telas/Perfil.tsx', 'src/navegacao/rotas.ts', 'src/hooks/useSessao.ts', 'app.json', 'src/componentes/Botao.tsx'], [
    'Criar a tela de perfil com edição de foto',
    'Reduzir o tempo de abertura do aplicativo',
    'Adicionar modo escuro nas telas principais',
  ]),
  project('painel-admin', ['src/paginas/Usuarios.vue', 'src/paginas/Relatorios.vue', 'src/store/sessao.ts', 'src/api/cliente.ts', 'vite.config.ts', 'src/estilos/base.css'], [
    'Adicionar exportação de relatórios em CSV',
    'Corrigir a paginação da lista de usuários',
    'Trocar a biblioteca de gráficos',
  ]),
  project('blog-pessoal', ['content/posts/ola-mundo.md', 'src/layouts/Post.astro', 'src/paginas/index.astro', 'astro.config.mjs', 'src/componentes/Cabecalho.astro', 'public/rss.xml'], [
    'Gerar o feed RSS automaticamente',
    'Melhorar as metatags para compartilhamento',
    'Criar a página de arquivo por ano',
  ]),
  project('pipeline-dados', ['dags/ingestao.py', 'dags/limpeza.py', 'src/transformacoes.py', 'tests/test_limpeza.py', 'pyproject.toml', 'docs/arquitetura.md'], [
    'Paralelizar a etapa de limpeza dos dados',
    'Adicionar validação de esquema na ingestão',
    'Documentar o fluxo de reprocessamento',
  ]),
  project('design-system', ['packages/ui/Botao.tsx', 'packages/ui/Modal.tsx', 'packages/tokens/cores.ts', 'docs/guia.mdx', 'packages/ui/Campo.tsx', 'package.json'], [
    'Criar o componente de tooltip acessível',
    'Padronizar os tokens de espaçamento',
    'Revisar o contraste das cores do tema escuro',
  ]),
  project('bot-atendimento', ['src/fluxos/saudacao.ts', 'src/fluxos/pedido.ts', 'src/nlp/intencoes.ts', 'src/canais/whatsapp.ts', 'tests/fluxos.test.ts', 'config/respostas.json'], [
    'Adicionar o fluxo de segunda via de boleto',
    'Melhorar o reconhecimento de intenções',
    'Registrar as conversas para auditoria',
  ]),
  project('infra-terraform', ['main.tf', 'modulos/rede/main.tf', 'modulos/banco/main.tf', 'variaveis.tf', 'ambientes/prod.tfvars', 'README.md'], [
    'Separar os ambientes de staging e produção',
    'Adicionar alertas de custo na conta',
    'Criar o módulo de banco com réplica de leitura',
  ]),
  project('landing-page', ['index.html', 'css/estilo.css', 'js/formulario.js', 'js/animacoes.js', 'imagens/hero.svg', 'sitemap.xml'], [
    'Otimizar as imagens para carregar mais rápido',
    'Adicionar o formulário de lista de espera',
    'Corrigir o layout em telas pequenas',
  ]),
  project('crm-vendas', ['src/negocios/funil.ts', 'src/contatos/lista.tsx', 'src/relatorios/metas.ts', 'src/api/rdstation.ts', 'prisma/schema.prisma', 'src/auth/sessao.ts'], [
    'Criar o funil visual de negociações',
    'Importar contatos de uma planilha',
    'Enviar lembretes de acompanhamento por e-mail',
  ]),
  project('jogo-puzzle', ['src/jogo/tabuleiro.ts', 'src/jogo/fases.json', 'src/ui/Menu.ts', 'src/audio/efeitos.ts', 'index.html', 'src/jogo/pontuacao.ts'], [
    'Adicionar dez novas fases ao jogo',
    'Corrigir o bug de peças que travam',
    'Salvar o progresso no armazenamento local',
  ]),
];

export const DEMO_ACCOUNTS: readonly Account[] = [
  { id: 'demo-pessoal', label: 'Pessoal', initial: 'P', color: accountColor(0), dir: '~/.claude' },
  { id: 'demo-trabalho', label: 'Trabalho', initial: 'T', color: accountColor(1), dir: '~/.claude-trabalho' },
];

export interface DemoCommand {
  command: string;
  description: string;
  /** Rough duration in ms (long commands become foreground shells). */
  durationMs: number;
}

export const DEMO_COMMANDS: readonly DemoCommand[] = [
  { command: 'npm test', description: 'Rodando os testes', durationMs: 16000 },
  { command: 'npm run build', description: 'Compilando o projeto', durationMs: 14000 },
  { command: 'npx tsc --noEmit', description: 'Checando os tipos', durationMs: 5000 },
  { command: 'git status --short', description: 'Vendo o que mudou', durationMs: 1200 },
  { command: 'npm run lint', description: 'Rodando o linter', durationMs: 4000 },
  { command: 'git diff --stat', description: 'Revisando as alterações', durationMs: 1500 },
  { command: 'ls -la src', description: 'Listando a pasta src', durationMs: 900 },
];

export const DEMO_LONG_SHELLS: readonly { command: string; label: string }[] = [
  { command: 'npm run dev', label: 'Servidor de desenvolvimento' },
  { command: 'npx vitest --watch', label: 'Testes em modo watch' },
  { command: 'docker compose up', label: 'Containers locais' },
];

export const DEMO_TASK_PLAN: readonly { title: string; activeForm: string }[] = [
  { title: 'Entender o código existente', activeForm: 'Lendo o código existente' },
  { title: 'Implementar a mudança', activeForm: 'Implementando a mudança' },
  { title: 'Escrever os testes', activeForm: 'Escrevendo os testes' },
  { title: 'Rodar a suíte completa', activeForm: 'Rodando a suíte completa' },
  { title: 'Revisar e finalizar', activeForm: 'Revisando e finalizando' },
];

export const DEMO_SUBAGENTS: readonly { type: string; description: string }[] = [
  { type: 'Explore', description: 'Mapear os módulos relacionados' },
  { type: 'general-purpose', description: 'Pesquisar a melhor abordagem' },
  { type: 'code-reviewer', description: 'Revisar as mudanças feitas' },
  { type: 'test-writer', description: 'Escrever testes de regressão' },
  { type: 'Explore', description: 'Procurar usos da função antiga' },
];

export const DEMO_SEARCHES: readonly string[] = ['useEffect', 'TODO', 'export default', 'async function', 'class .*Service', 'fetch\\('];

export const DEMO_WEB: readonly { url: string; query: string }[] = [
  { url: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Fetch_API', query: 'fetch api timeout' },
  { url: 'https://nodejs.org/docs/latest/api/fs.html', query: 'node fs watch' },
  { url: 'https://vitest.dev/guide/mocking', query: 'vitest mock modules' },
];

export const DEMO_MCP: readonly string[] = ['mcp__github__list_issues', 'mcp__postgres__query', 'mcp__figma__get_node', 'mcp__sentry__list_errors'];

export const DEMO_ERRORS: readonly { tool: string; detail: string }[] = [
  { tool: 'Bash', detail: 'npm test: 2 testes falharam (Carrinho.test.tsx)' },
  { tool: 'Bash', detail: 'npx tsc: Property "total" does not exist on type "Pedido"' },
  { tool: 'Edit', detail: 'A string a substituir não foi encontrada no arquivo' },
  { tool: 'Bash', detail: 'npm run build: Module not found: ./estilos' },
];

export interface DemoPermissionSpec {
  toolName: string;
  summary: string;
  input: Record<string, unknown>;
  suggestions: readonly string[];
}

export const DEMO_PERMISSIONS: readonly DemoPermissionSpec[] = [
  { toolName: 'Bash', summary: 'npm install zod', input: { command: 'npm install zod' }, suggestions: ['Sempre permitir Bash(npm install:*)'] },
  { toolName: 'Bash', summary: 'rm -rf dist', input: { command: 'rm -rf dist', description: 'Limpar a pasta de build' }, suggestions: ['Sempre permitir Bash(rm -rf dist)'] },
  { toolName: 'Edit', summary: 'Editar src/config.ts', input: { file_path: 'src/config.ts' }, suggestions: ['Permitir edições nesta sessão'] },
  { toolName: 'WebFetch', summary: 'Acessar docs.stripe.com', input: { url: 'https://docs.stripe.com/api' }, suggestions: ['Sempre permitir WebFetch(docs.stripe.com)'] },
  { toolName: 'Bash', summary: 'git push origin feat/cupom', input: { command: 'git push origin feat/cupom' }, suggestions: [] },
];

export const DEMO_QUESTION = 'Responder uma pergunta';

export const DEMO_BRANCHES: readonly string[] = ['main', 'feat/cupom', 'fix/frete', 'feat/perfil', 'chore/deps'];
export const DEMO_MODELS: readonly string[] = ['claude-opus-5-5', 'claude-sonnet-5-5'];
