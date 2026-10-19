import type { ActivityKind, AgentStatus } from '@ai-office/shared';
export type ScreenKind = 'off' | 'standby' | 'code' | 'term' | 'read' | 'web' | 'think' | 'wait' | 'idle';
export declare const SCREEN_W = 12;
export declare const SCREEN_H = 7;
export declare const SCREEN_FRAMES = 6;
export declare function screenSprite(kind: ScreenKind, frame: number): HTMLCanvasElement;
/** Content of the four monitors of a desk, from what its occupant is doing. */
export declare function desksScreens(status: AgentStatus | null, activity: ActivityKind | undefined, shell: boolean): ScreenKind[];
