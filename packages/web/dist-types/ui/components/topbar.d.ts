import type { AppContext, Component } from '../context';
export declare class TopBar implements Component {
    private readonly ctx;
    readonly el: HTMLElement;
    private readonly pill;
    private readonly pillText;
    private readonly counters;
    private readonly usage;
    private readonly sidebarBtn;
    private readonly cameraBtn;
    private readonly cameraLabel;
    private readonly feedBtn;
    private readonly bellBtn;
    private readonly bellBadge;
    private readonly popoverButtons;
    private readonly dayBtn;
    private readonly helpBtn;
    constructor(ctx: AppContext);
    private brand;
    private popoverButton;
    private createCounter;
    private cycleCamera;
    render(): void;
    private renderPill;
    private renderCounters;
    private renderButtons;
}
