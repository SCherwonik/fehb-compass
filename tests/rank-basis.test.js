// I3: medications are priced only on plans where the user recorded tiers, so ranking by a total that includes
// them pushes exactly those plans down. Plans are ranked on the total WITHOUT medications unless every shown plan
// has every drug priced; medications are then shown as their own figure, and "not looked up" (never $0) where none
// is priced. Real 2027 data and brochure facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultState } from '../src/state.js';
import { computeRows, sortRows, rankWithMine, savingsVsCurrent, medsRanked, rankTotal, baseTotal, dvCost } from '../src/ui/model.js';
import { MEDICAL_SECTIONS, boardContext, sectionsFor, whyLine } from '../src/ui/board-model.js';
import { setBrochureFacts } from '../src/ui/rx-model.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const BASE = { plans: read('plans.json'), rates: read('rates.json'), benefits: read('benefits.json'), serviceArea: read('service_area.json') };
const FACTS = read('brochure_facts.json');
setBrochureFacts(FACTS);
const DRUGS = [
  { id: 'a1', name: 'Generic statin', monthlyCost: 12, fillsPerYear: 12, channel: 'retail30' },
  { id: 'b2', name: 'Brand inhaler', monthlyCost: 300, fillsPerYear: 12, channel: 'retail30' },
];
const RECORDS = { 104: { a1: 'Tier 1', b2: 'Tier 2' }, 401: { a1: 'Tier 1', b2: 'Tier 2' }, V41: { a1: 'Tier 1', b2: 'Tier 2' } };
const withMeds = { ...BASE, brochure: FACTS, meds: { drugs: DRUGS, records: RECORDS } };
const noMeds = { ...BASE, brochure: FACTS };
const VA = { ...defaultState(), location: { state: 'VA', zip: null } };
const codes = (rows) => rows.map((r) => r.code);

test('tiers recorded on some plans only: the ranking is the same as without medications', () => {
  const a = sortRows(computeRows(noMeds, VA), 'total');
  const b = sortRows(computeRows(withMeds, VA), 'total');
  assert.ok(b.find((r) => r.code === '401').meds.entries.length === 2);
  assert.equal(medsRanked(b), false);
  assert.deepEqual(codes(b), codes(a));
  const ra = rankWithMine(noMeds, { ...VA, currentPlan2026: '401' }, computeRows(noMeds, VA));
  const rb = rankWithMine(withMeds, { ...VA, currentPlan2026: '401' }, computeRows(withMeds, VA));
  assert.equal(rb.mine.globalRank, ra.mine.globalRank, '401 keeps its rank');
  assert.equal(rb.medsInRank, false);
});

test('every shown plan has every drug priced: medications join the ranking', () => {
  const rows = computeRows(withMeds, VA).filter((r) => ['104', '401', 'V41'].includes(r.code));
  assert.equal(medsRanked(rows), true);
  const sorted = sortRows(rows, 'total');
  const byFull = rows.slice().sort((x, y) => x.cost.total - y.cost.total);
  assert.deepEqual(codes(sorted), codes(byFull));
  for (const r of rows) {
    assert.equal(rankTotal(r, true), r.cost.total);
    assert.equal(Math.round(rankTotal(r, false) * 100), Math.round((baseTotal(r) + dvCost(r)) * 100));
  }
});

test('savings banner: medications not looked up are null (said as "not looked up"), never $0', () => {
  const st = { ...VA, currentPlan2026: '111' }; // 111 has no recorded tiers
  const v = savingsVsCurrent(withMeds, st, computeRows(withMeds, st));
  assert.equal(v.kind, 'continuing');
  assert.equal(v.basis, 'excl-meds');
  assert.equal(v.currentMeds, null);
  if (!v.best.meds?.entries?.length) assert.equal(v.bestMeds, null);
  const st2 = { ...VA, currentPlan2026: '104' };
  const v2 = savingsVsCurrent(withMeds, st2, computeRows(withMeds, st2));
  assert.ok(v2.currentMeds > 0);
});

test('board: totals and the #1 gap use the ranking basis; a plan with priced meds shows them apart', () => {
  const st = { ...VA };
  const res = rankWithMine(withMeds, st, computeRows(withMeds, st));
  const ctx = boardContext(res.ranked, st);
  assert.equal(ctx.withMeds, false);
  const cell = sectionsFor(MEDICAL_SECTIONS, ctx).find((s) => s.key === 'cost').rows.find((r) => r.key === 'total').cell;
  const r104 = res.ranked.find((r) => r.code === '104');
  const c = cell(r104, ctx);
  assert.equal(c.value, rankTotal(r104, false));
  assert.match(c.sub, /\+ \$[\d,]+ meds not in total/);
  const other = res.ranked.find((r) => !r.meds?.entries?.length);
  assert.match(cell(other, ctx).sub, /meds not looked up/);
  const top = res.ranked[0];
  const second = res.ranked[1];
  const gap = Math.round(rankTotal(second, false) - rankTotal(top, false));
  assert.match(whyLine(top, res.ranked.slice(0, 3), ctx), new RegExp(`\\$${gap.toLocaleString('en-US')} less than #2`));
});
