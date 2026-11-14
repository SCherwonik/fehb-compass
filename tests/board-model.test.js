import test from 'node:test';
import assert from 'node:assert/strict';
import {
  worstCase, valueScores, bestIndices, MEDICAL_SECTIONS, whyLine, boardContext, VALUE_WEIGHT, scopeText, medicalHeader, sectionsFor,
} from '../src/ui/board-model.js';

const usd = (value, raw = `$${value} Copayment - No deductible`) => ({ value, kind: 'usd', raw });
const row = (code, { total, premium, oop = 0, offset = 0, ded = 500, max = 6000, account = null, deposit = null, rank = 1, diff, coins = 20 } = {}) => ({
  code,
  rank,
  plan: { code, name: `Plan ${code}`, type: 'HMO', network: 'HMO', network_family: 'Aetna', nationwide: false },
  account,
  benefits: {
    copays: { primary_care: usd(20), specialist: usd(40), emergency: { value: 20, kind: 'pct', raw: '20% Coinsurance - Deductible applies' } },
    account_contribution: { self: deposit, self_plus_one: deposit, family: deposit },
  },
  cost: { total, premium, oop, hsaOffset: offset, firmness: 'estimated', breakdown: { warnings: [] } },
  facts: { premium, deductible: ded, oopMax: max, coinsurance: coins },
  diff: diff ?? { status: 'same', premiumChange: 120, premiumPct: 5, deductibleChange: 0, oopMaxChange: -500, coinsuranceChange: 0, flags: [] },
});

test('worst case = premium + OOP max minus the account money (HRA capped at OOP max)', () => {
  assert.equal(worstCase(row('a', { total: 3000, premium: 3000 }), 'self'), 9000);
  assert.equal(worstCase(row('h', { total: 2000, premium: 3000, account: 'HSA', deposit: 1000 }), 'self'), 8000);
  assert.equal(worstCase(row('r', { total: 2000, premium: 3000, account: 'HRA', deposit: 9000, max: 6000 }), 'self'), 3000);
  assert.equal(worstCase(row('n', { total: 3000, premium: 3000, max: null }), 'self'), null);
  // a deposit listed on a plan with no account type does not count (matches the cards)
  assert.equal(worstCase(row('x', { total: 3000, premium: 3000, deposit: 500 }), 'self'), 9000);
});

test('value score: 100 for the best weighted cost, proportional below it, never NaN', () => {
  const rows = [
    row('a', { total: 4000, premium: 4000, max: 4000 }), // weighted 0.75*4000 + 0.25*8000 = 5000
    row('b', { total: 6000, premium: 6000, max: 4000 }), // 0.75*6000 + 0.25*10000 = 7000
    row('c', { total: 3000, premium: 3000, max: null }), // no ceiling -> null
  ];
  assert.equal(VALUE_WEIGHT, 0.75);
  const v = valueScores(rows, 'self');
  assert.equal(v.get('a').score, 100);
  assert.equal(v.get('b').score, Math.round((100 * 5000) / 7000));
  assert.equal(v.get('c').score, null);
  assert.equal(valueScores([], 'self').size, 0);
});

test('bestIndices honors direction, skips nulls, and needs a real difference', () => {
  assert.deepEqual([...bestIndices([3, 1, 2, 1], 'min')], [1, 3]);
  assert.deepEqual([...bestIndices([3, null, 5], 'max')], [2]);
  assert.deepEqual([...bestIndices([4, 4, 4], 'min')], []); // all equal: nothing stands out
  assert.deepEqual([...bestIndices([7], 'min')], []); // a single value is not a comparison
  assert.deepEqual([...bestIndices([1, 2], null)], []);
});

test('sections are data: every row has a key, label and cell(); no cell shows NaN or undefined', () => {
  const r = row('a', { total: 3000, premium: 3000 });
  const bare = { ...row('z', { total: 1000, premium: 1000 }), facts: { premium: 1000, deductible: null, oopMax: null, coinsurance: null }, benefits: { copays: {} }, diff: { status: 'new', flags: [] } };
  const ctx = boardContext([r, bare], { enrollment: 'self', scenario: 'typical' });
  const keys = new Set();
  for (const s of MEDICAL_SECTIONS) {
    assert.ok(s.key && s.label && s.rows.length);
    for (const def of s.rows) {
      assert.ok(def.key && def.label && typeof def.cell === 'function');
      assert.ok(!keys.has(def.key), `duplicate row key ${def.key}`);
      keys.add(def.key);
      for (const x of [r, bare]) {
        const c = def.cell(x, ctx);
        const text = [c.text, c.sub ?? ''].join(' ');
        assert.doesNotMatch(text, /NaN|undefined|null/, `${def.key}: ${text}`);
        assert.ok(c.text.length > 0, `${def.key} empty`);
        if (c.value != null) assert.ok(Number.isFinite(c.value));
      }
    }
  }
  for (const k of ['total', 'premium', 'oop', 'ceiling', 'value', 'deductible', 'oopMax', 'coinsurance', 'account', 'deposit', 'chgPremium', 'chgDeductible', 'chgOopMax', 'flags', 'family', 'ptype', 'formulary']) {
    assert.ok(keys.has(k), `missing row ${k}`);
  }
  const ded = MEDICAL_SECTIONS.flatMap((s) => s.rows).find((d) => d.key === 'deductible');
  assert.equal(ded.cell(bare, ctx).text, '—');
  const chg = MEDICAL_SECTIONS.flatMap((s) => s.rows).find((d) => d.key === 'chgPremium');
  assert.equal(chg.cell(bare, ctx).text, 'New in 2027');
  assert.equal(chg.cell(r, ctx).tone, 'up');
});

test('the drug row is a clean hook for the formulary task', () => {
  const def = MEDICAL_SECTIONS.flatMap((s) => s.rows).find((d) => d.key === 'formulary');
  const c = def.cell(row('a', { total: 1, premium: 1 }), boardContext([], { enrollment: 'self' }));
  assert.equal(c.hook, 'formulary');
  assert.equal(c.text, 'Formulary lookup');
});

test('why-it-ranks line is built from the numbers', () => {
  const a = row('a', { total: 4000, premium: 3000, oop: 1000, rank: 1, max: 6000 });
  const b = row('b', { total: 4500, premium: 2500, oop: 2000, rank: 2, max: 8000 });
  const c = row('c', { total: 5200, premium: 4000, oop: 1200, rank: 3, max: 7000, ded: 100 });
  const group = [a, b, c];
  const ctx = boardContext(group, { enrollment: 'self' });
  assert.match(whyLine(a, group, ctx, 'of your top 3'), /^Lowest total/);
  assert.match(whyLine(a, group, ctx, 'of your top 3'), /\$500 less than #2/);
  assert.match(whyLine(b, group, ctx, 'of your top 3'), /^Lowest premium of your top 3/);
  assert.match(whyLine(b, group, ctx, 'of your top 3'), /\$500 more than #1/);
  assert.match(whyLine(c, group, ctx, 'of your top 3'), /^Lowest deductible of your top 3/);
  assert.doesNotMatch(whyLine(row('z', { total: 9, premium: 9, max: null, rank: 7 }), [], ctx, ''), /NaN|undefined/);
});

// ---------- real data smoke (skips when data/ is absent) ----------
import fs from 'node:fs';
import { computeRows, sortRows } from '../src/ui/model.js';
import { defaultState } from '../src/state.js';
import { groupPlans, GROUP_MODES } from '../src/ui/grouping.js';

const real = (() => {
  try {
    const r = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
    return { plans: r('plans.json'), rates: r('rates.json'), benefits: r('benefits.json'), serviceArea: r('service_area.json') };
  } catch { return null; }
})();

test('real data: every board cell and header for every plan in a big state is free of NaN', { skip: !real }, () => {
  for (const enrollment of ['self', 'family']) {
    const state = { ...defaultState(), enrollment, location: { state: 'VA', zip: null } };
    const ranked = sortRows(computeRows(real, state), 'total');
    assert.ok(ranked.length > 20);
    const ctx = boardContext(ranked, state);
    for (const mode of GROUP_MODES) {
      for (const g of groupPlans(ranked, mode)) {
        const scope = scopeText(mode, g);
        for (const r of g.rows) {
          const head = medicalHeader(r, g.rows, ctx, scope);
          assert.doesNotMatch(`${head.title} ${head.subtitle} ${head.why}`, /NaN|undefined|null/, r.code);
          for (const s of MEDICAL_SECTIONS) for (const def of s.rows) {
            const c = def.cell(r, ctx);
            assert.doesNotMatch(`${c.text} ${c.sub ?? ''}`, /NaN|undefined|null/, `${r.code} ${def.key}`);
          }
        }
      }
    }
    const scores = [...ctx.values.values()].map((v) => v.score).filter((s) => s != null);
    assert.equal(Math.max(...scores), 100);
    assert.ok(Math.min(...scores) >= 0);
  }
});

test('vs-your-plan rows: only with a baseline plan; deltas are column minus your plan', () => {
  const mine = { ...row('m', { total: 5000, premium: 3000, ded: 500, max: 6000 }), isMine: true };
  const alt = row('a', { total: 4200, premium: 3500, ded: 1000, max: 6000 });
  assert.ok(!sectionsFor(MEDICAL_SECTIONS, boardContext([alt], {})).some((s) => s.key === 'vsMine'));
  const ctx = boardContext([mine, alt], { enrollment: 'self' }, mine);
  const sec = sectionsFor(MEDICAL_SECTIONS, ctx).find((s) => s.key === 'vsMine');
  const get = (k) => sec.rows.find((d) => d.key === k);
  assert.equal(get('vsTotal').cell(alt, ctx).text, '−$800');
  assert.equal(get('vsTotal').cell(alt, ctx).tone, 'down');
  assert.equal(get('vsPremium').cell(alt, ctx).text, '+$500');
  assert.equal(get('vsOopMax').cell(alt, ctx).text, 'Same');
  assert.equal(get('vsTotal').cell(mine, ctx).text, '$5,000');
  assert.equal(get('vsTotal').cell(mine, ctx).sub, 'your baseline');
  assert.match(medicalHeader(mine, [mine], ctx, '').chips[0].text, /Your plan/);
});

test('ended plan: the board compares against what your plan cost in 2026', () => {
  const alt = row('a', { total: 4200, premium: 3500, ded: 1000, max: 6000 });
  const baseline = { code: 'X9', name: 'Old Plan', total: 5000, premium: 3000, deductible: 500, oopMax: 6000 };
  const ctx = boardContext([alt], { enrollment: 'self' }, null, baseline);
  const secs = sectionsFor(MEDICAL_SECTIONS, ctx);
  assert.ok(!secs.some((s) => s.key === 'vsMine'));
  const sec = secs.find((s) => s.key === 'vsEnded');
  assert.equal(sec.label, 'Vs your 2026 plan (ended)');
  const get = (k) => sec.rows.find((d) => d.key === k);
  assert.equal(get('vsEndedTotal').cell(alt, ctx).text, '−$800');
  assert.equal(get('vsEndedPremium').cell(alt, ctx).text, '+$500');
  assert.equal(get('vsEndedOopMax').cell(alt, ctx).text, 'Same');
  assert.ok(!sectionsFor(MEDICAL_SECTIONS, boardContext([alt], {})).some((s) => s.key === 'vsEnded'));
});

test('your plan header claims its overall rank, plus the filtered-view rank when filters are on', () => {
  const mine = { ...row('m', { total: 5000, premium: 3000 }), isMine: true, rank: 21, globalRank: 21, viewRank: 3 };
  const ctx = boardContext([mine], { enrollment: 'self' }, mine);
  const h1 = medicalHeader(mine, [mine], { ...ctx, filtersOn: true }, '');
  assert.equal(h1.rankText, '#21 overall');
  assert.equal(h1.rankSub, '#3 in this view');
  const h2 = medicalHeader({ ...mine, viewRank: null }, [mine], { ...ctx, filtersOn: true }, '');
  assert.equal(h2.rankSub, 'not in this view');
  const h3 = medicalHeader({ ...mine, viewRank: 21 }, [mine], { ...ctx, filtersOn: false }, '');
  assert.equal(h3.rankSub, undefined);
  const other = row('o', { total: 4000, premium: 3000, rank: 4 });
  assert.equal(medicalHeader(other, [other], ctx, '').rankText, '#4');
});
