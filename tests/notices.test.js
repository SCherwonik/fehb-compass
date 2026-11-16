// I6: the Medicare note: wording, and dismissals that survive junk storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTICES, NOTICES_KEY, parseDismissed, isDismissed, dismiss } from '../src/ui/notices.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('the note says what the retiree estimates assume', () => {
  assert.match(NOTICES.medicare.text, /^Estimates assume you are not relying on Medicare/);
  assert.match(NOTICES.medicare.text, /With Medicare/);
  assert.equal(NOTICES.pshb, undefined, 'the Postal Service note is gone');
});

test('a dismissal persists and malformed storage counts as nothing dismissed', () => {
  const s = mem();
  assert.equal(isDismissed('medicare', s), false);
  assert.equal(dismiss('medicare', s), true);
  assert.equal(isDismissed('medicare', s), true);
  assert.deepEqual(JSON.parse(s.m.get(NOTICES_KEY)), { medicare: true });
  // an old stored dismissal for the removed Postal Service note is ignored
  assert.deepEqual(parseDismissed('{"pshb":true,"medicare":true}'), { medicare: true });
  for (const junk of ['nope', '[1]', 'null', '{"medicare":"yes","x":true}']) assert.deepEqual(parseDismissed(junk), {});
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.equal(isDismissed('medicare', broken), false);
  assert.equal(dismiss('medicare', broken), false);
});
