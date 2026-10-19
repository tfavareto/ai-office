/** Strip diacritics and upper-case a string for the 3x5 font. */
export declare function foldText(text: string): string;
export declare const GLYPH_W = 3;
export declare const GLYPH_H = 5;
/** Width in px of `text` at scale 1 (3 px per glyph + 1 px gap). */
export declare function textWidth(text: string): number;
type Painter = {
    fillStyle: string | CanvasGradient | CanvasPattern;
    fillRect(x: number, y: number, w: number, h: number): void;
};
/** Draw `text` with its top-left at (x, y). */
export declare function drawPixelText(ctx: Painter, text: string, x: number, y: number, color: string, scale?: number): void;
export {};
