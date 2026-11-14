// Year-over-year plan diff. Plans are joined across years by enrollment `code` (stable across years).
import { annualPremium, resolveBenefits } from './cost.js';

const cents = (n) => Math.round(n * 100) / 100;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const delta = (a, b) => {
  const x = num(a), y = num(b);
  return x === null || y === null ? null : cents(y - x);
};

/** Threshold for the "big premium jump" flag, in percent. */
export const PREMIUM_JUMP_PCT = 10;

/** Short, plain-language text for each flag (UI chips). */
export const FLAG_TEXT = {
  oop_up_no_premium_cut: 'Out-of-pocket max rose with no premium cut',
  deductible_up: 'Deductible went up',
  coinsurance_up: 'Coinsurance went up',
  premium_up_10: `Premium up ${PREMIUM_JUMP_PCT}% or more`,
};

/**
 * Comparable scalars for one plan-year: {premium, deductible, oopMax, coinsurance}.
 * plan = {rate, benefits} (rates[year][code], raw benefits[year][code]); null when either is missing.
 */
export function planFacts(plan, { status, enrollment }) {
  if (!plan || !plan.rate || !plan.benefits || !plan.rate[enrollment]) return null;
  const r = resolveBenefits(plan.benefits, enrollment);
  return {
    premium: annualPremium(plan.rate, { status, enrollment }),
    deductible: num(r.deductible),
    oopMax: num(r.oopMax),
    coinsurance: num(r.coinsurance),
  };
}

/**
 * diffPlan(facts2026, facts2027) where each side is planFacts(...) output or null/undefined.
 * -> {premiumChange, premiumPct, deductibleChange, oopMaxChange, coinsuranceChange, flags, status}
 * status: 'same' (offered both years), 'new' (2027 only), 'ended' (2026 only).
 * Deltas are 2027 minus 2026; null when a side or a scalar is missing (never NaN).
 */
export function diffPlan(plan2026, plan2027) {
  const a = plan2026 ?? null;
  const b = plan2027 ?? null;
  const empty = { premiumChange: null, premiumPct: null, deductibleChange: null, oopMaxChange: null, coinsuranceChange: null, flags: [] };
  if (!a && !b) return { ...empty, status: 'ended' };
  if (!a) return { ...empty, status: 'new' };
  if (!b) return { ...empty, status: 'ended' };

  const premiumChange = delta(a.premium, b.premium);
  const base = num(a.premium);
  const premiumPct = premiumChange === null || !base ? null : Math.round((premiumChange / base) * 1000) / 10;
  const deductibleChange = delta(a.deductible, b.deductible);
  const oopMaxChange = delta(a.oopMax, b.oopMax);
  const coinsuranceChange = delta(a.coinsurance, b.coinsurance);

  const flags = [];
  if (oopMaxChange > 0 && premiumChange !== null && premiumChange >= 0) flags.push('oop_up_no_premium_cut');
  if (deductibleChange > 0) flags.push('deductible_up');
  if (coinsuranceChange > 0) flags.push('coinsurance_up');
  if (premiumPct !== null && premiumPct >= PREMIUM_JUMP_PCT) flags.push('premium_up_10');

  return { premiumChange, premiumPct, deductibleChange, oopMaxChange, coinsuranceChange, flags, status: 'same' };
}
