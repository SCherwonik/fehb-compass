import { ASSUMED_PRICES, FALLBACK_COINSURANCE } from './assumptions.js';
import { CUSTOM_KINDS } from './scenarios.js';
import { maternityAssumptionValues, estimateText } from './maternity-assumptions.js';

const cents = (n) => Math.round(n * 100) / 100;

/** Annual premium: active = biweekly x 26, retiree = monthly x 12. */
export function annualPremium(rate, { status, enrollment }) {
  const r = rate[enrollment];
  if (!r) throw new Error(`No rate for enrollment "${enrollment}"`);
  return status === 'retiree' ? cents(r.monthly_retiree * 12) : cents(r.biweekly_active * 26);
}

/** Pick the enrollment-specific scalars from raw benefits. */
export function resolveBenefits(benefits, enrollment) {
  const pick = (o) => (o && typeof o === 'object' ? (o[enrollment] ?? null) : (o ?? null));
  return {
    deductible: pick(benefits.deductible),
    oopMax: pick(benefits.oop_max),
    coinsurance: benefits.coinsurance ?? null,
    copays: benefits.copays || {},
    // HSA-qualified plans are HDHPs: by IRS rule the deductible applies to everything but preventive
    // care, so a copay line that is silent about the deductible still sits behind it.
    deductibleDefault: /savings/i.test(String(benefits.account_type ?? '')),
    // Out-of-network: OPM lists only a deductible and an OOP max (no cost-sharing rates).
    oon: { deductible: pick(benefits.out_of_network?.deductible), oopMax: pick(benefits.out_of_network?.oop_max) },
    tier0: benefits.raw?.['Tier 0'] ?? null, // "$0 preventive drugs and vaccines - $0 Copayment"
    // One pregnancy's terms, brochure-reviewed (pipeline/maternity_terms.json); {priced: false, reason} otherwise.
    maternity: benefits.maternity ?? null,
  };
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * How a plan's Self Plus One / Self and Family deductible works for one person. It differs by plan and OPM's data does
 * not record it; some brochures state it in their own words (e.g. V41: "The full Self plus One or Self and Family
 * deductible must be satisfied ..."), others do not, and WX1's summary is unclear (UNCLEAR_FAMILY_DEDUCTIBLE). The data
 * files carry no such field, so this is the app's assumption from the plan type (see About > How it works):
 *   'embedded'  every plan that is not an HDHP: each person has the self-only deductible (until the family's deductible
 *               spending reaches the family deductible) and the self-only OOP max inside the family ones;
 *   'aggregate' an HSA HDHP whose family deductible is exactly twice the self-only one (the IRS family minimum
 *               rules this out as an embedded per-person amount): one person must meet the whole family deductible;
 *   'unknown'   any other HDHP (e.g. an HDHP with an HRA): modeled like 'aggregate', the cautious choice.
 */
/** Plans whose brochure or summary words the family deductible unclearly (modeled by deductibleType all the same). */
export const UNCLEAR_FAMILY_DEDUCTIBLE = Object.freeze({
  WX1: 'Its 2026 summary of benefits says each family member meets their own deductible until the family total is met, which does not fit the IRS family minimum for an HSA plan, so its wording is unclear',
});

export function deductibleType(benefits) {
  const account = String(benefits?.account_type ?? '');
  const hsa = /savings/i.test(account);
  const hdhp = hsa || /hdhp/i.test(String(benefits?.raw?.['Plan Option Type'] ?? ''));
  if (!hdhp) return 'embedded';
  const d = benefits?.deductible;
  if (hsa && d && typeof d === 'object' && fin(d.self) && d.self > 0
    && [d.self_plus_one, d.family].every((v) => v == null || v === 2 * d.self)) return 'aggregate';
  return 'unknown';
}

/**
 * The limits that apply to ONE covered person's care under this enrollment (each scenario is one person's year).
 * -> {deductible, oopMax, oon: {deductible, oopMax}, type}. Self enrollment: the plan's self-only limits.
 * Self Plus One / Family: embedded plans use the self-only deductible and OOP max; aggregate (and unknown) HDHPs
 * use the enrollment's deductible. Every person's out-of-pocket max is the plan's own self-only one: the app's stated
 * assumption (some brochures say so and OPM asks plans to track each member's costs from 2026; not verified per plan).
 * Raw benefits with scalar limits (test fixtures) pass through unchanged.
 */
export function personLimits(benefits, enrollment) {
  const type = deductibleType(benefits);
  const one = (o) => {
    if (!o || typeof o !== 'object') return { ded: o ?? null };
    const own = o[enrollment] ?? null;
    return { own, self: o.self ?? null };
  };
  const limits = (ded, max) => {
    const d = one(ded);
    const m = one(max);
    if (!('own' in d)) return { deductible: d.ded, oopMax: m.own ?? m.ded ?? null };
    if (enrollment === 'self') return { deductible: d.own, oopMax: m.own ?? null };
    const deductible = type === 'embedded' ? (d.self ?? d.own) : d.own;
    const caps = [m.own, m.self].filter(fin);
    const oopMax = caps.length ? Math.min(...caps) : null;
    return { deductible, oopMax };
  };
  const inNet = limits(benefits?.deductible, benefits?.oop_max);
  const oon = limits(benefits?.out_of_network?.deductible, benefits?.out_of_network?.oop_max);
  return { deductible: inNet.deductible, oopMax: inNet.oopMax, oon: { deductible: oon.deductible, oopMax: oon.oopMax }, type };
}

// Phrase classes found in every 2027 copay `raw` string (see tests/engine/deductible.test.js).
const NO_DED = new RegExp([
  'no deductible',
  'deductibles? (?:does|do) not apply',
  'deductibles? (?:is |are )?waived', // "Plan deductible is waived." / "deductible waived"
  'waived (?:the |your |plan )?deductible',
  'not subject to (?:the )?deductible', // must beat DED's "subject to deductible"
].join('|'), 'i');
const DED = new RegExp([
  'deductible applies',
  'deductible may or may not apply', // ambiguous: assume it applies (conservative, and marks the total estimated)
  'after\\b[^.;]{0,40}?deductible', // after deductible / after the / after plan / after in-network / after $X facility
  'calendar year deductible', // HDHP lines: "$0 Copayment - $1,750/$3,500 Calendar Year Deductible"
  'annual [a-z ]{0,20}deductible', // "$X annual hospital deductible ... then 20% coinsurance"
  'plus deductible',
  '\\+ ?deductible', // "+ Deductible, + cost-shares apply"
  'subject to (?:the )?deductible',
].join('|'), 'i');

/** Does this copay line sit behind the deductible? Explicit "no deductible" wins; silence -> defaultYes. */
export function appliesDeductible(raw, defaultYes) {
  const t = raw || '';
  if (NO_DED.test(t)) return false;
  if (DED.test(t)) return true;
  return defaultYes;
}

// Custom line kind -> the plan benefit (copays key) that prices it. 'other' and rx kinds have none:
// 'other' uses the plan coinsurance after the deductible; rx kinds use the tier the user picks.
export const KIND_SERVICES = {
  pcp: 'primary_care',
  specialist: 'specialist',
  urgent: 'urgent_care',
  er: 'emergency',
  hospital_stay: 'inpatient_admission',
  surgery_outpatient: 'outpatient_facility',
  lab: 'lab_xray',
  imaging: 'imaging',
  therapy: 'physical_therapy',
  maternity: 'maternity', // priced from benefits.maternity (see maternityShare), never from the OPM copays cell
};

/** The one-line card tag for a plan whose maternity terms cannot be priced (maternityGap has the full sentence). */
export const MATERNITY_UNPRICED = 'Maternity not priced: the plan’s brochure doesn’t give a total';

// How each kind of unpriced brochure term is stated (maternityGap): the gap is in the plan's published information.
const GAP_HOW = {
  split: 'by percentage of the hospital bill and the doctors’ bill separately',
  day: 'per hospital day',
  visit: 'per visit',
};

/**
 * Why a plan's maternity is not priced, from its benefits.maternity ({priced: false, reason}):
 * { kind: 'split'|'day'|'visit'|null, text } or null when it is priced. `kind` follows the reviewed reason
 * (pipeline/maternity_terms.json): coinsurance on only the hospital or only the doctors' part, a per-day hospital
 * copay, or per-visit copays. Any other reason (2026 plans: never reviewed) gets kind null.
 */
export function maternityGap(m) {
  if (m?.priced === true) return null;
  const r = String(m?.reason ?? '');
  const kind = /per[- ]day|\$[\d,]+ per day/i.test(r) ? 'day'
    : /visits? is not known|per[- ]visit|per office visit/i.test(r) ? 'visit'
      : /splits/i.test(r) ? 'split' : null;
  if (!kind) {
    return { kind, text: 'Not priced: maternity is priced only for 2027 plans, from their 2027 brochures, so no estimate is added for this plan.' };
  }
  return {
    kind,
    text: `Not priced: this plan’s brochure states its maternity cost ${GAP_HOW[kind]} and gives no way to total it for one pregnancy, `
      + 'so no estimate is added. This is a gap in the plan’s published information, not in this app: see its brochure.',
  };
}

const usdTerm = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/**
 * A priced maternity term ({kind: zero|usd|pct, value, deductible, per}) as a copay entry the engine already prices,
 * with an explicit `deductible` (true / false; null = the plan default) and a plain description.
 */
export function maternityShare(t) {
  const after = t.deductible === true ? ', after the deductible' : '';
  if (t.kind === 'pct') {
    return { kind: 'pct', value: t.value, raw: '', deductible: t.deductible, text: `${t.value}% coinsurance${after}` };
  }
  if (t.kind === 'usd') {
    return { kind: 'usd', value: t.value, raw: '', deductible: t.deductible, text: `${usdTerm(t.value)} per ${t.per}${after}` };
  }
  return { kind: 'text', value: null, raw: 'Member Pays Nothing', deductible: t.deductible, text: `nothing${after}` };
}

const PART_OF = { hospital: 'Hospital', doctors: 'Doctors and other care', all: 'Maternity care' };
const VISITS_TEXT = {
  all: 'per visit', prenatal: 'per prenatal visit', postpartum: 'per postpartum visit',
  postpartum_after_first: 'per postpartum visit after the first', initial: 'for the first visit',
};

/**
 * An estimated maternity term's parts as events to price: [{share, share_ (copay entry), text}], skipping parts that
 * cost nothing and use no deductible. Each part of benefits.maternity.parts states one charge from the brochure:
 *   of: 'hospital' | 'doctors' | 'all' (the share of the line's price it is billed on: split.hospital, the rest, all)
 *   kind: 'zero' | 'pct' (value %, optional cap) | 'usd' (value, once) | 'per_day' (value a day; maxDays, cap)
 *         | 'per_visit' (value a visit; visits: all|prenatal|postpartum|postpartum_after_first|initial; cap)
 *   deductible: true | false
 * The per-day and per-visit counts and the hospital share come from `v` (maternityAssumptionValues).
 */
export function maternityParts(m, v = maternityAssumptionValues()) {
  const out = [];
  for (const p of m.parts ?? []) {
    const share = p.of === 'hospital' ? v.hospitalShare : p.of === 'doctors' ? 1 - v.hospitalShare : 1;
    const after = p.deductible === true ? ', after the deductible' : '';
    const capText = Number.isFinite(p.cap) ? ` (at most ${usdTerm(p.cap)})` : '';
    let c;
    let text;
    if (p.kind === 'pct') {
      c = { kind: 'pct', value: p.value, raw: '', deductible: p.deductible, cap: Number.isFinite(p.cap) ? p.cap : undefined };
      text = `${p.value}% coinsurance${capText}${after}`;
    } else if (p.kind === 'usd') {
      c = { kind: 'usd', value: p.value, raw: '', deductible: p.deductible };
      text = `${usdTerm(p.value)}${after}`;
    } else if (p.kind === 'per_day') {
      const days = Math.min(v.days, Number.isFinite(p.maxDays) ? p.maxDays : Infinity);
      const amount = Math.min(p.value * days, Number.isFinite(p.cap) ? p.cap : Infinity);
      c = { kind: 'usd', value: amount, raw: '', deductible: p.deductible };
      text = `${usdTerm(p.value)} a day${Number.isFinite(p.maxDays) ? ` for up to ${p.maxDays} days` : ''}${capText}${after}`;
    } else if (p.kind === 'per_visit') {
      const n = { all: v.prenatal + v.postpartum, prenatal: v.prenatal, postpartum: v.postpartum,
        postpartum_after_first: Math.max(0, v.postpartum - 1), initial: 1 }[p.visits] ?? 0;
      const amount = Math.min(p.value * n, Number.isFinite(p.cap) ? p.cap : Infinity);
      c = { kind: 'usd', value: amount, raw: '', deductible: p.deductible };
      text = `${usdTerm(p.value)} ${VISITS_TEXT[p.visits] ?? 'per visit'}${capText}${after}`;
    } else {
      c = { kind: 'text', value: null, raw: 'Member Pays Nothing', deductible: p.deductible };
      text = `nothing${after}`;
    }
    const label = `${PART_OF[p.of] ?? PART_OF.all}: ${text}`;
    const free = (c.kind === 'text' || (c.kind === 'usd' && !(c.value > 0))) && p.deductible !== true;
    out.push({ share, share_: c, text: label, free });
  }
  // keep the description of every part, price only the ones that can cost something
  const priced = out.filter((p) => !p.free);
  priced.texts = out.map((p) => p.text);
  return Object.assign(priced, { all: out });
}

/** Parse an OPM drug tier string ("$0 preventive drugs - $0 Copayment", "25% Coinsurance") into a copay entry. */
function parseTierRaw(raw) {
  const t = String(raw ?? '');
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { kind: 'pct', value: Number(pct[1]), raw: t };
  const usdM = t.match(/\$\s?([\d,]+(?:\.\d+)?)\s*Copay/i);
  if (usdM) return { kind: 'usd', value: Number(usdM[1].replace(/,/g, '')), raw: t };
  return { kind: 'text', value: null, raw: t };
}

/**
 * Expand usage into priced events: {service, label, price}.
 * `drugs` entries, either form:
 *   legacy:   {tier, fillsPerYear, price}  priced from the plan's OPM tier copays (benefits.copays rx_tierN)
 *   brochure: {label, fillsPerYear, price, share, deductibleApplies}  priced from the tier terms the caller
 *             looked up (see ui/rx-model.js planMeds); share = {kind: 'usd'|'pct'|'zero'|'full', value?, cap?, floor?}
 * Brochure entries become events tagged with their `drug` index.
 * usage.custom lines (validated by scenarios.js sanitizeLine) become events tagged with their line index,
 * after every scenario event, so the scenario uses the deductible first.
 */
function buildEvents(usage, prices, drugs) {
  const ev = [];
  const add = (n, service, label, price, extra) => {
    for (let i = 0; i < (n || 0); i++) ev.push(extra ? { service, label, price, ...extra } : { service, label, price });
  };
  add(usage.pcpVisits, 'primary_care', 'primary care visit', prices.pcpVisit);
  add(usage.specialistVisits, 'specialist', 'specialist visit', prices.specialistVisit);
  add(usage.labs, 'lab_xray', 'lab/X-ray', prices.lab);
  add(usage.imaging, 'imaging', 'imaging', prices.imaging);
  add(usage.erVisits, 'emergency', 'emergency visit', prices.erVisit);
  add(usage.hospitalStays, 'inpatient_admission', 'inpatient admission', prices.inpatientStay);
  add(usage.hospitalStays, 'inpatient_surgeon', 'inpatient surgeon', prices.surgery);
  add((usage.rxMonthly || 0) * 12, 'rx_tier1', 'generic prescription fill', prices.rxGenericFill);
  (drugs || []).forEach((d, drug) => {
    if (!d || typeof d !== 'object') return;
    if (d.share && typeof d.share === 'object') add(d.fillsPerYear, 'rx_brochure', d.label || 'prescription', d.price, { drug });
    else add(d.fillsPerYear, `rx_tier${d.tier}`, `tier ${d.tier} prescription fill`, d.price);
  });
  (usage.custom || []).forEach((l, line) => {
    const meta = CUSTOM_KINDS[l.kind];
    if (!meta) return;
    let service = KIND_SERVICES[l.kind] ?? null;
    if (meta.rx) service = Number.isInteger(l.tier) ? `rx_tier${l.tier}` : null;
    add(l.perYear, service, l.label || meta.label, l.price, { line, kind: l.kind, oon: l.outOfNetwork === true });
  });
  return ev;
}

const usd0 = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Expected out-of-pocket cost. `benefits` must be RESOLVED (see resolveBenefits).
 * assumptions: {prices?: partial ASSUMED_PRICES overrides}.
 * Returns {deductiblePaid, coinsurancePaid, copays, oonPaid, total, warnings, flat, custom, oonEstimate,
 *          drugs, drugsPaid, drugsDeductible, notCoveredPaid}.
 * Brochure-form drugs (see buildEvents) share the deductible and the OOP max with everything else, follow their
 * tier's deductibleApplies (null = the plan default: HDHPs yes, others no), and are reported apart:
 * `drugs` = [{label, fillsPerYear, cost}], `drugsPaid` = their total (including `drugsDeductible`, the part of the
 * deductible they used, which is also in deductiblePaid). Not-covered drugs ({kind:'full'}) are paid in full and do
 * not count toward the OOP max (`notCoveredPaid`). Their copays/coinsurance are NOT in `copays`/`coinsurancePaid`.
 * `flat` is true when every used service was a fixed copay / $0 (no price sensitivity).
 * `custom`: one entry per usage.custom line with its cost contribution, warnings and notes.
 * A maternity line is priced only from the plan's brochure-reviewed `maternity` term; without one it costs $0 here,
 * is marked `unpriced: true` with a warning, and `unpriced` lists 'maternity' (the total leaves it out).
 * Out-of-network lines are paid in full (OPM lists no out-of-network cost sharing), counted against the plan's
 * out-of-network OOP max when it lists one, and kept apart from the in-network deductible and OOP max.
 */
export function expectedOop(benefits, usage, assumptions = {}, drugs = [], carry = null) {
  const prices = { ...ASSUMED_PRICES, ...(assumptions.prices || {}) };
  const oopMax = benefits.oopMax == null ? Infinity : benefits.oopMax;
  const oonMax = benefits.oon?.oopMax == null ? Infinity : benefits.oon.oopMax;
  // A running family tally (see planTotal): what earlier members already paid this year.
  const famMax = fin(benefits.familyOopMax) ? benefits.familyOopMax : Infinity;
  const famOonMax = fin(benefits.oon?.familyOopMax) ? benefits.oon.familyOopMax : Infinity;
  const dedUsed = carry?.dedUsed || 0, oopUsed = carry?.oopUsed || 0, oonUsed = carry?.oonUsed || 0;
  // embedded plans: each person's own deductible, until the family's deductible spending reaches the family deductible
  const famDed = fin(benefits.familyDeductible) ? benefits.familyDeductible : Infinity;
  const famDedUsed = carry?.famDedUsed || 0;
  let dedLeft = Math.max(0, Math.min((benefits.deductible || 0) - dedUsed, famDed - famDedUsed));
  const defaultDed = benefits.deductibleDefault === true;
  let deductiblePaid = 0, coinsurancePaid = 0, copays = 0, total = 0, oonPaid = 0;
  let drugsPaid = 0, drugsDeductible = 0, notCoveredPaid = 0;
  const drugLines = (drugs || []).map((d) => (d && typeof d === 'object' && d.share && typeof d.share === 'object'
    ? { label: d.label || 'prescription', fillsPerYear: d.fillsPerYear || 0, cost: 0, drugId: d.drugId }
    : null));
  const warnings = [];
  const warned = new Set();
  const services = new Map();
  let flat = true;

  const lines = (usage.custom || []).map((l) => ({
    label: l.label || CUSTOM_KINDS[l.kind]?.label || l.kind,
    kind: l.kind,
    price: l.price,
    perYear: l.perYear,
    tier: l.tier ?? null,
    outOfNetwork: l.outOfNetwork === true,
    spend: cents((l.price || 0) * (l.perYear || 0)),
    cost: 0,
    warnings: [],
    notes: [],
  }));
  const lineWarn = (e, text) => {
    const L = lines[e.line];
    if (!L.warnings.includes(text)) { L.warnings.push(text); warnings.push(text); }
    flat = false;
  };
  const lineNote = (e, text) => {
    const L = lines[e.line];
    if (!L.notes.includes(text)) L.notes.push(text);
  };
  const warnOnce = (e, raw) => {
    if (!warned.has(e.service)) {
      warned.add(e.service);
      warnings.push(`Could not price ${e.label} (${e.service}): "${raw}"`);
    }
    flat = false;
  };

  const take = (amount) => {
    const a = Math.max(0, Math.min(amount, oopMax - total, famMax - oopUsed - total));
    total += a;
    return a;
  };

  // An estimated maternity term (benefits.maternity.parts) splits the line into its stated parts (hospital,
  // doctors, per-day and per-visit charges), each priced like any other event; see maternityParts.
  const matValues = maternityAssumptionValues(assumptions.maternity);
  const matParts = benefits.maternity?.priced === true && Array.isArray(benefits.maternity.parts)
    ? maternityParts(benefits.maternity, matValues) : null;
  const events = buildEvents(usage, prices, drugs).flatMap((e) => (matParts && e.line !== undefined && e.kind === 'maternity' && !e.oon
    ? (matParts.length ? matParts.map((p) => ({ ...e, price: (e.price || 0) * p.share, matPart: p })) : [{ ...e, matPart: 'none' }])
    : [e]));

  for (const e of events) {
    const price = e.price || 0;
    const custom = e.line !== undefined;
    // the scenario's own services (visits, labs, stays, generic fills), one entry per kind: how many, what they bill
    // in all, and (below) what the member pays after the plan's rule, the deductible and the out-of-pocket max
    let svc = null;
    if (!custom && e.drug === undefined) {
      const key = `${e.service}|${e.label}`;
      svc = services.get(key);
      if (!svc) {
        svc = { service: e.service, label: e.label, count: 0, price, spend: 0, cost: 0, rule: benefits.copays?.[e.service]?.raw ?? null };
        services.set(key, svc);
      }
      svc.count += 1;
      svc.spend += price;
    }

    if (e.drug !== undefined) {
      // a medication priced from its brochure tier terms
      flat = false;
      const D = drugs[e.drug];
      const L = drugLines[e.drug];
      const s = D.share;
      if (s.kind === 'full') { // not covered: full price, outside the OOP max
        notCoveredPaid += Math.max(0, price);
        L.cost += Math.max(0, price);
        continue;
      }
      if (total >= oopMax || s.kind === 'zero') continue;
      const applies = D.deductibleApplies === true || (D.deductibleApplies !== false && defaultDed);
      let dedPiece = 0, sharePiece = 0;
      if (s.kind === 'usd' || s.kind === 'pct') {
        dedPiece = applies ? Math.min(dedLeft, price) : 0;
        const rest = price - dedPiece;
        if (s.kind === 'usd') sharePiece = Math.min(Number.isFinite(s.value) ? s.value : 0, rest);
        else {
          sharePiece = rest * ((Number.isFinite(s.value) ? s.value : 0) / 100);
          if (Number.isFinite(s.floor)) sharePiece = Math.max(sharePiece, Math.min(s.floor, rest));
          if (Number.isFinite(s.cap)) sharePiece = Math.min(sharePiece, s.cap);
        }
      }
      const d = take(dedPiece);
      dedLeft -= d;
      deductiblePaid += d;
      drugsDeductible += d;
      const sp = take(Math.max(0, sharePiece));
      drugsPaid += d + sp;
      L.cost += d + sp;
      continue;
    }

    if (custom && e.oon) {
      flat = false;
      const a = Math.max(0, Math.min(price, oonMax - oonPaid, famOonMax - oonUsed - oonPaid));
      oonPaid += a;
      lines[e.line].cost += a;
      lineWarn(e, Number.isFinite(oonMax)
        ? `Out-of-network estimate: ${e.label} counted at full cost (OPM lists no out-of-network cost sharing), up to the plan's ${usd0(oonMax)} out-of-network limit.`
        : `Out-of-network estimate: ${e.label} counted at full cost; this plan lists no out-of-network benefits.`);
      continue;
    }
    const maternity = custom && e.kind === 'maternity';
    if (maternity && benefits.maternity?.priced !== true) {
      // Not priced (no brochure-checked terms): left out of this plan's total, and said so on the line.
      flat = false;
      lines[e.line].unpriced = true;
      lineWarn(e, maternityGap(benefits.maternity).text);
      if (benefits.maternity?.reason) lineNote(e, `Detail: ${benefits.maternity.reason}`);
      continue;
    }
    if (maternity && e.matPart) {
      // Estimated: the brochure's stated parts, with the missing count or share from MATERNITY_ASSUMPTIONS
      flat = false;
      const L = lines[e.line];
      L.estimated = true;
      L.assumed = benefits.maternity.assumed ?? [];
      lineNote(e, estimateText(L.assumed, matValues, benefits.maternity.note ?? ''));
      lineNote(e, `The plan’s stated terms, from its 2027 brochure: ${matParts.all.map((p) => p.text).join('; ')}.`);
      if (e.matPart === 'none') continue; // every part costs nothing
    } else if (maternity) {
      lineNote(e, `Priced with this plan’s maternity terms from its 2027 brochure: you pay ${maternityShare(benefits.maternity).text}.`);
    }
    if (total >= oopMax) continue; // same as the old early break: nothing in-network costs more after the max

    const isRx = custom && CUSTOM_KINDS[e.kind]?.rx === true;
    let c = e.service ? benefits.copays[e.service] : null;
    if (isRx && e.service === 'rx_tier0') {
      // Tier 0 = preventive drugs: never behind the deductible (preventive care is exempt for HDHPs too).
      c = benefits.tier0 ? { ...parseTierRaw(benefits.tier0), raw: `${benefits.tier0} - no deductible` } : null;
    }
    if (maternity) c = e.matPart ? e.matPart.share_ : maternityShare(benefits.maternity);

    let dedPiece = 0, coinsPiece = 0, copayPiece = 0;
    // a term that states its deductible (true / false) wins over the wording rules
    const useDed = (defaultYes) => ((typeof c.deductible === 'boolean' ? c.deductible : appliesDeductible(c.raw, defaultYes))
      ? Math.min(dedLeft, price) : 0);
    // Custom-line fallback: plan coinsurance (or the documented assumption) after the deductible.
    const fallback = (why) => {
      flat = false;
      const listed = benefits.coinsurance;
      const rateNum = Number.isFinite(listed) ? listed : FALLBACK_COINSURANCE;
      dedPiece = Math.min(dedLeft, price);
      coinsPiece = (price - dedPiece) * (rateNum / 100);
      const rateText = Number.isFinite(listed)
        ? `the plan's ${listed}% coinsurance`
        : `an assumed ${FALLBACK_COINSURANCE}% coinsurance (the plan lists none)`;
      if (why) lineWarn(e, `${e.label}: ${why}, so it is priced at ${rateText} after the deductible.`);
      else if (Number.isFinite(listed)) lineNote(e, `Priced at ${rateText} after the deductible.`);
      else lineWarn(e, `${e.label}: priced at ${rateText} after the deductible.`);
    };

    if (isRx && e.service === null) {
      // No tier chosen: the user's price is what they pay (it still counts toward the OOP max).
      flat = false;
      copayPiece = price;
      lineNote(e, 'No drug tier chosen: counted at the full price you entered.');
    } else if (custom && e.kind === 'other') {
      fallback(null);
    } else if (!c) {
      if (!custom) { warnOnce(e, 'missing'); continue; }
      fallback(isRx ? `the plan lists no tier ${e.service.slice(7)} drug benefit` : 'the plan lists no benefit for it');
    } else if (c.kind === 'pct') {
      flat = false;
      const rate = (c.value ?? benefits.coinsurance ?? 0) / 100;
      // Drug tiers silent about the deductible follow the plan default (HDHP: yes, others: no).
      dedPiece = useDed(isRx ? defaultDed : true);
      coinsPiece = (price - dedPiece) * rate;
      // a per-fill cap from the plan brochure (pipeline/benefit_overrides.json), e.g. "20% up to $400"
      if (Number.isFinite(c.cap)) coinsPiece = Math.min(coinsPiece, c.cap);
    } else if (c.kind === 'usd') {
      dedPiece = useDed(defaultDed);
      // Fixed only when the copay alone sets the cost: no deductible consumed, copay below the price.
      if (dedPiece > 0 || (c.value ?? 0) > price) flat = false;
      copayPiece = Math.min(c.value ?? 0, price - dedPiece);
    } else if (c.kind === 'text' && /nothing/i.test(c.raw || '')) {
      dedPiece = useDed(defaultDed);
      if (dedPiece > 0) flat = false;
    } else if (custom) {
      const raw = String(c.raw ?? '').trim();
      fallback(raw ? `the plan's benefit reads "${raw}"`
        : isRx ? `the plan lists no tier ${e.service.slice(7)} drug benefit` : 'the plan’s data has no entry for it');
    } else {
      warnOnce(e, c.raw);
      continue;
    }

    const d = take(dedPiece);
    dedLeft -= d;
    deductiblePaid += d;
    const ci = take(coinsPiece);
    coinsurancePaid += ci;
    const cp = take(copayPiece);
    copays += cp;
    if (custom) lines[e.line].cost += d + ci + cp;
    else if (svc) svc.cost += d + ci + cp;
  }

  for (const L of lines) L.cost = cents(L.cost);
  const drugOut = drugLines.filter(Boolean).map((L) => ({ ...L, cost: cents(L.cost) }));
  return {
    deductiblePaid: cents(deductiblePaid),
    coinsurancePaid: cents(coinsurancePaid),
    copays: cents(copays),
    oonPaid: cents(oonPaid),
    total: cents(total + oonPaid + notCoveredPaid),
    // [{service, label, count, price, spend, cost, rule}] for the scenario's visits, labs, stays and generic fills
    services: [...services.values()].map((s) => ({ ...s, spend: cents(s.spend), cost: cents(s.cost) })),
    drugs: drugOut,
    drugsPaid: cents(drugsPaid + notCoveredPaid),
    drugsDeductible: cents(drugsDeductible),
    notCoveredPaid: cents(notCoveredPaid),
    warnings,
    flat,
    custom: lines,
    oonEstimate: lines.some((L) => L.outOfNetwork && L.perYear > 0),
    // kinds left out of the total because this plan's terms could not be priced (e.g. ['maternity'])
    unpriced: lines.some((L) => L.unpriced) ? ['maternity'] : [],
    // kinds in the total as an estimate (stated terms plus MATERNITY_ASSUMPTIONS), e.g. ['maternity']
    estimated: lines.some((L) => L.estimated) ? ['maternity'] : [],
    // the family's running tally after this person (planTotal passes it to the next member)
    carryOut: { dedUsed: dedUsed + deductiblePaid, oopUsed: oopUsed + total, oonUsed: oonUsed + oonPaid, famDedUsed: famDedUsed + deductiblePaid },
  };
}

/**
 * plan: {rate, benefits (raw, per-enrollment), account?} where `rate` is rates[year][code],
 *       `account` is benefits.account_contribution (HSA/HRA deposit by enrollment).
 *       `accountType` ('HSA' | 'HRA') or benefits.account_type ("Health Reimbursement Arrangement") marks an HRA.
 * inputs: {status, enrollment, usage, assumptions?, drugs?, hsaDeposit?}
 * HSA deposit is cash the member keeps: fully subtracted. HRA credit is usable only against
 * actual costs: offset is capped at expected OOP, so total never falls below premium.
 */
function isHra(plan) {
  const t = plan.accountType ?? plan.benefits?.account_type ?? '';
  return /^hra$|reimbursement/i.test(String(t));
}

const sumC = (list, f) => cents(list.reduce((a, x) => a + f(x), 0));

/** Merge per-member services by service|label: counts, billed totals and costs add up. */
function mergeServices(lists) {
  const m = new Map();
  for (const s of lists.flat()) {
    const k = `${s.service}|${s.label}`;
    const t = m.get(k);
    if (!t) m.set(k, { ...s });
    else { t.count += s.count; t.spend = cents(t.spend + s.spend); t.cost = cents(t.cost + s.cost); }
  }
  return [...m.values()];
}

export function planTotal(plan, inputs) {
  const members = Array.isArray(inputs.members) ? inputs.members : null;
  if (members && members.length >= 2) return familyTotal(plan, inputs, members);
  if (members && members.length === 1) {
    inputs = { ...inputs, usage: members[0].usage ?? inputs.usage, drugs: members[0].drugs ?? inputs.drugs };
  }
  const { status, enrollment, usage, assumptions = {}, drugs = [] } = inputs;
  const premium = annualPremium(plan.rate, { status, enrollment });
  const resolved = resolveBenefits(plan.benefits, enrollment);
  // One covered person's care: per-person limits (see personLimits); the premium follows the enrollment.
  const person = personLimits(plan.benefits, enrollment);
  const o = expectedOop({ ...resolved, deductible: person.deductible, oopMax: person.oopMax, oon: person.oon }, usage, assumptions, drugs);
  const deposit = inputs.hsaDeposit ?? plan.account?.[enrollment] ?? 0;
  const hra = isHra(plan);
  const cap = Math.max(0, deposit || 0);
  const hsaOffset = hra ? cents(Math.min(cap, o.total)) : cap;
  const firmness = o.warnings.length === 0 && o.flat ? 'fixed' : 'estimated';
  return {
    premium,
    oop: o.total,
    hsaOffset,
    total: cents(premium + o.total - hsaOffset),
    breakdown: {
      deductiblePaid: o.deductiblePaid,
      coinsurancePaid: o.coinsurancePaid,
      copays: o.copays,
      // the limits applied to the one person's care, and the plan's limits for the whole enrollment
      deductible: person.deductible,
      oopMax: person.oopMax,
      enrollmentDeductible: resolved.deductible,
      enrollmentOopMax: resolved.oopMax,
      deductibleType: person.type,
      onePerson: enrollment !== 'self',
      accountType: hra ? 'HRA' : 'HSA',
      oonPaid: o.oonPaid,
      oonEstimate: o.oonEstimate,
      services: o.services,
      drugs: o.drugs,
      drugsPaid: o.drugsPaid,
      drugsDeductible: o.drugsDeductible,
      notCoveredPaid: o.notCoveredPaid,
      custom: o.custom,
      unpriced: o.unpriced,
      estimated: o.estimated,
      warnings: o.warnings,
    },
    firmness,
  };
}

/**
 * Two or more covered people, costed one at a time with a running family tally (each member's `carryOut` goes to the
 * next). Embedded plans: every member has the self-only deductible until the family's combined deductible spending
 * reaches the enrollment's (family) deductible, then no one pays more deductible (the `famDedUsed` tally); the family's
 * out-of-pocket max caps the sum. Aggregate / unknown HDHPs: one shared deductible, carried.
 * No family out-of-pocket max (or out-of-network max) in the data: no family cap, each person still capped alone;
 * for the in-network max that is flagged `breakdown.familyFallback`.
 */
function familyTotal(plan, inputs, members) {
  const { status, enrollment, assumptions = {} } = inputs;
  const premium = annualPremium(plan.rate, { status, enrollment });
  const resolved = resolveBenefits(plan.benefits, enrollment);
  const person = personLimits(plan.benefits, enrollment);
  const familyOopMax = fin(resolved.oopMax) ? resolved.oopMax : null;
  const b = {
    ...resolved, deductible: person.deductible, oopMax: person.oopMax, familyOopMax,
    oon: { ...person.oon, familyOopMax: fin(resolved.oon?.oopMax) ? resolved.oon.oopMax : null },
  };
  const embedded = person.type === 'embedded';
  // embedded: the enrollment's (family) deductible caps what everyone spends on their own deductibles together
  const familyDeductible = embedded && fin(resolved.deductible) ? resolved.deductible : null;
  if (familyDeductible !== null) b.familyDeductible = familyDeductible;
  let carry = { dedUsed: 0, oopUsed: 0, oonUsed: 0, famDedUsed: 0 };
  const rows = [];
  let flat = true;
  for (const m of members) {
    const o = expectedOop(b, m.usage ?? {}, assumptions, m.drugs ?? [], { ...carry, dedUsed: embedded ? 0 : carry.dedUsed });
    carry = o.carryOut;
    if (!o.flat) flat = false;
    rows.push({
      oop: o.total, deductiblePaid: o.deductiblePaid, coinsurancePaid: o.coinsurancePaid, copays: o.copays,
      oonPaid: o.oonPaid, services: o.services, drugs: o.drugs, drugsPaid: o.drugsPaid, drugsDeductible: o.drugsDeductible,
      notCoveredPaid: o.notCoveredPaid, custom: o.custom, unpriced: o.unpriced, estimated: o.estimated, warnings: o.warnings,
      oonEstimate: o.oonEstimate,
    });
  }
  const oop = sumC(rows, (r) => r.oop);
  const deposit = inputs.hsaDeposit ?? plan.account?.[enrollment] ?? 0;
  const hra = isHra(plan);
  const cap = Math.max(0, deposit || 0);
  const hsaOffset = hra ? cents(Math.min(cap, oop)) : cap;
  const warnings = [...new Set(rows.flatMap((r) => r.warnings))];
  const union = (k) => [...new Set(rows.flatMap((r) => r[k]))];
  return {
    premium,
    oop,
    hsaOffset,
    total: cents(premium + oop - hsaOffset),
    breakdown: {
      deductiblePaid: sumC(rows, (r) => r.deductiblePaid),
      coinsurancePaid: sumC(rows, (r) => r.coinsurancePaid),
      copays: sumC(rows, (r) => r.copays),
      deductible: person.deductible,
      oopMax: person.oopMax,
      enrollmentDeductible: resolved.deductible,
      enrollmentOopMax: resolved.oopMax,
      deductibleType: person.type,
      onePerson: false,
      memberCount: members.length,
      familyOopMax,
      // embedded plans: the family deductible that caps everyone's deductible spending together (null otherwise)
      familyDeductible,
      familyFallback: familyOopMax === null,
      accountType: hra ? 'HRA' : 'HSA',
      oonPaid: sumC(rows, (r) => r.oonPaid),
      oonEstimate: rows.some((r) => r.oonEstimate),
      services: mergeServices(rows.map((r) => r.services)),
      drugs: rows.flatMap((r) => r.drugs),
      drugsPaid: sumC(rows, (r) => r.drugsPaid),
      drugsDeductible: sumC(rows, (r) => r.drugsDeductible),
      notCoveredPaid: sumC(rows, (r) => r.notCoveredPaid),
      custom: rows.flatMap((r) => r.custom),
      unpriced: union('unpriced'),
      estimated: union('estimated'),
      warnings,
      members: rows.map(({ oonEstimate, ...r }) => r),
    },
    firmness: warnings.length === 0 && flat ? 'fixed' : 'estimated',
  };
}
