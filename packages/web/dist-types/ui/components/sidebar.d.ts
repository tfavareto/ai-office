import type { AppContext, Component } from '../context';
export declare class Sidebar implements Component {
    private readonly ctx;
    readonly el: HTMLElement;
    private readonly input;
    private readonly clearBtn;
    private readonly chips;
    private readonly list;
    private readonly note;
    private readonly rooms;
    private signature;
    private chipSignature;
    constructor(ctx: AppContext);
    focusSearch(): void;
    private setQuery;
    private onListKey;
    render(): void;
    private renderChips;
    private createRoom;
    private createRow;
    private mainRole;
    private activityText;
}
