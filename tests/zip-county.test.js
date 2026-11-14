// ZIP -> county lookup (data/zip_county.json, Census 2020 ZCTA-to-county): with the user's ZIP, a plan that OPM
// lists by county is confirmed ('county'), ruled out ('outside') or, when the ZIP straddles a served and an unserved
// county, still 'partial' with its own "confirm your address" chip. ZIPs missing from the lookup behave as before.
// Real 2027 OPM data and the real lookup file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipCountyLookup } from '../src/data.js';
import {
  areaStatus, areaConfirmed, servesState, areaChip, availablePlans, countsByFamily, computeRows, sortRows,
  savingsVsCurrent, rankWithMine, zipCounties,
} from '../src/ui/model.js';
import { medicalHeader, boardContext, whyLine } from '../src/ui/board-model.js';
import { defaultState } from '../src/state.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const zc = zipCountyLookup(load('zip_county.json'));
const base = { plans: load('plans.json'), rates: load('rates.json'), benefits: load('benefits.json'), serviceArea: load('service_area.json') };
const data = { ...base, zipCounty: zc };
const sa = data.serviceArea;
const p27 = data.plans.filter((p) => p.year === 2027);
const S = (o = {}) => ({ ...defaultState(), ...o });
const KAISER_MA = ['T71', 'E31', 'E34'];

test('zipCountyLookup inverts the stored county -> ZIPs file', () => {
  assert.equal(zc.zips['22302'], '51510', 'Alexandria city');
  assert.equal(zc.zips['24011'], '51770', 'Roanoke city');
  assert.deepEqual(zc.zips['20181'], ['51061', '51153'], 'Nokesville: Fauquier and Prince William');
  assert.equal(zc.names['51153'], 'Prince William County');
  assert.equal(zipCounties(zc, '22313'), null, 'an Alexandria PO-box ZIP has no ZCTA');
  assert.equal(zipCountyLookup(null), null);
  assert.equal(zipCountyLookup({ zips: {} }), null);
  assert.deepEqual(zipCountyLookup({ counties: { 51510: '22301 22302', 51059: '22302 bad' } }).zips,
    Object.assign(Object.create(null), { 22302: ['51059', '51510'], 22301: '51510' }));
});

test('areaStatus with the lookup: county confirmed, outside, straddling ZIP partial, unknown ZIP as before', () => {
  for (const code of KAISER_MA) {
    assert.equal(areaStatus(sa, code, 'VA', '22302', zc), 'county', `${code} in Alexandria`);
    assert.equal(areaStatus(sa, code, 'VA', '24011', zc), 'outside', `${code} in Roanoke`);
  }
  assert.equal(areaStatus(sa, 'T71', 'VA', '20181', zc), 'partial', 'Prince William (served) + Fauquier (not)');
  assert.equal(areaStatus(sa, 'T71', 'VA', '22313', zc), 'partial', 'PO-box ZIP: not in the lookup, unchanged');
  assert.equal(areaStatus(sa, 'T71', 'VA', '22508', zc), 'zip', 'a ZIP OPM lists still wins first');
  assert.equal(areaStatus(sa, 'T71', 'VA', null, zc), 'partial', 'no ZIP: unchanged');
  assert.equal(areaStatus(sa, 'T71', 'DC', '20001', zc), 'statewide');
  assert.equal(areaStatus(sa, '104', 'VA', '24011', zc), 'nationwide');
  // ZIP-only service areas (no whole county in the state) behave as before
  assert.equal(areaStatus(sa, 'YJ1', 'CA', '92101', zc), 'zip');
  assert.equal(areaStatus(sa, 'YJ1', 'CA', '94103', zc), 'outside');
  // without the lookup nothing changes
  assert.equal(areaStatus(sa, 'T71', 'VA', '22302'), 'partial');
  assert.equal(areaStatus(sa, 'T71', 'VA', '24011'), 'partial');
  assert.ok(areaConfirmed('county'));
  assert.equal(servesState(sa, 'T71', 'VA', '24011', zc), false);
});

test('availablePlans: Alexandria (22302) keeps the Kaiser Mid-Atlantic plans, Roanoke (24011) does not', () => {
  const alex = availablePlans(p27, sa, 'VA', '22302', zc).map((p) => p.code);
  const roa = availablePlans(p27, sa, 'VA', '24011', zc).map((p) => p.code);
  assert.notEqual(alex.length, roa.length);
  for (const code of KAISER_MA) {
    assert.ok(alex.includes(code), `${code} in 22302`);
    assert.ok(!roa.includes(code), `${code} not in 24011`);
  }
  assert.ok(roa.includes('104') && alex.includes('104'), 'nationwide plans in both');
  assert.equal(countsByFamily(p27, sa, { state: 'VA', zip: '22302', zipCounty: zc }).total, alex.length);
  assert.equal(countsByFamily(p27, sa, { state: 'VA', zip: '24011', zipCounty: zc }).total, roa.length);
  // the PO-box ZIP keeps every plan the state alone would (old behavior)
  assert.equal(availablePlans(p27, sa, 'VA', '22313', zc).length, availablePlans(p27, sa, 'VA', '22313').length);
});

test('rows: 22302 confirms T71 (no chip, may be the banner best); 24011 leaves it out', () => {
  const st = S({ location: { state: 'VA', zip: '22302' }, currentPlan2026: '104' });
  const rows = computeRows(data, st);
  const t71 = rows.find((r) => r.code === 'T71');
  assert.equal(t71.area, 'county');
  assert.equal(t71.areaSplit, null);
  assert.equal(areaChip(t71, 'Virginia', '22302', zc), null);
  const v = savingsVsCurrent(data, st, rows);
  const confirmed = sortRows(rows.filter((r) => areaConfirmed(r.area)))[0];
  assert.equal(v.best.code, confirmed.code);
  assert.ok(rows.filter((r) => areaConfirmed(r.area)).some((r) => r.code === 'T71'), 'T71 is eligible for the banner');
  const roa = computeRows(data, S({ location: { state: 'VA', zip: '24011' } }));
  assert.ok(!roa.some((r) => KAISER_MA.includes(r.code)));
  // pinned T71 in Roanoke: no longer offered for that ZIP
  const res = rankWithMine(data, S({ location: { state: 'VA', zip: '24011' }, currentPlan2026: 'T71' }), roa);
  assert.equal(res.notInState, true);
  assert.equal(res.mine.area, 'outside');
});

test('a ZIP straddling a served and an unserved county gets the "confirm your address" texts', () => {
  const st = S({ location: { state: 'VA', zip: '20181' } });
  const rows = sortRows(computeRows(data, st)).map((r, i) => ({ ...r, rank: i + 1 }));
  const t71 = rows.find((r) => r.code === 'T71');
  assert.equal(t71.area, 'partial');
  assert.deepEqual(t71.areaSplit, { counties: ['51061', '51153'], served: ['51153'], unserved: ['51061'] });
  const chip = areaChip(t71, 'Virginia', '20181', zc);
  assert.equal(chip.text, 'Serves part of your ZIP: confirm your address');
  assert.match(chip.title, /ZIP 20181 lies in Fauquier County and Prince William County/);
  assert.match(chip.title, /lists this plan for Prince William County but not Fauquier County/);
  const ctx = boardContext(rows, st);
  assert.ok(medicalHeader(t71, rows.slice(0, 3), ctx).chips.some((c) => c.tone === 'area' && c.text === 'Part of your ZIP'));
  if (t71.rank === 1) assert.match(whyLine(t71, rows.slice(0, 3), ctx), /^Lowest total if it serves your address/);
});

test('a ZIP missing from the lookup keeps the old chip, without claiming OPM cannot match ZIPs', () => {
  const rows = computeRows(data, S({ location: { state: 'VA', zip: '22313' } }));
  const t71 = rows.find((r) => r.code === 'T71');
  assert.equal(t71.area, 'partial');
  assert.equal(t71.areaSplit, null);
  const chip = areaChip(t71, 'Virginia', '22313', zc);
  assert.equal(chip.text, 'Serves part of Virginia: confirm your county');
  assert.match(chip.title, /22313 is not in the Census ZIP-to-county list/);
  assert.doesNotMatch(chip.title, /cannot match/);
});
