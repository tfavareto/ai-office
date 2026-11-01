// Where the model files come from, and which URLs a download may touch (including the redirects it follows).
import type { VoiceModelSpec } from './manifest';

export interface VoiceSource {
  /** URL of one file of a model at its pinned revision. */
  fileUrl(spec: VoiceModelSpec, path: string): URL;
  /** Whether a request (the first one or a redirect) may be made. Everything else is refused. */
  allows(url: URL): boolean;
}

const HUGGING_FACE_HOST = 'huggingface.co';
/** The CDN the Hub redirects large files to (`*.hf.co`). */
const HUGGING_FACE_CDN_HOST = 'hf.co';

function isHostOrSubdomain(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

/** Hugging Face only, over HTTPS: the Hub itself and its CDN. The SHA-256 check is what makes the bytes trusted. */
export const HUGGING_FACE_SOURCE: VoiceSource = {
  fileUrl: (spec, path) => new URL(`https://${HUGGING_FACE_HOST}/${spec.repo}/resolve/${spec.revision}/${path}`),
  allows: (url) =>
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    (isHostOrSubdomain(url.hostname, HUGGING_FACE_HOST) || isHostOrSubdomain(url.hostname, HUGGING_FACE_CDN_HOST)),
};
