// Compare Board: a horizontally scrolling ranked board. One column per plan (leftmost = best),
// a sticky row-label column, sticky column headers, group bands, sections of rows.
// Generic: rows/sections/headers come in as data (see board-model.js), so the dental/vision tab
// can reuse it with its own sections and header().
//
// Structure: a real <table> (caption, <th scope=col|row|colgroup|rowgroup>) inside a focusable scroller,
// so screen readers announce row and column labels for every cell.
//
// Scale: "Everything" can mean ~120 columns x ~30 rows. Column headers are always rendered (cheap, and
// they carry rank/name/total), but body cells are filled lazily: only columns within the viewport plus
// BUFFER columns either side get content; the rest stay as empty <td>s (a fixed column width keeps the
// layout exact, so the window is pure arithmetic on scrollLeft, no observers). Filled columns that
// leave the window keep their content until the next data update, when out-of-window columns are
// emptied again. So the DOM stays bounded by what the user has actually looked at, and re-ranks touch
// only visible columns. FLIP animations run only for columns inside the viewport.
import { h, svg } from './inputs.js';
import { bestInRow } from './board-model.js';
import { usd } from './format.js';
import { tweenNumber, reduceMotion, springEasing, EASE_OUT } from './motion.js';

const BUFFER = 4;
const ICON_L = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>';
const ICON_R = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.9v.1"/></svg>';

let uid = 0;

/**
 * createBoard({ label, hooks }) -> { el, update(opts) }
 * hooks: { [cell.hook]: (row, td, cell) => void } custom renderers (e.g. the formulary task).
 * update({ groups: [{key,label,rows,total,note?}], sections, header(row, group) -> descriptor, ctx,
 *          summary, animate = true, enter = false })
 * Header descriptor: { title, subtitle, chips: [{text, tone}], total, totalLabel, bar: {p,o,d}, why }.
 * Rows need `code` and `rank`; `isMine` pins the column (sticky on wide screens).
 */
export function createBoard({ label = 'Plan comparison board', hooks = {} } = {}) {
  const id = `bd${++uid}`;
  const caption = h('caption', { class: 'sr-only' });
  const colgroup = h('colgroup');
  const bandRow = h('tr', { class: 'bd-bands' });
  const corner = h('th', { class: 'bd-corner', scope: 'col' },
    h('span', { class: 'sr-only' }, 'Measure'),
    h('span', { class: 'bd-legend', 'aria-hidden': 'true' },
      h('span', {}, h('i', { class: 'dot dot-prem' }), 'Premium'),
      h('span', {}, h('i', { class: 'dot dot-oop' }), 'Expected care'),
      h('span', {}, h('i', { class: 'dot dot-dep' }), 'Account money')));
  const headRow = h('tr', { class: 'bd-heads' }, corner);
  const thead = h('thead', {}, bandRow, headRow);
  const table = h('table', { class: 'bd-table' }, caption, colgroup, thead);
  const hint = h('p', { class: 'sr-only', id: `${id}-hint` }, 'Use the left and right arrow keys, Home and End to move between plans.');
  const scroller = h('div', {
    class: 'bd-scroll', tabindex: '0', role: 'region', 'aria-label': label, 'aria-describedby': `${id}-hint`,
  }, table);
  const viewport = h('div', { class: 'bd-viewport' },
    scroller, h('div', { class: 'bd-fade bd-fade-l', 'aria-hidden': 'true' }), h('div', { class: 'bd-fade bd-fade-r', 'aria-hidden': 'true' }));

  const summary = h('p', { class: 'bd-summary' });
  const pos = h('span', { class: 'bd-pos', 'aria-hidden': 'true' });
  const thumb = h('span', { class: 'bd-thumb' });
  const track = h('span', { class: 'bd-track', 'aria-hidden': 'true' }, thumb);
  const prev = h('button', { type: 'button', class: 'bd-nav-btn', 'aria-label': 'Show earlier plans' }, svg(ICON_L));
  const next = h('button', { type: 'button', class: 'bd-nav-btn', 'aria-label': 'Show later plans' }, svg(ICON_R));
  const nav = h('div', { class: 'bd-nav' }, pos, track, prev, next);
  const el = h('section', { class: 'board' }, h('div', { class: 'bd-top' }, summary, nav), viewport, hint);

  // ---------- state ----------
  let cols = []; // column records in display order
  const byKey = new Map();
  let defs = []; // flat row definitions in body order
  let bodies = []; // tbody elements
  let rowEls = new Map(); // def.key -> tr
  let sectionSig = '';
  let sectionHeads = []; // th elements spanning the table (colspan updates)
  let win = { start: 0, end: -1 };
  let metrics = null;
  let hasMine = false;
  let groupSig = '';

  // ---------- geometry ----------
  function measure() {
    if (!metrics) {
      const first = cols[hasMine ? Math.min(1, cols.length - 1) : 0]?.th;
      metrics = { label: corner.offsetWidth || 120, col: first?.offsetWidth || 200, pin: hasMine && cols[0] ? cols[0].th.offsetWidth : 0 };
      metrics.pinned = hasMine && cols.length > 1 && getComputedStyle(cols[0].th).left !== 'auto';
    }
    return metrics;
  }

  function computeWindow() {
    const n = cols.length;
    if (!n) return { start: 0, end: -1, vs: 0, ve: -1 };
    const m = measure();
    const s = scroller.scrollLeft;
    const w = Math.max(m.col, scroller.clientWidth - m.label);
    const vs = Math.max(0, Math.floor(s / m.col));
    const ve = Math.min(n - 1, Math.ceil((s + w) / m.col) - 1);
    return { start: Math.max(0, vs - BUFFER), end: Math.min(n - 1, ve + BUFFER), vs, ve };
  }

  // ---------- cells ----------
  function cellOf(col, key) {
    let td = col.cells.get(key);
    if (!td) { td = h('td', { class: col.base }); td._base = col.base; col.cells.set(key, td); }
    return td;
  }

  function renderCell(col, def, td) {
    const d = col.desc.get(def.key);
    if (!d) return;
    td.className = `${col.base}${d.best ? ' is-best' : ''}${d.tone ? ` t-${d.tone}` : ''}${def.strong ? ' is-strong' : ''}`;
    td._base = null;
    if (d.title) td.title = d.title; else td.removeAttribute('title');
    if (d.hook) {
      td.dataset.hook = d.hook;
      if (hooks[d.hook]) { hooks[d.hook](col.item.row, td, d); return; }
    }
    const kids = [h('span', { class: 'bd-v' }, d.text)];
    if (d.best) kids.push(h('span', { class: 'sr-only' }, ' (best in this row)'));
    if (d.meter != null) kids.push(h('span', { class: 'bd-meter', 'aria-hidden': 'true', style: `--m:${Math.max(0, Math.min(1, d.meter)).toFixed(3)}` }));
    if (d.sub) kids.push(h('span', { class: 'bd-s' }, d.sub));
    if (d.items?.length) kids.push(h('ul', { class: 'bd-items' }, d.items.map((t) => h('li', {}, t))));
    td.replaceChildren(...kids);
  }

  function fillColumn(col) {
    for (const def of defs) renderCell(col, def, cellOf(col, def.key));
    col.filled = true;
  }

  function clearColumn(col) {
    for (const td of col.cells.values()) {
      if (td._base !== col.base) { td.replaceChildren(); td.className = col.base; td._base = col.base; td.removeAttribute('title'); }
    }
    col.filled = false;
  }

  function fillWindow() {
    win = computeWindow();
    for (let i = win.start; i <= win.end; i++) if (!cols[i].filled) fillColumn(cols[i]);
    if (hasMine && cols[0] && !cols[0].filled) fillColumn(cols[0]); // pinned column is always on screen
  }

  // ---------- column headers ----------
  function makeCol(key) {
    const p = {
      rank: h('span', { class: 'bd-rank' }),
      chips: h('ul', { class: 'bd-chips' }),
      name: h('span', { class: 'bd-name' }),
      sub: h('span', { class: 'bd-sub' }),
      num: h('span', { class: 'bd-num' }),
      numLabel: h('span', { class: 'bd-num-l' }),
      bar: h('span', { class: 'bar bd-bar', 'aria-hidden': 'true' },
        h('span', { class: 'bar-seg bar-prem' }), h('span', { class: 'bar-seg bar-oop' }), h('span', { class: 'bar-seg bar-dep' })),
      why: h('span', { class: 'bd-why' }),
    };
    const th = h('th', { scope: 'col', class: 'bd-head' },
      h('div', { class: 'bd-h' },
        h('div', { class: 'bd-h-top' }, p.rank, p.chips),
        p.name, p.sub,
        h('div', { class: 'bd-total' }, p.num, p.numLabel),
        p.bar, p.why));
    const col = { key, th, p, cells: new Map(), desc: new Map(), filled: false, base: 'bd-cell', item: null, idx: 0, chipsKey: '' };
    byKey.set(key, col);
    return col;
  }

  function fillHeader(col, hd, scale, animateNum) {
    const { p } = col;
    const row = col.item.row;
    p.rank.replaceChildren(h('span', { class: 'sr-only' }, 'Rank '), `#${row.rank}`);
    if (p.name.textContent !== hd.title) { p.name.textContent = hd.title; p.name.title = hd.title; }
    p.sub.textContent = hd.subtitle ?? '';
    const ck = (hd.chips ?? []).map((c) => `${c.tone}:${c.text}`).join('|');
    if (ck !== col.chipsKey) {
      col.chipsKey = ck;
      p.chips.replaceChildren(...(hd.chips ?? []).map((c) => h('li', { class: `bd-chip bd-chip-${c.tone ?? 'plain'}` }, c.text)));
    }
    tweenNumber(p.num, hd.total, usd, { animate: animateNum });
    p.numLabel.textContent = hd.totalLabel ?? '';
    const b = hd.bar ?? { p: 0, o: 0, d: 0 };
    const f = (n) => (Math.max(0, n || 0) / scale).toFixed(4);
    p.bar.style.cssText = `--p:${f(b.p)};--o:${f(b.o)};--d:${f(b.d)};--g:${f((b.p || 0) + (b.o || 0))}`;
    p.why.textContent = hd.why ?? '';
  }

  // ---------- body structure (rebuilt only when the set of sections/rows changes) ----------
  function rebuildBody(sections) {
    for (const b of bodies) b.remove();
    bodies = [];
    rowEls = new Map();
    sectionHeads = [];
    defs = [];
    for (const c of cols) { c.cells.clear(); c.filled = false; }
    for (const s of sections) {
      const secTh = h('th', { scope: 'rowgroup', class: 'bd-sec' }, h('span', { class: 'bd-sec-label' }, s.label));
      sectionHeads.push(secTh);
      const tb = h('tbody', { class: `bd-group bd-group-${s.key}` }, h('tr', { class: 'bd-sec-row' }, secTh));
      for (const def of s.rows) {
        defs.push(def);
        const tipId = `${id}-tip-${def.key}`;
        const labelTh = h('th', { scope: 'row', class: `bd-label${def.strong ? ' is-strong' : ''}` },
          h('span', { class: 'bd-label-row' },
            h('span', { class: 'bd-label-text' }, def.label),
            def.hint && h('button', {
              type: 'button', class: 'bd-hint', 'aria-expanded': 'false', 'aria-controls': tipId, 'aria-label': `About ${def.label}`,
            }, svg(ICON_INFO))),
          def.hint && h('span', { class: 'bd-tip', id: tipId, hidden: true }, def.hint));
        const tr = h('tr', { class: 'bd-row', 'data-key': def.key }, labelTh);
        rowEls.set(def.key, tr);
        tb.append(tr);
      }
      bodies.push(tb);
      table.append(tb);
    }
  }

  function placeCells() {
    const n = cols.length;
    for (const th of sectionHeads) th.colSpan = n + 1;
    const want = [corner, ...cols.map((c) => c.th)];
    syncChildren(headRow, want);
    for (const def of defs) {
      const tr = rowEls.get(def.key);
      syncChildren(tr, [tr.firstChild, ...cols.map((c) => cellOf(c, def.key))]);
    }
    while (colgroup.children.length > n + 1) colgroup.lastChild.remove();
    if (!colgroup.children.length) colgroup.append(h('col', { class: 'bd-col-label' }));
    while (colgroup.children.length < n + 1) colgroup.append(h('col', { class: 'bd-col' }));
    table.style.setProperty('--n', n);
  }

  function syncChildren(parent, want) {
    want.forEach((node, i) => { if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null); });
    while (parent.children.length > want.length) parent.lastChild.remove();
  }

  function renderBands(groups) {
    const show = groups.length > 1;
    el.classList.toggle('has-bands', show);
    if (!show) { bandRow.replaceChildren(); return; }
    bandRow.replaceChildren(
      h('td', { class: 'bd-band-corner' }),
      ...groups.map((g) => h('th', {
        scope: 'colgroup', colspan: String(g.rows.length),
        class: `bd-band${g.key === 'mine' ? ' is-mine' : ''}`,
      }, h('span', { class: 'bd-band-label' },
        h('span', { class: 'bd-band-name' }, g.label),
        h('span', { class: 'bd-band-count' }, g.note ?? (g.total > g.rows.length ? `best ${g.rows.length} of ${g.total}` : `${g.rows.length} ${g.rows.length === 1 ? 'plan' : 'plans'}`))))));
  }

  // ---------- nav ----------
  function updateNav() {
    const m = measure();
    const s = scroller.scrollLeft;
    const max = scroller.scrollWidth - scroller.clientWidth;
    const canL = s > 1;
    const canR = s < max - 1;
    viewport.classList.toggle('can-l', canL);
    viewport.classList.toggle('can-r', canR);
    prev.disabled = !canL;
    next.disabled = !canR;
    const n = cols.length;
    const scrollable = max > 1;
    nav.classList.toggle('is-static', !scrollable);
    const off = m.pinned ? 1 : 0;
    const vis = Math.max(1, Math.floor((scroller.clientWidth - m.label - (m.pinned ? m.pin : 0)) / m.col + 0.15));
    let first = Math.min(n, Math.round(s / m.col) + off + 1);
    let last = Math.min(n, first - 1 + vis);
    if (!canR) { last = n; first = Math.max(1, n - vis + 1); }
    const range = first === last ? `${first}` : `${first}–${last}`;
    pos.textContent = n ? (scrollable ? `${range} of ${n}` : `${n} ${n === 1 ? 'plan' : 'plans'}`) : '';
    const r = Math.min(1, scroller.clientWidth / Math.max(1, scroller.scrollWidth));
    thumb.style.width = `${(r * 100).toFixed(2)}%`;
    thumb.style.transform = `translateX(${(max > 0 ? (s / max) * (1 / r - 1) * 100 : 0).toFixed(2)}%)`;
  }

  let rafPending = 0;
  function onScroll() {
    if (rafPending) return;
    rafPending = requestAnimationFrame(() => { rafPending = 0; fillWindow(); updateNav(); });
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });
  new ResizeObserver(() => { metrics = null; onScroll(); }).observe(scroller);

  function scrollToCol(i) {
    const m = measure();
    const n = cols.length;
    // with the user's plan pinned (sticky), column i sits flush against it at scrollLeft (i - 1) * col
    const off = m.pinned ? 1 : 0;
    const target = Math.max(0, Math.min(n - 1, i) - off) * m.col;
    scroller.scrollTo({ left: target, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  const currentCol = () => Math.round(scroller.scrollLeft / measure().col) + (measure().pinned ? 1 : 0);
  const pageCols = () => {
    const m = measure();
    return Math.max(1, Math.floor((scroller.clientWidth - m.label - (m.pinned ? m.pin : 0)) / m.col));
  };
  prev.addEventListener('click', () => scrollToCol(currentCol() - pageCols()));
  next.addEventListener('click', () => scrollToCol(currentCol() + pageCols()));

  scroller.addEventListener('keydown', (e) => {
    if (e.target !== scroller || e.altKey || e.ctrlKey || e.metaKey) return;
    const moves = { ArrowRight: () => currentCol() + 1, ArrowLeft: () => currentCol() - 1, Home: () => 0, End: () => cols.length - 1 };
    const fn = moves[e.key];
    if (!fn) return;
    e.preventDefault();
    scrollToCol(fn());
  });

  // Row-label info toggles.
  table.addEventListener('click', (e) => {
    const btn = e.target.closest('.bd-hint');
    if (!btn) return;
    const tip = document.getElementById(btn.getAttribute('aria-controls'));
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    tip.hidden = !open;
  });

  // ---------- pointer drag (mouse only; touch and trackpads scroll natively with momentum) ----------
  let drag = null;
  let glide = 0;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button, a, input, select')) return;
    cancelAnimationFrame(glide);
    drag = { x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop, moved: false, v: 0, t: performance.now(), lx: e.clientX, id: e.pointerId };
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      scroller.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    }
    const now = performance.now();
    const dt = Math.max(1, now - drag.t);
    drag.v = 0.8 * ((e.clientX - drag.lx) / dt) + 0.2 * drag.v;
    drag.t = now;
    drag.lx = e.clientX;
    scroller.scrollLeft = drag.sl - dx;
    scroller.scrollTop = drag.st - dy;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    // swallow the click that ends a drag
    const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
    scroller.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => scroller.removeEventListener('click', swallow, { capture: true }), 0);
    let v = reduceMotion() ? 0 : Math.max(-4, Math.min(4, -d.v)); // px per ms, in scroll direction, capped
    let last = performance.now();
    const settle = () => {
      // land on the nearest column, then hand control back to CSS scroll-snap
      scrollToCol(currentCol());
      setTimeout(() => el.classList.remove('is-dragging'), reduceMotion() ? 0 : 380);
    };
    const step = (now) => {
      const dt = now - last;
      last = now;
      const was = scroller.scrollLeft;
      scroller.scrollLeft += v * dt;
      v *= Math.pow(0.94, dt / 16);
      const stuck = Math.abs(scroller.scrollLeft - was) < 0.5; // hit an edge
      if (Math.abs(v) > 0.05 && !stuck) glide = requestAnimationFrame(step); else settle();
    };
    if (Math.abs(v) > 0.05) glide = requestAnimationFrame(step); else settle();
  };
  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);

  // ---------- update ----------
  let first = true;
  function update({ groups = [], sections = [], header, ctx = {}, summary: text = '', animate = true, enter = false } = {}) {
    // A different set of groups (the "Show" mode changed) starts again from the left edge.
    const gsig = groups.map((g) => g.key).join('|');
    const regroup = !first && gsig !== groupSig;
    groupSig = gsig;
    if (regroup && scroller.scrollLeft > 0) { scroller.scrollLeft = 0; win = computeWindow(); }
    const motion = !reduceMotion() && animate && !first;
    const entering = !reduceMotion() && (enter || first);

    // FLIP "first": where visible columns are now (read before any write)
    const before = new Map();
    if (motion && !enter) for (let i = win.vs; i <= win.ve; i++) if (cols[i]) before.set(cols[i].key, cols[i].th.getBoundingClientRect().left);

    // columns
    const items = [];
    for (const g of groups) g.rows.forEach((row, ri) => items.push({ row, group: g, firstInGroup: ri === 0 }));
    const seen = new Set();
    const nextCols = items.map((it, idx) => {
      let key = it.row.code;
      if (seen.has(key)) key = `${it.group.key}:${key}`;
      seen.add(key);
      const col = byKey.get(key) ?? makeCol(key);
      col.item = it;
      col.idx = idx;
      const mine = it.row.isMine === true;
      col.base = `bd-cell${it.firstInGroup && idx > 0 ? ' is-gs' : ''}${mine ? ' is-mine' : ''}${it.row.rank === 1 ? ' is-top' : ''}`;
      col.th.className = `bd-head${it.firstInGroup && idx > 0 ? ' is-gs' : ''}${mine ? ' is-mine' : ''}${it.row.rank === 1 ? ' is-top' : ''}`;
      return col;
    });
    const keep = new Set(nextCols.map((c) => c.key));
    for (const [k] of byKey) if (!keep.has(k)) byKey.delete(k);
    cols = nextCols;
    const mineNow = Boolean(cols[0]?.item.row.isMine);
    if (mineNow !== hasMine) { hasMine = mineNow; metrics = null; }
    el.classList.toggle('has-mine', hasMine);

    // sections
    const sig = sections.map((s) => `${s.key}:${s.rows.map((r) => r.key).join(',')}`).join('|');
    if (sig !== sectionSig) { sectionSig = sig; rebuildBody(sections); }

    // cell descriptors + best-in-row (per group; the pinned "your plan" group is its own baseline)
    for (const g of groups) {
      const gcols = cols.filter((c) => c.item.group === g);
      for (const def of defs) {
        const cells = gcols.map((c) => def.cell(c.item.row, ctx));
        const best = g.key === 'mine' ? new Set() : bestInRow(def, cells);
        gcols.forEach((c, i) => c.desc.set(def.key, { ...cells[i], best: best.has(i) }));
      }
    }

    placeCells();
    renderBands(groups);
    summary.textContent = text;
    caption.textContent = `${text} Plans are columns, best estimated yearly total first.`;

    const scale = Math.max(1, ...cols.map((c) => (c.item.row.cost?.premium ?? 0) + (c.item.row.cost?.oop ?? 0)));
    for (const c of cols) {
      const inView = c.idx >= win.vs && c.idx <= win.ve;
      fillHeader(c, header(c.item.row, c.item.group), scale, motion && inView);
    }

    metrics = null;
    for (const c of cols) c.filled = false;
    fillWindow();
    for (const c of cols) if (!c.filled) clearColumn(c);
    updateNav();

    // FLIP "last/invert/play" for columns now in view
    if (motion || entering) {
      const spring = springEasing();
      const moves = [];
      for (let i = win.vs; i <= win.ve; i++) {
        const c = cols[i];
        if (!c) continue;
        if (before.has(c.key)) {
          const dx = before.get(c.key) - c.th.getBoundingClientRect().left;
          if (Math.abs(dx) > 1) moves.push([c, dx]);
        } else moves.push([c, null]);
      }
      let n = 0;
      for (const [c, dx] of moves) {
        const targets = [c.th, ...(c.filled ? c.cells.values() : [])];
        const delay = dx === null ? Math.min(n++, 8) * (entering ? 45 : 30) : 0;
        for (const t of targets) {
          t._flip?.cancel();
          t._flip = dx !== null
            ? t.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 560, easing: spring })
            : t.animate([{ opacity: 0, transform: `translateX(${entering ? 28 : 12}px)` }, { opacity: 1, transform: 'none' }],
              { duration: 460, delay, easing: EASE_OUT, fill: 'backwards' });
        }
      }
    }
    first = false;
  }

  return { el, update, scroller };
}
