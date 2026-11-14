// Full benefits matrix UI: the shared toolbar (find, differences only, expand/collapse all), the saved view
// prefs, and the side-by-side panel used by the 4-plan compare view. The Compare Board renders the same
// matrix through matrixBoardSections (matrix-model.js) and reuses the toolbar from here.
import { h, svg } from './dom.js';
import { safeStorage } from '../state.js';
import { buildMatrix, filterMatrix, sanitizeMatrixPrefs, MATRIX_SECTIONS } from './matrix-model.js';
import { lookupButton, cellDecorations } from './rx-render.js';

const PREFS_KEY = 'fehb-compass:matrix-ui:v1';
const NOTE_CLAMP = 90;
const ICON_SEARCH = '<svg viewBox="0 0 16 16" aria-hidden="true" class="mx-search-icon"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4l3.4 3.4"/></svg>';
const ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true" class="mx-chev"><path d="M4 6l4 4 4-4"/></svg>';
const ICON_DIFF = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h10M3 11h6"/><circle cx="12" cy="11" r="1.6"/></svg>';

// ---------- prefs (non-shareable UI convenience: localStorage only, never the URL hash) ----------
let prefs = null;
const listeners = new Set();

export function matrixPrefs() {
  if (!prefs) {
    try { prefs = sanitizeMatrixPrefs(JSON.parse(safeStorage().get(PREFS_KEY) ?? 'null')); } catch { prefs = sanitizeMatrixPrefs(null); }
  }
  return prefs;
}

/** Merge a change into the saved prefs and tell every matrix view (compare panel and board). */
export function setMatrixPrefs(patch, source = null) {
  const cur = matrixPrefs();
  prefs = sanitizeMatrixPrefs({ ...cur, ...patch, open: { ...cur.open, ...(patch.open ?? {}) } });
  safeStorage().set(PREFS_KEY, JSON.stringify(prefs));
  for (const fn of [...listeners]) {
    try { fn(prefs, source); } catch (err) { console.error(err); }
  }
}

export function onMatrixPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const allOpen = (open) => Object.fromEntries(MATRIX_SECTIONS.map((s) => [s.id, open]));

// ---------- toolbar ----------
let uid = 0;

/**
 * createMatrixToolbar({ label, onQuery(query), onExpandAll(open) }) -> { el, sync({ hiddenRows, matched, query }) }
 * "Differences only" writes the shared prefs (both views follow). The query is per view.
 */
export function createMatrixToolbar({ label = 'Benefit details', onQuery, onExpandAll } = {}) {
  const id = `mxt${++uid}`;
  const input = h('input', {
    type: 'search', id: `${id}-q`, class: 'mx-search-input', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Find a benefit: therapy, insulin, IVF…', 'aria-describedby': `${id}-count`,
  });
  const search = h('div', { class: 'mx-search' },
    h('label', { class: 'sr-only', for: `${id}-q` }, 'Find a benefit'), svg(ICON_SEARCH), input);
  const diff = h('input', { type: 'checkbox', role: 'switch', id: `${id}-d`, class: 'mx-switch-input' });
  const sw = h('label', { class: 'mx-switch', for: `${id}-d` }, diff, h('span', { class: 'mx-switch-track', 'aria-hidden': 'true' }, h('span', { class: 'mx-switch-thumb' })),
    h('span', { class: 'mx-switch-text' }, svg(ICON_DIFF), 'Differences only'));
  const count = h('span', { class: 'mx-count', id: `${id}-count`, 'aria-live': 'polite' });
  const expand = h('button', { type: 'button', class: 'mx-btn' }, 'Expand all');
  const collapse = h('button', { type: 'button', class: 'mx-btn' }, 'Collapse all');
  const el = h('div', { class: 'mx-tools', role: 'group', 'aria-label': `${label} controls` },
    search, sw, h('span', { class: 'mx-tools-end' }, count, h('span', { class: 'mx-btns' }, expand, collapse)));

  let t = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => onQuery?.(input.value), 110);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; onQuery?.(''); }
  });
  diff.addEventListener('change', () => setMatrixPrefs({ diffOnly: diff.checked }));
  expand.addEventListener('click', () => { setMatrixPrefs({ open: allOpen(true) }, 'expand'); onExpandAll?.(true); });
  collapse.addEventListener('click', () => { setMatrixPrefs({ open: allOpen(false) }, 'expand'); onExpandAll?.(false); });

  return {
    el,
    input,
    sync({ hiddenRows = 0, matched = 0, query = '' } = {}) {
      diff.checked = matrixPrefs().diffOnly;
      const bits = [];
      if (query.trim()) bits.push(matched ? `${matched} ${matched === 1 ? 'match' : 'matches'}` : 'No matches');
      if (hiddenRows) bits.push(`${hiddenRows} identical ${hiddenRows === 1 ? 'row' : 'rows'} hidden`);
      count.textContent = bits.join(' · ');
    },
  };
}

// ---------- compare panel ----------

const BEST_WORD = { min: 'lowest', max: 'highest' };

function cellEl(c, row, isBest) {
  const kids = [c.link ? (lookupButton(c.link, { compact: true }) ?? h('span', { class: 'mx-v' }, c.display)) : h('span', { class: 'mx-v' }, c.display)];
  if (isBest) kids.push(h('span', { class: 'sr-only' }, ` (${BEST_WORD[row.dir] ?? 'best'} here)`));
  if (c.name) kids.push(h('span', { class: 'mx-name' }, c.name));
  if (c.note && c.kind !== 'text') {
    kids.push(h('span', { class: 'mx-n' }, c.note));
    if (c.note.length > NOTE_CLAMP) kids.push(h('button', { type: 'button', class: 'mx-more', 'aria-expanded': 'false' }, 'More'));
  } else if (c.kind === 'text' && c.display.length > NOTE_CLAMP) {
    kids.push(h('button', { type: 'button', class: 'mx-more', 'aria-expanded': 'false' }, 'More'));
  }
  kids.push(...cellDecorations({ cite: c.cite, badge: c.badge }));
  return h('div', {
    role: 'cell',
    class: `mx-cell k-${c.kind}${isBest ? ' is-best' : ''}`,
    title: c.text ?? 'Not listed in OPM data',
  }, kids);
}

/**
 * createMatrixPanel() -> { el, update({ plans: [{ code, name, benefits }], enrollment, status, year }) }
 * Keeps its search text and section state across updates (the compare view re-renders on every state change).
 */
export function createMatrixPanel() {
  const id = `mxp${++uid}`;
  let last = null;
  let query = '';
  const sectionsEl = h('div', { class: 'mx-sections' });
  const empty = h('div', { class: 'mx-empty', hidden: true });
  const strip = h('div', { class: 'mx-plans', 'aria-hidden': 'true' });
  const tools = createMatrixToolbar({
    label: 'Benefit details',
    onQuery: (q) => { query = q; render(); },
    onExpandAll: () => {},
  });
  const head = h('div', { class: 'mx-head' },
    h('div', { class: 'mx-head-copy' },
      h('h3', { class: 'mx-title', id: `${id}-title` }, 'Every benefit, side by side'),
      h('p', { class: 'mx-sub' }, 'Straight from OPM’s plan data. Short values first; hover or expand for the plan’s exact wording.')),
    tools.el);
  const el = h('div', { class: 'mx', role: 'region', 'aria-labelledby': `${id}-title` }, head, strip, sectionsEl, empty);

  const unsub = onMatrixPrefs((p, source) => {
    if (!el.isConnected) return;
    if (source === 'section') return; // the toggled section already animated itself
    render(source === 'expand');
  });
  void unsub;

  el.addEventListener('click', (e) => {
    const more = e.target.closest('.mx-more');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Less' : 'More';
      more.closest('.mx-cell')?.classList.toggle('is-expanded', open);
      return;
    }
    const btn = e.target.closest('.mx-sec-btn');
    if (btn) {
      const sec = btn.closest('.mx-sec');
      const open = !sec.classList.contains('is-open');
      setOpen(sec, open);
      if (!query.trim()) setMatrixPrefs({ open: { [sec.dataset.id]: open } }, 'section');
    }
    const clear = e.target.closest('.mx-clear');
    if (clear) { tools.input.value = ''; query = ''; render(); tools.input.focus(); }
  });

  function setOpen(sec, open) {
    sec.classList.toggle('is-open', open);
    sec.querySelector('.mx-sec-btn').setAttribute('aria-expanded', String(open));
    sec.querySelector('.mx-sec-body').inert = !open;
  }

  function render(fromExpand = false) {
    if (!last) return;
    const { plans, enrollment, status, year, extra } = last;
    const n = plans.length;
    el.style.setProperty('--cols', n);
    const matrix = buildMatrix(plans.map((p) => ({ code: p.code, benefits: p.benefits })), { year, enrollment, status, extra });
    const p = matrixPrefs();
    const f = filterMatrix(matrix, { diffOnly: p.diffOnly, query });
    tools.sync({ hiddenRows: f.hiddenRows, matched: f.matched, query });

    strip.replaceChildren(h('span', { class: 'mx-plans-label' }, 'Plan'), ...plans.map((pl) => h('span', { class: 'mx-plan' }, pl.name)));

    const prevOpen = new Map([...sectionsEl.children].map((s) => [s.dataset.id, s.classList.contains('is-open')]));
    sectionsEl.replaceChildren(...f.sections.map((s) => {
      const open = s.forcedOpen || (typeof p.open[s.id] === 'boolean' ? p.open[s.id] : s.open);
      const bodyId = `${id}-${s.id}`;
      const differ = s.rows.filter((r) => r.differs).length;
      const meta = `${s.rows.length} ${s.rows.length === 1 ? 'row' : 'rows'}${n > 1 ? ` · ${differ} differ` : ''}`;
      const btn = h('button', { type: 'button', class: 'mx-sec-btn', 'aria-expanded': String(open), 'aria-controls': bodyId },
        svg(ICON_CHEV), h('span', { class: 'mx-sec-title' }, s.title), h('span', { class: 'mx-sec-meta' }, meta));
      const table = h('div', { role: 'table', class: 'mx-table', 'aria-label': s.title },
        h('div', { role: 'row', class: 'mx-colheads' },
          h('span', { role: 'columnheader', class: 'sr-only' }, 'Benefit'),
          plans.map((pl) => h('span', { role: 'columnheader', class: 'sr-only' }, pl.name))),
        s.rows.map((r) => {
          const best = new Set(r.best);
          return h('div', { role: 'row', class: `mx-row${r.differs && n > 1 ? ' is-diff' : ''}` },
            h('div', { role: 'rowheader', class: 'mx-label', title: r.hint ? (r.source === 'extra' ? r.hint : `OPM field: ${r.hint}`) : undefined },
              r.differs && n > 1 && h('span', { class: 'mx-diff', title: 'Plans differ here' }, h('span', { class: 'sr-only' }, 'Plans differ: ')),
              h('span', { class: 'mx-label-text' }, r.label),
              r.sub && h('span', { class: 'mx-label-sub' }, r.sub)),
            r.cells.map((c, i) => cellEl(c, r, best.has(i))));
        }));
      const body = h('div', { class: 'mx-sec-body', id: bodyId },
        h('div', { class: 'mx-clip' }, s.note && h('p', { class: 'mx-note' }, s.note), table));
      body.inert = !open;
      const sec = h('section', {
        class: `mx-sec${s.prominent ? ' is-prominent' : ''}${open ? ' is-open' : ''}`, 'data-id': s.id,
      }, h('h4', { class: 'mx-sec-h' }, btn), body);
      // Expand all / Collapse all: start from the previous state so the height transition plays.
      if (fromExpand && prevOpen.has(s.id) && prevOpen.get(s.id) !== open) {
        sec.classList.toggle('is-open', prevOpen.get(s.id));
        requestAnimationFrame(() => requestAnimationFrame(() => setOpen(sec, open)));
      }
      return sec;
    }));

    empty.hidden = f.sections.length > 0;
    if (!f.sections.length) {
      empty.replaceChildren(
        h('p', {}, query.trim() ? `No benefit matches “${query.trim()}”.` : 'These plans list the same thing for every benefit.'),
        query.trim() ? h('button', { type: 'button', class: 'mx-btn mx-clear' }, 'Clear search') : '');
    }
    requestAnimationFrame(measure); // the panel may not be in the document yet on the first update
  }

  // Sticky offsets: the plan strip sits under the page's sticky top bar, section headers under the strip.
  function measure() {
    if (!el.isConnected) return;
    const top = document.querySelector('.topbar')?.offsetHeight ?? 0;
    el.style.setProperty('--mx-top', `${top}px`);
    el.style.setProperty('--mx-strip-h', `${strip.offsetHeight || 0}px`);
  }
  new ResizeObserver(() => measure()).observe(strip);

  return {
    el,
    update(opts) {
      last = opts;
      render();
    },
  };
}
