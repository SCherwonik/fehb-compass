// Compare Board: a horizontally scrolling ranked board. One column per plan (leftmost = best),
// a sticky row-label column, sticky column headers, group bands, sections of rows.
// Generic: rows/sections/headers come in as data (see board-model.js), so the dental/vision tab
// can reuse it with its own sections and header().
//
// Structure: a real <table> (caption, <th scope=col|row|rowgroup>; group bands are scope=col with colspan) inside a focusable scroller,
// so screen readers announce row and column labels for every cell.
//
// Scale: "Everything" can mean ~120 columns x ~30 rows. Column headers are always rendered (cheap, and
// they carry rank/name/total), but body cells are filled lazily: only columns within the viewport plus
// BUFFER columns either side get content; the rest stay as empty <td>s (a fixed column width keeps the
// layout exact, so the window is pure arithmetic on scrollLeft, no observers). Filled columns that
// leave the window keep their content until the next data update, when out-of-window columns are
// emptied again. So the DOM stays bounded by what the user has actually looked at, and re-ranks touch
// only visible columns. FLIP animations run only for columns inside the viewport.
import { h, svg } from './dom.js';
import { bestInRow } from './board-model.js';
import { usd } from './format.js';
import { tweenNumber, reduceMotion, springEasing, EASE_OUT } from './motion.js';
import { lookupButton, cellDecorations } from './rx-render.js';

const BUFFER = 4;
const ICON_L = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>';
const ICON_R = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.9v.1"/></svg>';
const ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true" class="mx-chev"><path d="M4 6l4 4 4-4"/></svg>';
const ICON_FULL = '<svg viewBox="0 0 16 16" aria-hidden="true" class="bd-full-open"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true" class="bd-full-close"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const NOTE_CLAMP = 90; // characters before a cell note gets a "More" toggle (CSS clamps it to 3 lines)

let uid = 0;
// Row keys can hold OPM field names (spaces, brackets): make them safe for id and aria-controls (IDREFS).
const idSafe = (k) => String(k).replace(/[^A-Za-z0-9_-]+/g, '_');

/**
 * createBoard({ label, hooks, legend }) -> { el, update(opts) }
 * legend: [[dotClass, text]] for the corner key (default: premium / expected care / account money).
 * hooks: { [cell.hook]: (row, td, cell) => void } custom renderers (e.g. the formulary task).
 * onSectionToggle(sectionKey, open): called when the user opens or closes a collapsible section.
 * Sections may be collapsible ({ collapsible, open, prominent, note, count }); row definitions may carry
 * `differs` (marked in the label), `labelSub`, and `bestOf(cells) -> Set` (a custom best-in-row rule).
 * Cell descriptors may carry `kind` (styled k-<kind>) and `note` (clamped to 3 lines with a More toggle).
 * update({ groups: [{key,label,rows,total,note?}], sections, header(row, group) -> descriptor, ctx,
 *          summary, animate = true, enter = false, sectionMotion = false })
 * sectionMotion: sections opened by this update (Expand all) unfold with the same stagger as a single toggle.
 * Header descriptor: { title, subtitle, chips: [{text, tone}], total, totalLabel, bar: {p,o,d}, why }.
 * Rows need `code` and `rank`; `isMine` pins the column (sticky on wide screens), and so does `isEnded` (the user's
 * 2026 plan with no 2027 version: a quieter, unranked reference column, styled is-ended).
 */
const LEGEND = [['prem', 'Premium'], ['oop', 'Expected care'], ['dep', 'Account money']];
const pinnedRow = (row) => row?.isMine === true || row?.isEnded === true;

export function createBoard({ label = 'Plan comparison board', hooks = {}, onSectionToggle, legend = LEGEND } = {}) {
  const id = `bd${++uid}`;
  const caption = h('caption', { class: 'sr-only' });
  const colgroup = h('colgroup');
  const bandRow = h('tr', { class: 'bd-bands' });
  const corner = h('th', { class: 'bd-corner', scope: 'col' },
    h('span', { class: 'sr-only' }, 'Measure'),
    h('span', { class: 'bd-legend', 'aria-hidden': 'true' },
      legend.map(([dot, text]) => h('span', {}, h('i', { class: `dot dot-${dot}` }), text))));
  const headRow = h('tr', { class: 'bd-heads' }, corner);
  // A thin one-line row (rank, plan name, plan code) that stays in view while the tall header scrolls away:
  // sticky inside the full screen board, and the only part of the page-sticky copy that shows.
  const miniCorner = h('th', { class: 'bd-mini-corner', scope: 'col' }, h('span', { class: 'sr-only' }, 'Plan'));
  const miniRow = h('tr', { class: 'bd-minis', 'aria-hidden': 'true' }, miniCorner);
  const thead = h('thead', {}, bandRow, headRow, miniRow);
  const table = h('table', { class: 'bd-table' }, caption, colgroup, thead);
  const hint = h('p', { class: 'sr-only', id: `${id}-hint` }, 'Use the left and right arrow keys, Home and End to move between plans.');
  const scroller = h('div', {
    class: 'bd-scroll', tabindex: '0', role: 'region', 'aria-label': label, 'aria-describedby': `${id}-hint`,
  }, table);
  // The board has its natural height and the PAGE scrolls it; the scroller only scrolls sideways. A sideways
  // scroller cannot hold a header sticky to the page, so a copy of the header (visual only: aria-hidden, inert)
  // sticks under the situation bar while the real one is scrolled away, and follows the scroller sideways.
  const stickIn = h('div', { class: 'bd-stick-in' });
  const stick = h('div', { class: 'bd-stick', 'aria-hidden': 'true', inert: '' }, stickIn);
  const viewport = h('div', { class: 'bd-viewport' },
    stick, scroller, h('div', { class: 'bd-fade bd-fade-l', 'aria-hidden': 'true' }), h('div', { class: 'bd-fade bd-fade-r', 'aria-hidden': 'true' }));

  const summary = h('p', { class: 'bd-summary' });
  const pos = h('span', { class: 'bd-pos', 'aria-hidden': 'true' });
  const thumb = h('span', { class: 'bd-thumb' });
  const track = h('span', { class: 'bd-track', 'aria-hidden': 'true' }, thumb);
  const prev = h('button', { type: 'button', class: 'bd-nav-btn', 'aria-label': 'Show earlier plans' }, svg(ICON_L));
  const next = h('button', { type: 'button', class: 'bd-nav-btn', 'aria-label': 'Show later plans' }, svg(ICON_R));
  const nav = h('div', { class: 'bd-nav' }, pos, track, prev, next);
  const fullText = h('span', { class: 'bd-full-text' }, 'Full screen');
  const fullBtn = h('button', { type: 'button', class: 'bd-full-btn', 'aria-pressed': 'false' }, svg(ICON_FULL), svg(ICON_CLOSE), fullText);
  const el = h('section', { class: 'board' }, h('div', { class: 'bd-top' }, summary, nav, fullBtn), viewport, hint);

  // ---------- state ----------
  let cols = []; // column records in display order
  const byKey = new Map();
  let defs = []; // flat row definitions in body order
  let bodies = []; // tbody elements
  let rowEls = new Map(); // def.key -> tr
  let sectionSig = '';
  let sectionHeads = []; // th elements spanning the table (colspan updates)
  let sectionBodies = new Map(); // section key -> tbody (collapsible sections)
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
  // Cells outside the scroll window are not filled yet. Rather than read as "blank" to a screen reader, they
  // carry a visually hidden note: moving to the plan (arrow keys in the board) loads its details.
  const placeholder = () => h('span', { class: 'sr-only' }, 'Not loaded yet: move to this plan with the arrow keys to load it');
  function blank(td, base) {
    td.replaceChildren(placeholder());
    td.className = base;
    td._base = base;
    td.removeAttribute('title');
  }
  function cellOf(col, key) {
    let td = col.cells.get(key);
    if (!td) { td = h('td', { class: col.base }); blank(td, col.base); col.cells.set(key, td); }
    return td;
  }

  function renderCell(col, def, td) {
    const d = col.desc.get(def.key);
    if (!d) return;
    td.className = `${col.base}${d.best ? ' is-best' : ''}${d.tone ? ` t-${d.tone}` : ''}${d.kind ? ` k-${d.kind}` : ''}${def.strong ? ' is-strong' : ''}`;
    td._base = null;
    if (d.title) td.title = d.title; else td.removeAttribute('title');
    if (d.hook) {
      td.dataset.hook = d.hook;
      if (hooks[d.hook]) { hooks[d.hook](col.item.row, td, d); return; }
    }
    // a link cell shows its button in place of the text; cite chips and data badges follow the value
    const kids = [d.link ? (lookupButton(d.link, { compact: true }) ?? h('span', { class: 'bd-v' }, d.text)) : h('span', { class: 'bd-v' }, d.text)];
    if (d.best) kids.push(h('span', { class: 'sr-only' }, ' (best in this row)'));
    if (d.meter != null) kids.push(h('span', { class: 'bd-meter', 'aria-hidden': 'true', style: `--m:${Math.max(0, Math.min(1, d.meter)).toFixed(3)}` }));
    if (d.sub) kids.push(h('span', { class: 'bd-s' }, d.sub));
    if (d.note) {
      kids.push(h('span', { class: 'bd-note' }, d.note));
      if (d.note.length > NOTE_CLAMP) {
        const plan = col.item.row.plan?.name ?? col.item.row.code ?? '';
        kids.push(h('button', { type: 'button', class: 'bd-more', 'aria-expanded': 'false', 'aria-label': `More: ${def.label ?? 'details'}${plan ? `, ${plan}` : ''}` }, 'More'));
      }
    }
    if (d.items?.length) kids.push(h('ul', { class: 'bd-items' }, d.items.map((t) => h('li', {}, t))));
    kids.push(...cellDecorations({ cite: d.cite, badge: d.badge }));
    td.replaceChildren(...kids);
  }

  function fillColumn(col) {
    for (const def of defs) renderCell(col, def, cellOf(col, def.key));
    col.filled = true;
  }

  function clearColumn(col) {
    for (const td of col.cells.values()) {
      if (td._base !== col.base) blank(td, col.base);
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
      rankSub: h('span', { class: 'bd-rank-sub', hidden: true }),
      chips: h('ul', { class: 'bd-chips' }),
      name: h('span', { class: 'bd-name' }),
      sub: h('span', { class: 'bd-sub' }),
      num: h('span', { class: 'bd-num' }),
      numLabel: h('span', { class: 'bd-num-l' }),
      bar: h('span', { class: 'bar bd-bar', 'aria-hidden': 'true' },
        h('span', { class: 'bar-seg bar-prem' }), h('span', { class: 'bar-seg bar-oop' }), h('span', { class: 'bar-seg bar-dep' })),
      why: h('span', { class: 'bd-why' }),
      code: h('span', { class: 'bd-code' }),
      mRank: h('span', { class: 'bd-mini-rank' }),
      mName: h('span', { class: 'bd-mini-name' }),
      mCode: h('span', { class: 'bd-mini-code' }),
    };
    const mth = h('th', { scope: 'col', class: 'bd-mini', 'aria-hidden': 'true' }, h('div', { class: 'bd-mini-in' }, p.mRank, p.mName, p.mCode));
    const th = h('th', { scope: 'col', class: 'bd-head' },
      h('div', { class: 'bd-h' },
        h('div', { class: 'bd-h-top' }, p.rank, p.rankSub, p.chips),
        p.name, h('div', { class: 'bd-subline' }, p.sub, p.code),
        h('div', { class: 'bd-total' }, p.num, p.numLabel),
        p.bar, p.why));
    const col = { key, th, mth, p, cells: new Map(), desc: new Map(), filled: false, base: 'bd-cell', item: null, idx: 0, chipsKey: '' };
    byKey.set(key, col);
    return col;
  }

  function fillHeader(col, hd, scale, animateNum) {
    const { p } = col;
    const row = col.item.row;
    p.rank.replaceChildren(h('span', { class: 'sr-only' }, hd.rankPrefix ?? 'Rank '), hd.rankText ?? `#${row.rank}`);
    p.rank.classList.toggle('is-wide', Boolean(hd.rankText && hd.rankText.length > 4));
    p.rankSub.textContent = hd.rankSub ?? '';
    p.rankSub.hidden = !hd.rankSub;
    if (p.name.textContent !== hd.title) { p.name.textContent = hd.title; p.name.title = hd.title; }
    p.sub.textContent = hd.subtitle ?? '';
    // the plan code (three or four characters, e.g. 401 or V31): what the brochure and OPM's files call the plan
    const code = typeof row.code === 'string' && /^[A-Za-z0-9]{2,5}$/.test(row.code) ? row.code : '';
    p.code.textContent = code ? `Code ${code}` : '';
    p.code.hidden = !code;
    p.mRank.textContent = hd.rankText ?? `#${row.rank}`;
    p.mName.textContent = hd.title ?? '';
    p.mCode.textContent = code;
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
    sectionBodies = new Map();
    defs = [];
    for (const c of cols) { c.cells.clear(); c.filled = false; }
    for (const s of sections) {
      const bodyId = `${id}-sec-${idSafe(s.key)}`;
      const secTh = h('th', { scope: 'rowgroup', class: `bd-sec${s.prominent ? ' is-prominent' : ''}` },
        s.collapsible
          ? h('span', { class: 'bd-sec-label' },
            h('button', { type: 'button', class: 'bd-sec-toggle', 'aria-expanded': String(s.open !== false), 'aria-controls': bodyId, 'data-sec': s.key },
              svg(ICON_CHEV), h('span', { class: 'bd-sec-title' }, s.label), s.count && h('span', { class: 'bd-sec-count' }, s.count)),
            s.note && h('span', { class: 'bd-sec-note' }, s.note))
          : h('span', { class: 'bd-sec-label' }, s.label));
      sectionHeads.push(secTh);
      const tb = h('tbody', {
        id: bodyId,
        class: `bd-group bd-group-${s.key}${s.collapsible ? ' is-collapsible' : ''}${s.collapsible && s.open === false ? ' is-collapsed' : ''}${s.prominent ? ' is-prominent' : ''}`,
      }, h('tr', { class: 'bd-sec-row' }, secTh));
      if (s.collapsible) sectionBodies.set(s.key, tb);
      for (const def of s.rows) {
        defs.push(def);
        const tipId = `${id}-tip-${idSafe(def.key)}`;
        const labelTh = h('th', { scope: 'row', class: `bd-label${def.strong ? ' is-strong' : ''}` },
          h('span', { class: 'bd-label-row' },
            def.differs && h('span', { class: 'bd-diff', title: 'Plans differ here' }, h('span', { class: 'sr-only' }, 'Plans differ: ')),
            h('span', { class: 'bd-label-text' }, def.label, def.labelSub && h('span', { class: 'bd-label-sub' }, def.labelSub)),
            def.hint && h('button', {
              type: 'button', class: 'bd-hint', 'aria-expanded': 'false', 'aria-controls': tipId, 'aria-label': `About ${def.label}`,
            }, svg(ICON_INFO))),
          def.hint && h('span', { class: 'bd-tip', id: tipId, hidden: true }, def.hint));
        const tr = h('tr', { class: `bd-row${def.differs ? ' is-diff' : ''}`, 'data-key': def.key }, labelTh);
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
    syncChildren(miniRow, [miniCorner, ...cols.map((c) => c.mth)]);
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
        scope: 'col', colspan: String(g.rows.length),
        class: `bd-band${g.key === 'mine' ? ' is-mine' : ''}${g.rows[0]?.isEnded ? ' is-ended' : ''}`,
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
    stickIn.scrollLeft = scroller.scrollLeft;
    updateMini(); // a class toggle: cheap enough to run on every scroll event, no frame wait
    if (rafPending) return;
    rafPending = requestAnimationFrame(() => { rafPending = 0; fillWindow(); updateNav(); });
  }
  // full screen: the thin plan row shows only once the tall header has scrolled up to it (it always keeps its
  // 32px, so nothing jumps when it appears)
  function updateMini() {
    if (!full) { el.classList.remove('mini-on'); return; }
    const band = bandRow.offsetHeight || 0;
    const on = scroller.scrollTop > 0 && miniRow.getBoundingClientRect().top <= scroller.getBoundingClientRect().top + band + 0.5;
    el.classList.toggle('mini-on', on);
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });
  new ResizeObserver(() => { metrics = null; onScroll(); stickDirty = true; checkStick(); }).observe(scroller);

  // ---------- page-sticky header copy ----------
  let stuck = false;
  let stickDirty = true;
  let stickTimer = 0;
  const stickTop = () => parseFloat(getComputedStyle(stick).top) || 0;
  function cloneHead() {
    stickDirty = false;
    const t = h('table', { class: 'bd-table', style: table.style.cssText }, colgroup.cloneNode(true), thead.cloneNode(true));
    stickIn.replaceChildren(t);
    stickIn.scrollLeft = scroller.scrollLeft;
  }
  function checkStick() {
    if (full || el.hidden || !el.offsetParent || !cols.length) { setStuck(false); return; }
    const top = stickTop();
    const head = headRow.getBoundingClientRect();
    const end = viewport.getBoundingClientRect().bottom;
    setStuck(head.bottom < top && end > top + thead.offsetHeight);
  }
  function setStuck(on) {
    if (on && (stickDirty || !stuck)) cloneHead();
    if (on === stuck) return;
    stuck = on;
    el.classList.toggle('is-stuck', on);
  }
  let pageRaf = 0;
  const onPage = () => { if (!pageRaf) pageRaf = requestAnimationFrame(() => { pageRaf = 0; checkStick(); }); };
  window.addEventListener('scroll', onPage, { passive: true });
  window.addEventListener('resize', onPage, { passive: true });

  // ---------- full screen: the board (toolbar + columns) fills the window; Esc or Close returns ----------
  // A fixed-position overlay (not the Fullscreen API): it behaves the same everywhere, keeps Esc ours, and the
  // page underneath keeps its scroll position.
  let full = false;
  let pageY = 0;
  let returnFocus = null;
  function setFull(on) {
    if (on === full) return;
    full = on;
    if (on) {
      returnFocus = document.activeElement;
      pageY = window.scrollY;
      setStuck(false);
    }
    el.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('has-board-full', on);
    if (on) {
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', `${label} Full screen.`);
    } else {
      el.removeAttribute('role');
      el.removeAttribute('aria-modal');
      el.removeAttribute('aria-label');
    }
    fullBtn.setAttribute('aria-pressed', String(on));
    fullText.textContent = on ? 'Close' : 'Full screen';
    fullBtn.setAttribute('aria-label', on ? 'Close full screen' : 'Show the board full screen');
    metrics = null;
    fillWindow();
    updateNav();
    updateMini();
    if (on) {
      if (!reduceMotion()) el.animate([{ opacity: 0, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT });
      fullBtn.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, pageY);
      (returnFocus?.isConnected ? returnFocus : fullBtn).focus({ preventScroll: true });
      returnFocus = null;
      checkStick();
    }
  }
  fullBtn.addEventListener('click', () => setFull(!full));
  fullBtn.setAttribute('aria-label', 'Show the board full screen');
  el.addEventListener('keydown', (e) => {
    if (!full) return;
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setFull(false); return; }
    if (e.key !== 'Tab') return;
    // keep focus inside the overlay
    const f = [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled && !n.closest('[inert], [hidden]') && n.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  });
  // a board hidden while full screen (tab change, view change) gives the page back
  new MutationObserver(() => { if (full && el.hidden) setFull(false); }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  // section headers stick just under the column headers: keep that offset right when the header height changes
  new ResizeObserver(() => table.style.setProperty('--bd-thead-h', `${thead.offsetHeight}px`)).observe(thead);

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
    const more = e.target.closest('.bd-more');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Less' : 'More';
      const name = more.getAttribute('aria-label');
      if (name) more.setAttribute('aria-label', name.replace(/^(More|Less)/, open ? 'Less' : 'More'));
      more.closest('td')?.classList.toggle('is-expanded', open);
      return;
    }
    const tog = e.target.closest('.bd-sec-toggle');
    if (tog) {
      const tb = sectionBodies.get(tog.dataset.sec);
      if (!tb) return;
      const open = tb.classList.contains('is-collapsed');
      setSectionOpen(tb, tog, open, true);
      onSectionToggle?.(tog.dataset.sec, open);
      return;
    }
    const btn = e.target.closest('.bd-hint');
    if (!btn) return;
    const tip = document.getElementById(btn.getAttribute('aria-controls'));
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    tip.hidden = !open;
  });

  function setSectionOpen(tb, tog, open, animate, offset = 0) {
    if (tb.classList.contains('is-collapsed') === !open) return;
    tb.classList.toggle('is-collapsed', !open);
    tog.setAttribute('aria-expanded', String(open));
    if (open) fillWindow(); // rows that were collapsed may hold unfilled cells
    if (open && animate && !reduceMotion()) {
      [...tb.rows].slice(1, 16).forEach((tr, i) => {
        tr.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 300, delay: offset + i * 18, easing: EASE_OUT, fill: 'backwards' });
      });
    }
  }

  /** Open or close collapsible sections without rebuilding (Expand all / Collapse all). */
  function setSections(openByKey, animate = true) {
    let k = 0;
    for (const [key, tb] of sectionBodies) {
      if (!(key in openByKey)) continue;
      const tog = tb.querySelector('.bd-sec-toggle');
      const opening = tb.classList.contains('is-collapsed') && openByKey[key];
      if (tog) setSectionOpen(tb, tog, openByKey[key], animate, opening ? Math.min(k++, 6) * 40 : 0);
    }
  }

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
  function update({ groups = [], sections = [], header, ctx = {}, summary: text = '', animate = true, enter = false, sectionMotion = false } = {}) {
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
      const mine = pinnedRow(it.row);
      const ended = mine && it.row.isEnded === true ? ' is-ended' : '';
      col.base = `bd-cell${it.firstInGroup && idx > 0 ? ' is-gs' : ''}${mine ? ' is-mine' : ''}${ended}${it.row.rank === 1 ? ' is-top' : ''}`;
      col.th.className = `bd-head${it.firstInGroup && idx > 0 ? ' is-gs' : ''}${mine ? ' is-mine' : ''}${ended}${it.row.rank === 1 ? ' is-top' : ''}`;
      col.mth.className = `bd-mini${it.firstInGroup && idx > 0 ? ' is-gs' : ''}${mine ? ' is-mine' : ''}${ended}`;
      return col;
    });
    const keep = new Set(nextCols.map((c) => c.key));
    for (const [k] of byKey) if (!keep.has(k)) byKey.delete(k);
    cols = nextCols;
    const mineNow = Boolean(cols[0] && pinnedRow(cols[0].item.row));
    if (mineNow !== hasMine) { hasMine = mineNow; metrics = null; }
    el.classList.toggle('has-mine', hasMine);

    // sections
    const sig = sections.map((s) => `${s.key}:${s.rows.map((r) => r.key).join(',')}`).join('|');
    if (sig !== sectionSig) { sectionSig = sig; rebuildBody(sections); }
    else setSections(Object.fromEntries(sections.filter((s) => s.collapsible).map((s) => [s.key, s.open !== false])), sectionMotion);

    // cell descriptors + best-in-row (per group; the pinned "your plan" group is its own baseline)
    for (const g of groups) {
      const gcols = cols.filter((c) => c.item.group === g);
      for (const def of defs) {
        const cells = gcols.map((c) => def.cell(c.item.row, ctx));
        const best = g.key === 'mine' ? new Set() : def.bestOf ? def.bestOf(cells) : bestInRow(def, cells);
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
    table.style.setProperty('--bd-thead-h', `${thead.offsetHeight}px`);
    // refresh the sticky copy now and once the header numbers have finished counting
    stickDirty = true;
    checkStick();
    clearTimeout(stickTimer);
    stickTimer = setTimeout(() => { stickDirty = true; if (stuck) cloneHead(); }, 700);

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

  /** Fill the first n columns now (printing shows them whatever the scroll position). */
  function fillFirst(n) {
    for (let i = 0; i < Math.min(n, cols.length); i++) if (!cols[i].filled) fillColumn(cols[i]);
  }
  el._fillFirst = fillFirst; // reached by ui/print.js through the DOM, for every board on the page

  return { el, update, scroller, setSections, fillFirst };
}
