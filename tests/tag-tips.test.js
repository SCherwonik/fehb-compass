// The card's warning tags say why, from the 2026 and 2027 figures the flag was computed from (engine/diff.js). The tip
// is shown by a disclosure button (keyboard and touch) and is the button's accessible description.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flagTip } from '../src/ui/board-model.js';
import { diffPlan } from '../src/engine/diff.js';

const row = (before, after) => ({ facts2026: before, facts: after, diff: diffPlan(before, after) });

test('premium up 10% or more: both yearly premiums and the change', () => {
  const r = row({ premium: 2000, deductible: 500, oopMax: 6000, coinsurance: 20 }, { premium: 2300, deductible: 500, oopMax: 6000, coinsurance: 20 });
  assert.deepEqual(r.diff.flags, ['premium_up_10']);
  assert.equal(flagTip('premium_up_10', r), 'Your yearly premium goes from $2,000 in 2026 to $2,300 in 2027 (+15%), from OPM’s rate files.');
});

test('out-of-pocket max rose with no premium cut: both maximums and both premiums', () => {
  const r = row({ premium: 2000, deductible: 500, oopMax: 6000, coinsurance: 20 }, { premium: 2000, deductible: 500, oopMax: 7000, coinsurance: 20 });
  assert.deepEqual(r.diff.flags, ['oop_up_no_premium_cut']);
  assert.equal(flagTip('oop_up_no_premium_cut', r),
    'The out-of-pocket max goes from $6,000 in 2026 to $7,000 in 2027, and the yearly premium did not go down ($2,000 in 2026, $2,000 in 2027).');
});

test('deductible and coinsurance up: both years', () => {
  const r = row({ premium: 2000, deductible: 500, oopMax: 6000, coinsurance: 20 }, { premium: 1900, deductible: 750, oopMax: 6000, coinsurance: 25 });
  assert.deepEqual(r.diff.flags, ['deductible_up', 'coinsurance_up']);
  assert.equal(flagTip('deductible_up', r), 'The deductible goes from $500 in 2026 to $750 in 2027.');
  assert.equal(flagTip('coinsurance_up', r), 'Coinsurance goes from 20% in 2026 to 25% in 2027.');
});

test('no tip when a figure is missing or the flag is unknown (never an invented reason)', () => {
  const r = row({ premium: 2000, deductible: 500, oopMax: 6000, coinsurance: 20 }, { premium: 2300, deductible: 500, oopMax: 6000, coinsurance: 20 });
  assert.equal(flagTip('premium_up_10', { ...r, facts2026: null }), null);
  assert.equal(flagTip('something_else', r), null);
  assert.equal(flagTip('deductible_up', { ...r, facts: { ...r.facts, deductible: null } }), null);
});
