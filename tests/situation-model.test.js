import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryChips, startExpanded, situationOpen, parseOpenPrefs, tabGroup } from '../src/ui/situation-model.js';
import { defaultState, encodeState, STORAGE_KEY } from '../src/state.js';

const texts = (chips) => chips.map((c) => c.text);

test('summary chips: defaults say who, that no state is chosen, and the scenario', () => {
  const chips = summaryChips(defaultState());
  assert.deepEqual(texts(chips), ['Self only, active employee', 'No state chosen', 'Typical year']);
  assert.equal(chips[1].tone, 'warn');
});

test('summary chips: medical inputs read as plain chips, medications only as a count', () => {
  const s = {
    ...defaultState(), status: 'retiree', enrollment: 'family', location: { state: 'VA', zip: '22030' },
    scenario: 'worst', currentPlan2026: '104', includeMine: true, account: 'hsa', networks: ['Aetna', 'Kaiser'],
    glp1: true, dental: true, custom: [{ label: 'Physio', kind: 'therapy', price: 120, perYear: 12 }],
  };
  const chips = summaryChips(s, { planName: (c) => (c === '104' ? 'Blue Cross Basic' : null), medsCount: 2 });
  assert.deepEqual(texts(chips), [
    'Self and family, retiree', 'Virginia, ZIP 22030', 'Worst case, adjusted', '2026 plan: Blue Cross Basic',
    'Includes my plan’s 2027 version', 'HSA plans only', '2 networks', 'Covers GLP-1 for weight loss',
    'Dental and vision added', '2 medications',
  ]);
  assert.equal(chips.find((c) => c.id === 'networks').title, 'Aetna, Kaiser');
  assert.equal(summaryChips({ ...s, networks: ['Aetna'] }).find((c) => c.id === 'networks').text, 'Network: Aetna');
  assert.equal(summaryChips({ ...s, currentPlan2026: '104' }).find((c) => c.id === 'plan').text, '2026 plan: 104');
  assert.equal(summaryChips({ ...s, includeMine: false }).some((c) => c.id === 'mine'), false);
  assert.equal(summaryChips(s, { medsCount: 1 }).at(-1).text, '1 medication');
});

test('summary chips: the dental and vision tabs show their own inputs, never the medical ones', () => {
  const s = { ...defaultState(), tab: 'dental', dentalUse: 'major', scenario: 'worst', networks: ['Aetna'], myDental: '02AP-11-Standard', location: { state: 'VA', zip: '22030' } };
  const chips = summaryChips(s, {
    medsCount: 3,
    dvFilter: { carriers: ['Delta Dental'], area: 'regional', oon: true, in2: true },
    dvPlanName: (id) => (id === '02AP-11-Standard' ? 'Aetna Dental Standard' : null),
  });
  const t = texts(chips);
  assert.ok(t[2].startsWith('Dental: '));
  assert.ok(t.includes('2026 plan: Aetna Dental Standard'));
  assert.ok(t.includes('Carrier: Delta Dental'));
  assert.ok(t.includes('Regional plans only'));
  assert.ok(t.includes('Pays out of network'));
  assert.ok(t.includes('Second network tier'));
  assert.ok(!t.some((x) => /Worst|network:|Network:|medication/.test(x)));
  // vision: no second-tier chip (a dental-only filter), its own usage label
  const v = texts(summaryChips({ ...s, tab: 'vision' }, { dvFilter: { carriers: ['A', 'B'], in2: true } }));
  assert.ok(v[2].startsWith('Vision: '));
  assert.ok(v.includes('2 carriers'));
  assert.ok(!v.includes('Second network tier'));
});

test('startExpanded: open on a first visit, closed with link or saved state', () => {
  assert.equal(startExpanded({}), true);
  assert.equal(startExpanded({ hash: '', stored: null }), true);
  assert.equal(startExpanded({ hash: '#garbage' }), true); // nothing the app understands
  assert.equal(startExpanded({ hash: '#st=VA' }), false);
  assert.equal(startExpanded({ hash: '', stored: JSON.stringify(defaultState()) }), true); // only defaults saved
  assert.equal(startExpanded({ hash: '', stored: JSON.stringify({ ...defaultState(), enrollment: 'family' }) }), false);
  assert.equal(startExpanded({ hash: '', stored: '{not json' }), true);
  assert.equal(typeof STORAGE_KEY, 'string');
  assert.equal(encodeState(defaultState()), '');
});

test('situationOpen: a remembered choice per main tab wins over the default', () => {
  assert.equal(tabGroup('medical'), 'medical');
  assert.equal(tabGroup('dental'), 'dv');
  assert.equal(tabGroup('vision'), 'dv');
  assert.deepEqual(parseOpenPrefs('{"medical":false,"dv":true,"x":1,"__proto__":true}'), { medical: false, dv: true });
  assert.deepEqual(parseOpenPrefs('nope'), {});
  assert.deepEqual(parseOpenPrefs(null), {});
  assert.deepEqual(parseOpenPrefs('[true]'), {});
  assert.equal(situationOpen({ tab: 'medical', remembered: { medical: true }, hash: '#st=VA' }), true);
  assert.equal(situationOpen({ tab: 'vision', remembered: { medical: true, dv: false } }), false);
  assert.equal(situationOpen({ tab: 'dental', remembered: { medical: false } }), true); // first visit default
  assert.equal(situationOpen({ tab: 'dental', remembered: {}, hash: '#e=f' }), false);
  assert.equal(situationOpen({ tab: 'medical', remembered: {}, fallback: false }), false);
});
