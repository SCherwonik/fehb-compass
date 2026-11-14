import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { sanitizeAgainstData, defaultState, MAX_COMPARE } from '../src/state.js';
import { dataVocabulary, computeRows, sortRows, savingsVsCurrent, planInput } from '../src/ui/model.js';

// ---------- fixture: two years, four plans ----------
const rate = (b) => ({
  self: { biweekly_active: b, monthly_retiree: b * 2 },
  self_plus_one: { biweekly_active: b * 2, monthly_retiree: b * 4 },
  family: { biweekly_active: b * 3, monthly_retiree: b * 6 },
});
const nothing = { value: null, kind: 'text', raw: 'Member Pays Nothing - No deductible' };
const copays = {
  primary_care: { value: 20, kind: 'usd', raw: '$20 Copayment - No deductible' },
  specialist: { value: 40, kind: 'usd', raw: '$40 Copayment - No deductible' },
  lab_xray: nothing, imaging: nothing, emergency: nothing,
  inpatient_admission: nothing, inpatient_surgeon: nothing,
  rx_tier1: { value: 5, kind: 'usd', raw: '$5 Copayment' },
};
const ben = (ded, oop, extra = {}) => ({
  deductible: { self: ded, self_plus_one: ded * 2, family: ded * 2 },
  oop_max: { self: oop, self_plus_one: oop * 2, family: oop * 2 },
  coinsurance: null, copays, account_type: 'Not Applicable',
  account_contribution: { self: null, self_plus_one: null, family: null }, ...extra,
});
const P = (code, year, extra = {}) => ({
  code, year, name: `Plan ${code}`, type: 'FFS', network_family: 'Blue Cross', hsa: false, hra: false, nationwide: true, ...extra,
});

const data = {
  plans: [
    P('104', 2026), P('104', 2027),
    P('224', 2026, { type: 'HDHP', hsa: true, network_family: 'Aetna' }), P('224', 2027, { type: 'HDHP', hsa: true, network_family: 'Aetna' }),
    P('E1', 2027, { type: 'HMO', network_family: 'Kaiser', nationwide: false }),
    P('X9', 2026, { network_family: 'Old' }),
    P('R5', 2027, { type: 'HMO', hra: true, network_family: 'Aetna', nationwide: false }),
  ],
  rates: {
    2026: { 104: rate(200), 224: rate(100), X9: rate(150) },
    2027: { 104: rate(210), 224: rate(110), E1: rate(90), R5: rate(120) },
  },
  benefits: {
    2026: { 104: ben(500, 6000), 224: ben(1500, 5000), X9: ben(0, 4000) },
    2027: {
      104: ben(500, 7000),
      224: ben(1700, 5000, { account_type: 'Health Savings Account', account_contribution: { self: 800, self_plus_one: 1600, family: 1600 } }),
      E1: ben(0, 3000),
      R5: ben(0, 3000, { account_type: 'Health Reimbursement Arrangement', account_contribution: { self: 5000, self_plus_one: 5000, family: 5000 } }),
    },
  },
  serviceArea: {
    104: { nationwide: true, states: [] },
    224: { nationwide: true, states: [] },
    E1: { nationwide: false, states: ['VA', 'MD'] },
    R5: { nationwide: false, states: ['TX'] },
  },
};
const vocab = dataVocabulary(data);

// ---------- sanitizeAgainstData ----------
test('vocabulary lists states from service areas and network families from plans', () => {
  assert.deepEqual([...vocab.states].sort(), ['MD', 'TX', 'VA']);
  assert.ok(vocab.networks.has('Aetna') && vocab.networks.has('Old'));
  assert.ok(vocab.plans2026.has('X9') && !vocab.plans2027.has('X9'));
});

test('sanitizeAgainstData drops unknown state codes and network names', () => {
  const s = { ...defaultState(), location: { state: 'ZZ', zip: null }, networks: ['Aetna', 'Nope', 'Kaiser'] };
  const out = sanitizeAgainstData(s, vocab);
  assert.equal(out.location.state, null);
  assert.deepEqual(out.networks, ['Aetna', 'Kaiser']);
});

test('sanitizeAgainstData keeps valid values and returns the same object when nothing changes', () => {
  const s = { ...defaultState(), location: { state: 'VA', zip: null }, networks: ['Aetna'], currentPlan2026: '104', selectedPlans: ['224'] };
  assert.equal(sanitizeAgainstData(s, vocab), s);
});

test('sanitizeAgainstData drops unknown plan codes and caps compare at MAX_COMPARE', () => {
  const s = { ...defaultState(), currentPlan2026: 'QQ', selectedPlans: ['ZZ', '104', '224', 'E1', 'R5', 'X9'] };
  const out = sanitizeAgainstData(s, vocab);
  assert.equal(out.currentPlan2026, null);
  assert.equal(MAX_COMPARE, 4);
  assert.deepEqual(out.selectedPlans, ['104', '224', 'E1', 'R5']);
});

test('sanitizeAgainstData tolerates missing vocabulary', () => {
  const s = defaultState();
  assert.deepEqual(sanitizeAgainstData(s, undefined), s);
});

// ---------- rows ----------
const st = (patch = {}) => ({ ...defaultState(), ...patch });

test('computeRows: nationwide plans only until a state is chosen; regional plans by state', () => {
  assert.deepEqual(computeRows(data, st()).map((r) => r.code).sort(), ['104', '224']);
  assert.deepEqual(computeRows(data, st({ location: { state: 'VA', zip: null } })).map((r) => r.code).sort(), ['104', '224', 'E1']);
  assert.deepEqual(computeRows(data, st({ location: { state: 'TX', zip: null } })).map((r) => r.code).sort(), ['104', '224', 'R5']);
});

test('computeRows filters by network, account preference and plan type', () => {
  const va = { location: { state: 'VA', zip: null } };
  assert.deepEqual(computeRows(data, st({ ...va, networks: ['Aetna'] })).map((r) => r.code), ['224']);
  assert.deepEqual(computeRows(data, st({ ...va, account: 'hsa' })).map((r) => r.code), ['224']);
  assert.deepEqual(computeRows(data, st({ location: { state: 'TX', zip: null }, account: 'hra' })).map((r) => r.code), ['R5']);
  assert.deepEqual(computeRows(data, st(va), { type: 'HMO' }).map((r) => r.code), ['E1']);
});

test('computeRows attaches cost, diff vs 2026 and account label', () => {
  const rows = computeRows(data, st({ location: { state: 'VA', zip: null } }));
  const r104 = rows.find((r) => r.code === '104');
  assert.equal(r104.diff.status, 'same');
  assert.equal(r104.diff.premiumChange, 260);
  assert.ok(r104.diff.flags.includes('oop_up_no_premium_cut'));
  assert.equal(rows.find((r) => r.code === 'E1').diff.status, 'new');
  const hsa = rows.find((r) => r.code === '224');
  assert.equal(hsa.account, 'HSA');
  assert.equal(hsa.cost.hsaOffset, 800);
  for (const r of rows) assert.ok(Number.isFinite(r.cost.total));
});

test('HRA offset shown on a card never exceeds expected OOP', () => {
  const [r5] = computeRows(data, st({ location: { state: 'TX', zip: null }, account: 'hra' }));
  assert.equal(r5.account, 'HRA');
  assert.ok(r5.cost.hsaOffset <= r5.cost.oop);
  assert.ok(r5.cost.total >= r5.cost.premium);
});

test('planInput tags HRA plans so the engine caps the offset', () => {
  const p = planInput(data, 2027, 'R5');
  assert.equal(p.accountType, 'HRA');
  assert.equal(planInput(data, 2027, 'nope'), null);
});

test('sortRows orders by total, premium, deductible, OOP max; ties broken by code; input untouched', () => {
  const rows = computeRows(data, st({ location: { state: 'VA', zip: null } }));
  const before = rows.map((r) => r.code);
  const byTotal = sortRows(rows, 'total');
  for (let i = 1; i < byTotal.length; i++) assert.ok(byTotal[i - 1].cost.total <= byTotal[i].cost.total);
  assert.deepEqual(sortRows(rows, 'deductible').map((r) => r.code), ['E1', '104', '224']);
  assert.deepEqual(sortRows(rows, 'oopMax').map((r) => r.code), ['E1', '224', '104']);
  assert.deepEqual(sortRows(rows, 'premium').map((r) => r.code), ['E1', '224', '104']);
  assert.deepEqual(rows.map((r) => r.code), before);
});

// ---------- savings banner ----------
test('savingsVsCurrent compares to the same code in 2027', () => {
  const s = st({ location: { state: 'VA', zip: null }, currentPlan2026: '104' });
  const rows = sortRows(computeRows(data, s), 'total');
  const v = savingsVsCurrent(data, s, rows);
  assert.equal(v.kind, 'continuing');
  assert.equal(v.current.code, '104');
  assert.equal(v.best.code, rows[0].code);
  assert.equal(v.amount, Math.round((v.current.cost.total - rows[0].cost.total) * 100) / 100);
});

test('savingsVsCurrent: ended plan compares 2026 cost to the cheapest 2027 alternative', () => {
  const s = st({ location: { state: 'VA', zip: null }, currentPlan2026: 'X9' });
  const rows = sortRows(computeRows(data, s), 'total');
  const v = savingsVsCurrent(data, s, rows);
  assert.equal(v.kind, 'ended');
  assert.equal(v.best.code, rows[0].code);
  assert.ok(Number.isFinite(v.current2026Total));
});

test('savingsVsCurrent: none without a current plan', () => {
  assert.equal(savingsVsCurrent(data, st(), []).kind, 'none');
});

// ---------- real data smoke (skips when data/ is absent) ----------
const real = (() => {
  try {
    const r = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
    return { plans: r('plans.json'), rates: r('rates.json'), benefits: r('benefits.json'), serviceArea: r('service_area.json') };
  } catch { return null; }
})();

test('real data: every eligible 2027 plan in every state yields finite totals and capped HRA offsets', { skip: !real }, () => {
  const v = dataVocabulary(real);
  for (const code of v.states) {
    for (const scenario of ['healthy', 'worst']) {
      const rows = computeRows(real, st({ location: { state: code, zip: null }, scenario, enrollment: 'family' }));
      assert.ok(rows.length > 0, code);
      for (const r of rows) {
        assert.ok(Number.isFinite(r.cost.total), `${r.code} total`);
        if (r.account === 'HRA') assert.ok(r.cost.hsaOffset <= r.cost.oop + 1e-9, `${r.code} HRA offset`);
        for (const k of ['premiumChange', 'deductibleChange', 'oopMaxChange']) {
          assert.ok(r.diff[k] === null || Number.isFinite(r.diff[k]), `${r.code} ${k}`);
        }
      }
    }
  }
});
