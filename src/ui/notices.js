// Audience notices (I6): what the retiree estimates leave out (Medicare). Short, unobtrusive and dismissible; a dismissal is a per-browser convenience kept in localStorage
// (safeStorage: a blocked or private store just shows the notes again).
import { h, svg } from './dom.js';
import { safeStorage } from '../state.js';

export const NOTICES_KEY = 'fehb-compass:notices:v1';

export const NOTICES = Object.freeze({
  medicare: {
    label: 'Medicare note',
    text: 'Estimates assume you are not relying on Medicare. With Medicare as your primary coverage, costs differ greatly: see each plan’s “With Medicare” section on the board or in Compare.',
  },
});

/** { medicare?: true } from stored JSON; anything malformed counts as nothing dismissed. */
export function parseDismissed(raw) {
  try {
    const v = JSON.parse(raw ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.keys(NOTICES).filter((k) => v[k] === true).map((k) => [k, true]));
  } catch {
    return {};
  }
}

export const isDismissed = (id, storage) => parseDismissed(safeStorage(storage).get(NOTICES_KEY))[id] === true;

export function dismiss(id, storage) {
  const st = safeStorage(storage);
  return st.set(NOTICES_KEY, JSON.stringify({ ...parseDismissed(st.get(NOTICES_KEY)), [id]: true }));
}

const ICON_INFO = '<svg viewBox="0 0 16 16" aria-hidden="true" class="notice-icon"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.9v.1"/></svg>';
const ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8"/></svg>';

/**
 * A notice element, or null when the user dismissed it. `focusAfter()` returns the element that takes focus
 * once the notice is dismissed (the button goes away with it).
 */
export function noticeEl(id, { focusAfter, className = '' } = {}) {
  const n = NOTICES[id];
  if (!n || isDismissed(id)) return null;
  const btn = h('button', { type: 'button', class: 'notice-dismiss', 'aria-label': `Dismiss the ${n.label}` }, svg(ICON_X));
  const el = h('p', { class: `notice ${className}`.trim(), role: 'note', 'data-notice': id },
    svg(ICON_INFO), h('span', { class: 'notice-text' }, n.text), btn);
  btn.addEventListener('click', () => {
    dismiss(id);
    const next = focusAfter?.();
    el.remove();
    next?.focus?.({ preventScroll: true });
  });
  return el;
}
