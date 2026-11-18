// Known gaps (pipeline/known_gaps.json): a brochure deductible the estimate does not include. The total is NOT changed;
// the plan is marked 'estimated' and its breakdown lists the gap. Real 2027 data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planTotal, costGaps, APPLIES_WHEN } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';
import { gapNote, gapFirmness } from '../../src/ui/math-family.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const RATES = read('rates.json')['2027'];
const BENEFITS = read('benefits.json')['2027'];
const GAP_PLANS = ['V31', '2G4', 'B64'];
const CONFLICT_PLANS = ['B41', 'B44'];
// the brochure contradicts itself about the Self Plus One / Self and Family deductible the estimate uses
const COST_CONFLICT_PLANS = ['KX1', 'L14'];
const FAMILY = ['self_plus_one', 'family'];
// scenarios whose care can trigger each plan's missing deductible (see applies_when below)
const TRIGGERED_BY = { V31: ['typical', 'condition', 'worst'], '2G4': ['worst'], B64: ['worst'] };
const affected = (code, enrollment, scenarios) => scenarios.some((s) => TRIGGERED_BY[code]?.includes(s))
  || (COST_CONFLICT_PLANS.includes(code) && FAMILY.includes(enrollment));
const codes = Object.keys(BENEFITS).filter((c) => RATES[c]);
const U = (name) => ({ ...SCENARIOS[name], custom: [] });
const without = (b) => { const { known_gaps, ...rest } = b; return rest; };
const run = (code, benefits, inputs) => {
  try { return planTotal({ rate: RATES[code], benefits }, { status: 'active', ...inputs }); } catch { return null; }
};

// When the member's year can trigger the brochure deductible the estimate leaves out (gap.applies_when): hospital stays
// (and the birth stay in a maternity line), outpatient surgery, MRI/CT imaging for V31, brand-tier drugs for B64's drug
// deductible. Scenario usage: healthy/nothing have none; typical and condition have imaging; worst has stays.
test('V31, 2G4 and B64 are estimated, with the note, only when the year can trigger the missing deductible', () => {
  for (const code of GAP_PLANS) {
    for (const scenario of Object.keys(SCENARIOS)) {
      for (const enrollment of ['self', 'self_plus_one', 'family']) {
        const t = run(code, BENEFITS[code], { enrollment, usage: U(scenario) });
        const before = run(code, without(BENEFITS[code]), { enrollment, usage: U(scenario) });
        if (TRIGGERED_BY[code].includes(scenario)) {
          assert.equal(t.firmness, 'estimated', `${code} ${scenario} ${enrollment}`);
          assert.ok(t.breakdown.gaps.length >= 1);
          assert.match(gapNote(t.breakdown.gaps[0]), /^Not included in this estimate: .+\(Brochure 73-\d+, page \d+\.\)$/);
        } else {
          assert.equal(t.breakdown.gaps, undefined, `${code} ${scenario} ${enrollment}: no note`);
          assert.equal(t.firmness, before.firmness, `${code} ${scenario} ${enrollment}: firmness as before`);
        }
      }
    }
  }
  assert.equal(costGaps(BENEFITS.B64).length, 2);
  assert.deepEqual(costGaps(BENEFITS.B64).map((g) => g.kind), ['facility_deductible', 'drug_deductible']);
});

test("scenario 'nothing': no note and the firmness of the plan without the gap; 'worst': the note", () => {
  for (const code of GAP_PLANS) {
    const none = run(code, BENEFITS[code], { enrollment: 'self', usage: U('nothing') });
    assert.equal(none.breakdown.gaps, undefined, code);
    assert.equal(none.firmness, run(code, without(BENEFITS[code]), { enrollment: 'self', usage: U('nothing') }).firmness, code);
    assert.equal(none.firmness, 'fixed', code);
    const worst = run(code, BENEFITS[code], { enrollment: 'self', usage: U('worst') });
    assert.equal(worst.firmness, 'estimated', code);
    assert.equal(worst.breakdown.gaps[0].kind, 'facility_deductible', code);
  }
});

test('what triggers each gap: own lines, maternity, imaging (V31 only) and brand-tier drugs (B64 drug deductible)', () => {
  const line = (kind, extra = {}) => ({ ...SCENARIOS.nothing, custom: [{ kind, label: kind, price: 100, perYear: 1, ...extra }] });
  const kinds = (code, usage, drugs = []) => (run(code, BENEFITS[code], { enrollment: 'self', usage, drugs }).breakdown.gaps ?? []).map((g) => g.kind);
  for (const code of GAP_PLANS) {
    assert.ok(kinds(code, line('hospital_stay')).includes('facility_deductible'), `${code} stay`);
    assert.ok(kinds(code, line('surgery_outpatient')).includes('facility_deductible'), `${code} surgery`);
    assert.ok(kinds(code, line('maternity')).includes('facility_deductible'), `${code} birth stay`);
    assert.deepEqual(kinds(code, line('specialist')), [], `${code} office visit`);
    assert.deepEqual(kinds(code, line('er')), [], `${code} ER: a copay in these brochures`);
  }
  assert.deepEqual(kinds('V31', line('imaging')), ['facility_deductible'], 'V31: MRI/CT');
  assert.deepEqual(kinds('2G4', line('imaging')), []);
  assert.deepEqual(kinds('B64', line('rx_brand', { tier: 2 })), ['drug_deductible']);
  assert.deepEqual(kinds('B64', line('rx_generic', { tier: 1 })), [], 'tier 1 is outside the Tier 2-5 deductible');
  assert.deepEqual(kinds('B64', { ...SCENARIOS.typical, imaging: 0, custom: [] }), [], 'monthly generics only');
  const med = { label: 'a drug', fillsPerYear: 12, price: 300, share: { kind: 'usd', value: 50 }, deductibleApplies: null };
  assert.deepEqual(kinds('B64', U('nothing'), [med]), ['drug_deductible'], 'a medication from the list');
  assert.deepEqual(kinds('B64', line('rx_brand', { tier: 2, perYear: 0 })), [], 'a line used 0 times');
});

test('a gap without applies_when applies to every year; an unknown trigger never hides a gap', () => {
  const g = { kind: 'facility_deductible', affects_cost: true, text: 't', brochure: 'b', page: 1 };
  assert.equal(costGaps({ known_gaps: [g] }, 'self', [{ usage: SCENARIOS.nothing }]).length, 1);
  assert.equal(costGaps({ known_gaps: [{ ...g, applies_when: ['hospital'] }] }, 'self', [{ usage: SCENARIOS.nothing }]).length, 0);
  assert.equal(costGaps({ known_gaps: [{ ...g, applies_when: ['hospital'] }] }, 'self').length, 1, 'no usage given: listed');
  assert.equal(costGaps({ known_gaps: [{ ...g, applies_when: ['moon_landing'] }] }, 'self', [{ usage: SCENARIOS.nothing }]).length, 1);
  for (const code of GAP_PLANS) {
    for (const x of BENEFITS[code].known_gaps) assert.ok(x.applies_when.every((w) => APPLIES_WHEN.includes(w)), code);
  }
});

test('a household total is estimated when any member triggers the gap, and lists it', () => {
  const healthy = U('healthy');
  const t = run('2G4', BENEFITS['2G4'], { enrollment: 'family', usage: healthy, members: [{ usage: healthy }, { usage: U('worst') }, { usage: healthy }] });
  assert.equal(t.firmness, 'estimated');
  assert.equal(t.breakdown.gaps[0].kind, 'facility_deductible');
  const none = run('2G4', BENEFITS['2G4'], { enrollment: 'family', usage: healthy, members: [{ usage: healthy }, { usage: healthy }] });
  assert.equal(none.breakdown.gaps, undefined);
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
          if (affected(code, enrollment, members ? [scenario, 'worst'] : [scenario])) assert.equal(fa, 'estimated');
          else { assert.equal(fa, fb, code); assert.equal(gaps, undefined, code); }
        }
      }
    }
  }
  assert.ok(checked > 1000, `checked ${checked}`);
});

test("'fixed' is kept where no cost gap applies", () => {
  const fixed = codes.filter((c) => !affected(c, 'self', ['healthy'])).filter((c) => {
    const t = run(c, BENEFITS[c], { enrollment: 'self', usage: U('healthy') });
    return t && t.firmness === 'fixed';
  });
  assert.ok(fixed.length > 10);
});

test('KX1 and L14: a deductible conflict makes Self Plus One and Family estimated and shows its own note; Self is untouched', () => {
  for (const code of COST_CONFLICT_PLANS) {
    const g = BENEFITS[code].known_gaps.find((x) => x.kind === 'conflict');
    assert.equal(g.affects_cost, true);
    assert.deepEqual(g.enrollments, FAMILY);
    assert.deepEqual(costGaps(BENEFITS[code], 'self'), []);
    for (const scenario of Object.keys(SCENARIOS)) {
      const self = run(code, BENEFITS[code], { enrollment: 'self', usage: U(scenario) });
      assert.deepEqual(self, run(code, without(BENEFITS[code]), { enrollment: 'self', usage: U(scenario) }), `${code} self ${scenario}`);
      for (const enrollment of FAMILY) {
        const usage = U(scenario);
        for (const inputs of [{ usage }, { usage, members: [{ usage }, { usage: U('worst') }] }]) {
          const t = run(code, BENEFITS[code], { enrollment, ...inputs });
          assert.equal(t.firmness, 'estimated', `${code} ${enrollment} ${scenario}`);
          assert.equal(t.breakdown.gaps.length, 1);
          const note = gapNote(t.breakdown.gaps[0]);
          assert.match(note, /^The brochure contradicts itself about the Self Plus One and Self and Family deductible: .+ \(Brochure 73-\d+, page \d+\.\)$/);
          assert.doesNotMatch(note, /Not included/);
          assert.match(note, /the estimate uses the shared \$[\d,]+ deductible, so .*too high by up to \$[\d,]+/);
        }
      }
    }
  }
  assert.match(gapNote(costGaps(BENEFITS.L14, 'family')[0]), /\$3,500 per family unit.*\$1,650 per person.*\(Brochure 73-051, page 26\.\)/);
  assert.match(gapNote(costGaps(BENEFITS.KX1, 'family')[0]), /\$2,000 per person.*\(Brochure 73-776, page 102\.\)/);
});

test('9K4 has no conflict entry: its HDHP pages state the $3,500 individual threshold consistently', () => {
  assert.equal(BENEFITS['9K4'].known_gaps, undefined);
});

test('gapFirmness: the line under the total names what the gaps are', () => {
  const cost = { kind: 'facility_deductible' };
  const conflict = { kind: 'conflict' };
  assert.match(gapFirmness([cost]), /leaves out a cost the plan’s brochure lists/);
  assert.match(gapFirmness([conflict]), /brochure contradicts itself/);
  assert.doesNotMatch(gapFirmness([conflict]), /leaves out/);
  assert.match(gapFirmness([cost, conflict]), /leaves out a cost.*contradicts itself/);
});
