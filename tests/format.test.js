import test from 'node:test';
import assert from 'node:assert/strict';
import { usd, usdExact, signedUsd, signedPct } from '../src/ui/format.js';

test('negative zero never renders as "-$0"', () => {
  assert.equal(usd(-0), '$0');
  assert.equal(usd(-0.4), '$0'); // rounds to -0
  assert.equal(usdExact(-0), '$0');
  assert.equal(signedUsd(-0), '$0');
  assert.equal(signedUsd(-0.3), '$0');
  assert.equal(signedPct(-0), '0%');
});

test('money formatting: whole dollars, real minus sign, missing as em dash', () => {
  assert.equal(usd(1943.76), '$1,944');
  assert.equal(usd(-900), '−$900');
  assert.equal(usd(null), '—');
  assert.equal(usd(NaN), '—');
  assert.equal(usdExact(7.5), '$7.50');
  assert.equal(signedUsd(260), '+$260');
  assert.equal(signedUsd(-120), '−$120');
});
