import type { HoverInfo } from '../../world/api';
import type { AppContext, Component } from '../context';
export declare class HoverTip implements Component {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly title;
    private readonly line;
    private readonly extra;
    private hover;
    constructor(ctx: AppContext);
    /** Called by the world on pointer movement; updates immediately, outside the main render pass. */
    setHover(hover: HoverInfo | null): void;
    render(): void;
}
