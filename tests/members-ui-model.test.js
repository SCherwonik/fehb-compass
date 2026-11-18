// Task 4: pure helpers behind the "Covered people" inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../src/state.js';
import { OVERRIDE_FIELDS, SCENARIOS } from '../src/engine/scenarios.js';
import {
  withOther, memberPatch, sameOptionValues, memberLabel, memberOptions, memberView, nextOverrides, setFocusedMember, focusedMember, memberKey,
} from '../src/ui/members-model.js';

const fam = (extra = {}) => ({ ...defaultState(), enrollment: 'family', familySize: 4, ...extra });

test('withOther pads with defaults up to the index and never drops later entries', () => {
  const later = [{ name: 'a', scenario: 'worst', overrides: {} }, { name: 'b', scenario: 'healthy', overrides: {} }, { name: 'c', scenario: 'condition', overrides: {} }];
  const a = withOther([], 2, { scenario: 'worst' });
  assert.equal(a.length, 3);
  assert.deepEqual(a[0], { name: '', scenario: 'typical', overrides: {} });
  assert.equal(a[2].scenario, 'worst');
  const b = withOther(later, 0, { name: 'Sam' });
  assert.equal(b.length, 3);
  assert.equal(b[0].name, 'Sam');
  assert.equal(b[2].name, 'c');
  assert.equal(later[0].name, 'a', 'input is not mutated');
});

test('withOther ignores an index past the largest household', () => {
  assert.equal(withOther([], 9, { name: 'x' }).length, 7);
});

test('memberPatch writes you to scenario/overrides and the rest to others', () => {
  const s = fam();
  assert.deepEqual(memberPatch(s, 0, { scenario: 'worst' }), { scenario: 'worst' });
  const p = memberPatch(s, 3, { scenario: 'worst' });
  assert.equal(p.others.length, 3);
  assert.equal(p.others[2].scenario, 'worst');
});

test('labels and options', () => {
  const s = fam({ others: [{ name: ' Mia ', scenario: 'typical', overrides: {} }, { name: '', scenario: 'typical', overrides: {} }] });
  assert.equal(memberLabel(s, 0), 'You');
  assert.equal(memberLabel(s, 1), 'Mia');
  assert.equal(memberLabel(s, 2), 'Person 3');
  assert.equal(memberLabel(s, 3), 'Person 4');
  assert.deepEqual(memberOptions(s).map((o) => o[0]), ['0', '1', '2', '3']);
  assert.equal(memberOptions({ ...s, enrollment: 'self' }).length, 1);
  assert.notEqual(memberKey(s), memberKey({ ...s, familySize: 5 }));
});

test('memberView falls back to defaults for a member not set up', () => {
  const s = fam({ scenario: 'worst' });
  assert.equal(memberView(s, 0).scenario, 'worst');
  assert.equal(memberView(s, 2).scenario, 'typical');
});

test('nextOverrides drops a value equal to the scenario and clamps', () => {
  const f = OVERRIDE_FIELDS.pcpVisits;
  const up = nextOverrides('typical', {}, 'pcpVisits', f.max + 50, f);
  assert.equal(up.pcpVisits, f.max);
  const base = SCENARIOS.typical.pcpVisits;
  assert.equal(nextOverrides('typical', up, 'pcpVisits', base, f).pcpVisits, undefined);
  assert.equal(nextOverrides('typical', {}, 'pcpVisits', base + 1, f).pcpVisits, base + 1);
});

test('focused member is clamped to the household', () => {
  setFocusedMember(6);
  assert.equal(focusedMember(fam()), 3);
  assert.equal(focusedMember(defaultState()), 0);
  setFocusedMember(0);
});

test('isUncovered: a member beyond the count is uncovered in every enrollment', async () => {
  const { isUncovered, memberOfItem } = await import('../src/ui/members-model.js');
  assert.equal(memberOfItem({}), 0);
  assert.equal(isUncovered({}, 1), false, 'you are always covered');
  assert.equal(isUncovered({ member: 3 }, 4), false);
  assert.equal(isUncovered({ member: 3 }, 3), true);
  assert.equal(isUncovered({ member: 1 }, 1), true, 'Self: a line for another person is out');
  assert.equal(isUncovered({ member: 1 }, 2), false);
});

test('isUncovered: a non-integer, negative or non-numeric member counts as you (covered)', async () => {
  const { isUncovered, memberOfItem } = await import('../src/ui/members-model.js');
  for (const member of [1.5, -2, NaN, '2', null, undefined, Infinity]) {
    assert.equal(memberOfItem({ member }), 0, String(member));
    assert.equal(isUncovered({ member }, 1), false, String(member));
  }
  assert.equal(isUncovered(null, 1), false);
});

test('focusedMember outside a family: clamped to the people covered, even if a later row was open', () => {
  setFocusedMember(5);
  assert.equal(focusedMember(defaultState()), 0, 'Self');
  assert.equal(focusedMember({ ...defaultState(), enrollment: 'self_plus_one' }), 1);
  setFocusedMember(-1);
  assert.equal(focusedMember(fam()), 0, 'a negative index is you');
  setFocusedMember(2.5);
  assert.equal(focusedMember(fam()), 0, 'a non-integer index is you');
  setFocusedMember(0);
});

test('memberKey changes with a name (and ignores everything else)', () => {
  const named = (name) => fam({ others: [{ name, scenario: 'typical', overrides: {} }] });
  assert.notEqual(memberKey(named('Mia')), memberKey(named('Mi')));
  assert.notEqual(memberKey(named('Mia')), memberKey(named('')));
  assert.equal(memberKey(named('  Mia ')), memberKey(named('Mia')), 'labels are trimmed');
  assert.equal(memberKey(named('Mia')), memberKey({ ...named('Mia'), scenario: 'worst' }));
});

test('sameOptionValues: relabelling keeps the picker, adding or reordering people rebuilds it', () => {
  const a = memberOptions(fam({ others: [{ name: 'Mi', scenario: 'typical', overrides: {} }] }));
  const b = memberOptions(fam({ others: [{ name: 'Mia', scenario: 'typical', overrides: {} }] }));
  assert.notDeepEqual(a, b);
  assert.equal(sameOptionValues(a, b), true);
  assert.equal(sameOptionValues(a, a.slice(1)), false);
  assert.equal(sameOptionValues([['0', 'x'], ['1', 'y']], [['1', 'y'], ['0', 'x']]), false);
});
