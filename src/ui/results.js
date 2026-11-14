// Ranked results: header + toolbar, savings banner, compare view, keyed card list or the Compare Board, compare tray.
// Cards are keyed by plan code and updated in place; reordering uses FLIP limited to visible cards.
import { h, svg, segmented, ICON_CHECK, ICON_CHEVRON, mineSwitch } from './inputs.js';
import { assumptionChips, describeUsage, effectiveUsage, overrideChanges } from './assumptions.js';
import { computeRows, savingsVsCurrent, availablePlans, SORTS, rankWithMine } from './model.js';
import { GROUP_LABELS, GROUP_MODES } from './grouping.js';
import { createResultsBoard, mineNoteText } from './results-board.js';
import { renderCompare, revealCompare } from './compare.js';
import { FLAG_TEXT } from '../engine/diff.js';
import { ASSUMED_PRICES, ASSUMPTIONS_NOTE } from '../engine/assumptions.js';
import { STATE_NAMES } from '../data.js';
import { MAX_COMPARE, safeStorage } from '../state.js';
import { usd, usdExact, signedUsd, signedPct, costShareSummary, deltaTone } from './format.js';
import { measure, reorder, tweenNumber, pop, nudge, reduceMotion, EASE_OUT } from './motion.js';

const UI_KEY = 'fehb-compass:results-ui:v1';
const ENROLLMENT_TEXT = { self: 'self only', self_plus_one: 'self plus one', family: 'family' };
const SCENARIO_TEXT = { healthy: 'healthy', typical: 'typical', condition: 'managing a condition', worst: 'worst case', nothing: 'start-from-nothing' };
/** "typical year", or "your own year" once overrides or custom lines change the scenario. */
const yearText = (state) => (state.custom.length || overrideChanges(state).length
  ? (state.scenario === 'nothing' ? 'your own costs' : `${SCENARIO_TEXT[state.scenario]} year, adjusted`)
  : `${SCENARIO_TEXT[state.scenario]} year`);
const TYPES = [['all', 'All'], ['FFS', 'FFS'], ['HMO', 'HMO'], ['HDHP', 'HDHP']];
const PRICE_LABELS = {
  pcpVisit: 'Primary care visit', specialistVisit: 'Specialist visit', erVisit: 'Emergency room visit',
  inpatientStay: 'Hospital stay (facility)', surgery: 'Surgery during a stay', lab: 'Lab or X-ray',
  imaging: 'MRI or CT scan', rxGenericFill: 'Generic prescription fill',
};

const ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-chev"><path d="M4 6l4 4 4-4"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-warn"><path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.6v3.2M8 11.6v.1"/></svg>';
const ICON_ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-arrow"><path d="M3 8h9.5M8.5 4l4 4-4 4"/></svg>';

function loadUi() {
  try {
    const v = JSON.parse(safeStorage().get(UI_KEY) ?? '{}');
    return {
      sort: SORTS[v.sort] ? v.sort : 'total',
      type: TYPES.some(([t]) => t === v.type) ? v.type : 'all',
    };
  } catch {
    return { sort: 'total', type: 'all' };
  }
}

/**
 * createResults(main, { store }) -> { setData(data), showError(err) }
 * Before setData the static skeleton in index.html stays on screen.
 */
export function createResults(main, { store }) {
  const ui = { ...loadUi(), compareOpen: false };
  let data = null;
  const cards = new Map(); // code -> card record
  const visible = new Set(); // card elements intersecting the viewport (count-up only runs there)
  let io = null;

  // ---------- static frame ----------
  const title = h('h2', { class: 'rhead-title', id: 'results-title' });
  const sub = h('p', { class: 'rhead-sub' });
  const filtered = h('p', { class: 'rhead-filtered', hidden: true });
  const infoBtn = h('button', { type: 'button', class: 'info-toggle', 'aria-expanded': 'false', 'aria-controls': 'counted-note' }, 'What’s counted?');
  const infoNote = h('p', { class: 'counted-note', id: 'counted-note', hidden: true });
  const countRow = h('div', { class: 'rhead-count' }, filtered, infoBtn);
  infoBtn.addEventListener('click', () => {
    const open = infoNote.hidden;
    infoNote.hidden = !open;
    infoBtn.setAttribute('aria-expanded', String(open));
    if (open && !reduceMotion()) {
      infoNote.animate([{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_OUT });
    }
  });
  const sortCtl = segmented({
    name: 'sort', legend: 'Sort by',
    options: Object.entries(SORTS).map(([k, v]) => [k, k === 'oopMax' ? 'OOP max' : v.label.replace('Total cost', 'Total')]),
  });
  const typeCtl = segmented({ name: 'ptype', legend: 'Plan type', options: TYPES });
  sortCtl.el.classList.add('tool');
  typeCtl.el.classList.add('tool');
  const viewCtl = segmented({ name: 'view', legend: 'View', options: [['cards', 'Cards'], ['board', 'Board']] });
  viewCtl.el.classList.add('tool', 'tool-view');
  const groupSel = h('select', { id: 'board-group', class: 'select' },
    GROUP_MODES.map((m) => h('option', { value: m }, GROUP_LABELS[m])));
  const groupCtl = h('div', { class: 'field tool tool-select' },
    h('label', { class: 'field-label', for: 'board-group' }, 'Show'),
    h('div', { class: 'select-wrap' }, groupSel, svg(ICON_CHEVRON)));
  const mineCtl = mineSwitch('rt-mine', { compact: true });
  mineCtl.el.classList.add('tool');
  const mineNote = h('p', { class: 'rhead-mine', hidden: true });
  const assume = h('ul', { class: 'assume', 'aria-label': 'Your assumptions' });
  let assumeKey = '';
  const head = h('header', { class: 'rhead' },
    h('div', { class: 'rhead-copy' }, title, countRow, infoNote, sub, assume, mineNote),
    h('div', { class: 'rtools' }, viewCtl.el, groupCtl, sortCtl.el, typeCtl.el, mineCtl.el));
  const board = createResultsBoard();

  const savings = h('section', { class: 'savings', hidden: true, 'aria-live': 'polite' });
  const compare = h('section', { class: 'compare', hidden: true, 'aria-labelledby': 'compare-title' });
  const list = h('ol', { class: 'cards', 'aria-labelledby': 'results-title' });
  const empty = h('section', { class: 'results-none', hidden: true });
  const status = h('p', { class: 'sr-only', role: 'status' });

  const trayCount = h('span', { class: 'tray-count' });
  const trayNames = h('span', { class: 'tray-names' });
  const trayOpen = h('button', { type: 'button', class: 'btn btn-primary' }, 'Compare', svg(ICON_ARROW));
  const trayClear = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Clear');
  const tray = h('div', { class: 'tray glass', role: 'region', 'aria-label': 'Plans picked to compare' },
    h('span', { class: 'tray-copy' }, trayCount, trayNames), trayClear, trayOpen);

  const frame = h('div', { class: 'results-frame' }, head, savings, compare, board.el, list, empty, status);

  // ---------- events ----------
  frame.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'sort') { ui.sort = t.value; saveUi(); render(); }
    else if (t.name === 'ptype') { ui.type = t.value; saveUi(); render(); }
    else if (t.name === 'view') store.set({ view: t.value });
    else if (t === groupSel) store.set({ group: t.value });
    else if (t === mineCtl.input) store.set({ includeMine: t.checked });
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const rec = cards.get(btn.closest('.card')?.dataset.code);
    if (!rec) return;
    if (btn.classList.contains('math-toggle')) toggleMath(rec);
    else if (btn.classList.contains('cmp-toggle')) toggleCompare(rec, btn);
  });
  trayOpen.addEventListener('click', () => openCompare());
  trayClear.addEventListener('click', () => store.set({ selectedPlans: [] }));
  empty.addEventListener('click', (e) => {
    if (e.target.closest('[data-reset]')) {
      ui.type = 'all';
      saveUi();
      store.set({ networks: [], account: 'any' });
      render();
    }
  });

  function saveUi() {
    safeStorage().set(UI_KEY, JSON.stringify({ sort: ui.sort, type: ui.type }));
  }

  function openCompare() {
    ui.compareOpen = true;
    render();
    revealCompare(compare);
    compare.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    compare.querySelector('.compare-title')?.setAttribute('tabindex', '-1');
    compare.querySelector('.compare-title')?.focus({ preventScroll: true });
  }

  // Keep keyboard focus somewhere sensible when a compare column or the panel itself goes away.
  function removeFromCompare(code) {
    const sel = store.get().selectedPlans;
    const at = sel.indexOf(code);
    store.set({ selectedPlans: sel.filter((c) => c !== code) }); // re-renders the compare grid synchronously
    const removes = compare.querySelectorAll('.cg-remove');
    const next = removes[Math.min(at, removes.length - 1)];
    (next ?? compare.querySelector('.compare-head .btn'))?.focus();
  }

  function closeCompare() {
    ui.compareOpen = false;
    const target = tray.classList.contains('is-visible') && !trayOpen.disabled ? trayOpen : title;
    if (target === title) title.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    if (reduceMotion()) { compare.hidden = true; return; }
    const a = compare.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 180, easing: 'ease-in' });
    a.onfinish = () => { if (!ui.compareOpen) compare.hidden = true; };
  }

  function toggleCompare(rec, btn) {
    const sel = store.get().selectedPlans;
    const on = sel.includes(rec.code);
    if (!on && sel.length >= MAX_COMPARE) {
      nudge(trayCount);
      nudge(btn);
      status.textContent = `Compare holds ${MAX_COMPARE} plans. Remove one first.`;
      return;
    }
    store.set({ selectedPlans: on ? sel.filter((c) => c !== rec.code) : [...sel, rec.code] });
    if (!on) {
      pop(trayCount, 1.35);
      if (!reduceMotion()) {
        rec.el.animate([{ boxShadow: '0 0 0 0 rgba(61, 99, 255, 0.45)' }, { boxShadow: '0 0 0 10px rgba(61, 99, 255, 0)' }], { duration: 520, easing: EASE_OUT });
      }
    }
  }

  function toggleMath(rec) {
    rec.open = !rec.open;
    if (rec.open) fillMath(rec);
    rec.el.classList.toggle('is-open', rec.open);
    rec.r.mathBtn.setAttribute('aria-expanded', String(rec.open));
    rec.r.mathBtn.querySelector('.btn-text').textContent = rec.open ? 'Hide the math' : 'See the math';
  }

  // ---------- cards ----------
  function makeCard(code) {
    const r = {};
    r.rank = h('span', { class: 'card-rank', 'aria-hidden': 'true' });
    r.name = h('h3', { class: 'card-name' });
    r.meta = h('p', { class: 'card-meta' });
    r.total = h('span', { class: 'card-total-num' });
    r.totalLabel = h('span', { class: 'card-total-label' }, 'per year, estimated');
    r.bar = h('div', { class: 'bar', 'aria-hidden': 'true' },
      h('span', { class: 'bar-seg bar-prem' }), h('span', { class: 'bar-seg bar-oop' }), h('span', { class: 'bar-seg bar-dep' }));
    const fact = (key, label, dot) => {
      const v = h('span', { class: 'fact-v' });
      const d = h('span', { class: 'fact-d' });
      const lab = h('span', { class: 'fact-label' });
      const box = h('div', { class: `fact fact-${key}` }, h('dt', {}, dot && h('i', { class: `dot dot-${dot}` }), lab), h('dd', {}, v, d));
      r[key] = { box, v, d, lab };
      lab.textContent = label;
      return box;
    };
    r.facts = h('dl', { class: 'facts' },
      fact('premium', 'Premium', 'prem'),
      fact('care', 'Expected care', 'oop'),
      fact('deposit', 'HSA deposit', 'dep'),
      fact('deductible', 'Deductible'),
      fact('oopMax', 'Out-of-pocket max'));
    r.share = h('p', { class: 'card-share' });
    r.chips = h('ul', { class: 'card-chips', 'aria-label': 'Notes' });
    const mathId = `math-${code}`;
    r.mathBtn = h('button', { type: 'button', class: 'btn btn-quiet math-toggle', 'aria-expanded': 'false', 'aria-controls': mathId },
      h('span', { class: 'btn-text' }, 'See the math'), svg(ICON_CHEV));
    r.cmpBtn = h('button', { type: 'button', class: 'cmp-toggle', 'aria-pressed': 'false' }, svg(ICON_CHECK), h('span', {}, 'Compare'));
    r.mathInner = h('div', { class: 'math-inner' });
    r.math = h('div', { class: 'card-math', id: mathId, role: 'region', 'aria-label': 'How this total is calculated' }, h('div', { class: 'math-clip' }, r.mathInner));

    const el = h('li', { class: 'card', 'data-code': code },
      h('div', { class: 'card-top' },
        r.rank,
        h('div', { class: 'card-id' }, r.name, r.meta),
        h('div', { class: 'card-total' }, r.total, r.totalLabel)),
      r.bar,
      r.facts,
      r.share,
      r.chips,
      h('div', { class: 'card-actions' }, r.mathBtn, r.cmpBtn),
      r.math);
    io?.observe(el);
    return { code, el, r, open: false, row: null, chipsKey: '' };
  }

  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const setClass = (el, c) => { if (el.className !== c) el.className = c; };

  function setDelta(slot, change, suffix = '') {
    if (change == null) { setText(slot, ''); setClass(slot, 'fact-d'); return; }
    const tone = deltaTone(change);
    setClass(slot, `fact-d delta delta-${tone}`);
    setText(slot, tone === 'flat' ? 'Same as 2026' : `${signedUsd(change)}${suffix} vs 2026`);
  }

  function updateCard(rec, row, rank, scale, state, animateNums) {
    const { r } = rec;
    const prev = rec.row;
    rec.row = row;
    setText(r.rank, String(rank));
    rec.el.classList.toggle('is-top', rank === 1);
    if (!prev) {
      setText(r.name, row.plan.name);
      const bits = [row.plan.type, row.plan.network_family, `code ${row.code}`];
      setText(r.meta, bits.filter(Boolean).join(' · '));
      rec.el.setAttribute('aria-label', `${row.plan.name}`);
    }
    const anim = animateNums && visible.has(rec.el);
    tweenNumber(r.total, row.cost.total, usd, { animate: anim });

    // bar: premium | expected care, with the deposit shown as a hatched portion at the end
    const gross = row.cost.premium + row.cost.oop;
    const f = (n) => (n / scale).toFixed(4);
    const barKey = `--p:${f(row.cost.premium)};--o:${f(row.cost.oop)};--d:${f(row.cost.hsaOffset)};--g:${f(gross)}`;
    if (barKey !== rec.barKey) { rec.barKey = barKey; r.bar.style.cssText = barKey; } // scoped to the bar's subtree

    tweenNumber(r.premium.v, row.cost.premium, usd, { animate: anim });
    if (row.diff.status === 'new') { setClass(r.premium.d, 'fact-d delta delta-new'); setText(r.premium.d, 'New for 2027'); }
    else setDelta(r.premium.d, row.diff.premiumChange, row.diff.premiumPct ? ` (${signedPct(row.diff.premiumPct)})` : '');
    tweenNumber(r.care.v, row.cost.oop, usd, { animate: anim });
    setText(r.care.d, yearText(state));
    setClass(r.care.d, 'fact-d');

    const raw = row.account ? row.benefits.account_contribution?.[state.enrollment] ?? 0 : 0;
    r.deposit.box.hidden = !row.account;
    if (row.account) {
      setText(r.deposit.lab, row.account === 'HRA' ? 'HRA credit used' : 'HSA deposit');
      tweenNumber(r.deposit.v, row.cost.hsaOffset > 0 ? -row.cost.hsaOffset : 0, usd, { animate: anim });
      setClass(r.deposit.d, 'fact-d');
      setText(r.deposit.d, !raw
        ? 'none listed for 2027'
        : row.account === 'HRA' && raw > row.cost.hsaOffset
          ? `of ${usd(raw)} available`
          : row.account === 'HRA' ? 'toward care costs' : 'yours to keep');
    }
    setText(r.deductible.v, usd(row.facts.deductible));
    setDelta(r.deductible.d, row.diff.deductibleChange);
    setText(r.oopMax.v, usd(row.facts.oopMax));
    setDelta(r.oopMax.d, row.diff.oopMaxChange);
    setText(r.share, costShareSummary(row.benefits, row.facts.coinsurance) || 'Cost sharing varies; see the plan brochure.');

    // chips: your plan / vs your plan, firmness, status, warnings (rebuilt only when their content changes)
    const vsMine = mine && !row.isMine ? Math.round(row.cost.total - mine.cost.total) : null;
    rec.el.classList.toggle('is-mine', Boolean(row.isMine));
    // the pinned plan sits outside the ranking: its number is the overall rank in the state
    const rankTag = row.isMine && Number.isInteger(row.globalRank)
      ? `#${row.globalRank} overall${mineFiltersOn ? (row.viewRank ? ` · #${row.viewRank} in this view` : ' · outside your filters') : ''}`
      : '';
    const oon = row.cost.breakdown.oonEstimate === true;
    const key = `${row.isMine ? `mine:${mineWhere}:${rankTag}` : ''}|${vsMine}|${row.cost.firmness}|${row.diff.status}|${row.diff.flags.join(',')}|${oon}`;
    if (key !== rec.chipsKey) {
      rec.chipsKey = key;
      const items = [
        row.isMine && h('li', { class: 'tag tag-mine' }, 'Your plan · 2027'),
        rankTag && h('li', { class: 'tag' }, rankTag),
        row.isMine && mineWhere && h('li', { class: 'tag' }, `Not listed for ${mineWhere}`),
        vsMine != null && h('li', { class: `tag tag-vs tag-vs-${deltaTone(vsMine)}`, title: 'Estimated yearly total compared with your plan in 2027' },
          deltaTone(vsMine) === 'flat' ? 'Same as your plan' : `${signedUsd(vsMine)} vs your plan`),
        row.cost.firmness === 'fixed'
          ? h('li', { class: 'tag tag-fixed', title: 'Every service in this scenario is a flat copay, so this total does not depend on assumed prices.' }, 'Fixed cost')
          : h('li', { class: 'tag tag-est', title: 'Part of this total depends on assumed prices for care. See the math.' }, 'Estimated'),
        oon && h('li', { class: 'tag tag-warn', title: 'Out-of-network lines are counted at full cost: OPM publishes no out-of-network cost sharing. See the math.' },
          svg(ICON_WARN), 'Out-of-network estimate'),
        row.diff.status === 'new' && h('li', { class: 'tag tag-new' }, 'New for 2027'),
        ...row.diff.flags.map((f) => h('li', { class: 'tag tag-warn' }, svg(ICON_WARN), FLAG_TEXT[f] ?? f)),
      ];
      r.chips.replaceChildren(...items.filter(Boolean));
    }

    const selected = state.selectedPlans.includes(row.code);
    rec.el.classList.toggle('is-selected', selected);
    r.cmpBtn.setAttribute('aria-pressed', String(selected));
    r.cmpBtn.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${row.plan.name} ${selected ? 'from' : 'to'} compare`);

    if (rec.open) fillMath(rec);
  }

  function mathLine(label, value, cls = '') {
    return h('div', { class: `math-line ${cls}` }, h('span', { class: 'math-label' }, label), h('span', { class: 'math-val' }, value));
  }

  function fillMath(rec) {
    const row = rec.row;
    const state = store.get();
    if (!row) return;
    const { cost } = row;
    const b = cost.breakdown;
    const rate = data.rates[2027][row.code][state.enrollment];
    const premiumHow = state.status === 'retiree'
      ? `${usdExact(rate.monthly_retiree)} a month × 12`
      : `${usdExact(rate.biweekly_active)} per paycheck × 26`;
    const careSum = b.deductiblePaid + b.coinsurancePaid + b.copays + (b.oonPaid || 0);
    const hitMax = b.oopMax != null && cost.oop >= b.oopMax - 0.5;
    const raw = row.account ? row.benefits.account_contribution?.[state.enrollment] ?? 0 : 0;

    const lines = [
      mathLine(h('span', {}, h('i', { class: 'dot dot-prem' }), 'Premium ', h('span', { class: 'math-how' }, premiumHow)), usd(cost.premium)),
      mathLine(h('span', {}, h('i', { class: 'dot dot-oop' }), 'Expected care costs'), `+ ${usd(cost.oop)}`),
      mathLine('Toward the deductible', usd(b.deductiblePaid), 'math-sub'),
      mathLine('Coinsurance', usd(b.coinsurancePaid), 'math-sub'),
      mathLine('Copays', usd(b.copays), 'math-sub'),
      b.oonPaid > 0 && mathLine('Out of network, at full cost', usd(b.oonPaid), 'math-sub'),
      hitMax &&mathLine(`Capped at the ${usd(b.oopMax)} out-of-pocket max`, '', 'math-sub math-note'),
      Math.abs(careSum - cost.oop) > 1 && mathLine('Rounding', usd(cost.oop - careSum), 'math-sub'),
      row.account && mathLine(
        h('span', {}, h('i', { class: 'dot dot-dep' }), row.account === 'HRA' ? 'HRA credit used ' : 'HSA deposit ',
          h('span', { class: 'math-how' }, row.account === 'HRA'
            ? `${usd(raw)} available; only counts against care costs`
            : 'the plan puts this in your account')),
        `− ${usd(cost.hsaOffset)}`),
      mathLine('Estimated yearly total', usd(cost.total), 'math-total'),
    ].filter(Boolean);

    const prices = Object.entries(ASSUMED_PRICES).map(([k, v]) =>
      h('li', {}, h('span', {}, PRICE_LABELS[k] ?? k), h('span', { class: 'num' }, usd(v))));

    // custom lines: what each one adds to this plan's care costs, with its own notes and warnings
    const customs = b.custom ?? [];
    const lineMsgs = new Set(customs.flatMap((c) => c.warnings));
    const otherWarnings = b.warnings.filter((w) => !lineMsgs.has(w));
    const customBlock = customs.length > 0 && [
      h('p', { class: 'math-h' }, 'Your own costs'),
      h('ul', { class: 'math-custom' }, customs.map((c) => h('li', { class: c.warnings.length ? 'has-warn' : '' },
        h('div', { class: 'mc-row' },
          h('span', { class: 'mc-name' }, c.label,
            h('span', { class: 'math-how' }, `${c.perYear} × ${usdExact(c.price)}${c.outOfNetwork ? ', out of network' : ''}`)),
          h('span', { class: 'num mc-cost' }, `+ ${usd(c.cost)}`)),
        [...c.warnings.map((w) => h('p', { class: 'mc-warn' }, svg(ICON_WARN), w)),
          ...c.notes.map((n) => h('p', { class: 'mc-note' }, n))]))),
    ];
    const changes = overrideChanges(state);

    rec.r.mathInner.replaceChildren(
      h('div', { class: 'math-sum' }, lines),
      h('div', { class: 'math-notes' },
        h('p', { class: 'math-h' }, state.scenario === 'nothing'
          ? 'Care assumed: none beyond your own costs'
          : `Care assumed for a ${SCENARIO_TEXT[state.scenario]} year${changes.length ? ', fine-tuned' : ''}`),
        h('p', { class: 'math-p' }, describeUsage(effectiveUsage(state))),
        customBlock,
        h('p', { class: 'math-h' }, 'Assumed price of each service'),
        h('ul', { class: 'math-prices' }, prices),
        h('p', { class: 'math-p math-fine' }, `${ASSUMPTIONS_NOTE.replace('ASSUMED_PRICES', 'these prices')} Your plan's copays and coinsurance come from OPM's 2027 benefits file.`),
        otherWarnings.length > 0 && h('p', { class: 'math-h' }, 'Could not price'),
        otherWarnings.length > 0 && h('ul', { class: 'math-warn' }, otherWarnings.map((w) => h('li', {}, w)))));
  }

  // ---------- savings banner ----------
  function renderSavings(state, rows) {
    const v = savingsVsCurrent(data, state, rows);
    if (v.kind === 'none' || !v.best) { savings.hidden = true; return; }
    const num = h('span', { class: 'savings-num' });
    let headline;
    let detail;
    if (v.kind === 'continuing') {
      const same = v.best.code === v.current.code;
      if (same || v.amount <= 0.5) {
        headline = h('p', { class: 'savings-title' }, same
          ? 'Your current plan is still your cheapest match.'
          : 'Staying put is the cheapest choice shown.');
        detail = `${v.current.plan.name} comes to about ${usd(v.current.cost.total)} in 2027 for your situation.`;
      } else {
        headline = h('p', { class: 'savings-title' }, 'You’d save ', num, ' a year vs your current plan');
        detail = `${v.best.plan.name} at ${usd(v.best.cost.total)}, versus ${usd(v.current.cost.total)} for ${v.current.plan.name} in 2027.`;
      }
    } else {
      const name = v.currentPlan?.name ?? `plan ${state.currentPlan2026}`;
      headline = h('p', { class: 'savings-title' }, `${name} is not offered in 2027.`);
      detail = v.amount == null
        ? `The cheapest 2027 match is ${v.best.plan.name} at ${usd(v.best.cost.total)}.`
        : `The cheapest 2027 match, ${v.best.plan.name}, comes to ${usd(v.best.cost.total)}: ${usd(Math.abs(v.amount))} ${v.amount >= 0 ? 'less' : 'more'} than your plan would have cost in 2026 (${usd(v.current2026Total)}).`;
    }
    const prevNum = savings.querySelector('.savings-num');
    if (prevNum) num._num = prevNum._num;
    savings.replaceChildren(
      h('span', { class: 'savings-glow', 'aria-hidden': 'true' }),
      h('div', { class: 'savings-body' }, headline, h('p', { class: 'savings-detail' }, detail)));
    if (v.kind === 'continuing' && v.amount > 0.5) tweenNumber(num, v.amount, usd, { animate: !savings.hidden });
    savings.hidden = false;
  }

  // ---------- tray ----------
  function renderTray(state, hide = false) {
    const n = state.selectedPlans.length;
    tray.classList.toggle('is-visible', n > 0 && !hide);
    tray.inert = n === 0 || hide;
    trayCount.textContent = `${n} of ${MAX_COMPARE}`;
    const names = state.selectedPlans.map((c) => cards.get(c)?.row?.plan.name ?? c);
    trayNames.textContent = names.join(', ');
    trayOpen.disabled = n < 2;
    trayOpen.title = n < 2 ? 'Pick at least two plans' : '';
  }

  // ---------- main render ----------
  // ---------- include my plan ----------
  let mine = null; // the user's 2027 row when pinned
  let mineWhere = ''; // state name when that plan is not listed there
  let mineFiltersOn = false; // results filters narrowing the plans (the pinned card then also shows its filtered rank)
  function renderMineNote(state, res, where) {
    const text = mineNoteText(data, state, res, where);
    mineNote.hidden = !text;
    mineNote.textContent = text;
  }

  // "Your assumptions" chips: scenario, fine-tune changes, custom lines (shared by cards, board and compare)
  function renderAssumptions(state) {
    const chips = assumptionChips(state);
    const key = chips.map((c) => `${c.id}:${c.text}:${c.title}`).join('|');
    if (key === assumeKey) return;
    const before = new Set([...assume.children].map((li) => li.dataset.id));
    const animate = assumeKey !== '' && !reduceMotion();
    assumeKey = key;
    assume.replaceChildren(...chips.map((c) => {
      const li = h('li', { class: `assume-chip is-${c.tone}`, 'data-id': c.id, title: c.title },
        c.tone === 'warn' && svg(ICON_WARN), c.text, h('span', { class: 'sr-only' }, `: ${c.title}`));
      if (animate && !before.has(c.id)) {
        li.animate([{ opacity: 0, transform: 'scale(0.9)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
          { duration: 320, easing: EASE_OUT });
      }
      return li;
    }));
  }

  let first = true;
  function render(state = store.get()) {
    if (!data) return;
    const isBoard = state.view === 'board';
    const filteredRows = computeRows(data, state, { type: ui.type });
    const res = rankWithMine(data, state, filteredRows, isBoard ? 'total' : ui.sort, { type: ui.type });
    mine = res.mine;
    mineFiltersOn = res.filtersOn;
    // the user's plan pinned first, every other plan in its true rank order
    const rows = res.mine ? [res.mine, ...res.others] : res.ranked;
    sortCtl.sync(ui.sort);
    typeCtl.sync(ui.type);
    viewCtl.sync(state.view);
    groupSel.value = state.group;
    mineCtl.sync(state);
    sortCtl.el.hidden = isBoard; // the board always ranks by estimated total
    groupCtl.hidden = !isBoard;

    const st = state.location.state;
    // Headline = every plan open to this state (before filters); the line below says how many survive them.
    const avail = availablePlans(data.plans.filter((p) => p.year === 2027), data.serviceArea, st).length;
    const where = st ? STATE_NAMES[st] ?? st : null;
    title.textContent = where
      ? `${avail} ${avail === 1 ? 'plan' : 'plans'} available in ${where}`
      : `${avail} nationwide ${avail === 1 ? 'plan' : 'plans'}`;
    const filtersOn = state.networks.length > 0 || state.account !== 'any' || ui.type !== 'all';
    filtered.hidden = !filtersOn;
    if (filtersOn) filtered.textContent = `${filteredRows.length} of ${avail} ${avail === 1 ? 'plan' : 'plans'} after filters`;
    infoNote.textContent = where
      ? 'FEHB plans open to you in this state: nationwide plans plus regional plans serving it.'
      : 'Nationwide FEHB plans only, because no state is chosen. Choose a state to add regional plans serving it.';
    mineWhere = res.mineStatus === 'included' && res.notInState ? (where ?? 'nationwide') : '';
    renderMineNote(state, res, where);
    sub.textContent = st
      ? `Ranked by ${(isBoard ? SORTS.total : SORTS[ui.sort]).label.toLowerCase()} for ${ENROLLMENT_TEXT[state.enrollment]} coverage and the year you described.`
      : 'Choose your state to add regional HMO plans. Nationwide plans are shown now.';
    renderAssumptions(state);

    list.hidden = isBoard;
    board.el.hidden = !isBoard;
    if (isBoard) {
      board.render(data, state, res, { mineWhere });
    } else {
      board.reset();
      const scale = Math.max(1, ...rows.map((r) => r.cost.premium + r.cost.oop));
      const firstPos = first ? new Map() : measure(list); // read before any write: no forced recalc
      const els = rows.map((row) => {
        let rec = cards.get(row.code);
        if (!rec) { rec = makeCard(row.code); cards.set(row.code, rec); }
        updateCard(rec, row, row.rank, scale, state, !first);
        return rec.el;
      });
      for (const [code, rec] of cards) {
        if (!rows.some((r) => r.code === code)) { io?.unobserve(rec.el); cards.delete(code); }
      }
      reorder(list, els, firstPos, first ? { stagger: 45, maxStagger: 10 } : undefined);
      first = false;
    }

    empty.hidden = filteredRows.length > 0;
    if (!filteredRows.length) {
      empty.replaceChildren(
        h('h3', { class: 'results-none-title' }, 'No plans match these filters'),
        h('p', { class: 'results-none-body' }, st
          ? `No 2027 plan in ${STATE_NAMES[st] ?? st} fits every filter you picked. Try another plan type, network or savings account option.`
          : 'No nationwide plan fits every filter you picked. Choose your state or loosen a filter.'),
        h('button', { type: 'button', class: 'btn btn-primary', 'data-reset': '' }, 'Show all plans'));
    }

    renderSavings(state, filteredRows);
    renderTray(state, isBoard);
    if (ui.compareOpen) {
      renderCompare(compare, {
        data, state,
        onRemove: removeFromCompare,
        onClose: closeCompare,
      });
      compare.hidden = false;
    }

    const top = res.others[0];
    status.textContent = top
      ? `${filteredRows.length} of ${avail} plans. Lowest ${(isBoard ? SORTS.total : SORTS[ui.sort]).label.toLowerCase()}: ${top.plan.name}, ${usd(top.cost.total)} a year.`
      : 'No plans match these filters.';
  }

  return {
    setData(d) {
      data = d;
      io = new IntersectionObserver((entries) => {
        for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
      }, { rootMargin: '10% 0px' });
      main.classList.remove('is-loading');
      main.removeAttribute('aria-busy');
      main.replaceChildren(frame);
      document.body.append(tray);
      render();
      store.subscribe((s) => render(s));
    },
    showError(err) {
      main.classList.remove('is-loading');
      main.removeAttribute('aria-busy');
      main.replaceChildren(h('section', { class: 'results-none', role: 'alert' },
        h('h3', { class: 'results-none-title' }, 'Plan costs did not load'),
        h('p', { class: 'results-none-body' }, location.protocol === 'file:'
          ? 'Open the app through a local web server (for example: python -m http.server) instead of the file directly.'
          : `Check your connection and reload the page. (${err.message})`)));
    },
  };
}

