import { type AppContext } from '../context';
import { Popover } from './overlay';
export declare class Settings extends Popover {
    private readonly visual;
    private readonly daylight;
    private readonly names;
    private readonly bubbles;
    private readonly animation;
    private readonly sounds;
    private readonly volume;
    private readonly browser;
    private readonly demo;
    private readonly visualRow;
    private readonly soundRow;
    private readonly browserRow;
    private readonly demoRow;
    private readonly about;
    private busy;
    constructor(ctx: AppContext);
    protected onOpen(): void;
    protected update(): void;
    private toggleBrowser;
    private toggleDemo;
}
