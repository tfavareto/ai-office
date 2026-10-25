/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PropertyBinding } from 'three';
import { describe, expect, it } from 'vitest';
import { facePartOf, type FacePart } from './facePart';
import { FEMALE_MODELS, MALE_MODELS } from './outfits';

interface GltfJson {
  nodes: { name?: string; mesh?: number }[];
  meshes: { primitives: { material?: number }[] }[];
  materials: { name?: string }[];
}

function readModel(model: string): GltfJson {
  const url = new URL(`../../../public/assets/3d/${model}.gltf`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as GltfJson;
}

/** The face parts of a model, as the names that three.js gives its meshes and materials (dots leave node names). */
function faceParts(model: string): FacePart[] {
  const gltf = readModel(model);
  const parts: FacePart[] = [];
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const materialIndex = gltf.meshes[node.mesh].primitives[0].material;
    const material = materialIndex === undefined ? undefined : gltf.materials[materialIndex];
    const part = facePartOf(PropertyBinding.sanitizeNodeName(node.name ?? ''), material?.name);
    if (part !== undefined) parts.push(part);
  }
  return parts.sort();
}

describe('facePartOf', () => {
  it('recognises the glTF node names, with and without the dots three.js removes', () => {
    expect(facePartOf('Human.eyebrow001')).toBe('eyebrows');
    expect(facePartOf('Humaneyebrow001')).toBe('eyebrows');
    expect(facePartOf('Humaneyelashes02')).toBe('eyelashes');
    expect(facePartOf('Humanlow-poly')).toBe('eyes');
  });

  it('recognises the eyeballs by their material when the mesh name says nothing', () => {
    expect(facePartOf('Mesh', 'eyes_bluegreen')).toBe('eyes');
  });

  it('leaves the body, the hair, the suit and the shoes alone', () => {
    for (const [mesh, material] of [
      ['Humanfemale_generic', 'Human.body'],
      ['Humanbob01', 'Human.bob01'],
      ['Humanshort04', 'Human.short04'],
      ['Humanmale_elegantsuit01', 'Human.male_elegantsuit01'],
      ['Humanshoes01', 'Human.shoes01'],
    ])
      expect(facePartOf(mesh, material)).toBeUndefined();
  });
});

describe('the face parts of the real models', () => {
  it.each([...MALE_MODELS, ...FEMALE_MODELS])('%s has eyes, eyebrows and eyelashes, one mesh each', (model) => {
    expect(faceParts(model)).toEqual(['eyebrows', 'eyelashes', 'eyes']);
  });

  it('is not met by the lightweight copies, which have no face details', () => {
    expect(faceParts('humans/m1_lod')).toEqual([]);
  });
});
