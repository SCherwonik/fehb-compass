import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPlans, GROUP_MODES } from '../src/ui/grouping.js';

// Minimal ranked rows: only the fields grouping reads.
const R = (code, total, family, type = 'HMO', account = null) => ({
  code, cost: { total }, plan: { code, network_family: family, type }, account,
});

// Already ranked by total (as computeRows + sortRows would hand them over).
const ROWS = [
  R('A1', 1000, 'Aetna', 'HMO'),
  R('K1', 1100, 'Kaiser Permanente', 'HMO'),
  R('A2', 1200, 'Aetna', 'HDHP', 'HSA'),
  R('B1', 1300, 'Blue Cross', 'FFS'),
  R('A3', 1400, 'Aetna', 'FFS', 'HRA'),
  R('A4', 1500, 'Aetna', 'HMO'),
  R('K2', 1600, 'Kaiser Permanente', 'HDHP', 'HSA'),
  R('X1', 1700, null, 'HMO'),
];

const codes = (g) => g.rows.map((r) => r.code);

test('empty or missing input gives []', () => {
  for (const mode of GROUP_MODES) {
    assert.deepEqual(groupPlans([], mode), []);
    assert.deepEqual(groupPlans(null, mode), []);
    assert.deepEqual(groupPlans(undefined, mode), []);
  }
});

test('top3 is one group with the first n rows and their global ranks', () => {
  const g = groupPlans(ROWS, 'top3');
  assert.equal(g.length, 1);
  assert.deepEqual(codes(g[0]), ['A1', 'K1', 'A2']);
  assert.deepEqual(g[0].rows.map((r) => r.rank), [1, 2, 3]);
  assert.equal(g[0].total, ROWS.length);
  assert.deepEqual(codes(groupPlans(ROWS, 'top3', 5)[0]), ['A1', 'K1', 'A2', 'B1', 'A3']);
  assert.equal(groupPlans(ROWS.slice(0, 2), 'top3')[0].rows.length, 2);
});

test('all preserves order and every global rank', () => {
  const g = groupPlans(ROWS, 'all');
  assert.equal(g.length, 1);
  assert.deepEqual(codes(g[0]), ROWS.map((r) => r.code));
  assert.deepEqual(g[0].rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('carrier: at most n per network family, in rank order, groups ordered by best rank', () => {
  const g = groupPlans(ROWS, 'carrier');
  assert.deepEqual(g.map((x) => x.key), ['Aetna', 'Kaiser Permanente', 'Blue Cross', 'Other']);
  assert.deepEqual(codes(g[0]), ['A1', 'A2', 'A3']); // A4 cut
  assert.deepEqual(g[0].rows.map((r) => r.rank), [1, 3, 5]); // global ranks kept
  assert.equal(g[0].total, 4);
  assert.deepEqual(codes(g[1]), ['K1', 'K2']);
  for (const grp of g) {
    assert.ok(grp.rows.length <= 3);
    const ranks = grp.rows.map((r) => r.rank);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.equal(typeof grp.label, 'string');
  }
  assert.deepEqual(codes(groupPlans(ROWS, 'carrier', 1)[0]), ['A1']);
});

test('type groups by plan type with readable labels; HDHP is its own group', () => {
  const g = groupPlans(ROWS, 'type');
  assert.deepEqual(g.map((x) => x.key), ['HMO', 'HDHP', 'FFS']);
  assert.deepEqual(codes(g[0]), ['A1', 'K1', 'A4']);
  assert.deepEqual(codes(g[1]), ['A2', 'K2']);
  assert.match(g[2].label, /PPO/);
  assert.match(g[1].label, /HDHP/);
});

test('account groups HSA, HRA and no account, ordered by best rank', () => {
  const g = groupPlans(ROWS, 'account');
  assert.deepEqual(g.map((x) => x.key), ['none', 'HSA', 'HRA']);
  assert.deepEqual(codes(g[0]), ['A1', 'K1', 'B1']);
  assert.deepEqual(codes(g[1]), ['A2', 'K2']);
  assert.deepEqual(codes(g[2]), ['A3']);
});

test('ties keep input order (stable)', () => {
  const tied = [R('Z', 500, 'Aetna'), R('Y', 500, 'Aetna'), R('X', 500, 'Aetna'), R('W', 500, 'Aetna')];
  assert.deepEqual(codes(groupPlans(tied, 'carrier')[0]), ['Z', 'Y', 'X']);
  assert.deepEqual(codes(groupPlans(tied, 'top3')[0]), ['Z', 'Y', 'X']);
});

test('a rank already on a row wins over its position; ranks are never NaN', () => {
  const pre = ROWS.slice(2).map((r, i) => ({ ...r, rank: i + 10 }));
  assert.deepEqual(groupPlans(pre, 'top3')[0].rows.map((r) => r.rank), [10, 11, 12]);
  for (const mode of GROUP_MODES) {
    for (const grp of groupPlans(ROWS, mode)) for (const r of grp.rows) assert.ok(Number.isInteger(r.rank));
  }
});

test('input rows are not mutated', () => {
  const copy = JSON.parse(JSON.stringify(ROWS));
  groupPlans(ROWS, 'carrier');
  assert.deepEqual(ROWS, copy);
});

test('unknown mode falls back to top3; bad n falls back to 3', () => {
  assert.deepEqual(codes(groupPlans(ROWS, 'bogus')[0]), ['A1', 'K1', 'A2']);
  assert.deepEqual(codes(groupPlans(ROWS, 'top3', NaN)[0]), ['A1', 'K1', 'A2']);
  assert.deepEqual(codes(groupPlans(ROWS, 'top3', 0)[0]), ['A1', 'K1', 'A2']);
});
