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
    near(three.oop, Math.min(3 * single.oop, famMax), code);
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
    near(a.oop, b.oop, code);
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
