// FEDVIP engine: premium conversion, dental preset out-of-pocket math, vision copay parsing.
// Real data: data/fedvip.json (OPM public use files, 2026 and 2027).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  annualPremium, dentalOop, visionOop, parseVisionCopays, DENTAL_PRESETS, VISION_PRESETS, DENTAL_SERVICES,
} from '../../src/engine/dental.js';

const FV = JSON.parse(fs.readFileSync(new URL('../../data/fedvip.json', import.meta.url), 'utf8'));
const Y = FV.years['2027'];
const ben = (id) => Y.benefits[id];

test('annualPremium: active = biweekly x 26, retiree = monthly x 12 (two plans, raw OPM rates)', () => {
  // Aetna Dental High, region 2 (22302 is region 2 for brochure 02AP-01), self only
  const a = Y.rates['02AP-01-High']['2'].self;
  assert.equal(a.biweekly_active, 20.08);
  assert.equal(annualPremium(a, 'active'), 522.08); // 20.08 * 26
  assert.equal(annualPremium(a, 'retiree'), 522.12); // 43.51 * 12
  // VSP Vision High (vision: one nationwide region 'all'), family
  const v = Y.rates['02AP-17-High'].all.family;
  assert.equal(annualPremium(v, 'active'), Math.round(v.biweekly_active * 26 * 100) / 100);
  assert.equal(annualPremium(v, 'retiree'), Math.round(v.monthly_retiree * 12 * 100) / 100);
});

test('annualPremium: missing or hostile rate -> null, never NaN', () => {
  assert.equal(annualPremium(null, 'active'), null);
  assert.equal(annualPremium({ biweekly_active: 'x' }, 'active'), null);
  assert.equal(annualPremium({ monthly_retiree: NaN }, 'retiree'), null);
  assert.equal(annualPremium({ biweekly_active: 10 }, 'bogus'), 260); // unknown status -> active basis
});

test('presets: documented prices, every service maps to a coverage class', () => {
  for (const s of Object.values(DENTAL_SERVICES)) {
    assert.ok(['a', 'b', 'c', 'd'].includes(s.cls));
    assert.ok(s.price > 0 && s.label);
  }
  for (const p of Object.values(DENTAL_PRESETS)) for (const [k, n] of p.services) assert.ok(DENTAL_SERVICES[k] && n > 0, k);
  assert.deepEqual(Object.keys(DENTAL_PRESETS), ['cleanings', 'typical', 'major', 'braces']);
  assert.deepEqual(Object.keys(VISION_PRESETS), ['exam', 'glasses', 'contacts']);
});

test('dentalOop by hand: Aetna Dental Standard ($50 deductible, 0/45/65%, $1,500 max)', () => {
  const b = ben('02AP-01-Standard');
  assert.equal(b.deductible.value, 50);
  // cleanings only: class A at 0%, deductible does not apply to preventive
  const c = dentalOop(b, 'cleanings');
  assert.equal(c.priced, true);
  assert.equal(c.oop, 0);
  assert.equal(c.billed, 375);
  // typical: + one $200 filling (class B): $50 deductible + 45% of $150 = $117.50
  assert.equal(dentalOop(b, 'typical').oop, 117.5);
  // major: crown $1,300 (C): $50 + 65% x 1,250 = 862.50; root canal $1,100 (C): 65% = 715
  // plan pays 375 + 437.50 + 385 = 1,197.50, under the $1,500 max -> member 1,577.50
  const m = dentalOop(b, 'major');
  assert.equal(m.oop, 1577.5);
  assert.equal(m.planPaid, 1197.5);
  assert.equal(m.capped, false);
});

test('dentalOop by hand: United Concordia Standard hits its $1,000 annual maximum', () => {
  const b = ben('02AP-14-Standard');
  assert.equal(b.annual_max.value, 1000);
  // major: plan would pay 375 + 455 + 385 = 1,215; clipped to 1,000 -> member pays 2,775 - 1,000
  const m = dentalOop(b, 'major');
  assert.equal(m.planPaid, 1000);
  assert.equal(m.oop, 1775);
  assert.equal(m.capped, true);
  // braces: 50% of $6,000 = 3,000 plan share, clipped to the $1,500 lifetime ortho max
  const br = dentalOop(b, 'braces');
  assert.equal(br.oop, 4500);
  assert.equal(br.orthoCapped, true);
});

test('dentalOop: unlimited annual max never clips; copay-schedule plans are approximate', () => {
  const hi = dentalOop(ben('02AP-01-High'), 'major'); // UNLIMITED, 60% class C, no deductible
  assert.equal(hi.capped, false);
  assert.equal(hi.oop, 0 + 0.6 * 1300 + 0.6 * 1100);
  const dom = dentalOop(ben('02AP-06-High'), 'typical'); // Dominion: "Amt. In Copayment Schedule (Approx 11%)"
  assert.equal(dom.priced, true);
  assert.equal(dom.approx, true);
  assert.equal(dom.oop, 22); // 11% of $200
});

test('dentalOop: every real 2026 and 2027 plan prices every preset to a finite number', () => {
  for (const y of ['2026', '2027']) {
    for (const [id, p] of Object.entries(FV.years[y].plans)) {
      if (p.type !== 'dental') continue;
      for (const k of Object.keys(DENTAL_PRESETS)) {
        const r = dentalOop(FV.years[y].benefits[id], k);
        assert.ok(r.priced && Number.isFinite(r.oop) && r.oop >= 0, `${y} ${id} ${k}`);
      }
    }
  }
});

test('dentalOop: unparseable cells fall back to not priced, with a warning, never NaN', () => {
  const b = structuredClone(ben('02AP-01-Standard'));
  b.class_b = { text: 'See brochure' };
  const t = dentalOop(b, 'typical');
  assert.equal(t.priced, false);
  assert.equal(t.oop, null);
  assert.match(t.warnings.join(' '), /Basic \(Class B\).*See brochure/);
  // the preset that does not touch class B still prices
  assert.equal(dentalOop(b, 'cleanings').priced, true);
  const noMax = structuredClone(ben('02AP-01-Standard'));
  noMax.annual_max = { text: 'Varies' };
  assert.equal(dentalOop(noMax, 'cleanings').priced, false);
  for (const hostile of [null, undefined, {}, { deductible: { value: NaN } }, 'x']) {
    const r = dentalOop(hostile, 'major');
    assert.equal(r.priced, false);
    assert.equal(r.oop, null);
  }
  assert.equal(dentalOop(ben('02AP-01-Standard'), 'nope').priced, false);
});

test('parseVisionCopays: reads labelled copays out of OPM text, leaves the rest unknown', () => {
  assert.deepEqual(parseVisionCopays('$0 Exam $10 Lenses'), { exam: 0, materials: 10, unlabeled: null });
  assert.deepEqual(parseVisionCopays('$10 Exam $20 Glasses'), { exam: 10, materials: 20, unlabeled: null });
  assert.deepEqual(parseVisionCopays('$0 Exam $25 Materials'), { exam: 0, materials: 25, unlabeled: null });
  assert.deepEqual(parseVisionCopays('$10'), { exam: null, materials: null, unlabeled: 10 });
  assert.deepEqual(parseVisionCopays(''), { exam: null, materials: null, unlabeled: null });
  assert.deepEqual(parseVisionCopays(null), { exam: null, materials: null, unlabeled: null });
});

test('visionOop: exam and glasses priced from copays; contacts and allowances are text only', () => {
  const metStd = ben('02AP-12-Standard'); // "$0 Exam $20 Lenses"
  assert.equal(visionOop(metStd, 'exam').oop, 0);
  const g = visionOop(metStd, 'glasses');
  assert.equal(g.oop, 20);
  assert.equal(g.priced, true);
  const c = visionOop(metStd, 'contacts');
  assert.equal(c.priced, false); // contact lens allowance is not in OPM's file
  assert.equal(c.oop, 0); // the exam copay is still known
  assert.match(c.note, /benefit details in text/i);
  const vsp = visionOop(ben('02AP-17-High'), 'glasses'); // "$10": one unlabelled copay
  assert.equal(vsp.priced, false);
  assert.ok(Number.isFinite(vsp.oop) || vsp.oop === null);
  for (const hostile of [null, {}, { copay: { text: 42 } }]) {
    const r = visionOop(hostile, 'glasses');
    assert.equal(r.priced, false);
    assert.ok(r.oop === null || Number.isFinite(r.oop));
  }
});
