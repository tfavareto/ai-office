import { type WebGLRenderer } from 'three';
import type { HumanLibrary } from './humanLibrary';
export declare class PortraitRenderer {
    private readonly renderer;
    private readonly library;
    private readonly cache;
    private readonly scene;
    private readonly camera;
    constructor(renderer: WebGLRenderer, library: HumanLibrary);
    portrait(agentKey: string, look: 'f' | 'm', seed: number, size: number): string;
    private render;
}
