// Dental & Vision (FEDVIP) model: eligibility by ZIP, costed rows, ranking with "your plan" pinned, the board's
// sections and column headers, and the "add dental/vision to my total" line items. DOM-free (unit tested).
//
// Data: data/fedvip.json (pipeline/build_fedvip.py). Plan ids are `<brochure>-<option>` and identical in 2026
// and 2027, so the 2026 plan the user picks is pinned through its 2027 row. Dental premiums depend on the
// carrier's rating region for the user's ZIP (geo.zip3 / geo.zip5_regions); vision plans have one national
// rate (region 'all'). Rows have the shape the generic board and grouping expect:
//   { code, kind, rank?, plan: {...plan, network_family: carrier}, benefits, cost: {premium, oop, total, priced}, ... }
import { annualPremium, premiumBasis, dentalOop, visionOop, DENTAL_PRESETS, VISION_PRESETS } from '../engine/dental.js';
import { usd, usdExact, signedUsd, deltaTone, DASH } from './format.js';
import { normalizeUrl } from './rx-model.js';
import { FEDVIP_ID_RE } from '../state.js';

const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const cents = (n) => Math.round(n * 100) / 100;
const own = (o, k) => (o && typeof o === 'object' && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const ZIP5 = /^[0-9]{5}$/;

export const DV_KINDS = ['dental', 'vision'];
export const DV_GROUP_MODES = ['top3', 'carrier', 'all'];
export const DV_GROUP_LABELS = { top3: 'Top 3 overall', carrier: 'Top 3 per carrier', all: 'Everything' };
export const ENROLLMENT_LABEL = { self: 'self only', self_plus_one: 'self plus one', family: 'self and family' };
const TIER_LABEL = { 'In-Network 1': 'In-network', 'In-Network 2': 'Second network tier', 'Out-of-Network': 'Out-of-network' };

/** What OPM's FEDVIP files do not say (shown on the tab; never invented). */
export const OPM_LIMITS = {
  dental: 'OPM’s FEDVIP file does not say whether a plan is a PPO or HMO-style network, and lists no waiting periods for preventive, basic or major care (only orthodontia). Check the brochure before you enroll.',
  vision: 'OPM’s FEDVIP file gives exam, lens and frame frequencies and copays as text only: no dollar allowances for frames or contacts. Plans are ranked by premium plus the copays the text states.',
};

const yearOf = (fv, y) => own(own(fv, 'years'), y);

/** Rating region of `brochure` at a ZIP (ZIP5 override first, then the ZIP3), or null when not offered. */
export function regionFor(fv, year, zip, brochure) {
  const geo = own(yearOf(fv, year), 'geo');
  if (!geo || typeof zip !== 'string' || !ZIP5.test(zip)) return null;
  const z5 = own(own(geo.zip5_regions, zip), brochure);
  if (typeof z5 === 'string') return z5;
  const r = own(own(own(geo.zip3, zip.slice(0, 3)), 'regions'), brochure);
  return typeof r === 'string' ? r : null;
}

/**
 * Plans open at a ZIP: [{ id, plan, region }] sorted by id. Dental needs a ZIP (premiums are regional);
 * vision plans are nationwide with one rate, so they are open with or without a ZIP.
 */
export function eligiblePlans(fv, zip, kind, year = '2027') {
  const Y = yearOf(fv, year);
  if (!Y || !DV_KINDS.includes(kind)) return [];
  const z = typeof zip === 'string' && ZIP5.test(zip) ? zip : null;
  const out = [];
  for (const [id, plan] of Object.entries(Y.plans ?? {})) {
    if (!plan || plan.type !== kind) continue;
    const rates = own(Y.rates, id);
    if (!rates) continue;
    let region = z ? regionFor(fv, year, z, plan.brochure) : null;
    if (kind === 'vision' && !region && plan.nationwide) region = 'all';
    if (!region) continue;
    if (!own(rates, region) && !own(rates, 'all')) continue;
    out.push({ id, plan, region });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const rateSetOf = (Y, id, region) => own(own(Y?.rates, id), region) ?? own(own(Y?.rates, id), 'all') ?? null;

/** One costed row, or null when the plan has no premium for this coverage. */
export function dvRow(fv, id, region, state, kind) {
  const Y = yearOf(fv, '2027');
  const plan = own(Y?.plans, id);
  if (!plan) return null;
  const enrollment = state?.enrollment ?? 'self';
  const status = state?.status ?? 'active';
  const rates = rateSetOf(Y, id, region);
  const rate = own(rates, enrollment);
  const premium = annualPremium(rate, status);
  if (premium == null) return null;
  const benefits = own(Y.benefits, id) ?? {};
  let cost;
  if (kind === 'dental') {
    const r = dentalOop(benefits, state?.dentalUse ?? 'typical');
    cost = {
      premium, oop: r.priced ? r.oop : null, priced: r.priced, approx: r.approx, capped: r.capped, orthoCapped: r.orthoCapped,
      warnings: r.warnings, detail: r, total: cents(premium + (r.priced ? r.oop : 0)),
    };
  } else {
    const r = visionOop(benefits, state?.visionUse ?? 'glasses');
    cost = { premium, oop: r.oop, priced: r.priced, approx: false, warnings: [], note: r.note, detail: r, total: cents(premium + (fin(r.oop) ? r.oop : 0)) };
  }
  cost.basis = premiumBasis(rate, status);
  const Y26 = yearOf(fv, '2026');
  const plan2026 = own(Y26?.plans, id) ?? null;
  const prem26 = plan2026 ? annualPremium(own(rateSetOf(Y26, id, region), enrollment), status) : null;
  return {
    code: id, kind, region, rates, status, enrollment,
    plan: { ...plan, network_family: plan.carrier },
    plan2026, benefits, benefits2026: own(Y26?.benefits, id) ?? null,
    premium2026: prem26, cost,
  };
}

/** Every eligible, costed plan of one kind for this state (ZIP, coverage, pay basis, usage preset). Unsorted. */
export function dvRows(fv, state, kind) {
  return eligiblePlans(fv, state?.location?.zip ?? null, kind)
    .map((e) => dvRow(fv, e.id, e.region, state, kind))
    .filter(Boolean);
}

const byTotal = (a, b) => a.cost.total - b.cost.total || a.cost.premium - b.cost.premium || a.code.localeCompare(b.code);

/**
 * rankDv(rows) -> rows sorted by estimated total with rank 1..n.
 * rankDv(rows, { withMine: true, mineId, all }) -> { ranked, others, mine, mineStatus }
 *   all: every eligible row before filters (for the pinned plan's true rank; defaults to rows).
 *   mineStatus: 'none' | 'included' | 'not-offered' (the plan is not open at this ZIP: not pinned, never invented)
 */
export function rankDv(rows, opts = {}) {
  const ranked = (rows ?? []).slice().sort(byTotal).map((r, i) => ({ ...r, rank: i + 1 }));
  if (!opts.withMine) return ranked;
  const id = opts.mineId;
  if (!id) return { ranked, others: ranked, mine: null, mineStatus: 'none' };
  const all = (opts.all ?? rows ?? []).slice().sort(byTotal);
  const at = all.findIndex((r) => r.code === id);
  if (at < 0) return { ranked, others: ranked, mine: null, mineStatus: 'not-offered' };
  const inView = ranked.find((r) => r.code === id);
  const mine = { ...all[at], isMine: true, rank: at + 1, globalRank: at + 1, viewRank: inView ? inView.rank : null };
  const others = ranked.filter((r) => r.code !== id);
  return { ranked: [...others, mine].sort(byTotal), others, mine, mineStatus: 'included' };
}

/** Filters: carriers (none = all), area 'any'|'nationwide'|'regional', oon (pays out of network), in2 (second tier). */
export function filterDvRows(rows, { carriers = [], area = 'any', oon = false, in2 = false } = {}) {
  const cs = new Set(carriers ?? []);
  return (rows ?? []).filter((r) => {
    if (cs.size && !cs.has(r.plan.carrier)) return false;
    if (area === 'nationwide' && !r.plan.nationwide) return false;
    if (area === 'regional' && r.plan.nationwide) return false;
    const tiers = r.plan.network_tiers ?? [];
    if (oon && !tiers.includes('Out-of-Network')) return false;
    if (in2 && !tiers.includes('In-Network 2')) return false;
    return true;
  });
}

export const dvCarriers = (rows) => [...new Set((rows ?? []).map((r) => r.plan.carrier))].sort();

/** Shared board context. */
export function dvContext(rows, state, kind, mine = null) {
  const totals = (rows ?? []).map((r) => r.cost?.total).filter(fin);
  return {
    kind,
    enrollment: state?.enrollment ?? 'self',
    status: state?.status ?? 'active',
    use: kind === 'dental' ? state?.dentalUse ?? 'typical' : state?.visionUse ?? 'glasses',
    zip: state?.location?.zip ?? null,
    mine,
    minTotal: totals.length ? Math.min(...totals) : null,
  };
}

// ---------- cells ----------
const muted = (text, extra = {}) => ({ text, tone: 'muted', value: null, ...extra });
const isNA = (t) => typeof t !== 'string' || /^(n\/a|na|)$/i.test(t.trim());
const tidy = (t) => (/^[A-Z0-9 .,$%-]+$/.test(t) && /[A-Z]{3}/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t);

const BEST = { deductible: 'min', annual_max: 'max', class_a: 'min', class_b: 'min', class_c: 'min', class_d: 'min', ortho_lifetime: 'max' };
const BIG = 1e9; // "unlimited" for best-in-row

function benefitCell(row, key) {
  const c = own(row.benefits, key);
  const text = c && typeof c.text === 'string' ? c.text.trim() : '';
  if (isNA(text)) return muted(key.startsWith('in2_') || key.startsWith('oon_') ? 'Not offered' : 'Not listed');
  const base = key.replace(/^(in2_|oon_)/, '');
  if (c.unit === 'unlimited') return { text: base === 'ortho_lifetime' ? 'No lifetime max' : 'Unlimited', value: BIG, note: text.length > 12 ? text : undefined };
  if (c.unit === 'usd' && fin(c.value)) {
    const simple = /^\$?[0-9,.]+$|^none$/i.test(text);
    return { text: usd(c.value), value: c.value, note: simple ? undefined : text };
  }
  if (c.unit === 'pct' && fin(c.value)) {
    const simple = /^[0-9.]+%( coinsurance)?$/i.test(text);
    return { text: `${c.approx ? '≈ ' : ''}${c.value}%`, sub: c.approx ? 'copayment schedule' : undefined, value: c.value, note: simple ? undefined : text };
  }
  return { text: tidy(text), value: null, kind: text.length > 60 ? 'long' : undefined };
}

function premiumCell(row, enr, ctx) {
  const p = annualPremium(own(row.rates, enr), row.status ?? ctx.status);
  if (p == null) return muted(DASH);
  return { text: usd(p), sub: enr === ctx.enrollment ? 'your coverage, per year' : 'per year', value: p };
}

function totalCell(row, ctx) {
  const c = row.cost;
  if (!c.priced && ctx.kind === 'dental') {
    return { text: usd(c.total), sub: 'premium only: care not priced', tone: 'warn', value: c.total, title: c.warnings.join(' ') };
  }
  if (!c.priced) return { text: usd(c.total), sub: 'estimated: some costs in text only', value: c.total, title: c.note };
  return { text: usd(c.total), sub: c.approx ? 'estimated (approximate %)' : 'estimated', value: c.total };
}

function oopCell(row, ctx) {
  const c = row.cost;
  const label = (ctx.kind === 'dental' ? DENTAL_PRESETS : VISION_PRESETS)[ctx.use]?.label ?? '';
  if (ctx.kind === 'dental') {
    if (!c.priced) return { text: 'Not priced', sub: 'OPM text we cannot read', tone: 'warn', value: null, title: c.warnings.join(' ') };
    const bits = [label];
    if (c.capped) bits.push('hits the annual max');
    if (c.orthoCapped) bits.push('hits the ortho max');
    return { text: usd(c.oop), sub: bits.join(', '), value: c.oop };
  }
  if (!c.priced) return { text: fin(c.oop) ? `${usd(c.oop)} +` : 'Not priced', sub: 'benefit details in text', tone: 'muted', value: null, title: c.note };
  return { text: usd(c.oop), sub: `${label}, copays`, value: c.oop };
}

const premiumHow = (row) => {
  const b = row.cost.basis;
  return b ? `${usdExact(b.each)} a ${b.per} × ${b.count}` : '';
};

function vsCell(get) {
  return (row, ctx) => {
    if (!ctx.mine) return muted(DASH);
    const a = get(row);
    const b = get(ctx.mine);
    if (row.code === ctx.mine.code) return fin(b) ? { text: usd(b), sub: 'your baseline', tone: 'muted', value: null } : muted(DASH);
    if (!fin(a) || !fin(b)) return muted(DASH);
    const n = cents(a - b);
    const tone = deltaTone(n);
    if (tone === 'flat') return { text: 'Same', tone: 'flat', value: 0 };
    return { text: signedUsd(n), sub: n < 0 ? 'less than yours' : 'more than yours', tone, value: n };
  };
}

/** "Label: 'old' -> 'new'" for every benefit cell whose OPM text changed since 2026. */
export function benefitChanges(row, labels) {
  if (!row.benefits2026) return null;
  const out = [];
  for (const [key, label] of labels) {
    const a = own(row.benefits2026, key)?.text;
    const b = own(row.benefits, key)?.text;
    if ((a ?? '') !== (b ?? '')) out.push(`${label}: “${a ?? 'not listed'}” → “${b ?? 'not listed'}”`);
  }
  return out;
}

const TIERS_TEXT = (tiers) => (tiers ?? []).map((t) => TIER_LABEL[t] ?? t);

function linkCell(url, text) {
  const href = normalizeUrl(url);
  return href ? { text, link: { href, text }, value: null } : muted(DASH);
}

/**
 * Board sections for one kind: [vsMine], est (your estimate), one section per meta.board section (data-driven:
 * premium rows from rates, the rest from OPM's benefit cells), Changes since 2026, Plan details.
 */
export function dvSections(fv, kind, ctx) {
  const board = own(own(own(fv, 'meta'), 'board'), kind) ?? [];
  const labels = [];
  for (const s of board) for (const r of s.rows) if (r.source !== 'rates') labels.push([r.key, r.label]);
  const out = [];
  if (ctx.mine) {
    out.push({
      key: 'vsMine', label: 'Vs your plan',
      rows: [
        { key: 'vsTotal', label: 'Estimated total', strong: true, best: 'min', hint: 'Each plan minus your own plan, same ZIP, coverage and usage.', cell: vsCell((r) => r.cost.total) },
        { key: 'vsPremium', label: 'Premium', best: 'min', cell: vsCell((r) => r.cost.premium) },
        { key: 'vsOop', label: 'Expected out-of-pocket', best: 'min', cell: vsCell((r) => (r.cost.priced ? r.cost.oop : null)) },
      ],
    });
  }
  out.push({
    key: 'est', label: 'Your estimate',
    rows: [
      {
        key: 'total', label: 'Estimated total', strong: true, best: 'min', keep: true,
        hint: kind === 'dental'
          ? 'Yearly premium for your coverage level plus one person’s out-of-pocket for the usage you picked (not multiplied by the people covered), at assumed prices, after the deductible, coinsurance and maximums.'
          : 'Yearly premium plus the copays OPM’s text states for the usage you picked.',
        cell: (r, c) => totalCell(r, c),
      },
      { key: 'premium', label: 'Premium', labelSub: 'your coverage', best: 'min', cell: (r) => ({ text: usd(r.cost.premium), sub: premiumHow(r), value: r.cost.premium }) },
      { key: 'oop', label: kind === 'dental' ? 'Expected out-of-pocket' : 'Expected copays', best: 'min', cell: (r, c) => oopCell(r, c) },
    ],
  });
  for (const s of board) {
    out.push({
      key: `fv-${s.id}`, label: s.title, collapsible: true, open: s.id !== 'network',
      note: s.id === 'network' ? 'Second network tier and out-of-network cells, as OPM lists them.' : undefined,
      rows: s.rows.map((r) => (r.source === 'rates'
        ? { key: r.key, label: r.label, best: 'min', cell: (row, c) => premiumCell(row, r.key.replace('premium_', ''), c) }
        : { key: r.key, label: r.label, best: BEST[r.key] ?? null, cell: (row) => benefitCell(row, r.key) })),
    });
  }
  const chg = own(own(fv, 'changes'), kind) ?? {};
  out.push({
    key: 'changes', label: 'Changes since 2026',
    rows: [
      {
        key: 'chgPremium', label: 'Premium', labelSub: 'your coverage and region', best: 'min',
        cell: (r) => {
          if (!r.plan2026) return { text: 'New in 2027', tone: 'new', value: null };
          if (!fin(r.premium2026)) return muted(DASH, { sub: 'no 2026 rate for this region' });
          const n = cents(r.cost.premium - r.premium2026);
          const tone = deltaTone(n);
          if (tone === 'flat') return { text: 'No change', tone: 'flat', value: 0 };
          const pct = r.premium2026 > 0 ? Math.round((n / r.premium2026) * 1000) / 10 : null;
          return { text: signedUsd(n), sub: `${pct != null ? `${pct > 0 ? '+' : ''}${pct}%, ` : ''}was ${usd(r.premium2026)}`, tone, value: n };
        },
      },
      {
        key: 'chgBenefits', label: 'Benefit changes', best: null,
        cell: (r) => {
          const items = benefitChanges(r, labels);
          if (items == null) return { text: 'New in 2027', tone: 'new', value: null };
          if (!items.length) return { text: 'No change', tone: 'flat', value: null };
          return { text: items.length === 1 ? '1 change' : `${items.length} changes`, tone: 'warn', items, value: null };
        },
      },
      {
        key: 'chgArea', label: 'Service area', best: null,
        cell: (r) => {
          const sa = own(own(chg, 'service_area_changes'), r.code);
          if (!sa) return { text: 'No change', tone: 'flat', value: null };
          return { text: 'Changed', tone: 'warn', items: [...sa.added.map((a) => `Added: ${a}`), ...sa.removed.map((a) => `Removed: ${a}`)], value: null };
        },
      },
    ],
  });
  out.push({
    key: 'plan', label: 'Plan details',
    rows: [
      { key: 'carrier', label: 'Carrier', best: null, cell: (r) => ({ text: r.plan.carrier, sub: `${r.plan.option} option` }) },
      {
        key: 'area', label: 'Where it is offered', best: null,
        cell: (r) => (r.plan.nationwide
          ? { text: 'Nationwide', value: null }
          : { text: 'Regional', sub: (r.plan.service_areas ?? []).slice(0, 4).join('; ') + ((r.plan.service_areas ?? []).length > 4 ? '…' : ''), value: null, title: (r.plan.service_areas ?? []).join('; ') }),
      },
      {
        key: 'tiers', label: 'Networks', best: null,
        cell: (r) => {
          const t = r.plan.network_tiers ?? [];
          return { text: t.includes('Out-of-Network') ? 'Pays out of network' : 'In-network only', items: TIERS_TEXT(t), value: null };
        },
      },
      { key: 'phone', label: 'Phone', best: null, cell: (r) => (r.plan.phone ? { text: r.plan.phone, value: null } : muted(DASH)) },
      { key: 'website', label: 'Website', best: null, cell: (r) => linkCell(r.plan.website, 'Plan website') },
      { key: 'directory', label: kind === 'dental' ? 'Find a dentist' : 'Find an eye doctor', best: null, cell: (r) => linkCell(r.plan.directory, 'Provider directory') },
    ],
  });
  return out;
}

/**
 * Differences only and row search over built sections. Rows marked `keep` (the estimated total) always stay.
 * -> { sections (rows carry `differs`), hiddenRows, matched }
 */
export function filterDvSections(sections, rows, ctx, { diffOnly = false, query = '' } = {}) {
  const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  let hiddenRows = 0;
  let matched = 0;
  const out = [];
  for (const s of sections) {
    const kept = [];
    for (const def of s.rows) {
      const sig = (rows ?? []).map((r) => { const c = def.cell(r, ctx); return `${c.text}|${c.sub ?? ''}|${(c.items ?? []).join(',')}`; });
      const differs = new Set(sig).size > 1;
      const hit = tokens.length && tokens.every((t) => def.label.toLowerCase().includes(t));
      if (tokens.length && !hit && !def.keep) continue;
      if (hit) matched += 1;
      if (diffOnly && !differs && !def.keep && !s.key.startsWith('vs')) { hiddenRows += 1; continue; }
      kept.push({ ...def, differs: (rows ?? []).length > 1 && differs });
    }
    if (kept.length) out.push({ ...s, rows: kept, ...(tokens.length && s.collapsible ? { open: true } : {}) });
  }
  return { sections: out, hiddenRows, matched };
}

const isLowest = (row, group, get) => {
  const vals = group.map(get).filter(fin);
  const v = get(row);
  if (vals.length < 2 || !fin(v)) return false;
  const min = Math.min(...vals);
  return Math.abs(v - min) < 0.5 && !vals.every((x) => Math.abs(x - min) < 0.5);
};

/** Column header descriptor (same shape as the medical board's). */
export function dvHeader(row, group, ctx, scope = '') {
  const g = group ?? [];
  const sc = scope ? ` ${scope}` : '';
  const chips = row.isMine ? [{ text: 'Your plan', tone: 'mine' }] : [];
  chips.push({ text: row.plan.option, tone: 'type' });
  chips.push({ text: row.plan.nationwide ? 'Nationwide' : 'Regional', tone: 'acct' });
  if (!row.cost.priced && ctx.kind === 'dental') chips.push({ text: 'Premium only', tone: 'new' });
  let lead = null;
  if (row.isMine) lead = 'Your plan, 2027 rates';
  else if (row.rank === 1) lead = 'Lowest estimated total';
  else if (isLowest(row, g, (r) => r.cost.premium)) lead = `Lowest premium${sc}`;
  else if (isLowest(row, g, (r) => (r.cost.priced ? r.cost.oop : null))) lead = `Lowest out-of-pocket${sc}`;
  let tail = null;
  const gap = fin(ctx.minTotal) ? row.cost.total - ctx.minTotal : null;
  if (row.rank === 1) {
    const next = g.find((r) => r.code !== row.code);
    if (next) tail = `${usd(next.cost.total - row.cost.total)} less than #${next.rank}`;
  } else if (gap != null) tail = gap < 0.5 ? 'ties #1 on total' : `${usd(gap)} more than #1`;
  return {
    rankText: row.isMine && Number.isInteger(row.globalRank) ? `#${row.globalRank}` : `#${row.rank}`,
    title: `${row.plan.name}, ${row.plan.option}`,
    subtitle: row.plan.carrier !== row.plan.name ? row.plan.carrier : `${row.plan.option} option`,
    chips,
    total: row.cost.total,
    totalLabel: !row.cost.priced && ctx.kind === 'dental' ? 'per year, premium only' : 'per year, estimated',
    bar: { p: row.cost.premium, o: fin(row.cost.oop) ? row.cost.oop : 0, d: 0 },
    why: [lead, tail].filter(Boolean).join('; ') || 'Ranked by estimated total',
  };
}

// ---------- ranked cards (the default Dental & Vision view, same look as the health plan cards) ----------
/** Key benefits a card shows, per kind: OPM benefit cell keys with short labels. */
export const DV_CARD_FACTS = {
  dental: [['deductible', 'Deductible'], ['annual_max', 'Annual maximum'], ['class_b', 'Basic care, you pay'], ['class_c', 'Major care, you pay'], ['class_d', 'Orthodontia, you pay']],
  vision: [['exam', 'Eye exam'], ['lenses', 'Lenses'], ['frames', 'Frames'], ['copay', 'Copays']],
};

/**
 * One card's content: dvCard(row, ctx) -> { code, rankText, isTop, isMine, title, meta, total, totalLabel, why,
 *   chips, premium: {text, sub}, oop: {label, text, sub, tone}, facts: [{key, label, text, sub, title}],
 *   vsMine: {text, tone, title} | null, links: [{href, text}], bar: {p, o} }.
 * Built from the board's own header and cells, so cards and board never disagree.
 */
export function dvCard(row, ctx) {
  const hd = dvHeader(row, [], ctx);
  const oc = oopCell(row, ctx);
  const facts = (DV_CARD_FACTS[ctx.kind] ?? []).map(([key, label]) => {
    const c = benefitCell(row, key);
    return { key, label, text: c.text, sub: c.sub, title: c.note ?? (c.kind === 'long' ? c.text : undefined), tone: c.tone };
  });
  let vsMine = null;
  if (ctx.mine && !row.isMine && fin(ctx.mine.cost?.total)) {
    const n = cents(row.cost.total - ctx.mine.cost.total);
    const tone = deltaTone(n);
    vsMine = { text: tone === 'flat' ? 'Same as your plan' : `${signedUsd(n)} vs your plan`, tone, title: 'Estimated yearly total compared with your plan in 2027, same ZIP, coverage and usage' };
  }
  const links = [
    { href: normalizeUrl(row.plan.website), text: 'Plan website' },
    { href: normalizeUrl(row.plan.directory), text: ctx.kind === 'dental' ? 'Find a dentist' : 'Find an eye doctor' },
  ].filter((l) => l.href);
  return {
    code: row.code,
    rankText: hd.rankText,
    isTop: row.rank === 1 && !row.isMine,
    isMine: row.isMine === true,
    title: hd.title,
    meta: [row.plan.carrier, row.plan.nationwide ? 'Nationwide' : 'Regional', `plan ${row.code}`].filter(Boolean).join(' · '),
    total: row.cost.total,
    totalLabel: hd.totalLabel,
    why: hd.why,
    chips: hd.chips.filter((c) => c.tone !== 'type' && c.tone !== 'acct'),
    premium: { text: usd(row.cost.premium), sub: premiumHow(row) },
    oop: { label: ctx.kind === 'dental' ? 'Expected out-of-pocket' : 'Expected copays', text: oc.text, sub: oc.sub, tone: oc.tone, title: oc.title },
    facts,
    vsMine,
    links,
    bar: hd.bar,
  };
}

// ---------- add dental/vision to my total ----------
const addCache = new WeakMap();

/**
 * The dental and vision line items added to every medical plan's total when state.dental is on.
 * -> null (off or no data) | { dental: item|null, vision: item|null, total }
 * item = { kind, id, name, option, amount|null, premium, oop, priced, auto, use, note }
 * The pick (state.dentalPlan / visionPlan): null = the cheapest eligible plan by estimated total; 'none' = leave
 * it out; an id = that plan (when it is not offered at the ZIP: the cheapest, with a note).
 */
export function dvAddOn(fv, state) {
  if (!fv || typeof fv !== 'object' || !state?.dental) return null;
  const sig = [state.location?.zip, state.enrollment, state.status, state.dentalUse, state.visionUse, state.dentalPlan, state.visionPlan].join('|');
  let byFv = addCache.get(fv);
  if (!byFv) { byFv = new Map(); addCache.set(fv, byFv); }
  if (byFv.has(sig)) return byFv.get(sig);
  const item = (kind) => {
    const pick = kind === 'dental' ? state.dentalPlan : state.visionPlan;
    if (pick === 'none') return null;
    const use = kind === 'dental' ? state.dentalUse : state.visionUse;
    const useLabel = (kind === 'dental' ? DENTAL_PRESETS : VISION_PRESETS)[use]?.label ?? '';
    const zip = state.location?.zip ?? null;
    if (kind === 'dental' && !zip) {
      return { kind, id: null, name: null, amount: null, auto: !pick, use: useLabel, note: 'Enter your ZIP code to price dental: premiums depend on where you live.' };
    }
    const rows = rankDv(dvRows(fv, state, kind));
    if (!rows.length) return { kind, id: null, name: null, amount: null, auto: !pick, use: useLabel, note: `No ${kind} plan is listed for ZIP ${zip}.` };
    const chosen = pick ? rows.find((r) => r.code === pick) : null;
    const row = chosen ?? rows[0];
    // vision presets the text cannot fully price (contacts, a lone unlabelled copay) carry their caveat
    let note = row.cost.priced ? '' : row.cost.note ?? (row.cost.warnings ?? []).join(' ');
    if (pick && !chosen) {
      const p = own(yearOf(fv, '2027')?.plans, pick);
      const away = `${p ? `${p.name} ${p.option}` : 'Your pick'} is not offered${zip ? ` at ZIP ${zip}` : ''}; the cheapest plan for you is used instead.`;
      note = note ? `${away} ${note}` : away;
    }
    return {
      kind, id: row.code, name: row.plan.name, option: row.plan.option, amount: row.cost.total, premium: row.cost.premium,
      oop: row.cost.oop, priced: row.cost.priced, auto: !chosen, use: useLabel, note,
    };
  };
  const dental = item('dental');
  const vision = item('vision');
  const total = cents([dental, vision].reduce((s, it) => s + (fin(it?.amount) ? it.amount : 0), 0));
  const res = { dental, vision, total };
  byFv.set(sig, res);
  if (byFv.size > 64) byFv.delete(byFv.keys().next().value);
  return res;
}

/** Drop FEDVIP ids the data does not know (or of the wrong kind). Same object back when nothing changes. */
export function sanitizeDvState(state, fv) {
  const Y = yearOf(fv, '2027');
  const Y26 = yearOf(fv, '2026');
  if (!Y || !state) return state;
  const ok = (id, kind, years = [Y]) => typeof id === 'string' && FEDVIP_ID_RE.test(id) && years.some((y) => own(own(y, 'plans'), id)?.type === kind);
  const pick = (v, kind) => (v == null || v === 'none' || ok(v, kind) ? v : null);
  const next = {
    dentalPlan: pick(state.dentalPlan, 'dental'),
    visionPlan: pick(state.visionPlan, 'vision'),
    myDental: state.myDental && ok(state.myDental, 'dental', [Y26 ?? Y]) ? state.myDental : null,
    myVision: state.myVision && ok(state.myVision, 'vision', [Y26 ?? Y]) ? state.myVision : null,
  };
  if (Object.keys(next).every((k) => next[k] === state[k])) return state;
  return { ...state, ...next };
}

/** 2026 plans of one kind for the "your 2026 plan" picker: [{ id, name, option, carrier }] by name. */
export function plans2026(fv, kind) {
  const Y = yearOf(fv, '2026');
  return Object.entries(Y?.plans ?? {})
    .filter(([, p]) => p.type === kind)
    .map(([id, p]) => ({ id, name: p.name, option: p.option, carrier: p.carrier }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.option.localeCompare(b.option));
}
