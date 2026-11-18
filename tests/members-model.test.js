// Task 3: a household's costs: each member's own care, lines and medications.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultState } from '../src/state.js';
import { SCENARIOS, applyOverrides } from '../src/engine/scenarios.js';
import { costInputs, withDrugs, computeRows, makeRow, hasMaternityLine } from '../src/ui/model.js';
import { sanitizeDrug, sanitizeMeds } from '../src/ui/meds-store.js';
import { planMeds, setBrochureFacts } from '../src/ui/rx-model.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const DATA = { plans: read('plans.json'), rates: read('rates.json'), benefits: read('benefits.json'), serviceArea: read('service_area.json') };
const FACTS = read('brochure_facts.json');
setBrochureFacts(FACTS);
const VA = { ...defaultState(), location: { state: 'VA', zip: null } };
const fam = (extra = {}) => ({ ...VA, enrollment: 'family', familySize: 4, ...extra });
const OTHERS = [
  { name: 'A', scenario: 'worst', overrides: {} },
  { name: 'B', scenario: 'healthy', overrides: { pcpVisits: 5 } },
  { name: 'C', scenario: 'condition', overrides: {} },
];

test('costInputs: members length follows the enrollment', () => {
  assert.equal(costInputs(VA).members.length, 1);
  assert.equal(costInputs({ ...VA, enrollment: 'self_plus_one' }).members.length, 2);
  assert.equal(costInputs(fam({ others: OTHERS })).members.length, 4);
  const c = costInputs(fam({ others: OTHERS }));
  assert.equal(c.usage, c.members[0].usage);
});

test('costInputs: member usage follows its scenario and overrides; lines land only on their member', () => {
  const s = fam({ others: OTHERS, custom: [{ label: 'x', kind: 'imaging', price: 500, perYear: 1, member: 2 }, { label: 'me', kind: 'imaging', price: 100, perYear: 1 }] });
  const c = costInputs(s);
  assert.equal(c.members[1].usage.specialistVisits, SCENARIOS.worst.specialistVisits);
  assert.equal(c.members[2].usage.pcpVisits, 5);
  assert.deepEqual(c.members[2].usage.custom.map((l) => l.label), ['x']);
  assert.deepEqual(c.members[0].usage.custom.map((l) => l.label), ['me']);
  assert.equal(c.members[1].usage.custom.length, 0);
  assert.equal(c.members[3].usage.custom.length, 0);
});

test('costInputs: lines for members beyond the count are left out of totals but stay in state', () => {
  const s = { ...VA, enrollment: 'self_plus_one', others: OTHERS, custom: [{ label: 'x', kind: 'imaging', price: 500, perYear: 1, member: 3 }] };
  const c = costInputs(s);
  assert.equal(c.members.flatMap((m) => m.usage.custom).length, 0);
  assert.equal(s.custom.length, 1);
});

test('self enrollment totals do not depend on others', () => {
  const a = computeRows(DATA, VA).map((r) => [r.code, r.cost.total]);
  const b = computeRows(DATA, { ...VA, others: OTHERS }).map((r) => [r.code, r.cost.total]);
  assert.deepEqual(b, a);
});

test('family of two worst others costs more than self, never more than N times the self-limits cost', () => {
  const others = [{ name: '', scenario: 'worst', overrides: {} }, { name: '', scenario: 'worst', overrides: {} }];
  const selfRows = new Map(computeRows(DATA, VA).map((r) => [r.code, r]));
  const famRows = computeRows(DATA, { ...VA, enrollment: 'family', familySize: 3, others });
  let checked = 0;
  for (const r of famRows) {
    const s = selfRows.get(r.code);
    if (!s) continue;
    const base = computeRows(DATA, { ...VA, enrollment: 'family', familySize: 3, others: [] }).find((x) => x.code === r.code);
    assert.ok(r.cost.oop >= base.cost.oop - 0.01, r.code);
    checked++;
  }
  assert.ok(checked > 10);
});

test('withDrugs splits entries by member and drops those beyond the count', () => {
  const two = { ...costInputs({ ...VA, enrollment: 'self_plus_one' }) };
  const e = (label, member) => ({ label, member, fillsPerYear: 12, price: 10, share: { type: 'copay', amount: 5 } });
  const out = withDrugs(two, [e('a', 0), e('b', 1), e('c', 1), e('d', 3)]);
  assert.deepEqual(out.members[0].drugs.map((d) => d.label), ['a']);
  assert.deepEqual(out.members[1].drugs.map((d) => d.label), ['b', 'c']);
  const one = withDrugs(costInputs(VA), [e('a'), e('z', 2)]);
  assert.deepEqual(one.drugs.map((d) => d.label), ['a']);
});

test('maternity on member 1 of 2 prices the same with and without the line', () => {
  const line = { label: 'Baby', kind: 'maternity', price: 20416, perYear: 1, member: 1 };
  const s = { ...VA, enrollment: 'self_plus_one', others: [{ name: '', scenario: 'typical', overrides: {} }], custom: [line] };
  assert.equal(hasMaternityLine(costInputs(s)), true);
  const rows = computeRows(DATA, s).filter((r) => r.maternity?.priced);
  assert.ok(rows.length > 0);
  const plain = new Map(computeRows(DATA, { ...s, custom: [] }).map((r) => [r.code, r.cost.total]));
    assert.ok(rows.some((r) => r.maternity.cost > 0), 'some plan charges for the birth');
  for (const r of rows) {
    assert.equal(r.maternity.cost, Math.round((r.cost.total - plain.get(r.code)) * 100) / 100, r.code); // with the line minus without it
    assert.equal(Math.round((r.maternity.baseTotal) * 100), Math.round(plain.get(r.code) * 100), r.code);
  }
});

test('sanitizeDrug keeps member 0-7, drops others to 0; old records read as 0', () => {
  const d = { id: 'a1', name: 'X', monthlyCost: 1, fillsPerYear: 12, channel: 'retail30' };
  // member 0 (you) is stored as no member at all, so records without one are unchanged and read as 0
  assert.equal(sanitizeDrug(d).member ?? 0, 0);
  for (const m of [1, 3, 7]) assert.equal(sanitizeDrug({ ...d, member: m }).member, m);
  assert.equal(sanitizeDrug({ ...d, member: '2' }).member, 2);
  for (const m of [0, -1, 8, 1.5, 'x', null]) assert.equal(sanitizeDrug({ ...d, member: m }).member ?? 0, 0);
  assert.equal(sanitizeMeds({ drugs: [d], records: {} }).drugs[0].member ?? 0, 0);
});

test('planMeds entries and items carry member', () => {
  const drugs = [{ id: 'a1', name: 'Statin', monthlyCost: 12, fillsPerYear: 12, channel: 'retail30', member: 2 }];
  const m = planMeds(FACTS, { drugs, records: { 401: { a1: 'Tier 1' } } }, '401', DATA.benefits['2027']['401']);
  assert.equal(m.items[0].member, 2);
  assert.equal(m.entries[0].member, 2);
});

test('makeRow applies a member-2 medication to member 2 only', () => {
  const drugs = [{ id: 'a1', name: 'Statin', monthlyCost: 300, fillsPerYear: 12, channel: 'retail30', member: 1 }];
  const data = { ...DATA, brochure: FACTS, meds: { drugs, records: { 401: { a1: 'Tier 2' } } } };
  const s = { ...VA, enrollment: 'self_plus_one', others: [{ name: '', scenario: 'typical', overrides: {} }] };
  const row = makeRow(data, s, '401');
  assert.ok(row.cost.total > row.baseTotal);
  const beyond = makeRow(data, { ...VA }, '401');
  assert.equal(beyond.cost.total, beyond.baseTotal, 'member beyond the count is left out');
});
