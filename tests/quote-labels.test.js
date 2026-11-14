// Minor: 19% of brochure quotes were matched by token overlap (paraphrases), not verbatim. Citations say which:
// exact quotes are shown in quotation marks, overlap matches as "Paraphrased from p.N" without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { citation, quoted } from '../src/ui/rx-model.js';

const FACTS = JSON.parse(fs.readFileSync(new URL('../data/brochure_facts.json', import.meta.url), 'utf8'));

test('citation: exact matches are quotes, overlap matches are paraphrases', () => {
  const ex = citation({ page: 106, quote: 'Tier 1 (generic drug): $7.50 copayment', match: 'exact' }, '104', FACTS);
  assert.equal(ex.paraphrased, false);
  assert.equal(ex.label, 'Brochure p.106');
  assert.equal(quoted(ex), '“Tier 1 (generic drug): $7.50 copayment”');
  const ov = citation({ page: 85, quote: 'Anti-obesity medications, network pharmacy', match: 'overlap' }, '454', FACTS);
  assert.equal(ov.paraphrased, true);
  assert.equal(ov.label, 'Paraphrased from brochure p.85');
  assert.equal(quoted(ov), 'Anti-obesity medications, network pharmacy (paraphrased)');
  assert.doesNotMatch(quoted(ov), /[“”]/);
});

test('real data: every overlap fact of plan 454 cites as a paraphrase', () => {
  const t = FACTS.plans['454'].rx.tiers.find((x) => x.retail_30?.match === 'overlap');
  assert.equal(citation(t.retail_30, '454', FACTS).paraphrased, true);
});
