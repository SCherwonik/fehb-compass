import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeHash, decodeState, sanitizeState, defaultState, memberCount, loadInitialState, STORAGE_KEY, HASH_BUDGET } from '../src/state.js';
import { sanitizeLine } from '../src/engine/scenarios.js';

test('memberCount: self 1, self_plus_one 2, family uses familySize', () => {
  assert.equal(memberCount({ enrollment: 'self', familySize: 6 }), 1);
  assert.equal(memberCount({ enrollment: 'self_plus_one', familySize: 6 }), 2);
  assert.equal(memberCount({ enrollment: 'family', familySize: 6 }), 6);
});

test('defaults: familySize 4, others [], hash empty', () => {
  const d = defaultState();
  assert.equal(d.familySize, 4);
  assert.deepEqual(d.others, []);
  assert.equal(encodeHash(d).hash, '');
});

test('round trip: family, others, line member', () => {
  const s = sanitizeState({
    ...defaultState(),
    enrollment: 'family',
    familySize: 5,
    others: [
      { name: 'Jo_n & <b>', scenario: 'worst', overrides: { hospitalStays: 2 } },
      { name: '', scenario: 'healthy', overrides: {} },
    ],
    custom: [{ label: 'Braces', kind: 'other', price: 100, perYear: 3, member: 2 }],
  });
  const back = decodeState(encodeHash(s).hash);
  // the two people not set up yet come back as explicit Typical entries (the same costing as no entry)
  assert.deepEqual(back, { ...s, others: [...s.others, TYPICAL, TYPICAL] });
  assert.equal(back.others[0].name, s.others[0].name);
  assert.equal(back.custom[0].member, 2);
});

test('default-valued entry keeps its position', () => {
  const s = sanitizeState({
    ...defaultState(), enrollment: 'family',
    others: [{ name: '', scenario: 'typical', overrides: {} }, { name: 'Al', scenario: 'worst', overrides: {} }],
  });
  assert.deepEqual(decodeState(encodeHash(s).hash).others, [...s.others, TYPICAL]);
});

test('fs omitted at 4 and when not family', () => {
  assert.ok(!/fs=/.test(encodeHash(sanitizeState({ ...defaultState(), enrollment: 'family' })).hash));
  assert.ok(!/fs=/.test(encodeHash(sanitizeState({ ...defaultState(), familySize: 6 })).hash));
  assert.match(encodeHash(sanitizeState({ ...defaultState(), enrollment: 'family', familySize: 6 })).hash, /fs=6/);
});

const NONE = { name: '', scenario: 'nothing', overrides: {} };
const TYPICAL = { name: '', scenario: 'typical', overrides: {} };

test('legacy hash (no mb at all): the other people are assumed to have no care, so the old total stands', () => {
  const s = decodeState('e=f&sc=w&o=h3');
  assert.deepEqual(s.others, [NONE, NONE, NONE]);
  assert.equal(s.familySize, 4);
  assert.equal(s.enrollment, 'family');
  assert.equal(s.scenario, 'worst');
  assert.deepEqual(s.overrides, { hospitalStays: 3 });
  for (const l of s.custom) assert.ok(!('member' in l));
  assert.deepEqual(decodeState('e=1&sc=c').others, [NONE]);
  assert.deepEqual(decodeState('e=f&fs=6').others, [NONE, NONE, NONE, NONE, NONE]);
  // Self links are untouched
  assert.deepEqual(decodeState('sc=w').others, []);
  // re-encoded, it carries explicit mb entries and is no longer legacy
  const again = decodeState(encodeHash(s).hash);
  assert.deepEqual(again, s);
  assert.equal(new URLSearchParams(encodeHash(s).hash).getAll('mb').length, 3);
});

test('a fresh Family choice writes explicit Typical members and round-trips with them', () => {
  const s = sanitizeState({ ...defaultState(), enrollment: 'family' });
  assert.deepEqual(s.others, []);
  const hash = encodeHash(s).hash;
  const mb = new URLSearchParams(hash).getAll('mb');
  assert.deepEqual(mb, ['t__', 't__', 't__']);
  for (const e of mb) assert.ok(e.length <= 7);
  assert.deepEqual(decodeState(hash).others, [TYPICAL, TYPICAL, TYPICAL]);
  // Self Plus One with one named other: padded to the one person only
  assert.deepEqual(new URLSearchParams(encodeHash(sanitizeState({ ...defaultState(), enrollment: 'self_plus_one' })).hash).getAll('mb'), ['t__']);
});

test('mb present but every entry malformed: not a legacy link, others default to Typical', () => {
  const s = decodeState('e=f&mb=zz&mb=%');
  assert.deepEqual(s.others, []);
  assert.deepEqual(sanitizeState(s).others, []);
});

test('a legacy link near the hash budget keeps every inline custom line when re-encoded', () => {
  // as many lines as an old link fitted, the last one padded so the link sits exactly at the budget
  const labels = [];
  const build = () => ['e=f&sc=w', ...labels.map((l) => `l=${encodeURIComponent(`z100_2_${l}`)}`)].join('&');
  for (let i = 0; i < 24; i++) {
    labels.push(`${'x'.repeat(50)}${i}`);
    if (build().length + 7 > HASH_BUDGET) { labels.pop(); break; }
  }
  labels[labels.length - 1] += 'y'.repeat(HASH_BUDGET - 7 - build().length);
  const hash = build();
  assert.equal(hash.length + 7, HASH_BUDGET);
  const lines = labels;
  const s = decodeState(hash);
  assert.equal(s.custom.length, lines.length);
  assert.deepEqual(s.others, [NONE, NONE, NONE]);
  const res = encodeHash(s);
  assert.equal(res.overflow.length, 0, 'no line pushed out by the member padding');
  assert.equal(res.inline, lines.length);
  assert.deepEqual(decodeState(res.hash), s);
});

test('saved state from before households (no `others` key) opens with the others on no care', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const old = { ...defaultState(), enrollment: 'family', scenario: 'condition' };
  delete old.others;
  delete old.familySize;
  mem.set(STORAGE_KEY, JSON.stringify(old));
  assert.deepEqual(loadInitialState({ hash: '', storage }).others, [NONE, NONE, NONE]);
  // a record saved by this version keeps its (empty = Typical) others
  mem.set(STORAGE_KEY, JSON.stringify({ ...defaultState(), enrollment: 'family' }));
  assert.deepEqual(loadInitialState({ hash: '', storage }).others, []);
  // an old Self record is untouched
  const selfOld = { ...defaultState() };
  delete selfOld.others;
  mem.set(STORAGE_KEY, JSON.stringify(selfOld));
  assert.deepEqual(loadInitialState({ hash: '', storage }), defaultState());
});

test('sanitize', () => {
  assert.equal(sanitizeState({ familySize: 99 }).familySize, 8);
  assert.equal(sanitizeState({ familySize: 1 }).familySize, 3);
  assert.equal(sanitizeState({ others: Array.from({ length: 12 }, () => ({})) }).others.length, 7);
  assert.equal(sanitizeState({ others: [{ name: 5 }] }).others[0].name, '');
  assert.equal(sanitizeState({ others: [{ scenario: 'bogus' }] }).others[0].scenario, 'typical');
  assert.equal(sanitizeState({ others: [{ name: 'x'.repeat(40) }] }).others[0].name.length, 20);
  const l = { label: 'a', kind: 'other', price: 1, perYear: 1 };
  assert.ok(!('member' in sanitizeLine({ ...l, member: 9 })));
  assert.ok(!('member' in sanitizeLine({ ...l, member: 0 })));
  assert.equal(sanitizeLine({ ...l, member: 3 }).member, 3);
});

test('no medications in the link', () => {
  const s = sanitizeState({ ...defaultState(), enrollment: 'family', others: [{ name: 'A' }], meds: [{ name: 'x' }] });
  assert.ok(!JSON.stringify(encodeHash(s)).includes('meds'));
});

test('mb is written only for members the enrollment covers', () => {
  const others = Array.from({ length: 7 }, (_, i) => ({ name: `P${i}`, scenario: 'worst', overrides: {} }));
  const mb = (enrollment, familySize = 4) =>
    new URLSearchParams(encodeHash(sanitizeState({ ...defaultState(), enrollment, familySize, others })).hash).getAll('mb').length;
  assert.equal(mb('self'), 0);
  assert.equal(mb('self_plus_one'), 1);
  assert.equal(mb('family', 4), 3);
});
