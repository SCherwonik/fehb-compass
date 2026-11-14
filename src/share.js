// Share link: the page address plus the state hash. DOM-free (node tested); the button lives in ui/share-ui.js.
// Only the state (state.js) goes into the link. "My medications" (drug names, costs, recorded tiers) live in
// localStorage under ui/meds-store.js and are never part of the state, so they cannot reach the link.
import { encodeHash } from './state.js';

/**
 * shareLink(href, state) -> { url, leftOut }
 * href: the current page address (any old hash is dropped). leftOut: custom cost lines that did not fit the
 * link's length budget (they stay in this browser only; the link announces how many with cx=N).
 */
export function shareLink(href, state) {
  const res = encodeHash(state);
  const base = String(href).split('#')[0];
  return { url: res.hash ? `${base}#${res.hash}` : base, leftOut: res.overflow.length };
}
