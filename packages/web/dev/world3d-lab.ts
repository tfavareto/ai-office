// Asset lab: renders the CC0 models side by side to inspect scale, orientation and rest poses.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const set = params.get('set') ?? 'humans';
const root = document.getElementById('c')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
root.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#aab4c4');
scene.add(new THREE.HemisphereLight('#ffffff', '#887766', 1.4));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.position.set(3, 6, 4);
scene.add(sun);
const loader = new GLTFLoader();
const names: Record<string, string[]> = {
  humans: ['m1_lod', 'm2_lod', 'm3', 'm4_lod', 'f1_lod', 'f2_lod', 'f3_lod', 'f4'].map((n) => `humans/${n}.gltf`),
  furniture: ['Ottoman_01', 'dining_chair_02', 'mid_century_lounge_chair', 'modern_coffee_table_01', 'modern_wooden_cabinet', 'round_wooden_table_01', 'side_table_01', 'sofa_03', 'wooden_display_shelves_01'].map((n) => `furniture/${n}/${n}.gltf`),
  plants: ['calathea_orbifolia_01', 'fern_02', 'pachira_aquatica_01', 'potted_plant_04'].map((n) => `plants/${n}/${n}.gltf`),
};
let x = 0;
const report: Record<string, unknown>[] = [];
const side = params.get('view') === 'side';
const spacing = Number(params.get('sp') ?? (set === 'humans' ? 1.3 : 1.6));
const only = params.get('only');
const paths = (names[set] ?? []).filter((n) => !only || n.includes(only));
for (const path of paths) {
  const gltf = await loader.loadAsync(`/assets/3d/${path}`);
  const obj = gltf.scene;
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  report.push({ path, size: size.toArray().map((v) => +v.toFixed(2)), min: box.min.toArray().map((v) => +v.toFixed(2)) });
  obj.position.x = x;
  obj.position.y = set === 'humans' ? 0 : -box.min.y;
  x += spacing;
  obj.rotation.y = side ? Math.PI / 2 : 0;
  scene.add(obj);
  if (params.get('skel') === '1') scene.add(new THREE.SkeletonHelper(obj));
}
(window as unknown as { __report: unknown }).__report = report;
const aspect = innerWidth / innerHeight;
const camX = ((paths.length - 1) * spacing) / 2;
const hh = Number(params.get('h') ?? (set === 'humans' ? 1.0 : 0.8));
const cy = Number(params.get('cy') ?? hh);
const cam = new THREE.OrthographicCamera(-hh * aspect, hh * aspect, hh, -hh, 0.1, 100);
cam.position.set(camX, cy, 8);
cam.lookAt(camX, cy, 0);
renderer.render(scene, cam);
document.title = 'ready';
