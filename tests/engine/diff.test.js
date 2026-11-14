import test from 'node:test';
import assert from 'node:assert/strict';
import { diffPlan, planFacts, FLAG_TEXT } from '../../src/engine/diff.js';

const base = { premium: 3000, deductible: 500, oopMax: 6000, coinsurance: 20 };

test('new plan: status "new", every numeric delta null (never NaN)', () => {
  const d = diffPlan(null, base);
  assert.equal(d.status, 'new');
  for (const k of ['premiumChange', 'premiumPct', 'deductibleChange', 'oopMaxChange', 'coinsuranceChange']) {
    assert.equal(d[k], null, k);
  }
  assert.deepEqual(d.flags, []);
});

test('ended plan: status "ended", deltas null', () => {
  const d = diffPlan(base, undefined);
  assert.equal(d.status, 'ended');
  assert.equal(d.premiumChange, null);
  assert.equal(d.oopMaxChange, null);
  assert.deepEqual(d.flags, []);
});

test('OOP max up with premium flat flags oop_up_no_premium_cut', () => {
  const d = diffPlan(base, { ...base, oopMax: 7000 });
  assert.equal(d.status, 'same');
  assert.equal(d.oopMaxChange, 1000);
  assert.equal(d.premiumChange, 0);
  assert.ok(d.flags.includes('oop_up_no_premium_cut'));
});

test('OOP max up with premium up also flags; premium cut does not', () => {
  assert.ok(diffPlan(base, { ...base, oopMax: 6500, premium: 3100 }).flags.includes('oop_up_no_premium_cut'));
  assert.ok(!diffPlan(base, { ...base, oopMax: 6500, premium: 2900 }).flags.includes('oop_up_no_premium_cut'));
});

test('identical plans: status same, zero deltas, no flags', () => {
  const d = diffPlan(base, { ...base });
  assert.equal(d.status, 'same');
  assert.deepEqual(d.flags, []);
  assert.equal(d.premiumChange, 0);
  assert.equal(d.premiumPct, 0);
  assert.equal(d.deductibleChange, 0);
  assert.equal(d.oopMaxChange, 0);
  assert.equal(d.coinsuranceChange, 0);
});

test('deductible up flags deductible_up; premium pct is rounded to 0.1', () => {
  const d = diffPlan(base, { ...base, deductible: 750, premium: 3100 });
  assert.equal(d.deductibleChange, 250);
  assert.ok(d.flags.includes('deductible_up'));
  assert.equal(d.premiumChange, 100);
  assert.equal(d.premiumPct, 3.3);
});

test('coinsurance up and big premium jump are flagged', () => {
  const d = diffPlan(base, { ...base, coinsurance: 25, premium: 3600 });
  assert.equal(d.coinsuranceChange, 5);
  assert.ok(d.flags.includes('coinsurance_up'));
  assert.ok(d.flags.includes('premium_up_10'));
});

test('missing scalars give null deltas, not NaN, and no false flags', () => {
  const d = diffPlan({ ...base, coinsurance: null, premium: 0 }, { ...base, coinsurance: 30, oopMax: null });
  assert.equal(d.coinsuranceChange, null);
  assert.equal(d.oopMaxChange, null);
  assert.equal(d.premiumPct, null); // 2026 premium of 0: percent undefined
  assert.ok(!d.flags.includes('coinsurance_up'));
  assert.ok(!d.flags.includes('oop_up_no_premium_cut'));
  for (const v of Object.values(d)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
});

test('cent noise does not count as a change', () => {
  const d = diffPlan(base, { ...base, premium: 3000.004 });
  assert.equal(d.premiumChange, 0);
  assert.deepEqual(d.flags, []);
});

test('planFacts builds comparable scalars from raw rate + benefits', () => {
  const rate = { self: { biweekly_active: 100, monthly_retiree: 200 } };
  const benefits = { deductible: { self: 500 }, oop_max: { self: 6000 }, coinsurance: 20, copays: {} };
  assert.deepEqual(planFacts({ rate, benefits }, { status: 'active', enrollment: 'self' }),
    { premium: 2600, deductible: 500, oopMax: 6000, coinsurance: 20 });
  assert.equal(planFacts(null, { status: 'active', enrollment: 'self' }), null);
  assert.equal(planFacts({ rate: null, benefits }, { status: 'active', enrollment: 'self' }), null);
});

test('every flag has display text', () => {
  for (const f of ['oop_up_no_premium_cut', 'deductible_up', 'coinsurance_up', 'premium_up_10']) {
    assert.equal(typeof FLAG_TEXT[f], 'string');
  }
});
