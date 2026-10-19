import type { Catalogs } from '@ai-office/shared';
import { worldEn } from './en';
import { worldEs } from './es';
import { worldPtBR } from './pt-BR';

export type { WorldKey } from './pt-BR';
export const WORLD_CATALOGS: Catalogs = { 'pt-BR': worldPtBR, en: worldEn, es: worldEs };
