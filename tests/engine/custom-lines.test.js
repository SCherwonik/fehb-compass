import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { planTotal, expectedOop, resolveBenefits } from '../../src/engine/cost.js';
import {
  SCENARIOS, MAX_CUSTOM_LINES, CUSTOM_KINDS, CUSTOM_PRESETS, OVERRIDE_FIELDS,
  usageFromCustom, sanitizeLine, sanitizeLines, sanitizeOverrides, applyOverrides, lineSpend,
} from '../../src/engine/scenarios.js';
import { ASSUMED_PRICES, FALLBACK_COINSURANCE } from '../../src/engine/assumptions.js';

const DATA = new URL('../../data/', import.meta.url);
const hasData = ['plans', 'rates', 'benefits'].every((f) => fs.existsSync(new URL(`${f}.json`, DATA)));
const load = (f) => JSON.parse(fs.readFileSync(new URL(`${f}.json`, DATA), 'utf8'));
const real = hasData ? { plans: load('plans'), rates: load('rates'), benefits: load('benefits') } : null;
const skip = hasData ? false : 'data/*.json not found';

const SELF = { status: 'active', enrollment: 'self' };
const plan = (code) => {
  const benefits = real.benefits['2027'][code];
  return { rate: real.rates['2027'][code], benefits, account: benefits.account_contribution };
};
/** Out-of-pocket for one custom line on an otherwise empty year. */
const one = (code, line, enrollment = 'self') =>
  planTotal(plan(code), { status: 'active', enrollment, usage: usageFromCustom([line]) });
const line = (kind, price, perYear = 1, extra = {}) => ({ label: kind, kind, price, perYear, ...extra });

// ---------- the brief's test ----------

test('3 hospital stays added to "typical" raise every 2027 plan\'s OOP, capped at its OOP max, never NaN', { skip }, () => {
  const stay = { label: 'Hospital stay', kind: 'hospital_stay', price: ASSUMED_PRICES.inpatientStay + ASSUMED_PRICES.surgery, perYear: 3 };
  let runs = 0;
  const freeSeen = [];
  for (const p of real.plans.filter((x) => x.year === 2027)) {
    const pl = { rate: real.rates['2027'][p.code], benefits: real.benefits['2027'][p.code] };
    if (!pl.rate || !pl.benefits) continue;
    pl.account = pl.benefits.account_contribution;
    for (const enrollment of ['self', 'self_plus_one', 'family']) {
      if (!pl.rate[enrollment]) continue;
      const id = `${p.code}/${enrollment}`;
      const base = planTotal(pl, { status: 'active', enrollment, usage: SCENARIOS.typical });
      const more = planTotal(pl, { status: 'active', enrollment, usage: usageFromCustom([stay], SCENARIOS.typical) });
      for (const r of [base, more]) {
        for (const k of ['premium', 'oop', 'hsaOffset', 'total']) assert.ok(Number.isFinite(r[k]), `${id} ${k}`);
        assert.ok(r.oop >= 0 && r.total >= 0, `${id} non-negative`);
      }
      const max = resolveBenefits(pl.benefits, enrollment).oopMax;
      if (max != null) assert.ok(more.oop <= max + 0.005, `${id} capped at ${max}, got ${more.oop}`);
      // A plan whose hospital admission is "Member Pays Nothing" (e.g. 891 Triple-S) genuinely adds $0.
      const free = /nothing/i.test(pl.benefits.copays.inpatient_admission?.raw ?? "") && pl.benefits.copays.inpatient_admission.kind === "text";
      if (free) { assert.equal(more.oop, base.oop, `${id} free admission`); freeSeen.push(id); }
      else if (max == null || base.oop < max - 0.005) assert.ok(more.oop > base.oop, `${id} raised (${base.oop} -> ${more.oop})`);
      else assert.equal(more.oop, base.oop, `${id} already at the max`);
      assert.equal(more.breakdown.custom.length, 1);
      assert.ok(Math.abs(more.breakdown.custom[0].cost - (more.oop - base.oop)) < 0.02, `${id} line contribution`);
      runs++;
    }
  }
  assert.ok(runs > 300, `exercised ${runs}`);
  assert.ok(freeSeen.length < runs / 20, `only a few $0-admission plans: ${freeSeen.join(" ")}`);
});

// ---------- kind -> plan field mapping on three real plans ----------

test('copay plan (571, Kaiser NW): every kind maps to its copay', { skip }, () => {
  const cases = [
    ['pcp', 200, 20], ['specialist', 300, 30], ['urgent', 250, 35], ['er', 2000, 175],
    ['hospital_stay', 30000, 325], ['surgery_outpatient', 5000, 150], ['lab', 100, 10],
    ['imaging', 1000, 100], ['therapy', 150, 30],
  ];
  for (const [kind, price, want] of cases) {
    const r = one('571', line(kind, price));
    assert.equal(r.oop, want, kind);
    assert.deepEqual(r.breakdown.warnings, [], `${kind} warnings`);
  }
  // copay larger than the price: you pay the price
  assert.equal(one('571', line('specialist', 25)).oop, 25);
  // "other" has no plan field: plan coinsurance, or the documented fallback when the plan lists none (571 lists none)
  const other = one('571', line('other', 500));
  assert.equal(other.oop, 500 * FALLBACK_COINSURANCE / 100);
  assert.equal(other.breakdown.custom[0].warnings.length, 1);
  assert.ok(other.breakdown.warnings.length >= 1);
});

test('coinsurance plan (474, APWU CDHP): deductible first, then coinsurance', { skip }, () => {
  const ded = resolveBenefits(real.benefits['2027']['474'], 'self').deductible; // 2200
  assert.equal(one('474', line('pcp', 3200)).oop, ded + (3200 - ded) * 0.15);
  assert.equal(one('474', line('lab', 100, 3)).oop, 300); // all under the deductible
  assert.equal(one('474', line('other', 3200)).oop, ded + (3200 - ded) * 0.15); // plan coinsurance 15%
  // deductible ordering: scenario events consume it before custom lines
  const withTypical = planTotal(plan('474'), { ...SELF, usage: usageFromCustom([line('specialist', 5000)], SCENARIOS.typical) });
  const typical = planTotal(plan('474'), { ...SELF, usage: SCENARIOS.typical });
  const left = ded - typical.breakdown.deductiblePaid;
  assert.ok(left > 0);
  assert.ok(Math.abs(withTypical.breakdown.custom[0].cost - (left + (5000 - left) * 0.15)) < 0.02);
});

test('HDHP (224, Aetna HSA): deductible applies even to the generic copay', { skip }, () => {
  assert.equal(one('224', line('specialist', 2500)).oop, 2000 + 500 * 0.15);
  // tier 1 is a $10 copay but HDHP rules put drugs behind the deductible: 12 x $30 all under $2,000
  assert.equal(one('224', line('rx_generic', 30, 12, { tier: 1 })).oop, 360);
  const hsa = one('224', line('pcp', 0, 0));
  assert.equal(hsa.oop, 0);
  assert.ok(hsa.hsaOffset > 0, 'HSA deposit still offsets');
});

test('OOP max clips scenario + custom lines together; total never negative', { skip }, () => {
  const lines = Array.from({ length: 5 }, () => line('hospital_stay', 100000, 2));
  for (const code of ['571', '474', '224']) {
    const r = planTotal(plan(code), { ...SELF, usage: usageFromCustom(lines, SCENARIOS.worst) });
    const max = resolveBenefits(plan(code).benefits, 'self').oopMax;
    assert.equal(r.oop, max, code);
    const sum = r.breakdown.custom.reduce((a, c) => a + c.cost, 0);
    const scen = planTotal(plan(code), { ...SELF, usage: SCENARIOS.worst }).oop;
    assert.ok(Math.abs(sum + scen - r.oop) < 0.05, `${code} contributions add up`);
    assert.ok(r.total >= 0);
  }
});

// ---------- out-of-network ----------

test('out-of-network: full cost with an "out-of-network estimate" warning when the plan lists no OON terms', { skip }, () => {
  const r = one('571', line('pcp', 200, 2, { outOfNetwork: true }));
  assert.equal(r.oop, 400);
  assert.equal(r.breakdown.oonEstimate, true);
  assert.ok(r.breakdown.custom[0].warnings.some((w) => /out-of-network estimate/i.test(w)));
  assert.ok(r.breakdown.warnings.some((w) => /out-of-network estimate/i.test(w)));
  assert.equal(r.firmness, 'estimated');
});

test('out-of-network: capped at the plan\'s own out-of-network max and kept apart from in-network', { skip }, () => {
  const r = one('474', line('specialist', 20000, 1, { outOfNetwork: true }));
  assert.equal(r.oop, 15000); // 474 lists a $15,000 self OON max
  assert.equal(r.breakdown.oonEstimate, true);
  // OON spend does not use up the in-network deductible
  const mixed = planTotal(plan('474'), { ...SELF, usage: usageFromCustom([
    line('specialist', 1000, 1, { outOfNetwork: true }), line('pcp', 3200),
  ]) });
  assert.equal(mixed.breakdown.custom[1].cost, 2200 + 1000 * 0.15);
  assert.equal(mixed.breakdown.custom[0].cost, 1000);
});

// ---------- "Start from nothing" ----------

test('"nothing" scenario is all zeros and costs premium minus offset on every plan', { skip }, () => {
  for (const v of Object.values(SCENARIOS.nothing)) assert.equal(v, 0);
  for (const code of Object.keys(real.benefits['2027'])) {
    const pl = plan(code);
    if (!pl.rate?.self) continue;
    const r = planTotal(pl, { ...SELF, usage: SCENARIOS.nothing });
    assert.equal(r.oop, 0, code);
    assert.equal(r.total, Math.round((r.premium - r.hsaOffset) * 100) / 100, code);
  }
});

// ---------- prescriptions ----------

test('rx lines: priced at the plan tier when a tier is given, in full when not', { skip }, () => {
  assert.equal(one('571', line('rx_specialty', 2000, 12, { tier: 4 })).oop, 150 * 12);
  assert.equal(one('571', line('rx_brand', 300, 2, { tier: 2 })).oop, 80);
  assert.equal(one('571', line('rx_generic', 10, 12, { tier: 0 })).oop, 0); // Tier 0: $0 preventive
  const noTier = one('571', line('rx_brand', 300, 2));
  assert.equal(noTier.oop, 600);
  assert.ok(noTier.breakdown.custom[0].notes.some((n) => /no drug tier/i.test(n)));
  // tier 5 is blank for 571: falls back to coinsurance (assumed) with a warning, never NaN
  const blank = one('571', line('rx_specialty', 1000, 1, { tier: 5 }));
  assert.equal(blank.oop, 1000 * FALLBACK_COINSURANCE / 100);
  assert.ok(blank.breakdown.custom[0].warnings.length === 1);
  // tier 6 does not exist in OPM data: fallback, warned
  const t6 = one('474', line('rx_specialty', 1000, 1, { tier: 6 }));
  assert.ok(Number.isFinite(t6.oop) && t6.breakdown.custom[0].warnings.length === 1);
  // 474 brand is 25% coinsurance, not behind the medical deductible (silent line, not an HDHP)
  assert.equal(one('474', line('rx_brand', 400, 1, { tier: 2 })).oop, 100);
});

// ---------- usageFromCustom / sanitizing ----------

test('usageFromCustom: empty list keeps the base usage, defaults to nothing', () => {
  assert.deepEqual(usageFromCustom([]), { ...SCENARIOS.nothing, custom: [] });
  assert.deepEqual(usageFromCustom(undefined, SCENARIOS.typical), { ...SCENARIOS.typical, custom: [] });
  assert.deepEqual(usageFromCustom('junk'), { ...SCENARIOS.nothing, custom: [] });
  const r = expectedOop(resolveBenefits({ deductible: 0, oop_max: 1000, copays: {} }, 'self'), usageFromCustom([]));
  assert.equal(r.total, 0);
});

test('usageFromCustom: 25 lines kept, the 26th rejected, bad lines dropped', () => {
  const many = Array.from({ length: 26 }, (_, i) => line('lab', 10 + i));
  const u = usageFromCustom(many);
  assert.equal(MAX_CUSTOM_LINES, 25);
  assert.equal(u.custom.length, 25);
  assert.equal(u.custom[24].price, 34);
  const mixed = usageFromCustom([line('bogus', 10), line('lab', NaN), line('lab', 'NaN'), null, 7, line('lab', 50)]);
  assert.deepEqual(mixed.custom.map((l) => l.price), [50]);
});

test('sanitizeLine: caps, coercion, label cleaning, tier only on rx kinds, hostile keys ignored', () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":1},"kind":"er","label":"<img src=x onerror=alert(1)>ER","price":"2500","perYear":"3","constructor":"x"}');
  const c = sanitizeLine(hostile);
  assert.deepEqual(c, { label: 'img src=x onerror=alert(1)ER', kind: 'er', price: 2500, perYear: 3 });
  assert.equal({}.polluted, undefined);
  assert.deepEqual(sanitizeLine(line('imaging', 5e12, 1e9)), { label: 'imaging', kind: 'imaging', price: 1e6, perYear: 365 });
  assert.equal(sanitizeLine(line('lab', -5)), null);
  assert.equal(sanitizeLine(line('lab', Infinity)), null);
  assert.equal(sanitizeLine(line('lab', '1e309')), null);
  assert.equal(sanitizeLine(line('lab', 10, -1)), null);
  assert.equal(sanitizeLine(line('lab', 10, 'NaN')), null);
  assert.equal(sanitizeLine(line('lab', 10.456)).price, 10.46);
  assert.equal(sanitizeLine(line('lab', 10, 2.6)).perYear, 3);
  assert.equal(sanitizeLine({ ...line('lab', 1), label: 'x'.repeat(200) }).label.length, 60);
  assert.equal(sanitizeLine({ ...line('lab', 1), label: 42 }).label, '');
  assert.equal(sanitizeLine(line('lab', 1, 1, { tier: 2 })).tier, undefined);
  assert.equal(sanitizeLine(line('rx_brand', 1, 1, { tier: 2 })).tier, 2);
  assert.equal(sanitizeLine(line('rx_brand', 1, 1, { tier: 9 })).tier, undefined);
  assert.equal(sanitizeLine(line('rx_brand', 1, 1, { tier: '3' })).tier, 3);
  assert.equal(sanitizeLine(line('pcp', 1, 1, { outOfNetwork: true })).outOfNetwork, true);
  assert.equal(sanitizeLine(line('pcp', 1, 1, { outOfNetwork: 'yes' })).outOfNetwork, undefined);
  assert.equal(sanitizeLine(['pcp', 1, 1]), null);
  assert.deepEqual(sanitizeLines(Array(40).fill(line('pcp', 1))).length, 25);
});

test('every custom kind is known to the engine and the UI metadata', () => {
  const kinds = ['pcp', 'specialist', 'urgent', 'er', 'hospital_stay', 'surgery_outpatient', 'lab', 'imaging', 'therapy',
    'rx_generic', 'rx_brand', 'rx_specialty', 'other'];
  assert.deepEqual(Object.keys(CUSTOM_KINDS).sort(), kinds.sort());
  for (const [k, m] of Object.entries(CUSTOM_KINDS)) {
    assert.ok(m.label && m.price > 0, k);
    const r = expectedOop(resolveBenefits({ deductible: 0, oop_max: 9000, coinsurance: 20, copays: {} }, 'self'),
      usageFromCustom([line(k, m.price, 2)]));
    assert.ok(Number.isFinite(r.total) && r.total >= 0, k);
  }
});

test('presets are data-driven, valid and documented', () => {
  const ids = CUSTOM_PRESETS.map((p) => p.id);
  assert.deepEqual(ids, ['surgery', 'er_admission', 'chronic']);
  for (const p of CUSTOM_PRESETS) {
    assert.ok(p.label && p.description, p.id);
    assert.deepEqual(sanitizeLines(p.lines), p.lines, `${p.id} lines are already clean`);
  }
  const surgery = CUSTOM_PRESETS[0].lines.map((l) => l.kind);
  for (const k of ['hospital_stay', 'surgery_outpatient', 'imaging', 'therapy']) assert.ok(surgery.includes(k));
  const chronic = CUSTOM_PRESETS[2].lines;
  assert.ok(chronic.some((l) => l.kind === 'specialist' && l.perYear === 12));
  assert.ok(chronic.some((l) => l.kind.startsWith('rx_') && l.perYear === 12));
  assert.ok(chronic.some((l) => l.kind === 'lab'));
});

test('lineSpend is price x times per year', () => {
  assert.equal(lineSpend(line('pcp', 150.5, 3)), 451.5);
  assert.equal(lineSpend(null), 0);
});

// ---------- fine-tune overrides ----------

test('overrides layer on a scenario, clamped to each field range; hostile keys dropped', () => {
  assert.deepEqual(OVERRIDE_FIELDS.hospitalStays.max, 6);
  assert.deepEqual(OVERRIDE_FIELDS.erVisits.max, 10);
  const o = sanitizeOverrides(JSON.parse('{"__proto__":{"x":1},"hospitalStays":99,"erVisits":"NaN","pcpVisits":"4","foo":3,"specialistVisits":-2,"rxMonthly":2.4}'));
  assert.deepEqual(o, { hospitalStays: 6, pcpVisits: 4, specialistVisits: 0, rxMonthly: 2 });
  assert.deepEqual(sanitizeOverrides(null), {});
  assert.deepEqual(sanitizeOverrides([1, 2]), {});
  const u = applyOverrides(SCENARIOS.typical, { hospitalStays: 3, erVisits: 2 });
  assert.equal(u.hospitalStays, 3);
  assert.equal(u.erVisits, 2);
  assert.equal(u.labs, SCENARIOS.typical.labs);
  assert.deepEqual(applyOverrides(SCENARIOS.worst, {}), { ...SCENARIOS.worst });
});

test('costInputs layers overrides and custom lines on the chosen scenario', async () => {
  const { costInputs } = await import('../../src/ui/model.js');
  const st = { status: 'active', enrollment: 'self', scenario: 'typical', overrides: { hospitalStays: 3 }, custom: [line('er', 2200, 2)] };
  const u = costInputs(st).usage;
  assert.equal(u.hospitalStays, 3);
  assert.equal(u.pcpVisits, SCENARIOS.typical.pcpVisits);
  assert.deepEqual(u.custom, [line('er', 2200, 2)]);
  const n = costInputs({ ...st, scenario: 'nothing', overrides: {}, custom: [] }).usage;
  assert.deepEqual(n, { ...SCENARIOS.nothing, custom: [] });
  assert.deepEqual(costInputs({ status: 'active', enrollment: 'self', scenario: 'bogus' }).usage, { ...SCENARIOS.typical, custom: [] });
});

test('a blank plan field is described in plain English, not as "blank"', { skip }, () => {
  const w = one('571', line('rx_specialty', 1000, 1, { tier: 5 })).breakdown.custom[0].warnings[0];
  assert.ok(!/blank|""/.test(w), w);
  assert.match(w, /no tier 5 drug benefit|has no entry/i);
});
