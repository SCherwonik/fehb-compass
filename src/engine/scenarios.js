// Annual usage scenarios, the "fine-tune" overrides layered on them, and custom cost lines.
// DOM-free: the engine, state validation and the UI all read these definitions.
//
// rxMonthly = generic (tier 1) prescriptions filled every month.
import { plainText } from '../text.js';

export const SCENARIOS = {
  healthy: { pcpVisits: 1, specialistVisits: 0, erVisits: 0, hospitalStays: 0, labs: 1, imaging: 0, rxMonthly: 0 },
  typical: { pcpVisits: 3, specialistVisits: 2, erVisits: 0, hospitalStays: 0, labs: 3, imaging: 1, rxMonthly: 1 },
  condition: { pcpVisits: 4, specialistVisits: 8, erVisits: 1, hospitalStays: 0, labs: 6, imaging: 3, rxMonthly: 3 },
  worst: { pcpVisits: 4, specialistVisits: 10, erVisits: 1, hospitalStays: 2, labs: 10, imaging: 4, rxMonthly: 4 },
  // "Start from nothing": no assumed care at all; only the user's own lines and fine-tune values count.
  nothing: { pcpVisits: 0, specialistVisits: 0, erVisits: 0, hospitalStays: 0, labs: 0, imaging: 0, rxMonthly: 0 },
};

// ---------- fine-tune overrides ----------

/** Fields the "Fine-tune your year" controls can override, with their allowed integer range. */
export const OVERRIDE_FIELDS = {
  hospitalStays: { min: 0, max: 6, label: 'Hospital stays', unit: ['stay', 'stays'] },
  erVisits: { min: 0, max: 10, label: 'ER visits', unit: ['visit', 'visits'] },
  specialistVisits: { min: 0, max: 24, label: 'Specialist visits', unit: ['visit', 'visits'] },
  pcpVisits: { min: 0, max: 24, label: 'Primary care visits', unit: ['visit', 'visits'] },
  rxMonthly: { min: 0, max: 10, label: 'Monthly generic prescriptions', unit: ['prescription', 'prescriptions'] },
};

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Finite number from a number or a plain numeric string; anything else -> NaN. */
function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?(e[+-]?\d+)?\s*$/i.test(v)) return Number(v);
  return NaN;
}

/** {field: integer} for known fields only, each clamped to its range. Bad values are dropped. */
export function sanitizeOverrides(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, f] of Object.entries(OVERRIDE_FIELDS)) {
    if (!own(v, k)) continue;
    const n = toNum(v[k]);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.min(f.max, Math.max(f.min, Math.round(n)));
  }
  return out;
}

/** Scenario usage with the fine-tune overrides applied (a new object). */
export function applyOverrides(base, overrides) {
  return { ...base, ...sanitizeOverrides(overrides) };
}

// ---------- custom lines ----------

export const MAX_CUSTOM_LINES = 25;
export const MAX_LINE_PRICE = 1e6;
export const MAX_PER_YEAR = 365;
export const MAX_LABEL = 60;
export const RX_TIERS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Custom line kinds. `price` is the suggested allowed amount per occurrence (pre-fills the editor);
 * `field` documents which plan benefit prices it (see KIND_SERVICES in cost.js).
 */
export const CUSTOM_KINDS = {
  pcp: { label: 'Primary care visit', price: 150, field: 'Primary care office visit' },
  specialist: { label: 'Specialist visit', price: 250, field: 'Specialist office visit' },
  urgent: { label: 'Urgent care visit', price: 200, field: 'Urgent care' },
  er: { label: 'ER visit', price: 2200, field: 'Emergency care' },
  hospital_stay: { label: 'Hospital stay', price: 30000, field: 'Hospital inpatient cost per admission' },
  surgery_outpatient: { label: 'Outpatient surgery', price: 6000, field: 'Other outpatient surgery costs (facility)' },
  lab: { label: 'Lab test or X-ray', price: 100, field: 'Diagnostic tests (blood tests, X-rays)' },
  imaging: { label: 'MRI, CT or PET scan', price: 600, field: 'Diagnostic tests (CT, MRI, PET)' },
  therapy: { label: 'Physical therapy session', price: 120, field: 'Physical therapy' },
  rx_generic: { label: 'Generic prescription fill', price: 20, field: 'Drug tier you choose', rx: true, tier: 1 },
  rx_brand: { label: 'Brand prescription fill', price: 400, field: 'Drug tier you choose', rx: true, tier: 2 },
  rx_specialty: { label: 'Specialty drug fill', price: 3000, field: 'Drug tier you choose', rx: true, tier: 4 },
  other: { label: 'Other care', price: 500, field: 'Plan coinsurance after the deductible' },
  // One pregnancy: prenatal care, delivery, postpartum care and the hospital stay for the birth, priced with each
  // plan's brochure-reviewed maternity terms (benefits[code].maternity, from pipeline/maternity_terms.json).
  // The price is the KFF average for women with employer insurance (MATERNITY_SOURCE).
  maternity: { label: 'Pregnancy, delivery and postpartum care', price: 20416, field: 'Maternity care and hospital stay for the birth', maternity: true },
};

/** Where the maternity price comes from (shown in the About dialog). */
export const MATERNITY_SOURCE = {
  price: 20416,
  oop: 2743,
  newbornPrice: 5820,
  newbornOop: 475,
  publisher: 'KFF / Peterson-KFF Health System Tracker',
  date: 'September 9, 2025',
  basis: 'Merative MarketScan claims, 2021-2023, women with employer-sponsored insurance',
  url: 'https://www.kff.org/health-costs/issue-brief/health-costs-associated-with-pregnancy-childbirth-and-postpartum-care/',
};

const has = (o, k) => typeof k === 'string' && own(o, k);
const cents = (n) => Math.round(n * 100) / 100;

/** Plain text label (src/text.js plainText: the same rule as medication names), at most MAX_LABEL chars. */
export function cleanLabel(v) {
  return plainText(v, MAX_LABEL);
}

/**
 * One validated line, or null when it cannot be priced.
 * -> {label, kind, price, perYear, tier?, outOfNetwork?}  (optional keys present only when set)
 */
export function sanitizeLine(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const kind = own(v, 'kind') ? v.kind : undefined;
  if (!has(CUSTOM_KINDS, kind)) return null;
  const price = toNum(own(v, 'price') ? v.price : undefined);
  const per = toNum(own(v, 'perYear') ? v.perYear : undefined);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(per) || per < 0) return null;
  const out = {
    label: cleanLabel(own(v, 'label') ? v.label : ''),
    kind,
    price: cents(Math.min(MAX_LINE_PRICE, price)),
    perYear: Math.min(MAX_PER_YEAR, Math.round(per)),
  };
  if (CUSTOM_KINDS[kind].rx && own(v, 'tier')) {
    const t = toNum(v.tier);
    if (Number.isInteger(t) && RX_TIERS.includes(t)) out.tier = t;
  }
  if (own(v, 'outOfNetwork') && v.outOfNetwork === true) out.outOfNetwork = true;
  return out;
}

/** Up to MAX_CUSTOM_LINES valid lines; invalid entries are skipped (they do not use a slot). */
export function sanitizeLines(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v.slice(0, 200)) {
    const l = sanitizeLine(item);
    if (l) out.push(l);
    if (out.length >= MAX_CUSTOM_LINES) break;
  }
  return out;
}

/** Usage = base scenario usage (default: nothing) plus validated custom lines. */
export function usageFromCustom(lines, baseUsage = SCENARIOS.nothing) {
  return { ...baseUsage, custom: sanitizeLines(lines) };
}

/** Raw yearly spend of a line before any plan cost sharing. */
export function lineSpend(l) {
  if (!l) return 0;
  return cents((l.price || 0) * (l.perYear || 0));
}

// ---------- worst-case presets ----------
// Each preset appends these lines (prices are the same assumptions as ASSUMED_PRICES where one exists).
export const CUSTOM_PRESETS = [
  {
    id: 'surgery',
    label: 'Surgery year',
    description: 'One hospital stay, an outpatient procedure, two scans and twelve physical therapy sessions.',
    lines: [
      { label: 'Hospital stay with surgery', kind: 'hospital_stay', price: 42000, perYear: 1 },
      { label: 'Outpatient procedure', kind: 'surgery_outpatient', price: 6000, perYear: 1 },
      { label: 'MRI or CT scan', kind: 'imaging', price: 600, perYear: 2 },
      { label: 'Physical therapy', kind: 'therapy', price: 120, perYear: 12 },
    ],
  },
  {
    id: 'er_admission',
    label: 'ER + admission',
    description: 'An emergency room visit that turns into a hospital admission, with a follow-up specialist visit.',
    lines: [
      { label: 'Emergency room visit', kind: 'er', price: 2200, perYear: 1 },
      { label: 'Hospital admission', kind: 'hospital_stay', price: 30000, perYear: 1 },
      { label: 'Follow-up specialist', kind: 'specialist', price: 250, perYear: 1 },
    ],
  },
  {
    id: 'chronic',
    label: 'Chronic condition',
    description: 'A specialist visit and a brand prescription every month, plus quarterly lab work.',
    lines: [
      { label: 'Monthly specialist visit', kind: 'specialist', price: 250, perYear: 12 },
      { label: 'Monthly brand prescription', kind: 'rx_brand', price: 400, perYear: 12, tier: 2 },
      { label: 'Lab work', kind: 'lab', price: 100, perYear: 4 },
    ],
  },
  {
    id: 'baby',
    label: 'Having a baby',
    description: 'Prenatal care, delivery and postpartum care for one pregnancy, priced at the average $20,416 of charges for women with employer insurance (KFF, 2025) and shared according to each plan’s own maternity terms. Newborn care is not included: switch to Self plus one or Family for the baby’s premium.',
    lines: [
      { label: 'Pregnancy, delivery and postpartum care', kind: 'maternity', price: 20416, perYear: 1 },
    ],
  },
];
