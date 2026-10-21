// Friendly Brazilian first names for agents. The look ('f' | 'm') comes with the name.
import { fnv1a } from './hash';

export interface PersonName {
  name: string;
  look: 'f' | 'm';
}

const FEMALE = [
  'Ana',
  'Beatriz',
  'Camila',
  'Carolina',
  'Daniela',
  'Eduarda',
  'Fernanda',
  'Gabriela',
  'Helena',
  'Isabela',
  'Juliana',
  'Larissa',
  'Letícia',
  'Luiza',
  'Mariana',
  'Natália',
  'Patrícia',
  'Rafaela',
  'Renata',
  'Sofia',
  'Tatiana',
  'Vanessa',
  'Yasmin',
  'Amanda',
  'Bianca',
  'Cecília',
  'Débora',
  'Elisa',
  'Flávia',
  'Giovana',
  'Heloísa',
  'Ingrid',
  'Jéssica',
  'Karina',
  'Lívia',
  'Manuela',
  'Nicole',
  'Olívia',
  'Paula',
  'Raquel',
  'Sabrina',
  'Talita',
  'Valentina',
  'Aline',
  'Bruna',
  'Clara',
  'Diana',
  'Emília',
  'Fabiana',
  'Gisele',
  'Íris',
  'Joana',
  'Kelly',
  'Lara',
  'Márcia',
  'Nádia',
  'Priscila',
  'Roberta',
  'Simone',
  'Úrsula',
] as const;

const MALE = [
  'Bruno',
  'Carlos',
  'Daniel',
  'Eduardo',
  'Felipe',
  'Gabriel',
  'Gustavo',
  'Henrique',
  'Igor',
  'João',
  'Lucas',
  'Marcelo',
  'Nicolas',
  'Otávio',
  'Pedro',
  'Rafael',
  'Rodrigo',
  'Thiago',
  'Vinícius',
  'André',
  'Caio',
  'Diego',
  'Enzo',
  'Fábio',
  'Guilherme',
  'Hugo',
  'Ivan',
  'Jorge',
  'Leonardo',
  'Mateus',
  'Natan',
  'Paulo',
  'Ricardo',
  'Samuel',
  'Tiago',
  'Victor',
  'Wagner',
  'Alexandre',
  'Breno',
  'Cauã',
  'Davi',
  'Erick',
  'Fernando',
  'Gael',
  'Heitor',
  'Isaac',
  'Júlio',
  'Kaique',
  'Leandro',
  'Murilo',
  'Nelson',
  'Osvaldo',
  'Patrick',
  'Renan',
  'Sérgio',
  'Theo',
  'Ulisses',
  'Vitor',
  'Yuri',
  'Zeca',
] as const;

/** All names, interleaved f/m so neighbouring picks alternate looks. */
export const NAMES: readonly PersonName[] = FEMALE.flatMap((name, i): PersonName[] => [
  { name, look: 'f' },
  { name: MALE[i] as string, look: 'm' },
]);

const BY_NAME = new Map(NAMES.map((entry) => [entry.name, entry]));

/** Looks a name up in the table (used to recover the look of a persisted name). */
export function findPerson(name: string): PersonName | undefined {
  return BY_NAME.get(name);
}

/**
 * Deterministic pick: hashes `key`, then walks forward until a name that is not in `taken` is found.
 * When every name is taken, a numeric suffix keeps names unique ("Ana 2").
 */
export function pickName(key: string, taken: ReadonlySet<string>): PersonName {
  const start = fnv1a(key) % NAMES.length;
  for (let step = 0; step < NAMES.length; step++) {
    const candidate = NAMES[(start + step) % NAMES.length] as PersonName;
    if (!taken.has(candidate.name)) return candidate;
  }
  const base = NAMES[start] as PersonName;
  for (let n = 2; ; n++) {
    const name = `${base.name} ${n}`;
    if (!taken.has(name)) return { name, look: base.look };
  }
}
