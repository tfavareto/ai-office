import type { AppContext } from '../context';
import { Popover } from './overlay';
export declare class NotificationCenter extends Popover {
    private filter;
    private readonly list;
    private readonly tabs;
    private readonly dndBtn;
    private readonly clearBtn;
    private signature;
    constructor(ctx: AppContext);
    private setFilter;
    private toggleDnd;
    protected onOpen(): void;
    protected update(): void;
    private emptyText;
    private item;
}
