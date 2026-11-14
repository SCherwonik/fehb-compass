import test from 'node:test';
import assert from 'node:assert/strict';
import { annualPremium, resolveBenefits, expectedOop, planTotal } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';
import { ASSUMED_PRICES } from '../../src/engine/assumptions.js';

const usd = (v, raw = `$${v} Copayment`) => ({ value: v, kind: 'usd', raw });
const pct = (v, raw = `${v}% Coinsurance - Deductible applies.`) => ({ value: v, kind: 'pct', raw });
const nothing = { value: null, kind: 'text', raw: 'Member Pays Nothing' };
const NO_USAGE = { pcpVisits: 0, specialistVisits: 0, erVisits: 0, hospitalStays: 0, labs: 0, imaging: 0, rxMonthly: 0 };

const coinsPlan = {
  deductible: 1000, oopMax: 6000, coinsurance: 20,
  copays: {
    primary_care: pct(20), specialist: pct(20), emergency: pct(20),
    inpatient_admission: pct(20), inpatient_surgeon: pct(20),
    lab_xray: pct(20), imaging: pct(20), rx_tier1: usd(10),
  },
};
const copayPlan = {
  deductible: 0, oopMax: 5000, coinsurance: null,
  copays: {
    primary_care: usd(20), specialist: usd(40), emergency: usd(150),
    inpatient_admission: usd(300), inpatient_surgeon: nothing,
    lab_xray: usd(10), imaging: usd(50), rx_tier1: usd(10),
  },
};

test('annualPremium: active biweekly x26, retiree monthly x12', () => {
  const rate = { self: { biweekly_active: 200, monthly_retiree: 400 }, family: { biweekly_active: 500.5, monthly_retiree: 1000 } };
  assert.equal(annualPremium(rate, { status: 'active', enrollment: 'self' }), 5200);
  assert.equal(annualPremium(rate, { status: 'retiree', enrollment: 'self' }), 4800);
  assert.equal(annualPremium(rate, { status: 'active', enrollment: 'family' }), 13013);
});

test('resolveBenefits picks enrollment-specific scalars', () => {
  const b = {
    deductible: { self: 500, self_plus_one: 1000, family: 1500 },
    oop_max: { self: 7000, self_plus_one: 14000, family: 21000 },
    coinsurance: 15, copays: { primary_care: usd(30) },
  };
  const r = resolveBenefits(b, 'self_plus_one');
  assert.equal(r.deductible, 1000);
  assert.equal(r.oopMax, 14000);
  assert.equal(r.coinsurance, 15);
  assert.equal(r.copays.primary_care.value, 30);
});

test('zero usage: oop is zero', () => {
  const r = expectedOop(coinsPlan, NO_USAGE, {});
  assert.equal(r.total, 0);
  assert.equal(r.deductiblePaid, 0);
});

test('coinsurance: deductible applied before coinsurance', () => {
  const r = expectedOop(coinsPlan, { ...NO_USAGE, pcpVisits: 1 }, { prices: { pcpVisit: 1500 } });
  assert.equal(r.deductiblePaid, 1000);
  assert.equal(r.coinsurancePaid, 100);
  assert.equal(r.total, 1100);
});

test('coinsurance below deductible: pays full allowed amount', () => {
  const r = expectedOop(coinsPlan, { ...NO_USAGE, pcpVisits: 1 }, { prices: { pcpVisit: 400 } });
  assert.equal(r.deductiblePaid, 400);
  assert.equal(r.coinsurancePaid, 0);
  assert.equal(r.total, 400);
});

test('$50,000 hospital spend clips at OOP max exactly', () => {
  const r = expectedOop(coinsPlan, { ...NO_USAGE, hospitalStays: 1 }, { prices: { inpatientStay: 50000, surgery: 0 } });
  assert.equal(r.total, 6000);
  assert.equal(r.deductiblePaid + r.coinsurancePaid + r.copays, 6000);
});

test('flat copay: no deductible effect, counts toward oop max', () => {
  const plan = { ...coinsPlan, copays: { ...coinsPlan.copays, primary_care: usd(30, '$30 Copayment - No deductible.') } };
  const r = expectedOop(plan, { ...NO_USAGE, pcpVisits: 3 }, {});
  assert.equal(r.copays, 90);
  assert.equal(r.deductiblePaid, 0);
  const capped = expectedOop({ ...plan, oopMax: 50 }, { ...NO_USAGE, pcpVisits: 3 }, {});
  assert.equal(capped.total, 50);
});

test('pct copay with "No deductible" skips deductible', () => {
  const plan = { ...coinsPlan, copays: { ...coinsPlan.copays, primary_care: pct(10, '10% Coinsurance - No deductible.') } };
  const r = expectedOop(plan, { ...NO_USAGE, pcpVisits: 1 }, { prices: { pcpVisit: 200 } });
  assert.equal(r.coinsurancePaid, 20);
  assert.equal(r.deductiblePaid, 0);
});

test('unparseable text copay: warning, firmness estimated; "Nothing" is $0', () => {
  const plan = { ...copayPlan, copays: { ...copayPlan.copays, specialist: { value: null, kind: 'text', raw: 'Member Pays All Charges - N/A' } } };
  const rate = { self: { biweekly_active: 100, monthly_retiree: 250 } };
  const r = planTotal({ rate, benefits: plan }, { status: 'active', enrollment: 'self', usage: { ...NO_USAGE, specialistVisits: 2 } });
  assert.equal(r.firmness, 'estimated');
  assert.equal(r.breakdown.warnings.length, 1);
  assert.match(r.breakdown.warnings[0], /specialist/);
  const ok = expectedOop({ ...copayPlan, copays: { ...copayPlan.copays, specialist: nothing } }, { ...NO_USAGE, specialistVisits: 2 }, {});
  assert.equal(ok.total, 0);
});

test('zero usage: total = premium minus deposit', () => {
  const rate = { self: { biweekly_active: 100, monthly_retiree: 250 } };
  const r = planTotal({ rate, benefits: coinsPlan }, { status: 'active', enrollment: 'self', usage: NO_USAGE, hsaDeposit: 800 });
  assert.equal(r.premium, 2600);
  assert.equal(r.oop, 0);
  assert.equal(r.hsaOffset, 800);
  assert.equal(r.total, 1800);
});

test('deposit comes from plan.account when not overridden', () => {
  const rate = { self: { biweekly_active: 100, monthly_retiree: 250 } };
  const plan = { rate, benefits: coinsPlan, account: { self: 750, self_plus_one: 1500, family: 1500 } };
  const r = planTotal(plan, { status: 'retiree', enrollment: 'self', usage: NO_USAGE });
  assert.equal(r.premium, 3000);
  assert.equal(r.hsaOffset, 750);
  assert.equal(r.total, 2250);
});

test('copay-only plan is "fixed", coinsurance plan with usage is "estimated"', () => {
  const rate = { self: { biweekly_active: 100, monthly_retiree: 250 } };
  const inputs = { status: 'active', enrollment: 'self', usage: SCENARIOS.typical };
  const fixed = planTotal({ rate, benefits: copayPlan }, inputs);
  assert.equal(fixed.firmness, 'fixed');
  assert.equal(fixed.breakdown.warnings.length, 0);
  assert.equal(planTotal({ rate, benefits: coinsPlan }, inputs).firmness, 'estimated');
});

test('drugs param: default [] does not change behavior; drugs add tier cost', () => {
  const base = expectedOop(copayPlan, SCENARIOS.typical, {});
  assert.deepEqual(expectedOop(copayPlan, SCENARIOS.typical, {}, []), base);
  const withDrug = expectedOop({ ...copayPlan, copays: { ...copayPlan.copays, rx_tier2: usd(45) } }, NO_USAGE, {}, [{ tier: 2, fillsPerYear: 12, price: 100 }]);
  assert.equal(withDrug.total, 540);
});

test('never negative; null oopMax means unlimited', () => {
  const r = expectedOop({ ...coinsPlan, oopMax: null }, { ...NO_USAGE, hospitalStays: 1 }, { prices: { inpatientStay: 50000, surgery: 0 } });
  assert.equal(r.total, 1000 + 0.2 * 49000);
  assert.ok(r.total >= 0);
});

test('SCENARIOS and ASSUMED_PRICES shape', () => {
  for (const k of ['healthy', 'typical', 'condition', 'worst']) {
    for (const f of ['pcpVisits', 'specialistVisits', 'erVisits', 'hospitalStays', 'labs', 'imaging', 'rxMonthly'])
      assert.equal(typeof SCENARIOS[k][f], 'number', `${k}.${f}`);
  }
  assert.ok(SCENARIOS.worst.hospitalStays >= 2 && SCENARIOS.worst.erVisits >= 1);
  for (const k of ['pcpVisit', 'specialistVisit', 'erVisit', 'inpatientStay', 'lab', 'imaging', 'surgery', 'rxGenericFill'])
    assert.ok(ASSUMED_PRICES[k] > 0, k);
});
