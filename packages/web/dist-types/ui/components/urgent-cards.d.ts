import type { Agent, PermissionRequest } from '@ai-office/shared';
import type { AppContext } from '../context';
export declare class PermissionCard {
    private readonly ctx;
    readonly el: HTMLElement;
    private readonly tool;
    private readonly summary;
    private readonly expires;
    private readonly details;
    private readonly detailsBtn;
    private readonly actions;
    private readonly rememberBox;
    private readonly denyBox;
    private readonly reason;
    private readonly interrupt;
    private readonly status;
    private allowBtn;
    private denyBtn;
    private terminalBtn;
    private requestId;
    private agent;
    private busy;
    constructor(ctx: AppContext);
    update(agent: Agent, permission: PermissionRequest): void;
    private buildRemember;
    private syncDisabled;
    private toggleDetails;
    private toggleDeny;
    private deny;
    private answerInTerminal;
    private decide;
    private showStatus;
}
export declare class WaitingCard {
    readonly el: HTMLElement;
    private readonly text;
    private readonly since;
    private agent;
    constructor(ctx: AppContext);
    update(agent: Agent): void;
}
export declare class ShellCard {
    private readonly ctx;
    readonly el: HTMLElement;
    private readonly list;
    private signature;
    constructor(ctx: AppContext);
    update(agent: Agent): void;
}
