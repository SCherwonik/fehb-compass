import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeHash, decodeState, sanitizeState, defaultState, memberCount } from '../src/state.js';
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
  assert.deepEqual(back, s);
  assert.equal(back.others[0].name, s.others[0].name);
  assert.equal(back.custom[0].member, 2);
});

test('default-valued entry keeps its position', () => {
  const s = sanitizeState({
    ...defaultState(), enrollment: 'family',
    others: [{ name: '', scenario: 'typical', overrides: {} }, { name: 'Al', scenario: 'worst', overrides: {} }],
  });
  assert.deepEqual(decodeState(encodeHash(s).hash).others, s.others);
});

test('fs omitted at 4 and when not family', () => {
  assert.ok(!/fs=/.test(encodeHash(sanitizeState({ ...defaultState(), enrollment: 'family' })).hash));
  assert.ok(!/fs=/.test(encodeHash(sanitizeState({ ...defaultState(), familySize: 6 })).hash));
  assert.match(encodeHash(sanitizeState({ ...defaultState(), enrollment: 'family', familySize: 6 })).hash, /fs=6/);
});

test('legacy hash decodes to a one-person year', () => {
  const s = decodeState('e=f&sc=w&o=h3');
  assert.deepEqual(s.others, []);
  assert.equal(s.familySize, 4);
  assert.equal(s.enrollment, 'family');
  for (const l of s.custom) assert.ok(!('member' in l));
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
