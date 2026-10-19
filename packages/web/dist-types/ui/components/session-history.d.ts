import { type AppContext } from '../context';
import { Popover } from './overlay';
export declare class SessionHistory extends Popover {
    private readonly input;
    private readonly body;
    private sessions;
    private state;
    private error;
    private signature;
    constructor(ctx: AppContext);
    focusTarget(): HTMLElement;
    protected onOpen(): void;
    private load;
    protected update(): void;
    private row;
}
