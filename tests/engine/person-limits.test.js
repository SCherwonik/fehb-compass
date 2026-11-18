// C2: a scenario is ONE covered person's year of care. Self Plus One / Family enrollments therefore apply the
// per-person (embedded) limits: the self-only deductible and the self-only out-of-pocket max. Aggregate-family
// HSA HDHPs keep the family deductible (one person must meet all of it) but are still capped at the self-only OOP
// max (the app's stated assumption, see About). Premiums and account deposits follow the chosen enrollment. Real 2027 data.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { planTotal, deductibleType, personLimits, UNCLEAR_FAMILY_DEDUCTIBLE } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';

const r = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url)));
const rates = r('rates.json');
const benefits = r('benefits.json');
const plan = (code) => {
  const b = benefits[2027][code];
  return { rate: rates[2027][code], benefits: b, account: b.account_contribution, accountType: /reimbursement/i.test(b.account_type) ? 'HRA' : undefined };
};
const total = (code, enrollment, scenario) => planTotal(plan(code), { status: 'active', enrollment, usage: SCENARIOS[scenario] });

test('deductibleType: embedded for non-HDHP plans, aggregate for HSA HDHPs whose family deductible is 2x self, unknown otherwise', () => {
  for (const c of ['131', '104', '444', '471', 'YJ1']) assert.equal(deductibleType(benefits[2027][c]), 'embedded', c);
  for (const c of ['B61', 'V41', 'KX1']) assert.equal(deductibleType(benefits[2027][c]), 'aggregate', c);
  assert.equal(deductibleType(benefits[2027]['224']), 'individual', '224: its brochure states a $3,500 individual threshold');
  assert.equal(deductibleType(benefits[2027]['8W4']), 'unknown', '8W4: HDHP with an HRA, the data does not say');
});

test('personLimits: self enrollment is unchanged; family uses the self deductible and OOP max for embedded plans', () => {
  assert.deepEqual(personLimits(benefits[2027]['131'], 'self'),
    { deductible: 1000, oopMax: 11000, oon: { deductible: null, oopMax: null }, type: 'embedded' });
  const f = personLimits(benefits[2027]['131'], 'family');
  assert.equal(f.deductible, 1000);
  assert.equal(f.oopMax, 11000);
  const s1 = personLimits(benefits[2027]['104'], 'self_plus_one');
  assert.deepEqual([s1.deductible, s1.oopMax, s1.oon.deductible, s1.oon.oopMax], [500, 7000, 500, 9000]);
});

test('personLimits: aggregate HSA HDHP keeps the family deductible, OOP capped at the self-only max', () => {
  const b = personLimits(benefits[2027].B61, 'family');
  assert.deepEqual([b.deductible, b.oopMax, b.type], [3500, 7500, 'aggregate']);
  assert.deepEqual([b.oon.deductible, b.oon.oopMax], [7000, 9500]);
  const v = personLimits(benefits[2027].V41, 'self_plus_one');
  assert.deepEqual([v.deductible, v.oopMax], [4000, 6000]);
});

test('embedded plans 131 and 104: self vs family totals differ only by premium, in every scenario', () => {
  for (const code of ['131', '104']) {
    for (const sc of ['healthy', 'typical', 'condition', 'worst']) {
      const s = total(code, 'self', sc);
      const f = total(code, 'family', sc);
      assert.equal(Math.round((f.total - s.total) * 100), Math.round((f.premium - s.premium) * 100), `${code} ${sc}`);
      assert.equal(f.oop, s.oop, `${code} ${sc}`);
    }
  }
});

test('every embedded 2027 plan without an account: family out-of-pocket equals self out-of-pocket', () => {
  let n = 0;
  for (const code of Object.keys(benefits[2027])) {
    const b = benefits[2027][code];
    if (deductibleType(b) !== 'embedded' || !/not applicable/i.test(b.account_type) || !rates[2027][code]?.family) continue;
    for (const sc of ['typical', 'worst']) assert.equal(total(code, 'family', sc).oop, total(code, 'self', sc).oop, `${code} ${sc}`);
    n += 1;
  }
  assert.ok(n >= 90, `checked ${n} plans`);
});

test('plan 131 worst case, family: one person is capped at the $11,000 self-only max, not $22,000', () => {
  const f = total('131', 'family', 'worst');
  assert.ok(f.oop <= 11000, `oop ${f.oop}`);
  assert.equal(f.breakdown.oopMax, 11000);
  assert.equal(f.breakdown.deductible, 1000);
  assert.equal(f.breakdown.enrollmentOopMax, 22000);
  assert.equal(f.breakdown.enrollmentDeductible, 2000);
  assert.equal(f.breakdown.deductibleType, 'embedded');
  assert.equal(f.breakdown.onePerson, true);
  assert.equal(total('131', 'self', 'worst').breakdown.onePerson, false);
});

test('B61 and V41 (aggregate HSA HDHPs): family meets the whole family deductible, capped at the self-only max', () => {
  for (const [code, dedF, maxS] of [['B61', 3500, 7500], ['V41', 4000, 6000]]) {
    const f = total(code, 'family', 'worst');
    assert.equal(f.breakdown.deductible, dedF, code);
    assert.equal(f.breakdown.oopMax, maxS, code);
    assert.ok(f.oop <= maxS, `${code} worst oop ${f.oop}`);
    const fT = total(code, 'family', 'typical');
    const sT = total(code, 'self', 'typical');
    assert.ok(fT.breakdown.deductiblePaid >= sT.breakdown.deductiblePaid, `${code} family deductible at least self`);
  }
});

test('See the math explains the one-person modeling, and the matrix shows the deductible type per plan', async () => {
  const { personLimitsNote } = await import('../../src/ui/model.js');
  const { buildMatrix } = await import('../../src/ui/matrix-model.js');
  assert.equal(personLimitsNote(total('131', 'self', 'typical').breakdown), '');
  const e = personLimitsNote(total('131', 'family', 'typical').breakdown);
  assert.match(e, /one covered person/);
  assert.match(e, /\$1,000 deductible and \$11,000 out-of-pocket max/);
  assert.match(e, /family limits \(\$2,000 and \$22,000\) are not reached by one person/);
  assert.match(personLimitsNote(total('B61', 'family', 'typical').breakdown), /whole \$3,500 deductible.*\$7,500 self-only/);
  const m = buildMatrix(['131', 'B61', '8W4'].map((code) => ({ code, benefits: benefits[2027][code] })), { enrollment: 'family' });
  const row = m.find((s) => s.id === 'account').rows.find((r) => r.key === 'calc:deductibleType');
  assert.deepEqual(row.cells.map((c) => c.display), ['Embedded (per person)', 'Aggregate (shared)', 'Unknown (modeled as shared)']);
  assert.equal(row.differs, true);
});

test('WX1 is listed as unclear wording and still modeled as shared; no text makes a legal claim', () => {
  assert.ok(UNCLEAR_FAMILY_DEDUCTIBLE.WX1);
  assert.equal(deductibleType(benefits[2027].WX1), 'aggregate');
  const files = ['src/engine/cost.js', 'src/ui/about.js', 'src/ui/math.js', 'src/ui/math-family.js', 'src/ui/matrix-model.js', 'src/ui/model.js', 'README.md'];
  for (const f of files) {
    const t = fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(t, /\bACA\b|by law|the ACA requires/i, f);
    assert.doesNotMatch(t, /data does not say how (a|this plan’s) family deductible/i, f);
  }
});
