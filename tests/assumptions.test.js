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

test('customSummary: count and yearly spend recomputed from the lines themselves', async () => {
  const { customSummary } = await import('../src/ui/assumptions.js');
  assert.equal(customSummary([]), '0 of 25 lines');
  const one = [{ label: '', kind: 'specialist', price: 250, perYear: 1 }];
  assert.equal(customSummary(one), '1 of 25 lines, $250 a year');
  assert.equal(customSummary([{ ...one[0], price: 300 }]), '1 of 25 lines, $300 a year', 'an edited price changes the total');
  assert.equal(customSummary([one[0], { label: '', kind: 'lab', price: 100, perYear: 4 }]), '2 of 25 lines, $650 a year');
});

test('assumptionChips: a link that lost lines gets a dismissible warning chip, without duplicated text', () => {
  const chips = assumptionChips({ ...defaultState(), droppedCustom: 2 });
  const c = chips.find((x) => x.id === 'dropped');
  assert.equal(c.text, '2 lines not in link');
  assert.equal(c.tone, 'warn');
  assert.equal(c.dismissible, true);
  assert.equal(c.title, 'This link had 2 more custom lines that couldn’t be included in the link.');
  assert.equal(assumptionChips(defaultState()).some((x) => x.id === 'dropped'), false);
});

test('inNetworkAtMax compares only the in-network part with the in-network OOP max', async () => {
  const { inNetworkAtMax } = await import('../src/ui/assumptions.js');
  const cost = (oop, oonPaid, oopMax) => ({ oop, breakdown: { oonPaid, oopMax } });
  assert.equal(inNetworkAtMax(cost(5000, 0, 5000)), true);
  assert.equal(inNetworkAtMax(cost(5000, 1000, 5000)), false, 'OON spend does not fake a capped in-network total');
  assert.equal(inNetworkAtMax(cost(6000, 1000, 5000)), true);
  assert.equal(inNetworkAtMax(cost(100, 0, null)), false);
});

test('assumptionChips: a household says who, mixes are noted, and only covered lines are counted', () => {
  const fam = (extra) => ({ ...defaultState(), enrollment: 'family', familySize: 3, ...extra });
  const t = { name: '', scenario: 'typical', overrides: {} };
  const same = assumptionChips(fam({ others: [t, t] }));
  assert.equal(same[0].text, '3 people, Typical year each');
  const mixed = assumptionChips(fam({ others: [{ ...t, name: 'Sam', scenario: 'worst' }, t] }));
  assert.equal(mixed[0].text, '3 people, mixed scenarios');
  assert.match(mixed[0].title, /You: Typical year\./);
  assert.match(mixed[0].title, /Sam: Worst case year\./);
  const adj = assumptionChips(fam({ others: [{ ...t, name: 'Sam', overrides: { erVisits: 2 } }, t] }));
  assert.deepEqual(adj.map((c) => c.text), ['3 people, Typical year each', '2 ER visits (Sam)']);
  const line = (member) => ({ label: 'x', kind: 'lab', price: 100, perYear: 2, member });
  const custom = [line(0), line(2), line(5)];
  const c = assumptionChips(fam({ others: [t, t], custom })).find((x) => x.id === 'custom');
  assert.equal(c.text, '2 custom lines');
  assert.match(c.title, /\$400/);
  const selfChips = assumptionChips({ ...defaultState(), custom });
  assert.equal(selfChips.find((x) => x.id === 'custom').text, '1 custom line', 'Self counts only your own lines');
  const oon = [{ ...line(4), outOfNetwork: true }];
  assert.equal(assumptionChips(fam({ others: [t, t], custom: oon })).some((x) => x.id === 'oon'), false);
});
