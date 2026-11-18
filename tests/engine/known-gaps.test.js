// Known gaps (pipeline/known_gaps.json): a brochure deductible the estimate does not include. The total is NOT changed;
// the plan is marked 'estimated' and its breakdown lists the gap. Real 2027 data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planTotal, costGaps } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';
import { gapNote } from '../../src/ui/math-family.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const RATES = read('rates.json')['2027'];
const BENEFITS = read('benefits.json')['2027'];
const GAP_PLANS = ['V31', '2G4', 'B64'];
const CONFLICT_PLANS = ['B41', 'B44'];
const codes = Object.keys(BENEFITS).filter((c) => RATES[c]);
const U = (name) => ({ ...SCENARIOS[name], custom: [] });
const without = (b) => { const { known_gaps, ...rest } = b; return rest; };
const run = (code, benefits, inputs) => {
  try { return planTotal({ rate: RATES[code], benefits }, { status: 'active', ...inputs }); } catch { return null; }
};

test('V31, 2G4 and B64 are estimated in every scenario and enrollment; the gap is in the breakdown', () => {
  for (const code of GAP_PLANS) {
    for (const scenario of Object.keys(SCENARIOS)) {
      for (const enrollment of ['self', 'self_plus_one', 'family']) {
        const t = run(code, BENEFITS[code], { enrollment, usage: U(scenario) });
        assert.equal(t.firmness, 'estimated', `${code} ${scenario} ${enrollment}`);
        assert.ok(t.breakdown.gaps.length >= 1);
        assert.match(gapNote(t.breakdown.gaps[0]), /^Not included in this estimate: .+\(Brochure 73-\d+, page \d+\.\)$/);
      }
    }
  }
  assert.equal(costGaps(BENEFITS.B64).length, 2);
  assert.deepEqual(costGaps(BENEFITS.B64).map((g) => g.kind), ['facility_deductible', 'drug_deductible']);
});

test('a household total is estimated too, and lists the gap', () => {
  const usage = U('healthy');
  const t = run('2G4', BENEFITS['2G4'], { enrollment: 'family', usage, members: [{ usage }, { usage }, { usage }] });
  assert.equal(t.firmness, 'estimated');
  assert.equal(t.breakdown.gaps[0].kind, 'facility_deductible');
});

test('conflict entries are data only: no gap in the breakdown, firmness as before', () => {
  for (const code of CONFLICT_PLANS) {
    assert.equal(BENEFITS[code].known_gaps[0].kind, 'conflict');
    assert.deepEqual(costGaps(BENEFITS[code]), []);
    const t = run(code, BENEFITS[code], { enrollment: 'self', usage: U('healthy') });
    assert.equal(t.breakdown.gaps, undefined);
    assert.equal(t.firmness, run(code, without(BENEFITS[code]), { enrollment: 'self', usage: U('healthy') }).firmness);
  }
});

test('every plan, scenario and enrollment: totals identical with and without known gaps; firmness differs only on cost-gap plans', () => {
  let checked = 0;
  for (const code of codes) {
    for (const scenario of Object.keys(SCENARIOS)) {
      for (const enrollment of ['self', 'self_plus_one', 'family']) {
        const usage = U(scenario);
        for (const members of [undefined, enrollment === 'self' ? undefined : [{ usage }, { usage: U('worst') }]]) {
          const inputs = { enrollment, usage, ...(members && { members }) };
          const a = run(code, BENEFITS[code], inputs);
          const b = run(code, without(BENEFITS[code]), inputs);
          if (!a || !b) { assert.equal(!!a, !!b, code); continue; }
          checked += 1;
          const { firmness: fa, breakdown: { gaps, ...ba }, ...ra } = a;
          const { firmness: fb, breakdown: bb, ...rb } = b;
          assert.deepEqual(ra, rb, `${code} ${scenario} ${enrollment}`);
          assert.deepEqual(ba, bb, `${code} ${scenario} ${enrollment}`);
          if (GAP_PLANS.includes(code)) assert.equal(fa, 'estimated');
          else { assert.equal(fa, fb, code); assert.equal(gaps, undefined, code); }
        }
      }
    }
  }
  assert.ok(checked > 1000, `checked ${checked}`);
});

test("'fixed' is kept where no cost gap applies", () => {
  const fixed = codes.filter((c) => !GAP_PLANS.includes(c)).filter((c) => {
    const t = run(c, BENEFITS[c], { enrollment: 'self', usage: U('healthy') });
    return t && t.firmness === 'fixed';
  });
  assert.ok(fixed.length > 10);
});
