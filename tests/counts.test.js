import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countsByFamily, groupCurrentPlanOptions, availablePlans, computeRows } from '../src/ui/model.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const plans = load('plans.json');
const serviceArea = load('service_area.json');
const p26 = plans.filter((p) => p.year === 2026);
const p27 = plans.filter((p) => p.year === 2027);
const asObj = (r) => Object.fromEntries(r.families.map((f) => [f.name, f.count]));

test('VA family counts match the data and sum to 35', () => {
  const r = countsByFamily(p27, serviceArea, { state: 'VA' });
  assert.equal(r.scope, 'state');
  assert.equal(r.total, 35);
  assert.equal(r.families.reduce((n, f) => n + f.count, 0), 35);
  assert.deepEqual(asObj(r), {
    Aetna: 8, 'Blue Cross': 6, GEHA: 5, Other: 4, UnitedHealthcare: 3, 'Kaiser Permanente': 3, 'Compass Rose Health Plan': 2, SAMBA: 2, 'APWU Health Plan': 2,
    ...Object.fromEntries(r.families.filter((f) => f.count === 0).map((f) => [f.name, 0])),
  });
});

test('zero-count families are kept, listed last', () => {
  const r = countsByFamily(p27, serviceArea, { state: 'VA' });
  const names = r.families.map((f) => f.name);
  assert.equal(names.length, new Set(p27.map((p) => p.network_family || 'Other')).size);
  const firstZero = r.families.findIndex((f) => f.count === 0);
  assert.ok(firstZero > 0);
  assert.ok(r.families.slice(firstZero).every((f) => f.count === 0));
  assert.ok(r.families.slice(0, firstZero).every((f) => f.count > 0));
});

test('state change updates counts; no state counts nationwide plans', () => {
  const va = countsByFamily(p27, serviceArea, { state: 'VA' });
  const none = countsByFamily(p27, serviceArea, { state: null });
  const ca = countsByFamily(p27, serviceArea, { state: 'CA' });
  assert.equal(none.scope, 'nationwide');
  const nationwide = p27.filter((p) => serviceArea[p.code]?.nationwide).length;
  assert.equal(none.total, nationwide);
  assert.equal(none.families.reduce((n, f) => n + f.count, 0), nationwide);
  assert.notDeepEqual(asObj(va), asObj(ca));
  assert.notDeepEqual(asObj(va), asObj(none));
  assert.ok(va.total >= none.total);
  // The old bug showed all-plans counts (Kaiser 28) regardless of state.
  assert.equal(asObj(va)['Kaiser Permanente'], 3);
  assert.ok(asObj(none)['Kaiser Permanente'] < 3);
});

test('account filter narrows counts; sum equals the filtered plan count', () => {
  const all = countsByFamily(p27, serviceArea, { state: 'VA' });
  const hsa = countsByFamily(p27, serviceArea, { state: 'VA', account: 'hsa' });
  const hra = countsByFamily(p27, serviceArea, { state: 'VA', account: 'hra' });
  assert.equal(hsa.total, availablePlans(p27, serviceArea, 'VA').filter((p) => p.hsa).length);
  assert.equal(hra.total, availablePlans(p27, serviceArea, 'VA').filter((p) => p.hra).length);
  assert.ok(hsa.total < all.total);
  assert.equal(hsa.families.reduce((n, f) => n + f.count, 0), hsa.total);
});

test('counts agree with the plans the results list actually shows', () => {
  const data = { plans, serviceArea, rates: load('rates.json'), benefits: load('benefits.json') };
  for (const account of ['any', 'hsa', 'hra']) {
    const r = countsByFamily(p27, serviceArea, { state: 'VA', account });
    const rows = computeRows(data, { location: { state: 'VA' }, networks: [], account, enrollment: 'self', status: 'active', scenario: 'typical' });
    assert.equal(rows.length, r.total, account);
    for (const f of r.families) {
      assert.equal(rows.filter((x) => (x.plan.network_family || 'Other') === f.name).length, f.count, `${account} ${f.name}`);
    }
  }
});

test('2026 picker groups for VA', () => {
  const g = groupCurrentPlanOptions(p26, p27, serviceArea, 'VA', 'Virginia');
  assert.equal(g.mode, 'state');
  const [avail, other] = g.groups;
  assert.equal(avail.label, 'Available in Virginia (continuing into 2027)');
  assert.equal(other.label, 'Other 2026 plans (not matched to Virginia in 2027)');
  const codes27 = new Set(p27.map((p) => p.code));
  const vaCodes = new Set(availablePlans(p27, serviceArea, 'VA').map((p) => p.code));
  const expectedAvail = p26.filter((p) => vaCodes.has(p.code)).map((p) => p.code).sort();
  assert.deepEqual(avail.options.map((o) => o.code).sort(), expectedAvail);
  assert.ok(avail.options.every((o) => o.continues));
  assert.equal(avail.options.length + other.options.length, p26.length);
  const ended = p26.filter((p) => !codes27.has(p.code)).map((p) => p.code);
  assert.ok(ended.length > 0);
  for (const c of ended) {
    const o = other.options.find((x) => x.code === c);
    assert.ok(o, `ended plan ${c} is in Other`);
    assert.equal(o.continues, false);
  }
  assert.ok(!avail.options.some((o) => ended.includes(o.code)));
  // sorted by name
  const names = avail.options.map((o) => o.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('2026 picker with no state: Continuing / Ended', () => {
  const g = groupCurrentPlanOptions(p26, p27, serviceArea, null);
  assert.equal(g.mode, 'all');
  assert.deepEqual(g.groups.map((x) => x.label), ['Continuing in 2027', 'Ended']);
  const codes27 = new Set(p27.map((p) => p.code));
  assert.ok(g.groups[0].options.every((o) => codes27.has(o.code) && o.continues));
  assert.ok(g.groups[1].options.every((o) => !codes27.has(o.code) && !o.continues));
  assert.equal(g.groups[0].options.length + g.groups[1].options.length, p26.length);
});
