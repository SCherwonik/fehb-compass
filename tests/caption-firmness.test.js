// The words beside a card's total and its firmness tag tell the truth together: "estimated" whenever the total is
// estimated (also with the dental/vision add-on), and the "Fixed cost" tip says why the total is fixed (no care at all,
// or every service a flat copay).
import test from 'node:test';
import assert from 'node:assert/strict';
import { totalLabelOf } from '../src/ui/board-model.js';
import { fixedTitle } from '../src/ui/math-family.js';

const dv = (dental, vision) => ({ total: (dental ?? 0) + (vision ?? 0), ...(dental != null && { dental: { amount: dental } }), ...(vision != null && { vision: { amount: vision } }) });

test('with the dental/vision add-on the caption keeps "estimated" and the add-on label', () => {
  assert.equal(totalLabelOf({ cost: { firmness: 'estimated' }, dv: dv(300, 100) }), 'per year, estimated, incl. dental/vision');
  assert.equal(totalLabelOf({ cost: { firmness: 'estimated' }, dv: dv(300) }), 'per year, estimated, incl. dental');
  assert.equal(totalLabelOf({ cost: { firmness: 'fixed' }, dv: dv(null, 100) }), 'per year, incl. vision');
  assert.equal(totalLabelOf({ cost: { firmness: 'estimated' } }), 'per year, estimated');
  assert.equal(totalLabelOf({ cost: { firmness: 'fixed' } }), 'per year');
  const meds = { cost: { firmness: 'estimated' }, dv: dv(300, 100), meds: { entries: [{}] } };
  assert.equal(totalLabelOf(meds, false, true), 'per year, estimated, incl. dental/vision, excl. meds');
});

test('"Fixed cost" tip: no care assumed vs every service a flat copay', () => {
  const none = { services: [], drugs: [], custom: [] };
  assert.equal(fixedTitle(none), 'No care is assumed in this scenario, so no cost sharing applies and this total does not depend on assumed prices.');
  assert.equal(fixedTitle({ services: [{ count: 0 }], drugs: [], custom: [] }), fixedTitle(none));
  const visits = { services: [{ service: 'primary_care', count: 1 }], drugs: [], custom: [] };
  assert.equal(fixedTitle(visits), 'Every service in this scenario is a flat copay, so this total does not depend on assumed prices.');
  assert.equal(fixedTitle({ services: [], drugs: [{ fillsPerYear: 12 }], custom: [] }), fixedTitle(visits));
  assert.equal(fixedTitle({ services: [], drugs: [], custom: [{ kind: 'pcp' }] }), fixedTitle(visits));
  assert.equal(fixedTitle(undefined), fixedTitle(visits)); // unknown: the general sentence
});
