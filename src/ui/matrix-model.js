// Full benefits matrix: every OPM benefits field for a set of plans, grouped into sections.
// Pure and DOM-free (unit tested under node). Both the 4-plan compare panel and the board render it.
//
// Input plans: [{ code, benefits }] where benefits = data.benefits[year][code] ({ raw, copays, out_of_network, ... }).
// Output: sections [{ id, title, note?, prominent?, open, rows: [Row] }] in MATRIX_SECTIONS order, empty ones dropped.
//   Row  = { key, label, hint?, sub?, fields: string[], source: 'raw'|'oon'|'extra', dir: 'min'|'max'|null,
//            cells: [Cell], differs: boolean, best: number[] }
//   Cell = { code, field|null, text (original wording, never altered), kind, display, value, unit, share?, name?, note? }
//     kind: 'value' (a dollar or percent cost share) | 'nothing' ($0 / member pays nothing) | 'notcovered' | 'na'
//           | 'none' | 'covered' | 'yes' | 'no' | 'text' (free text, show `display` clamped) | 'missing' (field absent)
// Best-in-row direction: lower is better (a copay, coinsurance, deductible or out-of-pocket cap costs you), except
// rows marked dir 'max' (money the plan gives you: account contributions, Part B reimbursement). A winner is only
// marked when every plan has a comparable number in the same unit ($ with $, % with %; $0 counts as both), the
// numbers are not all equal, and there are at least two plans.
//
// Extension hook: buildMatrix(..., { extra: [{ section, key, label, hint?, dir?, get(plan) -> string|null }] })
// appends rows from another data source (e.g. brochure-extracted facts) to a section; their cells parse the same way.

import { usdExact } from './format.js';
import { deductibleType } from '../engine/cost.js';

/** The "Deductible type" row (engine deductibleType): how a family deductible is modeled for one person's care. */
export const DEDUCTIBLE_TYPE_TEXT = Object.freeze({
  embedded: { display: 'Embedded (assumed)', note: 'Each person has the self-only deductible and out-of-pocket max inside the family amounts. OPM’s data does not say; this tool assumes it for every plan that is not a high-deductible plan.' },
  aggregate: { display: 'Aggregate (shared)', note: 'An HSA plan whose family deductible is twice the self-only one: the family deductible is shared, so one person may have to meet all of it. One person’s costs still stop at the self-only out-of-pocket max.' },
  unknown: { display: 'Unknown (modeled as shared)', note: 'A high-deductible plan whose data does not say how its family deductible works: modeled as shared, the cautious choice.' },
});

/** OPM identity columns: shown in column headers or dropped, never matrix rows. */
export const MATRIX_METADATA_FIELDS = Object.freeze([
  'Plan Name', 'Plan Code', 'Plan Option Name', 'In-network/out-of-network',
]);

const ENROLL_RE = /\s*\((Self|Self Plus One|Self & Family|Self and Family)\)\s*$/;
const TIER_OF = { Self: 'self', 'Self Plus One': 'self_plus_one', 'Self & Family': 'family', 'Self and Family': 'family' };
export const ENROLLMENT_WORDS = { self: 'Self only', self_plus_one: 'Self plus one', family: 'Self and family' };

/** 'Annual deductible (Self & Family)' -> { base: 'Annual deductible', tier: 'family' }; no suffix -> tier null. */
export function splitEnrollment(field) {
  const m = ENROLL_RE.exec(field);
  if (!m) return { base: field, tier: null };
  return { base: field.slice(0, m.index), tier: TIER_OF[m[1]] };
}

const isMedicare = (b) => /medicare|\bparts? [abcd]\b|egwp|\((mapd|pdp)\)/i.test(b);
const not = (fn) => (b) => !isMedicare(b) && fn(b);
const re = (r) => not((b) => r.test(b));

// Preferred row order inside a section (fields not listed follow in data order) and friendlier labels.
// The original OPM field name is always kept as the row hint.
const LABELS = {
  'Annual Out-of-Pocket Maximum for Prescription': 'Prescription out-of-pocket max',
  'Annual Out-of-Pocket Maximum for Prescriptions': 'Prescription out-of-pocket max',
  'Annual Deductible for Prescriptions Only': 'Prescription deductible',
  'Mail Order Pharmacy': 'Mail order pharmacy',
  'Mail Service Pharmacy Benefit (Prescription Drugs)': 'Mail order pharmacy',
  'Mail Order Pharmacy Restriction (Prescription Drugs)': 'Mail order restrictions',
  'Specialty Pharmacy Restriction (Prescription Drugs)': 'Specialty pharmacy restrictions',
  'Primary Care Office Visit': 'Primary care visit',
  'Specialist Office Visit': 'Specialist visit',
  'Emergency Care': 'Emergency room',
  'Hospital Inpatient Cost Per Admission': 'Hospital stay, per admission',
  'Hospital Room Costs': 'Hospital room',
  'Other Inpatient Hospital Costs': 'Other inpatient costs',
  'Doctor Costs for Inpatient Surgery': 'Surgeon, inpatient',
  'Doctor Costs for Outpatient Surgery': 'Surgeon, outpatient',
  'Other Outpatient Surgery Costs': 'Outpatient surgery facility',
  'Diagnostic Tests or Procedures (e.g., Blood Tests, X-rays, Urinalysis, Ultrasounds)': 'Labs, X-rays, ultrasounds',
  'Diagnostic Tests or Procedures (e.g., CT scans, MRIs, PET Scans)': 'CT, MRI, PET scans',
  'Professional Services (Mental Health and Substance Use Disorder)': 'Therapist or psychiatrist visit',
  'Inpatient Hospital (Mental Health and Substance Use Disorder Services)': 'Inpatient mental health',
  'Outpatient Hospital (Mental Health and Substance Use Disorder Services)': 'Outpatient mental health facility',
  'Applied Behavioral Analysis (ABA)': 'Applied behavior analysis (ABA)',
  'Prenatal Care, Screening for Gestational Diabetes, Delivery, and Postpartum Care (Maternity Care)': 'Prenatal, delivery and postpartum care',
  'Hospital Stay--Vaginal Birth, Cesarean Birth (Maternity Care)': 'Hospital stay for birth',
  'Diagnosis and Treatment (Infertility Services)': 'Infertility diagnosis and treatment',
  'Artificial Insemination Services (e.g. ICI, IVI, IUI)': 'Artificial insemination (IUI, ICI, IVI)',
  'Assisted Reproductive Technology (ART) (e.g., IVF, GIFT, ZIFT) (Infertility Services)': 'IVF and other assisted reproduction',
  'Fertility Preservation Procedures (e.g., iatrogenic infertility) (Infertility Services)': 'Fertility preservation',
  'Hearing Aids (external)': 'Hearing aids',
  'Routine Dental Exams and Cleaning for Adults': 'Dental exam and cleaning, adults',
  'Routine Dental Exams and Cleaning for Children': 'Dental exam and cleaning, children',
  'Eye Exams for Medical Condition or Non-Surgical Treatment': 'Medical eye exam',
  'Home Health Services (Skilled Nursing Care)': 'Home health care',
  'Outpatient Rehabilitation (Skilled Nursing Care Facility)': 'Skilled nursing facility',
  'Annual deductible': 'Deductible',
  'Annual out-of-pocket maximum': 'Out-of-pocket max',
  'Net deductible': 'Net deductible (after account money)',
  'Medical account contribution': 'Plan deposit to HSA or HRA',
  'Type of account': 'Savings account',
  'Plan Option Type': 'Plan option type',
};

// OPM's Title Case field names, read as sentence case; proper nouns and Medicare terms keep their capitals.
const KEEP_CAPS = new Set(['Medicare', 'Advantage', 'Part', 'Parts']);
function sentenceCase(t) {
  return t.replace(/\b([A-Z])([a-z]+)\b/g, (m, a, b, i) => (i === 0 || KEEP_CAPS.has(m) ? m : a.toLowerCase() + b));
}

const MAX_ROWS = new Set([
  'Medical account contribution',
  'Total Annual Part B Premium Reimbursement Amount Per Enrollee (MAPD)',
  'Total Annual Part B Premium Reimbursement Amount per enrollee (PDP)',
]);

/**
 * Ordered sections. `match(baseField)` decides membership (fields are matched after the enrollment suffix is
 * removed); the matchers are disjoint (Medicare-coordination fields are excluded everywhere else), and the
 * last section has no matcher: it collects fields OPM may add in a future year.
 */
export const MATRIX_SECTIONS = Object.freeze([
  {
    id: 'rx', title: 'Prescriptions', prominent: true, defaultOpen: true,
    note: 'What you pay per fill at each drug tier. Tier names and what sits on each tier vary by plan; check the plan formulary for your drugs.',
    match: re(/^Tier \d+$|pharmacy|prescription/i),
    order: ['Tier 0', 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6', 'Mail Order Pharmacy', 'Mail Service Pharmacy Benefit (Prescription Drugs)',
      'Annual Deductible for Prescriptions Only', 'Annual Out-of-Pocket Maximum for Prescription', 'Annual Out-of-Pocket Maximum for Prescriptions'],
  },
  {
    id: 'visits', title: 'Visits and urgent care', defaultOpen: true,
    match: re(/^(Primary Care Office Visit|Specialist Office Visit|Urgent Care|Emergency Care)$/i),
    order: ['Primary Care Office Visit', 'Specialist Office Visit', 'Urgent Care', 'Emergency Care'],
  },
  {
    id: 'hospital', title: 'Hospital and surgery',
    match: re(/hospital (inpatient|room)|other inpatient hospital|(?<!non-)surgery|^surgical procedures$/i),
    order: ['Hospital Inpatient Cost Per Admission', 'Hospital Room Costs', 'Other Inpatient Hospital Costs', 'Doctor Costs for Inpatient Surgery',
      'Doctor Costs for Outpatient Surgery', 'Other Outpatient Surgery Costs', 'Surgical Procedures', 'Reconstructive Surgery'],
  },
  { id: 'diagnostics', title: 'Labs and imaging', match: re(/diagnostic tests|lab network/i) },
  { id: 'mental', title: 'Mental health and substance use', match: re(/mental health|substance use/i) },
  {
    id: 'therapy', title: 'Therapies and rehab',
    match: re(/^(Physical|Occupational|Speech) Therapy$|chiropractic|behavioral analysis|acupuncture/i),
    order: ['Physical Therapy', 'Occupational Therapy', 'Speech Therapy', 'Chiropractic', 'Acupuncture', 'Applied Behavioral Analysis (ABA)'],
  },
  { id: 'maternity', title: 'Maternity', match: re(/maternity/i) },
  { id: 'fertility', title: 'Fertility', match: re(/infertility|insemination|fertility/i) },
  { id: 'hearing', title: 'Hearing', match: re(/hearing/i) },
  { id: 'dentalvision', title: 'Dental and vision extras', match: re(/dental|eye exam|eyeglasses|contact lenses/i) },
  {
    id: 'equipment', title: 'Equipment, home health and hospice',
    match: re(/durable medical|home health|hospice|skilled nursing care facility/i),
  },
  {
    id: 'chronic', title: 'Chronic conditions, prevention and nutrition',
    match: re(/chronic disease|diabetes education|nutritional|preventive care/i),
    order: ['Preventive Care'],
  },
  {
    id: 'account', title: 'Deductible, account and plan details',
    match: re(/^(annual deductible|annual out-of-pocket maximum|net deductible|medical account contribution|type of account|plan option type|brochure number)$/i),
    order: ['Annual deductible', 'Net deductible', 'Annual out-of-pocket maximum', 'Type of account', 'Medical account contribution', 'Plan Option Type', 'Brochure Number'],
  },
  {
    id: 'oon', title: 'Out of network',
    note: 'Many HMOs pay nothing out of network except emergencies; a blank here means OPM lists no separate out-of-network figure.',
    match: null, // rows come from benefits.out_of_network, not from raw fields
  },
  {
    id: 'medicare', title: 'With Medicare',
    note: 'Only matters if you have Medicare. How the plan pays when Medicare pays first.',
    match: (b) => isMedicare(b) || /^requirement for part b reimbursement$/i.test(b),
  },
  { id: 'other', title: 'Other details', match: null },
]);

const SECTION_BY_ID = new Map(MATRIX_SECTIONS.map((s) => [s.id, s]));

/** Section id for an OPM field name (with or without an enrollment suffix). Unknown -> 'other'. */
export function classifyField(field) {
  const { base } = splitEnrollment(field);
  for (const s of MATRIX_SECTIONS) if (s.match && s.match(base)) return s.id;
  return 'other';
}

/** Case/space/trailing-period-insensitive text for "do these plans differ?". */
export function normalizeText(t) {
  return String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
}

const num = (s) => Number(String(s).replace(/,/g, ''));
const SHARE_RE = /\$\s?([\d,]+(?:\.\d+)?)\s*(copayment|copay)|(\d+(?:\.\d+)?)\s*%\s*(coinsurance)/i;

/**
 * Plain-English parse of one OPM cell. The original text is always kept in `text`.
 * -> { kind, display, value, unit, share?, name?, note? } (see header for kinds)
 * Results are memoized by text (the board parses ~100 rows x ~120 plans per render; OPM repeats wording a lot).
 */
const parseCache = new Map();
export function parseCell(raw) {
  if (raw == null || String(raw).trim() === '') return { text: null, kind: 'missing', display: 'Not listed', value: null, unit: null };
  const key = String(raw);
  let hit = parseCache.get(key);
  if (!hit) {
    if (parseCache.size > 20000) parseCache.clear();
    hit = Object.freeze(parseUncached(key));
    parseCache.set(key, hit);
  }
  return { ...hit };
}

function parseUncached(raw) {
  const text = String(raw);
  const s = text.trim();
  const dash = s.indexOf(' - ');
  const head = dash >= 0 ? s.slice(0, dash).trim() : s;
  const tail = dash >= 0 ? s.slice(dash + 3).trim() : '';
  const out = (o) => ({ text, value: null, unit: null, ...o });
  const withNote = (o, note) => (note ? { ...o, note } : o);

  if (/^not covered\b/i.test(s)) return withNote(out({ kind: 'notcovered', display: 'Not covered' }), tail);
  if (/^member pays all charges\b/i.test(s)) return withNote(out({ kind: 'notcovered', display: 'You pay all' }), /^n\/a$/i.test(tail) ? '' : tail);
  if (/^deductible waived\b/i.test(s)) return withNote(out({ kind: 'covered', display: 'Waived' }), tail);
  // "Specialty Tier - Not applicable": a tier name with no benefit
  if (tail && /^(not applicable|n\/a)\b/i.test(tail) && !/[$%]/.test(head)) {
    return withNote(out({ kind: 'na', display: 'N/A', name: head }), tail.replace(/^(not applicable|n\/a)[\s.,;-]*/i, ''));
  }
  if (/^(not applicable|n\/a)\b/i.test(s) || /^none - n\/a$/i.test(s)) return withNote(out({ kind: 'na', display: 'N/A' }), /^n\/a$/i.test(tail) ? '' : tail);
  if (/^(member pays nothing|nothing|no charge|no cost)\b/i.test(s)) {
    // "Member Pays Nothing - 5 for Free; then 25% after deductible": $0 is only part of the story, so it is
    // shown but not used for best-in-row.
    const conditional = /\$\s?[1-9]|\b[1-9]\d*(\.\d+)?\s*%/.test(tail);
    return withNote(out({ kind: 'nothing', display: '$0', value: conditional ? null : 0, unit: 'zero', share: 'nothing' }), tail);
  }
  if (/^none\b/i.test(s)) return withNote(out({ kind: 'none', display: 'None' }), tail);
  if (/^covered\b/i.test(s)) return withNote(out({ kind: 'covered', display: 'Covered' }), tail);
  if (/^yes$/i.test(s)) return out({ kind: 'yes', display: 'Yes' });
  if (/^no$/i.test(s)) return out({ kind: 'no', display: 'No' });

  // "Preferred Generic - $7.50 Copayment": a tier name before the dash, the cost share after it.
  const headShare = SHARE_RE.exec(head);
  const headIsShare = headShare && headShare.index === 0;
  if (!headIsShare && tail) {
    const m = SHARE_RE.exec(tail);
    if (m && m.index === 0 && !/^\$?[\d,.]+$/.test(head)) {
      const v = shareOf(m);
      const rest = tail.slice(m[0].length).replace(/^[\s,;.-]+/, '');
      return withNote(out({ ...v, name: head }), rest);
    }
  }
  if (headIsShare) {
    const v = shareOf(headShare);
    const restHead = head.slice(headShare[0].length).replace(/^[\s,;.-]+/, '');
    return withNote(out(v), [restHead, tail].filter(Boolean).join(' - '));
  }
  // A bare amount: "$1,000", "$0 - copays apply ...", "$7,000 - $7,000 Self, $14,000 ..."
  const money = /^\$\s?([\d,]+(?:\.\d+)?)(\s+maximum)?$/i.exec(head);
  if (money) {
    const v = num(money[1]);
    const note = [money[2] ? 'Maximum' : '', tail].filter(Boolean).join(' - ');
    return withNote(out({ kind: v === 0 ? 'nothing' : 'value', display: usdExact(v), value: v, unit: v === 0 ? 'zero' : 'usd' }), note);
  }
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(head);
  if (pct) return withNote(out({ kind: 'value', display: `${pct[1]}%`, value: Number(pct[1]), unit: 'pct' }), tail);
  return out({ kind: 'text', display: s });
}

function shareOf(m) {
  if (m[1] != null) {
    const v = num(m[1]);
    return { kind: v === 0 ? 'nothing' : 'value', display: usdExact(v), value: v, unit: v === 0 ? 'zero' : 'usd', share: 'copay' };
  }
  const v = Number(m[3]);
  return { kind: v === 0 ? 'nothing' : 'value', display: `${m[3]}%`, value: v, unit: v === 0 ? 'zero' : 'pct', share: 'coinsurance' };
}

/** Indices of the winning cells, or [] when the row has no meaningful numeric comparison. */
export function rowBest(cells, dir = 'min') {
  if (!dir || cells.length < 2) return [];
  if (!cells.every((c) => (c.kind === 'value' || c.kind === 'nothing') && Number.isFinite(c.value))) return [];
  const units = new Set(cells.map((c) => c.unit).filter((u) => u !== 'zero'));
  if (units.size > 1) return [];
  const vals = cells.map((c) => c.value);
  const best = dir === 'max' ? Math.max(...vals) : Math.min(...vals);
  if (vals.every((v) => v === best)) return [];
  return vals.flatMap((v, i) => (v === best ? [i] : []));
}

function finishRow(row) {
  const norm = row.cells.map((c) => normalizeText(c.text));
  return { ...row, differs: !norm.every((t) => t === norm[0]), best: rowBest(row.cells, row.dir) };
}

/**
 * A pre-parsed cell from an extra source: { text, display, kind, value?, unit?, note?, name?, cite?, link?, badge? }.
 * cite = { short, label, href|null } (a source page), link = { href, text } (an outbound link; hrefs are
 * already checked by the source, see rx-model normalizeUrl), badge = { kind, text, why } (a data caveat).
 */
function richCell(v) {
  const display = String(v.display ?? v.text ?? '');
  return {
    text: v.text == null ? (display || null) : String(v.text),
    kind: typeof v.kind === 'string' ? v.kind : 'text',
    display: display || 'Not listed',
    value: Number.isFinite(v.value) ? v.value : null,
    unit: v.unit ?? null,
    ...(v.note ? { note: String(v.note) } : {}),
    ...(v.name ? { name: String(v.name) } : {}),
    ...(v.cite ? { cite: v.cite } : {}),
    ...(v.link ? { link: v.link } : {}),
    ...(v.badge ? { badge: v.badge } : {}),
  };
}

const oonCell = (code, v) => (Number.isFinite(v)
  ? { code, field: null, text: usdExact(v), kind: v === 0 ? 'nothing' : 'value', display: usdExact(v), value: v, unit: v === 0 ? 'zero' : 'usd' }
  : { code, field: null, text: null, kind: 'na', display: 'Not listed', value: null, unit: null });

/**
 * buildMatrix(plans, { year, enrollment, status, extra }) -> sections (see header).
 * Fields that vary by enrollment collapse to the selected enrollment's variant (the other variants are
 * the same benefit for a different coverage tier). Rows missing for every plan, and empty sections, are dropped.
 */
export function buildMatrix(plans, { enrollment = 'self', status = 'active', extra = [] } = {}) {
  const list = plans ?? [];
  // base field -> { section, fields: {tier|'': fieldName}, firstSeen }
  const bases = new Map();
  let seq = 0;
  for (const p of list) {
    for (const f of Object.keys(p.benefits?.raw ?? {})) {
      if (MATRIX_METADATA_FIELDS.includes(f)) continue;
      const { base, tier } = splitEnrollment(f);
      let b = bases.get(base);
      if (!b) { b = { section: classifyField(f), variants: new Map(), seq: seq++ }; bases.set(base, b); }
      b.variants.set(tier ?? '', f);
    }
  }

  const rowsBySection = new Map(MATRIX_SECTIONS.map((s) => [s.id, []]));
  for (const [base, b] of bases) {
    const tiered = !b.variants.has('');
    const field = tiered ? b.variants.get(enrollment) : b.variants.get('');
    // a field with only some enrollment variants (never in OPM data so far): fall back to any listed variant
    const fallback = field ?? [...b.variants.values()][0];
    const cells = list.map((p) => {
      const rawMap = p.benefits?.raw ?? {};
      const f = field && rawMap[field] != null ? field : (!field && rawMap[fallback] != null ? fallback : null);
      if (!f) return { code: p.code, field: null, ...parseCell(null) };
      return { code: p.code, field: f, ...parseCell(rawMap[f]) };
    });
    if (cells.every((c) => c.kind === 'missing')) continue;
    const label = /^Tier \d+$/.test(base) ? base : LABELS[base] ?? sentenceCase(base);
    rowsBySection.get(b.section).push({
      key: base,
      label,
      hint: base !== label ? base : undefined,
      sub: tiered ? ENROLLMENT_WORDS[enrollment] : undefined,
      fields: [...b.variants.values()],
      source: 'raw',
      dir: MAX_ROWS.has(base) ? 'max' : /^(type of account|plan option type|brochure number)$/i.test(base) ? null : 'min',
      seq: b.seq,
      cells,
    });
  }

  // out of network
  const oonOf = (p, k) => p.benefits?.out_of_network?.[k]?.[enrollment];
  if (list.some((p) => p.benefits?.out_of_network)) {
    for (const [k, label] of [['deductible', 'Out-of-network deductible'], ['oop_max', 'Out-of-network out-of-pocket max']]) {
      rowsBySection.get('oon').push({
        key: `oon:${k}`, label, sub: ENROLLMENT_WORDS[enrollment], fields: [], source: 'oon', dir: 'min', seq: -1,
        cells: list.map((p) => oonCell(p.code, oonOf(p, k))),
      });
    }
  }

  // how the engine models the family deductible for one person's care (an assumption, see About)
  if (list.length) {
    rowsBySection.get('account').push({
      key: 'calc:deductibleType', label: 'Deductible type', hint: 'How this tool models a family deductible for one person’s care (not an OPM field)',
      fields: [], source: 'extra', dir: null, seq: Infinity,
      cells: list.map((p) => {
        const t = DEDUCTIBLE_TYPE_TEXT[deductibleType(p.benefits)];
        return { code: p.code, field: null, ...richCell({ text: t.display, display: t.display, kind: 'text', note: t.note }) };
      }),
    });
  }

  // extra data sources (brochure facts and the like)
  for (const x of extra ?? []) {
    const sec = rowsBySection.has(x.section) ? x.section : 'other';
    const cells = list.map((p) => {
      let v = null;
      try { v = x.get(p); } catch { v = null; }
      return { code: p.code, field: null, ...(v && typeof v === 'object' ? richCell(v) : parseCell(v)) };
    });
    if (cells.every((c) => c.kind === 'missing')) continue;
    rowsBySection.get(sec).push({
      key: x.key, label: x.label, hint: x.hint, sub: x.sub, fields: [], source: 'extra', dir: x.dir === undefined ? 'min' : x.dir, seq: Infinity, cells,
    });
  }

  const out = [];
  for (const s of MATRIX_SECTIONS) {
    const rows = rowsBySection.get(s.id);
    if (!rows.length) continue;
    const order = s.order ?? [];
    const pos = (r) => {
      const i = order.indexOf(r.key);
      return i >= 0 ? i : order.length + (Number.isFinite(r.seq) ? r.seq : 1e6);
    };
    rows.sort((a, b) => pos(a) - pos(b));
    const open = s.id === 'medicare' ? status === 'retiree' : Boolean(s.defaultOpen);
    out.push({
      id: s.id, title: s.title, note: s.note, prominent: Boolean(s.prominent), open,
      rows: rows.map(({ seq: _s, ...r }) => finishRow(r)),
    });
  }
  return out;
}

export const sectionById = (id) => SECTION_BY_ID.get(id) ?? null;

const matches = (q, ...parts) => parts.some((p) => p != null && String(p).toLowerCase().includes(q));

/**
 * View filter over buildMatrix output.
 * diffOnly: keep only rows where the plans differ. query: case-insensitive substring over the row label, the OPM
 * field name, the section title and every cell's wording and display.
 * Sections left with no rows are dropped. -> { sections: [{...section, rows, forcedOpen}], hiddenRows, matched }
 *   hiddenRows: rows hidden by diffOnly (search misses are not counted); matched: rows shown.
 *   forcedOpen: true while searching, so the matches are visible whatever the saved open state is.
 */
export function filterMatrix(sections, { diffOnly = false, query = '' } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  let hiddenRows = 0;
  let matched = 0;
  const out = [];
  for (const s of sections ?? []) {
    const rows = s.rows.filter((r) => {
      if (diffOnly && !r.differs) { hiddenRows += 1; return false; }
      if (!q) return true;
      return matches(q, r.label, r.hint, r.key, s.title, r.sub) || r.cells.some((c) => matches(q, c.text, c.display, c.name));
    });
    matched += rows.length;
    if (rows.length) out.push({ ...s, rows, forcedOpen: Boolean(q) });
  }
  return { sections: out, hiddenRows, matched };
}

/** Saved matrix view prefs (localStorage; never in the shareable hash): { diffOnly, open: { [sectionId]: boolean } }. */
export function sanitizeMatrixPrefs(v) {
  const src = v && typeof v === 'object' ? v : {};
  const open = {};
  if (src.open && typeof src.open === 'object' && !Array.isArray(src.open)) {
    for (const [k, b] of Object.entries(src.open)) if (SECTION_BY_ID.has(k) && typeof b === 'boolean') open[k] = b;
  }
  return { diffOnly: src.diffOnly === true, open };
}

/**
 * Board adapter: matrix sections -> the board's section/row-definition shape (board-model.js header), so the
 * Compare Board renders the same matrix the 4-plan compare panel does. `sections` is buildMatrix (or
 * filterMatrix().sections) output built over the board's plans; `open` maps section id -> boolean overrides.
 * Board row keys are 'mx:<section>:<field>' so they never collide with the board's own rows.
 */
export function matrixBoardSections(sections, { open = {} } = {}) {
  return (sections ?? []).map((s) => ({
    key: `mx-${s.id}`,
    matrixId: s.id,
    label: s.title,
    note: s.note,
    prominent: s.prominent,
    collapsible: true,
    open: s.forcedOpen || (typeof open[s.id] === 'boolean' ? open[s.id] : s.open),
    count: `${s.rows.length} ${s.rows.length === 1 ? 'row' : 'rows'}`,
    rows: s.rows.map((r) => {
      const byCode = new Map(r.cells.map((c) => [c.code, c]));
      return {
        key: `mx:${s.id}:${r.key}`,
        label: r.label,
        labelSub: r.sub,
        hint: r.hint ? (r.source === 'extra' ? r.hint : `OPM field: ${r.hint}`) : undefined,
        differs: r.differs,
        best: r.dir ?? null,
        // best-in-row over the board group's own cells, with the matrix's unit-aware rule
        bestOf: (cells) => new Set(rowBest(cells.map((c) => c.mx ?? { kind: 'missing' }), r.dir)),
        cell: (row) => boardCell(byCode.get(row.code)),
      };
    }),
  }));
}

const KIND_TONE = { missing: 'muted', na: 'muted', none: 'muted' };

/** One matrix cell as a board cell descriptor: short display, tier name, clamped note, raw wording as the title. */
export function boardCell(c) {
  if (!c) return { text: 'Not listed', tone: 'muted', kind: 'missing', value: null, mx: { kind: 'missing' } };
  return {
    text: c.display,
    sub: c.name || undefined,
    note: c.kind === 'text' ? undefined : c.note || undefined,
    title: c.text ?? undefined,
    kind: c.kind,
    tone: KIND_TONE[c.kind],
    value: Number.isFinite(c.value) ? c.value : null,
    cite: c.cite,
    link: c.link,
    badge: c.badge,
    mx: c,
  };
}
