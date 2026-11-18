// The card's "Estimated" tag tooltip names the real reason(s): assumed prices, a known gap (a brochure cost left out),
// a brochure that contradicts itself, or a brochure rule the estimate does not model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimatedTitle } from '../src/ui/math-family.js';
import { planTotal } from '../src/engine/cost.js';
import { SCENARIOS } from '../src/engine/scenarios.js';

const PRICES = 'Part of this total depends on assumed prices for care. See the math.';

test('assumed prices only: the old sentence', () => {
  assert.equal(estimatedTitle({ pricesMatter: true }), PRICES);
  assert.equal(estimatedTitle({}), PRICES, 'an older breakdown without the flag');
});

test('a known gap, with or without assumed prices', () => {
  const gap = { kind: 'facility_deductible' };
  assert.equal(estimatedTitle({ pricesMatter: false, gaps: [gap] }),
    'Estimated: this total leaves out a cost the plan’s brochure lists (a known gap). See the math.');
  assert.equal(estimatedTitle({ pricesMatter: true, gaps: [gap] }),
    'Estimated: this total leaves out a cost the plan’s brochure lists (a known gap), and part of it depends on assumed prices for care. See the math.');
});

test('a brochure conflict and a rule the estimate does not model are named as such', () => {
  const t = estimatedTitle({ pricesMatter: false, gaps: [{ kind: 'conflict' }] });
  assert.match(t, /^Estimated: the plan’s brochure contradicts itself about a figure this total uses\. See the math\.$/);
  assert.doesNotMatch(t, /assumed prices|known gap/);
  assert.match(estimatedTitle({ pricesMatter: true, gaps: [{ kind: 'rule_differs' }, { kind: 'drug_deductible' }] }),
    /^Estimated: this total leaves out a cost .*, the plan’s brochure describes a rule this estimate does not model, and part of it depends on assumed prices for care\. See the math\.$/);
});

test('real plans: V31 worst names the gap; KX1 family names the conflict; a coinsurance plan names prices', () => {
  const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
  const RATES = read('rates.json')['2027'];
  const B = read('benefits.json')['2027'];
  const run = (code, enrollment, s) => planTotal({ rate: RATES[code], benefits: B[code] }, { status: 'active', enrollment, usage: { ...SCENARIOS[s], custom: [] } });
  assert.match(estimatedTitle(run('V31', 'self', 'worst').breakdown), /known gap/);
  assert.match(estimatedTitle(run('KX1', 'family', 'healthy').breakdown), /contradicts itself/);
  assert.equal(run('V31', 'self', 'nothing').firmness, 'fixed');
  const kx1Self = run('KX1', 'self', 'worst');
  assert.equal(kx1Self.firmness, 'estimated');
  assert.equal(estimatedTitle(kx1Self.breakdown), PRICES);
});
