import type { ExteriorLayout } from '../../layout/exterior';
export declare const CAR_COLORS: string[];
export interface CarDraw {
    sprite: HTMLCanvasElement;
    x: number;
    y: number;
    /** Headlight position and direction for the night glow. */
    light: {
        x: number;
        y: number;
        dx: number;
        dy: number;
    };
}
export declare function carSprite(color: string, horizontal: boolean, forward: boolean): HTMLCanvasElement;
/** Cars looping along the street lanes. Positions are a pure function of time, so they are deterministic. */
export declare class Traffic {
    private cars;
    rebuild(layout: ExteriorLayout): void;
    /** Visible cars at time `t` seconds. */
    draw(t: number, out: CarDraw[]): void;
}
