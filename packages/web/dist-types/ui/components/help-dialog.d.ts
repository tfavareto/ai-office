import type { AppContext } from '../context';
import { Dialog } from './overlay';
export declare class HelpDialog extends Dialog {
    constructor(ctx: AppContext);
    protected onOpen(): void;
    protected update(): void;
}
