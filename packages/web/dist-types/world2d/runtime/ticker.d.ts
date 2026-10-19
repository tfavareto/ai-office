export declare const TICKER_H = 7;
export interface TickerStrip {
    canvas: HTMLCanvasElement;
    text: string;
    /** Pixel width of one repetition (text + gap). */
    period: number;
}
/** Pre-render the LED ticker text once per change; scrolling is a cheap offset at draw time. */
export declare function renderTicker(text: string): TickerStrip;
export declare function tickerText(rooms: number, agents: number, working: number, waiting: number, shells: number): string;
