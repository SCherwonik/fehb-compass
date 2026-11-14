// Results model: eligibility, costing, year-over-year diff, ranking and the savings banner.
// DOM-free (pure functions over loaded data + state) so it is unit tested under node.
import { planTotal } from '../engine/cost.js';
import { SCENARIOS } from '../engine/scenarios.js';
import { diffPlan, planFacts } from '../engine/diff.js';
import { statesFromServiceArea } from '../data.js';

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

export function costInputs(state) {
  return {
    status: state.status,
    enrollment: state.enrollment,
    usage: SCENARIOS[state.scenario] ?? SCENARIOS.typical,
  };
}

/** One costed 2027 plan with its 2026 counterpart diff. null when the plan cannot be costed. */
export function makeRow(data, state, code) {
  const meta = planMeta(data, 2027, code);
  const input = planInput(data, 2027, code);
  if (!meta || !input || !input.rate[state.enrollment]) return null;
  const inputs = costInputs(state);
  let cost;
  try { cost = planTotal(input, inputs); } catch { return null; }
  if (!Number.isFinite(cost.total)) return null;
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
  };
}

function servesState(data, code, st) {
  const area = data.serviceArea?.[code];
  if (!area) return false;
  if (area.nationwide) return true;
  return Boolean(st) && (area.states ?? []).includes(st);
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
    if (!servesState(data, code, st)) continue;
    if (nets.size && !nets.has(meta.network_family || 'Other')) continue;
    if (type !== 'all' && meta.type !== type) continue;
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

/**
 * Savings banner model.
 * {kind:'none'} | {kind:'continuing', current, best, amount} | {kind:'ended', currentPlan, current2026Total, best, amount}
 * amount = current minus best (positive = you'd save). best = cheapest eligible row by total, or null.
 */
export function savingsVsCurrent(data, state, rows) {
  const code = state.currentPlan2026;
  if (!code) return { kind: 'none' };
  let best = null;
  for (const r of rows) if (!best || r.cost.total < best.cost.total) best = r;

  const current = rows.find((r) => r.code === code) ?? (planMeta(data, 2027, code) ? makeRow(data, state, code) : null);
  if (current) {
    return { kind: 'continuing', current, best, amount: best ? cents(current.cost.total - best.cost.total) : null };
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
    amount: best && current2026Total !== null ? cents(current2026Total - best.cost.total) : null,
  };
}
