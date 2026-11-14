// C1: regional plans serve only part of most states. OPM's service area lists whole states, whole counties (FIPS)
// and, for partly covered counties, the ZIP codes served. There is no ZIP -> county crosswalk in OPM's data, so a
// plan that serves only some counties of the user's state is "availability not confirmed" unless OPM lists the
// user's ZIP. Unconfirmed plans stay in the ranked list (with a chip) but are kept out of the savings banner's
// "best plan" unless the user opts in. Real 2027 data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { areaStatus, servesState, computeRows, sortRows, savingsVsCurrent, availablePlans, countsByFamily, rankWithMine } from '../src/ui/model.js';
import { defaultState, encodeHash, decodeState } from '../src/state.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const data = { plans: load('plans.json'), rates: load('rates.json'), benefits: load('benefits.json'), serviceArea: load('service_area.json') };
const sa = data.serviceArea;
const p27 = data.plans.filter((p) => p.year === 2027);
const S = (o = {}) => ({ ...defaultState(), ...o });

test('areaStatus: nationwide, statewide, ZIP listed, partial (no crosswalk) and outside', () => {
  assert.equal(areaStatus(sa, '104', 'VA', '24011'), 'nationwide');
  assert.equal(areaStatus(sa, 'T71', 'DC', null), 'statewide');
  // Kaiser Mid-Atlantic Prosper serves 13 Northern Virginia counties and some ZIPs of partly covered ones
  assert.equal(areaStatus(sa, 'T71', 'VA', null), 'partial');
  assert.equal(areaStatus(sa, 'T71', 'VA', '22302'), 'partial', 'Alexandria: a covered county, but OPM has no ZIP->county map');
  assert.equal(areaStatus(sa, 'T71', 'VA', '24011'), 'partial', 'Roanoke: cannot be ruled out without a crosswalk either');
  assert.equal(areaStatus(sa, 'T71', 'VA', '22508'), 'zip', 'a ZIP OPM lists for T71');
  assert.equal(areaStatus(sa, 'T71', 'CA', null), 'outside');
  assert.equal(areaStatus(sa, 'NOPE', 'VA', null), 'outside');
  // Sharp (YJ1) serves California only by listed ZIP codes (no whole county): the ZIP decides
  assert.equal(areaStatus(sa, 'YJ1', 'CA', '92101'), 'zip');
  assert.equal(areaStatus(sa, 'YJ1', 'CA', '94103'), 'outside', 'San Francisco is not a Sharp ZIP');
  assert.equal(areaStatus(sa, 'YJ1', 'CA', null), 'partial');
});

test('servesState keeps every plan that may serve the user; a ZIP rules out ZIP-only plans that do not list it', () => {
  assert.equal(servesState(sa, 'T71', 'VA'), true);
  assert.equal(servesState(sa, 'T71', 'VA', '24011'), true);
  assert.equal(servesState(sa, 'YJ1', 'CA', '94103'), false);
  const sf = availablePlans(p27, sa, 'CA', '94103').map((p) => p.code);
  const ca = availablePlans(p27, sa, 'CA').map((p) => p.code);
  assert.ok(ca.includes('YJ1') && !sf.includes('YJ1'));
  assert.equal(countsByFamily(p27, sa, { state: 'CA', zip: '94103' }).total, sf.length);
});

test('rows carry their area status; partial-state plans in Virginia are flagged', () => {
  const rows = computeRows(data, S({ location: { state: 'VA', zip: '24011' } }));
  const t71 = rows.find((r) => r.code === 'T71');
  assert.equal(t71.area, 'partial');
  assert.equal(rows.find((r) => r.code === '104').area, 'nationwide');
  const partial = rows.filter((r) => r.area === 'partial').map((r) => r.code).sort();
  assert.ok(partial.length >= 10, `VA partial plans: ${partial.join(',')}`);
  for (const r of rows) assert.ok(['nationwide', 'statewide', 'zip', 'partial'].includes(r.area), r.code);
});

test('Roanoke (24011): the savings banner never names an unconfirmed plan as the best plan unless the user opts in', () => {
  const base = S({ location: { state: 'VA', zip: '24011' }, currentPlan2026: '104' });
  const rows = computeRows(data, base);
  const cheapest = sortRows(rows)[0];
  const v = savingsVsCurrent(data, base, rows);
  assert.notEqual(v.best.area, 'partial', `best ${v.best.code}`);
  const confirmed = sortRows(rows.filter((r) => r.area !== 'partial'))[0];
  assert.equal(v.best.code, confirmed.code);
  assert.equal(v.skipped, rows.filter((r) => r.area === 'partial' && r.baseTotal < confirmed.baseTotal).length);
  if (cheapest.area === 'partial') assert.ok(v.skipped > 0, 'a cheaper unconfirmed plan is reported as skipped');
  const on = savingsVsCurrent(data, { ...base, includeUnconfirmed: true }, rows);
  assert.equal(on.best.code, cheapest.code);
  assert.equal(on.skipped, 0);
});

test('a ZIP OPM lists for T71 confirms it, so it may be the banner best', () => {
  const base = S({ location: { state: 'VA', zip: '22508' }, currentPlan2026: '104' });
  const rows = computeRows(data, base);
  assert.equal(rows.find((r) => r.code === 'T71').area, 'zip');
});

test('the pinned plan reports when its service area is only partly in the state', () => {
  const res = rankWithMine(data, S({ location: { state: 'VA', zip: '24011' }, currentPlan2026: 'T71' }), computeRows(data, S({ location: { state: 'VA', zip: '24011' } })));
  assert.equal(res.mine.area, 'partial');
  assert.equal(res.notInState, false);
});

test('includeUnconfirmed: default off, written to the hash only when on, round-trips', () => {
  assert.equal(defaultState().includeUnconfirmed, false);
  assert.ok(!/(^|&)u=/.test(encodeHash(S()).hash));
  const h = encodeHash(S({ includeUnconfirmed: true })).hash;
  assert.match(h, /(^|&)u=1/);
  assert.equal(decodeState(h).includeUnconfirmed, true);
  assert.equal(decodeState('u=x').includeUnconfirmed, false);
});

test('card chip, board header chip and the #1 "why" line say availability is not confirmed', async () => {
  const { areaChip } = await import('../src/ui/model.js');
  const { medicalHeader, boardContext, whyLine } = await import('../src/ui/board-model.js');
  const st = S({ location: { state: 'VA', zip: '24011' } });
  const rows = sortRows(computeRows(data, st)).map((r, i) => ({ ...r, rank: i + 1 }));
  const t71 = rows.find((r) => r.code === 'T71');
  const chip = areaChip(t71, 'Virginia', '24011');
  assert.equal(chip.text, 'Serves part of Virginia: confirm your county');
  assert.match(chip.title, /Availability not confirmed/);
  assert.match(chip.title, /24011/);
  assert.equal(areaChip(rows.find((r) => r.code === '104'), 'Virginia', '24011'), null);
  const ctx = boardContext(rows, st);
  const hd = medicalHeader(t71, rows.slice(0, 3), ctx);
  assert.ok(hd.chips.some((c) => c.tone === 'area' && c.text === 'Part of VA'), JSON.stringify(hd.chips));
  if (t71.rank === 1) assert.match(whyLine(t71, rows.slice(0, 3), ctx), /^Lowest total if it serves your county/);
  assert.doesNotMatch(whyLine(rows.find((r) => r.area !== 'partial'), rows.slice(0, 3), ctx), /county/);
});
