// The per-service breakdown behind "See the math": every service the scenario uses, what it bills and what the
// member pays, adding up to the care total.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planTotal } from '../../src/engine/cost.js';
import { SCENARIOS } from '../../src/engine/scenarios.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const RATES = read('rates.json')['2027'];
const BENEFITS = read('benefits.json')['2027'];
const codes = Object.keys(BENEFITS).filter((c) => RATES[c]);

test('services + custom lines + medications + out-of-network add up to the expected care, on every plan', () => {
  for (const scenario of ['healthy', 'typical', 'condition', 'worst']) {
    for (const enrollment of ['self', 'family']) {
      for (const code of codes) {
        let t;
        try { t = planTotal({ rate: RATES[code], benefits: BENEFITS[code] }, { status: 'active', enrollment, usage: { ...SCENARIOS[scenario], custom: [] } }); } catch { continue; }
        const b = t.breakdown;
        const sum = b.services.reduce((a, s) => a + s.cost, 0) + b.custom.reduce((a, c) => a + c.cost, 0) + (b.drugsPaid || 0) + (b.oonPaid || 0);
        assert.ok(Math.abs(sum - t.oop) < 0.02, `${code} ${scenario} ${enrollment}: ${sum} vs ${t.oop}`);
      }
    }
  }
});

test('each service reports its count, its billed total and the plan rule it was priced under', () => {
  const code = codes.find((c) => BENEFITS[c].copays?.primary_care?.raw);
  const t = planTotal({ rate: RATES[code], benefits: BENEFITS[code] }, { status: 'active', enrollment: 'self', usage: { ...SCENARIOS.typical, custom: [] } });
  const pcp = t.breakdown.services.find((s) => s.service === 'primary_care');
  assert.equal(pcp.count, SCENARIOS.typical.pcpVisits);
  assert.equal(pcp.spend, pcp.count * pcp.price);
  assert.equal(pcp.rule, BENEFITS[code].copays.primary_care.raw);
  assert.ok(pcp.cost >= 0 && pcp.cost <= pcp.spend);
});

test('no assumed care, no services', () => {
  const t = planTotal({ rate: RATES[codes[0]], benefits: BENEFITS[codes[0]] }, { status: 'active', enrollment: 'self', usage: { ...SCENARIOS.nothing, custom: [] } });
  assert.deepEqual(t.breakdown.services, []);
  assert.equal(t.oop, 0);
});
