// Dental & Vision tab: ZIP -> state, eligibility by OPM geography, rows, board model, "vs your plan",
// changes since 2026, the add-to-total line items, and hash-safe state. Real data: data/fedvip.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lookupZip, cleanZip } from '../src/ui/zip.js';
import {
  eligiblePlans, regionFor, dvRows, rankDv, filterDvRows, dvSections, dvHeader, dvContext, dvAddOn, sanitizeDvState,
  filterDvSections, dvCarriers,
} from '../src/ui/dv-model.js';
import { annualPremium, dentalOop } from '../src/engine/dental.js';
import { sanitizeState, encodeState, decodeState, defaultState } from '../src/state.js';
import { groupPlans } from '../src/ui/grouping.js';

const FV = JSON.parse(fs.readFileSync(new URL('../data/fedvip.json', import.meta.url), 'utf8'));
const Y = FV.years['2027'];
const S = (extra = {}) => ({ ...defaultState(), ...extra, location: { state: 'VA', zip: '22302', ...(extra.location ?? {}) } });

// ---------- ZIP ----------
test('lookupZip: ZIP -> state from OPM zip3_to_states', () => {
  assert.equal(lookupZip(FV, '22302').state, 'VA');
  assert.equal(lookupZip(FV, '90210').state, 'CA');
  assert.equal(lookupZip(FV, '10001').state, 'NY');
  assert.equal(lookupZip(FV, '99501').state, 'AK');
  assert.equal(lookupZip(FV, ' 22302 ').zip, '22302');
});

test('lookupZip: a ZIP3 spanning several states resolves through zip5_state_exceptions', () => {
  assert.deepEqual(FV.zip3_to_states['205'], ['DC', 'MD', 'VA']);
  assert.equal(lookupZip(FV, '20500').state, 'DC');
  assert.equal(lookupZip(FV, '20588').state, 'MD');
  assert.equal(lookupZip(FV, '20598').state, 'VA');
  assert.equal(lookupZip(FV, '06390').state, 'NY'); // 063 is CT except this one
  assert.equal(lookupZip(FV, '06320').state, 'CT');
  // a ZIP5 in a multi-state ZIP3 that OPM does not list: we do not guess
  const amb = lookupZip(FV, '20512');
  assert.equal(amb.state, null);
  assert.equal(amb.reason, 'ambiguous');
  assert.deepEqual(amb.candidates, ['DC', 'MD', 'VA']);
});

test('lookupZip: unknown ZIPs and ZIPs OPM gives no state', () => {
  const u = lookupZip(FV, '09001'); // APO/FPO: not in OPM's file
  assert.equal(u.state, null);
  assert.equal(u.reason, 'unknown');
  assert.equal(u.priced, false);
  const pr = lookupZip(FV, '00901'); // Puerto Rico: OPM's file says "No State Mapping Found", but plans are listed
  assert.equal(pr.state, null);
  assert.equal(pr.reason, 'nostate');
  assert.equal(pr.priced, true); // dental eligibility and regions still work
  const mil = lookupZip(FV, '97003'); // OPM labels this one "Military"
  assert.equal(mil.state, null);
});

test('lookupZip / cleanZip: hostile inputs never throw and never set a state', () => {
  for (const bad of [null, undefined, 22302, '2230', '223021', 'abcde', '22 302', '__proto__', 'constructor', '<img>', '２２３０２', '0x123', '-2230']) {
    const r = lookupZip(FV, bad);
    assert.equal(r.state, null, String(bad));
    assert.equal(r.reason, 'format', String(bad));
  }
  assert.equal(cleanZip('22302-1234'), '22302');
  assert.equal(cleanZip('2230'), null);
  assert.equal(lookupZip(null, '22302').reason, 'loading');
  assert.equal(lookupZip({}, '22302').reason, 'unknown');
});

// ---------- eligibility ----------
test('eligiblePlans: nationwide plans at 22302, regional only where OPM geography lists them', () => {
  const dental = eligiblePlans(FV, '22302', 'dental').map((e) => e.id);
  for (const id of ['02AP-01-High', '02AP-05-Standard', '02AP-11-High', '02AP-15-High']) assert.ok(dental.includes(id), id);
  assert.ok(dental.includes('02AP-06-High'), 'Dominion National serves parts of Virginia (ZIP3 223)');
  assert.ok(dental.includes('02AP-10-Standard'), 'Humana is listed for ZIP3 223');
  assert.ok(!dental.includes('02AP-07-High'), 'EmblemHealth is New York area only');
  assert.ok(!dental.includes('02AP-13-High'), 'Triple-S is Puerto Rico only');
  const la = eligiblePlans(FV, '90210', 'dental').map((e) => e.id);
  assert.ok(!la.includes('02AP-06-High'), 'no Dominion in California');
  const ny = eligiblePlans(FV, '10001', 'dental').map((e) => e.id);
  assert.ok(ny.includes('02AP-07-High'), 'EmblemHealth in Manhattan');
  const pr = eligiblePlans(FV, '00901', 'dental').map((e) => e.id);
  assert.ok(pr.includes('02AP-13-High'), 'Triple-S in Puerto Rico');
  // regions come from geo: brochure 02AP-01 is region 2 at 22302
  assert.equal(regionFor(FV, '2027', '22302', '02AP-01'), '2');
  // a mixed ZIP3 uses the ZIP5 override
  assert.equal(regionFor(FV, '2027', '99901', '02AP-01'), FV.years['2027'].geo.zip5_regions['99901']['02AP-01']);
  // vision: every plan is nationwide and needs no ZIP
  assert.equal(eligiblePlans(FV, null, 'vision').length, 10);
  assert.equal(eligiblePlans(FV, null, 'dental').length, 0, 'dental premiums are regional: no ZIP, no prices');
  assert.equal(eligiblePlans(FV, '09001', 'dental').length, 0);
});

// ---------- rows ----------
test('dvRows: premium by region, enrollment and pay basis; total = premium + preset OOP', () => {
  const s = S({ enrollment: 'self_plus_one', dentalUse: 'typical' });
  const rows = dvRows(FV, s, 'dental');
  const r = rows.find((x) => x.code === '02AP-01-Standard');
  const rate = Y.rates['02AP-01-Standard']['2'].self_plus_one;
  assert.equal(r.cost.premium, annualPremium(rate, 'active'));
  assert.equal(r.cost.oop, dentalOop(Y.benefits['02AP-01-Standard'], 'typical').oop);
  assert.equal(r.cost.total, Math.round((r.cost.premium + r.cost.oop) * 100) / 100);
  const ret = dvRows(FV, { ...s, status: 'retiree' }, 'dental').find((x) => x.code === '02AP-01-Standard');
  assert.equal(ret.cost.premium, annualPremium(rate, 'retiree'));
  for (const x of rows) assert.ok(Number.isFinite(x.cost.total), x.code);
  // ranked: cheapest total first, ranks 1..n
  const ranked = rankDv(rows);
  ranked.forEach((x, i) => { assert.equal(x.rank, i + 1); if (i) assert.ok(x.cost.total >= ranked[i - 1].cost.total); });
});

test('dvRows: a plan whose cells cannot be parsed falls back to premium only, flagged, never NaN', () => {
  const broken = structuredClone(FV);
  broken.years['2027'].benefits['02AP-08-High'].class_b = { text: 'See brochure' };
  const r = dvRows(broken, S({ dentalUse: 'typical' }), 'dental').find((x) => x.code === '02AP-08-High');
  assert.equal(r.cost.priced, false);
  assert.equal(r.cost.oop, null);
  assert.equal(r.cost.total, r.cost.premium);
  assert.ok(r.cost.warnings.length > 0);
  const ctx = dvContext([r], S(), 'dental');
  const total = dvSections(broken, 'dental', ctx).find((s) => s.key === 'est').rows.find((x) => x.key === 'total').cell(r, ctx);
  assert.match(total.sub, /premium only/i);
  assert.equal(total.tone, 'warn');
});

test('vision rows: ranked by premium plus the copays the text states; contacts not priced', () => {
  const rows = rankDv(dvRows(FV, S({ visionUse: 'glasses' }), 'vision'));
  assert.equal(rows.length, 10);
  const met = rows.find((x) => x.code === '02AP-12-Standard');
  assert.equal(met.cost.oop, 20);
  assert.equal(met.cost.priced, true);
  const c = dvRows(FV, S({ visionUse: 'contacts' }), 'vision');
  assert.ok(c.every((x) => x.cost.priced === false && Number.isFinite(x.cost.total)));
});

test('filterDvRows: carrier, coverage area and network tiers (incl. out-of-network)', () => {
  const rows = dvRows(FV, S(), 'dental');
  assert.ok(filterDvRows(rows, { carriers: ['Aetna'] }).every((r) => r.plan.carrier === 'Aetna'));
  assert.ok(filterDvRows(rows, { area: 'regional' }).every((r) => !r.plan.nationwide));
  assert.ok(filterDvRows(rows, { area: 'nationwide' }).every((r) => r.plan.nationwide));
  assert.ok(filterDvRows(rows, { oon: true }).every((r) => r.plan.network_tiers.includes('Out-of-Network')));
  const vis = dvRows(FV, S(), 'vision');
  assert.ok(!filterDvRows(vis, { oon: true }).some((r) => r.code === '02AP-04-Standard'), 'FEP Vision Standard: in-network only');
  assert.equal(filterDvRows(rows, {}).length, rows.length);
  assert.ok(dvCarriers(rows).includes('Delta Dental'));
  // the board's grouping works over dv rows (carrier = network_family)
  const g = groupPlans(rankDv(rows), 'carrier');
  assert.ok(g.every((x) => x.rows.length <= 3 && x.rows.every((r) => r.plan.carrier === x.key)));
});

// ---------- board model ----------
test('dvSections: data-driven rows from meta.board; premium rows from rates; best in row; links URL-safe', () => {
  const s = S();
  const rows = rankDv(dvRows(FV, s, 'dental'));
  const ctx = dvContext(rows, s, 'dental');
  const secs = dvSections(FV, 'dental', ctx);
  const keys = secs.map((x) => x.key);
  assert.deepEqual(keys.slice(0, 1), ['est']);
  for (const b of FV.meta.board.dental) assert.ok(keys.includes(`fv-${b.id}`), b.id);
  assert.ok(keys.includes('changes') && keys.includes('plan'));
  const cost = secs.find((x) => x.key === 'fv-cost');
  const prem = cost.rows.find((r) => r.key === 'premium_family');
  const r0 = rows[0];
  const cell = prem.cell(r0, ctx);
  assert.equal(cell.value, annualPremium(Y.rates[r0.code][r0.region].family, 'active'));
  // benefit text straight from OPM
  const classB = secs.find((x) => x.key === 'fv-coverage').rows.find((r) => r.key === 'class_b');
  const opm = Y.benefits[r0.code].class_b;
  const cb = classB.cell(r0, ctx);
  assert.ok(cb.text.endsWith(`${opm.value}%`), cb.text);
  assert.ok(cb.note == null || cb.note === opm.text, 'any extra OPM wording is kept verbatim');
  assert.equal(classB.best, 'min');
  // every cell of every row is text, never NaN
  for (const sec of secs) for (const def of sec.rows) for (const r of rows) {
    const c = def.cell(r, ctx);
    assert.equal(typeof c.text, 'string', `${sec.key}/${def.key}`);
    assert.ok(!/NaN|undefined/.test(c.text + (c.sub ?? '')), `${sec.key}/${def.key} ${c.text}`);
  }
  const plan = secs.find((x) => x.key === 'plan');
  const site = plan.rows.find((r) => r.key === 'website').cell(r0, ctx);
  assert.match(site.link.href, /^https?:\/\//);
  const evil = { ...r0, plan: { ...r0.plan, website: 'javascript:alert(1)' } };
  const bad = plan.rows.find((r) => r.key === 'website').cell(evil, ctx);
  assert.equal(bad.link, undefined);
});

test('dvSections: changes since 2026 (premium for your region and coverage, benefit text changes)', () => {
  const s = S();
  const rows = rankDv(dvRows(FV, s, 'dental'));
  const ctx = dvContext(rows, s, 'dental');
  const chg = dvSections(FV, 'dental', ctx).find((x) => x.key === 'changes');
  const r = rows.find((x) => x.code === '02AP-01-High');
  const p = chg.rows.find((x) => x.key === 'chgPremium').cell(r, ctx);
  const was = annualPremium(FV.years['2026'].rates['02AP-01-High']['2'].self, 'active');
  assert.equal(p.value, Math.round((r.cost.premium - was) * 100) / 100);
  const bcbs = rows.find((x) => x.code === '02AP-03-High');
  const ben = chg.rows.find((x) => x.key === 'chgBenefits').cell(bcbs, ctx);
  assert.ok(ben.items.some((t) => /Age 14.*Age 13/.test(t)), ben.items.join(' | '));
  const none = chg.rows.find((x) => x.key === 'chgBenefits').cell(rows.find((x) => x.code === '02AP-05-High'), ctx);
  assert.equal(none.text, 'No change');
});

test('vs your plan: pinned 2026 dental plan (same id in 2027) and deltas against it', () => {
  const s = S({ myDental: '02AP-11-High', dentalUse: 'major' });
  const all = dvRows(FV, s, 'dental');
  const { ranked, mine, others } = rankDv(all, { mineId: '02AP-11-High', withMine: true });
  assert.equal(mine.code, '02AP-11-High');
  assert.ok(mine.isMine);
  assert.ok(!others.some((r) => r.code === mine.code));
  assert.equal(mine.rank, ranked.findIndex((r) => r.code === mine.code) + 1);
  const ctx = dvContext(ranked, s, 'dental', mine);
  const vs = dvSections(FV, 'dental', ctx).find((x) => x.key === 'vsMine');
  const o = others[0];
  const d = vs.rows.find((x) => x.key === 'vsTotal').cell(o, ctx);
  assert.equal(d.value, Math.round((o.cost.total - mine.cost.total) * 100) / 100);
  assert.equal(vs.rows.find((x) => x.key === 'vsTotal').cell(mine, ctx).text.startsWith('$'), true);
  // a pinned plan not offered at this ZIP is reported, not invented
  const { mine: m2, mineStatus } = rankDv(dvRows(FV, s, 'dental'), { mineId: '02AP-07-High', withMine: true });
  assert.equal(m2, null);
  assert.equal(mineStatus, 'not-offered');
  assert.equal(dvSections(FV, 'dental', dvContext(all, s, 'dental')).some((x) => x.key === 'vsMine'), false);
});

test('dvHeader: rank, name, option chips, total; premium-only plans say so', () => {
  const s = S();
  const rows = rankDv(dvRows(FV, s, 'dental'));
  const ctx = dvContext(rows, s, 'dental');
  const h = dvHeader(rows[0], rows.slice(0, 3), ctx, 'of your top 3');
  assert.equal(h.rankText, '#1');
  assert.equal(h.total, rows[0].cost.total);
  assert.ok(h.chips.some((c) => c.text === rows[0].plan.option));
  assert.match(h.why, /Lowest/);
});

test('filterDvSections: differences only and search over row labels', () => {
  const s = S();
  const rows = rankDv(dvRows(FV, s, 'dental')).slice(0, 3);
  const ctx = dvContext(rows, s, 'dental');
  const secs = dvSections(FV, 'dental', ctx);
  const all = filterDvSections(secs, rows, ctx, {});
  const diff = filterDvSections(secs, rows, ctx, { diffOnly: true });
  const n = (x) => x.sections.reduce((k, sec) => k + sec.rows.length, 0);
  assert.ok(n(diff) < n(all));
  assert.ok(diff.hiddenRows > 0);
  assert.ok(diff.sections.find((x) => x.key === 'est').rows.some((r) => r.key === 'total'), 'the total is never hidden');
  const q = filterDvSections(secs, rows, ctx, { query: 'orthodont' });
  assert.ok(q.matched > 0);
  assert.ok(q.sections.every((sec) => sec.rows.every((r) => /orthodont/i.test(r.label) || r.keep)));
});

// ---------- add to my total ----------
test('dvAddOn: cheapest eligible dental and vision by total, or the chosen plans; none when toggled off', () => {
  const s = S({ dental: true, dentalUse: 'typical', visionUse: 'exam' });
  const a = dvAddOn(FV, s);
  const dRows = rankDv(dvRows(FV, s, 'dental'));
  const vRows = rankDv(dvRows(FV, s, 'vision'));
  assert.equal(a.dental.id, dRows[0].code);
  assert.equal(a.dental.amount, dRows[0].cost.total);
  assert.equal(a.dental.auto, true);
  assert.equal(a.vision.id, vRows[0].code);
  assert.equal(a.total, Math.round((a.dental.amount + a.vision.amount) * 100) / 100);
  const pick = dvAddOn(FV, { ...s, dentalPlan: '02AP-05-High', visionPlan: 'none' });
  assert.equal(pick.dental.id, '02AP-05-High');
  assert.equal(pick.dental.auto, false);
  assert.equal(pick.vision, null);
  assert.equal(pick.total, pick.dental.amount);
  // a chosen plan not offered at the ZIP falls back to the cheapest, and says so
  const away = dvAddOn(FV, { ...s, dentalPlan: '02AP-07-High' });
  assert.equal(away.dental.id, dRows[0].code);
  assert.match(away.dental.note, /not offered/i);
  // no ZIP: dental cannot be priced; vision still is
  const noZip = dvAddOn(FV, { ...s, location: { state: 'VA', zip: null } });
  assert.equal(noZip.dental.amount, null);
  assert.match(noZip.dental.note, /ZIP/);
  assert.equal(noZip.total, noZip.vision.amount);
  assert.equal(dvAddOn(FV, { ...s, dental: false }), null);
  assert.equal(dvAddOn(null, s), null);
});

test('sanitizeDvState: ids the data does not know are dropped', () => {
  const s = sanitizeState({ myDental: '02AP-99-High', dentalPlan: '02AP-05-High', myVision: '02AP-17-High' });
  const t = sanitizeDvState(s, FV);
  assert.equal(t.myDental, null);
  assert.equal(t.dentalPlan, '02AP-05-High');
  assert.equal(t.myVision, '02AP-17-High');
  // a dental id in the vision slot is dropped
  const u = sanitizeDvState(sanitizeState({ myVision: '02AP-05-High' }), FV);
  assert.equal(u.myVision, null);
  const same = sanitizeState({});
  assert.equal(sanitizeDvState(same, FV), same);
});

// ---------- state ----------
test('state: tab, presets, dental/vision plan picks and ZIP sanitize and round-trip through the hash', () => {
  const s = sanitizeState({
    tab: 'vision', dentalUse: 'major', visionUse: 'contacts', dentalPlan: '02AP-05-High', visionPlan: 'none',
    myDental: '02AP-11-Standard', myVision: '02AP-12-High', location: { zip: '22302', state: 'VA' }, dental: true,
  });
  const back = decodeState(encodeState(s));
  for (const k of ['tab', 'dentalUse', 'visionUse', 'dentalPlan', 'visionPlan', 'myDental', 'myVision', 'dental']) assert.deepEqual(back[k], s[k], k);
  assert.equal(back.location.zip, '22302');
  const d = defaultState();
  assert.equal(d.tab, 'medical');
  assert.equal(d.dentalPlan, null);
  assert.equal(encodeState(d), '');
  for (const bad of ['<script>', 'Medical', 'dental;', '__proto__', 7, null]) assert.equal(sanitizeState({ tab: bad }).tab, 'medical');
  for (const bad of ['02AP-05-high', '02AP-05-High;x', '../x', 'none2', 5, {}]) {
    assert.equal(sanitizeState({ dentalPlan: bad }).dentalPlan, null, String(bad));
    assert.equal(sanitizeState({ myVision: bad }).myVision, null, String(bad));
  }
  assert.equal(sanitizeState({ myDental: 'none' }).myDental, null, '"none" is only a pick for the add-on');
  for (const bad of ['2230', '223021', 'abcde', 22302, '22302\n']) assert.equal(sanitizeState({ location: { zip: bad } }).location.zip, null);
  assert.equal(sanitizeState({ dentalUse: 'x' }).dentalUse, 'typical');
  const hostile = decodeState('#t=zz&du=q&vu=<b>&dp=javascript:1&vp=02AP-17-High&md=x&z=1234');
  assert.equal(hostile.tab, 'medical');
  assert.equal(hostile.dentalUse, 'typical');
  assert.equal(hostile.dentalPlan, null);
  assert.equal(hostile.visionPlan, '02AP-17-High');
  assert.equal(hostile.myDental, null);
  assert.equal(hostile.location.zip, null);
});

// ---------- review fixes ----------
import { zipKeepsWith, zipPatch } from '../src/ui/zip.js';
import { dvLabel } from '../src/ui/model.js';

test('lookupZip: a ZIP3 with one real state besides "MIL" resolves; ZIP+4 accepted like cleanZip', () => {
  assert.equal(lookupZip(FV, '97000').state, 'OR');
  assert.equal(lookupZip(FV, '97003').state, null, 'OPM labels this ZIP Military');
  assert.equal(lookupZip(FV, '22302-1234').state, 'VA');
  assert.equal(lookupZip(FV, '22302-1234').zip, '22302');
  assert.equal(lookupZip(FV, '22302-12').reason, 'format');
});

test('zipKeepsWith: picking a state keeps the ZIP unless the ZIP clearly belongs to another state', () => {
  assert.equal(zipKeepsWith(FV, '73900', 'TX'), true, 'OK/TX ZIP3: TX is a candidate');
  assert.equal(zipKeepsWith(FV, '73900', 'OK'), true);
  assert.equal(zipKeepsWith(FV, '00901', 'PR'), true, 'no state in OPM: keep');
  assert.equal(zipKeepsWith(FV, '00901', 'VA'), true);
  assert.equal(zipKeepsWith(FV, '22302', 'VA'), true);
  assert.equal(zipKeepsWith(FV, '22302', 'TX'), false, 'definite contradiction');
  assert.equal(zipKeepsWith(FV, '20512', 'MD'), true);
  assert.equal(zipKeepsWith(FV, '20512', 'TX'), false, 'not one of the candidates');
  assert.equal(zipKeepsWith(null, '22302', 'TX'), true, 'data not loaded: never drop');
  assert.equal(zipKeepsWith(FV, null, 'TX'), true);
});

test('zipPatch: partial or invalid entries clear the stored ZIP; valid ones set it', () => {
  const cur = '22302';
  for (const raw of ['2230', '222030', '22 302', 'abc']) {
    const r = zipPatch(FV, raw, cur);
    assert.deepEqual(r.patch, { location: { zip: null } }, raw);
    assert.equal(r.invalid, true);
  }
  assert.equal(zipPatch(FV, '2230', null).patch, null, 'nothing stored: nothing to clear');
  assert.deepEqual(zipPatch(FV, '90210', cur).patch, { location: { zip: '90210', state: 'CA' } });
  assert.deepEqual(zipPatch(FV, '00901', cur).patch, { location: { zip: '00901' } });
  assert.deepEqual(zipPatch(FV, '09001', cur).patch, { location: { zip: null } });
  assert.deepEqual(zipPatch(FV, '', cur).patch, { location: { zip: null } });
  assert.equal(zipPatch(null, '90210', cur).loading, true);
});

test('vision contacts: the caveat travels to the add-on item; labels say what was added', () => {
  const a = dvAddOn(FV, S({ dental: true, visionUse: 'contacts', location: { state: 'VA', zip: null } }));
  assert.equal(a.dental.amount, null);
  assert.equal(a.vision.priced, false);
  assert.match(a.vision.note, /benefit details in text/i);
  assert.equal(dvLabel({ dv: a }), 'incl. vision');
  const both = dvAddOn(FV, S({ dental: true }));
  assert.equal(dvLabel({ dv: both }), 'incl. dental/vision');
  assert.equal(dvLabel({ dv: dvAddOn(FV, S({ dental: true, visionPlan: 'none' })) }), 'incl. dental');
  assert.equal(dvLabel({}), '');
});
