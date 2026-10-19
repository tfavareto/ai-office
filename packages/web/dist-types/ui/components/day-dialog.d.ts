import type { AppContext } from '../context';
import { Dialog } from './overlay';
export declare class DayDialog extends Dialog {
    private readonly body;
    private readonly dateLabel;
    private readonly nextBtn;
    private date;
    private state;
    private view;
    private error;
    private token;
    private signature;
    constructor(ctx: AppContext);
    protected onOpen(): void;
    private shift;
    private load;
    protected update(): void;
    private totals;
    private legend;
    private bars;
}
