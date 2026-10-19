import type { Account, Agent } from '@ai-office/shared';
import { type IconName } from './icons';
import type { DisplayStatus } from './model/status';
export interface IconButtonOptions {
    icon: IconName;
    label: string;
    onClick: (event: MouseEvent) => void;
    className?: string;
    size?: number;
    pressed?: boolean;
}
export declare function iconButton(opts: IconButtonOptions): HTMLButtonElement;
export declare function setPressed(button: HTMLElement, pressed: boolean): void;
export interface ButtonOptions {
    label: string;
    onClick: (event: MouseEvent) => void;
    icon?: IconName;
    variant?: 'primary' | 'soft' | 'ghost' | 'danger';
    title?: string;
    className?: string;
}
export declare function button(opts: ButtonOptions): HTMLButtonElement;
/** Enables/disables a control and explains why through its tooltip (falling back to its normal tooltip). */
export declare function setDisabled(el: HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement, disabled: boolean, reason?: string): void;
export declare function statusDot(status: DisplayStatus): HTMLSpanElement;
export declare function setStatusDot(dot: HTMLElement, status: DisplayStatus): void;
export declare function accountChip(account: Account | undefined, withLabel?: boolean): HTMLSpanElement;
export declare function updateAccountChip(chip: HTMLElement, account: Account | undefined, withLabel?: boolean): void;
export interface Avatar {
    el: HTMLElement;
    update(agent: Pick<Agent, 'id' | 'name' | 'seed'>, portrait: string | null): void;
}
export declare function createAvatar(size: number): Avatar;
/** ago: "há 3 min" · elapsed: stopwatch since · duration: "3 min" since · until: countdown to the timestamp. */
export type LiveKind = 'ago' | 'elapsed' | 'duration' | 'until';
/** A text node that the clock keeps fresh without re-rendering. */
export declare function liveText(kind: LiveKind, since: number, className?: string): HTMLSpanElement;
export declare function setLive(el: HTMLElement, kind: LiveKind, since: number): void;
export declare function tickLive(root: ParentNode, now: number): void;
export interface Segmented<T extends string> {
    el: HTMLElement;
    set(value: T): void;
}
export declare function createSegmented<T extends string>(label: string, options: readonly {
    value: T;
    label: string;
}[], onChange: (value: T) => void): Segmented<T>;
export interface Switch {
    el: HTMLButtonElement;
    set(on: boolean): void;
}
export declare function createSwitch(label: string, onChange: (on: boolean) => void): Switch;
export declare function emptyNote(text: string, className?: string): HTMLElement;
export declare function sectionTitle(text: string, trailing?: Node | null): HTMLElement;
