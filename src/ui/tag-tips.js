// A card tag that explains itself (results.js tipTag): a button (id tag-<code>-<key>, data-key) whose explanation
// (.tag-tip, id tip-<code>-<key>, data-tag = the button's id) is its aria-controls and aria-describedby target and shows
// below the chips. One tip at most is open per card, and aria-expanded always matches whether the tip shows.
//   click, tap, Enter or Space   opens the tip (pinned), or closes a pinned one; a click on a hover-opened tip pins it.
//                                A mouse click that closes a tip keeps hover from reopening it until the pointer leaves.
//   mouse hover                  opens the tip while the pointer is on the tag or on the tip itself; leaving both
//                                closes it after a short grace (LEAVE_GRACE_MS), so the pointer can travel to the tip.
//                                Crossing another tag of the card on the way does not switch tips at once: that tag
//                                opens only if the pointer is still on it when the grace ends.
//   Escape                       closes the open tips; focus goes back to a tag whose tip the keyboard opened.
// DOM-light (getAttribute/setAttribute/closest/contains/focus/hidden) so tests can drive it with fake elements.

export const LEAVE_GRACE_MS = 300;

const isOpen = (b) => b.getAttribute('aria-expanded') === 'true';
const openedBy = (b) => (isOpen(b) ? b.getAttribute('data-open-by') : null);

/**
 * The tip controller. doc: getElementById (and the page's tags); group(btn): the tag buttons of btn's card;
 * setTimer / clearTimer: setTimeout / clearTimeout (fakes in tests).
 */
export function createTipController({ doc = document, group, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const timers = new Map(); // pending closes (a hover-opened tag the pointer left)
  const opening = new Map(); // pending opens (a tag crossed while another tag's close is pending)
  const tipOf = (b) => doc.getElementById(b.getAttribute('aria-controls'));
  const show = (b, by) => {
    b.setAttribute('aria-expanded', String(Boolean(by)));
    if (by) b.setAttribute('data-open-by', by); else b.removeAttribute('data-open-by');
    const tip = tipOf(b);
    if (tip) tip.hidden = !by;
  };
  const cancel = (b) => { if (timers.has(b)) { clearTimer(timers.get(b)); timers.delete(b); } };
  const cancelOpen = (b) => { if (opening.has(b)) { clearTimer(opening.get(b)); opening.delete(b); } };
  const open = (b, by) => { for (const x of group(b)) { if (x !== b && isOpen(x)) { cancel(x); show(x, null); } } cancel(b); show(b, by); };
  const close = (b) => { cancel(b); show(b, null); };
  /** The tag button an element belongs to: the tag itself, or the tag whose tip the element is in. */
  const tagOf = (el) => {
    const btn = el?.closest?.('.tag-btn');
    if (btn) return btn;
    const tip = el?.closest?.('.tag-tip');
    return tip ? doc.getElementById(tip.getAttribute('data-tag')) : null;
  };

  return {
    tagOf,
    /** A click on a tag (keyboard: Enter/Space). Returns whether its tip is now open. */
    click(b, { keyboard = false } = {}) {
      cancelOpen(b);
      const by = openedBy(b);
      if (by === 'hover') { open(b, keyboard ? 'key' : 'click'); return true; } // pin what the pointer showed
      if (by) {
        close(b);
        if (!keyboard) b.setAttribute('data-hover-off', ''); // the pointer is still on it: no reopen until it leaves
        return false;
      }
      open(b, keyboard ? 'key' : 'click');
      return true;
    },
    /** pointerover anywhere in the list. */
    over(target, pointerType) {
      if (pointerType !== 'mouse') return;
      const b = tagOf(target);
      if (!b) return;
      cancel(b); // back on the tag, or on its tip, within the grace
      if (b.hasAttribute('data-hover-off') || isOpen(b) || opening.has(b)) return;
      // another tag's tip is closing (the pointer may be on its way there): open this one only if the pointer stays
      if ([...group(b)].some((x) => x !== b && timers.has(x))) {
        opening.set(b, setTimer(() => { opening.delete(b); if (!isOpen(b)) open(b, 'hover'); }, LEAVE_GRACE_MS));
        return;
      }
      open(b, 'hover');
    },
    /** pointerout anywhere in the list (related: where the pointer went). */
    out(target, related, pointerType) {
      if (pointerType !== 'mouse') return;
      const b = tagOf(target);
      if (!b || (related && tagOf(related) === b)) return; // still on the tag or its tip
      cancelOpen(b);
      b.removeAttribute('data-hover-off');
      if (openedBy(b) !== 'hover') return;
      cancel(b);
      timers.set(b, setTimer(() => { timers.delete(b); if (openedBy(b) === 'hover') show(b, null); }, LEAVE_GRACE_MS));
    },
    /**
     * Escape: close every open tip in `openTags` (the page's .tag-btn[aria-expanded="true"]). A hover-opened one stays
     * closed until the pointer leaves; focus returns to a tag whose tip the keyboard opened (or that has focus).
     * Returns whether anything closed.
     */
    escape(openTags, active = null) {
      let any = false;
      for (const b of openTags) {
        const by = openedBy(b);
        if (!by) continue;
        any = true;
        close(b);
        if (by === 'hover') b.setAttribute('data-hover-off', '');
        if (by === 'key' || b === active) b.focus();
      }
      return any;
    },
    /** Tags about to be removed (a card's chips rebuild): drop their pending timers. */
    forget(tags) { for (const b of tags) { cancel(b); cancelOpen(b); } },
  };
}

/** The data-key of the tag that has focus inside `container` (null when focus is elsewhere). */
export function focusedTagKey(container, active) {
  return active && active.classList?.contains('tag-btn') && container.contains(active) ? active.getAttribute('data-key') : null;
}

/** After a rebuild: focus the new tag with that data-key. Returns it (null when the tag is gone). */
export function restoreTagFocus(tags, key) {
  if (!key) return null;
  const b = [...tags].find((x) => x.getAttribute('data-key') === key) ?? null;
  b?.focus();
  return b;
}
