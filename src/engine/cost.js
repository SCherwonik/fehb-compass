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
  };
}

const NO_DED = /no deductible|deductible does not apply|\(deductible does not apply\)/i;
const DED = /deductible applies|after (the )?deductible/i;

function appliesDeductible(raw, defaultYes) {
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
      const d = Math.min(dedLeft, price);
      return d;
    };

    if (c.kind === 'pct') {
      flat = false;
      const rate = (c.value ?? benefits.coinsurance ?? 0) / 100;
      dedPiece = useDed(true);
      coinsPiece = (price - dedPiece) * rate;
    } else if (c.kind === 'usd') {
      dedPiece = DED.test(c.raw || '') && !NO_DED.test(c.raw || '') ? Math.min(dedLeft, price) : 0;
      if (dedPiece > 0) flat = false;
      copayPiece = Math.min(c.value ?? 0, price - dedPiece);
    } else if (c.kind === 'text' && /nothing/i.test(c.raw || '')) {
      dedPiece = useDed(false);
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
 * inputs: {status, enrollment, usage, assumptions?, drugs?, hsaDeposit?}
 */
export function planTotal(plan, inputs) {
  const { status, enrollment, usage, assumptions = {}, drugs = [] } = inputs;
  const premium = annualPremium(plan.rate, { status, enrollment });
  const resolved = resolveBenefits(plan.benefits, enrollment);
  const o = expectedOop(resolved, usage, assumptions, drugs);
  const deposit = inputs.hsaDeposit ?? plan.account?.[enrollment] ?? 0;
  const hsaOffset = Math.max(0, deposit || 0);
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
      warnings: o.warnings,
    },
    firmness,
  };
}
