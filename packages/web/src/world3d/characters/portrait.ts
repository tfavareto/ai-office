// Head-and-shoulders portraits for UI avatars: a standing copy of the agent's model rendered into a small target.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { Rig } from '../pose/rig';
import { createPose } from '../pose/poseVec';
import { solvePose } from '../pose/poses';
import { canvas2d } from '../scene/textures';
import type { HumanLibrary } from './humanLibrary';
import type { AgentLook } from '@ai-office/shared';
import { choiceKey, chooseLook, type LookChoice } from './outfits';
import { wearAccessory } from './accessories';

const FRAME_HEIGHT = 0.56;

export class PortraitRenderer {
  private readonly cache = new Map<string, string>();
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly library: HumanLibrary,
  ) {
    this.scene.add(new HemisphereLight('#ffffff', '#b9a48c', 1.7));
    const key = new DirectionalLight('#fff1dc', 2.4);
    key.position.set(1.2, 1.6, 2.4);
    this.scene.add(key);
    const rim = new DirectionalLight('#9fc2ff', 0.8);
    rim.position.set(-1.6, 1, -1);
    this.scene.add(rim);
  }

  portrait(agentKey: string, look: 'f' | 'm', seed: number, size: number, appearance?: AgentLook): string {
    const choice = chooseLook(look, seed, appearance);
    const key = `${agentKey}|${choiceKey(choice)}|${size}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const url = this.render(choice, size);
    this.cache.set(key, url);
    return url;
  }

  private render(choice: LookChoice, size: number): string {
    const person = this.library.create(choice.model, choice.outfit, choice);
    for (const m of person.detail) m.visible = true;
    for (const m of person.meshes) {
      m.castShadow = false;
      m.receiveShadow = false;
    }
    person.root.scale.setScalar(choice.scale);
    const rig = new Rig(person.root);
    if (choice.accessory !== undefined)
      wearAccessory(person.root, rig.bone('head'), choice.accessory, choice.capColor ?? '#2b3a55');
    const pose = createPose();
    solvePose(pose, 'stand', {
      t: 0,
      walk: 0,
      phase: 0,
      pelvisRest: rig.pelvisRestY,
      seated: false,
      seatHeight: 0.47,
      shellStage: 0,
    });
    pose[0] = 0;
    rig.apply(pose);
    person.root.updateMatrixWorld(true);
    this.scene.add(person.root);
    const head = rig.bone('head').getWorldPosition(new Vector3());
    const cam = this.camera;
    const half = FRAME_HEIGHT / 2;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.position.set(head.x, head.y + 0.03, head.z + 3);
    cam.lookAt(head.x, head.y + 0.03, head.z);
    cam.updateProjectionMatrix();

    const px = Math.min(256, Math.max(32, Math.round(size)));
    const target = new WebGLRenderTarget(px, px, { colorSpace: SRGBColorSpace, samples: 4 });
    const prevColor = this.renderer.getClearColor(new Color());
    const prevAlpha = this.renderer.getClearAlpha();
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const pixels = new Uint8Array(px * px * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, px, px, pixels);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(prevColor, prevAlpha);
    target.dispose();
    this.scene.remove(person.root);
    for (const m of person.meshes) (m as unknown as { skeleton?: { dispose(): void } }).skeleton?.dispose();

    const { canvas, ctx } = canvas2d(px, px);
    const image = ctx.createImageData(px, px);
    for (let y = 0; y < px; y++) {
      const src = (px - 1 - y) * px * 4;
      image.data.set(pixels.subarray(src, src + px * 4), y * px * 4);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
