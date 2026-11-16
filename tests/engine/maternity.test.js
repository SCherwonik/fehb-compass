// "Having a baby": the maternity custom kind, priced from each plan's brochure-reviewed maternity terms
// (pipeline/maternity_terms.json -> data/benefits.json benefits[code].maternity). Real 2027 data, no mocks.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { planTotal, expectedOop, resolveBenefits, MATERNITY_UNPRICED, maternityGap } from '../../src/engine/cost.js';
import { CUSTOM_KINDS, CUSTOM_PRESETS, MATERNITY_SOURCE, usageFromCustom, sanitizeLine, sanitizeLines } from '../../src/engine/scenarios.js';

const DATA = new URL('../../data/', import.meta.url);
const hasData = ['rates', 'benefits'].every((f) => fs.existsSync(new URL(`${f}.json`, DATA)));
const load = (f) => JSON.parse(fs.readFileSync(new URL(`${f}.json`, DATA), 'utf8'));
const real = hasData ? { rates: load('rates'), benefits: load('benefits') } : null;
const skip = hasData ? false : 'data/*.json not found';

const BABY = CUSTOM_PRESETS.find((p) => p.id === 'baby');
const plan = (code) => {
  const benefits = real.benefits['2027'][code];
  return { rate: real.rates['2027'][code], benefits, account: benefits.account_contribution };
};
const run = (code, enrollment = 'self', lines = BABY.lines) =>
  planTotal(plan(code), { status: 'active', enrollment, usage: usageFromCustom(lines) });
const without = (code, enrollment = 'self') => run(code, enrollment, []);

test('the "Having a baby" preset: one maternity line at the KFF average, with the agreed description', () => {
  assert.ok(BABY, 'preset exists');
  assert.equal(BABY.label, 'Having a baby');
  assert.equal(BABY.description, 'Prenatal care, delivery and postpartum care for one pregnancy, priced at the average $20,416 of charges for women with employer insurance (KFF, 2025) and shared according to each plan’s own maternity terms. Newborn care is not included: switch to Self plus one or Family for the baby’s premium.');
  assert.deepEqual(BABY.lines, [{ label: 'Pregnancy, delivery and postpartum care', kind: 'maternity', price: 20416, perYear: 1 }]);
  assert.deepEqual(sanitizeLines(BABY.lines), BABY.lines, 'already clean');
  assert.equal(CUSTOM_KINDS.maternity.price, 20416);
  assert.equal(MATERNITY_SOURCE.price, 20416);
  assert.equal(MATERNITY_SOURCE.oop, 2743);
  assert.match(MATERNITY_SOURCE.url, /^https:\/\/www\.kff\.org\//);
});

test('sanitizeLine accepts the maternity kind (and drops a tier, as for every non-drug kind)', () => {
  assert.deepEqual(sanitizeLine({ label: 'Baby', kind: 'maternity', price: '20416', perYear: 1, tier: 2 }),
    { label: 'Baby', kind: 'maternity', price: 20416, perYear: 1 });
});

test('"Member Pays Nothing" in the brochure (104, FEP Standard): the pregnancy costs $0', { skip }, () => {
  const r = run('104');
  const L = r.breakdown.custom[0];
  assert.equal(L.cost, 0);
  assert.equal(r.oop, without('104').oop);
  assert.deepEqual(r.breakdown.unpriced, []);
  assert.equal(L.unpriced, undefined);
  assert.deepEqual(L.warnings, []);
  assert.match(L.notes.join(' '), /2027 brochure: you pay nothing\./);
});

test('a flat copay per admission (591, $350) and per pregnancy (131, $3,000) is what the pregnancy costs', { skip }, () => {
  assert.equal(run('591').breakdown.custom[0].cost, 350);
  assert.equal(run('131').breakdown.custom[0].cost, 3000);
  assert.match(run('131').breakdown.custom[0].notes.join(' '), /\$3,000 per pregnancy/);
  // a copay after the deductible: the deductible, then the copay (401: $300 + $250)
  const r = run('401');
  assert.equal(r.breakdown.deductible, 300);
  assert.equal(r.breakdown.custom[0].cost, 550);
});

test('coinsurance after the deductible (8W4, 15%), clipped at the out-of-pocket maximum', { skip }, () => {
  const b = real.benefits['2027']['8W4'].maternity;
  assert.deepEqual([b.kind, b.value, b.deductible], ['pct', 15, true]);
  const self = run('8W4');
  const ded = self.breakdown.deductible;
  assert.equal(ded, 2000);
  assert.equal(self.breakdown.custom[0].cost, Math.round((ded + 0.15 * (20416 - ded)) * 100) / 100); // 4,762.40
  assert.ok(self.oop < self.breakdown.oopMax);
  // Self Plus One (the baby's enrollment): the HDHP's family deductible applies to one person, so 15% on top reaches
  // the self-only out-of-pocket cap and is clipped there.
  const two = run('8W4', 'self_plus_one');
  assert.ok(two.breakdown.deductible > ded);
  assert.equal(two.oop, two.breakdown.oopMax);
  assert.equal(two.breakdown.custom[0].cost, two.breakdown.oopMax);
  // 424: 30% with a $500 calendar year deductible
  assert.equal(run('424').breakdown.custom[0].cost, 500 + 0.3 * (20416 - 500));
});

test('a plan whose maternity terms are not priced is flagged and its total leaves the line out (224)', { skip }, () => {
  const m = real.benefits['2027']['224'].maternity;
  assert.equal(m.priced, false);
  const r = run('224');
  const L = r.breakdown.custom[0];
  assert.equal(L.unpriced, true);
  assert.equal(L.cost, 0);
  assert.deepEqual(r.breakdown.unpriced, ['maternity']);
  assert.equal(r.total, without('224').total);
  assert.deepEqual(L.warnings, [maternityGap(m).text]);
  assert.match(L.warnings[0], /^Not priced: this plan’s brochure states its maternity cost by percentage of the hospital bill and the doctors’ bill separately/);
  assert.ok(L.notes.includes(`Detail: ${m.reason}`));
  assert.equal(r.firmness, 'estimated');
  // a brochure-reviewed plan whose terms need an assumption is estimated, never left at $0 silently (AJ1: OPM says
  // nothing, the brochure's hospital benefit is 30%)
  const aj1 = run('AJ1').breakdown.custom[0];
  assert.equal(aj1.estimated, true);
  assert.match(aj1.notes.join(' '), /^Estimated: assumes the charges split 50% hospital/);
  assert.match(aj1.notes.join(' '), /Hospital: 30% coinsurance/);
});

test('every unpriced 2027 plan says why as a gap in the plan’s own brochure; no priced plan carries that wording', { skip }, () => {
  const GAP = /brochure states its maternity cost (by percentage of the hospital bill and the doctors’ bill separately|per hospital day|per visit) and gives no way to total it for one pregnancy, so no estimate is added\. This is a gap in the plan’s published information, not in this app: see its brochure\.$/;
  const kinds = { split: 0, day: 0, visit: 0 };
  let unpriced = 0;
  for (const [code, b] of Object.entries(real.benefits['2027'])) {
    const L = run(code).breakdown.custom[0];
    const text = [...L.warnings, ...L.notes].join(' ');
    if (b.maternity?.priced === true) {
      assert.equal(maternityGap(b.maternity), null, code);
      assert.ok(!L.unpriced, code);
      assert.doesNotMatch(text, /not priced|gap in the plan|no estimate is added/i, code);
      continue;
    }
    unpriced += 1;
    const g = maternityGap(b.maternity);
    assert.ok(g.kind in kinds, `${code}: ${b.maternity?.reason}`);
    kinds[g.kind] += 1;
    assert.match(g.text, GAP, code);
    assert.match(g.text, /plan/);
    assert.deepEqual(L.warnings, [g.text], code);
  }
  assert.equal(unpriced, 36);
  // the kinds the maternity review found among the plans still not priced
  assert.ok(kinds.split > 0 && kinds.split + kinds.day + kinds.visit === 36, JSON.stringify(kinds));
  // the one-line card tag
  assert.equal(MATERNITY_UNPRICED, 'Maternity not priced: the plan’s brochure doesn’t give a total');
  // 2026 plans (never reviewed) get a plain "priced only for 2027 plans" line, not the brochure wording
  assert.equal(maternityGap({ priced: false, reason: '' }).kind, null);
  assert.match(maternityGap({ priced: false, reason: '' }).text, /only for 2027 plans/);
});

test('benefits without maternity terms (fixtures, other years) leave the line unpriced, never NaN', () => {
  const r = expectedOop(resolveBenefits({ deductible: 0, oop_max: 9000, coinsurance: 20, copays: {} }, 'self'),
    usageFromCustom(BABY.lines));
  assert.equal(r.total, 0);
  assert.deepEqual(r.unpriced, ['maternity']);
  // zero times a year: nothing to flag
  assert.deepEqual(expectedOop(resolveBenefits({ deductible: 0, oop_max: 9000, copays: {} }, 'self'),
    usageFromCustom([{ ...BABY.lines[0], perYear: 0 }])).unpriced, []);
});

test('every priced 2027 plan was checked against its brochure; 2026 is never priced', { skip }, () => {
  const all = Object.entries(real.benefits['2027']);
  const priced = all.filter(([, b]) => b.maternity?.priced);
  assert.equal(all.length, 118);
  assert.equal(priced.length, 82);
  assert.equal(priced.filter(([, b]) => b.maternity.estimated).length, 38);
  for (const [code, b] of priced) {
    const m = b.maternity;
    assert.equal(m.source, 'brochure', code);
    if (m.estimated) assert.ok(Array.isArray(m.parts) && m.parts.length && m.assumed.length, code);
    else assert.ok(['zero', 'usd', 'pct'].includes(m.kind) && Number.isFinite(m.value), code);
    assert.ok(m.quote && Number.isInteger(m.page) && /^7\d-\d{3}$/.test(m.brochure), code);
    const r = run(code);
    assert.ok(Number.isFinite(r.total) && r.oop <= r.breakdown.oopMax, code);
    assert.deepEqual(r.breakdown.unpriced, [], code);
  }
  for (const [code, b] of all.filter(([, x]) => !x.maternity?.priced)) assert.ok(b.maternity.reason, code);
  assert.ok(Object.values(real.benefits['2026']).every((b) => b.maternity && b.maternity.priced === false));
});

test('sanity check: the coinsurance plans land near the KFF average out-of-pocket ($2,743)', () => {
  // 15% of the average $20,416 of charges, before any deductible
  assert.equal(Math.round(0.15 * MATERNITY_SOURCE.price), 3062);
  assert.ok(Math.abs(0.15 * MATERNITY_SOURCE.price - MATERNITY_SOURCE.oop) < 400);
});
