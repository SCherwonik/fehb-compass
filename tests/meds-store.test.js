// "My medications": private list in localStorage only. Hostile input and blocked storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMedsStore, sanitizeMeds, sanitizeDrug, sanitizeName, sanitizeRecord, MEDS_KEY, MAX_DRUGS, MAX_NAME,
} from '../src/ui/meds-store.js';
import { encodeState, defaultState } from '../src/state.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };

test('sanitizeName: strips markup characters and control chars, collapses space, caps length', () => {
  assert.equal(sanitizeName('  Metformin   ER '), 'Metformin ER');
  assert.equal(sanitizeName('<img src=x onerror=alert(1)>Ozempic'), 'img src=x onerror=alert(1)Ozempic');
  assert.ok(!/[<>]/.test(sanitizeName('<script>alert(1)</script>')));
  assert.equal(sanitizeName('a\u0000b\u202Ec'), 'abc');
  assert.equal(sanitizeName('x'.repeat(10_000)).length, MAX_NAME);
  for (const bad of ['', '   ', '<>', null, undefined, 42, {}, []]) assert.equal(sanitizeName(bad), null);
});

test('sanitizeDrug: defaults, ranges and channels', () => {
  const d = sanitizeDrug({ id: 'abc123', name: 'Lipitor' });
  assert.deepEqual(d, { id: 'abc123', name: 'Lipitor', monthlyCost: null, fillsPerYear: 12, channel: 'retail30' });
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', monthlyCost: '120.5' }).monthlyCost, 120.5);
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', monthlyCost: -5 }).monthlyCost, null);
  // a 90-day price of $100 is stored as a 30-day price and must convert back to the cent (x3 -> $100.00)
  const third = sanitizeDrug({ id: 'a', name: 'X', monthlyCost: 100 / 3 }).monthlyCost;
  assert.equal(Math.round(third * 3 * 100) / 100, 100);
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', monthlyCost: 1e9 }).monthlyCost, null);
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', monthlyCost: NaN }).monthlyCost, null);
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', fillsPerYear: 4 }).fillsPerYear, 4);
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', fillsPerYear: 0 }).fillsPerYear, 12);
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', fillsPerYear: 400 }).fillsPerYear, 12);
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', channel: 'mail' }).channel, 'mail');
  assert.equal(sanitizeDrug({ id: 'a', name: 'X', channel: '__proto__' }).channel, 'retail30');
  assert.equal(sanitizeDrug({ id: '__proto__', name: 'X' }), null);
  assert.equal(sanitizeDrug({ id: 'a', name: '' }), null);
  assert.equal(sanitizeDrug(null), null);
});

test('sanitizeRecord: nc, pa, or a short tier name', () => {
  assert.equal(sanitizeRecord('nc'), 'nc');
  assert.equal(sanitizeRecord('pa'), 'pa');
  assert.equal(sanitizeRecord('Tier 2'), 'Tier 2');
  assert.equal(sanitizeRecord(3), 'Tier 3');
  assert.equal(sanitizeRecord(9), null);
  assert.equal(sanitizeRecord('x'.repeat(200)), null);
  assert.equal(sanitizeRecord('<b>'), null);
  assert.equal(sanitizeRecord(''), null);
  assert.equal(sanitizeRecord({}), null);
});

test('sanitizeMeds: hostile shapes, __proto__ keys, too many drugs, orphan records', () => {
  const hostile = JSON.parse('{"drugs":[{"id":"a1","name":"A"},{"id":"a1","name":"dup"},{"id":"b2","name":"<b>B</b>"}],'
    + '"records":{"__proto__":{"a1":"Tier 1"},"104":{"a1":"Tier 2","zz":"nc","__proto__":"pa","b2":"<x>"},"bad code!":{"a1":"nc"}}}');
  const m = sanitizeMeds(hostile);
  assert.deepEqual(m.drugs.map((d) => d.id), ['a1', 'b2']);
  assert.equal(m.drugs[1].name, 'bB/b');
  assert.deepEqual(Object.keys(m.records), ['104']);
  assert.deepEqual({ ...m.records['104'] }, { a1: 'Tier 2' });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(m.records), Object.prototype);
  const many = { drugs: Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, name: `Drug ${i}` })) };
  assert.equal(sanitizeMeds(many).drugs.length, MAX_DRUGS);
  for (const v of [null, 'x', 42, [], { drugs: 'no' }, { drugs: [null, 1, 'a'] }]) assert.deepEqual(sanitizeMeds(v), { drugs: [], records: {} });
});

test('store: add / update / remove / record persist to localStorage only, never the URL hash', () => {
  const storage = memStorage();
  const s = createMedsStore({ storage });
  assert.equal(s.persistent, true);
  const seen = [];
  s.subscribe((v) => seen.push(v.drugs.length));
  const a = s.add({ name: 'Metformin', monthlyCost: 10 });
  const b = s.add({ name: 'Eliquis', monthlyCost: 550, channel: 'mail', fillsPerYear: 4 });
  assert.ok(a && b && a.id !== b.id);
  s.record('104', a.id, 'Tier 1');
  s.record('104', b.id, 'nc');
  s.update(b.id, { name: 'Eliquis 5mg' });
  assert.equal(s.get().drugs[1].name, 'Eliquis 5mg');
  const saved = JSON.parse(storage.m.get(MEDS_KEY));
  assert.equal(saved.drugs.length, 2);
  assert.equal(saved.records['104'][b.id], 'nc');
  // a fresh store reads it back
  assert.equal(createMedsStore({ storage }).get().drugs.length, 2);
  s.remove(a.id);
  assert.equal(s.get().drugs.length, 1);
  assert.equal(s.get().records['104'][a.id], undefined, 'records of a removed drug go too');
  s.record('104', b.id, null);
  assert.equal(s.get().records['104'], undefined);
  assert.ok(seen.length >= 6);
  // the shareable hash never carries medications
  assert.ok(!/Eliquis|Metformin/.test(encodeState({ ...defaultState(), meds: s.get() })));
});

test('store: max 15 drugs, invalid adds rejected, hostile record keys ignored', () => {
  const s = createMedsStore({ storage: memStorage() });
  for (let i = 0; i < 20; i++) s.add({ name: `Drug ${i}` });
  assert.equal(s.get().drugs.length, MAX_DRUGS);
  assert.equal(s.add({ name: 'one more' }), null);
  const t = createMedsStore({ storage: memStorage() });
  assert.equal(t.add({ name: '<>' }), null);
  const d = t.add({ name: 'Ok' });
  t.record('__proto__', d.id, 'nc');
  t.record('104', '__proto__', 'nc');
  t.record('104', 'nope', 'nc');
  assert.deepEqual(t.get().records, {});
});

test('store: localStorage unavailable -> works in memory and says it is not persistent', () => {
  const s = createMedsStore({ storage: throwing });
  assert.equal(s.persistent, false);
  const d = s.add({ name: 'Insulin' });
  assert.ok(d);
  s.record('104', d.id, 'Tier 2');
  assert.equal(s.get().records['104'][d.id], 'Tier 2');
  const n = createMedsStore({ storage: null });
  assert.equal(n.persistent, false);
  assert.deepEqual(n.get(), { drugs: [], records: {} });
  // corrupted JSON in storage
  const bad = memStorage();
  bad.setItem(MEDS_KEY, '{not json');
  assert.deepEqual(createMedsStore({ storage: bad }).get(), { drugs: [], records: {} });
});

test('store: facts status and top plans are shared but not persisted', () => {
  const storage = memStorage();
  const s = createMedsStore({ storage });
  assert.equal(s.factsStatus(), 'loading');
  s.setFacts({ plans: {} });
  assert.equal(s.factsStatus(), 'ready');
  s.setFacts(null);
  assert.equal(s.factsStatus(), 'missing');
  s.setTop([{ code: '104', name: 'Blue', rank: 1 }]);
  assert.equal(s.top().length, 1);
  assert.ok(!storage.m.has('fehb-compass:top'));
  assert.ok(!/104/.test(storage.m.get(MEDS_KEY) ?? ''));
});
