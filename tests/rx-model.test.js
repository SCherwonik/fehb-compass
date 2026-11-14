// Brochure prescription model: real data from data/brochure_facts.json (verified pipeline output).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  setBrochureFacts, rxFor, normalizeUrl, extractUrl, citation, tierNumber, rxSummaryRows, annualDrugCost,
  glp1Covered, groupChanges, CHANGE_CATEGORIES, lookupFor, parseCaps, planMeds,
} from '../src/ui/rx-model.js';
import { buildMatrix } from '../src/ui/matrix-model.js';

const FACTS = JSON.parse(fs.readFileSync(new URL('../data/brochure_facts.json', import.meta.url), 'utf8'));
const BENEFITS = JSON.parse(fs.readFileSync(new URL('../data/benefits.json', import.meta.url), 'utf8'));
setBrochureFacts(FACTS);

const codesOf = (brochure) => FACTS.meta.brochures[brochure].plan_codes;
const tier = (rx, name) => rx.tiers.find((t) => t.name === name);

// ---------- rxFor ----------

test('rxFor: 73-891 (UnitedHealthcare HDHP V41) Tier 1 retail $15, mail $37.50, page 80', () => {
  const [code] = codesOf('73-891');
  const rx = rxFor(code);
  const t1 = tier(rx, 'Tier 1');
  assert.deepEqual([t1.retail30.value, t1.retail30.unit], [15, 'usd']);
  assert.equal(t1.retail30.text, '$15');
  assert.deepEqual([t1.mail.value, t1.mail.unit], [37.5, 'usd']);
  assert.equal(t1.mail.text, '$37.50');
  assert.equal(t1.retail90, null);
  assert.equal(t1.number, 1);
  assert.equal(t1.deductibleApplies, true);
  assert.equal(t1.retail30.cite.label, 'Brochure p.80');
  assert.equal(t1.retail30.cite.href, 'https://www.opm.gov/healthcare-insurance/healthcare/plan-information/plans/pdf/2027/brochures/73-891.pdf#page=80');
  assert.equal(t1.badge, null);
  assert.equal(rx.pbm.text, 'OptumRx');
});

test('rxFor: 71-005 (Blue Cross) Standard Tier 1 $7.50; Basic Tier 1 $15', () => {
  const [std, basic] = codesOf('71-005');
  assert.equal(rxFor(std).option, 'Standard Option');
  assert.equal(tier(rxFor(std), 'Tier 1').retail30.value, 7.5);
  assert.equal(tier(rxFor(std), 'Tier 1').retail30.text, '$7.50');
  assert.equal(tier(rxFor(std), 'Tier 2').retail30.unit, 'pct');
  assert.equal(tier(rxFor(std), 'Tier 2').retail30.text, '30%');
  assert.equal(rxFor(basic).option, 'Basic Option');
  assert.equal(tier(rxFor(basic), 'Tier 1').retail30.value, 15);
  // option filter: a matching option keeps the tiers, an unknown option falls back to every tier
  assert.equal(rxFor(basic, 'Basic Option').tiers.length, rxFor(basic).tiers.length);
  assert.equal(rxFor(basic, 'No Such Option').tiers.length, rxFor(basic).tiers.length);
});

test('rxFor: adjudicated tier (73-881 A81 Basic, mail Tier 3 $162.50) carries the badge data', () => {
  assert.ok(codesOf('73-881').includes('A81'));
  const t3 = tier(rxFor('A81'), 'Tier 3');
  assert.equal(t3.mail.value, 162.5);
  assert.equal(t3.crosscheck, 'adjudicated');
  assert.ok(t3.badge, 'badge present');
  assert.equal(t3.badge.kind, 'differs');
  assert.equal(t3.badge.text, 'Differs from OPM spreadsheet');
  assert.match(t3.badge.sheet, /\$60/);
  assert.match(t3.badge.why, /brochure/i);
  assert.equal(t3.badge.cite.label, 'Brochure p.65');
});

test('rxFor: every adjudicated_brochure tier has a badge; match/n-a tiers do not; unresolved -> caution', () => {
  let badges = 0;
  for (const code of Object.keys(FACTS.plans)) {
    for (const t of rxFor(code).tiers) {
      if (t.crosscheck === 'adjudicated_brochure') { assert.ok(t.badge, `${code} ${t.name}`); badges++; }
      if (t.crosscheck === 'match' || t.crosscheck === 'n/a') assert.equal(t.badge, null);
    }
  }
  assert.ok(badges >= 30);
  // synthetic unresolved tier
  const fake = structuredClone(FACTS);
  fake.plans.V41.rx.tiers[0].crosscheck = 'unresolved';
  const t = rxFor('V41', undefined, fake).tiers[0];
  assert.equal(t.badge.kind, 'unresolved');
  assert.match(t.badge.text, /not confirmed|unresolved|check/i);
});

test('rxFor: unknown plan -> null; facts missing -> null; never throws on every plan', () => {
  assert.equal(rxFor('ZZZ'), null);
  assert.equal(rxFor('V41', undefined, null), null);
  assert.equal(rxFor('__proto__'), null);
  for (const code of Object.keys(FACTS.plans)) {
    const rx = rxFor(code);
    assert.ok(rx);
    for (const t of rx.tiers) {
      for (const k of ['retail30', 'retail90', 'mail']) {
        const c = t[k];
        if (!c) continue;
        assert.ok(['usd', 'pct', 'text'].includes(c.unit), `${code} ${t.name} ${k} unit ${c.unit}`);
        assert.equal(typeof c.text, 'string');
        if (c.unit !== 'text') assert.ok(Number.isFinite(c.value));
        if (c.cite) assert.match(c.cite.href, /^https:\/\/www\.opm\.gov\/.+\.pdf#page=\d+$/);
      }
    }
  }
});

test('tierNumber: Tier N, roman numerals, prefixed names', () => {
  assert.equal(tierNumber('Tier 1'), 1);
  assert.equal(tierNumber('Tier 0'), 0);
  assert.equal(tierNumber('Tier IV'), 4);
  assert.equal(tierNumber('Tier VI'), 6);
  assert.equal(tierNumber('Tier 1 (Preferred generic)'), 1);
  assert.equal(tierNumber('Specialty Tier 1'), null);
  assert.equal(tierNumber('Preferred generic'), null);
  assert.equal(tierNumber(null), null);
});

test('parseCaps: maximum / minimum per fill from the brochure wording', () => {
  assert.deepEqual(parseCaps('15% of the Plan allowance (up to a $150 maximum) (no deductible)'), { cap: 150, floor: null });
  assert.deepEqual(parseCaps('20% of the Plan allowance (up to a maximum of $250)'), { cap: 250, floor: null });
  assert.deepEqual(parseCaps('30% of the Plan allowance ($1,250 maximum)'), { cap: 1250, floor: null });
  assert.deepEqual(parseCaps('50% up to $200 maximum per Preferred Brand'), { cap: 200, floor: null });
  assert.deepEqual(parseCaps('25% ($30 minimum, $100 maximum)'), { cap: 100, floor: 30 });
  assert.deepEqual(parseCaps('30% coinsurance'), { cap: null, floor: null });
});

// ---------- URLs ----------

test('normalizeUrl: http/https only, www. gets https://, hostile input rejected', () => {
  assert.equal(normalizeUrl('https://www.kp.org/formulary'), 'https://www.kp.org/formulary');
  assert.equal(normalizeUrl('http://example.com/a?b=1#c'), 'http://example.com/a?b=1#c');
  assert.equal(normalizeUrl('www.uhcfeds.com'), 'https://www.uhcfeds.com/');
  assert.equal(normalizeUrl('WWW.AetnaFeds.com/Pharmacy.php'), 'https://www.aetnafeds.com/Pharmacy.php');
  assert.equal(normalizeUrl('  https://a.example.org  '), 'https://a.example.org/');
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://example.com', '//evil.example.com', 'mailto:a@b.c', 'www', 'www.', 'https://',
    'https://exa mple.com', '', null, undefined, 42, {}, [], 'kp.org/formulary', 'https://user:pass@example.com/', 'x'.repeat(3000),
    'https://example.com/\u0000', '\u202Ehttps://example.com',
  ]) {
    assert.equal(normalizeUrl(bad), null, `rejects ${String(bad).slice(0, 40)}`);
  }
});

test('extractUrl: messy brochure text -> first usable URL, per-option segments, bare domains', () => {
  assert.equal(extractUrl('www. fepblue.org'), 'https://www.fepblue.org/');
  assert.equal(extractUrl('www.fepblue.org (drug cost tool); www.fepblue.org/medicarerx for FEP Medicare Prescription Drug Program'), 'https://www.fepblue.org/');
  assert.equal(extractUrl('www. aetnafeds.com (online formulary and drug pricing search tools)'), 'https://www.aetnafeds.com/');
  assert.equal(extractUrl('kp.org/formulary'), 'https://kp.org/formulary');
  assert.equal(extractUrl('www. kp.org/feds/wa-options (Drug Lists)'), 'https://www.kp.org/feds/wa-options');
  const two = 'High Option: www. optumrx.com; Consumer Driven Option: https://welcome.optumrx.com/rxexternal/external-drug-pricing?planCode=UXZTJH016&clientCode=UXZTJH016';
  assert.equal(extractUrl(two, 'High Option'), 'https://www.optumrx.com/');
  assert.equal(extractUrl(two, 'Consumer Driven Option'), 'https://welcome.optumrx.com/rxexternal/external-drug-pricing?planCode=UXZTJH016&clientCode=UXZTJH016');
  assert.equal(extractUrl(two), 'https://www.optumrx.com/');
  assert.equal(extractUrl('Call us at 1-800-555-0100'), null);
  assert.equal(extractUrl('javascript:alert(1) www.example.com'), 'https://www.example.com/');
  assert.equal(extractUrl(null), null);
});

test('lookupFor: every plan with a lookup/formulary/website fact gets a safe https link with a citation', () => {
  let n = 0;
  for (const code of Object.keys(FACTS.plans)) {
    const l = lookupFor(code);
    if (!l) continue;
    n++;
    assert.match(l.href, /^https?:\/\//);
    assert.ok(['lookup', 'formulary', 'website'].includes(l.kind));
    assert.ok(l.cite && /^Brochure p\.\d+$/.test(l.cite.label));
  }
  assert.ok(n >= 100, `${n} plans have a lookup link`);
  assert.equal(lookupFor('V41').href, 'https://www.uhcfeds.com/');
});

test('citation: label, href to the PDF page; missing page or plan -> no href', () => {
  const c = citation({ page: 80, quote: 'x' }, 'V41');
  assert.deepEqual([c.label, c.short, c.page], ['Brochure p.80', 'p.80', 80]);
  assert.match(c.href, /73-891\.pdf#page=80$/);
  assert.equal(citation(null, 'V41'), null);
  assert.equal(citation({ quote: 'no page' }, 'V41'), null);
  assert.equal(citation({ page: 'javascript:1' }, 'V41'), null);
  assert.equal(citation({ page: 5 }, 'ZZZ').href, null);
  const hostile = structuredClone(FACTS);
  hostile.meta.brochures['73-891'].url = 'javascript:alert(1)';
  assert.equal(citation({ page: 80 }, 'V41', hostile).href, null);
});

// ---------- GLP-1 ----------

test('glp1Covered: true only when the brochure says covered === true', () => {
  assert.equal(glp1Covered('V41'), true);
  const covered = Object.keys(FACTS.plans).filter((c) => glp1Covered(c));
  assert.equal(covered.length, Object.values(FACTS.plans).filter((p) => p.rx.glp1_weight_loss?.covered === true).length);
  assert.ok(covered.length > 0 && covered.length < Object.keys(FACTS.plans).length);
  assert.equal(glp1Covered('ZZZ'), false);
  assert.equal(glp1Covered('V41', null), false);
});

// ---------- matrix rows ----------

test('rxSummaryRows: brochure rows in the Prescriptions section with citations, link buttons and best-in-row', () => {
  const plans = ['V41', '104', '111', 'A81'].map((code) => ({ code, benefits: BENEFITS['2027'][code] }));
  const extra = rxSummaryRows(plans.map((p) => p.code));
  const keys = extra.map((r) => r.key);
  for (const k of ['br:pbm', 'br:lookup', 'br:tier1', 'br:pa', 'br:step', 'br:ql', 'br:glp1w', 'br:glp1d', 'br:prev', 'br:rxoop']) {
    assert.ok(keys.includes(k), `row ${k}`);
  }
  assert.ok(extra.every((r) => r.section === 'rx'));
  const sections = buildMatrix(plans, { enrollment: 'self', extra });
  const rx = sections.find((s) => s.id === 'rx');
  const lookup = rx.rows.find((r) => r.key === 'br:lookup');
  assert.equal(lookup.cells[0].link.href, 'https://www.uhcfeds.com/');
  assert.equal(lookup.cells[0].link.text, 'Look up your drug');
  const t1 = rx.rows.find((r) => r.key === 'br:tier1');
  assert.equal(t1.cells[0].display, '$15');
  assert.equal(t1.cells[0].cite.short, 'p.80');
  assert.equal(rx.rows.find((r) => r.key === 'br:tier1:mail').cells[0].display, '$37.50');
  // brochure rows come after the spreadsheet tier rows
  const idxSheet = rx.rows.findIndex((r) => r.key === 'Tier 1');
  const idxBro = rx.rows.findIndex((r) => r.key === 'br:tier1');
  assert.ok(idxSheet >= 0 && idxBro > idxSheet);
  // tier 1 is all-dollar here: lowest wins ($7.50 for Standard Option)
  assert.deepEqual(t1.best, [1]);
  const a81 = rx.rows.find((r) => r.key === 'br:tier3').cells[3];
  assert.equal(a81.badge.text, 'Differs from OPM spreadsheet');
  // text rows have no best-in-row
  assert.deepEqual(rx.rows.find((r) => r.key === 'br:pa').best, []);
});

// ---------- annualDrugCost ----------

const V41 = () => rxFor('V41');
const STD = () => rxFor('104');

test('annualDrugCost: copay tier, retail 30-day', () => {
  // Blue Cross Basic Option Tier 1: $15 a fill, the brochure says the deductible does not apply
  const r = annualDrugCost({ name: 'Lisinopril', fillsPerYear: 12, channel: 'retail30' }, 'Tier 1', rxFor('111'));
  assert.equal(r.status, 'priced');
  assert.equal(r.perFill, 15);
  assert.equal(r.annual, 180);
  assert.equal(r.text, 'Tier 1 · $15 / 30 days · $180 a year');
  // a copay above the drug's own price: you pay the price
  const cheap = annualDrugCost({ name: 'Cheap', monthlyCost: 4, fillsPerYear: 12, channel: 'retail30' }, 'Tier 1', rxFor('111'));
  assert.equal(cheap.perFill, 4);
  // Basic Tier 2: 35% with a $175 cap per fill
  const cap = annualDrugCost({ name: 'Brand', monthlyCost: 1000, fillsPerYear: 12, channel: 'retail30' }, 'Tier 2', rxFor('111'));
  assert.equal(cap.perFill, 175);
  assert.equal(cap.annual, 2100);
});

test('annualDrugCost: coinsurance tier needs the monthly cost; with it, pct × price (cap honored)', () => {
  const miss = annualDrugCost({ name: 'Brand', fillsPerYear: 12, channel: 'retail30' }, 'Tier 2', STD());
  assert.equal(miss.status, 'missing');
  assert.match(miss.missing, /monthly cost/);
  assert.equal(miss.annual, null);
  const ok = annualDrugCost({ name: 'Brand', monthlyCost: 200, fillsPerYear: 12, channel: 'retail30' }, 'Tier 2', STD());
  assert.equal(ok.status, 'priced');
  assert.equal(ok.perFill, 60); // 30% of $200
  assert.equal(ok.annual, 720);
  assert.equal(ok.text, 'Tier 2 · 30% of $200 = $60 / 30 days · $720 a year');
  // a capped tier: synthetic 20% up to $50
  const capped = { tiers: [{ name: 'Tier 3', number: 3, deductibleApplies: false, retail30: { value: 20, unit: 'pct', text: '20% (max $50)', cap: 50, floor: null, cite: null }, retail90: null, mail: null }] };
  const c = annualDrugCost({ name: 'X', monthlyCost: 1000, fillsPerYear: 12, channel: 'retail30' }, 'Tier 3', capped);
  assert.equal(c.perFill, 50);
  assert.equal(c.annual, 600);
});

test('annualDrugCost: 90-day mail order (4 fills a year), and a missing 90-day retail amount says so', () => {
  const r = annualDrugCost({ name: 'Statin', monthlyCost: 40, fillsPerYear: 4, channel: 'mail' }, 'Tier 1', V41(), { deductibleDefault: false });
  assert.equal(r.perFill, 37.5);
  assert.equal(r.annual, 150);
  assert.equal(r.days, 90);
  assert.match(r.text, /^Tier 1 · \$37\.50 \/ 90 days · \$150 a year/);
  const m = annualDrugCost({ name: 'Statin', fillsPerYear: 4, channel: 'retail90' }, 'Tier 1', V41());
  assert.equal(m.status, 'missing');
  assert.match(m.missing, /90-day retail/);
});

test('annualDrugCost: deductible applies to a copay tier -> needs the price, says so; with it, priced', () => {
  const m = annualDrugCost({ name: 'Statin', fillsPerYear: 12, channel: 'retail30' }, 'Tier 1', V41());
  assert.equal(m.status, 'missing');
  assert.match(m.missing, /deductible/);
  const p = annualDrugCost({ name: 'Statin', monthlyCost: 40, fillsPerYear: 12, channel: 'retail30' }, 'Tier 1', V41());
  assert.equal(p.status, 'priced');
  assert.equal(p.annual, 180); // $15 x 12 once the deductible is met
  assert.equal(p.deductibleApplies, true);
  assert.match(p.text, /after the deductible/);
});

test('annualDrugCost: not covered -> full price × fills with a warning; no price -> missing', () => {
  const r = annualDrugCost({ name: 'Wegovy', monthlyCost: 1000, fillsPerYear: 12, channel: 'retail30' }, 'nc', V41());
  assert.equal(r.status, 'notcovered');
  assert.equal(r.annual, 12000);
  assert.match(r.text, /Not covered · \$1,000 \/ 30 days · \$12,000 a year/);
  assert.match(r.warning, /full price/i);
  const m = annualDrugCost({ name: 'Wegovy', fillsPerYear: 12, channel: 'retail30' }, 'nc', V41());
  assert.equal(m.status, 'notcovered');
  assert.equal(m.annual, null);
  assert.match(m.missing, /monthly cost/);
});

test('annualDrugCost: no tier recorded -> lookup; prior authorization -> pa; unknown tier name -> missing', () => {
  assert.equal(annualDrugCost({ name: 'A', channel: 'retail30' }, undefined, V41()).status, 'lookup');
  assert.equal(annualDrugCost({ name: 'A', channel: 'retail30' }, 'pa', V41()).status, 'pa');
  const u = annualDrugCost({ name: 'A', channel: 'retail30' }, 'Tier 9', V41());
  assert.equal(u.status, 'missing');
  assert.match(u.missing, /Tier 9/);
  // a bare number 0-6 maps to "Tier N"
  assert.equal(annualDrugCost({ name: 'A', monthlyCost: 40, channel: 'retail30' }, 2, V41()).tierName, 'Tier 2');
  // no rx facts at all
  assert.equal(annualDrugCost({ name: 'A', channel: 'retail30' }, 'Tier 1', null).status, 'missing');
});

test('annualDrugCost: never NaN over every plan, tier and channel', () => {
  for (const code of Object.keys(FACTS.plans)) {
    const rx = rxFor(code);
    for (const t of rx.tiers) {
      for (const channel of ['retail30', 'retail90', 'mail', 'specialty']) {
        for (const monthlyCost of [undefined, 0, 75, 2500]) {
          const r = annualDrugCost({ name: 'x', monthlyCost, fillsPerYear: channel === 'retail30' ? 12 : 4, channel }, t.name, rx);
          assert.ok(['priced', 'missing'].includes(r.status), `${code} ${t.name} ${r.status}`);
          if (r.annual != null) assert.ok(Number.isFinite(r.annual) && r.annual >= 0, `${code} ${t.name} ${channel}`);
          assert.ok(!/NaN|undefined/.test(r.text), r.text);
        }
      }
    }
  }
});

// ---------- planMeds: engine entries + display summary ----------

test('planMeds: unknown tiers are excluded with a count, priced ones become engine entries', () => {
  const meds = {
    drugs: [
      { id: 'a1', name: 'Statin', monthlyCost: 40, fillsPerYear: 12, channel: 'retail30' },
      { id: 'b2', name: 'Brand', monthlyCost: 300, fillsPerYear: 12, channel: 'retail30' },
      { id: 'c3', name: 'Mystery', fillsPerYear: 12, channel: 'retail30' },
    ],
    records: { 111: { a1: 'Tier 1', b2: 'nc' } },
  };
  const m = planMeds(FACTS, meds, '111', BENEFITS['2027']['111']);
  assert.equal(m.count, 3);
  assert.equal(m.notLookedUp, 1);
  assert.equal(m.entries.length, 2);
  assert.deepEqual(m.entries.map((e) => e.share.kind), ['usd', 'full']);
  assert.equal(m.items[2].status, 'lookup');
  assert.ok(m.items[2].lookup.href.startsWith('https://'));
  // no meds -> null
  assert.equal(planMeds(FACTS, { drugs: [], records: {} }, '111', BENEFITS['2027']['111']), null);
  // no facts -> every drug pending
  const pending = planMeds(null, meds, '111', BENEFITS['2027']['111']);
  assert.equal(pending.entries.length, 0);
  assert.equal(pending.factsMissing, true);
});

// ---------- changes_2027 ----------

test('groupChanges: fixed category order, labels, unknown category -> other, citations', () => {
  const g = groupChanges(FACTS.plans.V41.changes_2027, 'V41');
  const order = g.map((x) => x.category);
  assert.deepEqual(order, CHANGE_CATEGORIES.map((c) => c.id).filter((id) => order.includes(id)));
  const rx = g.find((x) => x.category === 'prescription');
  assert.equal(rx.label, 'Prescriptions');
  const t1 = rx.items.find((i) => /Tier 1 \$10/.test(i.from ?? ''));
  assert.ok(t1);
  assert.equal(t1.cite.short, 'p.17');
  assert.equal(groupChanges([], 'V41').length, 0);
  const odd = groupChanges([{ category: '__proto__', summary: 'S', page: 3 }, { category: 'premium', summary: 'P', page: 2 }, null, 'x'], 'V41');
  assert.deepEqual(odd.map((x) => x.category), ['premium', 'other']);
  for (const code of Object.keys(FACTS.plans)) {
    const all = groupChanges(FACTS.plans[code].changes_2027, code);
    const n = all.reduce((k, x) => k + x.items.length, 0);
    assert.equal(n, FACTS.plans[code].changes_2027.length);
  }
});
