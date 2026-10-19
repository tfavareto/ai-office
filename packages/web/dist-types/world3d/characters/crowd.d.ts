import { Group, Vector3 } from 'three';
import type { OfficeSim } from '../../sim/sim';
import { Character3D } from './character3d';
import type { HumanLibrary } from './humanLibrary';
export interface CrowdFrame {
    time: number;
    dt: number;
    accountColor: (accountId: string) => string;
    selectedId: string | null;
    hoveredId: string | null;
    /** Show eyes and eyebrows (close-up views). */
    detail: boolean;
    still: boolean;
}
export declare class Crowd {
    private readonly library;
    private readonly sim;
    readonly group: Group<import("three").Object3DEventMap>;
    private readonly people;
    private rings;
    private readonly ringMaterial;
    private readonly tmpColor;
    private readonly tmpMatrix;
    constructor(library: HumanLibrary, sim: OfficeSim);
    private makeRings;
    get size(): number;
    sync(): void;
    update(f: CrowdFrame): void;
    /** One instanced mesh draws every account-colour ring at the people's feet. */
    private updateRings;
    get(id: string): Character3D | undefined;
    headTop(id: string, out: Vector3): Vector3 | null;
    dispose(): void;
}
