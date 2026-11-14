// Compare Board content for medical plans: worst case, value score, best-in-row and the row
// definitions the generic board renders. DOM-free (unit tested under node).
//
// A section is { key, label, rows: [rowDef] }. A rowDef is
//   { key, label, hint?, best: 'min'|'max'|null, strict?, strong?, cell(row, ctx) -> Cell }
// and a Cell is a plain descriptor the board turns into DOM with textContent only:
//   { text, sub?, tone?: 'up'|'down'|'flat'|'new'|'warn'|'muted', title?, value?: number|null,
//     meter?: 0..1, items?: string[], hook?: string }
// `value` feeds best-in-row: `best` says which direction wins; `strict` skips the highlight when any
// column has no comparable value (e.g. a $30 copay against 20% coinsurance).
// The dental/vision board (Task 7) supplies its own sections and header in this same shape.
import { usd, signedUsd, signedPct, deltaTone, DASH } from './format.js';
import { FLAG_TEXT } from '../engine/diff.js';
import { baseTotal, medsCost, anyMeds, anyDv, dvCost, dvLabel, basisOf, basisNote, medsRanked, rankTotal } from './model.js';

const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const cents = (n) => Math.round(n * 100) / 100;

const SCENARIO_TEXT = { healthy: 'healthy', typical: 'typical', condition: 'managing a condition', worst: 'worst case' };
const TYPE_TEXT = { FFS: 'PPO / FFS', HMO: 'HMO', HDHP: 'HDHP' };

/** Account money the plan puts in for this enrollment (0 when the plan has no HSA/HRA). */
export function deposit(row, enrollment) {
  if (!row.account) return 0;
  const d = row.benefits?.account_contribution?.[enrollment];
  return fin(d) && d > 0 ? d : 0;
}

/**
 * Worst-case ceiling: the most this plan can cost you in a year of in-network care.
 * annual premium + out-of-pocket max − account money, where the account money is capped the way the
 * engine caps it: an HSA deposit is cash you keep (all of it counts); an HRA credit only pays for care,
 * so it counts up to the OOP max. null when the plan lists no OOP max.
 */
export function worstCase(row, enrollment) {
  const max = row.facts?.oopMax;
  const prem = row.cost?.premium;
  if (!fin(max) || !fin(prem)) return null;
  const d = deposit(row, enrollment);
  const offset = row.account === 'HRA' ? Math.min(d, max) : d;
  return cents(prem + max - offset);
}

/**
 * Value ("bang for buck") score, 0-100.
 *   weighted = VALUE_WEIGHT × expected total + (1 − VALUE_WEIGHT) × worst-case ceiling
 *   score    = round(100 × lowest weighted among the plans you can pick ÷ this plan's weighted)
 * So the plan with the best blend of likely cost and worst-case risk scores 100, and a plan whose
 * blend costs 25% more scores 80. It is measured against every plan that passes your filters (not
 * just the board's current grouping), so a plan's score does not change when you switch "Show".
 * A plan with no OOP max has no ceiling, so no score.
 */
export const VALUE_WEIGHT = 0.75;

export function valueScores(rows, enrollment, withMeds = medsRanked(rows ?? [])) {
  const out = new Map();
  let best = Infinity;
  for (const r of rows ?? []) {
    const ceiling = worstCase(r, enrollment);
    // dental/vision (same amount on every plan) is left out, so the toggle never moves a score;
    // medications only when they are in the ranking (every plan has every drug priced)
    const t = rankTotal(r, withMeds);
    const total = fin(t) ? t - dvCost(r) : null;
    const weighted = ceiling == null || total == null ? null : VALUE_WEIGHT * total + (1 - VALUE_WEIGHT) * ceiling;
    const ok = weighted != null && weighted > 0;
    out.set(r.code, { ceiling, weighted: ok ? weighted : null, score: null });
    if (ok && weighted < best) best = weighted;
  }
  for (const v of out.values()) if (v.weighted != null) v.score = Math.round((100 * best) / v.weighted);
  return out;
}

export const VALUE_HINT = `Value blends what you will likely pay (${VALUE_WEIGHT * 100}%) with your worst-case year (${100 - VALUE_WEIGHT * 100}%). `
  + 'The best blend among the plans you can pick scores 100; a plan whose blend costs 25% more scores 80.';

/** Indices of the winning values. Needs two or more numbers that are not all equal. */
export function bestIndices(values, dir) {
  const out = new Set();
  if (dir !== 'min' && dir !== 'max') return out;
  const nums = values.filter(fin);
  if (nums.length < 2) return out;
  const best = dir === 'min' ? Math.min(...nums) : Math.max(...nums);
  if (nums.every((v) => Math.abs(v - best) < 0.5)) return out;
  values.forEach((v, i) => { if (fin(v) && Math.abs(v - best) < 0.5) out.add(i); });
  return out;
}

/** Best-in-row for one row definition over a group's cells (honors `strict`). */
export function bestInRow(def, cells) {
  const values = cells.map((c) => (fin(c.value) ? c.value : null));
  if (def.strict && values.some((v) => v == null)) return new Set();
  return bestIndices(values, def.best);
}

/** Shared context for cells: enrollment, scenario, value scores and the #1 total over every ranked row. */
export function boardContext(rankedRows, state, mine = null, baseline = null) {
  const rows = rankedRows ?? [];
  // ranking basis: medications count only when every plan has every drug priced (model.medsRanked)
  const withMeds = medsRanked(mine ? [...rows, mine] : rows);
  const totals = rows.map((r) => rankTotal(r, withMeds)).filter(fin);
  return {
    withMeds,
    enrollment: state?.enrollment ?? 'self',
    scenario: state?.scenario ?? 'typical',
    stateCode: state?.location?.state ?? null, // for the "Part of VA" chip on partial-state plans
    // fine-tune overrides or custom lines change the scenario's care
    adjusted: (state?.custom?.length ?? 0) > 0 || Object.keys(state?.overrides ?? {}).length > 0,
    values: valueScores(rows, state?.enrollment ?? 'self', withMeds),
    // medications priced on some plan: the "vs" totals compare without them (rows with `when: medsOn` say so)
    medsOn: anyMeds(mine ? [...rows, mine] : rows),
    // dental/vision added to the totals: the "vs" totals leave it out too (2026 never has it)
    dvOn: anyDv(mine ? [...rows, mine] : rows),
    minTotal: totals.length ? Math.min(...totals) : null,
    mine, // the user's 2027 plan row when "include my plan" is on: baseline for the "vs your plan" rows
    // when the user's 2026 plan ended (no 2027 version): its 2026 figures, for the "vs your 2026 plan (ended)" rows
    // { code, name, total, premium, deductible, oopMax } (model.endedBaseline)
    baseline: mine ? null : baseline,
  };
}

/** Sections (and rows) that apply to this context: anything with when(ctx) false is left out. */
export const sectionsFor = (sections, ctx) => sections
  .filter((s) => !s.when || s.when(ctx))
  .map((s) => (s.rows.some((r) => r.when) ? { ...s, rows: s.rows.filter((r) => !r.when || r.when(ctx)) } : s));

// ---------- cells ----------
const money = (n, extra = {}) => ({ text: usd(n), value: fin(n) ? n : null, ...extra });

function changeCell(field, extra) {
  return (row) => {
    const d = row.diff ?? {};
    if (d.status === 'new') return { text: 'New in 2027', tone: 'new', value: null };
    const n = d[field];
    if (!fin(n)) return { text: DASH, sub: 'no 2026 figure', value: null, tone: 'muted' };
    const tone = deltaTone(n);
    if (tone === 'flat') return { text: 'No change', tone: 'flat', value: 0 };
    return { text: signedUsd(n), sub: extra?.(d), tone, value: n };
  };
}

const ACCOUNT_TEXT = { HSA: 'Health savings account', HRA: 'Health reimbursement arrangement' };

// "vs your plan": each column minus the user's own 2027 plan (negative = cheaper than staying put).
// `excl`: a total compared without medications or dental/vision (when either is in the totals), and the cell says so.
const exclNote = (ctx) => basisNote(basisOf(ctx.medsOn, ctx.dvOn));
function vsMineCell(get, excl = false) {
  return (row, ctx) => {
    if (!ctx.mine) return { text: DASH, value: null, tone: 'muted' };
    const a = get(row);
    const b = get(ctx.mine);
    const basis = excl ? exclNote(ctx) : '';
    if (row.code === ctx.mine.code) return { text: usd(b), sub: basis ? `your baseline, ${basis}` : 'your baseline', tone: 'muted', value: null };
    if (!fin(a) || !fin(b)) return { text: DASH, value: null, tone: 'muted' };
    const n = a - b;
    const tone = deltaTone(n);
    if (tone === 'flat') return { text: 'Same', sub: basis || undefined, tone: 'flat', value: 0 };
    return { text: signedUsd(n), sub: `${n < 0 ? 'less than yours' : 'more than yours'}${basis ? ` · ${basis}` : ''}`, tone, value: n };
  };
}

// "vs your 2026 plan (ended)": each column minus what the user's ended plan cost in 2026.
function vsEndedCell(get, key, excl = false) {
  return (row, ctx) => {
    const a = get(row);
    const b = ctx.baseline?.[key];
    if (!fin(a) || !fin(b)) return { text: DASH, value: null, tone: 'muted' };
    const n = a - b;
    const tone = deltaTone(n);
    const basis = excl ? exclNote(ctx).replace('medications', 'your medications') : '';
    if (tone === 'flat') return { text: 'Same', sub: basis || undefined, tone: 'flat', value: 0 };
    return { text: signedUsd(n), sub: `${n < 0 ? `less than ${usd(b)} in 2026` : `more than ${usd(b)} in 2026`}${basis ? `, ${basis}` : ''}`, tone, value: n };
  };
}

// Total cell: say whether the user's medications are in it, apart from it, or not looked up on this plan.
function medsTotalNote(row, ctx) {
  if (!row.meds) return '';
  if (ctx?.withMeds !== false) return row.meds.entries.length ? ', incl. meds' : '';
  return row.meds.entries.length ? `; + ${usd(medsCost(row))} meds not in total` : '; meds not looked up';
}

// Medications shown apart from the "vs" totals they are left out of.
function medsApartCell(why) {
  return (row) => (row.meds?.entries?.length
    ? { text: `+ ${usd(medsCost(row))}`, sub: why, value: null }
    : { text: DASH, sub: row.meds ? 'no tiers recorded for this plan' : undefined, tone: 'muted', value: null });
}

export const MEDICAL_SECTIONS = [
  {
    key: 'vsEnded', label: 'Vs your 2026 plan (ended)', when: (ctx) => !ctx.mine && Boolean(ctx.baseline),
    rows: [
      { key: 'vsEndedTotal', label: 'Estimated total', strong: true, best: 'min', hint: 'Your 2026 plan has no 2027 version. Each plan is compared with what yours cost in 2026 for the same year of care.', cell: vsEndedCell(baseTotal, 'total', true) },
      { key: 'vsEndedMeds', label: 'Your medications', when: (ctx) => ctx.medsOn, best: null, hint: 'Left out of the line above: 2026 plans cannot be priced with your medications.', cell: medsApartCell('on this plan, not yet priced for 2026') },
      { key: 'vsEndedPremium', label: 'Premium', best: 'min', cell: vsEndedCell((r) => r.cost?.premium, 'premium') },
      { key: 'vsEndedDeductible', label: 'Deductible', best: 'min', cell: vsEndedCell((r) => r.facts?.deductible, 'deductible') },
      { key: 'vsEndedOopMax', label: 'Out-of-pocket max', best: 'min', cell: vsEndedCell((r) => r.facts?.oopMax, 'oopMax') },
    ],
  },
  {
    key: 'vsMine', label: 'Vs your plan in 2027', when: (ctx) => Boolean(ctx.mine),
    rows: [
      { key: 'vsTotal', label: 'Estimated total', strong: true, best: 'min', hint: 'When any medications are priced, this compares totals without them: they are priced only on plans where you recorded tiers.', cell: vsMineCell(baseTotal, true) },
      { key: 'vsMeds', label: 'Your medications', when: (ctx) => ctx.medsOn, best: null, hint: 'Left out of the line above, so plans with and without recorded tiers compare fairly.', cell: medsApartCell('on this plan, not in the line above') },
      { key: 'vsPremium', label: 'Premium', best: 'min', cell: vsMineCell((r) => r.cost?.premium) },
      { key: 'vsDeductible', label: 'Deductible', best: 'min', cell: vsMineCell((r) => r.facts?.deductible) },
      { key: 'vsOopMax', label: 'Out-of-pocket max', best: 'min', cell: vsMineCell((r) => r.facts?.oopMax) },
    ],
  },
  {
    key: 'cost', label: 'Cost',
    rows: [
      {
        key: 'total', label: 'Estimated total', strong: true, best: 'min',
        hint: 'Premium plus expected care costs, minus HSA or HRA money, for your scenario.',
        cell: (r, ctx) => money(rankTotal(r, ctx?.withMeds !== false), {
          sub: `${r.cost.firmness === 'fixed' ? 'fixed copays' : 'estimated'}${dvCost(r) ? `, ${dvLabel(r)} ${usd(dvCost(r))}` : ''}${medsTotalNote(r, ctx)}`,
        }),
      },
      { key: 'premium', label: 'Premium', best: 'min', cell: (r) => money(r.cost.premium, { sub: 'per year' }) },
      {
        key: 'oop', label: 'Expected care costs', best: 'min',
        cell: (r, ctx) => money(r.cost.oop, {
          sub: ctx.scenario === 'nothing' ? 'your own costs' : `${SCENARIO_TEXT[ctx.scenario] ?? 'typical'} year${ctx.adjusted ? ', adjusted' : ''}`,
        }),
      },
      {
        key: 'ceiling', label: 'Worst-case year', best: 'min',
        hint: 'Premium plus the out-of-pocket max, minus HSA or HRA money: the most a year of covered in-network care can cost.',
        cell: (r, ctx) => {
          const v = ctx.values.get(r.code)?.ceiling ?? worstCase(r, ctx.enrollment);
          return money(v, { sub: v == null ? 'no OOP max listed' : 'if you hit the OOP max' });
        },
      },
      {
        key: 'value', label: 'Value', best: 'max', hint: VALUE_HINT,
        cell: (r, ctx) => {
          const s = ctx.values.get(r.code)?.score;
          if (!fin(s)) return { text: DASH, sub: 'needs an OOP max', value: null, tone: 'muted', title: VALUE_HINT };
          const word = s >= 95 ? 'Best value' : s >= 85 ? 'Strong' : s >= 70 ? 'Fair' : 'Weak';
          return { text: String(s), sub: word, value: s, meter: s / 100, title: VALUE_HINT };
        },
      },
    ],
  },
  {
    key: 'protection', label: 'Protection',
    rows: [
      { key: 'deductible', label: 'Deductible', best: 'min', cell: (r) => money(r.facts?.deductible) },
      { key: 'oopMax', label: 'Out-of-pocket max', best: 'min', cell: (r) => money(r.facts?.oopMax) },
      {
        key: 'coinsurance', label: 'Coinsurance', best: 'min',
        cell: (r) => {
          const c = r.facts?.coinsurance;
          return fin(c) ? { text: `${c}%`, sub: 'plan-wide', value: c } : { text: DASH, sub: 'varies by service', value: null, tone: 'muted' };
        },
      },
    ],
  },
  // Care costs (primary care, specialist, ER, hospital...) live in the full benefits matrix (matrix-model.js),
  // which the board appends after these sections: one source of truth for every OPM benefit field.
  {
    key: 'account', label: 'Account',
    rows: [
      {
        key: 'account', label: 'Savings account', best: null,
        cell: (r) => (r.account ? { text: r.account, sub: ACCOUNT_TEXT[r.account] } : { text: 'None', tone: 'muted' }),
      },
      {
        key: 'deposit', label: 'Plan deposit', best: 'max',
        cell: (r, ctx) => {
          if (!r.account) return { text: DASH, value: null, tone: 'muted' };
          const d = deposit(r, ctx.enrollment);
          return { text: usd(d), sub: d ? (r.account === 'HRA' ? 'pays toward care only' : 'yours to keep') : 'none listed for 2027', value: d };
        },
      },
    ],
  },
  {
    key: 'changes', label: 'Changes since 2026',
    rows: [
      { key: 'chgPremium', label: 'Premium', best: 'min', cell: changeCell('premiumChange', (d) => (fin(d.premiumPct) ? signedPct(d.premiumPct) : undefined)) },
      { key: 'chgDeductible', label: 'Deductible', best: 'min', cell: changeCell('deductibleChange') },
      { key: 'chgOopMax', label: 'Out-of-pocket max', best: 'min', cell: changeCell('oopMaxChange') },
      {
        key: 'flags', label: 'Warning signs', best: null,
        cell: (r) => {
          const flags = r.diff?.flags ?? [];
          if (flags.length) return { text: flags.length === 1 ? '1 warning' : `${flags.length} warnings`, tone: 'warn', items: flags.map((f) => FLAG_TEXT[f] ?? f) };
          return { text: r.diff?.status === 'new' ? 'New plan' : 'None', tone: 'muted' };
        },
      },
    ],
  },
  {
    key: 'network', label: 'Network',
    rows: [
      {
        key: 'family', label: 'Network', best: null,
        cell: (r) => {
          const fam = r.plan?.network_family || 'Other';
          return { text: fam, sub: r.plan?.carrier && r.plan.carrier !== fam ? r.plan.carrier : undefined };
        },
      },
      {
        key: 'ptype', label: 'Plan type', best: null,
        cell: (r) => ({
          text: TYPE_TEXT[r.plan?.type] ?? r.plan?.type ?? DASH,
          sub: [r.plan?.network && `${r.plan.network} network`, r.plan?.nationwide ? 'nationwide' : 'regional'].filter(Boolean).join(', '),
        }),
      },
    ],
  },
  {
    key: 'drugs', label: 'Drugs',
    rows: [
      // Hook for the medications task: the board marks this cell data-hook="formulary" and leaves its content alone
      // if a `hooks.formulary(row, cellEl)` renderer is passed to the board.
      { key: 'formulary', label: 'Your medications', best: null, cell: () => ({ text: 'Formulary lookup', sub: 'drug list check coming soon', hook: 'formulary', tone: 'muted' }) },
    ],
  },
];

// ---------- header + "why it ranks here" ----------

function isLowest(row, group, get) {
  const vals = group.map(get).filter(fin);
  const mine = get(row);
  if (vals.length < 2 || !fin(mine)) return false;
  const min = Math.min(...vals);
  return Math.abs(mine - min) < 0.5 && !vals.every((v) => Math.abs(v - min) < 0.5);
}

/**
 * One line, from the numbers, saying why this column sits where it does. `scope` reads after a
 * superlative, e.g. 'of your top 3' or 'among Aetna plans'.
 */
export function whyLine(row, group, ctx, scope = '') {
  const g = group ?? [];
  const sc = scope ? ` ${scope}` : '';
  const tot = (r) => rankTotal(r, ctx?.withMeds !== false);
  const gap = fin(ctx?.minTotal) && fin(tot(row)) ? tot(row) - ctx.minTotal : null;
  const ceiling = (r) => ctx?.values?.get(r.code)?.ceiling ?? worstCase(r, ctx?.enrollment ?? 'self');
  let lead = null;
  if (row.isMine) lead = 'Your plan, 2027 version';
  // a plan serving only part of the state is never the plain "top pick": its availability is not confirmed
  else if (row.rank === 1) {
    lead = row.area !== 'partial' ? 'Lowest total for your year'
      : row.areaSplit ? 'Lowest total if it serves your address' : 'Lowest total if it serves your county';
  }
  else if (isLowest(row, g, (r) => r.cost?.premium)) lead = `Lowest premium${sc}`;
  else if (isLowest(row, g, (r) => r.cost?.oop)) lead = `Lowest expected care costs${sc}`;
  else if (isLowest(row, g, ceiling)) lead = `Smallest worst case${sc}`;
  else if (isLowest(row, g, (r) => r.facts?.deductible)) lead = `Lowest deductible${sc}`;
  else if (g[0]?.code === row.code && g.length > 1) lead = `Lowest total${sc}`;

  let tail = null;
  if (row.rank === 1) {
    const next = g.find((r) => r.code !== row.code);
    if (next && fin(tot(next)) && fin(tot(row))) tail = `${usd(tot(next) - tot(row))} less than #${next.rank}`;
  } else if (gap != null) {
    tail = gap < 0.5 ? 'ties #1 on total' : `${usd(gap)} more than #1`;
  }
  if (!lead) {
    lead = tail;
    tail = fin(row.facts?.oopMax) ? `${usd(row.facts.oopMax)} OOP max` : null;
  } else if (!tail && fin(row.facts?.oopMax)) {
    tail = `${usd(row.facts.oopMax)} OOP max`;
  }
  return [lead, tail].filter(Boolean).join('; ') || 'Ranked by estimated total';
}

/** Scope phrase for whyLine from the board's grouping mode and group label. */
export function scopeText(mode, group) {
  const n = group?.rows?.length ?? 0;
  switch (mode) {
    case 'carrier': return `among ${group.label} plans`;
    case 'type': return `among ${group.key === 'FFS' ? 'PPO' : group.key} plans`;
    case 'account': return group.key === 'none' ? 'among plans without an account' : `among ${group.key} plans`;
    case 'all': return 'of all shown';
    default: return n > 1 ? `of your top ${n}` : '';
  }
}

/** 'per year, estimated' | 'per year, incl. dental/vision' | '..., excl. meds' (the ranking basis, I3). */
export function totalLabelOf(row, withMeds = true) {
  const parts = [dvCost(row) ? dvLabel(row) : 'estimated'];
  if (row?.meds?.entries?.length) parts.push(withMeds ? 'incl. meds' : 'excl. meds');
  return `per year, ${parts.join(', ')}`;
}

/** Generic column header descriptor for a medical plan row. */
export function medicalHeader(row, group, ctx, scope) {
  const chips = row.isMine ? [{ text: 'Your plan · 2027', tone: 'mine' }] : [];
  if (row.area === 'partial') {
    chips.push({ text: row.areaSplit ? 'Part of your ZIP' : ctx?.stateCode ? `Part of ${ctx.stateCode}` : 'Part of state', tone: 'area' });
  }
  chips.push({ text: TYPE_TEXT[row.plan?.type] ?? row.plan?.type ?? 'Plan', tone: 'type' });
  if (row.account) chips.push({ text: row.account, tone: 'acct' });
  if (row.diff?.status === 'new') chips.push({ text: 'New', tone: 'new' });
  // The pinned plan sits outside the ranking: it claims its overall rank, and its filtered-view rank only
  // when filters are narrowing the board.
  let rankText = `#${row.rank}`;
  let rankSub;
  if (row.isMine && Number.isInteger(row.globalRank)) {
    rankText = `#${row.globalRank} overall`;
    if (ctx?.filtersOn) rankSub = Number.isInteger(row.viewRank) ? `#${row.viewRank} in this view` : 'not in this view';
  }
  return {
    rankText,
    rankSub,
    title: row.plan?.name ?? row.code,
    subtitle: row.plan?.carrier || row.plan?.network_family || '',
    chips,
    total: rankTotal(row, ctx?.withMeds !== false),
    totalLabel: totalLabelOf(row, ctx?.withMeds !== false),
    bar: { p: row.cost?.premium ?? 0, o: row.cost?.oop ?? 0, d: row.cost?.hsaOffset ?? 0 },
    why: whyLine(row, group, ctx, scope),
  };
}
