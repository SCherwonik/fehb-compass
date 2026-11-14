// "Add dental and vision to my total": the FEDVIP line items join every medical plan's total, rankings do not
// move, and every comparison against a baseline without them (2026, your plan) stays apples to apples.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultState } from '../src/state.js';
import {
  computeRows, rankWithMine, savingsVsCurrent, baseTotal, medsCost, dvCost, basisNote, endedBaseline,
} from '../src/ui/model.js';
import { MEDICAL_SECTIONS, boardContext, sectionsFor, valueScores } from '../src/ui/board-model.js';
import { dvAddOn } from '../src/ui/dv-model.js';
import { setBrochureFacts } from '../src/ui/rx-model.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const FV = read('fedvip.json');
const FACTS = read('brochure_facts.json');
setBrochureFacts(FACTS);
const BASE = { plans: read('plans.json'), rates: read('rates.json'), benefits: read('benefits.json'), serviceArea: read('service_area.json'), brochure: FACTS };
const WITH = { ...BASE, fedvip: FV };
const VA = { ...defaultState(), location: { state: 'VA', zip: '22302' } };
const ON = { ...VA, dental: true, dentalUse: 'major', visionUse: 'glasses' };
const cellOf = (secKey, rowKey, row, ctx) => sectionsFor(MEDICAL_SECTIONS, ctx).find((s) => s.key === secKey).rows.find((r) => r.key === rowKey).cell(row, ctx);

test('dental on: every medical total gains the same dental + vision amount; baseTotal does not', () => {
  const add = dvAddOn(FV, ON);
  assert.ok(add.total > 0 && Number.isFinite(add.dental.amount) && Number.isFinite(add.vision.amount));
  const off = new Map(computeRows(WITH, VA).map((r) => [r.code, r]));
  const on = computeRows(WITH, ON);
  assert.equal(on.length, off.size);
  for (const r of on) {
    const o = off.get(r.code);
    assert.equal(Math.round(r.cost.total * 100), Math.round((o.cost.total + add.total) * 100), r.code);
    assert.equal(baseTotal(r), o.cost.total, r.code);
    assert.equal(dvCost(r), add.total);
    assert.equal(medsCost(r), 0);
    assert.equal(r.dv.dental.id, add.dental.id);
  }
  // without the data loaded, or toggled off, nothing changes
  for (const r of computeRows(BASE, ON)) assert.equal(r.cost.total, off.get(r.code).cost.total);
  for (const r of computeRows(WITH, { ...ON, dental: false })) assert.equal(dvCost(r), 0);
});

test('dental on: the ranking and value scores do not move (the same amount is added to every plan)', () => {
  const a = rankWithMine(WITH, VA, computeRows(WITH, VA)).ranked.map((r) => r.code);
  const b = rankWithMine(WITH, ON, computeRows(WITH, ON)).ranked.map((r) => r.code);
  assert.deepEqual(b, a);
  const va = valueScores(computeRows(WITH, VA), 'self');
  const vb = valueScores(computeRows(WITH, ON), 'self');
  for (const [k, v] of va) assert.equal(vb.get(k).score, v.score, k);
});

test('savings vs your plan: compared without dental/vision on both sides, and labelled', () => {
  const s = { ...ON, currentPlan2026: '104' };
  const off = savingsVsCurrent(WITH, { ...s, dental: false }, computeRows(WITH, { ...s, dental: false }));
  const on = savingsVsCurrent(WITH, s, computeRows(WITH, s));
  assert.equal(on.basis, 'excl-dv');
  assert.equal(on.amount, off.amount);
  assert.equal(on.currentTotal, baseTotal(on.current));
  // an ended 2026 plan: 2026 cost has no dental/vision, so neither does the 2027 side
  const ended = BASE.plans.find((p) => p.year === 2026 && !BASE.plans.some((q) => q.year === 2027 && q.code === p.code));
  const se = { ...ON, currentPlan2026: ended.code };
  const e1 = savingsVsCurrent(WITH, se, computeRows(WITH, se));
  const e0 = savingsVsCurrent(WITH, { ...se, dental: false }, computeRows(WITH, { ...se, dental: false }));
  assert.equal(e1.kind, 'ended');
  assert.equal(e1.amount, e0.amount);
  assert.equal(e1.basis, 'excl-dv');
  assert.equal(basisNote('excl-dv'), 'excl. dental/vision');
  assert.equal(basisNote('excl-meds'), 'excl. medications');
  assert.equal(basisNote('excl-meds-dv'), 'excl. medications and dental/vision');
  assert.equal(basisNote('total'), '');
});

test('board: "vs your plan" and "vs your 2026 plan (ended)" totals exclude dental/vision and say so', () => {
  const s = { ...ON, currentPlan2026: '104' };
  const res = rankWithMine(WITH, s, computeRows(WITH, s));
  const ctx = boardContext(res.ranked, s, res.mine);
  assert.equal(ctx.dvOn, true);
  const other = res.others[0];
  const c = cellOf('vsMine', 'vsTotal', other, ctx);
  assert.equal(Math.round(c.value), Math.round(baseTotal(other) - baseTotal(res.mine)));
  assert.match(c.sub, /excl\. dental\/vision/);
  assert.match(cellOf('vsMine', 'vsTotal', res.mine, ctx).sub, /excl\. dental\/vision/);
  // the total row says dental/vision is inside it
  assert.match(cellOf('cost', 'total', other, ctx).sub, /incl\. dental\/vision/);
  const ended = BASE.plans.find((p) => p.year === 2026 && !BASE.plans.some((q) => q.year === 2027 && q.code === p.code));
  const se = { ...ON, currentPlan2026: ended.code };
  const rows = computeRows(WITH, se);
  const ctx2 = boardContext(rows, se, null, endedBaseline(WITH, se));
  if (ctx2.baseline) {
    const v = cellOf('vsEnded', 'vsEndedTotal', rows[0], ctx2);
    assert.match(v.sub, /excl\. dental\/vision/);
    assert.equal(Math.round(v.value), Math.round(baseTotal(rows[0]) - ctx2.baseline.total));
  }
});

test('medications and dental together: each is its own amount, both left out of comparisons', () => {
  const DRUGS = [{ id: 'a1', name: 'Generic statin', monthlyCost: 12, fillsPerYear: 12, channel: 'retail30' }];
  const data = { ...WITH, meds: { drugs: DRUGS, records: { 104: { a1: 'Tier 1' } } } };
  const s = { ...ON, currentPlan2026: '104' };
  const rows = computeRows(data, s);
  const r104 = rows.find((r) => r.code === '104');
  const plain = computeRows(WITH, { ...s, dental: false }).find((r) => r.code === '104');
  assert.ok(medsCost(r104) > 0);
  assert.equal(Math.round((baseTotal(r104) + medsCost(r104) + dvCost(r104)) * 100), Math.round(r104.cost.total * 100));
  assert.equal(baseTotal(r104), plain.cost.total);
  assert.equal(savingsVsCurrent(data, s, rows).basis, 'excl-meds-dv');
});
