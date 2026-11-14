// "Your situation" bar under the intro: a one-line summary of the inputs (sticky under the top bar) and an
// "Edit your situation" disclosure that opens the full input form inline, at full width, in the page flow.
// Only the summary line is sticky; the editor scrolls with the page, so nothing traps the wheel or touch scroll.
// Chip text comes from situation-model.js; every value reaches the DOM through textContent.
import { h } from './dom.js';
import { summaryChips, parseOpenPrefs, tabGroup } from './situation-model.js';
import { reduceMotion, EASE_OUT } from './motion.js';
import { safeStorage } from '../state.js';

const EVENT = 'fehb:edit-situation';
/** The open/closed choice per main tab (a local convenience: never in the share link). */
export const OPEN_KEY = 'fehb-compass:situation-open:v1';
export const loadOpenPrefs = () => parseOpenPrefs(safeStorage().get(OPEN_KEY));

/**
 * Ask the situation bar to open its editor and focus `focus` (a CSS selector inside it), from anywhere
 * (for example the dental "Enter ZIP code" button). Decoupled through a DOM event: no import cycle.
 */
export function editSituation(focus) {
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { focus } }));
}

/**
 * initSituation({ bar, editor, store, expanded, chipOpts }) -> { refresh() }
 * bar: the .sit-bar section (holds #sit-chips and #sit-edit); editor: #sit-editor (the form and medications).
 * chipOpts(): options for summaryChips (plan names, medication count, dental/vision filters), read on refresh.
 */
export function initSituation({ bar, editor, store, expanded = false, chipOpts = () => ({}) }) {
  const chips = bar.querySelector('#sit-chips');
  const btn = bar.querySelector('#sit-edit');
  const btnText = btn.querySelector('.sit-edit-text');
  const done = editor.querySelector('#sit-done');
  let open = false;
  let anim = null;

  // the bar sticks under the top bar: keep its offset (and the results' scroll margin) in step with real heights
  const root = document.documentElement;
  const topbar = document.querySelector('.topbar');
  const measure = () => {
    root.style.setProperty('--topbar-h', `${Math.round(topbar?.offsetHeight ?? 64)}px`);
    root.style.setProperty('--sit-h', `${Math.round(bar.offsetHeight)}px`);
  };
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(measure);
    if (topbar) ro.observe(topbar);
    ro.observe(bar);
  }
  measure();

  function paint() {
    btn.setAttribute('aria-expanded', String(open));
    bar.classList.toggle('is-open', open);
    // "Edit your situation" ("Edit" on a phone) / "Done"
    if (open) btnText.replaceChildren('Done');
    else btnText.replaceChildren('Edit', h('span', { class: 'sit-edit-more' }, ' your situation'));
  }

  function setOpen(next, { focus = null, animate = true } = {}) {
    if (next === open) {
      if (next && focus) focusInside(focus);
      return;
    }
    open = next;
    paint();
    anim?.cancel();
    anim = null;
    const motion = animate && !reduceMotion();
    if (open) {
      editor.hidden = false;
      if (motion) {
        const hgt = editor.scrollHeight;
        anim = editor.animate(
          [{ height: '0px', opacity: 0, overflow: 'hidden' }, { height: `${hgt}px`, opacity: 1, overflow: 'hidden' }],
          { duration: Math.min(520, 220 + hgt / 6), easing: EASE_OUT },
        );
        anim.onfinish = () => { anim = null; };
      }
      if (focus) focusInside(focus);
    } else {
      const finish = () => { anim = null; if (!open) editor.hidden = true; };
      if (!motion) { finish(); return; }
      // keep the summary in view while the form folds away above the results
      const hgt = editor.offsetHeight;
      const duration = Math.min(380, 180 + hgt / 10);
      const a = editor.animate(
        [{ height: `${hgt}px`, opacity: 1, overflow: 'hidden' }, { height: '0px', opacity: 0, overflow: 'hidden' }],
        { duration, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
      );
      anim = a;
      a.onfinish = finish;
      a.oncancel = () => { if (!open) editor.hidden = true; };
      // a background tab may never run the animation: hide on time regardless
      setTimeout(() => { if (anim === a && !open) { a.cancel(); finish(); } }, duration + 120);
    }
  }

  function focusInside(sel) {
    const el = editor.querySelector(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }

  /** Collapse, then put focus somewhere useful: the Edit button, or the top of the results. */
  function close(target = 'button') {
    setOpen(false);
    if (target === 'results') {
      const main = document.getElementById('results');
      main?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      main?.focus({ preventScroll: true });
    } else {
      btn.focus({ preventScroll: true });
    }
  }

  // the person's own choice is remembered for the tab they made it on (Health plans, or Dental & Vision)
  const remember = (isOpen) => {
    const prefs = loadOpenPrefs();
    prefs[tabGroup(store.get().tab)] = isOpen;
    safeStorage().set(OPEN_KEY, JSON.stringify(prefs));
  };

  btn.addEventListener('click', () => {
    if (open) close();
    else setOpen(true);
    remember(open);
  });
  done?.addEventListener('click', () => { close('results'); remember(false); });
  // Esc closes from anywhere in the editor (inner widgets that use Esc themselves stop it first)
  const onEsc = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !open) return;
    e.preventDefault();
    close();
    remember(false);
  };
  editor.addEventListener('keydown', onEsc);
  bar.addEventListener('keydown', onEsc);
  document.addEventListener(EVENT, (e) => setOpen(true, { focus: e.detail?.focus ?? null }));

  // switching between Health plans and Dental & Vision restores that tab's remembered choice (if any)
  let group = tabGroup(store.get().tab);
  store.subscribe((s) => {
    const g = tabGroup(s.tab);
    if (g === group) return;
    group = g;
    const r = loadOpenPrefs()[g];
    if (typeof r === 'boolean') setOpen(r, { animate: false });
  });

  let key = '';
  function refresh() {
    const list = summaryChips(store.get(), chipOpts());
    const next = list.map((c) => `${c.id}:${c.text}:${c.title ?? ''}:${c.tone ?? ''}`).join('|');
    if (next === key) return;
    key = next;
    chips.replaceChildren(...list.map((c) => h('li', {
      class: `sit-chip${c.tone ? ` is-${c.tone}` : ''}`, 'data-id': c.id, title: c.title ?? null,
    }, c.text)));
  }

  setOpen(expanded, { animate: false });
  paint();
  refresh();
  store.subscribe(refresh);
  return { refresh, open: (focus) => setOpen(true, { focus }), close };
}
