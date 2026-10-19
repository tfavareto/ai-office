import { Group, RingGeometry, Vector3, type Material } from 'three';
import type { Character, SeatKind } from '../../sim/types';
import { type LookChoice } from './outfits';
import type { HumanLibrary } from './humanLibrary';
export declare const ringGeo: RingGeometry;
export interface PersonFrame {
    time: number;
    dt: number;
    accountColor: string;
    detail: boolean;
    selected: boolean;
    hovered: boolean;
    /** prefers-reduced-motion: no pulsing or bobbing. */
    still: boolean;
}
export declare class Character3D {
    readonly character: Character;
    readonly root: Group<import("three").Object3DEventMap>;
    readonly choice: LookChoice;
    private readonly instance;
    private readonly rig;
    private readonly current;
    private readonly target;
    private readonly selectRing;
    private readonly marker;
    private readonly cup;
    private readonly bucket;
    private readonly book;
    private yaw;
    /** Account colour of the ring drawn by the crowd's instanced ring mesh. */
    ringColor: string;
    ringVisible: boolean;
    private lastX;
    private lastZ;
    private initialised;
    private shownDetail;
    constructor(library: HumanLibrary, character: Character);
    private setDetail;
    update(c: Character, f: PersonFrame): void;
    private updateYaw;
    private updatePose;
    private frames;
    private firstFrame;
    private updateAccessories;
    /** Keeps a prop upright at a hand bone (props live on the root, not on the bone, to avoid bone roll). */
    private attach;
    /** World position of the top of the head (name tags, bubbles). */
    headTop(out: Vector3): Vector3;
    headWorld(out: Vector3): Vector3;
    /** Material swap hook used by the portrait renderer. */
    materials(): Material[];
    dispose(): void;
}
export declare function seatHeightOf(seat: SeatKind): number;
