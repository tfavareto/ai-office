import type { AppContext, Component } from '../context';
import type { DialogId, PopoverId } from '../state';
export declare abstract class Popover implements Component {
    protected readonly ctx: AppContext;
    private readonly id;
    readonly el: HTMLElement;
    private wasOpen;
    constructor(ctx: AppContext, id: PopoverId, label: string, className?: string);
    /** Called when the popover opens (fetch data, reset fields). */
    protected abstract onOpen(): void;
    /** Called on every render pass while open; must be cheap when nothing changed. */
    protected abstract update(): void;
    focusTarget(): HTMLElement;
    render(): void;
    /** Aligns the popover under its trigger button (read once, when opening). */
    private anchor;
}
export declare abstract class Dialog implements Component {
    protected readonly ctx: AppContext;
    private readonly id;
    protected readonly titleId: string;
    readonly el: HTMLElement;
    protected readonly panel: HTMLElement;
    private wasOpen;
    private returnFocus;
    constructor(ctx: AppContext, id: DialogId, titleId: string, className?: string);
    protected abstract onOpen(): void;
    protected abstract update(): void;
    render(): void;
    private trapFocus;
}
export declare function closeButton(label: string, onClick: () => void): HTMLButtonElement;
