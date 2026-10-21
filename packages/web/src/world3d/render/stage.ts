// Renderer, scene lighting, shadows, environment map and the night-only bloom composer.
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Material,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  Vector2,
  type Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { daylight, usesBloom, type Rgb } from './daylight';

const SUN_DIRECTION = new Vector3(-0.38, 0.74, 0.55).normalize();
const SHADOW_SIZE = 2048;
export const POOL_LIGHTS = 2;

const toColor = (rgb: Rgb, out: Color): Color => out.setRGB(rgb[0], rgb[1], rgb[2]);

export interface PoolLight {
  light: PointLight;
  /** Current and goal intensity (eased). */
  level: number;
  goal: number;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly sun = new DirectionalLight('#fff3dc', 3);
  readonly hemi = new HemisphereLight('#cfe3ff', '#9a8c78', 1);
  readonly pool: PoolLight[] = [];
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly env: PMREMGenerator;
  private readonly tmpColor = new Color();
  private pixelRatio = 1;
  private width = 1;
  private height = 1;
  private night = 0;
  private shadowFlip = false;
  private bloomOn = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    glcheck: boolean,
    antialias = true,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', alpha: false });
    this.renderer.debug.checkShaderErrors = glcheck;
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.fog = new FogExp2('#b8d4ee', 0.004);
    this.scene.background = new Color('#b8d4ee');
    this.env = new PMREMGenerator(this.renderer);
    this.scene.environment = this.env.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    for (let i = 0; i < POOL_LIGHTS; i++) {
      const light = new PointLight('#ffb866', 0, 11, 1.6);
      light.castShadow = false;
      this.scene.add(light);
      this.pool.push({ light, level: 0, goal: 0 });
    }
    this.setNight(0);
  }

  setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.resize(this.width, this.height);
  }

  get ratio(): number {
    return this.pixelRatio;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(this.pixelRatio);
    this.composer?.setSize(width, height);
  }

  /** Lights and colours for a night amount. */
  setNight(night: number): void {
    this.night = night;
    const d = daylight(night);
    toColor(d.sunColor, this.sun.color);
    this.sun.intensity = d.sunIntensity;
    toColor(d.hemiSky, this.hemi.color);
    toColor(d.hemiGround, this.hemi.groundColor);
    this.hemi.intensity = d.hemiIntensity;
    this.scene.environmentIntensity = d.envIntensity;
    this.renderer.toneMappingExposure = d.exposure;
    toColor(d.fog, this.tmpColor);
    (this.scene.fog as FogExp2).color.copy(this.tmpColor);
    (this.scene.fog as FogExp2).density = d.fogDensity;
    (this.scene.background as Color).copy(this.tmpColor);
    if (this.bloom) this.bloom.strength = d.bloomStrength;
    this.bloomOn = usesBloom(night);
  }

  get glow(): number {
    return daylight(this.night).glow;
  }

  /** Aims the sun and fits its shadow camera around a box (the office floor). */
  fitSun(box: Box3): void {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = size.length() / 2;
    this.sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius + 20);
    this.sun.target.position.copy(center);
    this.sun.updateMatrixWorld(true);
    this.sun.target.updateMatrixWorld(true);
    const cam = this.sun.shadow.camera;
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const inView = new Box3();
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z])
          inView.expandByPoint(new Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse));
    cam.left = inView.min.x - 1;
    cam.right = inView.max.x + 1;
    cam.bottom = inView.min.y - 1;
    cam.top = inView.max.y + 1;
    cam.near = Math.max(0.5, -inView.max.z - 10);
    cam.far = -inView.min.z + 10;
    cam.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Eases pool lights towards their goals; call once per frame. The lights are either all in the shader or none (a
   * changing light count would recompile every material), so they switch on only while the glow is active.
   */
  updatePool(dt: number): void {
    const k = 1 - Math.exp(-dt * 4);
    const on = this.glow > 0.02;
    for (const p of this.pool) {
      p.level += (p.goal - p.level) * k;
      p.light.intensity = p.level;
      p.light.visible = on;
    }
  }

  private ensureComposer(camera: Camera): EffectComposer {
    if (this.composer) return this.composer;
    const target = new WebGLRenderTarget(this.width * this.pixelRatio, this.height * this.pixelRatio, {
      type: HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    composer.addPass(new RenderPass(this.scene, camera));
    this.bloom = new UnrealBloomPass(
      new Vector2(this.width, this.height),
      daylight(this.night).bloomStrength,
      0.55,
      0.82,
    );
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    return composer;
  }

  /** Renders one frame; the shadow map is refreshed every other frame. */
  render(camera: PerspectiveCamera | OrthographicCamera, refreshShadows: boolean): void {
    this.renderer.info.reset();
    this.shadowFlip = !this.shadowFlip;
    if (refreshShadows && this.shadowFlip) this.renderer.shadowMap.needsUpdate = true;
    if (this.bloomOn) {
      const composer = this.ensureComposer(camera);
      (composer.passes[0] as RenderPass).camera = camera;
      composer.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  /**
   * Compiles every shader variant used by day, dusk and night (light count x render target) with parallel compilation,
   * so switching never stalls the main thread.
   */
  async warmPrograms(camera: Camera): Promise<void> {
    const composer = this.ensureComposer(camera);
    const previous = this.renderer.getRenderTarget();
    const variants: [boolean, boolean][] = [
      [false, false],
      [true, false],
      [true, true],
    ];
    for (const [lights, toTarget] of variants) {
      for (const p of this.pool) p.light.visible = lights;
      this.renderer.setRenderTarget(toTarget ? composer.readBuffer : null);
      await this.renderer.compileAsync(this.scene, camera);
    }
    const scene = new Scene();
    const quad = new PlaneGeometry(2, 2);
    const keep: Material[] = [];
    const collect = (value: unknown): void => {
      if (value instanceof Material) keep.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
    };
    for (const pass of composer.passes) for (const value of Object.values(pass)) collect(value);
    for (const material of keep) scene.add(new Mesh(quad, material));
    this.renderer.setRenderTarget(composer.readBuffer);
    await this.renderer.compileAsync(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
    this.renderer.setRenderTarget(previous);
    quad.dispose();
    for (const p of this.pool) p.light.visible = false;
  }

  /** Uploads textures to the GPU a couple at a time (yielding in between) instead of all inside the first frame. */
  async uploadTextures(textures: Iterable<Texture>): Promise<void> {
    let n = 0;
    for (const tex of textures) {
      this.renderer.initTexture(tex);
      if (++n % 2 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** Forces the program uniform/attribute lookups of every compiled material (normally done in the first draw). */
  async initPrograms(materials: Iterable<Material>): Promise<void> {
    let n = 0;
    for (const m of materials) {
      const program = (
        this.renderer.properties.get(m) as { currentProgram?: { getUniforms(): unknown; getAttributes(): unknown } }
      ).currentProgram;
      if (!program) continue;
      program.getUniforms();
      program.getAttributes();
      if (++n % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  dispose(): void {
    this.composer?.dispose();
    this.env.dispose();
    this.renderer.dispose();
  }
}
