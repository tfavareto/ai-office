// Getting the card out of the page: a PNG file name, the blob, the download and the clipboard.
import { h } from '../ui/dom';

const REVOKE_DELAY_MS = 1000;

/** `ai-office-2026-10-25.png`. */
export function cardFilename(date: string): string {
  return `ai-office-${date}.png`;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error('The picture could not be encoded')) : resolve(blob)),
      'image/png',
    );
  });
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: name, class: 'ao-visually-hidden' });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** The part of the browser the clipboard needs; a parameter so it can be tested. */
export interface ImageClipboard {
  write?: (items: ClipboardItems) => Promise<void>;
}

export type CopyImageResult = 'copied' | 'unsupported' | 'failed';

/** Whether this browser can put an image on the clipboard (it needs the async clipboard and `ClipboardItem`). */
export function canCopyImage(clipboard: ImageClipboard | undefined, item: unknown = globalThis.ClipboardItem): boolean {
  return typeof clipboard?.write === 'function' && typeof item === 'function';
}

/** Puts a PNG on the clipboard; says why when it cannot (no support, or the browser refused). */
export async function copyImage(
  blob: Blob,
  clipboard: ImageClipboard | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
  item: unknown = globalThis.ClipboardItem,
): Promise<CopyImageResult> {
  if (!canCopyImage(clipboard, item)) return 'unsupported';
  try {
    const make = item as typeof ClipboardItem;
    await clipboard?.write?.([new make({ [blob.type || 'image/png']: blob })]);
    return 'copied';
  } catch {
    return 'failed';
  }
}
