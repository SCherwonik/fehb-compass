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
    // service area for the user's state/ZIP (areaStatus): 'partial' = availability not confirmed
    area: areaStatus(data.serviceArea, code, state.location?.state ?? null, state.location?.state ? state.location?.zip ?? null : null),
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
/** What the medications add on this plan, or null when none of them is priced here (say "not looked up", not $0). */
export const medsAdded = (row) => (row?.meds?.entries?.length ? medsCost(row) : null);
/** True when any of these rows has priced medications (comparisons then say they exclude them). */
export const anyMeds = (rows) => (rows ?? []).some((r) => r?.meds?.entries?.length > 0);
/** True when every row has every one of the user's drugs priced (brochure facts loaded, a tier for each). */
export const medsComplete = (rows) => {
  const list = (rows ?? []).filter(Boolean);
  return list.length > 0 && list.every((r) => r.meds && !r.meds.factsMissing && r.meds.count > 0 && r.meds.entries.length === r.meds.count);
};
/**
 * Ranking basis (I3): medications join the ranked total only when every plan in the set has every drug priced;
 * otherwise plans are ranked without them (pricing them on the looked-up plans only would push exactly those down).
 */
export const medsRanked = (rows) => !anyMeds(rows) || medsComplete(rows);
/** The total a row is ranked and headlined by: with medications, or without them (dental/vision kept: same on all). */
export function rankTotal(row, withMeds = true) {
  if (withMeds || !row?.meds?.entries?.length) return row?.cost?.total ?? null;
  return cents(baseTotal(row) + dvCost(row));
}
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

const usd0 = (n) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : 'not listed');

/**
 * "See the math" sentence for Self Plus One / Family: the scenario is one covered person's care, so per-person
 * limits apply (engine personLimits). `b` is planTotal's breakdown. '' for self-only coverage.
 */
export function personLimitsNote(b) {
  if (!b?.onePerson) return '';
  const lead = 'Modeled as one covered person’s care: ';
  if (b.deductibleType === 'embedded') {
    return `${lead}the self-only ${usd0(b.deductible)} deductible and ${usd0(b.oopMax)} out-of-pocket max apply; `
      + `the family limits (${usd0(b.enrollmentDeductible)} and ${usd0(b.enrollmentOopMax)}) are not reached by one person.`;
  }
  const why = b.deductibleType === 'aggregate'
    ? 'this HSA plan’s family deductible is shared'
    : 'the data does not say how this plan’s family deductible works, so it is treated as shared (the cautious choice)';
  return `${lead}${why}, so one person meets the whole ${usd0(b.deductible)} deductible; `
    + `their costs stop at the ${usd0(b.oopMax)} self-only out-of-pocket max.`;
}

// USPS state code -> 2-digit FIPS state code (the first two digits of a county FIPS code in service_area.json).
const STATE_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15',
  ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56', AS: '60', GU: '66', MP: '69', PR: '72', VI: '78',
};

/**
 * Where a plan stands for someone in state `st` (and ZIP `zip`, when known), from OPM's service area:
 *   'nationwide' | 'statewide' (the whole state) | 'zip' (OPM lists this ZIP for the plan)
 *   | 'partial' (the plan serves only some counties of the state and the ZIP cannot confirm it: OPM's data has no
 *     ZIP -> county map, so the user must check their county) | 'outside' (not offered there).
 * A ZIP rules a plan out only when the plan serves that state by listed ZIP codes alone (no whole county there).
 */
export function areaStatus(serviceArea, code, st, zip = null) {
  const area = serviceArea && Object.prototype.hasOwnProperty.call(serviceArea, code) ? serviceArea[code] : null;
  if (!area) return 'outside';
  if (area.nationwide) return 'nationwide';
  if (!st || !(area.states ?? []).includes(st)) return 'outside';
  if ((area.statewide ?? []).includes(st)) return 'statewide';
  if (zip && (area.zips ?? []).includes(zip)) return 'zip';
  const fips = STATE_FIPS[st];
  const wholeCounties = !fips || (area.counties ?? []).some((c) => c.startsWith(fips));
  if (zip && !wholeCounties) return 'outside';
  return 'partial';
}

/** True when availability is confirmed for the user's location (not a partial-state plan). */
export const areaConfirmed = (status) => status === 'nationwide' || status === 'statewide' || status === 'zip';

/**
 * True when a plan (by code) may be open to someone in `st`: nationwide, or a service area that lists the state
 * (partial-state plans included: see areaStatus). With a ZIP, ZIP-only plans that do not list it are out.
 */
export function servesState(serviceArea, code, st, zip = null) {
  return areaStatus(serviceArea, code, st, zip) !== 'outside';
}

/**
 * Card chip for a plan whose service area covers only part of the user's state: { text, title } or null.
 * `stateName` e.g. 'Virginia'; `zip` the user's ZIP when known.
 */
export function areaChip(row, stateName, zip = null) {
  if (row?.area !== 'partial') return null;
  const where = stateName || 'your state';
  return {
    text: `Serves part of ${where}: confirm your county`,
    title: `Availability not confirmed. OPM lists this plan for only some counties in ${where}`
      + `${zip ? `, and ZIP ${zip} is not among the ZIP codes it lists` : ''}. OPM’s data cannot match a ZIP code to its county, `
      + 'so check the service area in the plan’s brochure (or call the plan) before choosing it.',
  };
}

const familyOf = (p) => p.network_family || 'Other';

/** Plans open to this state and ZIP (no state: nationwide plans only), before any network/account/type filter. */
export function availablePlans(plans27, serviceArea, state, zip = null) {
  return (plans27 ?? []).filter((p) => servesState(serviceArea, p.code, state ?? null, zip));
}

/**
 * Network chip counts for the plans that pass the location and account filters, but NOT the network
 * filter (so toggling a chip never changes another chip's count).
 * -> { scope: 'state'|'nationwide', state, total, families: [{ name, count }] }
 * Families with zero plans stay in the list, last; the rest are most plans first, then by name.
 * Counts sum to `total`, the number of plans the results show when no network is selected.
 */
export function countsByFamily(plans27, serviceArea, { state = null, zip = null, account = 'any' } = {}) {
  const all = new Map();
  for (const p of plans27 ?? []) all.set(familyOf(p), 0);
  let total = 0;
  for (const p of availablePlans(plans27, serviceArea, state, state ? zip : null)) {
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
  const zip = st ? state.location?.zip ?? null : null;
  const nets = new Set(state.networks ?? []);
  const rows = [];
  for (const [code, meta] of index(data)[2027]) {
    if (!servesState(data.serviceArea, code, st, zip)) continue;
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
  // withMeds: the set's ranking basis (medsRanked)
  total: { label: 'Total cost', get: (r, withMeds) => rankTotal(r, withMeds) },
  premium: { label: 'Premium', get: (r) => r.cost.premium },
  deductible: { label: 'Deductible', get: (r) => r.facts.deductible },
  oopMax: { label: 'Out-of-pocket max', get: (r) => r.facts.oopMax },
};

/**
 * New array sorted ascending by key; unknown values (null) last; ties by total then code.
 * Totals follow the set's ranking basis (medsRanked): without medications unless every plan has every drug priced.
 */
export function sortRows(rows, key = 'total') {
  const get = (SORTS[key] ?? SORTS.total).get;
  const withMeds = medsRanked(rows);
  const v = (r) => {
    const x = get(r, withMeds);
    return x == null ? Infinity : x;
  };
  const t = (r) => rankTotal(r, withMeds) ?? Infinity;
  return rows.slice().sort((a, b) => v(a) - v(b) || t(a) - t(b) || a.code.localeCompare(b.code));
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
    return { ranked, others: ranked, mine: null, mineStatus, notInState: false, filtersOn, medsInRank: medsRanked(ranked) };
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
    medsInRank: medsRanked([...others, mine]),
    notInState: !servesState(data.serviceArea, code, state.location?.state ?? null, state.location?.state ? state.location?.zip ?? null : null),
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
 * bestTotal / currentTotal are those totals, bestMeds / currentMeds (2027 only) what the medications add
 * (null when none of the drugs is priced on that plan: "not looked up").
 */
export function savingsVsCurrent(data, state, rows) {
  const code = state.currentPlan2026;
  if (!code) return { kind: 'none' };
  const current = rows.find((r) => r.code === code) ?? (planMeta(data, 2027, code) ? makeRow(data, state, code) : null);
  const basis = basisOf(anyMeds(rows) || anyMeds([current]), anyDv(rows) || anyDv([current]));
  // Plans whose service area is not confirmed for the user's county/ZIP are never named "best" unless the user
  // opts in (state.includeUnconfirmed); `skipped` = how many of them would have been cheaper than `best`.
  const open = (r) => state.includeUnconfirmed === true || r.area == null || areaConfirmed(r.area);
  let best = null;
  for (const r of rows) if (open(r) && (!best || baseTotal(r) < baseTotal(best))) best = r;
  const skipped = rows.filter((r) => !open(r) && (!best || baseTotal(r) < baseTotal(best))).length;
  const bestInfo = { basis, bestTotal: best ? baseTotal(best) : null, bestMeds: best ? medsAdded(best) : null, skipped };

  if (current) {
    return {
      kind: 'continuing', current, best, amount: best ? cents(baseTotal(current) - baseTotal(best)) : null,
      ...bestInfo, currentTotal: baseTotal(current), currentMeds: medsAdded(current),
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
