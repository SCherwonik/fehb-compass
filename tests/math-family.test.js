// Task 5: the pure pieces of the family "See the math" blocks, and that the numbers they show add up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultState } from '../src/state.js';
import { computeRows } from '../src/ui/model.js';
import { memberBlockInput, memberInNetwork, familyInNetwork, sharedDeductible, assumedHeading, memberAssumed, householdDeductibleNote, labelledByMember, itemWho, familyDeductibleUse, oopNote } from '../src/ui/math-family.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const DATA = { plans: read('plans.json'), rates: read('rates.json'), benefits: read('benefits.json'), serviceArea: read('service_area.json') };
const VA = { ...defaultState(), location: { state: 'VA', zip: null } };
const fam = { ...VA, enrollment: 'family', familySize: 4, scenario: 'worst', others: [
  { name: 'A', scenario: 'worst', overrides: {} }, { name: '', scenario: 'typical', overrides: {} }, { name: 'C', scenario: 'condition', overrides: {} }] };

const B = (type) => ({
  deductibleType: type, deductible: 1000, oopMax: 5000, familyOopMax: 12000, onePerson: false, memberCount: 3,
  members: [
    { oop: 1500, deductiblePaid: 600, oonPaid: 0, notCoveredPaid: 0 },
    { oop: 900, deductiblePaid: 400, oonPaid: 100, notCoveredPaid: 50 },
    { oop: 300, deductiblePaid: 0, oonPaid: 0, notCoveredPaid: 0 },
  ],
});

test('sharedDeductible: aggregate and unknown share, embedded does not', () => {
  assert.equal(sharedDeductible(B('aggregate')), true);
  assert.equal(sharedDeductible(B('unknown')), true);
  assert.equal(sharedDeductible(B('embedded')), false);
});

test('memberBlockInput: embedded member uses only their own deductible use', () => {
  const x = memberBlockInput(B('embedded'), 1);
  assert.equal(x.before, 0);
  assert.equal(x.b.deductiblePaid, 400);
  assert.equal(x.b.oopMax, 5000);
  assert.equal(x.b.onePerson, false);
  assert.equal(x.shared, false);
});

test('memberBlockInput: shared deductible shows what earlier members used, in member order', () => {
  assert.equal(memberBlockInput(B('aggregate'), 0).before, 0);
  assert.equal(memberBlockInput(B('aggregate'), 1).before, 600);
  assert.equal(memberBlockInput(B('aggregate'), 2).before, 1000);
  assert.equal(memberBlockInput(B('aggregate'), 2).shared, true);
});

test('in-network care leaves out out-of-network and not-covered spend', () => {
  assert.equal(memberInNetwork(B('embedded').members[1]), 750);
  assert.equal(familyInNetwork(B('embedded')), 1500 + 750 + 300);
});

test('a family state: member oops sum to the card oop, in-network never over a limit', () => {
  let seen = 0;
  for (const row of computeRows(DATA, fam)) {
    const code = row.code;
    const b = row?.cost.breakdown;
    if (!b?.members) continue;
    seen++;
    assert.ok(Math.abs(b.members.reduce((a, m) => a + m.oop, 0) - row.cost.oop) <= 0.02, code);
    b.members.forEach((m, i) => {
      if (Number.isFinite(b.oopMax)) assert.ok(memberInNetwork(m) <= b.oopMax + 0.01, `${code} member ${i}`);
      const { before } = memberBlockInput(b, i);
      if (Number.isFinite(b.deductible)) assert.ok(before + m.deductiblePaid <= b.deductible + 0.01 || !sharedDeductible(b), code);
    });
    if (b.familyOopMax != null) assert.ok(familyInNetwork(b) <= b.familyOopMax + 0.01, code);
  }
  assert.ok(seen > 10);
});

test('assumedHeading: the one-person text is unchanged', () => {
  assert.equal(assumedHeading('nothing', false), 'Care assumed: none beyond your own costs');
  assert.equal(assumedHeading('typical', false), 'Care assumed for a typical year');
  assert.equal(assumedHeading('condition', true), 'Care assumed for a year managing a condition, fine-tuned');
});

test('memberAssumed: each member gets their own scenario, text and name', () => {
  const s = { ...fam, others: [{ name: 'Jordan', scenario: 'healthy', overrides: {} }, { name: '', scenario: 'nothing', overrides: {} }, { name: 'C', scenario: 'typical', overrides: { pcpVisits: 9 } }] };
  assert.equal(memberAssumed(s, 0).title, 'Care assumed for you: a worst-case year');
  assert.equal(memberAssumed(s, 1).title, 'Care assumed for Jordan: a healthy year');
  assert.equal(memberAssumed(s, 2).title, 'Care assumed for Person 3: none beyond their own costs');
  assert.equal(memberAssumed(s, 3).title, 'Care assumed for C: a typical year, fine-tuned');
  assert.match(memberAssumed(s, 3).text, /9 primary care visits/);
  assert.notEqual(memberAssumed(s, 0).text, memberAssumed(s, 1).text);
});

test('labelledByMember / itemWho name the person each merged row is for', () => {
  const out = labelledByMember(fam, [[{ label: 'x' }], null, [{ label: 'y' }]]);
  assert.deepEqual(out.map((o) => [o.item.label, o.who]), [['x', 'You'], ['y', 'Person 3']]);
  assert.equal(itemWho(fam, { member: 1 }), 'A');
  assert.equal(itemWho(fam, {}), 'You');
});

test('householdDeductibleNote: embedded is per person, the others shared in member order', () => {
  assert.match(householdDeductibleNote({ deductibleType: 'embedded' }), /own deductible/);
  assert.match(householdDeductibleNote({ deductibleType: 'aggregate' }), /shares one deductible/);
  assert.match(householdDeductibleNote({ deductibleType: 'unknown' }), /shares one deductible/);
});

test('no generated scenario sentence reads "a managing"', async () => {
  const { YEAR_TEXT, SCENARIO_LABELS, assumptionChips } = await import('../src/ui/assumptions.js');
  const { defaultState } = await import('../src/state.js');
  for (const k of Object.keys(SCENARIO_LABELS)) {
    const texts = [assumedHeading(k, false), assumedHeading(k, true), assumedHeading(k, false, 'Jo'), assumedHeading(k, true, 'you'),
      ...assumptionChips({ ...defaultState(), scenario: k }).map((c) => c.text),
      ...assumptionChips({ ...defaultState(), enrollment: 'self_plus_one', scenario: k, others: [{ name: '', scenario: k, overrides: {} }] }).map((c) => c.text)];
    for (const t of texts) assert.doesNotMatch(t, /a managing|managing a condition year|worst case year/i, `${k}: ${t}`);
  }
  assert.equal(assumedHeading('condition', false, 'Jo'), 'Care assumed for Jo: a year managing a condition');
  assert.equal(YEAR_TEXT.healthy, 'healthy year');
});

test('memberBlockInput: embedded member after the family deductible was met says so', () => {
  const b = { ...B('embedded'), familyDeductible: 1000 };
  assert.equal(memberBlockInput(b, 0).familyDedMet, false);
  // 600 + 400 = the family's $1,000 after member 2
  assert.equal(memberBlockInput(b, 1).familyDedMet, true);
  assert.equal(memberBlockInput(b, 2).familyDedMet, true);
  assert.equal(memberBlockInput(B('embedded'), 2).familyDedMet, false); // no family deductible given
  assert.equal(memberBlockInput({ ...B('aggregate'), familyDeductible: 1000 }, 2).familyDedMet, false); // shared: its own bar says it
});

test('familyDeductibleUse: embedded counts everyone against the family deductible; shared uses the one pot', () => {
  assert.deepEqual(familyDeductibleUse({ ...B('embedded'), familyDeductible: 2000 }), { used: 1000, limit: 2000 });
  assert.deepEqual(familyDeductibleUse({ ...B('aggregate') }), { used: 1000, limit: 1000 });
  assert.equal(familyDeductibleUse(B('embedded')), null);
});

test('memberBlockInput: a member stopped by the family out-of-pocket max (plan 104, three worst-case people)', () => {
  const s = { ...VA, enrollment: 'family', familySize: 3, scenario: 'worst', others: [
    { name: '', scenario: 'worst', overrides: {} }, { name: '', scenario: 'worst', overrides: {} }] };
  const row = computeRows(DATA, s).find((r) => r.code === '104');
  const b = row.cost.breakdown;
  assert.ok(b.familyOopMax > 0);
  assert.ok(Math.abs(familyInNetwork(b) - b.familyOopMax) < 0.5, `${familyInNetwork(b)} vs ${b.familyOopMax}`);
  const third = memberBlockInput(b, 2);
  assert.ok(memberInNetwork(b.members[2]) < b.oopMax - 0.5);
  assert.equal(third.familyCapped, true);
  assert.equal(memberBlockInput(b, 0).familyCapped, false);
  assert.match(oopNote({ ...third.b }, memberInNetwork(b.members[2]), false, third), /^Stopped by the family’s out-of-pocket max: the family reached \$14,000/);
  assert.match(oopNote({ ...memberBlockInput(b, 0).b }, memberInNetwork(b.members[0]), true, {}), /^Capped/);
});
