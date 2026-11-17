// Ranked results: header + toolbar, savings banner, compare view, keyed card list or the Compare Board, compare tray.
// Cards are keyed by plan code and updated in place; reordering uses FLIP limited to visible cards.
import { h, svg, ICON_CHECK, ICON_CHEVRON } from './dom.js';
import { segmented, mineSwitch } from './inputs.js';
import { assumptionChips, overrideChanges } from './assumptions.js';
import { computeRows, savingsVsCurrent, availablePlans, servesState, SORTS, rankWithMine, baseTotal, dvCost, dvLabel, basisOf, basisNote, basisParts, anyMeds, anyDv, anyMaternity, anyMatEstimated, areaChip, rankTotal, planMeta } from './model.js';
import { GROUP_LABELS, GROUP_MODES } from './grouping.js';
import { createResultsBoard, mineNoteText } from './results-board.js';
import { totalLabelOf, endedTotalLabel, ENDED_NOTE } from './board-model.js';
import { networkLabel } from './network.js';
import { renderCompare, revealCompare } from './compare.js';
import { FLAG_TEXT } from '../engine/diff.js';
import { MATERNITY_UNPRICED } from '../engine/cost.js';
import { STATE_NAMES } from '../data.js';
import { MAX_COMPARE, safeStorage } from '../state.js';
import { usd, signedUsd, signedPct, costShareSummary, deltaTone } from './format.js';
import { measure, reorder, tweenNumber, pop, nudge, reduceMotion, EASE_OUT } from './motion.js';
import { createRxCard, updateRxCard } from './rx-card.js';
import { badgeEl } from './rx-render.js';
import { overrideBadge } from './matrix-model.js';
import { mathContent, SCENARIO_TEXT, ICON_WARN } from './math.js';

const UI_KEY = 'fehb-compass:results-ui:v1';
const ENROLLMENT_TEXT = { self: 'self only', self_plus_one: 'self plus one', family: 'family' };
/** "typical year", or "your own year" once overrides or custom lines change the scenario. */
const yearText = (state) => (state.custom.length || overrideChanges(state).length
  ? (state.scenario === 'nothing' ? 'your own costs' : `${SCENARIO_TEXT[state.scenario]} year, adjusted`)
  : `${SCENARIO_TEXT[state.scenario]} year`);
const TYPES = [['all', 'All'], ['FFS', 'FFS'], ['HMO', 'HMO'], ['HDHP', 'HDHP']];

const ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-chev"><path d="M4 6l4 4 4-4"/></svg>';
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
 * createResults(main, { store, onRanked }) -> { setData(data), setRx({ facts, factsStatus, meds }), showError(err) }
 * Before setData the static skeleton in index.html stays on screen.
 * setRx: brochure facts (loaded after the ranking) and the user's private medications (meds-store.js); both feed
 * the cost model through data.brochure / data.meds (model.js makeRow). onRanked(rows) gets the ranked plans after
 * each render (the quick look-up lists the top ones).
 */
export function createResults(main, { store, onRanked }) {
  const ui = { ...loadUi(), compareOpen: false };
  let data = null;
  let fedvip = null; // data/fedvip.json once loaded (dental/vision add-on)
  let zipCounty = null; // data/zip_county.json decoded (data.js zipCountyLookup) once loaded
  let rx = { facts: null, factsStatus: 'loading', meds: null };
  const cards = new Map(); // code -> card record
  const visible = new Set(); // card elements intersecting the viewport (count-up only runs there)
  let io = null;

  // ---------- static frame ----------
  const title = h('h2', { class: 'rhead-title', id: 'results-title' });
  const sub = h('p', { class: 'rhead-sub' });
  const filtered = h('p', { class: 'rhead-filtered', hidden: true });
  const countRow = h('div', { class: 'rhead-count' }, filtered);
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
  assume.addEventListener('click', (e) => {
    if (e.target.closest('[data-dismiss="dropped"]')) store.set({ droppedCustom: 0 });
  });
  const head = h('header', { class: 'rhead' },
    h('div', { class: 'rhead-copy' }, title, countRow, sub,
      // the assumption chips and the "your plan ranks #N" note share one line (they wrap on a narrow screen)
      h('div', { class: 'rhead-meta' }, assume, mineNote)),
    h('div', { class: 'rtools' }, viewCtl.el, groupCtl, sortCtl.el, typeCtl.el, mineCtl.el));
  const board = createResultsBoard();

  const savings = h('section', { class: 'savings', hidden: true, 'aria-live': 'polite' });
  // the banner body is rebuilt on each render; the eligibility switch below it stays put (keeps focus while toggled)
  const savingsBody = h('div', { class: 'savings-body' });
  const areaText = h('p', { class: 'savings-detail savings-area-text' });
  const areaInput = h('input', { type: 'checkbox', role: 'switch', id: 'sv-unconfirmed', class: 'switch-input', 'aria-describedby': 'sv-unconfirmed-hint' });
  const areaBox = h('div', { class: 'savings-area', hidden: true }, areaText,
    h('div', { class: 'field field-switch is-compact' },
      h('label', { class: 'switch', for: 'sv-unconfirmed' },
        h('span', { class: 'switch-copy' },
          h('span', { class: 'switch-title' }, 'Include plans I may not be eligible for'),
          h('span', { class: 'switch-hint', id: 'sv-unconfirmed-hint' }, 'Lets this comparison pick a plan that serves only part of your state.')),
        areaInput,
        h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-knob' })))));
  savings.append(h('span', { class: 'savings-glow', 'aria-hidden': 'true' }), savingsBody, areaBox);
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
    else if (t === areaInput) store.set({ includeUnconfirmed: t.checked });
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
      store.set({ networks: [], account: 'any', glp1: false });
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
    r.net = h('p', { class: 'card-net', hidden: true });
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
    // the user's 2026 plan with no 2027 version (row.isEnded): one line saying these are 2026 numbers
    r.endedNote = h('p', { class: 'card-ended-note', hidden: true }, `${ENDED_NOTE}. Shown for comparison, not ranked.`);
    r.chips = h('ul', { class: 'card-chips', 'aria-label': 'Notes' });
    const mathId = `math-${code}`;
    r.mathBtn = h('button', { type: 'button', class: 'btn btn-quiet math-toggle', 'aria-expanded': 'false', 'aria-controls': mathId },
      h('span', { class: 'btn-text' }, 'See the math'), svg(ICON_CHEV));
    r.cmpBtn = h('button', { type: 'button', class: 'cmp-toggle', 'aria-pressed': 'false' }, svg(ICON_CHECK), h('span', {}, 'Compare'));
    r.mathInner = h('div', { class: 'math-inner' });
    r.math = h('div', { class: 'card-math', id: mathId, role: 'region', 'aria-label': 'How this total is calculated' }, h('div', { class: 'math-clip' }, r.mathInner));
    r.rx = createRxCard(code);

    const el = h('li', { class: 'card', 'data-code': code },
      h('div', { class: 'card-top' },
        r.rank,
        h('div', { class: 'card-id' }, r.name, r.meta, r.net),
        h('div', { class: 'card-total' }, r.total, r.totalLabel)),
      r.endedNote,
      r.bar,
      r.facts,
      r.share,
      r.chips,
      r.rx.medsBox,
      h('div', { class: 'card-actions' }, r.mathBtn, r.rx.button, r.cmpBtn),
      r.math,
      r.rx.panel);
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
    // the ended plan (no 2027 version) is a reference card: "2026" in place of a rank, never the top pick
    const ended = row.isEnded === true;
    setText(r.rank, ended ? '2026' : String(rank));
    rec.el.classList.toggle('is-top', rank === 1 && !ended);
    rec.el.classList.toggle('is-ended', ended);
    r.endedNote.hidden = !ended;
    if (!prev) {
      setText(r.name, row.plan.name);
      const bits = [row.plan.type, row.plan.network_family, `code ${row.code}`];
      setText(r.meta, bits.filter(Boolean).join(' · '));
      rec.el.setAttribute('aria-label', ended ? `${row.plan.name}, your 2026 plan, ended in 2027: 2026 numbers, not ranked` : `${row.plan.name}`);
    }
    // the provider network (UnitedHealthcare, Aetna, Cigna ...); brochure facts can arrive after the card, so every update
    const net = ended ? null : networkLabel(row.plan, row.code);
    r.net.hidden = !net;
    r.net.replaceChildren(...(net ? [h('span', { class: 'card-net-k' }, 'Network '), net.text] : []));
    if (net) r.net.title = net.title; else r.net.removeAttribute('title');
    const anim = animateNums && visible.has(rec.el);
    // headline = the ranked total: without medications unless every shown plan has every drug priced (I3), and
    // without maternity unless every shown plan is maternity-priced
    tweenNumber(r.total, rankTotal(row, medsInRank, matInRank), usd, { animate: anim });
    setText(r.totalLabel, ended ? endedTotalLabel({ medsOn, dvOn, matOn }) : totalLabelOf(row, medsInRank, matInRank, matEstimated));

    // bar: premium | expected care, with the deposit shown as a hatched portion at the end
    const gross = row.cost.premium + row.cost.oop;
    const f = (n) => (n / scale).toFixed(4);
    const barKey = `--p:${f(row.cost.premium)};--o:${f(row.cost.oop)};--d:${f(row.cost.hsaOffset)};--g:${f(gross)}`;
    if (barKey !== rec.barKey) { rec.barKey = barKey; r.bar.style.cssText = barKey; } // scoped to the bar's subtree

    tweenNumber(r.premium.v, row.cost.premium, usd, { animate: anim });
    if (ended) { setClass(r.premium.d, 'fact-d'); setText(r.premium.d, '2026 rate'); }
    else if (row.diff.status === 'new') { setClass(r.premium.d, 'fact-d delta delta-new'); setText(r.premium.d, 'New for 2027'); }
    else setDelta(r.premium.d, row.diff.premiumChange, row.diff.premiumPct ? ` (${signedPct(row.diff.premiumPct)})` : '');
    tweenNumber(r.care.v, row.cost.oop, usd, { animate: anim });
    setText(r.care.d, ended ? `${yearText(state)} · 2026` : yearText(state));
    setClass(r.care.d, 'fact-d');

    const raw = row.account ? row.benefits.account_contribution?.[state.enrollment] ?? 0 : 0;
    r.deposit.box.hidden = !row.account;
    if (row.account) {
      setText(r.deposit.lab, row.account === 'HRA' ? 'HRA credit used' : 'HSA deposit');
      tweenNumber(r.deposit.v, row.cost.hsaOffset > 0 ? -row.cost.hsaOffset : 0, usd, { animate: anim });
      setClass(r.deposit.d, 'fact-d');
      setText(r.deposit.d, !raw
        ? `none listed for ${ended ? 2026 : 2027}`
        : row.account === 'HRA' && raw > row.cost.hsaOffset
          ? `of ${usd(raw)} available`
          : row.account === 'HRA' ? 'toward care costs' : `yours to keep${ended ? ' · 2026' : ''}`);
    }
    setText(r.deductible.v, usd(row.facts.deductible));
    if (ended) { setClass(r.deductible.d, 'fact-d'); setText(r.deductible.d, '2026'); }
    else setDelta(r.deductible.d, row.diff.deductibleChange);
    // a deductible taken from the plan brochure instead of OPM's spreadsheet (pipeline/benefit_overrides.json)
    const dedBadge = overrideBadge(row.benefits, /^Annual deductible/);
    if (Boolean(dedBadge) !== Boolean(r.deductible.badge)) {
      r.deductible.badge?.remove();
      r.deductible.badge = dedBadge ? badgeEl(dedBadge) : null;
      if (r.deductible.badge) r.deductible.box.querySelector('dd').append(r.deductible.badge);
    }
    setText(r.oopMax.v, usd(row.facts.oopMax));
    if (ended) { setClass(r.oopMax.d, 'fact-d'); setText(r.oopMax.d, '2026'); }
    else setDelta(r.oopMax.d, row.diff.oopMaxChange);
    setText(r.share, costShareSummary(row.benefits, row.facts.coinsurance) || 'Cost sharing varies; see the plan brochure.');

    // chips: your plan / vs your plan, firmness, status, warnings (rebuilt only when their content changes)
    // compared without medications when the user has any (they are priced only where tiers are recorded)
    // same rule as the board (board-model.js): only medications actually priced on a shown plan change the basis
    const vsExcl = basisNote(basisOf(medsOn, dvCost(row) > 0, matOn && !matInRank)).replace('medications', 'meds');
    const vsMine = mine && !row.isMine ? Math.round(baseTotal(row, matInRank) - baseTotal(mine, matInRank)) : null;
    rec.el.classList.toggle('is-mine', Boolean(row.isMine));
    // the pinned plan sits outside the ranking: its number is the overall rank in the state
    const rankTag = row.isMine && Number.isInteger(row.globalRank)
      ? `#${row.globalRank} overall${mineFiltersOn ? (row.viewRank ? ` · #${row.viewRank} in this view` : ' · outside your filters') : ''}`
      : '';
    const oon = row.cost.breakdown.oonEstimate === true;
    // a maternity line this plan's brochure gives no total for: its total leaves it out (engine breakdown.unpriced);
    // the reason is a gap in the plan's published information (model maternityPart -> engine maternityGap)
    const unpriced = (row.cost.breakdown.unpriced ?? []).length > 0;
    const gapText = row.maternity?.gap?.text ?? MATERNITY_UNPRICED;
    const unpricedTag = unpriced && h('li', { class: 'tag tag-warn', title: `${gapText} See the math.` },
      svg(ICON_WARN), ended ? 'Maternity not priced for 2026 plans' : MATERNITY_UNPRICED);
    // a priced plan: what one pregnancy adds, in the headline total or shown apart from it
    // an estimated amount (MATERNITY_ASSUMPTIONS) says so on the tag, and its title says what is assumed and why
    const matCost = row.maternity?.priced ? row.maternity.cost : null;
    const matEst = row.maternity?.estimated === true;
    const matWhere = matInRank
      ? 'Included in this total: every shown plan is priced.'
      : 'Left out of the ranked total because some shown plans’ brochures give no maternity total.';
    const matTag = matCost != null && h('li', {
      class: `tag${matEst ? ' tag-est' : ''}`,
      title: matEst ? `${row.maternity.estimate} ${matWhere}` : `What one pregnancy adds on this plan, from its 2027 brochure’s maternity terms. ${matWhere}`,
    }, `${matCost > 0 ? '+ ' : ''}${usd(matCost)} maternity${matEst ? ' (estimated)' : ''}${matInRank ? ', in total' : ''}`);
    const st = state.location.state;
    const area = areaChip(row, st ? STATE_NAMES[st] ?? st : null, st ? state.location.zip : null, data.zipCounty ?? null);
    const key = `${ended ? 'ended' : ''}${row.isMine ? `mine:${mineWhere}:${rankTag}` : ''}|${vsMine}:${vsExcl}|${row.cost.firmness}|${row.diff.status}|${row.diff.flags.join(',')}|${oon}:${unpriced}:${gapText}:${matCost}:${matEst}:${matInRank}|${area?.title ?? ''}`;
    if (key !== rec.chipsKey) {
      rec.chipsKey = key;
      const items = ended ? [
        h('li', { class: 'tag tag-ended' }, 'Your 2026 plan'),
        h('li', { class: 'tag tag-ended' }, 'Ended in 2027'),
        h('li', { class: 'tag', title: 'Premium and benefits from OPM’s 2026 files: this plan has no 2027 version.' }, '2026 rates'),
        row.cost.firmness === 'fixed'
          ? h('li', { class: 'tag tag-fixed', title: 'Every service in this scenario is a flat copay, so this total does not depend on assumed prices.' }, 'Fixed cost')
          : h('li', { class: 'tag tag-est', title: 'Part of this total depends on assumed prices for care. See the math.' }, 'Estimated'),
        oon && h('li', { class: 'tag tag-warn', title: 'Out-of-network lines are counted at full cost: OPM publishes no out-of-network cost sharing. See the math.' },
          svg(ICON_WARN), 'Out-of-network estimate'),
        unpricedTag,
      ] : [
        row.isMine && h('li', { class: 'tag tag-mine' }, 'Your plan · 2027'),
        rankTag && h('li', { class: 'tag' }, rankTag),
        area && h('li', { class: 'tag tag-warn tag-area', title: area.title }, svg(ICON_WARN), area.text,
          h('span', { class: 'sr-only' }, `. ${area.title}`)),
        row.isMine && mineWhere && h('li', { class: 'tag' }, `Not listed for ${mineWhere}`),
        vsMine != null && h('li', { class: `tag tag-vs tag-vs-${deltaTone(vsMine)}`, title: vsExcl ? `Estimated yearly totals compared ${vsExcl}: the same on both sides or not priced on every plan` : 'Estimated yearly total compared with your plan in 2027' },
          deltaTone(vsMine) === 'flat' ? `Same as your plan${vsExcl ? ` (${vsExcl})` : ''}` : `${signedUsd(vsMine)} vs your plan${vsExcl ? ` (${vsExcl})` : ''}`),
        row.cost.firmness === 'fixed'
          ? h('li', { class: 'tag tag-fixed', title: 'Every service in this scenario is a flat copay, so this total does not depend on assumed prices.' }, 'Fixed cost')
          : h('li', { class: 'tag tag-est', title: 'Part of this total depends on assumed prices for care. See the math.' }, 'Estimated'),
        oon && h('li', { class: 'tag tag-warn', title: 'Out-of-network lines are counted at full cost: OPM publishes no out-of-network cost sharing. See the math.' },
          svg(ICON_WARN), 'Out-of-network estimate'),
        unpricedTag,
        matTag,
        row.diff.status === 'new' && h('li', { class: 'tag tag-new' }, 'New for 2027'),
        ...row.diff.flags.map((f) => h('li', { class: 'tag tag-warn' }, svg(ICON_WARN), FLAG_TEXT[f] ?? f)),
      ];
      r.chips.replaceChildren(...items.filter(Boolean));
    }

    // compare and the brochure parts are about 2027 plans: the ended reference card has neither
    r.cmpBtn.hidden = ended;
    if (ended) {
      r.rx.button.hidden = true;
      r.rx.medsBox.hidden = true;
      if (rec.open) fillMath(rec);
      return;
    }
    const selected = state.selectedPlans.includes(row.code);
    rec.el.classList.toggle('is-selected', selected);
    r.cmpBtn.setAttribute('aria-pressed', String(selected));
    r.cmpBtn.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${row.plan.name} ${selected ? 'from' : 'to'} compare`);

    updateRxCard(r.rx, row, rx.factsStatus, medsInRank);
    if (rec.open) fillMath(rec);
  }

  // The panel itself lives in math.js (shared with the Board's dialog).
  function fillMath(rec) {
    const row = rec.row;
    if (!row) return;
    rec.r.mathInner.replaceChildren(...mathContent(row, store.get(), data, { medsInRank, matInRank, matEstimated }));
  }

  // ---------- savings banner ----------
  // "$1,284 on Plan X" or "not looked up on Plan X" (never a misleading $0: I3)
  const medsOn2 = (n, where) => (n == null ? `not looked up on ${where}` : `${usd(n)} on ${where}`);
  function renderSavings(state, rows) {
    const v = savingsVsCurrent(data, state, rows);
    if (v.kind === 'none' || !v.best) { savings.hidden = true; return; }
    renderAreaNote(state, v);
    const num = h('span', { class: 'savings-num' });
    let headline;
    let detail;
    // With medications priced on some plans, every figure here is WITHOUT them (2026 plans and plans with no
    // recorded tiers cannot carry them); what they add is said separately below.
    const excl = v.basis !== 'total';
    const tot = (r) => (excl ? baseTotal(r, v.withMat !== false) : r.cost.total);
    const parts = basisParts(v.basis);
    const words = parts.map((p) => ({ meds: 'your medications', dv: parts.length > 1 ? 'dental/vision' : 'dental and vision', mat: 'maternity' })[p]);
    const what = v.basis === 'excl-meds-dv' ? 'your medications, dental and vision'
      : words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
    const meds = parts.includes('meds');
    let medsNote = '';
    // maternity left out (not priced on every plan, or compared with a 2026 plan): what it adds, or "not priced"
    const estOf = (r) => (r?.maternity?.estimated ? ' (estimated)' : '');
    const matOn2 = (n, where, r) => (n == null ? `not priced on ${where} (its brochure gives no total)` : `${usd(n)}${estOf(r)} on ${where}`);
    let matNote = '';
    if (v.kind === 'continuing') {
      const same = v.best.code === v.current.code;
      if (same || v.amount <= 0.5) {
        headline = h('p', { class: 'savings-title' }, same
          ? 'Your current plan is still your cheapest match.'
          : 'Staying put is the cheapest choice shown.');
        detail = `${v.current.plan.name} comes to about ${usd(tot(v.current))} in 2027 for your situation${excl ? `, excluding ${what}` : ''}.`;
      } else {
        headline = h('p', { class: 'savings-title' }, 'You’d save ', num, ' a year vs your current plan');
        detail = `${v.best.plan.name} at ${usd(tot(v.best))}, versus ${usd(tot(v.current))} for ${v.current.plan.name} in 2027${excl ? `, both excluding ${what}` : ''}.`;
      }
      if (parts.includes('mat')) {
        matNote = same
          ? (v.currentMat == null ? 'Maternity is not priced on this plan: its brochure gives no total.' : `One pregnancy adds ${usd(v.currentMat)}${estOf(v.current)} on this plan.`)
          : `One pregnancy: ${matOn2(v.bestMat, v.best.plan.name, v.best)}; ${matOn2(v.currentMat, 'your plan', v.current)}. Left out above because not every plan’s brochure gives a maternity total.`;
      } else if (v.withMat && (v.best.maternity?.estimated || v.current.maternity?.estimated)) {
        // maternity is in these totals, and some of it is an estimate: say where
        const est = [v.best, v.current].filter((r, i, a) => r.maternity?.estimated && a.findIndex((x) => x.code === r.code) === i);
        matNote = `These totals include one pregnancy; the amount is estimated on ${est.map((r) => r.plan.name).join(' and ')}. ${est[0].maternity.estimate}`;
      }
      if (meds) {
        medsNote = same
          ? (v.currentMeds == null ? 'Your medications are not looked up on this plan yet.' : `Your medications add ${usd(v.currentMeds)} on this plan.`)
          : `Your medications: ${medsOn2(v.bestMeds, v.best.plan.name)}; ${medsOn2(v.currentMeds, 'your plan')}${v.bestMeds != null || v.currentMeds != null ? ', for the drugs whose tiers you recorded' : ''}.`;
      }
    } else {
      const name = v.currentPlan?.name ?? `plan ${state.currentPlan2026}`;
      headline = h('p', { class: 'savings-title' }, `${name} is not offered in 2027.`);
      detail = v.amount == null
        ? `The cheapest 2027 match is ${v.best.plan.name} at ${usd(tot(v.best))}${excl ? `, excluding ${what}` : ''}.`
        : `The cheapest 2027 match, ${v.best.plan.name}, comes to ${usd(tot(v.best))}: ${usd(Math.abs(v.amount))} ${v.amount >= 0 ? 'less' : 'more'} than your plan would have cost in 2026 (${usd(v.current2026Total)})${excl ? `. Both exclude ${what}` : ''}.`;
      if (parts.includes('mat')) {
        matNote = v.bestMat == null
          ? `Maternity is not priced on ${v.best.plan.name}: its brochure gives no total.`
          : `Plus one pregnancy: ${usd(v.bestMat)}${estOf(v.best)} on ${v.best.plan.name}, not priced for 2026 plans.`;
      }
      if (meds) {
        medsNote = v.bestMeds == null
          ? `Your medications are not looked up on ${v.best.plan.name} yet.`
          : `Plus your medications: ${usd(v.bestMeds)} on ${v.best.plan.name}, not yet priced for 2026.`;
      }
    }
    const prevNum = savings.querySelector('.savings-num');
    if (prevNum) num._num = prevNum._num;
    savingsBody.replaceChildren(headline, h('p', { class: 'savings-detail' }, detail),
      medsNote && h('p', { class: 'savings-detail savings-meds' }, medsNote),
      matNote && h('p', { class: 'savings-detail savings-meds savings-mat' }, matNote));
    if (v.kind === 'continuing' && v.amount > 0.5) tweenNumber(num, v.amount, usd, { animate: !savings.hidden });
    savings.hidden = false;
  }

  // Plans serving only part of the state: left out of the banner's pick unless the user opts in (C1).
  function renderAreaNote(state, v) {
    const st = state.location.state;
    const where = st ? STATE_NAMES[st] ?? st : 'your state';
    const on = state.includeUnconfirmed === true;
    let text = '';
    if (!on && v.skipped > 0) {
      // the plans' own chips read "Serves part of <state>" or, for a ZIP that spans counties, "Serves part of your ZIP"
      const split = v.skippedSplit ?? 0;
      const allSplit = split === v.skipped;
      const area = allSplit ? 'your ZIP' : split > 0 ? `${where} or of your ZIP` : where;
      const mark = allSplit ? 'your ZIP' : split > 0 ? `${where}” or “Serves part of your ZIP` : where;
      text = `${v.skipped === 1 ? 'One cheaper plan serves' : `${v.skipped} cheaper plans serve`} only part of ${area}, so `
        + `${v.skipped === 1 ? 'it is' : 'they are'} left out here. ${v.skipped === 1 ? 'It stays' : 'They stay'} in the list, marked “Serves part of ${mark}”.`;
    } else if (on && v.best?.area === 'partial') {
      text = v.best.areaSplit
        ? `${v.best.plan.name} serves only part of ZIP ${state.location.zip}: confirm your address is in its service area before choosing it.`
        : `${v.best.plan.name} serves only part of ${where}: confirm your county is in its service area before choosing it.`;
    }
    areaBox.hidden = !(text || on);
    areaText.textContent = text;
    areaText.hidden = !text;
    areaInput.checked = on;
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
      // the detail lives in the title only (one description, not repeated as hidden text)
      const li = h('li', { class: `assume-chip is-${c.tone}`, 'data-id': c.id, title: c.title },
        c.tone === 'warn' && svg(ICON_WARN), c.text,
        c.dismissible && h('button', { type: 'button', class: 'assume-dismiss', 'aria-label': `Dismiss: ${c.title}`, 'data-dismiss': c.id },
          svg('<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8"/></svg>')));
      if (animate && !before.has(c.id)) {
        li.animate([{ opacity: 0, transform: 'scale(0.9)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
          { duration: 320, easing: EASE_OUT });
      }
      return li;
    }));
  }

  let first = true;
  let medsOn = false; // any shown plan has priced medications (cards and board agree on this)
  let dvOn = false; // dental/vision is in the shown totals (the ended 2026 card says it is left out of its own)
  let medsInRank = true; // the ranked totals include them (every shown plan has every drug priced: model.medsRanked)
  let matOn = false; // a "Having a baby" line is in the custom lines
  let matInRank = true; // the ranked totals include it (every shown plan is maternity-priced: model.maternityRanked)
  let matEstimated = false; // some shown plan's maternity amount is an estimate (MATERNITY_ASSUMPTIONS)
  function render(state = store.get()) {
    if (!data) return;
    // the Dental & Vision tab hides this frame (src/ui/dental-board.js): skip the work until it is back
    if (state.tab !== 'medical') { renderTray(state, true); return; }
    const isBoard = state.view === 'board';
    const filteredRows = computeRows(data, state, { type: ui.type });
    const res = rankWithMine(data, state, filteredRows, isBoard ? 'total' : ui.sort, { type: ui.type });
    mine = res.mine;
    mineFiltersOn = res.filtersOn;
    // the user's plan pinned first, every other plan in its true rank order
    // a plan with no 2027 version: its 2026 reference card pinned first (never ranked or counted)
    const rows = res.mine ? [res.mine, ...res.others] : res.ended ? [res.ended, ...res.others] : res.ranked;
    medsOn = anyMeds(rows);
    dvOn = anyDv(rows);
    medsInRank = res.medsInRank !== false;
    matOn = anyMaternity(rows);
    matInRank = res.matInRank !== false;
    matEstimated = anyMatEstimated(rows);
    sortCtl.sync(ui.sort);
    typeCtl.sync(ui.type);
    viewCtl.sync(state.view);
    groupSel.value = state.group;
    mineCtl.sync(state, { ended: Boolean(state.currentPlan2026) && !planMeta(data, 2027, state.currentPlan2026) });
    sortCtl.el.hidden = isBoard; // the board always ranks by estimated total
    groupCtl.hidden = !isBoard;

    const st = state.location.state;
    // Headline = every plan open to this state (before filters); the line below says how many survive them.
    const avail = availablePlans(data.plans.filter((p) => p.year === 2027), data.serviceArea, st, st ? state.location.zip : null, data.zipCounty ?? null).length;
    const where = st ? STATE_NAMES[st] ?? st : null;
    title.textContent = where
      ? `${avail} ${avail === 1 ? 'plan' : 'plans'} available in ${where}`
      : `${avail} nationwide ${avail === 1 ? 'plan' : 'plans'}`;
    const filtersOn = state.networks.length > 0 || state.account !== 'any' || ui.type !== 'all' || (state.glp1 && Boolean(data.brochure));
    filtered.hidden = !filtersOn;
    if (filtersOn) filtered.textContent = `${filteredRows.length} of ${avail} ${avail === 1 ? 'plan' : 'plans'} after filters`;
    // listed for the state but not for the user's ZIP (ZIP-only service area, or counties the ZIP is not in)
    const zipOnly = st && state.location.zip && servesState(data.serviceArea, res.mine?.code, st);
    mineWhere = res.mineStatus === 'included' && res.notInState ? (zipOnly ? `ZIP ${state.location.zip}` : where ?? 'nationwide') : '';
    renderMineNote(state, res, res.notInState && zipOnly ? mineWhere : where);
    // say when the ranking also carries the user's priced medications or the dental/vision add-on
    const dvRow = rows.find((r) => dvCost(r) > 0);
    const extras = [medsOn && medsInRank && 'your medications', matOn && matInRank && (matEstimated ? 'maternity (some estimated)' : 'maternity'), dvRow && `the ${dvLabel(dvRow).replace('incl. ', '').replace('/', ' and ')} add-on`].filter(Boolean);
    const ranksTotal = isBoard || ui.sort === 'total';
    const incl = (extras.length && ranksTotal ? `, including ${extras.join(' and ')}` : '')
      + (ranksTotal && ((medsOn && !medsInRank) || (matOn && !matInRank))
        ? `, excluding ${[medsOn && !medsInRank && 'your medications', matOn && !matInRank && 'maternity'].filter(Boolean).join(' and ')} (not priced on every plan; shown apart on each)`
        : '');
    sub.textContent = st
      ? `Ranked by ${(isBoard ? SORTS.total : SORTS[ui.sort]).label.toLowerCase()} for ${ENROLLMENT_TEXT[state.enrollment]} coverage and the year you described${incl}.`
      : `Choose your state to add regional HMO plans. Nationwide plans are shown now${incl ? ` (totals${incl.slice(1)})` : ''}.`;
    renderAssumptions(state);

    list.hidden = isBoard;
    board.el.hidden = !isBoard;
    if (isBoard) {
      board.render(data, state, res, { mineWhere, rx: { factsStatus: rx.factsStatus, meds: data.meds } });
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

    try { onRanked?.(res.others.slice(0, 6)); } catch (err) { console.error(err); }
    const top = res.others[0];
    status.textContent = top
      ? `${filteredRows.length} of ${avail} plans. Lowest ${(isBoard ? SORTS.total : SORTS[ui.sort]).label.toLowerCase()}: ${top.plan.name}, ${usd(rankTotal(top, medsInRank, matInRank))} a year${top.area === 'partial' ? (top.areaSplit ? ', if it serves your address' : ', if it serves your county') : ''}.`
      : 'No plans match these filters.';
  }

  return {
    el: frame,
    /** FEDVIP data (lazy-loaded): dental/vision line items join the totals when state.dental is on. */
    setFedvip(fv) {
      fedvip = fv;
      if (!data) return;
      data = { ...data, fedvip };
      render();
    },
    /** ZIP -> county lookup (data.js zipCountyHub, lazy): confirms or rules out county-listed plans for the ZIP. */
    setZipCounty(zc) {
      zipCounty = zc;
      if (!data) return;
      data = { ...data, zipCounty };
      render();
    },
    setData(d) {
      data = { ...d, fedvip, zipCounty, brochure: rx.facts, meds: rx.meds?.drugs?.length ? rx.meds : null };
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
    setRx(next) {
      rx = { ...rx, ...next };
      if (!data) return;
      data = { ...data, brochure: rx.facts, meds: rx.meds?.drugs?.length ? rx.meds : null };
      render();
    },
    /** Before printing: fill the math of the best plan (and of the pinned plan above it). Returns an undo. */
    preparePrint() {
      if (!data || store.get().view !== 'cards') return () => {};
      const done = [];
      for (const el of [...list.children].slice(0, 2)) {
        const rec = cards.get(el.dataset.code);
        if (!rec) continue;
        if (!rec.open) fillMath(rec);
        el.classList.add('print-math');
        done.push(el);
        if (!rec.row?.isMine) break;
      }
      return () => { for (const el of done) el.classList.remove('print-math'); };
    },
    showError(err) {
      main.classList.remove('is-loading');
      main.removeAttribute('aria-busy');
      main.replaceChildren(h('section', { class: 'results-none', role: 'alert' },
        h('h3', { class: 'results-none-title' }, 'Plan costs did not load'),
        h('p', { class: 'results-none-body' }, location.protocol === 'file:'
          ? 'Open the app through a local web server (for example: python -m http.server) instead of the file directly.'
          : `Check your connection and try again. (${err.message})`),
        location.protocol !== 'file:' && h('button', { type: 'button', class: 'btn btn-primary', onclick: () => location.reload() }, 'Try again')));
    },
  };
}

