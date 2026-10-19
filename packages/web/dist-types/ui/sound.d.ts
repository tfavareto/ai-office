export type CueKind = 'alert' | 'info' | 'success' | 'sent';
export declare class SoundPlayer {
    private context;
    /** Call from a user gesture so later cues are allowed to play. */
    unlock(): void;
    private ensure;
    play(kind: CueKind, volume: number): void;
}
