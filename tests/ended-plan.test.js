// The user's 2026 plan has no 2027 version: its 2026 numbers are pinned first (Board column, Cards card) as an
// unranked reference. Real data (data/*.json), like results-model.test.js.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { defaultState } from '../src/state.js';
import {
  computeRows, rankWithMine, endedRow, endedBaseline, boardGroups, planMeta, planInput, costInputs, savingsVsCurrent,
} from '../src/ui/model.js';
import {
  MEDICAL_SECTIONS, boardContext, sectionsFor, medicalHeader, withEndedColumn, endedCell, ENDED_NOTE, valueScores,
} from '../src/ui/board-model.js';
import { buildMatrix, matrixBoardSections, pinnedMatrixCells } from '../src/ui/matrix-model.js';
import { planTotal } from '../src/engine/cost.js';
import { mineNoteText } from '../src/ui/results-board.js';

const real = (() => {
  try {
    const r = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
    return { plans: r('plans.json'), rates: r('rates.json'), benefits: r('benefits.json'), serviceArea: r('service_area.json') };
  } catch { return null; }
})();
const skip = !real;

// 414 = MHBP Value Plan (FFS, nationwide) and 481 = MHBP Consumer Option (HDHP with an HSA): 2026 only
const VA = () => ({ ...defaultState(), location: { state: 'VA', zip: null } });

test('real data: 414 and 481 are 2026 plans with no 2027 version', { skip }, () => {
  for (const code of ['414', '481']) {
    assert.ok(planMeta(real, 2026, code), code);
    assert.equal(planMeta(real, 2027, code), null, code);
  }
});

test('endedRow: the 2026 plan costed from 2026 rates with the user inputs; unranked, flagged, same totals as endedBaseline', { skip }, () => {
  for (const code of ['414', '481']) {
    for (const enrollment of ['self', 'family']) {
      for (const scenario of ['healthy', 'worst']) {
        const s = { ...VA(), currentPlan2026: code, enrollment, scenario };
        const row = endedRow(real, s);
        assert.ok(row, `${code} ${enrollment} ${scenario}`);
        assert.equal(row.isEnded, true);
        assert.equal(row.rank, null);
        assert.equal(row.year, 2026);
        assert.equal(row.isMine, undefined, 'not the 2027 "your plan" row');
        assert.equal(row.plan.name, planMeta(real, 2026, code).name);
        const expected = planTotal(planInput(real, 2026, code), costInputs(s));
        assert.equal(row.cost.total, expected.total);
        assert.equal(row.cost.oop, expected.oop);
        assert.equal(row.cost.premium, expected.premium);
        const b = endedBaseline(real, s);
        assert.equal(row.cost.total, b.total);
        assert.equal(row.cost.premium, b.premium);
        assert.equal(row.facts.deductible, b.deductible);
        assert.equal(row.facts.oopMax, b.oopMax);
        assert.equal(row.cost.total, savingsVsCurrent(real, s, computeRows(real, s)).current2026Total);
      }
    }
  }
  assert.equal(endedRow(real, { ...VA(), currentPlan2026: '481' }).account, 'HSA');
  // a continuing plan, or none: no ended row
  assert.equal(endedRow(real, { ...VA(), currentPlan2026: '104' }), null);
  assert.equal(endedRow(real, { ...VA(), currentPlan2026: null }), null);
});

test('rankWithMine: an ended plan rides along as res.ended, outside the ranking and the totals', { skip }, () => {
  const s = { ...VA(), currentPlan2026: '414' };
  const rows = computeRows(real, s);
  const res = rankWithMine(real, s, rows);
  assert.equal(res.mineStatus, 'ended');
  assert.equal(res.mine, null);
  assert.equal(res.ended.code, '414');
  assert.equal(res.ended.isEnded, true);
  assert.ok(!res.ranked.some((r) => r.code === '414'));
  assert.ok(!res.others.some((r) => r.isEnded));
  assert.equal(res.others.length, rows.length, 'N of M counts unchanged');
  // same ranking as with no current plan at all
  const none = rankWithMine(real, VA(), computeRows(real, VA()));
  assert.deepEqual(res.ranked.map((r) => [r.code, r.rank]), none.ranked.map((r) => [r.code, r.rank]));
  // toggle off: nothing pinned
  const off = rankWithMine(real, { ...s, includeMine: false }, rows);
  assert.equal(off.mineStatus, 'off');
  assert.equal(off.ended, null);
  // value scores and the #1 total never see it
  const ctx = boardContext(res.ranked, s, res.mine, endedBaseline(real, s));
  assert.ok(!ctx.values.has('414'));
  assert.equal(ctx.minTotal, Math.min(...res.ranked.map((r) => r.cost.total)));
  assert.deepEqual(valueScores(res.ranked, 'self'), ctx.values);
});

test('boardGroups: the ended plan is the pinned first group, not double counted', { skip }, () => {
  const s = { ...VA(), currentPlan2026: '414', group: 'top3' };
  const groups = boardGroups(real, s, computeRows(real, s));
  assert.equal(groups[0].key, 'mine');
  assert.equal(groups[0].label, 'Your 2026 plan (ended)');
  assert.deepEqual(groups[0].rows.map((r) => r.code), ['414']);
  assert.equal(groups.slice(1).flatMap((g) => g.rows).length, 3);
  assert.ok(!groups.slice(1).flatMap((g) => g.rows).some((r) => r.isEnded));
});

test('board header: "2026" instead of a rank, an Ended in 2027 chip, 2026 label, the note said once', { skip }, () => {
  const s = { ...VA(), currentPlan2026: '481' };
  const res = rankWithMine(real, s, computeRows(real, s));
  const ctx = boardContext(res.ranked, s, null, endedBaseline(real, s));
  const hd = medicalHeader(res.ended, [res.ended], ctx, '');
  assert.equal(hd.rankText, '2026');
  assert.equal(hd.rankSub, undefined);
  assert.ok(!/#/.test(hd.rankText));
  assert.equal(hd.chips[0].text, 'Ended in 2027');
  assert.ok(!hd.chips.some((c) => c.tone === 'mine'), 'never claims to be the 2027 plan');
  assert.ok(hd.chips.some((c) => c.text === 'HSA'));
  assert.equal(hd.title, planMeta(real, 2026, '481').name);
  assert.equal(hd.total, endedBaseline(real, s).total);
  assert.equal(hd.totalLabel, 'per year, 2026 rates');
  assert.equal(hd.why, `${ENDED_NOTE}.`);
  assert.equal(hd.bar.p, res.ended.cost.premium);
  assert.equal(hd.bar.o, res.ended.cost.oop);
  // with dental/vision or medications in the 2027 totals, the label says the 2026 one leaves them out
  assert.equal(medicalHeader(res.ended, [], { ...ctx, dvOn: true, medsOn: true }, '').totalLabel, 'per year, 2026 rates, excl. dental/vision and meds');
  // a continuing plan's header is unchanged
  const other = res.others[0];
  assert.equal(medicalHeader(other, res.others, ctx, '').rankText, `#${other.rank}`);
});

test('board cells: the ended column is filled from 2026, labelled 2026, dashes where a 2027 plan is needed', { skip }, () => {
  const s = { ...VA(), currentPlan2026: '414' };
  const res = rankWithMine(real, s, computeRows(real, s));
  const base = endedBaseline(real, s);
  const ctx = boardContext(res.ranked, s, null, base);
  const secs = withEndedColumn(sectionsFor(MEDICAL_SECTIONS, ctx));
  const def = (k) => secs.flatMap((x) => x.rows).find((d) => d.key === k);
  const e = res.ended;
  const cell = (k) => def(k).cell(e, ctx);
  assert.equal(cell('total').value, base.total);
  assert.match(cell('total').sub, /2026/);
  assert.equal(cell('premium').value, base.premium);
  assert.match(cell('premium').sub, /2026/);
  assert.equal(cell('oop').value, e.cost.oop);
  assert.match(cell('oop').sub, /2026/);
  assert.equal(cell('deductible').value, base.deductible);
  assert.equal(cell('oopMax').value, base.oopMax);
  assert.match(cell('deductible').sub, /2026/);
  assert.ok(cell('coinsurance'));
  assert.equal(cell('value').text, '—');
  assert.equal(cell('value').value, null);
  for (const k of ['chgPremium', 'chgDeductible', 'chgOopMax', 'flags']) assert.equal(cell(k).text, '—', k);
  // its own row in "vs your 2026 plan (ended)" is the baseline itself
  assert.equal(cell('vsEndedTotal').sub, 'your 2026 baseline');
  assert.equal(cell('vsEndedTotal').value, null);
  // other columns are untouched by the wrapper
  const o = res.others[0];
  for (const k of ['total', 'premium', 'value', 'chgPremium', 'vsEndedTotal']) {
    const orig = sectionsFor(MEDICAL_SECTIONS, ctx).flatMap((x) => x.rows).find((d) => d.key === k);
    assert.deepEqual(def(k).cell(o, ctx), orig.cell(o, ctx), k);
  }
  // an unknown row (e.g. a medications row) is a plain dash for the ended column
  assert.equal(endedCell({ key: 'rx:anything', cell: () => ({ text: 'x' }) }, e, ctx).text, '—');
});

test('benefit matrix: 2027 rows, the ended column filled from its own 2026 benefits, dash where it has no such row', { skip }, () => {
  const s = { ...VA(), currentPlan2026: '414' };
  const res = rankWithMine(real, s, computeRows(real, s));
  const onBoard = res.others.slice(0, 3).map((r) => ({ code: r.code, benefits: r.benefits }));
  const matrix = buildMatrix(onBoard, { enrollment: 'self', status: 'active' });
  const pinned = pinnedMatrixCells(res.ended.benefits, { enrollment: 'self', status: 'active' });
  assert.ok(pinned.size > 10);
  const mx = matrixBoardSections(matrix, { pinned });
  const rows = mx.flatMap((x) => x.rows);
  let filled = 0;
  for (const d of rows) {
    const c = d.cell(res.ended);
    const key = d.key.split(':').slice(2).join(':');
    if (pinned.has(key)) {
      filled += 1;
      assert.equal(c.text, pinned.get(key).display, d.key);
      assert.match(c.sub, /2026/);
    } else {
      assert.equal(c.text, '—', d.key);
    }
  }
  assert.ok(filled > 10, `filled ${filled}`);
  // the 2027 columns still read their own cells
  const first = rows[0];
  const byCode = matrix.flatMap((x) => x.rows)[0].cells.find((c) => c.code === onBoard[0].code);
  assert.equal(first.cell({ code: onBoard[0].code }).text, byCode.display);
  // without `pinned` the board behaves as before
  assert.equal(matrixBoardSections(matrix)[0].rows[0].cell({ code: onBoard[0].code }).text, byCode.display);
});

test('results note: the ended plan is said to be pinned first for comparison', { skip }, () => {
  const s = { ...VA(), currentPlan2026: '414' };
  const res = rankWithMine(real, s, computeRows(real, s));
  const name = planMeta(real, 2026, '414').name;
  assert.equal(mineNoteText(real, s, res, 'Virginia'), `${name} ended after 2026, so its 2026 numbers are pinned first for comparison. They are not ranked.`);
  // no 2026 rate to cost it: the old wording stays
  assert.match(mineNoteText(real, s, { ...res, ended: null }, 'Virginia'), /cannot be pinned/);
});

test('a continuing plan keeps its 2027 "your plan" pin and no ended row', { skip }, () => {
  const s = { ...VA(), currentPlan2026: '104' };
  const res = rankWithMine(real, s, computeRows(real, s));
  assert.equal(res.mineStatus, 'included');
  assert.equal(res.mine.code, '104');
  assert.equal(res.mine.isMine, true);
  assert.equal(res.ended, null);
  assert.equal(res.mine.isEnded, undefined);
  const ctx = boardContext(res.ranked, s, res.mine);
  const hd = medicalHeader(res.mine, [res.mine], ctx, '');
  assert.match(hd.rankText, /^#\d+ overall$/);
  assert.equal(hd.chips[0].text, 'Your plan · 2027');
  const groups = boardGroups(real, s, computeRows(real, s));
  assert.equal(groups[0].label, 'Your plan');
});
