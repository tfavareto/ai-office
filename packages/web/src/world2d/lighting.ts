import type { DaylightMode } from '../world/api';
import { clamp } from '../layout/rng';

/** Night amount (0 = bright day, 1 = full night) for a local hour in [0, 24). */
export function nightFromHour(hour: number): number {
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  if (hour >= 19.5 || hour < 5.5) return 1;
  if (hour >= 17.5) return smooth((hour - 17.5) / 2);
  if (hour < 7.5) return 1 - smooth((hour - 5.5) / 2);
  return 0;
}

export function localHour(date = new Date()): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** Smoothly eases the night amount toward the target of the daylight mode. */
export class DayNight {
  night = 0;
  private mode: DaylightMode = 'auto';
  private initialised = false;
  private clock: number | null = null;

  /** Makes "auto" follow an instant of a replay instead of the real time; `null` goes back to the real clock. */
  setClock(at: number | null): void {
    this.clock = at;
  }

  private now(): Date {
    return this.clock === null ? new Date() : new Date(this.clock);
  }

  setMode(mode: DaylightMode): void {
    this.mode = mode;
  }

  target(date = this.now()): number {
    if (this.mode === 'day') return 0;
    if (this.mode === 'night') return 1;
    return nightFromHour(localHour(date));
  }

  update(dt: number, date = this.now()): void {
    const target = this.target(date);
    if (!this.initialised) {
      this.night = target;
      this.initialised = true;
      return;
    }
    const k = 1 - Math.exp(-dt * 1.6);
    this.night = clamp(this.night + (target - this.night) * k, 0, 1);
    if (Math.abs(this.night - target) < 0.002) this.night = target;
  }
}

export interface NightColors {
  exterior: string;
  /** Multiply colour of a room with nobody in it, and of a lit one. */
  dark: string;
  lit: string;
}

export const NIGHT_COLORS: NightColors = { exterior: '#27345f', dark: '#3a4670', lit: '#d9bf9c' };

/** Sky gradient stops for the window panes at the given night amount. */
export function skyColors(night: number): [string, string] {
  const mixc = (a: [number, number, number], b: [number, number, number], t: number): string =>
    `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  return [mixc([128, 190, 235], [10, 18, 44], night), mixc([205, 230, 245], [34, 46, 86], night)];
}
