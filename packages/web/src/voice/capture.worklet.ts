// Runs on the audio rendering thread: hands the microphone's samples to the page in blocks of about a tenth of a second.
// (A separate file because an audio worklet is its own script, loaded with `audioWorklet.addModule`.)
import { CAPTURE_PROCESSOR_NAME } from './constants';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const BLOCK_FRAMES = 4096;

class CaptureProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK_FRAMES);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel === undefined) return true;
    let read = 0;
    while (read < channel.length) {
      const count = Math.min(channel.length - read, BLOCK_FRAMES - this.filled);
      this.block.set(channel.subarray(read, read + count), this.filled);
      this.filled += count;
      read += count;
      if (this.filled === BLOCK_FRAMES) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(BLOCK_FRAMES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor(CAPTURE_PROCESSOR_NAME, CaptureProcessor);
