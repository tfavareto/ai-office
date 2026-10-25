// Glasses, headphones and a cap for the 3D people, built from primitives (no assets) and hung on the head bone. They
// are drawn in model axes (x to the person's left, y up, z forward, metres, origin at the head bone) at the rest pose,
// then re-parented to the bone with their world transform kept, so they follow whatever the head does.
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { LookChoice } from './outfits';

type Accessory = NonNullable<LookChoice['accessory']>;

/** Height of the eyes above the head bone, and how far the face sits in front of it (metres, at scale 1). */
const EYE_Y = 0.074;
const FACE_Z = 0.092;
const HEAD_CENTER_Y = 0.07;

const frameMaterial = new MeshStandardMaterial({ color: '#1c2028', roughness: 0.45, metalness: 0.35 });
const lensMaterial = new MeshStandardMaterial({
  color: '#cfe8f5',
  roughness: 0.1,
  metalness: 0,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
});
const bandMaterial = new MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.55, metalness: 0.2 });
const cupMaterial = new MeshStandardMaterial({ color: '#39404f', roughness: 0.5, metalness: 0.25 });
const padMaterial = new MeshStandardMaterial({ color: '#8d99ad', roughness: 0.9, metalness: 0 });
const capMaterials = new Map<string, MeshStandardMaterial>();

function capMaterial(hex: string): MeshStandardMaterial {
  let material = capMaterials.get(hex);
  if (!material) {
    material = new MeshStandardMaterial({ color: hex, roughness: 0.8, metalness: 0 });
    capMaterials.set(hex, material);
  }
  return material;
}

const lensGeo = new TorusGeometry(0.031, 0.0035, 8, 24);
const lensDiscGeo = new CylinderGeometry(0.029, 0.029, 0.002, 20).rotateX(Math.PI / 2);
const bridgeGeo = new BoxGeometry(0.02, 0.004, 0.004);
const templeGeo = new BoxGeometry(0.004, 0.004, 0.1);
const bandGeo = new TorusGeometry(0.098, 0.0065, 8, 28, Math.PI);
const cupGeo = new CylinderGeometry(0.04, 0.04, 0.03, 20).rotateZ(Math.PI / 2);
const padGeo = new CylinderGeometry(0.033, 0.033, 0.012, 20).rotateZ(Math.PI / 2);
const crownGeo = new SphereGeometry(0.105, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1.12);
const brimGeo = new CylinderGeometry(0.085, 0.085, 0.006, 24, 1, false, 0, Math.PI);
const buttonGeo = new SphereGeometry(0.009, 8, 6);

function part(geometry: BufferGeometry, material: Material, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function glasses(): Group {
  const group = new Group();
  for (const side of [-1, 1]) {
    group.add(part(lensGeo, frameMaterial, side * 0.036, EYE_Y, FACE_Z));
    group.add(part(lensDiscGeo, lensMaterial, side * 0.036, EYE_Y, FACE_Z));
    group.add(part(templeGeo, frameMaterial, side * 0.074, EYE_Y, FACE_Z - 0.05));
  }
  group.add(part(bridgeGeo, frameMaterial, 0, EYE_Y + 0.008, FACE_Z));
  return group;
}

function headphones(): Group {
  const group = new Group();
  const band = part(bandGeo, bandMaterial, 0, HEAD_CENTER_Y + 0.005, 0);
  band.scale.set(1, 0.8, 1);
  group.add(band);
  for (const side of [-1, 1]) {
    group.add(part(cupGeo, cupMaterial, side * 0.093, HEAD_CENTER_Y + 0.005, 0));
    group.add(part(padGeo, padMaterial, side * 0.078, HEAD_CENTER_Y + 0.005, 0));
  }
  return group;
}

function cap(hex: string): Group {
  const group = new Group();
  const material = capMaterial(hex);
  group.add(part(crownGeo, material, 0, HEAD_CENTER_Y + 0.018, -0.006));
  const brim = part(brimGeo, material, 0, HEAD_CENTER_Y + 0.04, 0.072);
  brim.rotation.set(0.12, Math.PI / 2, 0);
  brim.rotation.order = 'YXZ';
  group.add(brim);
  group.add(part(buttonGeo, material, 0, HEAD_CENTER_Y + 0.108, -0.006));
  return group;
}

function build(accessory: Accessory, capColor: string): Group {
  return accessory === 'glasses' ? glasses() : accessory === 'headphones' ? headphones() : cap(capColor);
}

/**
 * Puts the accessory on the head: it is placed relative to the head bone's rest position in model axes and re-parented
 * to the bone. `root` is the model's root (already scaled), `head` its head bone.
 */
export function wearAccessory(root: Object3D, head: Object3D, accessory: Accessory, capColor: string): Object3D {
  root.updateMatrixWorld(true);
  const group = build(accessory, capColor);
  const at = head.getWorldPosition(new Vector3());
  root.worldToLocal(at);
  group.position.copy(at);
  root.add(group);
  root.updateMatrixWorld(true);
  head.attach(group);
  return group;
}
