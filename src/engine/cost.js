import { ASSUMED_PRICES } from './assumptions.js';

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
  };
}

// Phrase classes found in every 2027 copay `raw` string (see tests/engine/deductible.test.js).
const NO_DED = /no deductible|deductible does not apply/i;
const DED = new RegExp([
  'deductible applies',
  'deductible may or may not apply', // ambiguous: assume it applies (conservative, and marks the total estimated)
  'after\\b[^.;]{0,40}?deductible', // after deductible / after the / after plan / after in-network / after $X facility
  'calendar year deductible', // HDHP lines: "$0 Copayment - $1,750/$3,500 Calendar Year Deductible"
  'annual [a-z ]{0,20}deductible', // "$X annual hospital deductible ... then 20% coinsurance"
  'plus deductible',
  'subject to (?:the )?deductible',
].join('|'), 'i');

/** Does this copay line sit behind the deductible? Explicit "no deductible" wins; silence -> defaultYes. */
export function appliesDeductible(raw, defaultYes) {
  const t = raw || '';
  if (NO_DED.test(t)) return false;
  if (DED.test(t)) return true;
  return defaultYes;
}

/**
 * Expand usage into priced events: {service, label, price}.
 * `drugs` entries: {tier, fillsPerYear, price}.
 */
function buildEvents(usage, prices, drugs) {
  const ev = [];
  const add = (n, service, label, price) => {
    for (let i = 0; i < (n || 0); i++) ev.push({ service, label, price });
  };
  add(usage.pcpVisits, 'primary_care', 'primary care visit', prices.pcpVisit);
  add(usage.specialistVisits, 'specialist', 'specialist visit', prices.specialistVisit);
  add(usage.labs, 'lab_xray', 'lab/X-ray', prices.lab);
  add(usage.imaging, 'imaging', 'imaging', prices.imaging);
  add(usage.erVisits, 'emergency', 'emergency visit', prices.erVisit);
  add(usage.hospitalStays, 'inpatient_admission', 'inpatient admission', prices.inpatientStay);
  add(usage.hospitalStays, 'inpatient_surgeon', 'inpatient surgeon', prices.surgery);
  add((usage.rxMonthly || 0) * 12, 'rx_tier1', 'generic prescription fill', prices.rxGenericFill);
  for (const d of drugs || []) {
    add(d.fillsPerYear, `rx_tier${d.tier}`, `tier ${d.tier} prescription fill`, d.price);
  }
  return ev;
}

/**
 * Expected out-of-pocket cost. `benefits` must be RESOLVED (see resolveBenefits).
 * assumptions: {prices?: partial ASSUMED_PRICES overrides}.
 * Returns {deductiblePaid, coinsurancePaid, copays, total, warnings, unpriced, flat}.
 * `flat` is true when every used service was a fixed copay / $0 (no price sensitivity).
 */
export function expectedOop(benefits, usage, assumptions = {}, drugs = []) {
  const prices = { ...ASSUMED_PRICES, ...(assumptions.prices || {}) };
  const oopMax = benefits.oopMax == null ? Infinity : benefits.oopMax;
  let dedLeft = benefits.deductible || 0;
  const defaultDed = benefits.deductibleDefault === true;
  let deductiblePaid = 0, coinsurancePaid = 0, copays = 0, total = 0;
  const warnings = [];
  const warned = new Set();
  let flat = true;

  const take = (amount) => {
    const a = Math.max(0, Math.min(amount, oopMax - total));
    total += a;
    return a;
  };

  for (const e of buildEvents(usage, prices, drugs)) {
    if (total >= oopMax) break;
    const c = benefits.copays[e.service];
    const price = e.price || 0;
    let dedPiece = 0, coinsPiece = 0, copayPiece = 0;
    const warn = () => {
      if (!warned.has(e.service)) {
        warned.add(e.service);
        warnings.push(`Could not price ${e.label} (${e.service}): "${c ? c.raw : 'missing'}"`);
      }
      flat = false;
    };

    if (!c) { warn(); continue; }
    const useDed = (defaultYes) => {
      if (!appliesDeductible(c.raw, defaultYes)) return 0;
      return Math.min(dedLeft, price);
    };

    if (c.kind === 'pct') {
      flat = false;
      const rate = (c.value ?? benefits.coinsurance ?? 0) / 100;
      dedPiece = useDed(true);
      coinsPiece = (price - dedPiece) * rate;
    } else if (c.kind === 'usd') {
      dedPiece = useDed(defaultDed);
      // Fixed only when the copay alone sets the cost: no deductible consumed, copay below the price.
      if (dedPiece > 0 || (c.value ?? 0) > price) flat = false;
      copayPiece = Math.min(c.value ?? 0, price - dedPiece);
    } else if (c.kind === 'text' && /nothing/i.test(c.raw || '')) {
      dedPiece = useDed(defaultDed);
      if (dedPiece > 0) flat = false;
    } else {
      warn();
      continue;
    }

    const d = take(dedPiece);
    dedLeft -= d;
    deductiblePaid += d;
    coinsurancePaid += take(coinsPiece);
    copays += take(copayPiece);
  }

  return {
    deductiblePaid: cents(deductiblePaid),
    coinsurancePaid: cents(coinsurancePaid),
    copays: cents(copays),
    total: cents(total),
    warnings,
    flat,
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
  const o = expectedOop(resolved, usage, assumptions, drugs);
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
      deductible: resolved.deductible,
      oopMax: resolved.oopMax,
      accountType: hra ? 'HRA' : 'HSA',
      warnings: o.warnings,
    },
    firmness,
  };
}
