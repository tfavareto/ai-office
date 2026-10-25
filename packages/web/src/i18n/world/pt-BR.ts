// pt-BR world texts (source catalog). en.ts and es.ts must define exactly the same keys — the types enforce it.
// The 2D world draws some of them with a 3x5 pixel font that folds accents and upper-cases, so write them as normal
// sentences here (see `world2d/font.ts`). Brand ("AI Office"), project names and agent names are never translated.
export const worldPtBR = {
  // area names (room pills)
  'area.reception': 'Recepção',
  'area.copa': 'Copa',
  'area.meeting': 'Sala de reunião',
  'area.bathrooms': 'Banheiros',
  'area.lounge': 'Lounge',
  // generic name of a project room in a shared picture (the real project name is hidden)
  'room.generic': 'Sala {n}',
  // accessible names of the canvases
  'world.aria2d': 'Escritório',
  'world.aria3d': 'Escritório 3D',
  // counters (room pill, board, ticker)
  'count.rooms': '{n, plural, =0 {# salas} one {# sala} other {# salas}}',
  'count.agents': '{n, plural, =0 {# agentes} one {# agente} other {# agentes}}',
  'count.needsYou': '{n, plural, one {# precisa de você} other {# precisam de você}}',
  // speech bubbles made by the simulation itself
  'bubble.done': 'Terminei!',
  'bubble.needsYou': 'Precisa de você',
  'bubble.arrived': 'Cheguei!',
  'bubble.celebrate.tests': 'Testes passando!',
  'bubble.celebrate.tasks': 'Tudo pronto!',
  'bubble.celebrate.commit': 'Commitado!',
  'bubble.celebrate.merged': 'Merge feito!',
  'bubble.celebrate.sub': 'Missão cumprida!',
  'bubble.celebrate.streak': 'Sessão concluída!',
  'bubble.celebrate.room': 'Sala toda em dia!',
  // room boards (2D pixel board and 3D board texture); the `.short` forms fit the narrow 2D board (9 letters)
  'board.waiting': 'Aguardando você',
  'board.waiting.short': 'Aguarda',
  'board.working': 'Trabalhando',
  'board.working.short': 'Ativo',
  'board.idle': 'Ocioso',
  'board.empty': 'Sala vazia',
  'board.empty.short': 'Vazia',
  'board.inProgress': 'Em andamento',
  'board.tasks': '{done}/{total} tarefas',
  'board.noTasks': 'sem tarefas',
  // meeting-room TV
  'meeting.inRoom': 'Na sala {n}',
  'meeting.inRoom3d': 'Na sala · {n}',
  'meeting.free': 'Sala livre',
  // meeting-room whiteboard: the task board
  'taskboard.title': 'Quadro de tarefas',
  'taskboard.pending': 'Pendente',
  'taskboard.active': 'Em andamento',
  'taskboard.done': 'Concluído',
  'taskboard.empty': 'Sem tarefas',
  'taskboard.empty.short': 'Vazio',
  // LED ticker (corridor, 2D and 3D)
  'ticker.working': '{n} trabalhando',
  'ticker.shells': '{n, plural, one {# shell rodando} other {# shells rodando}}',
  'ticker.allGood': 'Tudo em ordem',
  'ticker.coffee': 'Café fresco na copa',
  // pantry menu: 2D pixel board and 3D chalkboard
  'menu2d.title': 'Cardápio',
  'menu2d.coffee': 'Café',
  'menu2d.juice': 'Suco',
  'menu2d.coffeePrice': '3,00',
  'menu2d.juicePrice': '5,00',
  'menu3d.title': 'Café da copa',
  'menu3d.espresso': 'Espresso',
  'menu3d.cappuccino': 'Cappuccino',
  'menu3d.cheeseBread': 'Pão de queijo',
  'menu3d.orangeJuice': 'Suco de laranja',
  'menu3d.sparkling': 'Água com gás',
  'menu3d.price': 'R$ {price}',
  // 3D workstation monitor of a waiting agent
  'desk.waiting': 'Aguarda',
  // 3D overlay
  'overlay.sub': 'SUB',
  'overlay.openAgent': 'E · abrir {name}',
  'overlay.arriving': 'chegando…',
  // branch plaque under a room's sign (3D): the operation a repository is in the middle of
  'git.op.merge': 'Merge',
  'git.op.rebase': 'Rebase',
  'git.op.cherry-pick': 'Cherry-pick',
  'git.op.revert': 'Reversão',
  'git.op.bisect': 'Bisect',
} as const;

export type WorldKey = keyof typeof worldPtBR;
