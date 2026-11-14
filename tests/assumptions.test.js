import test from 'node:test';
import assert from 'node:assert/strict';
import { describeUsage, effectiveUsage, overrideChanges, assumptionChips, SCENARIO_LABELS } from '../src/ui/assumptions.js';
import { SCENARIOS } from '../src/engine/scenarios.js';
import { defaultState } from '../src/state.js';

test('describeUsage: plain language, empty year says so', () => {
  assert.equal(describeUsage(SCENARIOS.typical),
    '3 primary care visits, 2 specialist visits, 3 lab tests, 1 imaging scan, 1 monthly generic prescription.');
  assert.equal(describeUsage(SCENARIOS.nothing), 'No care assumed beyond what you add.');
  assert.equal(describeUsage({ ...SCENARIOS.nothing, hospitalStays: 1 }), '1 hospital stay.');
});

test('effectiveUsage and overrideChanges only report real differences', () => {
  const s = { ...defaultState(), scenario: 'typical', overrides: { hospitalStays: 3, pcpVisits: 3 } };
  assert.equal(effectiveUsage(s).hospitalStays, 3);
  assert.deepEqual(overrideChanges(s).map((c) => [c.key, c.from, c.to]), [['hospitalStays', 0, 3]]);
  assert.deepEqual(overrideChanges(defaultState()), []);
});

test('assumptionChips: scenario, changes, custom lines and out-of-network', () => {
  assert.deepEqual(assumptionChips(defaultState()).map((c) => c.text), ['Typical year']);
  const s = {
    ...defaultState(),
    scenario: 'nothing',
    overrides: { erVisits: 2 },
    custom: [
      { label: 'PT', kind: 'therapy', price: 100, perYear: 10 },
      { label: 'Dr', kind: 'specialist', price: 300, perYear: 1, outOfNetwork: true },
    ],
  };
  const chips = assumptionChips(s);
  assert.deepEqual(chips.map((c) => c.text), ['Only your own costs', '2 ER visits', '2 custom lines', 'Out-of-network estimate']);
  assert.equal(chips.at(-1).tone, 'warn');
  assert.match(chips[2].title, /\$1,300/);
  const many = assumptionChips({ ...defaultState(), overrides: { erVisits: 2, hospitalStays: 1, pcpVisits: 9 } });
  assert.deepEqual(many.map((c) => c.text), ['Typical year', '3 adjustments']);
  for (const k of Object.keys(SCENARIOS)) assert.ok(SCENARIO_LABELS[k], k);
});
