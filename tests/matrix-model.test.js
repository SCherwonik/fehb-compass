import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MATRIX_SECTIONS, MATRIX_METADATA_FIELDS, buildMatrix, classifyField, splitEnrollment, parseCell, normalizeText,
} from '../src/ui/matrix-model.js';

const real = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../data/benefits.json', import.meta.url))); } catch { return null; }
})();

const fieldsOf = (year) => {
  const s = new Set();
  for (const p of Object.values(real[year])) for (const k of Object.keys(p.raw ?? {})) s.add(k);
  return [...s];
};

// ---------- section definitions ----------

test('sections are ordered, Prescriptions first, Medicare then Other details last', () => {
  const ids = MATRIX_SECTIONS.map((s) => s.id);
  assert.equal(ids[0], 'rx');
  assert.deepEqual(ids.slice(-3), ['oon', 'medicare', 'other']);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of MATRIX_SECTIONS) assert.ok(s.title && typeof s.title === 'string', s.id);
});

test('enrollment suffixes collapse to one base field', () => {
  assert.deepEqual(splitEnrollment('Annual deductible (Self & Family)'), { base: 'Annual deductible', tier: 'family' });
  assert.deepEqual(splitEnrollment('Annual Out-of-Pocket Maximum for Prescription (Self and Family)'), { base: 'Annual Out-of-Pocket Maximum for Prescription', tier: 'family' });
  assert.deepEqual(splitEnrollment('Net deductible (Self Plus One)'), { base: 'Net deductible', tier: 'self_plus_one' });
  assert.deepEqual(splitEnrollment('Medical account contribution (Self)'), { base: 'Medical account contribution', tier: 'self' });
  assert.deepEqual(splitEnrollment('Tier 3'), { base: 'Tier 3', tier: null });
});

test('classification of known fields', () => {
  assert.equal(classifyField('Tier 0'), 'rx');
  assert.equal(classifyField('Mail Order Pharmacy'), 'rx');
  assert.equal(classifyField('Annual Out-of-Pocket Maximum for Prescription (Self)'), 'rx');
  assert.equal(classifyField('Medicare Part D EGWP Tier 1'), 'medicare');
  assert.equal(classifyField('Primary Care Physician Office Visit with Medicare A & B Primary'), 'medicare');
  assert.equal(classifyField('Specialty Physician Office Visit with Part C'), 'medicare');
  assert.equal(classifyField('Primary Care Office Visit'), 'visits');
  assert.equal(classifyField('Hospital Room Costs'), 'hospital');
  assert.equal(classifyField('Diagnostic Tests or Procedures (e.g., CT scans, MRIs, PET Scans)'), 'diagnostics');
  assert.equal(classifyField('Applied Behavioral Analysis (ABA)'), 'therapy');
  assert.equal(classifyField('Hospital Stay--Vaginal Birth, Cesarean Birth (Maternity Care)'), 'maternity');
  assert.equal(classifyField('Inpatient Hospital (Mental Health and Substance Use Disorder Services)'), 'mental');
  assert.equal(classifyField('Artificial Insemination Services (e.g. ICI, IVI, IUI)'), 'fertility');
  assert.equal(classifyField('Hearing Aids (external)'), 'hearing');
  assert.equal(classifyField('Contact Lenses'), 'dentalvision');
  assert.equal(classifyField('Hospice Care'), 'equipment');
  assert.equal(classifyField('Chronic Disease Management: Asthma'), 'chronic');
  assert.equal(classifyField('Net deductible (Self)'), 'account');
  assert.equal(classifyField('A brand new OPM column'), 'other');
});

for (const year of ['2026', '2027']) {
  test(`${year}: every raw field maps to exactly one section and none is an orphan`, { skip: !real }, () => {
    const fields = fieldsOf(year);
    assert.ok(fields.length > 90);
    const orphans = [];
    for (const f of fields) {
      if (MATRIX_METADATA_FIELDS.includes(f)) continue;
      const { base } = splitEnrollment(f);
      const hits = MATRIX_SECTIONS.filter((s) => s.match && s.match(base));
      assert.equal(hits.length, 1, `${f} matched ${hits.map((s) => s.id).join(',') || 'nothing'}`);
      if (classifyField(f) === 'other') orphans.push(f);
    }
    assert.deepEqual(orphans, []);
  });

  test(`${year}: no text is lost; each cell carries the original wording`, { skip: !real }, () => {
    const codes = Object.keys(real[year]);
    const plans = codes.map((code) => ({ code, benefits: real[year][code] }));
    const seen = new Map(codes.map((c) => [c, new Set()]));
    for (const enrollment of ['self', 'self_plus_one', 'family']) {
      for (const status of ['active', 'retiree']) {
        const m = buildMatrix(plans, { year: Number(year), enrollment, status });
        for (const s of m) for (const r of s.rows) {
          assert.equal(r.cells.length, plans.length);
          r.cells.forEach((c, i) => {
            assert.equal(c.code, codes[i]);
            if (!c.field) return;
            assert.equal(c.text, String(real[year][c.code].raw[c.field]), `${c.code} ${c.field}`);
            seen.get(c.code).add(c.field);
            assert.doesNotMatch(`${c.display} ${c.note ?? ''}`, /undefined|NaN|null/, `${c.code} ${c.field}`);
          });
        }
      }
    }
    for (const code of codes) {
      for (const f of Object.keys(real[year][code].raw)) {
        if (MATRIX_METADATA_FIELDS.includes(f)) continue;
        assert.ok(seen.get(code).has(f), `${year} ${code} lost ${f}`);
      }
    }
  });
}

// ---------- cell parsing ----------

test('parseCell: copays, coinsurance, nothing, not covered, n/a, tier names', () => {
  assert.deepEqual(
    pick(parseCell('$30 Copayment - No deductible.')),
    { kind: 'value', display: '$30', value: 30, unit: 'usd', share: 'copay', note: 'No deductible.' },
  );
  assert.deepEqual(
    pick(parseCell('15% Coinsurance - Deductible applies.')),
    { kind: 'value', display: '15%', value: 15, unit: 'pct', share: 'coinsurance', note: 'Deductible applies.' },
  );
  const tier = parseCell('Preferred Generic - $7.50 Copayment');
  assert.equal(tier.display, '$7.50');
  assert.equal(tier.name, 'Preferred Generic');
  assert.equal(tier.value, 7.5);
  const t0 = parseCell('$0 preventive drugs and vaccines - $0 Copayment');
  assert.equal(t0.name, '$0 preventive drugs and vaccines');
  assert.equal(t0.value, 0);
  assert.equal(parseCell('Member Pays Nothing - No deductible.').kind, 'nothing');
  assert.equal(parseCell('Member Pays Nothing').value, 0);
  assert.equal(parseCell('Not Covered - Routine eyeglasses not covered.').kind, 'notcovered');
  assert.equal(parseCell('Not applicable').kind, 'na');
  assert.equal(parseCell('None - N/A').kind, 'na');
  assert.equal(parseCell('$1,000').value, 1000);
  assert.equal(parseCell('$1,000').unit, 'usd');
  assert.equal(parseCell('Covered').kind, 'covered');
  assert.equal(parseCell('Yes').display, 'Yes');
  const long = parseCell('Covered - 1 every 5 years for adults, yearly for children under the age of 22.');
  assert.equal(long.kind, 'covered');
  assert.match(long.note, /5 years/);
  assert.equal(parseCell(null).kind, 'missing');
  assert.equal(parseCell('Member Pays All Charges').display, 'You pay all');
  assert.equal(parseCell('Specialty Tier - Not applicable').kind, 'na');
  assert.equal(parseCell('Specialty Tier - Not applicable').name, 'Specialty Tier');
  assert.equal(parseCell('$3,000 Maximum').value, 3000);
  assert.equal(parseCell('Deductible waived').display, 'Waived');
  // "$0 for 5 visits, then 25%": shown as $0 but never wins a best-in-row comparison
  assert.equal(parseCell('Member Pays Nothing - 5 for Free; then 25% after deductible').value, null);
});
function pick(c) { return { kind: c.kind, display: c.display, value: c.value, unit: c.unit, share: c.share, note: c.note }; }

test('normalizeText ignores case, spacing and a trailing period', () => {
  assert.equal(normalizeText(' $30 Copayment - No deductible. '), normalizeText('$30  copayment - no deductible'));
});

// ---------- buildMatrix on a fixture ----------

const raw = (o) => ({
  'Plan Name': 'X', 'Plan Code': 'X1', 'Plan Option Name': 'Std', 'In-network/out-of-network': 'In-network',
  'Tier 1': 'Generic - $10 Copayment', 'Tier 2': 'Preferred Brand - $40 Copayment',
  'Annual deductible (Self)': '$500', 'Annual deductible (Self Plus One)': '$1,000', 'Annual deductible (Self & Family)': '$1,000',
  'Medical account contribution (Self)': 'Not applicable',
  'Primary Care Office Visit': '$20 Copayment', Chiropractic: 'Not Covered',
  'Deductible waiver (with Medicare Part B as Primary)': 'Deductible waived',
  ...o,
});
const B = (o, extra = {}) => ({ raw: raw(o), copays: {}, out_of_network: { deductible: { self: 1000, self_plus_one: 2000, family: 2000 }, oop_max: { self: null, self_plus_one: null, family: null } }, ...extra });
const fixture = [
  { code: 'A', benefits: B({}) },
  { code: 'B', benefits: B({ 'Tier 1': 'Generic - $5 Copayment', 'Annual deductible (Self & Family)': '$3,000' }) },
  { code: 'C', benefits: B({ 'Tier 2': 'Preferred Brand - 30% Coinsurance', Chiropractic: 'Not covered.' }) },
];

test('buildMatrix: shape, enrollment collapse, differs and best-in-row', () => {
  const m = buildMatrix(fixture, { year: 2027, enrollment: 'family', status: 'active' });
  assert.equal(m[0].id, 'rx');
  const row = (key) => m.flatMap((s) => s.rows).find((r) => r.key === key);
  const t1 = row('Tier 1');
  assert.equal(t1.label, 'Tier 1');
  assert.deepEqual(t1.cells.map((c) => c.code), ['A', 'B', 'C']);
  assert.equal(t1.differs, true);
  assert.deepEqual(t1.best, [1], 'lower copay wins');
  assert.equal(t1.dir, 'min');
  // $40 vs 30%: units differ, no winner
  assert.deepEqual(row('Tier 2').best, []);
  // one row for the deductible, the family variant
  const ded = row('Annual deductible');
  assert.deepEqual(ded.cells.map((c) => c.text), ['$1,000', '$3,000', '$1,000']);
  assert.equal(ded.cells[0].field, 'Annual deductible (Self & Family)');
  assert.ok(!m.flatMap((s) => s.rows).some((r) => /\(Self/.test(r.key)));
  // same wording (case/period) does not differ
  assert.equal(row('Primary Care Office Visit').differs, false);
  assert.deepEqual(row('Primary Care Office Visit').best, []);
  assert.equal(row('Chiropractic').differs, false);
  // metadata never becomes a row
  assert.ok(!m.flatMap((s) => s.rows).some((r) => MATRIX_METADATA_FIELDS.includes(r.key)));
});

test('buildMatrix: out-of-network rows come from out_of_network for the enrollment', () => {
  const m = buildMatrix(fixture, { year: 2027, enrollment: 'self', status: 'active' });
  const oon = m.find((s) => s.id === 'oon');
  const ded = oon.rows.find((r) => r.key === 'oon:deductible');
  assert.deepEqual(ded.cells.map((c) => c.display), ['$1,000', '$1,000', '$1,000']);
  const max = oon.rows.find((r) => r.key === 'oon:oop_max');
  assert.equal(max.cells[0].kind, 'na');
});

test('buildMatrix: Medicare collapsed unless retiree; Rx open', () => {
  const act = buildMatrix(fixture, { year: 2027, enrollment: 'self', status: 'active' });
  const ret = buildMatrix(fixture, { year: 2027, enrollment: 'self', status: 'retiree' });
  assert.equal(act.find((s) => s.id === 'medicare').open, false);
  assert.equal(ret.find((s) => s.id === 'medicare').open, true);
  assert.equal(act.find((s) => s.id === 'rx').open, true);
  assert.match(act.find((s) => s.id === 'medicare').note, /Medicare/);
});

test('buildMatrix: empty sections dropped; rows missing for every plan dropped; unknown fields go to Other details', () => {
  const plans = [{ code: 'A', benefits: B({ 'Brand New Field': 'Something' }) }, { code: 'B', benefits: B({}) }];
  const m = buildMatrix(plans, { year: 2027, enrollment: 'self', status: 'active' });
  assert.ok(!m.some((s) => s.rows.length === 0));
  const other = m.find((s) => s.id === 'other');
  assert.equal(other.rows[0].key, 'Brand New Field');
  assert.equal(other.rows[0].cells[1].kind, 'missing');
  assert.ok(!m.flatMap((s) => s.rows).some((r) => r.key === 'Tier 6'));
});

test('buildMatrix: extra data sources can add rows to a section (brochure hook)', () => {
  const extra = [{ section: 'rx', key: 'brochure:insulin', label: 'Insulin', get: (p) => (p.code === 'A' ? '$35 copay per month' : null) }];
  const m = buildMatrix(fixture, { year: 2027, enrollment: 'self', status: 'active', extra });
  const r = m[0].rows.find((x) => x.key === 'brochure:insulin');
  assert.equal(r.cells[0].text, '$35 copay per month');
  assert.equal(r.cells[1].kind, 'missing');
  assert.equal(r.source, 'extra');
});

test('buildMatrix: higher is better for account money', () => {
  const plans = [
    { code: 'A', benefits: B({ 'Medical account contribution (Self)': '$1,000' }) },
    { code: 'B', benefits: B({ 'Medical account contribution (Self)': '$750' }) },
  ];
  const r = buildMatrix(plans, { year: 2027, enrollment: 'self', status: 'active' })
    .flatMap((s) => s.rows).find((x) => x.key === 'Medical account contribution');
  assert.equal(r.dir, 'max');
  assert.deepEqual(r.best, [0]);
});

test('real data: parsed values agree with the pipeline copay parser where both exist', { skip: !real }, () => {
  const MAP = { 'Primary Care Office Visit': 'primary_care', 'Specialist Office Visit': 'specialist', 'Tier 1': 'rx_tier1', 'Tier 2': 'rx_tier2', 'Urgent Care': 'urgent_care' };
  let n = 0;
  for (const b of Object.values(real['2027'])) {
    for (const [field, key] of Object.entries(MAP)) {
      const c = b.copays?.[key];
      if (!c || c.value == null || c.raw !== b.raw[field]) continue;
      const p = parseCell(b.raw[field]);
      if (p.kind === 'nothing' && p.value == null) continue; // "$0 for the first 5 visits, then 25%": deliberately not compared
      assert.equal(p.value, c.value, `${field}: ${c.raw}`);
      assert.equal(p.unit, c.value === 0 ? 'zero' : c.kind === 'usd' ? 'usd' : 'pct', `${field}: ${c.raw}`);
      n += 1;
    }
  }
  assert.ok(n > 300);
});
