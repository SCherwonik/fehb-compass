// A card tag that explains itself (results.js tipTag): a button whose explanation (.tag-tip, its aria-describedby and
// aria-controls target) shows below the chips. Click, tap or Enter/Space keeps it open (one at a time per card); a mouse
// hover shows it while the pointer is on the tag, like the old title tooltip. DOM-light so tests can drive it with fakes.

const tipOf = (btn, doc) => doc.getElementById(btn.getAttribute('aria-controls'));

/** Show one tag's explanation (closing the others in `buttons`), or hide it when it is already open. */
export function toggleTip(buttons, btn, doc = document) {
  const open = btn.getAttribute('aria-expanded') !== 'true';
  for (const b of buttons) {
    const on = open && b === btn;
    b.setAttribute('aria-expanded', String(on));
    const tip = tipOf(b, doc);
    if (tip) tip.hidden = !on;
  }
  return open;
}

/**
 * pointerover / pointerout on the card list: a mouse over a tag shows its explanation (class is-hover), leaving the tag
 * hides it again unless it was opened by a click. Touch and pen pointers are left to the click.
 */
export function hoverTip(e, on, doc = document) {
  if (e.pointerType !== 'mouse') return false;
  const btn = e.target?.closest?.('.tag-btn');
  if (!btn) return false;
  if (!on && e.relatedTarget && btn.contains(e.relatedTarget)) return false; // still inside the tag
  const tip = tipOf(btn, doc);
  if (!tip) return false;
  tip.classList.toggle('is-hover', on);
  return true;
}
