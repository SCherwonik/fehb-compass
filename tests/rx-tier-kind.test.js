// Prescription tier normalization: canonical kinds for named tiers, alignment keys, board rows, recorded-tier compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  setBrochureFacts, rxFor, tierKind, tierKindInfo, findTier, annualDrugCost, rxSummaryRows, planMeds, TIER_KINDS,
} from '../src/ui/rx-model.js';
import { buildMatrix } from '../src/ui/matrix-model.js';
import { sanitizeRecord, sanitizeMeds } from '../src/ui/meds-store.js';

const FACTS = JSON.parse(fs.readFileSync(new URL('../data/brochure_facts.json', import.meta.url), 'utf8'));
const BENEFITS = JSON.parse(fs.readFileSync(new URL('../data/benefits.json', import.meta.url), 'utf8'));
setBrochureFacts(FACTS);

const kinds = (code) => rxFor(code).tiers.map((t) => [t.name, t.kind]);
const slots = (code) => rxFor(code).tiers.map((t) => t.slot);

test('tierKind: label first, then name text; pure on strings and objects', () => {
  assert.equal(tierKind({ name: 'Tier 3', label: 'non-preferred brand' }), 'non-preferred-brand');
  assert.equal(tierKind({ name: 'Weird name', label: 'generic' }), 'generic');
  assert.equal(tierKind('Preferred Generic (PG)'), 'generic');
  assert.equal(tierKind('Preferred brand and generic'), 'preferred-brand');
  assert.equal(tierKind('Non-preferred generic and brand'), 'non-preferred-brand');
  assert.equal(tierKind('Non-Preferred Specialty drugs'), 'non-preferred-specialty');
  assert.equal(tierKind('Preferred Specialty'), 'preferred-specialty');
  assert.equal(tierKind('Specialty Tier 2'), 'specialty');
  assert.equal(tierKind('Insulin'), 'other');
  assert.equal(tierKind('Anti-Obesity Medications (glucagon-like peptide-1)'), 'other');
  assert.equal(tierKind('Tier 2'), 'other', 'a bare number says nothing about the kind');
  assert.equal(tierKind(null), 'other');
  assert.ok(TIER_KINDS.every((k) => typeof k.id === 'string' && k.label));
  // label and name disagreeing is reported, not hidden
  assert.equal(tierKindInfo({ name: 'Preferred Generic', label: 'specialty' }).conflict, true);
  assert.equal(tierKindInfo({ name: 'Specialty', label: 'preferred specialty' }).conflict, false);
});

test('V31: named tiers map by label; the two generic and the two specialty tiers stay separate in brochure order', () => {
  const rx = rxFor('V31');
  assert.equal(rx.tiers.length, 13);
  assert.ok(rx.tiers.every((t) => t.number === null));
  assert.deepEqual(kinds('V31').slice(0, 6), [
    ['Low cost generic formulary', 'generic'], ['High cost generic formulary', 'generic'],
    ['Preferred brand-name formulary', 'preferred-brand'], ['Non-preferred brand-name formulary', 'non-preferred-brand'],
    ['Generic specialty drugs', 'specialty'], ['Brand-name specialty drugs', 'specialty'],
  ]);
  assert.deepEqual(slots('V31').slice(0, 6), ['generic', 'generic#2', 'preferred-brand', 'non-preferred-brand', 'specialty', 'specialty#2']);
  assert.equal(new Set(slots('V31')).size, 13, 'no two tiers share an alignment key: nothing merged or dropped');
  assert.equal(rxFor('V31').tiers[1].retail30.value, 25, 'the second generic tier keeps its own amounts');
});

test('JN1: Preferred/Non-preferred, brand-or-generic wording and specialty tiers', () => {
  assert.deepEqual(kinds('JN1'), [
    ['Preferred generic (PG)', 'generic'], ['Preferred brand (PB)', 'preferred-brand'],
    ['Non-preferred (NP), generic or brand name', 'non-preferred-brand'],
    ['Preferred specialty (PSP)', 'preferred-specialty'], ['Non-preferred specialty (NPSP)', 'non-preferred-specialty'],
  ]);
  // "50% up to $700 maximum" was extracted as a $700 copay: read as the 50% coinsurance with its cap
  const np = rxFor('JN1').tiers[4].retail30;
  assert.deepEqual([np.unit, np.value, np.cap], ['pct', 50, 700]);
  assert.equal(np.text, '50% (max $700)');
  // the retail 90-day amount is stated for the first three tiers only
  assert.deepEqual(rxFor('JN1').tiers.map((t) => t.retail90 !== null), [true, true, true, false, false]);
});

test('224: Aetna HDHP names, mail order not available for specialty', () => {
  assert.deepEqual(kinds('224').map((x) => x[1]), ['generic', 'preferred-brand', 'non-preferred-brand', 'preferred-specialty', 'non-preferred-specialty']);
  assert.equal(rxFor('224').tiers[3].mail.unit, 'text');
  assert.ok(rxFor('224').tiers.every((t) => t.retail90 === null), 'no retail 90-day amount in the brochure');
});

test('341: slashed and prefixed names; insulin, GLP-1 and preventive are "other" topics, not brand tiers', () => {
  assert.deepEqual(kinds('341'), [
    ['Generic/Preferred', 'generic'], ['Non-Preferred', 'non-preferred-brand'],
    ['Anti-Obesity Medications (glucagon-like peptide-1)', 'other'], ['Preferred Insulin', 'other'],
    ['Specialty - Generic and Preferred', 'preferred-specialty'], ['Specialty - Non-Preferred', 'non-preferred-specialty'],
    ['Preventive care medications', 'other'], ['Contraceptive drugs and devices', 'other'],
  ]);
  assert.deepEqual(slots('341').filter((s) => s.startsWith('other')), ['other:weight-loss', 'other:insulin', 'other:preventive', 'other:contraceptive']);
});

test('QQ4: a numbered name inside a named plan, a long specialty name', () => {
  const rx = rxFor('QQ4');
  assert.equal(rx.tiers[0].name, 'Tier 1 (Preferred generic)');
  assert.equal(rx.tiers[0].number, 1);
  assert.deepEqual(rx.tiers.map((t) => t.kind), ['generic', 'preferred-brand', 'specialty']);
  assert.equal(rx.tiers[2].number, null);
});

test('numbered plan (111): keeps numbers; kinds still come from the label', () => {
  const rx = rxFor('111');
  assert.deepEqual(rx.tiers.map((t) => t.number), rx.tiers.map((_, i) => i + 1));
  assert.equal(rx.tiers[0].kind, 'generic');
  assert.equal(rx.tiers[1].kind, 'preferred-brand');
});

test('every plan: slots unique within a plan, kind always one of TIER_KINDS, numbered tiers keep their number', () => {
  const ids = new Set(TIER_KINDS.map((k) => k.id));
  let plans = 0;
  for (const code of Object.keys(FACTS.plans)) {
    const rx = rxFor(code);
    if (!rx?.tiers.length) continue;
    plans++;
    assert.equal(new Set(rx.tiers.map((t) => t.slot)).size, rx.tiers.length, `${code} slots unique`);
    for (const t of rx.tiers) {
      assert.ok(ids.has(t.kind), `${code} ${t.name}`);
      if (/^\s*tier\s+\d/i.test(t.name)) assert.notEqual(t.number, null);
    }
  }
  assert.equal(plans, 117);
});

// ---------- recorded tiers: backward compatible ----------

test('findTier: existing stored values (names, "Tier N", numbers) still resolve; kind:<slot> resolves on named plans', () => {
  const v31 = rxFor('V31');
  const n111 = rxFor('111');
  assert.equal(findTier(n111, 'Tier 2').name, 'Tier 2');
  assert.equal(findTier(n111, 2).name, 'Tier 2');
  assert.equal(findTier(v31, 'Preferred brand-name formulary').kind, 'preferred-brand');
  assert.equal(findTier(v31, 'Tier 2'), undefined, 'a number never guesses a named tier');
  assert.equal(findTier(v31, 'kind:non-preferred-brand').name, 'Non-preferred brand-name formulary');
  assert.equal(findTier(v31, 'kind:generic#2').name, 'High cost generic formulary');
  assert.equal(findTier(v31, 'kind:specialty#3'), undefined);
  assert.equal(findTier(null, 'Tier 1'), undefined);
});

test('annualDrugCost: a named-tier plan prices by the plan’s own name and by kind; old numeric values on numbered plans are unchanged', () => {
  const drug = { name: 'X', fillsPerYear: 12, channel: 'retail30' };
  const byName = annualDrugCost(drug, 'Low cost generic formulary', rxFor('V31'));
  assert.equal(byName.status, 'priced');
  assert.equal(byName.perFill, 5);
  const byKind = annualDrugCost(drug, 'kind:generic', rxFor('V31'));
  assert.equal(byKind.perFill, 5);
  assert.equal(byKind.tierName, 'Low cost generic formulary');
  assert.equal(annualDrugCost(drug, 'kind:generic#2', rxFor('V31')).perFill, 25);
  assert.equal(annualDrugCost(drug, 'kind:specialty#3', rxFor('V31')).status, 'missing');
  assert.equal(annualDrugCost(drug, 2, rxFor('111')).tierName, 'Tier 2');
  assert.equal(annualDrugCost(drug, 'Tier 1', rxFor('111')).perFill, 15);
  // planMeds end to end with a stored record on a named plan
  const meds = { drugs: [{ id: 'a', name: 'Drug', monthlyCost: 100, fillsPerYear: 12, channel: 'retail30' }], records: { JN1: { a: 'Preferred generic (PG)' }, V31: { a: 'kind:preferred-brand' } } };
  assert.equal(planMeds(FACTS, meds, 'JN1', null).items[0].perFill, 3);
  assert.equal(planMeds(FACTS, meds, 'V31', null).items[0].perFill, 100, 'preferred brand $150 is capped at the drug price');
});

test('meds store accepts the old shapes and the kind: form; nothing about it reaches a URL', () => {
  assert.equal(sanitizeRecord(2), 'Tier 2');
  assert.equal(sanitizeRecord('Tier 3'), 'Tier 3');
  assert.equal(sanitizeRecord('Preferred Generic (PG)'), 'Preferred Generic (PG)');
  assert.equal(sanitizeRecord('kind:non-preferred-brand'), 'kind:non-preferred-brand');
  assert.equal(sanitizeRecord('kind:<x>'), null);
  const kept = sanitizeMeds({ drugs: [{ id: 'a', name: 'A' }], records: { JN1: { a: 'kind:generic' }, 111: { a: 2 } } });
  assert.deepEqual(kept.records, { JN1: { a: 'kind:generic' }, 111: { a: 'Tier 2' } });
  const src = fs.readFileSync(new URL('../src/ui/rx-model.js', import.meta.url), 'utf8');
  assert.ok(!/location\.hash|history\.|URLSearchParams/.test(src));
});

// ---------- board rows ----------

const plansFor = (codes) => codes.map((code) => ({ code, benefits: BENEFITS['2027'][code] }));
const rxSection = (codes) => buildMatrix(plansFor(codes), { enrollment: 'self', extra: rxSummaryRows(codes) }).find((s) => s.id === 'rx');

test('rxSummaryRows: all-numbered plans keep the per-number rows exactly as before', () => {
  const keys = rxSummaryRows(['V41', '104', '111', 'A81']).map((r) => r.key);
  assert.ok(keys.includes('br:tier1') && keys.includes('br:tier3:mail'));
  assert.ok(!keys.some((k) => k.startsWith('br:kind:')));
});

test('rxSummaryRows: mixed schemes line up by kind with each carrier’s own tier name in the cell', () => {
  const codes = ['V31', 'JN1', '224', '111'];
  const rx = rxSection(codes);
  const keys = rx.rows.map((r) => r.key).filter((k) => k.startsWith('br:kind:'));
  assert.ok(!rx.rows.some((r) => r.key.startsWith('br:tier') || r.key.startsWith('br:named')));
  const gen = rx.rows.find((r) => r.key === 'br:kind:generic');
  assert.equal(gen.label, 'Generic · retail 30-day');
  assert.deepEqual(gen.cells.map((c) => c.name), ['Low cost generic formulary', 'Preferred generic (PG)', 'Preferred Generic', 'Tier 1']);
  assert.deepEqual(gen.cells.map((c) => c.display), ['$5', '$3', '$10', '$15']);
  // the second generic tier of V31 gets its own row; the other plans have no cell there
  const gen2 = rx.rows.find((r) => r.key === 'br:kind:generic#2');
  assert.equal(gen2.label, 'Generic (2) · retail 30-day');
  assert.equal(gen2.cells[0].name, 'High cost generic formulary');
  assert.equal(gen2.cells[1].display, 'Not listed');
  // canonical kind order
  const order = keys.filter((k) => !/:(r90|mail)$/.test(k));
  assert.ok(order.indexOf('br:kind:generic') < order.indexOf('br:kind:preferred-brand'));
  assert.ok(order.indexOf('br:kind:preferred-brand') < order.indexOf('br:kind:non-preferred-brand'));
  assert.ok(order.indexOf('br:kind:non-preferred-brand') < order.indexOf('br:kind:preferred-specialty'));
  assert.ok(order.indexOf('br:kind:specialty') < order.indexOf('br:kind:preferred-specialty'));
});

test('rxSummaryRows: the retail 90-day row exists for named tiers; what the brochure states is shown, the rest is "Not stated in the brochure"', () => {
  const rx = rxSection(['V31', 'JN1', '224']);
  const r90 = rx.rows.find((r) => r.key === 'br:kind:generic:r90');
  assert.ok(r90, 'retail 90-day row present');
  assert.equal(r90.cells[0].display, 'Not stated in the brochure'); // V31: nothing stated
  assert.equal(r90.cells[1].display, '$6'); // JN1: two copays
  assert.equal(r90.cells[2].display, 'Not stated in the brochure'); // 224: nothing stated
  assert.equal(r90.cells[1].name, 'Preferred generic (PG)');
  const spec = rx.rows.find((r) => r.key === 'br:kind:preferred-specialty:r90');
  assert.equal(spec.cells[1].display, 'Not stated in the brochure');
  assert.equal(spec.cells[0].display, 'Not listed', 'V31 has no such tier at all: blank, not "not stated"');
  // a brochure that states 90-day retail in words keeps its words
  const w = rxSection(['251', 'JN1']).rows.find((r) => r.key === 'br:kind:generic:r90');
  assert.match(w.cells[0].display, /31-60 day/);
});

test('rxSummaryRows: other topics (insulin, weight loss) align by topic across plans', () => {
  const rx = rxSection(['V31', '341', '2G4']);
  const wl = rx.rows.find((r) => r.key === 'br:kind:other:weight-loss');
  assert.equal(wl.label, 'Weight-loss drugs (GLP-1) · retail 30-day');
  assert.deepEqual(wl.cells.map((c) => c.name), ['Medications prescribed to treat obesity', 'Anti-Obesity Medications (glucagon-like peptide-1)', 'GLP-1 (weight loss)']);
  assert.ok(rx.rows.find((r) => r.key === 'br:kind:other:insulin'));
});
