import type { Catalogs } from '@ai-office/shared';
import { uiEn } from './en';
import { uiEs } from './es';
import { uiPtBR } from './pt-BR';

export type { UiKey } from './pt-BR';
export const UI_CATALOGS: Catalogs = { 'pt-BR': uiPtBR, en: uiEn, es: uiEs };
