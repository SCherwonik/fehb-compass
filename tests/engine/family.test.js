// Family costing: one member at a time, with a running family tally (deductible, out-of-pocket, out-of-network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planTotal, expectedOop, resolveBenefits, personLimits, deductibleType } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const RATES = read('rates.json')['2027'];
const BENEFITS = read('benefits.json')['2027'];
const codes = Object.keys(BENEFITS).filter((c) => RATES[c]);
const U = (name) => ({ ...SCENARIOS[name], custom: [] });
const plan = (code) => ({ rate: RATES[code], benefits: BENEFITS[code] });
const run = (code, inputs) => { try { return planTotal(plan(code), { status: 'active', ...inputs }); } catch { return null; } };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.02, `${msg}: ${a} vs ${b}`);

test('one member equals today\'s total', () => {
  for (const scenario of ['healthy', 'typical', 'condition', 'worst']) {
    for (const enrollment of ['self', 'family']) {
      for (const code of codes) {
        const usage = U(scenario);
        const one = run(code, { enrollment, usage });
        if (!one) continue;
        const fam = run(code, { enrollment, usage, members: [{ usage }] });
        assert.equal(fam.oop, one.oop, `${code} ${scenario} ${enrollment}`);
        assert.equal(fam.total, one.total, `${code} ${scenario} ${enrollment}`);
        assert.equal(fam.breakdown.deductiblePaid, one.breakdown.deductiblePaid, `${code} ${scenario} ${enrollment}`);
      }
    }
  }
});

test('carry: money already paid this year comes off the deductible and the out-of-pocket max', () => {
  const code = codes.find((c) => {
    const r = resolveBenefits(BENEFITS[c], 'self');
    return r.deductible > 0 && Number.isFinite(r.oopMax) && expectedOop(r, U('typical')).deductiblePaid > 0;
  });
  const b = { ...resolveBenefits(BENEFITS[code], 'self') };
  b.familyOopMax = b.oopMax;
  const usage = U('typical');
  const plain = expectedOop(b, usage);
  assert.equal(expectedOop(b, usage, {}, [], { dedUsed: b.deductible }).deductiblePaid, 0);
  assert.equal(expectedOop(b, usage, {}, [], { oopUsed: b.oopMax }).total, 0);
  assert.equal(plain.carryOut.oopUsed, plain.total);
  assert.equal(plain.carryOut.dedUsed, plain.deductiblePaid);
  // a family deductible already met by others: nothing more toward this person's own deductible
  const fam = { ...b, familyDeductible: 2 * b.deductible };
  assert.equal(expectedOop(fam, usage, {}, [], { famDedUsed: 2 * b.deductible }).deductiblePaid, 0);
  const part = expectedOop(fam, usage, {}, [], { famDedUsed: 2 * b.deductible - 10 });
  assert.ok(part.deductiblePaid <= 10 + 1e-9);
  assert.equal(plain.carryOut.famDedUsed, plain.deductiblePaid);
});

test('embedded plans cap the sum at the family max', () => {
  let n = 0;
  for (const code of codes) {
    const b = BENEFITS[code];
    const famMax = resolveBenefits(b, 'family').oopMax;
    if (deductibleType(b) !== 'embedded' || !Number.isFinite(famMax)) continue;
    const usage = U('worst');
    const single = run(code, { enrollment: 'family', usage, members: [{ usage }] });
    if (!single) continue;
    const three = run(code, { enrollment: 'family', members: [{ usage }, { usage }, { usage }] });
    // the family deductible can lower it further (C1); never above three single years or the family max
    assert.ok(three.oop <= Math.min(3 * single.oop, famMax) + 0.02, `${code}: ${three.oop}`);
    const d = resolveBenefits(b, 'family').deductible;
    if (!(d < 3 * resolveBenefits(b, 'self').deductible)) near(three.oop, Math.min(3 * single.oop, famMax), code);
    assert.equal(three.breakdown.members.length, 3);
    assert.equal(three.breakdown.onePerson, false);
    assert.equal(three.breakdown.memberCount, 3);
    n++;
  }
  assert.ok(n > 0);
});

test('one sick member never exceeds the self-only max', () => {
  for (const code of codes) {
    const b = BENEFITS[code];
    if (deductibleType(b) !== 'embedded') continue;
    const usage = U('worst');
    const one = run(code, { enrollment: 'family', usage });
    if (!one) continue;
    const three = run(code, { enrollment: 'family', members: [{ usage }, { usage: U('nothing') }, { usage: U('nothing') }] });
    near(three.oop, one.oop, code);
  }
});

test('order does not matter on embedded plans', () => {
  for (const code of codes) {
    if (deductibleType(BENEFITS[code]) !== 'embedded') continue;
    const a = run(code, { enrollment: 'family', members: [{ usage: U('typical') }, { usage: U('worst') }] });
    if (!a) continue;
    const b = run(code, { enrollment: 'family', members: [{ usage: U('worst') }, { usage: U('typical') }] });
    // exact unless the family deductible is below twice the self-only one (plan 471): then who meets it first matters
    const d = BENEFITS[code].deductible;
    const binds = d && typeof d === 'object' && d.family < 2 * d.self;
    const tol = binds ? resolveBenefits(BENEFITS[code], 'self').deductible : 0.02;
    assert.ok(Math.abs(a.oop - b.oop) <= tol, `${code}: ${a.oop} vs ${b.oop}`);
  }
});

test('aggregate plans share the deductible', () => {
  let n = 0;
  for (const code of codes) {
    if (deductibleType(BENEFITS[code]) !== 'aggregate') continue;
    const person = personLimits(BENEFITS[code], 'family');
    const t = run(code, { enrollment: 'family', members: [{ usage: U('typical') }, { usage: U('typical') }] });
    if (!t) continue;
    assert.ok(t.breakdown.deductiblePaid <= person.deductible + 0.02, `${code}: ${t.breakdown.deductiblePaid} vs ${person.deductible}`);
    n++;
  }
  assert.ok(n > 0);
});

test('embedded: the family deductible caps everyone\'s deductible spending together (plan 474, four people)', () => {
  const famDed = resolveBenefits(BENEFITS['474'], 'family').deductible;
  assert.equal(deductibleType(BENEFITS['474']), 'embedded');
  assert.equal(famDed, 4400);
  const usage = U('condition');
  const t = run('474', { enrollment: 'family', members: [{ usage }, { usage }, { usage }, { usage }] });
  assert.ok(t.breakdown.deductiblePaid <= famDed + 0.02, `${t.breakdown.deductiblePaid}`);
  near(t.breakdown.deductiblePaid, famDed, '474 deductible');
  near(t.oop, 8780, '474 care total');
  assert.equal(t.breakdown.familyDeductible, famDed);
  // each member's own deductible still applies: no one pays more than the self-only one
  for (const m of t.breakdown.members) assert.ok(m.deductiblePaid <= 2200 + 0.02);
});

test('embedded: no family total ever spends more than the family deductible on deductibles', () => {
  let n = 0;
  for (const code of codes) {
    if (deductibleType(BENEFITS[code]) !== 'embedded') continue;
    const famDed = resolveBenefits(BENEFITS[code], 'family').deductible;
    const t = run(code, { enrollment: 'family', familySize: 5, members: Array.from({ length: 5 }, () => ({ usage: U('condition') })) });
    if (!t || !Number.isFinite(famDed)) continue;
    assert.ok(t.breakdown.deductiblePaid <= famDed + 0.02, `${code}: ${t.breakdown.deductiblePaid} vs ${famDed}`);
    n++;
  }
  assert.ok(n > 0);
});

test('Self Plus One totals do not depend on the family deductible when it is twice the self-only one', () => {
  for (const code of codes) {
    const b = BENEFITS[code];
    if (deductibleType(b) !== 'embedded') continue;
    const d = b.deductible;
    if (!d || typeof d !== 'object' || !(d.self_plus_one >= 2 * d.self)) continue;
    const members = [{ usage: U('worst') }, { usage: U('condition') }];
    const t = run(code, { enrollment: 'self_plus_one', members });
    if (!t) continue;
    const solo = members.map((m) => run(code, { enrollment: 'self_plus_one', members: [m] }));
    // two people can never reach a family deductible of twice the self-only one before their own are met
    near(t.breakdown.deductiblePaid, solo[0].breakdown.deductiblePaid + solo[1].breakdown.deductiblePaid, code);
  }
});

test('order does not matter on embedded plans, three and four people', () => {
  for (const code of codes) {
    if (deductibleType(BENEFITS[code]) !== 'embedded') continue;
    const mk = (keys) => run(code, { enrollment: 'family', members: keys.map((k) => ({ usage: U(k) })) });
    const a = mk(['condition', 'typical', 'worst', 'condition']);
    if (!a) continue;
    const b = mk(['worst', 'condition', 'condition', 'typical']);
    // once the family deductible binds, who meets it first decides which services fall under it: at most one
    // self-only deductible apart (the people are costed in the order listed)
    const tol = Math.max(0.02, resolveBenefits(BENEFITS[code], 'self').deductible);
    assert.ok(Math.abs(a.oop - b.oop) <= tol, `${code}: ${a.oop} vs ${b.oop}`);
  }
});

test('aggregate plans: the family deductible tally changes nothing', () => {
  for (const code of codes) {
    if (['embedded', 'individual'].includes(deductibleType(BENEFITS[code]))) continue;
    const t = run(code, { enrollment: 'family', members: [{ usage: U('worst') }, { usage: U('condition') }, { usage: U('typical') }] });
    if (!t) continue;
    assert.equal(t.breakdown.familyDeductible ?? null, null, code);
  }
});

test('carry: out-of-network spending and the out-of-pocket tally cap a later member', () => {
  const benefits = {
    deductible: { self: 0, family: 0 }, oop_max: { self: 1000, family: 1500 }, coinsurance: 100, copays: {},
    out_of_network: { deductible: { self: 0, family: 0 }, oop_max: { self: 800, family: 1000 } },
  };
  const visits = { custom: [{ label: 'Care', kind: 'other', price: 600, perYear: 2 }] };
  const oon = { custom: [{ label: 'Out', kind: 'other', price: 700, perYear: 1, outOfNetwork: true }] };
  const t = planTotal({ rate: RATES[codes[0]], benefits }, {
    status: 'active', enrollment: 'family',
    members: [{ usage: visits }, { usage: visits }, { usage: oon }, { usage: oon }],
  });
  const [a, b2, c, d] = t.breakdown.members;
  assert.equal(a.oop, 1000); // 2 x $600 capped at the self-only $1,000
  assert.equal(b2.oop, 500); // the family's $1,500 cap leaves $500
  assert.equal(c.oonPaid, 700);
  assert.equal(d.oonPaid, 300); // the family's $1,000 out-of-network cap leaves $300
});

test('family fallback: no enrollment out-of-pocket max falls back to self-only and says so', () => {
  const benefits = {
    deductible: { self: 500, family: 1000 }, oop_max: { self: 3000 }, coinsurance: 20,
    copays: { primary_care: { kind: 'usd', value: 20, raw: '$20' } },
  };
  const usage = U('typical');
  const t = planTotal({ rate: RATES[codes[0]], benefits }, { status: 'active', enrollment: 'family', members: [{ usage }, { usage }] });
  assert.equal(t.breakdown.familyFallback, true);
  assert.equal(t.breakdown.familyOopMax, null);
  assert.equal(t.breakdown.members.length, 2);
});

test('carry on an aggregate HSA plan: the shared deductible and the family out-of-pocket max cap a later member', () => {
  const benefits = {
    account_type: 'Health Savings Account',
    deductible: { self: 1000, family: 2000 }, oop_max: { self: 3000, family: 4000 }, coinsurance: 50, copays: {},
  };
  assert.equal(deductibleType(benefits), 'aggregate');
  const big = { custom: [{ label: 'Care', kind: 'other', price: 10000, perYear: 1 }] };
  const t = planTotal({ rate: RATES[codes[0]], benefits }, { status: 'active', enrollment: 'family', members: [{ usage: big }, { usage: big }, { usage: big }] });
  const [a, b2, c] = t.breakdown.members;
  assert.equal(a.deductiblePaid, 2000); // one person meets the whole family deductible
  assert.equal(a.oop, 3000); // then stops at the self-only max
  assert.equal(b2.deductiblePaid, 0); // the shared deductible is already met
  assert.equal(b2.oop, 1000); // the family's $4,000 leaves $1,000
  assert.equal(c.oop, 0);
  assert.equal(t.oop, 4000);
});
