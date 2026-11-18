// Plans whose brochure does not state a per-person out-of-pocket limit (pipeline/known_gaps.json, kind 'cap_not_stated').
// The estimate caps each person at the plan's own Self Only maximum (the app's stated assumption); "See the math" says
// so for Self Plus One and Self and Family. No total and no firmness changes. Real 2027 data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planTotal, costGaps, capNotes } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';
import { gapNote } from '../../src/ui/math-family.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const RATES = read('rates.json')['2027'];
const BENEFITS = read('benefits.json')['2027'];
// plan -> its Self Only out-of-pocket maximum
const ENROLLMENT_ONLY = { 421: 6000, 424: 9000, W51: 2500, A81: 7000, P81: 7000, A84: 6000, P84: 6000, RE1: 9500, YZ1: 9500, YJ1: 8100 };
const PER_PERSON_PRINTED = { EA1: 3500, YJ4: 3000, '8W4': 6000 };
const ALL = { ...ENROLLMENT_ONLY, ...PER_PERSON_PRINTED };
const U = (name) => ({ ...SCENARIOS[name], custom: [] });
const without = (b) => { const { known_gaps, ...rest } = b; return rest; };
const run = (code, benefits, inputs) => planTotal({ rate: RATES[code], benefits, account: benefits.account_contribution }, { status: 'active', ...inputs });

test('the 13 plans carry a cap_not_stated note for Self Plus One and Self and Family only', () => {
  const tagged = Object.keys(BENEFITS).filter((c) => (BENEFITS[c].known_gaps ?? []).some((g) => g.kind === 'cap_not_stated'));
  assert.deepEqual(tagged.sort(), Object.keys(ALL).sort());
  for (const [code, amount] of Object.entries(ALL)) {
    assert.deepEqual(capNotes(BENEFITS[code], 'self'), [], code);
    for (const e of ['self_plus_one', 'family']) {
      const notes = capNotes(BENEFITS[code], e);
      assert.equal(notes.length, 1, `${code} ${e}`);
      const text = gapNote(notes[0]);
      assert.match(text, new RegExp(`Self Only limit of \\$${amount.toLocaleString('en-US')}\\. \\(Brochure 7\\d-\\d+, page \\d+\\.\\)$`), code);
      assert.doesNotMatch(text, /Not included/);
    }
    assert.deepEqual(costGaps(BENEFITS[code], 'family'), [], `${code}: not a cost gap`);
  }
  for (const code of Object.keys(ENROLLMENT_ONLY)) {
    assert.match(capNotes(BENEFITS[code], 'family')[0].text, /^This plan’s brochure gives out-of-pocket limits only for the whole enrollment/);
  }
  for (const code of Object.keys(PER_PERSON_PRINTED)) {
    assert.match(capNotes(BENEFITS[code], 'family')[0].text, /^This plan’s brochure prints “per person” next to its Self Plus One/);
  }
});

test('Kaiser Hawaii 631 and 634 state the per-person amount: no note', () => {
  for (const code of ['631', '634']) for (const e of ['self', 'self_plus_one', 'family']) assert.deepEqual(capNotes(BENEFITS[code], e), []);
});

test('the notes change no total, breakdown or firmness, in any scenario or enrollment', () => {
  for (const code of Object.keys(ALL)) {
    for (const scenario of Object.keys(SCENARIOS)) {
      for (const enrollment of ['self', 'self_plus_one', 'family']) {
        const usage = U(scenario);
        for (const members of [undefined, enrollment === 'self' ? undefined : [{ usage }, { usage: U('worst') }]]) {
          const inputs = { enrollment, usage, ...(members && { members }) };
          assert.deepEqual(run(code, BENEFITS[code], inputs), run(code, without(BENEFITS[code]), inputs), `${code} ${scenario} ${enrollment}`);
        }
      }
    }
  }
});

test('capNotes ignores other kinds and malformed entries', () => {
  assert.deepEqual(capNotes({}, 'family'), []);
  assert.deepEqual(capNotes({ known_gaps: [null, { kind: 'conflict', affects_cost: false, text: 't' }] }, 'family'), []);
  const g = { kind: 'cap_not_stated', affects_cost: false, text: 't', brochure: 'b', page: 1 };
  assert.equal(capNotes({ known_gaps: [g] }, 'family').length, 1, 'no enrollments list: every family enrollment');
  assert.deepEqual(capNotes({ known_gaps: [g] }, 'self'), [], 'never Self');
  assert.deepEqual(capNotes({ known_gaps: [{ ...g, enrollments: ['family'] }] }, 'self_plus_one'), []);
});
