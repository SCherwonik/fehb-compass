// Motion helpers: FLIP reorder, number tweens, staggered entrance. Transform/opacity only.
// Every helper checks prefers-reduced-motion and degrades to an instant change (or a short fade).

export const reduceMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

let springCache = null;
/** The design system's spring curve (CSS linear()), read once; falls back to expo-out. */
export function springEasing() {
  if (springCache) return springCache;
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim();
  // WAAPI accepts linear() wherever CSS does; verify before trusting it.
  try {
    document.createElement('div').animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1, easing: v || EASE_OUT }).cancel();
    springCache = v || EASE_OUT;
  } catch {
    springCache = EASE_OUT;
  }
  return springCache;
}

// ---------- number tweens: one shared rAF loop ----------
const tweens = new Map();
let raf = 0;
const easeOutQuart = (p) => 1 - (1 - p) ** 4;

function tick(now) {
  for (const [el, t] of tweens) {
    const p = Math.min(1, (now - t.start) / t.dur);
    t.current = t.from + (t.to - t.from) * easeOutQuart(p);
    el.textContent = t.fmt(t.current);
    if (p >= 1) tweens.delete(el);
  }
  raf = tweens.size ? requestAnimationFrame(tick) : 0;
}

/**
 * Show `to` in `el`, counting from the value it showed before. Interruptible: a new target
 * continues from the on-screen number. animate=false (offscreen, first paint) sets it directly.
 */
export function tweenNumber(el, to, fmt, { animate = true, dur = 650 } = {}) {
  const running = tweens.get(el);
  const from = running ? running.current : el._num;
  el._num = to;
  if (!animate || from == null || !Number.isFinite(from) || !Number.isFinite(to) || from === to || reduceMotion()) {
    tweens.delete(el);
    el.textContent = fmt(to);
    return;
  }
  tweens.set(el, { from, to, current: from, start: performance.now(), dur, fmt });
  if (!raf) raf = requestAnimationFrame(tick);
}

// ---------- FLIP ----------
const NEAR = 0.6; // fraction of a viewport above/below that still counts as "visible enough to animate"

function nearViewport(rect, vh) {
  return rect.bottom > -vh * NEAR && rect.top < vh * (1 + NEAR);
}

/**
 * FLIP step 1. Read where the visible children of `list` are right now (including any in-flight
 * transform, so an interrupted re-rank continues smoothly). Call BEFORE mutating cards: on a clean
 * layout this read is nearly free, after style writes it would force a full recalc.
 */
export function measure(list) {
  const first = new Map();
  if (reduceMotion()) return first;
  const vh = window.innerHeight;
  for (const el of list.children) {
    const r = el.getBoundingClientRect();
    if (nearViewport(r, vh)) first.set(el, r.top);
  }
  return first;
}

/**
 * FLIP step 2. Put `els` into `list` in order (moving, inserting, removing as needed) and animate:
 * cards that stay near the viewport glide from their old spot; cards that arrive near it fade up.
 * Offscreen cards move instantly, so the cost is bounded by what is visible, not by list length.
 */
export function reorder(list, els, first = new Map(), { stagger = 28, maxStagger = 8 } = {}) {
  // Cancel our own in-flight moves by reference (el.getAnimations() would force a style flush).
  for (const el of first.keys()) { el._flip?.cancel(); el._flip = null; }

  const keep = new Set(els);
  for (const el of [...list.children]) if (!keep.has(el)) el.remove();
  els.forEach((el, i) => {
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] ?? null);
  });

  if (reduceMotion()) return;

  // Last + Invert + Play. All reads before any write.
  const vh = window.innerHeight;
  const moves = [];
  let entering = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.top > vh * (1 + NEAR)) break; // list is in order: nothing further down is visible
    if (!nearViewport(r, vh)) continue;
    if (first.has(el)) {
      const dy = first.get(el) - r.top;
      if (Math.abs(dy) > 1) moves.push([el, dy]);
    } else {
      moves.push([el, null, Math.min(entering++, maxStagger)]);
    }
  }
  const spring = springEasing();
  for (const [el, dy, n] of moves) {
    const a = dy !== null
      ? el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 560, easing: spring })
      : el.animate(
        [{ opacity: 0, transform: 'translateY(14px) scale(0.985)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, delay: n * stagger, easing: EASE_OUT, fill: 'backwards' },
      );
    a.id = dy !== null ? 'flip' : 'enter';
    el._flip = a;
    a.onfinish = () => { if (el._flip === a) el._flip = null; };
  }
}

export function flipReorder(list, els, opts) {
  reorder(list, els, measure(list), opts);
}

/** Quick spring "pop" for feedback (selection badges, counters). */
export function pop(el, scale = 1.18) {
  if (!el || reduceMotion()) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }],
    { duration: 380, easing: EASE_OUT });
}

/** Horizontal nudge to say "no" (e.g. compare is full). Reduced motion: a brief opacity blink. */
export function nudge(el) {
  if (!el) return;
  if (reduceMotion()) {
    el.animate([{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], { duration: 240 });
    return;
  }
  el.animate([
    { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' },
    { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' },
  ], { duration: 360, easing: 'ease-out' });
}
