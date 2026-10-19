import { Box3, DirectionalLight, HemisphereLight, PerspectiveCamera, Material, OrthographicCamera, PointLight, Scene, type Texture, WebGLRenderer, type Camera } from 'three';
export declare const POOL_LIGHTS = 2;
export interface PoolLight {
    light: PointLight;
    /** Current and goal intensity (eased). */
    level: number;
    goal: number;
}
export declare class Stage {
    readonly canvas: HTMLCanvasElement;
    readonly renderer: WebGLRenderer;
    readonly scene: Scene<import("three").Object3DEventMap>;
    readonly sun: DirectionalLight;
    readonly hemi: HemisphereLight;
    readonly pool: PoolLight[];
    private composer;
    private bloom;
    private readonly env;
    private readonly tmpColor;
    private pixelRatio;
    private width;
    private height;
    private night;
    private shadowFlip;
    private bloomOn;
    constructor(canvas: HTMLCanvasElement, glcheck: boolean, antialias?: boolean);
    setPixelRatio(ratio: number): void;
    get ratio(): number;
    resize(width: number, height: number): void;
    /** Lights and colours for a night amount. */
    setNight(night: number): void;
    get glow(): number;
    /** Aims the sun and fits its shadow camera around a box (the office floor). */
    fitSun(box: Box3): void;
    /**
     * Eases pool lights towards their goals; call once per frame. The lights are either all in the shader or none (a
     * changing light count would recompile every material), so they switch on only while the glow is active.
     */
    updatePool(dt: number): void;
    private ensureComposer;
    /** Renders one frame; the shadow map is refreshed every other frame. */
    render(camera: PerspectiveCamera | OrthographicCamera, refreshShadows: boolean): void;
    /**
     * Compiles every shader variant used by day, dusk and night (light count x render target) with parallel compilation,
     * so switching never stalls the main thread.
     */
    warmPrograms(camera: Camera): Promise<void>;
    /** Uploads textures to the GPU a couple at a time (yielding in between) instead of all inside the first frame. */
    uploadTextures(textures: Iterable<Texture>): Promise<void>;
    /** Forces the program uniform/attribute lookups of every compiled material (normally done in the first draw). */
    initPrograms(materials: Iterable<Material>): Promise<void>;
    dispose(): void;
}
