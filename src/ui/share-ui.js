// Top bar actions: "Copy link" (the current state as a shareable URL) and "Print / Save as PDF", plus the toast
// that confirms a copy. The link is built by share.js from the state alone: "My medications" never enter it.
import { h } from './dom.js';
import { shareLink } from '../share.js';
import { reduceMotion, EASE_OUT } from './motion.js';

let toastEl = null;
let toastTimer = 0;

/** A small glass toast in a polite live region. `extra` (a node) stays until dismissed; text-only toasts fade. */
export function toast(message, { extra = null, sticky = false, returnTo = null } = {}) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast glass', role: 'status', 'aria-live': 'polite' });
    toastEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') toastEl._hide?.(); });
    document.body.append(toastEl);
  }
  clearTimeout(toastTimer);
  const close = h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss' }, '×');
  close.addEventListener('click', hide);
  // only real nodes: a skipped slot passed as null would print as the text "null"
  toastEl.replaceChildren(...[h('p', { class: 'toast-msg' }, message), (sticky || extra) ? close : null, extra].filter(Boolean));
  toastEl._hide = hide;
  toastEl.classList.add('is-visible');
  if (!reduceMotion()) {
    toastEl.animate([{ opacity: 0, transform: 'translate(-50%, 8px) scale(0.98)' }, { opacity: 1, transform: 'translate(-50%, 0)' }],
      { duration: 260, easing: EASE_OUT });
  }
  if (!sticky && !extra) toastTimer = setTimeout(hide, 2600);
  function hide() {
    clearTimeout(toastTimer);
    if (!toastEl.classList.contains('is-visible')) return;
    const hadFocus = toastEl.contains(document.activeElement);
    const done = () => {
      toastEl.classList.remove('is-visible');
      toastEl.replaceChildren();
      if (hadFocus) returnTo?.focus({ preventScroll: true });
    };
    if (reduceMotion()) return done();
    toastEl.animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, 6px)' }], { duration: 180, easing: 'ease-in' }).onfinish = done;
  }
  return hide;
}

/** Copy text: the async Clipboard API, else a hidden textarea + execCommand. Resolves true when copied. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* permission denied or unfocused document: try the fallback */ }
  const ta = h('textarea', { readonly: '', 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;' });
  ta.value = text;
  document.body.append(ta);
  const prev = document.activeElement;
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  prev?.focus?.({ preventScroll: true });
  return ok;
}

/**
 * Wire the top bar buttons. store: the app state store.
 */
export function initShare({ store, copyBtn, printBtn }) {
  copyBtn?.addEventListener('click', async () => {
    const { url, leftOut } = shareLink(location.href, store.get());
    const lines = leftOut
      ? ` ${leftOut} of your own cost ${leftOut === 1 ? 'line does' : 'lines do'} not fit in a link and stay in this browser.`
      : '';
    const ok = await copyText(url);
    if (ok) {
      copyBtn.classList.add('is-done');
      setTimeout(() => copyBtn.classList.remove('is-done'), 1600);
      toast(`Link copied. Your medications list is never included. Your own cost descriptions are.${lines}`, { sticky: Boolean(lines), returnTo: copyBtn });
      return;
    }
    // No clipboard access: show the link selected so it can be copied by hand.
    const field = h('input', { type: 'text', class: 'toast-field', readonly: '', value: url, 'aria-label': 'Link to this comparison' });
    toast(`Copy this link (Ctrl+C or Cmd+C).${lines}`, { extra: field, returnTo: copyBtn });
    field.focus();
    field.select();
  });
  printBtn?.addEventListener('click', () => window.print());
}
