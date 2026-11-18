// The places that describe the year of care: one person reads as before (master), a household covers everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../src/state.js';
import { careCaption, householdCareText, assumptionChips } from '../src/ui/assumptions.js';
import { boardContext, MEDICAL_SECTIONS } from '../src/ui/board-model.js';
import { summaryChips } from '../src/ui/situation-model.js';
import { situationRows } from '../src/ui/print.js';
import { coveredCount } from '../src/ui/members-model.js';

const self = (patch = {}) => ({ ...defaultState(), ...patch });
const fam = (patch = {}) => ({ ...defaultState(), enrollment: 'family', familySize: 3, ...patch });
const line = (member) => ({ label: 'Physio', kind: 'therapy', price: 120, perYear: 2, ...(member ? { member } : {}) });
const oopCell = MEDICAL_SECTIONS.flatMap((s) => s.rows).find((r) => r.key === 'oop');
const boardSub = (state) => oopCell.cell({ cost: { oop: 100 } }, boardContext([], state)).sub;
const scenarioChip = (state) => summaryChips(state).find((c) => c.id === 'scenario').text;
const printCare = (state) => situationRows(state).find(([k]) => k === 'Expected care')[1];

// one person: the card caption for every scenario key, plain and adjusted (fine-tuned or with a custom line)
const SELF_CAPTION = {
  healthy: ['healthy year', 'healthy year, adjusted'],
  typical: ['typical year', 'typical year, adjusted'],
  condition: ['year managing a condition', 'year managing a condition, adjusted'],
  worst: ['worst-case year', 'worst-case year, adjusted'],
  nothing: ['start-from-nothing year', 'your own costs'],
};

for (const [k, [plain, adjusted]] of Object.entries(SELF_CAPTION)) {
  test(`Self card caption, ${k}: "${plain}", then "${adjusted}"`, () => {
    assert.equal(careCaption(self({ scenario: k })), plain);
    assert.equal(careCaption(self({ scenario: k, custom: [line()] })), adjusted);
    assert.equal(careCaption(self({ scenario: k, overrides: { erVisits: 3 } })), adjusted);
    // a line for someone the Self enrollment does not cover is not costed, so it does not adjust the year
    assert.equal(careCaption(self({ scenario: k, custom: [line(2)] })), plain);
  });
}

test('Self Board, situation chip and print summary read as before', () => {
  assert.equal(boardSub(self()), 'typical year');
  assert.equal(boardSub(self({ scenario: 'worst', custom: [line()] })), 'worst-case year, adjusted');
  assert.equal(boardSub(self({ scenario: 'nothing' })), 'your own costs');
  assert.equal(scenarioChip(self({ scenario: 'worst' })), 'Worst case');
  assert.equal(scenarioChip(self({ scenario: 'nothing', custom: [line()] })), 'Only my own costs, adjusted');
  assert.equal(printCare(self({ scenario: 'condition' })), 'Managing a condition');
  assert.equal(printCare(self({ scenario: 'typical', custom: [line(), line()] })), 'Typical year, adjusted (2 cost lines of your own)');
});

test('a household: You on Typical and a child on Worst case is never called a typical year', () => {
  const s = fam({ enrollment: 'self_plus_one', others: [{ name: 'Kid', scenario: 'worst', overrides: {} }] });
  assert.equal(careCaption(s), '2 people, mixed years');
  assert.equal(boardSub(s), '2 people, mixed years');
  assert.equal(scenarioChip(s), '2 people, mixed years');
  assert.equal(printCare(s), '2 people: You, typical year; Kid, worst case');
});

test('a household on one scenario, adjusted, and all on nothing', () => {
  assert.equal(householdCareText(fam()), '3 people, typical year each');
  assert.equal(householdCareText(fam({ others: [{ name: '', scenario: 'typical', overrides: { erVisits: 2 } }] })), '3 people, typical year each, adjusted');
  assert.equal(householdCareText(fam({ custom: [line(2)] })), '3 people, typical year each, adjusted');
  // a line for a fourth person is beyond a family of three: not costed, not an adjustment
  assert.equal(householdCareText(fam({ custom: [line(3)] })), '3 people, typical year each');
  const none = { name: '', scenario: 'nothing', overrides: {} };
  assert.equal(householdCareText(fam({ scenario: 'nothing', others: [none, none] })), '3 people, no assumed care');
  assert.equal(householdCareText(fam({ scenario: 'nothing', others: [none, none], custom: [line(1)] })), '3 people, the household’s own costs');
  assert.equal(printCare(fam({ scenario: 'nothing', others: [none, none], custom: [line(1)] })),
    '3 people: You, no assumed care; Person 2, no assumed care; Person 3, no assumed care (1 cost line of the household’s own)');
});

test('results-header chips: a household all on nothing, and whose custom lines', () => {
  const none = { name: '', scenario: 'nothing', overrides: {} };
  const chips = assumptionChips(fam({ scenario: 'nothing', others: [none, none], custom: [line(1)] }));
  assert.equal(chips[0].text, '3 people, no assumed care');
  assert.match(chips[0].title, /Person 2: No assumed care/);
  assert.match(chips.find((c) => c.id === 'custom').title, /of the household’s own costs/);
  assert.match(assumptionChips(self({ custom: [line()] })).find((c) => c.id === 'custom').title, /of your own costs/);
  assert.equal(assumptionChips(self({ scenario: 'nothing' }))[0].text, 'Only your own costs');
});

test('coveredCount: medications for people beyond the enrollment are not counted', () => {
  const drugs = [{ name: 'a' }, { name: 'b', member: 1 }, { name: 'c', member: 3 }];
  assert.equal(coveredCount(drugs, self()), 1);
  assert.equal(coveredCount(drugs, fam({ enrollment: 'self_plus_one' })), 2);
  assert.equal(coveredCount(drugs, fam()), 2);
  assert.equal(coveredCount(drugs, fam({ familySize: 4 })), 3);
  assert.equal(coveredCount(undefined, self()), 0);
});
