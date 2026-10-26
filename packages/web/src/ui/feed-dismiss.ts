// Collapses the expanded activity feed when the user clicks anywhere outside it (a drag, e.g. panning the world, does not).
import { isClick, startsFeedDismiss, type PointerPoint } from './model/feed-dismiss';

/** Elements that belong to the feed: the panel itself and the top bar button that toggles it. */
export const FEED_AREA_SELECTOR = '.ao-feed, [data-feed-toggle]';

export interface FeedDismissHooks {
  isOpen: () => boolean;
  collapse: () => void;
}

/** Listens on the document; the press is only a candidate, the release decides (same place means a click). */
export function bindFeedDismiss(hooks: FeedDismissHooks, doc: Document = document): void {
  let pending: { pointerId: number; from: PointerPoint } | null = null;

  doc.addEventListener(
    'pointerdown',
    (event) => {
      const inside = event.target instanceof Element && event.target.closest(FEED_AREA_SELECTOR) !== null;
      pending = startsFeedDismiss(hooks.isOpen(), inside, event.button)
        ? { pointerId: event.pointerId, from: { x: event.clientX, y: event.clientY } }
        : null;
    },
    true,
  );
  doc.addEventListener(
    'pointerup',
    (event) => {
      const press = pending;
      if (press === null || press.pointerId !== event.pointerId) return;
      pending = null;
      if (hooks.isOpen() && isClick(press.from, { x: event.clientX, y: event.clientY })) hooks.collapse();
    },
    true,
  );
  doc.addEventListener('pointercancel', () => (pending = null), true);
}
