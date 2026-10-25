// Dev harness: the face of each of the four 3D models of a look up close, lit like the world.
// Query: ?look=f|m&seed=1 (the hair colors the world gives them), ?daylight=day|night, ?skin=<id>&hair=<id> (a person's choice),
// ?zoom=1 and focus=0..3 (the head to center on; 1 shows the four heads and the shoulders; more is closer).
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { HAIR_COLORS, SKIN_TONES, swatchHex } from '@ai-office/shared';
import { HumanLibrary } from '../src/world3d/characters/humanLibrary';
import { chooseLook, FEMALE_MODELS, MALE_MODELS } from '../src/world3d/characters/outfits';
import { Rig } from '../src/world3d/pose/rig';

const params = new URLSearchParams(location.search);
const night = params.get('daylight') === 'night';
const zoom = Number(params.get('zoom') ?? 1);
const skin = swatchHex(SKIN_TONES, params.get('skin') ?? undefined);
const hair = swatchHex(HAIR_COLORS, params.get('hair') ?? undefined);
const look = params.get('look') === 'm' ? 'm' : 'f';
const seed = Number(params.get('seed') ?? 1);
const focus = params.has('focus') ? Number(params.get('focus')) : null;
const SPACING = 0.42;

async function main(): Promise<void> {
  const library = await HumanLibrary.load();
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(2);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = night ? 0.95 : 1;
  document.body.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(night ? '#0d1220' : '#8d99ad');
  scene.add(new HemisphereLight(night ? '#6f86c8' : '#ffffff', '#b9a48c', night ? 1.1 : 1.4));
  const key = new DirectionalLight(night ? '#9fb4e8' : '#fff1dc', night ? 1.4 : 2.4);
  key.position.set(1.2, 1.6, 2.4);
  scene.add(key);

  const models = look === 'm' ? MALE_MODELS : FEMALE_MODELS;
  const head = new Vector3();
  models.forEach((model, col) => {
    const seeded = chooseLook(look, seed + col);
    const person = library.create(model, '#1f2a44', {
      ...(skin !== undefined ? { skin } : {}),
      hair: hair ?? seeded.hair,
    });
    const rig = new Rig(person.root);
    person.root.updateMatrixWorld(true);
    rig.bone('head').getWorldPosition(head);
    person.root.position.set(col * SPACING - head.x - SPACING * 1.5, -head.y, -head.z);
    scene.add(person.root);
  });

  const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 20);
  const height = 1.1 / zoom;
  const centerX = focus === null ? 0 : (focus - 1.5) * SPACING;
  const centerY = focus === null ? -0.05 : 0.02;
  camera.position.set(centerX, centerY, height / 2 / Math.tan((camera.fov * Math.PI) / 360));
  camera.lookAt(centerX, centerY, 0);
  renderer.render(scene, camera);
  document.title = 'ready';
}

main().catch((e) => {
  console.error(e);
  document.title = 'error';
});
