// What the share card is made of: the options the dialog offers, the numbers it can show and the model the renderer
// draws. Everything here is plain data, so it can be built and tested without a canvas.
import type { WorldKind } from '../world/load';
import type { CaptureMode } from '../world/capture';

export type CardFormat = 'landscape' | 'square';
export type CardTheme = 'dark' | 'light';

/** Pixel size of each format: the sizes LinkedIn and X show without cropping. */
export const CARD_SIZES: Readonly<Record<CardFormat, { width: number; height: number }>> = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
};

export interface ShareOptions {
  format: CardFormat;
  theme: CardTheme;
  /** Real project names on the room signs and in the highlight line. Off by default (privacy). */
  showProjectNames: boolean;
  /** Tokens and estimated cost as headline numbers. Off by default. */
  showUsage: boolean;
  /** Renderer that draws the office in the picture. */
  visual: WorldKind;
  /** Whole building, or what the camera shows now. */
  framing: CaptureMode;
}

export const DEFAULT_SHARE_OPTIONS: Omit<ShareOptions, 'visual'> = {
  format: 'landscape',
  theme: 'dark',
  showProjectNames: false,
  showUsage: false,
  framing: 'overview',
};

export type StatId = 'agents' | 'time' | 'tasks' | 'commits' | 'tests' | 'files' | 'tokens' | 'cost';

/** Which accent colour of the theme a headline number uses. */
export type StatTone = 'blue' | 'green' | 'amber' | 'cyan' | 'violet';

export interface CardStat {
  id: StatId;
  /** Already formatted for the language ("23", "6 h 12 min", "US$ 4,20"). */
  value: string;
  label: string;
  tone: StatTone;
}

/** Everything the card says, in the language of the page. */
export interface CardModel {
  /** Line over the picture: "Meu escritório hoje". */
  title: string;
  /** The day, written out ("25 de outubro de 2026"). */
  date: string;
  brand: string;
  stats: readonly CardStat[];
  /** One short sentence about the day; null draws nothing. */
  highlight: string | null;
  url: string;
  tag: string;
}

export const REPO_URL = 'github.com/tfavareto/ai-office';
