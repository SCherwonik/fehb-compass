// Deductible detection from OPM copay text. Every raw string below is copied from data/benefits.json (2027).
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { appliesDeductible, expectedOop, resolveBenefits, planTotal } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';

// ---------- classification of every phrase class found in the 2027 data ----------
const APPLIES = [
  '$0 Copayment - $1,750/$3,500 Calendar Year Deductible', // HDHP: "Calendar Year Deductible"
  '15% Coinsurance - $1,500 Calendar Year Deductible',
  '$35 Copayment - Copays range from $0-$75 depending on the service. Please see the FEHBP CareFirst BlueChoice Brochure for additional details. $1,750/$3,500 Calendar Year Deductible',
  '20% Coinsurance - after plan deductible is met.', // "after plan deductible"
  'Member Pays Nothing - after plan deductible is met.',
  '25% Coinsurance - After in-network deductible, then coinsurance', // "after in-network deductible"
  '20% Coinsurance - after $500/$1,000 facility deductible', // "after $X facility deductible"
  '20% Coinsurance - $500 annual hospital deductible for inpatient & outpatient combined, then 20% coinsurance',
  '$25 Copayment - 30% of the Plan allowance, plus deductible, for the 11th and subsequent visits.',
  '$30 Copayment - after the deductible', // classic phrasings still work
  '20% Coinsurance - after deductible',
  '15% Coinsurance - Deductible applies.',
  '30% - of the Plan allowance (deductible applies)',
  '$30 Copayment - Deductible may or may not apply; coinsurance applies to eligible charge', // ambiguous: assume it applies
  'Subject to deductible',
];
const NO_DEDUCTIBLE = [
  '$30 Copayment - No deductible.',
  '$450 Copayment - Per admission, no deductible, precertification required.',
  '$20 Copayment - Deductible does not apply',
  '15% Coinsurance - No deductible',
  'Member Pays Nothing - No deductible.',
];
const SILENT = ['$30 Copayment', 'Generic - $0 Copayment', '$350 Copayment - Waived if Admitted', '$20 Copayment - per visit'];

test('copay text that means "deductible applies" is recognized', () => {
  for (const raw of APPLIES) assert.equal(appliesDeductible(raw, false), true, raw);
});

test('copay text that means "no deductible" is recognized, even when the default is yes', () => {
  for (const raw of NO_DEDUCTIBLE) assert.equal(appliesDeductible(raw, true), false, raw);
});

test('silent copay text falls back to the default', () => {
  for (const raw of SILENT) {
    assert.equal(appliesDeductible(raw, false), false, raw);
    assert.equal(appliesDeductible(raw, true), true, raw);
  }
});

// ---------- HDHP: deductible consumed first, then the copay ----------
const usd = (value, raw) => ({ value, kind: 'usd', raw });
const NONE = { pcpVisits: 0, specialistVisits: 0, erVisits: 0, hospitalStays: 0, labs: 0, imaging: 0, rxMonthly: 0 };

test('HDHP "$0 Copayment - $X Calendar Year Deductible": usage pays the deductible, then $0', () => {
  const plan = {
    deductible: 1750, oopMax: 7500, coinsurance: 20,
    copays: { primary_care: usd(0, '$0 Copayment - $1,750/$3,500 Calendar Year Deductible') },
  };
  // 3 PCP visits at the assumed $150: all three go to the deductible.
  const o = expectedOop(plan, { ...NONE, pcpVisits: 3 });
  assert.equal(o.deductiblePaid, 450);
  assert.equal(o.copays, 0);
  assert.equal(o.total, 450);
  assert.equal(o.flat, false);
  // Once the deductible is met, the $0 copay applies.
  const met = expectedOop({ ...plan, deductible: 200 }, { ...NONE, pcpVisits: 3 });
  assert.equal(met.deductiblePaid, 200);
  assert.equal(met.total, 200);
});

test('HSA-qualified plans apply the deductible to silent copays; explicit "No deductible" still wins', () => {
  const benefits = {
    deductible: { self: 2000 }, oop_max: { self: 7000 }, coinsurance: null, account_type: 'Health Savings Account',
    copays: { primary_care: usd(30, '$30 Copayment'), specialist: usd(50, '$50 Copayment - No deductible') },
  };
  const r = resolveBenefits(benefits, 'self');
  assert.equal(r.deductibleDefault, true);
  const o = expectedOop(r, { ...NONE, pcpVisits: 1, specialistVisits: 1 });
  assert.equal(o.deductiblePaid, 150); // PCP visit goes to the deductible
  assert.equal(o.copays, 50); // specialist copay, no deductible
  assert.equal(o.flat, false);
  const plain = resolveBenefits({ ...benefits, account_type: 'Not Applicable' }, 'self');
  assert.equal(plain.deductibleDefault, false);
  assert.equal(expectedOop(plain, { ...NONE, pcpVisits: 1 }).total, 30);
});

test('a flat copay larger than the assumed price is price-sensitive, so not "fixed"', () => {
  const plan = { deductible: 0, oopMax: 5000, coinsurance: null, copays: { primary_care: usd(200, '$200 Copayment - No deductible') } };
  const o = expectedOop(plan, { ...NONE, pcpVisits: 1 }); // assumed price 150 < copay 200
  assert.equal(o.total, 150);
  assert.equal(o.flat, false);
});

// ---------- real data: the HDHPs that were wrongly "Fixed cost" ----------
const real = (() => {
  try {
    const r = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url)));
    return { rates: r('rates.json'), benefits: r('benefits.json') };
  } catch { return null; }
})();

const EVENTS = [['pcpVisits', 'primary_care'], ['specialistVisits', 'specialist'], ['labs', 'lab_xray'],
  ['imaging', 'imaging'], ['erVisits', 'emergency']];

for (const code of ['B61', 'V41']) {
  test(`real data: 2027 HDHP ${code} is "estimated" and its OOP exceeds its flat copays (typical)`, { skip: !real }, () => {
    const benefits = real.benefits[2027][code];
    const usage = SCENARIOS.typical;
    for (const enrollment of ['self', 'family']) {
      const t = planTotal({ rate: real.rates[2027][code], benefits, account: benefits.account_contribution }, { status: 'active', enrollment, usage });
      assert.notEqual(t.firmness, 'fixed', `${code} ${enrollment}`);
      let flatCopays = 0;
      for (const [k, svc] of EVENTS) flatCopays += (usage[k] || 0) * (benefits.copays[svc]?.kind === 'usd' ? benefits.copays[svc].value : 0);
      flatCopays += (usage.rxMonthly || 0) * 12 * (benefits.copays.rx_tier1?.value ?? 0);
      assert.ok(t.oop > flatCopays, `${code} ${enrollment}: oop ${t.oop} vs flat copays ${flatCopays}`);
      assert.ok(t.breakdown.deductiblePaid > 0, `${code} ${enrollment}: deductible consumed`);
    }
  });
}
