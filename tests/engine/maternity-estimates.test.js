// "Having a baby" ESTIMATES: plans whose brochure states maternity cost per hospital day, per visit, or separately for
// the hospital and the doctors are estimated from the brochure's own (checked) terms plus one of three approved
// assumptions (src/engine/maternity-assumptions.js). Real 2027 data; amounts computed by hand.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { planTotal, maternityGap } from '../../src/engine/cost.js';
import { CUSTOM_PRESETS, usageFromCustom } from '../../src/engine/scenarios.js';
import { MATERNITY_ASSUMPTIONS, maternityAssumptionValues, estimateText } from '../../src/engine/maternity-assumptions.js';
import { defaultState } from '../../src/state.js';
import { computeRows, rankWithMine, maternityRanked } from '../../src/ui/model.js';
import { boardContext, medicalHeader, maternityCell, totalLabelOf } from '../../src/ui/board-model.js';

const DATA = new URL('../../data/', import.meta.url);
const load = (f) => JSON.parse(fs.readFileSync(new URL(`${f}.json`, DATA), 'utf8'));
const real = { rates: load('rates'), benefits: load('benefits'), plans: load('plans'), serviceArea: load('service_area') };
const BABY = CUSTOM_PRESETS.find((p) => p.id === 'baby').lines;
const B27 = real.benefits['2027'];
const plan = (code) => ({ rate: real.rates['2027'][code], benefits: B27[code], account: B27[code].account_contribution });
// the maternity line alone (no other care), self only: its cost is exactly the pregnancy's
const line = (code, maternity) => planTotal(plan(code), {
  status: 'active', enrollment: 'self', usage: usageFromCustom(BABY), assumptions: maternity ? { maternity } : {},
}).breakdown.custom[0];

test('the assumptions table: 3 days, 12 + 1 visits, a 50/50 split, each with its basis and sources', () => {
  assert.equal(MATERNITY_ASSUMPTIONS.days.value, 3);
  assert.equal(MATERNITY_ASSUMPTIONS.visits.prenatal, 12);
  assert.equal(MATERNITY_ASSUMPTIONS.visits.postpartum, 1);
  assert.equal(MATERNITY_ASSUMPTIONS.split.hospital, 0.5);
  assert.match(MATERNITY_ASSUMPTIONS.days.basis, /2\.9 days.*4\.0 days/);
  assert.ok(MATERNITY_ASSUMPTIONS.days.sources.some((s) => s.url === 'https://www.hcup-us.ahrq.gov/reports/statbriefs/sb131.jsp'));
  assert.match(MATERNITY_ASSUMPTIONS.visits.basis, /12-14 prenatal visits.*2025.*8-9/);
  assert.match(MATERNITY_ASSUMPTIONS.split.basis, /placeholder: no published national split/);
});

test('per hospital day: days x the per-day copay, capped as the brochure states', () => {
  // JK4 (TakeCare Standard): $150 a day up to $750 an admission, doctors nothing -> 3 x $150
  assert.equal(line('JK4').cost, 450);
  // JC1 (Aetna Open Access High, NY): $250 a day up to $1,000 -> 3 x $250; the first postpartum visit is free
  assert.equal(line('JC1').cost, 750);
  // B31 (Anthem Select HMO High): $250 a day for at most 4 days
  assert.equal(line('B31').cost, 750);
  for (const c of ['JK4', 'JC1', 'B31']) {
    const L = line(c);
    assert.equal(L.estimated, true, c);
    assert.ok(L.assumed.includes('days'), c);
  }
});

test('per visit: the brochure’s own wording about which visits carry the copay', () => {
  // NM1 (Health Plan of Nevada High): $300 an admission + $25 professional delivery; postpartum visits after the first
  // ($10) do not arise with one postpartum visit
  assert.equal(line('NM1').cost, 325);
  // P21 (Presbyterian High): $25 a visit up to $150 a pregnancy (13 visits -> $150) + $175 a day for 3 days
  assert.equal(line('P21').cost, 150 + 525);
  // 891 (Triple-S High): $0 office visits with the Maternal Program, delivery and stay nothing
  assert.equal(line('891').cost, 0);
  assert.match(line('891').notes.join(' '), /Maternal Program/);
});

test('hospital / doctors split: 50% of $20,416 on the hospital terms, 50% on the doctors’ terms', () => {
  // 314 (GEHA Standard): hospital 25% after the $500 deductible, doctors nothing
  assert.equal(line('314').cost, 500 + 0.25 * (20416 * 0.5 - 500));
  // 441 (SAMBA High): hospital nothing, doctors 15% after the $300 deductible
  assert.equal(Math.round(line('441').cost * 100), Math.round((300 + 0.15 * (20416 * 0.5 - 300)) * 100));
  // AJ1 (Geisinger Basic, no deductible): hospital 30%
  assert.equal(line('AJ1').cost, Math.round(0.3 * 10208 * 100) / 100);
});

test('equal percentages need no split: priced as stated, not estimated (AS1: 25% everywhere after the deductible)', () => {
  const m = B27.AS1.maternity;
  assert.equal(m.priced, true);
  assert.ok(!m.estimated);
  assert.deepEqual([m.kind, m.value, m.deductible], ['pct', 25, true]);
  const L = line('AS1');
  assert.equal(L.cost, 750 + 0.25 * (20416 - 750));
  assert.ok(!L.estimated);
  assert.doesNotMatch(L.notes.join(' '), /Estimated/);
});

test('a plan whose stated terms are not certain stays not priced (311: per-day copay plus coinsurance; N41: conflicting rows)', () => {
  for (const c of ['311', 'N41', '254']) {
    assert.equal(B27[c].maternity.priced, false, c);
    const L = line(c);
    assert.equal(L.unpriced, true, c);
    assert.equal(L.cost, 0, c);
    assert.match(L.warnings[0], /^Not priced: this plan’s brochure/, c);
  }
});

test('the assumptions table is the single source: changing a value changes the amount', () => {
  assert.equal(line('JK4', { days: 4 }).cost, 600); // 4 x $150, under the $750 cap
  assert.equal(line('JK4', { days: 6 }).cost, 750); // capped
  assert.equal(line('B31', { days: 6 }).cost, 1000); // at most 4 days
  assert.equal(line('JC1', { postpartum: 3 }).cost, 750 + 2 * 35); // two postpartum visits after the first
  assert.equal(Math.round(line('314', { hospitalShare: 0.6 }).cost * 100), Math.round((500 + 0.25 * (20416 * 0.6 - 500)) * 100));
  // and the constants themselves: the engine reads MATERNITY_ASSUMPTIONS when no override is passed
  const keep = MATERNITY_ASSUMPTIONS.days.value;
  try {
    MATERNITY_ASSUMPTIONS.days.value = 2;
    assert.equal(line('JK4').cost, 300);
    assert.match(estimateText(['days']), /a 2-day hospital stay/);
  } finally {
    MATERNITY_ASSUMPTIONS.days.value = keep;
  }
  assert.equal(line('JK4').cost, 450);
  assert.deepEqual(maternityAssumptionValues(), { days: 3, prenatal: 12, postpartum: 1, hospitalShare: 0.5 });
});

test('every estimated plan says it is estimated, names the assumption and the brochure; no stated plan does', () => {
  const words = { days: /hospital stay.*per hospital day/, visits: /prenatal visits.*per visit/, split: /split 50% hospital.*the hospital and the doctors differently/ };
  let est = 0;
  for (const [code, b] of Object.entries(B27)) {
    const m = b.maternity;
    if (!m.priced) {
      assert.ok(maternityGap(m), code);
      continue;
    }
    const L = line(code);
    const notes = L.notes.join(' ');
    if (m.estimated) {
      est += 1;
      assert.equal(L.estimated, true, code);
      assert.match(notes, /^Estimated: assumes /, code);
      assert.match(notes, /brochure/, code);
      for (const a of m.assumed) assert.match(notes, words[a], `${code} ${a}`);
    } else {
      assert.ok(!L.estimated, code);
      assert.doesNotMatch(notes, /Estimated|assumes/, code);
    }
  }
  assert.equal(est, 38);
});

test('board and labels: an estimated amount reads "est." with its reason; totals that include estimates say so', () => {
  const VA = { ...defaultState(), location: { state: 'VA', zip: null }, custom: BABY };
  const data = { ...real };
  const rows = computeRows(data, VA);
  // only plans with a price, some estimated: maternity joins the ranking, labelled "(some estimated)"
  const priced = rows.filter((r) => r.maternity.priced);
  const someEst = priced.filter((r) => r.maternity.estimated);
  assert.ok(someEst.length > 0, 'Virginia has estimated plans');
  assert.equal(maternityRanked(priced), true);
  const res = rankWithMine(data, VA, priced);
  assert.equal(res.matInRank, true);
  const ctx = boardContext(res.ranked, VA);
  assert.equal(ctx.matEstimated, true);
  const e = someEst[0];
  assert.equal(medicalHeader(e, res.ranked, ctx, '').totalLabel, 'per year, estimated, incl. maternity (some estimated)');
  const c = maternityCell(e, ctx);
  assert.match(c.text, / est\.$/);
  assert.match(c.title, /^Estimated: assumes .*brochure/);
  const stated = priced.find((r) => !r.maternity.estimated);
  assert.doesNotMatch(maternityCell(stated, ctx).text, /est\./);
  assert.equal(stated.maternity.estimate, null);
  // a mixed set (some plans not priced): excluded as before, whatever the estimates
  assert.equal(totalLabelOf(e, true, false, true), 'per year, estimated, excl. maternity');
});
