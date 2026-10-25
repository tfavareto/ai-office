// Renders one frame of the stage to an off-screen target and returns it as a canvas. The live canvas, its pixel ratio
// and its composer are not touched, so a capture never changes the quality the person is watching.
import { HalfFloatType, UnsignedByteType, Vector2, WebGLRenderTarget, type Camera, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { daylight, usesBloom } from './daylight';
import type { Stage } from './stage';

const MSAA_SAMPLES = 4;
const BLOOM_RADIUS = 0.55;
const BLOOM_THRESHOLD = 0.82;
const RGBA = 4;

/** Bottom-up rows of a read-back buffer as a top-down, fully opaque image. */
export function flipRows(source: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * RGBA;
  const flipped = new Uint8ClampedArray(new ArrayBuffer(source.length));
  for (let y = 0; y < height; y++) {
    flipped.set(source.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
  }
  for (let i = RGBA - 1; i < flipped.length; i += RGBA) flipped[i] = 255;
  return flipped;
}

function readCanvas(
  renderer: WebGLRenderer,
  target: WebGLRenderTarget,
  width: number,
  height: number,
): HTMLCanvasElement {
  const pixels = new Uint8Array(width * height * RGBA);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.putImageData(new ImageData(flipRows(pixels, width, height), width, height), 0, 0);
  return canvas;
}

/** One frame of `stage.scene` seen by `camera`, `width` x `height` px, lit and tone-mapped like the live view. */
export function renderStill(
  stage: Stage,
  camera: Camera,
  width: number,
  height: number,
  night: number,
): HTMLCanvasElement {
  const { renderer, scene } = stage;
  const previous = renderer.getRenderTarget();
  const hdr = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: MSAA_SAMPLES });
  const composer = new EffectComposer(renderer, hdr);
  composer.renderToScreen = false;
  composer.addPass(new RenderPass(scene, camera));
  if (usesBloom(night))
    composer.addPass(
      new UnrealBloomPass(new Vector2(width, height), daylight(night).bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD),
    );
  const output = new OutputPass();
  output.renderToScreen = false;
  const target = new WebGLRenderTarget(width, height, { type: UnsignedByteType });
  try {
    composer.render(0);
    output.render(renderer, target, composer.readBuffer, 0, false);
    return readCanvas(renderer, target, width, height);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    output.dispose();
    composer.dispose();
    hdr.dispose();
  }
}
