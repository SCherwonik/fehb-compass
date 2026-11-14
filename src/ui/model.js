// Results model: eligibility, costing, year-over-year diff, ranking and the savings banner.
// DOM-free (pure functions over loaded data + state) so it is unit tested under node.
import { planTotal } from '../engine/cost.js';
import { SCENARIOS, applyOverrides, usageFromCustom } from '../engine/scenarios.js';
import { diffPlan, planFacts } from '../engine/diff.js';
import { statesFromServiceArea } from '../data.js';
import { groupPlans } from './grouping.js';
import { glp1Covered, planMeds } from './rx-model.js';
import { dvAddOn } from './dv-model.js';

const cents = (n) => Math.round(n * 100) / 100;

// Per-data-object index: {2026: Map(code -> plan meta), 2027: Map}. Cached so re-ranks are cheap.
const indexCache = new WeakMap();
function index(data) {
  let ix = indexCache.get(data.plans);
  if (!ix) {
    ix = { 2026: new Map(), 2027: new Map() };
    for (const p of data.plans ?? []) ix[p.year]?.set(p.code, p);
    indexCache.set(data.plans, ix);
  }
  return ix;
}

export function planMeta(data, year, code) {
  return index(data)[year]?.get(code) ?? null;
}

/** Known values in the data, for sanitizeAgainstData. Benefits/rates are not needed. */
export function dataVocabulary(data) {
  const ix = index(data);
  return {
    states: new Set(statesFromServiceArea(data.serviceArea)),
    networks: new Set((data.plans ?? []).map((p) => p.network_family || 'Other')),
    plans2026: new Set(ix[2026].keys()),
    plans2027: new Set(ix[2027].keys()),
  };
}

/** 'HSA' | 'HRA' | null from plan-key flags, falling back to the benefits account_type text. */
function accountOf(meta, benefits) {
  const t = String(benefits?.account_type ?? '');
  if (meta?.hra || /reimbursement/i.test(t)) return 'HRA';
  if (meta?.hsa || /savings/i.test(t)) return 'HSA';
  return null;
}

/** Engine plan object for planTotal / planFacts, or null if rate or benefits are missing. */
export function planInput(data, year, code) {
  const rate = data.rates?.[year]?.[code];
  const benefits = data.benefits?.[year]?.[code];
  if (!rate || !benefits) return null;
  const accountType = accountOf(planMeta(data, year, code), benefits) ?? undefined;
  return { rate, benefits, account: benefits.account_contribution ?? null, accountType };
}

/** Engine inputs: the scenario's usage, with the fine-tune overrides on top, plus the user's custom lines. */
export function costInputs(state) {
  const base = Object.prototype.hasOwnProperty.call(SCENARIOS, state.scenario) ? SCENARIOS[state.scenario] : SCENARIOS.typical;
  return {
    status: state.status,
    enrollment: state.enrollment,
    usage: usageFromCustom(state.custom, applyOverrides(base, state.overrides)),
  };
}

/**
 * One costed 2027 plan with its 2026 counterpart diff. null when the plan cannot be costed.
 * With the user's medications (data.meds, private: from ui/meds-store.js) and the brochure facts (data.brochure),
 * the priced drugs join the cost (engine `drugs`) and `meds` carries the per-drug summary (rx-model planMeds).
 */
export function makeRow(data, state, code) {
  const meta = planMeta(data, 2027, code);
  const input = planInput(data, 2027, code);
  if (!meta || !input || !input.rate[state.enrollment]) return null;
  const inputs = costInputs(state);
  const meds = data.meds ? planMeds(data.brochure ?? null, data.meds, code, input.benefits) : null;
  let cost;
  let base;
  try {
    base = planTotal(input, inputs);
    cost = meds?.entries.length ? planTotal(input, { ...inputs, drugs: meds.entries }) : base;
  } catch { return null; }
  if (!Number.isFinite(cost.total) || !Number.isFinite(base.total)) return null;
  // "Add dental and vision": the same FEDVIP line items join every plan's total (data.fedvip: lazy-loaded)
  const dv = state.dental && data.fedvip ? dvAddOn(data.fedvip, state) : null;
  if (dv && dv.total > 0) cost = { ...cost, total: cents(cost.total + dv.total) };
  const facts = planFacts(input, inputs);
  const facts2026 = planFacts(planInput(data, 2026, code), inputs);
  return {
    code,
    plan: meta,
    plan2026: planMeta(data, 2026, code),
    benefits: input.benefits,
    cost,
    facts,
    facts2026,
    diff: diffPlan(facts2026, facts),
    account: input.accountType ?? null,
    meds,
    dv,
    // total without the user's medications or dental/vision: the like-for-like basis for comparisons (see baseTotal)
    baseTotal: base.total,
  };
}

/**
 * Comparison basis. Medications are priced only on 2027 plans where the user recorded tiers, so any comparison
 * with a 2026 figure, or between plans with different records, uses totals WITHOUT medications on both sides.
 * Dental/vision (the "add dental and vision" toggle) is left out of comparisons the same way: 2026 totals never
 * carry it, and between 2027 plans it is the same amount on both sides.
 * baseTotal(row): the total without medications or dental/vision; medsCost(row): what the medications add on
 * this plan (engine figure: deductible, OOP max and HRA effects included); dvCost(row): the dental/vision amount.
 */
export function baseTotal(row) {
  return Number.isFinite(row?.baseTotal) ? row.baseTotal : row?.cost?.total ?? null;
}
export function dvCost(row) {
  const t = row?.dv?.total;
  return Number.isFinite(t) && t > 0 ? t : 0;
}
export function medsCost(row) {
  return row?.meds?.entries?.length && Number.isFinite(row.cost?.total) ? cents(row.cost.total - dvCost(row) - baseTotal(row)) : 0;
}
/** True when any of these rows has priced medications (comparisons then say they exclude them). */
export const anyMeds = (rows) => (rows ?? []).some((r) => r?.meds?.entries?.length > 0);
/** 'incl. dental/vision' | 'incl. dental' | 'incl. vision' | '' : what the "add dental and vision" amount holds. */
export function dvLabel(row) {
  const d = Number.isFinite(row?.dv?.dental?.amount);
  const v = Number.isFinite(row?.dv?.vision?.amount);
  return d && v ? 'incl. dental/vision' : d ? 'incl. dental' : v ? 'incl. vision' : '';
}
/** True when dental/vision is part of these rows' totals. */
export const anyDv = (rows) => (rows ?? []).some((r) => dvCost(r) > 0);

/** 'total' | 'excl-meds' | 'excl-dv' | 'excl-meds-dv' from the two flags. */
export const basisOf = (meds, dv) => (meds ? (dv ? 'excl-meds-dv' : 'excl-meds') : dv ? 'excl-dv' : 'total');
const BASIS_NOTE = { 'excl-meds': 'excl. medications', 'excl-dv': 'excl. dental/vision', 'excl-meds-dv': 'excl. medications and dental/vision' };
/** Short label for a comparison basis ('' for plain totals). */
export const basisNote = (basis) => BASIS_NOTE[basis] ?? '';

/** True when a plan (by code) is open to someone in `st`: nationwide, or a service area that lists the state. */
export function servesState(serviceArea, code, st) {
  const area = serviceArea?.[code];
  if (!area) return false;
  if (area.nationwide) return true;
  return Boolean(st) && (area.states ?? []).includes(st);
}

const familyOf = (p) => p.network_family || 'Other';

/** Plans open to this state (no state: nationwide plans only), before any network/account/type filter. */
export function availablePlans(plans27, serviceArea, state) {
  return (plans27 ?? []).filter((p) => servesState(serviceArea, p.code, state ?? null));
}

/**
 * Network chip counts for the plans that pass the location and account filters, but NOT the network
 * filter (so toggling a chip never changes another chip's count).
 * -> { scope: 'state'|'nationwide', state, total, families: [{ name, count }] }
 * Families with zero plans stay in the list, last; the rest are most plans first, then by name.
 * Counts sum to `total`, the number of plans the results show when no network is selected.
 */
export function countsByFamily(plans27, serviceArea, { state = null, account = 'any' } = {}) {
  const all = new Map();
  for (const p of plans27 ?? []) all.set(familyOf(p), 0);
  let total = 0;
  for (const p of availablePlans(plans27, serviceArea, state)) {
    if (account === 'hsa' && !p.hsa) continue;
    if (account === 'hra' && !p.hra) continue;
    all.set(familyOf(p), all.get(familyOf(p)) + 1);
    total += 1;
  }
  const families = [...all]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count > 0) - (a.count > 0) || b.count - a.count || a.name.localeCompare(b.name));
  return { scope: state ? 'state' : 'nationwide', state: state ?? null, total, families };
}

/**
 * Options for the "your 2026 plan" combobox, grouped by whether the plan carries into 2027 (matched by plan code).
 * With a state: 'available' = continues and its 2027 service area covers the state (or is nationwide);
 * 'other' = everything else (regional elsewhere, or ended). Without a state: 'continuing' / 'ended'.
 * -> { mode: 'state'|'all', groups: [{ id, label, options: [{ code, name, carrier, family, continues }] }] }
 * Empty groups are omitted. Options sort by name.
 */
export function groupCurrentPlanOptions(plans26, plans27, serviceArea, state, stateName = state) {
  const codes27 = new Set((plans27 ?? []).map((p) => p.code));
  const opt = (p) => ({
    code: p.code, name: p.name, carrier: p.carrier ?? '', family: familyOf(p), continues: codes27.has(p.code),
  });
  const byName = (a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
  const options = (plans26 ?? []).map(opt).sort(byName);
  let groups;
  let mode;
  if (state) {
    mode = 'state';
    groups = [
      { id: 'available', label: `Available in ${stateName} (continuing into 2027)`,
        options: options.filter((o) => o.continues && servesState(serviceArea, o.code, state)) },
      { id: 'other', label: `Other 2026 plans (not matched to ${stateName} in 2027)`,
        options: options.filter((o) => !(o.continues && servesState(serviceArea, o.code, state))) },
    ];
  } else {
    mode = 'all';
    groups = [
      { id: 'continuing', label: 'Continuing in 2027', options: options.filter((o) => o.continues) },
      { id: 'ended', label: 'Ended', options: options.filter((o) => !o.continues) },
    ];
  }
  return { mode, groups: groups.filter((g) => g.options.length) };
}

/**
 * Every eligible, costable 2027 plan for this state (unsorted).
 * opts.type: 'all' | 'FFS' | 'HMO' | 'HDHP' (UI-local plan type filter).
 * No state chosen yet: nationwide plans only.
 */
export function computeRows(data, state, { type = 'all' } = {}) {
  const st = state.location?.state ?? null;
  const nets = new Set(state.networks ?? []);
  const rows = [];
  for (const [code, meta] of index(data)[2027]) {
    if (!servesState(data.serviceArea, code, st)) continue;
    if (nets.size && !nets.has(meta.network_family || 'Other')) continue;
    if (type !== 'all' && meta.type !== type) continue;
    // GLP-1 filter: applies once the brochure facts are in (before that nothing is hidden)
    if (state.glp1 && data.brochure && !glp1Covered(code, data.brochure)) continue;
    const row = makeRow(data, state, code);
    if (!row) continue;
    if (state.account === 'hsa' && row.account !== 'HSA') continue;
    if (state.account === 'hra' && row.account !== 'HRA') continue;
    rows.push(row);
  }
  return rows;
}

export const SORTS = {
  total: { label: 'Total cost', get: (r) => r.cost.total },
  premium: { label: 'Premium', get: (r) => r.cost.premium },
  deductible: { label: 'Deductible', get: (r) => r.facts.deductible },
  oopMax: { label: 'Out-of-pocket max', get: (r) => r.facts.oopMax },
};

/** New array sorted ascending by key; unknown values (null) last; ties by total then code. */
export function sortRows(rows, key = 'total') {
  const get = (SORTS[key] ?? SORTS.total).get;
  const v = (r) => {
    const x = get(r);
    return x == null ? Infinity : x;
  };
  return rows.slice().sort((a, b) => v(a) - v(b) || a.cost.total - b.cost.total || a.code.localeCompare(b.code));
}

/** True when any results filter is narrowing the plans open in the state (network, account or plan type). */
export function filtersActive(state, type = 'all', { glp1Applies = true } = {}) {
  return (state.networks?.length ?? 0) > 0 || (state.account ?? 'any') !== 'any' || (type ?? 'all') !== 'all'
    || (state.glp1 === true && glp1Applies);
}

/**
 * "Include my plan (2027 version)": the 2027 plan with the same code as state.currentPlan2026 joins the
 * compared set whatever the network / plan type / account / state filters say (it is what the user would
 * get by staying put, so every alternative should be measured against it).
 *
 * Mine is pinned OUTSIDE the ranking: every other plan keeps the rank it has in the filtered view (`rows`),
 * exactly as with the toggle off, so pinning never shifts anyone's number. Mine carries
 *   globalRank: its TRUE rank among every plan open in the chosen state (network/account/type filters ignored;
 *               when the plan is not offered in the state it is ranked among that state's plans plus itself)
 *   viewRank:   its rank inside the filtered view, or null when the filters exclude it
 *   rank:       = globalRank (what the pinned header shows, as "#21 overall")
 * opts.type: the UI-local plan type filter that produced `rows` ('all' when none).
 * -> { ranked, others, mine, mineStatus, notInState, filtersOn }
 *   ranked:  others plus mine, in sort order (value scores and the #1 total are computed over this)
 *   mine:    the user's 2027 row (flagged isMine) or null; others: ranked minus mine
 *   mineStatus: 'none' (no current plan) | 'off' (toggle off: behave as before) | 'ended' (no 2027 version)
 *               | 'uncostable' (no rate for this enrollment) | 'included'
 *   notInState: the 2027 service area does not list the chosen state (still included, flagged in the UI)
 */
export function rankWithMine(data, state, rows, sortKey = 'total', { type = 'all' } = {}) {
  const code = state.currentPlan2026;
  // the GLP-1 filter only narrows anything once the brochure facts are loaded
  const filtersOn = filtersActive(state, type, { glp1Applies: Boolean(data.brochure) });
  const rank = (list) => sortRows(list, sortKey).map((r, i) => ({ ...r, rank: i + 1 }));
  const plain = (mineStatus) => {
    const ranked = rank(rows);
    return { ranked, others: ranked, mine: null, mineStatus, notInState: false, filtersOn };
  };
  if (!code) return plain('none');
  if (state.includeMine === false) return plain('off');
  if (!planMeta(data, 2027, code)) return plain('ended');

  const viewRanked = rank(rows); // the filtered view's own ranking (identical to the toggle-off ranking)
  const inView = viewRanked.find((r) => r.code === code) ?? null;
  const base = inView ?? makeRow(data, state, code);
  if (!base) return plain('uncostable');

  // overall: every plan open in the state, no network/account/type filter
  const everyRow = filtersOn ? computeRows(data, { ...state, networks: [], account: 'any', glp1: false }, { type: 'all' }) : rows;
  const overall = everyRow.some((r) => r.code === code) ? everyRow : [...everyRow, base];
  const globalRank = sortRows(overall, sortKey).findIndex((r) => r.code === code) + 1;

  const mine = { ...base, isMine: true, rank: globalRank, globalRank, viewRank: inView ? inView.rank : null };
  const others = viewRanked.filter((r) => r.code !== code);
  const order = sortRows([...others, mine], sortKey).map((r) => r.code);
  const byCode = new Map([...others, mine].map((r) => [r.code, r]));
  return {
    ranked: order.map((c) => byCode.get(c)),
    mine,
    others,
    mineStatus: 'included',
    notInState: !servesState(data.serviceArea, code, state.location?.state ?? null),
    filtersOn,
  };
}

/**
 * Baseline for the board's "vs your 2026 plan (ended)" rows when the user's 2026 plan has no 2027 version:
 * { code, name, total, premium, deductible, oopMax } from the 2026 rates and benefits, or null.
 */
export function endedBaseline(data, state) {
  const code = state.currentPlan2026;
  if (!code || planMeta(data, 2027, code)) return null;
  const input = planInput(data, 2026, code);
  if (!input || !input.rate[state.enrollment]) return null;
  try {
    const inputs = costInputs(state);
    const cost = planTotal(input, inputs);
    const facts = planFacts(input, inputs);
    if (!Number.isFinite(cost.total)) return null;
    return {
      code,
      name: planMeta(data, 2026, code)?.name ?? `Plan ${code}`,
      total: cost.total,
      premium: cost.premium,
      deductible: facts?.deductible ?? null,
      oopMax: facts?.oopMax ?? null,
    };
  } catch {
    return null;
  }
}

/** Board segments: the user's plan pinned as its own first group (true rank kept), then state.group over the rest. */
export function boardGroups(data, state, rows, n = 3) {
  const res = rankWithMine(data, state, rows, 'total');
  const groups = groupPlans(res.others, state.group, n);
  return res.mine ? [{ key: 'mine', label: 'Your plan', rows: [res.mine], total: 1 }, ...groups] : groups;
}

/**
 * Savings banner model.
 * {kind:'none'} | {kind:'continuing', current, best, amount} | {kind:'ended', currentPlan, current2026Total, best, amount}
 * amount = current minus best (positive = you'd save). best = cheapest eligible row, or null.
 * basis: 'total', or 'excl-meds' when any row has priced medications ('excl-dv' with dental/vision added,
 * 'excl-meds-dv' with both): best and amount then use baseTotal (neither on either side, since 2026 plans and
 * plans without recorded tiers cannot carry them);
 * bestTotal / currentTotal are those totals, bestMeds / currentMeds (2027 only) what the medications add.
 */
export function savingsVsCurrent(data, state, rows) {
  const code = state.currentPlan2026;
  if (!code) return { kind: 'none' };
  const current = rows.find((r) => r.code === code) ?? (planMeta(data, 2027, code) ? makeRow(data, state, code) : null);
  const basis = basisOf(anyMeds(rows) || anyMeds([current]), anyDv(rows) || anyDv([current]));
  let best = null;
  for (const r of rows) if (!best || baseTotal(r) < baseTotal(best)) best = r;
  const bestInfo = { basis, bestTotal: best ? baseTotal(best) : null, bestMeds: best ? medsCost(best) : null };

  if (current) {
    return {
      kind: 'continuing', current, best, amount: best ? cents(baseTotal(current) - baseTotal(best)) : null,
      ...bestInfo, currentTotal: baseTotal(current), currentMeds: medsCost(current),
    };
  }
  const currentPlan = planMeta(data, 2026, code);
  const input2026 = planInput(data, 2026, code);
  let current2026Total = null;
  if (input2026 && input2026.rate[state.enrollment]) {
    try { current2026Total = planTotal(input2026, costInputs(state)).total; } catch { /* unknown */ }
  }
  return {
    kind: 'ended',
    currentPlan,
    current2026Total,
    best,
    amount: best && current2026Total !== null ? cents(current2026Total - baseTotal(best)) : null,
    ...bestInfo,
  };
}
