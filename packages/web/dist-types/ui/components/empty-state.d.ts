import { type AppContext, type Component } from '../context';
export declare class EmptyState implements Component {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly demoBtn;
    private busy;
    constructor(ctx: AppContext);
    private enableDemo;
    render(): void;
}
