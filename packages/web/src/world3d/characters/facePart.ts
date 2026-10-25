// Which meshes of a MakeHuman model are the face details. The glTF node names are "Human.eyebrow001" and so on, and
// three.js drops the dots when it names the objects ("Humaneyebrow001"), so the names are matched by their stem; the
// eyeballs are the "low-poly" mesh, recognised by their "eyes_<color>" material as well.

export type FacePart = 'eyes' | 'eyebrows' | 'eyelashes';

const PART_BY_NAME: readonly (readonly [RegExp, FacePart])[] = [
  [/eyebrow/i, 'eyebrows'],
  [/eyelash/i, 'eyelashes'],
  [/low-poly$/i, 'eyes'],
];
const EYE_MATERIAL = /^eyes_/i;

/** The face part a mesh is, from its name and the name of its material; undefined for body, hair, suit and shoes. */
export function facePartOf(meshName: string, materialName = ''): FacePart | undefined {
  for (const [pattern, part] of PART_BY_NAME) if (pattern.test(meshName)) return part;
  return EYE_MATERIAL.test(materialName) ? 'eyes' : undefined;
}
