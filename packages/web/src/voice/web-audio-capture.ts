// The browser side of the recorder: the microphone stream into an audio worklet that reports its samples.
import workletUrl from './capture.worklet.ts?worker&url';
import { CAPTURE_PROCESSOR_NAME } from './constants';
import type { CaptureSession, RecorderEnv } from './recorder';

async function openCapture(stream: MediaStream): Promise<CaptureSession> {
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(workletUrl);
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 0 });
    source.connect(node);
    return {
      sampleRate: context.sampleRate,
      onBlock: (listener) => {
        node.port.onmessage = (event: MessageEvent<Float32Array>) => listener(event.data);
      },
      close: async () => {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        await context.close();
      },
    };
  } catch (error) {
    void context.close().catch(() => undefined);
    throw error;
  }
}

/** The real microphone and audio graph. */
export function browserRecorderEnv(): RecorderEnv {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    openCapture,
  };
}
