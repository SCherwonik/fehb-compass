// GLP-1 filter state field + the filter itself in the results model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeState, encodeState, decodeState, defaultState, DEFAULT_STATE } from '../src/state.js';
import { computeRows, filtersActive, rankWithMine } from '../src/ui/model.js';
import { setBrochureFacts, glp1Covered } from '../src/ui/rx-model.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const DATA = { plans: read('plans.json'), rates: read('rates.json'), benefits: read('benefits.json'), serviceArea: read('service_area.json') };
const FACTS = read('brochure_facts.json');
setBrochureFacts(FACTS);

test('glp1: default false, only literal true survives sanitize', () => {
  assert.equal(DEFAULT_STATE.glp1, false);
  assert.equal(defaultState().glp1, false);
  assert.equal(sanitizeState({ glp1: true }).glp1, true);
  for (const v of ['true', 1, 'yes', {}, [], null, undefined]) assert.equal(sanitizeState({ glp1: v }).glp1, false);
});

test('glp1: hash round trip as w=1; default omitted; hostile values ignored', () => {
  assert.equal(encodeState(defaultState()), '');
  const h = encodeState({ ...defaultState(), glp1: true });
  assert.equal(h, 'w=1');
  assert.equal(decodeState(`#${h}`).glp1, true);
  for (const bad of ['#w=0', '#w=true', '#w=%3Cscript%3E', '#w=1x', '#w']) assert.equal(decodeState(bad).glp1, false);
});

test('glp1 filter: rows only for plans whose brochure says GLP-1 weight-loss drugs are covered', () => {
  const data = { ...DATA, brochure: FACTS };
  const st = { ...defaultState(), location: { state: 'VA', zip: null } };
  const all = computeRows(data, st);
  const only = computeRows(data, { ...st, glp1: true });
  assert.ok(only.length > 0 && only.length < all.length);
  assert.ok(only.every((r) => glp1Covered(r.code)));
  assert.equal(only.length, all.filter((r) => glp1Covered(r.code)).length);
  assert.equal(filtersActive({ ...st, glp1: true }), true);
  assert.equal(filtersActive(st), false);
  // facts not loaded yet: the filter cannot apply, so nothing is hidden
  assert.equal(computeRows(DATA, { ...st, glp1: true }).length, all.length);
});

test('glp1 filter: the pinned plan still ranks against every plan in the state', () => {
  const data = { ...DATA, brochure: FACTS };
  const st = { ...defaultState(), location: { state: 'VA', zip: null }, currentPlan2026: '104', glp1: true };
  const rows = computeRows(data, st);
  const res = rankWithMine(data, st, rows);
  assert.equal(res.mineStatus, 'included');
  assert.ok(Number.isInteger(res.mine.globalRank));
  assert.equal(res.filtersOn, true);
});
