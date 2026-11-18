// A brochure-stated individual deductible threshold inside a shared family deductible (pipeline/individual_deductibles.json,
// benefits.deductible_individual). Aetna HDHP 224, 2027: Self Only $2,000; Self Plus One / Self and Family $4,000, and
// "Once an individual meets a $3,500 deductible under the Self Plus One or Self and Family enrollment" the plan pays for
// that person (brochure 73-828, p15 and p35). Real 2027 data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planTotal, personLimits, deductibleType } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';
import { sharedDeductible, familyDeductibleUse, householdDeductibleNote, memberBlockInput, deductibleHow } from '../../src/ui/math-family.js';
import { personLimitsNote } from '../../src/ui/model.js';
import { buildMatrix, DEDUCTIBLE_TYPE_TEXT } from '../../src/ui/matrix-model.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const RATES = read('rates.json')['2027'];
const BENEFITS = read('benefits.json')['2027'];
const plan = (code, benefits = BENEFITS[code]) => ({ rate: RATES[code], benefits, account: benefits.account_contribution });
const U = (name) => ({ ...SCENARIOS[name], custom: [] });
const run = (code, enrollment, members, benefits) => planTotal(plan(code, benefits), {
  status: 'active', enrollment, usage: U(members[0]), ...(members.length > 1 && { members: members.map((s) => ({ usage: U(s) })) }),
});
const without = (b) => { const { deductible_individual, deductible_individual_source, ...rest } = b; return rest; };

test('224 carries the brochure threshold; its type is individual', () => {
  assert.deepEqual(BENEFITS['224'].deductible_individual, { self_plus_one: 3500, family: 3500 });
  assert.equal(deductibleType(BENEFITS['224']), 'individual');
  assert.equal(deductibleType(without(BENEFITS['224'])), 'aggregate');
  assert.equal(deductibleType(BENEFITS.N61), 'embedded', 'Aetna Direct (same brochure) keeps its own rule');
});

test('personLimits: Self keeps $2,000; Self Plus One and Family use the $3,500 threshold', () => {
  assert.equal(personLimits(BENEFITS['224'], 'self').deductible, 2000);
  for (const e of ['self_plus_one', 'family']) {
    const p = personLimits(BENEFITS['224'], e);
    assert.deepEqual([p.deductible, p.type], [3500, 'individual'], e);
    assert.deepEqual(p.oon, personLimits(without(BENEFITS['224']), e).oon, 'out-of-network limits unchanged');
  }
});

test('224, one sick person on a family enrollment: at most $3,500 of deductible', () => {
  for (const e of ['self_plus_one', 'family']) {
    const t = run('224', e, ['worst']);
    assert.equal(t.breakdown.deductiblePaid, 3500, e);
    assert.equal(t.breakdown.deductible, 3500);
    assert.equal(t.breakdown.enrollmentDeductible, 4000);
    assert.equal(t.breakdown.deductibleType, 'individual');
    assert.ok(run('224', e, ['worst'], without(BENEFITS['224'])).breakdown.deductiblePaid === 4000, 'before: the whole $4,000');
  }
});

test('224, two or four sick people: each at most $3,500, together at most $4,000', () => {
  for (const people of [['worst', 'worst'], ['worst', 'worst', 'worst', 'worst'], ['condition', 'worst'], ['typical', 'typical']]) {
    const t = run('224', 'family', people);
    const each = t.breakdown.members.map((m) => m.deductiblePaid);
    assert.ok(each.every((d) => d <= 3500 + 1e-9), `${people}: ${each}`);
    assert.ok(t.breakdown.deductiblePaid <= 4000 + 1e-9, `${people}: ${t.breakdown.deductiblePaid}`);
    assert.equal(t.breakdown.familyDeductible, 4000);
  }
  const two = run('224', 'family', ['worst', 'worst']).breakdown.members.map((m) => m.deductiblePaid);
  assert.deepEqual(two, [3500, 500]);
});

test('224 Self results are unchanged by the threshold (only the plan-level type label differs)', () => {
  for (const s of Object.keys(SCENARIOS)) {
    const a = run('224', 'self', [s]);
    const b = run('224', 'self', [s], without(BENEFITS['224']));
    assert.equal(a.breakdown.deductibleType, 'individual');
    assert.equal(b.breakdown.deductibleType, 'aggregate');
    assert.deepEqual({ ...a, breakdown: { ...a.breakdown, deductibleType: null } }, { ...b, breakdown: { ...b.breakdown, deductibleType: null } }, s);
    assert.equal(deductibleHow(a.breakdown, {}), 'of $2,000');
    assert.equal(personLimitsNote(a.breakdown), '');
  }
});

test('a threshold applies only to an HDHP-shaped enrollment that lists it; an empty or partial one is ignored', () => {
  const b = { ...without(BENEFITS['224']), deductible_individual: { family: 3500 } };
  assert.equal(personLimits(b, 'family').deductible, 3500);
  assert.equal(personLimits(b, 'self_plus_one').deductible, 4000, 'no amount for this enrollment: the shared deductible');
  assert.equal(deductibleType({ ...without(BENEFITS['224']), deductible_individual: {} }), 'aggregate');
});

test('See the math: per-person deductible, family bar of $4,000, notes name the threshold', () => {
  const one = run('224', 'family', ['worst']).breakdown;
  assert.match(personLimitsNote(one), /stops at \$3,500 of the \$4,000 family deductible/);
  assert.match(personLimitsNote(one), /brochure/);
  assert.equal(deductibleHow(one, {}), 'individual stops at $3,500 of the family’s $4,000');
  const fam = run('224', 'family', ['worst', 'worst']).breakdown;
  assert.equal(sharedDeductible(fam), false);
  assert.deepEqual(familyDeductibleUse(fam), { used: 4000, limit: 4000 });
  assert.match(householdDeductibleNote(fam), /stops at \$3,500.*family’s \$4,000/);
  const m1 = memberBlockInput(fam, 1);
  assert.equal(m1.before, 0);
  assert.equal(m1.familyDedMet, true);
  assert.equal(deductibleHow(m1.b, m1), 'individual stops at $3,500 of the family’s $4,000');
  // other types keep their wording
  assert.equal(deductibleHow({ deductible: 1000, onePerson: true, deductibleType: 'embedded' }, {}), 'of $1,000 (one person)');
  assert.equal(deductibleHow({ deductible: 4000, deductibleType: 'aggregate' }, { shared: true }), 'of $4,000 (shared by the family)');
});

test('the matrix row says the brochure states the threshold', () => {
  assert.ok(DEDUCTIBLE_TYPE_TEXT.individual);
  const m = buildMatrix(['224', 'B61'].map((code) => ({ code, benefits: BENEFITS[code] })), { enrollment: 'family' });
  const row = m.find((s) => s.id === 'account').rows.find((r) => r.key === 'calc:deductibleType');
  assert.deepEqual(row.cells.map((c) => c.display), ['Individual threshold (brochure)', 'Aggregate (shared)']);
  assert.match(DEDUCTIBLE_TYPE_TEXT.individual.note, /brochure/);
});

test('About and README state the brochure rule with Aetna 224 as the example, and the contradicting brochures', () => {
  for (const f of ['src/ui/about.js', 'README.md']) {
    const t = fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.match(t, /Aetna[^.]*\$3,500 of (its|the) \$4,000/, f);
    assert.match(t, /one or more family members/, f);
    assert.match(t, /TakeCare[^.]*Kaiser Permanente Washington[^.]*contradict/, f);
    assert.match(t, /Where a plan[’']s brochure does not state it, (this tool|the app) assumes/, f);
  }
});
