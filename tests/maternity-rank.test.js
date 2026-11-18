// "Having a baby" ranking basis: maternity is priced only on plans whose 2027 brochure gives a total for one
// pregnancy, and an unpriced plan's total leaves it out. So, like medications (I3), plans are ranked on the total
// WITHOUT maternity unless every shown plan is maternity-priced; what one pregnancy adds is shown apart.
// Real 2027 data, ZIP 22302 (Alexandria, VA).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultState } from '../src/state.js';
import { CUSTOM_PRESETS } from '../src/engine/scenarios.js';
import { zipCountyLookup } from '../src/data.js';
import {
  computeRows, sortRows, rankWithMine, savingsVsCurrent, maternityRanked, rankTotal, baseTotal, matAdded,
  basisNote, endedRow,
} from '../src/ui/model.js';
import { MEDICAL_SECTIONS, boardContext, sectionsFor, medicalHeader, totalLabelOf, endedTotalLabel, maternityCell, whyLine } from '../src/ui/board-model.js';
import { setBrochureFacts } from '../src/ui/rx-model.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const FACTS = read('brochure_facts.json');
setBrochureFacts(FACTS);
const DATA = {
  plans: read('plans.json'), rates: read('rates.json'), benefits: read('benefits.json'), serviceArea: read('service_area.json'),
  brochure: FACTS, zipCounty: zipCountyLookup(read('zip_county.json')),
};
const BABY = CUSTOM_PRESETS.find((p) => p.id === 'baby').lines;
const VA = { ...defaultState(), location: { state: 'VA', zip: '22302' } };
// the caption says "estimated" only for an estimated total (a 'fixed' one has the "Fixed cost" tag)
const est = (r) => (r.cost.firmness === 'fixed' ? '' : 'estimated, ');
const BABY_VA = { ...VA, custom: BABY };
const codes = (rows) => rows.map((r) => r.code);
const PRICED = new Set(Object.entries(DATA.benefits['2027']).filter(([, b]) => b.maternity?.priced === true).map(([c]) => c));
const ENDED = DATA.plans.find((p) => p.year === 2026 && !DATA.plans.some((q) => q.year === 2027 && q.code === p.code)).code;

test('with the baby preset in Virginia, plans are ranked on totals without maternity', () => {
  const rows = computeRows(DATA, BABY_VA);
  assert.ok(rows.some((r) => !r.maternity.priced) && rows.some((r) => r.maternity.priced), 'a mixed set');
  assert.equal(maternityRanked(rows), false);
  const sorted = sortRows(rows, 'total');
  // the ranking equals the ranking on totals-excluding-maternity, which is the ranking with no baby line at all
  const plain = sortRows(computeRows(DATA, VA), 'total');
  assert.deepEqual(codes(sorted), codes(plain));
  const byExcl = rows.slice().sort((a, b) => baseTotal(a, false) - baseTotal(b, false) || a.code.localeCompare(b.code));
  assert.deepEqual(codes(sorted), codes(byExcl));
  for (const r of rows) {
    // excluded total + what the pregnancy adds = the full total
    assert.equal(Math.round((rankTotal(r, true, false) + (matAdded(r) ?? 0)) * 100), Math.round(r.cost.total * 100), r.code);
    if (!r.maternity.priced) {
      assert.equal(matAdded(r), null, `${r.code}: not priced is null, never $0`);
      assert.equal(rankTotal(r, true, false), r.cost.total);
    }
  }
  const res = rankWithMine(DATA, BABY_VA, rows);
  assert.equal(res.matInRank, false);
  assert.deepEqual(codes(res.ranked), codes(byExcl));
});

test('an unpriced plan never outranks a priced plan only because its maternity is unpriced', () => {
  const rows = sortRows(computeRows(DATA, BABY_VA), 'total');
  rows.forEach((u, i) => {
    if (u.maternity.priced) return;
    for (const p of rows.slice(i + 1)) {
      if (!p.maternity.priced) continue;
      // u sits above p: it must be at least as cheap without maternity on both sides
      assert.ok(baseTotal(u, false) <= baseTotal(p, false), `${u.code} above ${p.code}`);
    }
  });
  // the case from the maternity review: 254 (unpriced) against 424 (priced, 30% after the deductible)
  const r254 = rows.find((r) => r.code === '254');
  const r424 = rows.find((r) => r.code === '424');
  assert.ok(r254 && r424);
  assert.ok(r424.cost.total > r254.cost.total, 'full totals: 424 carries the pregnancy, 254 does not');
  assert.ok(matAdded(r424) > 6000);
  assert.equal(rankTotal(r424, true, false), baseTotal(r424, false));
});

test('every shown plan maternity-priced: maternity joins the ranking', () => {
  for (const pick of [['T71', 'E34', 'E31'], ['104', '111'], ['104', '111', '424', 'T71', 'E34', 'E31']]) {
    const rows = computeRows(DATA, BABY_VA).filter((r) => pick.includes(r.code));
    assert.equal(rows.length, pick.length, pick.join());
    assert.equal(maternityRanked(rows), true);
    const sorted = sortRows(rows, 'total');
    const byFull = rows.slice().sort((a, b) => a.cost.total - b.cost.total || a.code.localeCompare(b.code));
    assert.deepEqual(codes(sorted), codes(byFull));
    const ctx = boardContext(sorted, BABY_VA);
    assert.equal(ctx.withMat, true);
    for (const r of rows) {
      assert.equal(totalLabelOf(r, true, true), `per year, ${est(r)}incl. maternity`);
      assert.equal(medicalHeader(r, sorted, ctx, '').total, r.cost.total);
    }
  }
  // the network filter narrowing the view to Kaiser: all priced, so totals include the pregnancy
  const kst = { ...BABY_VA, networks: ['Kaiser Permanente'] };
  const kaiser = computeRows(DATA, kst);
  assert.ok(kaiser.length >= 3 && kaiser.every((r) => PRICED.has(r.code)), codes(kaiser).join());
  assert.equal(rankWithMine(DATA, kst, kaiser).matInRank, true);
});

test('labels say "excl. maternity" when it is left out, combined with the meds and dental/vision labels', () => {
  const rows = computeRows(DATA, BABY_VA);
  const priced = rows.find((r) => r.maternity.priced && r.maternity.cost > 0);
  const unpriced = rows.find((r) => !r.maternity.priced);
  assert.equal(totalLabelOf(priced, true, false), `per year, ${est(priced)}excl. maternity`);
  assert.equal(totalLabelOf(unpriced, true, false), `per year, ${est(unpriced)}excl. maternity`);
  // combined with medications left out of the ranking
  const withMedsRow = { ...priced, meds: { entries: [{}], count: 1 } };
  assert.equal(totalLabelOf(withMedsRow, false, false), `per year, ${est(priced)}excl. meds and maternity`);
  assert.equal(totalLabelOf(withMedsRow, true, false), `per year, ${est(priced)}incl. meds, excl. maternity`);
  assert.equal(basisNote('excl-mat'), 'excl. maternity');
  assert.equal(basisNote('excl-meds-mat'), 'excl. medications and maternity');
  assert.equal(basisNote('excl-meds-dv-mat'), 'excl. medications, dental/vision and maternity');
  // the board header and total cell
  const res = rankWithMine(DATA, BABY_VA, rows);
  const ctx = boardContext(res.ranked, BABY_VA);
  assert.equal(ctx.withMat, false);
  assert.equal(ctx.matOn, true);
  const hd = medicalHeader(res.ranked[0], res.ranked.slice(0, 3), ctx, '');
  assert.match(hd.totalLabel, /excl\. maternity$/);
  const cost = sectionsFor(MEDICAL_SECTIONS, ctx).find((s) => s.key === 'cost');
  const total = cost.rows.find((r) => r.key === 'total').cell;
  assert.match(total(priced, ctx).sub, /\+ \$[\d,]+ maternity not in total/);
  assert.equal(total(priced, ctx).value, baseTotal(priced, false));
  assert.match(total(unpriced, ctx).sub, /maternity not priced/);
  // the #1 gap uses the same basis
  const [a, b] = res.ranked;
  const gap = Math.round(rankTotal(b, true, false) - rankTotal(a, true, false));
  assert.match(whyLine(a, res.ranked.slice(0, 3), ctx), new RegExp(`\\$${gap.toLocaleString('en-US')} less than #2`));
});

test('board: a "Maternity (one pregnancy)" Cost row only when a maternity line is active', () => {
  const rows = computeRows(DATA, BABY_VA);
  const ctx = boardContext(sortRows(rows), BABY_VA);
  const cost = sectionsFor(MEDICAL_SECTIONS, ctx).find((s) => s.key === 'cost');
  const def = cost.rows.find((r) => r.key === 'maternity');
  assert.ok(def);
  assert.equal(def.label, 'Maternity (one pregnancy)');
  const priced = rows.find((r) => r.code === '424');
  const c = maternityCell(priced, ctx);
  assert.equal(c.text, `+ $${Math.round(priced.maternity.cost).toLocaleString('en-US')}`);
  assert.equal(c.sub, 'not in the total above');
  const unpriced = rows.find((r) => r.code === '254');
  const u = maternityCell(unpriced, ctx);
  assert.equal(u.text, 'Not priced');
  assert.equal(u.sub, 'the plan’s brochure doesn’t give a total');
  assert.match(u.title, /gap in the plan’s published information, not in this app/);
  // no baby line: no row, and nothing about maternity anywhere
  const ctx0 = boardContext(sortRows(computeRows(DATA, VA)), VA);
  assert.equal(ctx0.matOn, false);
  assert.ok(!sectionsFor(MEDICAL_SECTIONS, ctx0).find((s) => s.key === 'cost').rows.some((r) => r.key === 'maternity'));
});

test('savings banner: maternity left out unless every plan (yours included) is priced; an ended plan always leaves it out', () => {
  const st = { ...BABY_VA, currentPlan2026: '424' };
  const v = savingsVsCurrent(DATA, st, computeRows(DATA, st));
  assert.equal(v.kind, 'continuing');
  assert.equal(v.withMat, false);
  assert.equal(v.basis, 'excl-mat');
  assert.equal(basisNote(v.basis), 'excl. maternity');
  assert.equal(v.currentTotal, baseTotal(v.current, false));
  assert.equal(v.currentMat, matAdded(v.current));
  assert.ok(v.currentMat > 0);
  if (!v.best.maternity.priced) assert.equal(v.bestMat, null);
  // only priced plans shown, the user's plan priced too: included
  const kaiserish = computeRows(DATA, st).filter((r) => ['T71', 'E34', 'E31', '424'].includes(r.code));
  const vIn = savingsVsCurrent(DATA, st, kaiserish);
  assert.equal(vIn.withMat, true);
  assert.equal(vIn.basis, 'total');
  assert.equal(vIn.currentTotal, vIn.current.cost.total);
  // the user's 2026 plan ended: never maternity-priced, so the comparison leaves it out on both sides
  const se = { ...BABY_VA, currentPlan2026: ENDED };
  const ve = savingsVsCurrent(DATA, se, kaiserish);
  assert.equal(ve.kind, 'ended');
  assert.equal(ve.withMat, false);
  assert.match(basisNote(ve.basis), /maternity/);
  assert.equal(ve.bestTotal, baseTotal(ve.best, false));
});

test('the ended 2026 plan is never maternity-priced and says so plainly', () => {
  const se = { ...BABY_VA, currentPlan2026: ENDED };
  const row = endedRow(DATA, se);
  if (!row) return; // no 2026 rate for this coverage
  assert.equal(row.maternity.priced, false);
  assert.equal(row.maternity.gap.kind, null);
  assert.match(row.maternity.gap.text, /only for 2027 plans/);
  assert.equal(endedTotalLabel({ matOn: true }), 'per year, 2026 rates, excl. maternity');
  assert.equal(endedTotalLabel({ matOn: true, medsOn: true, dvOn: true }), 'per year, 2026 rates, excl. dental/vision, meds and maternity');
  const L = row.cost.breakdown.custom[0];
  assert.equal(L.unpriced, true);
  assert.doesNotMatch(L.warnings.join(' '), /brochure states/);
});

test('no maternity line: rows carry no maternity part and every total is as before', () => {
  const rows = computeRows(DATA, VA);
  for (const r of rows) {
    assert.equal(r.maternity, null);
    assert.equal(rankTotal(r, true, false), rankTotal(r, true, true));
    assert.equal(baseTotal(r, false), baseTotal(r));
    assert.equal(totalLabelOf(r, true, false), r.cost.firmness === 'fixed' ? 'per year' : 'per year, estimated');
  }
  assert.equal(maternityRanked(rows), true);
  assert.equal(rankWithMine(DATA, VA, rows).matInRank, true);
  const v = savingsVsCurrent(DATA, { ...VA, currentPlan2026: '104' }, rows);
  assert.equal(v.basis, 'total');
});

// The caption beside the total follows the same firmness as the card's tag: a 'fixed' total (no care assumed, or every
// service a flat copay) has the "Fixed cost" tag, so its caption does not say "estimated".
test('the total caption says "estimated" only when the total is estimated, like the tag', () => {
  const nothing = computeRows(DATA, { ...VA, scenario: 'nothing' });
  assert.ok(nothing.length > 10 && nothing.every((r) => r.cost.firmness === 'fixed'));
  for (const r of nothing) assert.equal(totalLabelOf(r, true, true), 'per year', r.code);
  const est = computeRows(DATA, { ...VA, scenario: 'worst' }).filter((r) => r.cost.firmness === 'estimated');
  assert.ok(est.length > 10);
  for (const r of est) assert.equal(totalLabelOf(r, true, true), 'per year, estimated', r.code);
  // other parts still follow, after the plain caption
  const withMeds = { ...nothing[0], meds: { entries: [{}], count: 1 } };
  assert.equal(totalLabelOf(withMeds, false, true), 'per year, excl. meds');
  assert.equal(totalLabelOf(withMeds, true, true), 'per year, incl. meds');
});
