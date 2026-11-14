// Comparisons against a baseline that cannot carry the user's medications (any 2026 side, or 2027 plans where
// tiers are recorded on some plans only) use totals WITHOUT medications on both sides, and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultState } from '../src/state.js';
import { computeRows, rankWithMine, savingsVsCurrent, endedBaseline, baseTotal, medsCost, filtersActive } from '../src/ui/model.js';
import { MEDICAL_SECTIONS, boardContext, sectionsFor } from '../src/ui/board-model.js';
import { setBrochureFacts, rxFor, glp1Status } from '../src/ui/rx-model.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const BASE = { plans: read('plans.json'), rates: read('rates.json'), benefits: read('benefits.json'), serviceArea: read('service_area.json') };
const FACTS = read('brochure_facts.json');
setBrochureFacts(FACTS);

const DRUGS = [
  { id: 'a1', name: 'Generic statin', monthlyCost: 12, fillsPerYear: 12, channel: 'retail30' },
  { id: 'b2', name: 'Brand inhaler', monthlyCost: 300, fillsPerYear: 12, channel: 'retail30' },
];
// tiers recorded on SOME plans only (the realistic, lopsided case)
const RECORDS = { 104: { a1: 'Tier 1', b2: 'Tier 2' }, 111: { a1: 'Tier 1', b2: 'Tier 2' }, V41: { a1: 'Tier 1', b2: 'nc' } };
const withMeds = { ...BASE, brochure: FACTS, meds: { drugs: DRUGS, records: RECORDS } };
const noMeds = { ...BASE, brochure: FACTS };
const VA = { ...defaultState(), location: { state: 'VA', zip: null } };

const cellOf = (secKey, rowKey, row, ctx) => sectionsFor(MEDICAL_SECTIONS, ctx).find((s) => s.key === secKey).rows.find((r) => r.key === rowKey).cell(row, ctx);

test('rows: baseTotal excludes medications; medsCost is the difference; plans without records unchanged', () => {
  const rows = computeRows(withMeds, VA);
  const plain = new Map(computeRows(noMeds, VA).map((r) => [r.code, r]));
  const r104 = rows.find((r) => r.code === '104');
  assert.ok(r104.meds.entries.length === 2);
  assert.ok(medsCost(r104) > 0);
  assert.equal(baseTotal(r104), plain.get('104').cost.total);
  assert.equal(Math.round((baseTotal(r104) + medsCost(r104)) * 100), Math.round(r104.cost.total * 100));
  for (const r of rows) assert.equal(baseTotal(r), plain.get(r.code).cost.total, r.code);
});

test('ended plan (414): savings amount and best plan identical with and without medications; basis labelled', () => {
  assert.ok(BASE.plans.some((p) => p.code === '414' && p.year === 2026));
  assert.ok(!BASE.plans.some((p) => p.code === '414' && p.year === 2027));
  const st = { ...VA, currentPlan2026: '414' };
  const a = savingsVsCurrent(noMeds, st, computeRows(noMeds, st));
  const b = savingsVsCurrent(withMeds, st, computeRows(withMeds, st));
  assert.equal(a.kind, 'ended');
  assert.equal(b.best.code, a.best.code);
  assert.equal(b.amount, a.amount);
  assert.equal(a.basis, 'total');
  assert.equal(b.basis, 'excl-meds');
  assert.equal(b.bestTotal, baseTotal(b.best));
  assert.ok(Number.isFinite(b.bestMeds));
  // board "vs your 2026 plan (ended)": same delta, labelled, medications shown on their own row
  const cmp = (data) => {
    const res = rankWithMine(data, st, computeRows(data, st));
    const ctx = boardContext(res.ranked, st, res.mine, endedBaseline(data, st));
    const row = res.ranked.find((r) => r.code === '104');
    return { total: cellOf('vsEnded', 'vsEndedTotal', row, ctx), meds: sectionsFor(MEDICAL_SECTIONS, ctx).find((s) => s.key === 'vsEnded').rows.find((r) => r.key === 'vsEndedMeds'), row, ctx };
  };
  const x = cmp(noMeds);
  const y = cmp(withMeds);
  assert.equal(y.total.text, x.total.text);
  assert.equal(y.total.value, x.total.value);
  assert.match(y.total.sub, /excl\. your medications/);
  assert.equal(x.meds, undefined, 'no medications row without medications');
  const m = y.meds.cell(y.row, y.ctx);
  assert.match(m.sub, /not yet priced for 2026/);
});

test('continuing plan (104) with 2 recorded drugs: banner and vs-your-plan deltas identical with and without them', () => {
  const st = { ...VA, currentPlan2026: '104' };
  const a = savingsVsCurrent(noMeds, st, computeRows(noMeds, st));
  const b = savingsVsCurrent(withMeds, st, computeRows(withMeds, st));
  assert.equal(a.kind, 'continuing');
  assert.equal(b.best.code, a.best.code);
  assert.equal(b.amount, a.amount);
  assert.equal(b.basis, 'excl-meds');
  assert.ok(b.currentMeds > 0);
  const vs = (data) => {
    const res = rankWithMine(data, st, computeRows(data, st));
    const ctx = boardContext(res.ranked, st, res.mine, null);
    return res.others.map((r) => ({ code: r.code, c: cellOf('vsMine', 'vsTotal', r, ctx) }));
  };
  const x = new Map(vs(noMeds).map((v) => [v.code, v.c]));
  for (const { code, c } of vs(withMeds)) {
    assert.equal(c.text, x.get(code).text, code);
    if (c.value != null && c.tone !== 'flat') assert.match(c.sub, /excl\. medications/);
  }
});

test('filtersActive: the GLP-1 filter counts only when it can apply (brochure facts loaded)', () => {
  assert.equal(filtersActive({ ...VA, glp1: true }), true);
  assert.equal(filtersActive({ ...VA, glp1: true }, 'all', { glp1Applies: false }), false);
  const res = rankWithMine(BASE, { ...VA, glp1: true, currentPlan2026: '104' }, computeRows(BASE, { ...VA, glp1: true }));
  assert.equal(res.filtersOn, false, 'facts missing: nothing filtered, so no "filters on"');
});

test('glp1Status: true / false / null (not stated), so unknown plans can be counted', () => {
  assert.equal(glp1Status('V41'), true);
  const all = Object.keys(FACTS.plans).map((c) => glp1Status(c));
  assert.ok(all.filter((v) => v === null).length > 50);
  assert.equal(glp1Status('ZZZ'), null);
});

test('rxFor keeps both tiers when a brochure lists two with the same name (541, 544, PT4)', () => {
  for (const code of ['541', '544', 'PT4']) {
    const t3 = rxFor(code).tiers.filter((t) => t.number === 3);
    assert.equal(t3.length, 2, code);
    assert.notEqual(t3[0].name, t3[1].name);
    assert.deepEqual(t3.map((t) => t.name), ['Tier 3 (other)', 'Tier 3 (non-preferred brand)']);
  }
  assert.equal(new Set(rxFor('454').tiers.map((t) => t.name)).size, rxFor('454').tiers.length);
});
