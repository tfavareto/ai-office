// Dev harness: every choice of the customization editor, drawn by the 2D sprites (left) and the 3D models (right).
// Query: ?seed=12345&look=f|m (the person the choices are applied to) and size=96 (pixels of each picture).
import { ACCESSORIES, HAIR_COLORS, HAIR_STYLE_COUNT, OUTFITS, SKIN_TONES, type AgentLook } from '@ai-office/shared';
import { DEFAULT_WORLD_OPTIONS, type PreviewPerson, type WorldApi } from '../src/world/api';
import { createWorld3D } from '../src/world3d';
import { createWorld2D } from '../src/world2d';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 123457);
const gender = params.get('look') === 'm' ? 'm' : 'f';
const person: PreviewPerson = { seed, look: gender, kind: 'main' };
const SIZE = Number(params.get('size') ?? 96);

function picture(world: WorldApi, appearance: AgentLook | undefined): HTMLImageElement {
  const img = document.createElement('img');
  img.style.width = img.style.height = `${SIZE}px`;
  img.src = world.previewPortrait(person, appearance, SIZE * 2) ?? '';
  return img;
}

function cell(label: string, worlds: readonly WorldApi[], appearance: AgentLook | undefined): HTMLElement {
  const figure = document.createElement('figure');
  const pair = document.createElement('div');
  for (const world of worlds) pair.append(picture(world, appearance));
  figure.append(pair, document.createTextNode(label));
  return figure;
}

function section(title: string, cells: HTMLElement[]): HTMLElement {
  const wrap = document.createElement('section');
  const h = document.createElement('h2');
  h.textContent = title;
  const row = document.createElement('div');
  row.className = 'row';
  row.append(...cells);
  wrap.append(h, row);
  return wrap;
}

async function main(): Promise<void> {
  const opts = {
    options: { ...DEFAULT_WORLD_OPTIONS },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const stage = document.getElementById('world') as HTMLElement;
  const world3d = await createWorld3D(stage, opts);
  const holder2d = document.createElement('div');
  holder2d.style.cssText = 'position:fixed;left:-9999px;width:400px;height:300px';
  document.body.append(holder2d);
  const world2d = await createWorld2D(holder2d, opts);
  const worlds = [world2d, world3d];
  const out = document.getElementById('out') as HTMLElement;
  out.append(
    section('default', [cell('seed', worlds, undefined)]),
    section(
      'hair style',
      Array.from({ length: HAIR_STYLE_COUNT }, (_, i) => cell(`style ${i}`, worlds, { hairStyle: i as 0 | 1 | 2 | 3 })),
    ),
    section(
      'skin',
      SKIN_TONES.map((s) => cell(s.id, worlds, { skin: s.id })),
    ),
    section(
      'hair color',
      HAIR_COLORS.map((s) => cell(s.id, worlds, { hairColor: s.id })),
    ),
    section(
      'outfit',
      OUTFITS.map((s) => cell(s.id, worlds, { outfit: s.id })),
    ),
    section(
      'accessory',
      ACCESSORIES.map((a) => cell(a, worlds, { accessory: a })),
    ),
    section('combined', [
      cell('cap+red hair+deep', worlds, {
        accessory: 'cap',
        hairColor: 'red',
        skin: 'deep',
        outfit: 'azure',
        hairStyle: 2,
      }),
      cell('glasses+blond+fair', worlds, {
        accessory: 'glasses',
        hairColor: 'blond',
        skin: 'fair',
        outfit: 'crimson',
        hairStyle: 1,
      }),
      cell('headset+grey', worlds, {
        accessory: 'headphones',
        hairColor: 'grey',
        skin: 'tan',
        outfit: 'gold',
        hairStyle: 3,
      }),
    ]),
  );
  document.title = 'ready';
  (window as unknown as { __ready: boolean }).__ready = true;
}

main().catch((error) => {
  console.error(error);
  document.title = 'error';
});
