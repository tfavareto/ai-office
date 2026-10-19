/** A pre-rendered label in CSS px (the canvas is dpr times larger). */
export interface Sprite {
    canvas: HTMLCanvasElement;
    w: number;
    h: number;
}
/** Caches text sprites (name tags, bubbles, labels) per device pixel ratio. */
export declare class OverlaySprites {
    private cache;
    dpr: number;
    setDpr(dpr: number): void;
    /** Returns the cached sprite for `key`, or builds it from `size()` and `draw`. Measuring only happens on a miss. */
    private cached;
    private make;
    nameTag(name: string, accent: string, status: string, kind: 'main' | 'sub', highlight: boolean): Sprite;
    bubble(text: string, icon: string, tone: 'normal' | 'alert' | 'good'): Sprite;
    /** Room pill that always fits in `maxWidth` CSS px: shortens the name, drops the detail, or shrinks to the dot. */
    roomLabel(name: string, detail: string, accent: string, maxWidth: number): Sprite;
    /** Round status badge: "!" for needs-you, "z" while napping. */
    badge(symbol: string, color: string): Sprite;
}
