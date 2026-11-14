import { ASSUMED_PRICES, FALLBACK_COINSURANCE } from './assumptions.js';
import { CUSTOM_KINDS } from './scenarios.js';

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
  };
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * How a plan's Self Plus One / Self and Family deductible works for one person (OPM data never says, and no
 * 2027 benefits or brochure-fact text uses "embedded" or "aggregate"; see About > How it works):
 *   'embedded'  every plan that is not an HDHP: each person has the self-only deductible and OOP max inside the family ones;
 *   'aggregate' an HSA HDHP whose family deductible is exactly twice the self-only one (the IRS family minimum
 *               rules this out as an embedded per-person amount): one person must meet the whole family deductible;
 *   'unknown'   any other HDHP (e.g. an HDHP with an HRA): modeled like 'aggregate', the cautious choice.
 */
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
 * use the enrollment's deductible, with the out-of-pocket max capped at the self-only one (ACA embedded OOP rule).
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
};

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
 * Out-of-network lines are paid in full (OPM lists no out-of-network cost sharing), counted against the plan's
 * out-of-network OOP max when it lists one, and kept apart from the in-network deductible and OOP max.
 */
export function expectedOop(benefits, usage, assumptions = {}, drugs = []) {
  const prices = { ...ASSUMED_PRICES, ...(assumptions.prices || {}) };
  const oopMax = benefits.oopMax == null ? Infinity : benefits.oopMax;
  const oonMax = benefits.oon?.oopMax == null ? Infinity : benefits.oon.oopMax;
  let dedLeft = benefits.deductible || 0;
  const defaultDed = benefits.deductibleDefault === true;
  let deductiblePaid = 0, coinsurancePaid = 0, copays = 0, total = 0, oonPaid = 0;
  let drugsPaid = 0, drugsDeductible = 0, notCoveredPaid = 0;
  const drugLines = (drugs || []).map((d) => (d && typeof d === 'object' && d.share && typeof d.share === 'object'
    ? { label: d.label || 'prescription', fillsPerYear: d.fillsPerYear || 0, cost: 0, drugId: d.drugId }
    : null));
  const warnings = [];
  const warned = new Set();
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
    const a = Math.max(0, Math.min(amount, oopMax - total));
    total += a;
    return a;
  };

  for (const e of buildEvents(usage, prices, drugs)) {
    const price = e.price || 0;
    const custom = e.line !== undefined;

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
      const a = Math.max(0, Math.min(price, oonMax - oonPaid));
      oonPaid += a;
      lines[e.line].cost += a;
      lineWarn(e, Number.isFinite(oonMax)
        ? `Out-of-network estimate: ${e.label} counted at full cost (OPM lists no out-of-network cost sharing), up to the plan's ${usd0(oonMax)} out-of-network limit.`
        : `Out-of-network estimate: ${e.label} counted at full cost; this plan lists no out-of-network benefits.`);
      continue;
    }
    if (total >= oopMax) continue; // same as the old early break: nothing in-network costs more after the max

    const isRx = custom && CUSTOM_KINDS[e.kind]?.rx === true;
    let c = e.service ? benefits.copays[e.service] : null;
    if (isRx && e.service === 'rx_tier0') {
      // Tier 0 = preventive drugs: never behind the deductible (preventive care is exempt for HDHPs too).
      c = benefits.tier0 ? { ...parseTierRaw(benefits.tier0), raw: `${benefits.tier0} - no deductible` } : null;
    }

    let dedPiece = 0, coinsPiece = 0, copayPiece = 0;
    const useDed = (defaultYes) => (appliesDeductible(c.raw, defaultYes) ? Math.min(dedLeft, price) : 0);
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
  }

  for (const L of lines) L.cost = cents(L.cost);
  const drugOut = drugLines.filter(Boolean).map((L) => ({ ...L, cost: cents(L.cost) }));
  return {
    deductiblePaid: cents(deductiblePaid),
    coinsurancePaid: cents(coinsurancePaid),
    copays: cents(copays),
    oonPaid: cents(oonPaid),
    total: cents(total + oonPaid + notCoveredPaid),
    drugs: drugOut,
    drugsPaid: cents(drugsPaid + notCoveredPaid),
    drugsDeductible: cents(drugsDeductible),
    notCoveredPaid: cents(notCoveredPaid),
    warnings,
    flat,
    custom: lines,
    oonEstimate: lines.some((L) => L.outOfNetwork && L.perYear > 0),
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

export function planTotal(plan, inputs) {
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
      drugs: o.drugs,
      drugsPaid: o.drugsPaid,
      drugsDeductible: o.drugsDeductible,
      notCoveredPaid: o.notCoveredPaid,
      custom: o.custom,
      warnings: o.warnings,
    },
    firmness,
  };
}
