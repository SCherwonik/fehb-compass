// I5: hand-checked brochure values replace OPM spreadsheet errors in data/benefits.json (pipeline/benefit_overrides.json,
// applied by pipeline/build_data.py). The engine prices with them, and every display of an overridden field carries
// the "Differs from OPM spreadsheet" badge. Real 2027 data.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { planTotal, expectedOop, resolveBenefits } from '../src/engine/cost.js';
import { SCENARIOS } from '../src/engine/scenarios.js';
import { buildMatrix, overrideBadge } from '../src/ui/matrix-model.js';

const r = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
const rates = r('rates.json');
const benefits = r('benefits.json');
const NONE = { pcpVisits: 0, specialistVisits: 0, erVisits: 0, hospitalStays: 0, labs: 0, imaging: 0, rxMonthly: 0 };

test('YJ1 (Sharp Basic): the brochure deductible $4,800 per person is used, not the spreadsheet $5,500', () => {
  const b = benefits[2027].YJ1;
  assert.deepEqual(b.deductible, { self: 4800, self_plus_one: 9600, family: 9600 });
  const t = planTotal({ rate: rates[2027].YJ1, benefits: b }, { status: 'active', enrollment: 'self', usage: SCENARIOS.worst });
  assert.equal(t.breakdown.deductible, 4800);
  assert.ok(t.breakdown.deductiblePaid <= 4800);
});

test('scenario generic fills use the brochure Tier 1 price (634 $5, A84/P84 $8); L11 keeps the plan-pharmacy $10', () => {
  for (const [code, price] of [['634', 5], ['A84', 8], ['P84', 8], ['L11', 10]]) {
    const o = expectedOop(resolveBenefits(benefits[2027][code], 'self'), { ...NONE, rxMonthly: 1 });
    assert.equal(o.copays, 12 * price, code);
  }
});

test('a capped coinsurance tier from the brochure stops at its cap (P84 Tier 5: 20% up to $400)', () => {
  const usage = { ...NONE, custom: [{ kind: 'rx_specialty', label: 'Specialty drug', price: 3000, perYear: 1, tier: 5 }] };
  const o = expectedOop(resolveBenefits(benefits[2027].P84, 'self'), usage);
  assert.equal(o.custom[0].cost, 400);
});

test('matrix cells for overridden fields carry the "Differs from OPM spreadsheet" badge with the spreadsheet value', () => {
  const m = buildMatrix(['YJ1', 'YJ4', '634'].map((code) => ({ code, benefits: benefits[2027][code] })), { enrollment: 'self' });
  const cells = (key) => m.flatMap((s) => s.rows).find((x) => x.key === key).cells;
  const ded = cells('Annual deductible');
  assert.equal(ded[0].display, '$4,800');
  assert.equal(ded[0].badge.kind, 'differs');
  assert.equal(ded[0].badge.text, 'Differs from OPM spreadsheet');
  assert.equal(ded[0].badge.sheet, '$5,500');
  assert.match(ded[0].badge.why, /brochure/);
  assert.equal(ded[0].badge.cite.short, 'p.24');
  assert.equal(ded[1].badge, undefined);
  assert.equal(cells('Tier 1')[2].badge.sheet, 'Preferred Generic - $15 Copayment');
  assert.equal(overrideBadge(benefits[2027].YJ1, /^Annual deductible/).sheet, '$5,500');
  assert.equal(overrideBadge(benefits[2027].YJ4, /^Annual deductible/), null);
});
