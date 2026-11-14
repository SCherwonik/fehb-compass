// I6: the Postal Service (PSHB) and Medicare notices: wording, and dismissals that survive junk storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTICES, NOTICES_KEY, parseDismissed, isDismissed, dismiss } from '../src/ui/notices.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('the notes say who is not covered and what the retiree estimates assume', () => {
  assert.match(NOTICES.pshb.text, /^FEHB only: Postal Service employees and annuitants use PSHB/);
  assert.match(NOTICES.pshb.text, /does not cover/);
  assert.match(NOTICES.medicare.text, /^Estimates assume you are not relying on Medicare/);
  assert.match(NOTICES.medicare.text, /With Medicare/);
});

test('dismissals persist per note and ignore malformed storage', () => {
  const s = mem();
  assert.equal(isDismissed('pshb', s), false);
  assert.equal(dismiss('pshb', s), true);
  assert.equal(isDismissed('pshb', s), true);
  assert.equal(isDismissed('medicare', s), false);
  dismiss('medicare', s);
  assert.deepEqual(JSON.parse(s.m.get(NOTICES_KEY)), { pshb: true, medicare: true });
  for (const junk of ['nope', '[1]', 'null', '{"pshb":"yes","x":true}']) assert.deepEqual(parseDismissed(junk), {});
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.equal(isDismissed('pshb', broken), false);
  assert.equal(dismiss('pshb', broken), false);
});
