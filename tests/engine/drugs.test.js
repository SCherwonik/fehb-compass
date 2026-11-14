// expectedOop / planTotal `drugs` parameter, brochure form: { label, fillsPerYear, price, share, deductibleApplies }.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expectedOop, planTotal } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';
import { setBrochureFacts, planMeds, rxFor } from '../../src/ui/rx-model.js';

const FACTS = JSON.parse(fs.readFileSync(new URL('../../data/brochure_facts.json', import.meta.url), 'utf8'));
const BEN = JSON.parse(fs.readFileSync(new URL('../../data/benefits.json', import.meta.url), 'utf8'))['2027'];
const RATES = JSON.parse(fs.readFileSync(new URL('../../data/rates.json', import.meta.url), 'utf8'))['2027'];
setBrochureFacts(FACTS);

const NO_USAGE = { pcpVisits: 0, specialistVisits: 0, erVisits: 0, hospitalStays: 0, labs: 0, imaging: 0, rxMonthly: 0 };
const usd = (v, raw = `$${v} Copayment`) => ({ value: v, kind: 'usd', raw });
const plan = (over = {}) => ({
  deductible: 1000, oopMax: 3000, coinsurance: 20, deductibleDefault: false,
  copays: { primary_care: usd(30), rx_tier1: usd(10) }, ...over,
});
const drug = (o) => ({ label: 'Drug', fillsPerYear: 12, price: 100, deductibleApplies: false, ...o });

test('brochure drug: copay without deductible adds copay × fills, reported as its own line', () => {
  const base = expectedOop(plan(), { ...NO_USAGE, pcpVisits: 2 });
  const r = expectedOop(plan(), { ...NO_USAGE, pcpVisits: 2 }, {}, [drug({ share: { kind: 'usd', value: 15 } })]);
  assert.equal(r.total, base.total + 180);
  assert.equal(r.drugsPaid, 180);
  assert.equal(r.drugs.length, 1);
  assert.equal(r.drugs[0].cost, 180);
  assert.equal(r.drugs[0].label, 'Drug');
  // the medications bucket is separate from the scenario's copays
  assert.equal(r.copays, base.copays);
});

test('brochure drug: copay is never more than the drug price', () => {
  const r = expectedOop(plan(), NO_USAGE, {}, [drug({ price: 8, share: { kind: 'usd', value: 15 } })]);
  assert.equal(r.total, 96);
});

test('brochure drug: coinsurance with cap and floor per fill', () => {
  const r = expectedOop(plan(), NO_USAGE, {}, [drug({ price: 1000, share: { kind: 'pct', value: 30, cap: 200 } })]);
  assert.equal(r.drugsPaid, 2400);
  const f = expectedOop(plan(), NO_USAGE, {}, [drug({ price: 50, share: { kind: 'pct', value: 10, floor: 20 } })]);
  assert.equal(f.drugsPaid, 240);
  const g = expectedOop(plan(), NO_USAGE, {}, [drug({ price: 10, share: { kind: 'pct', value: 10, floor: 20 } })]);
  assert.equal(g.drugsPaid, 120, 'floor never above the price');
});

test('brochure drug: deductible applies -> full price until the deductible is met, then copay', () => {
  const r = expectedOop(plan(), NO_USAGE, {}, [drug({ price: 400, deductibleApplies: true, share: { kind: 'usd', value: 15 } })]);
  // fills 1-2: $400 each (=$800), fill 3: $200 to finish the deductible + min($15, $200), fills 4-12: $15
  assert.equal(r.deductiblePaid, 1000);
  assert.equal(r.drugsPaid, 1000 + 15 + 9 * 15);
  assert.equal(r.total, 1150);
});

test('brochure drug: deductibleApplies null follows the plan default (HDHP yes, others no)', () => {
  const d = drug({ price: 400, deductibleApplies: null, share: { kind: 'usd', value: 15 } });
  assert.equal(expectedOop(plan({ deductibleDefault: true }), NO_USAGE, {}, [d]).deductiblePaid, 1000);
  assert.equal(expectedOop(plan({ deductibleDefault: false }), NO_USAGE, {}, [d]).deductiblePaid, 0);
});

test('brochure drug: the OOP max clips medications too', () => {
  const r = expectedOop(plan({ oopMax: 1000 }), NO_USAGE, {}, [drug({ price: 500, share: { kind: 'pct', value: 50 } })]);
  assert.equal(r.total, 1000);
  assert.equal(r.drugsPaid, 1000);
  const s = expectedOop(plan({ oopMax: 1000 }), { ...NO_USAGE, pcpVisits: 40 }, {}, [drug({ share: { kind: 'usd', value: 50 } })]);
  // 40 visits x $30 = $1,200 > max: nothing left for the drug
  assert.equal(s.total, 1000);
  assert.equal(s.drugsPaid, 0);
});

test('brochure drug: not covered is paid in full and does not count toward (or stop at) the OOP max', () => {
  const r = expectedOop(plan({ oopMax: 500 }), NO_USAGE, {}, [drug({ price: 1000, share: { kind: 'full' } })]);
  assert.equal(r.notCoveredPaid, 12000);
  assert.equal(r.drugsPaid, 12000);
  assert.equal(r.total, 12000);
  const both = expectedOop(plan({ oopMax: 500 }), { ...NO_USAGE, pcpVisits: 40 }, {}, [drug({ price: 1000, share: { kind: 'full' } })]);
  assert.equal(both.total, 500 + 12000);
});

test('brochure drug: $0 tier costs nothing and uses no deductible', () => {
  const r = expectedOop(plan(), NO_USAGE, {}, [drug({ price: 300, deductibleApplies: true, share: { kind: 'zero' } })]);
  assert.equal(r.total, 0);
  assert.equal(r.deductiblePaid, 0);
});

test('drugs param: legacy {tier} entries still use the OPM tier copays (unchanged behavior)', () => {
  const r = expectedOop(plan(), NO_USAGE, {}, [{ tier: 1, fillsPerYear: 12, price: 30 }]);
  assert.equal(r.total, 120);
  assert.equal(r.drugsPaid, 0);
  assert.equal(r.copays, 120);
});

test('planTotal: total = old total + medications (no deductible, under the max); breakdown carries the lines', () => {
  const p = { rate: RATES['111'], benefits: BEN['111'] };
  const inputs = { status: 'active', enrollment: 'self', usage: SCENARIOS.healthy };
  const old = planTotal(p, inputs);
  const withDrugs = planTotal(p, { ...inputs, drugs: [drug({ price: 40, share: { kind: 'usd', value: 15 } })] });
  assert.equal(withDrugs.total, Math.round((old.total + 180) * 100) / 100);
  assert.equal(withDrugs.breakdown.drugsPaid, 180);
  assert.equal(withDrugs.breakdown.drugs[0].cost, 180);
  assert.equal(withDrugs.firmness, 'estimated');
  assert.equal(old.breakdown.drugsPaid, 0);
});

test('NaN-free over all plans × enrollments with 3 sample drugs and random tiers', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const drugs = [
    { id: 'a1', name: 'Generic', monthlyCost: 12, fillsPerYear: 12, channel: 'retail30' },
    { id: 'b2', name: 'Brand', monthlyCost: 450, fillsPerYear: 4, channel: 'mail' },
    { id: 'c3', name: 'Specialty', fillsPerYear: 12, channel: 'specialty' },
  ];
  let priced = 0;
  for (const code of Object.keys(RATES)) {
    if (!BEN[code]) continue;
    const rx = rxFor(code);
    const names = (rx?.tiers ?? []).map((t) => t.name);
    const pick = () => {
      const opts = [...names, 'nc', 'pa', undefined, 'Tier 9'];
      return opts[Math.floor(rnd() * opts.length)];
    };
    const records = { [code]: Object.fromEntries(drugs.map((d) => [d.id, pick()]).filter(([, v]) => v !== undefined)) };
    const m = planMeds(FACTS, { drugs, records }, code, BEN[code]);
    for (const enrollment of ['self', 'self_plus_one', 'family']) {
      if (!RATES[code][enrollment]) continue;
      for (const scen of Object.keys(SCENARIOS)) {
        const inputs = { status: 'active', enrollment, usage: SCENARIOS[scen] };
        const base = planTotal({ rate: RATES[code], benefits: BEN[code] }, inputs);
        const t = planTotal({ rate: RATES[code], benefits: BEN[code] }, { ...inputs, drugs: m.entries });
        for (const v of [t.total, t.oop, t.breakdown.drugsPaid, t.breakdown.deductiblePaid]) assert.ok(Number.isFinite(v), `${code} ${enrollment}`);
        assert.ok(t.total >= base.total - 0.01, `${code}: medications never lower the total`);
        if (m.entries.length) priced++;
      }
    }
  }
  assert.ok(priced > 100);
});
