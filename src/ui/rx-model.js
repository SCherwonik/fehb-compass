// Prescription facts from the 2027 plan brochures (data/brochure_facts.json, built and verified by
// pipeline/validate_extractions.py) plus the "my medications" cost math. Pure and DOM-free (node tested).
//
// brochure_facts.json: { meta: { brochures: { '<brochure>': { url, pages, plan_codes } } },
//   plans: { '<plan code>': { brochure, option, rx: { tiers[], pbm, formulary_url, drug_lookup_url, ... },
//            changes_2027[], network, member_services, ... } } }
// Every fact carries `page` (a PDF page index, so `<brochure url>#page=<page>` opens it) and a verbatim `quote`.
//
// Normalized tier (rxFor):
//   { name, number (0-7|null), label, deductibleApplies (true|false|null = not stated), crosscheck, badge,
//     retail30, retail90, mail }   each channel cell: { value, unit: 'usd'|'pct'|'text', text, quote, cap, floor, cite } | null
//   badge: null | { kind: 'differs'|'unresolved', text, sheet?, why, detail?, cite? }
// Links: every URL that reaches the DOM goes through normalizeUrl (http/https only).

import { usd, usdExact } from './format.js';

let FACTS = null;
/** Register the loaded facts file (null when it is missing). Functions below default to it. */
export function setBrochureFacts(facts) { FACTS = facts && typeof facts === 'object' ? facts : null; }
export function getBrochureFacts() { return FACTS; }

const own = (o, k) => (o && typeof o === 'object' && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const cents = (n) => Math.round(n * 100) / 100;
const str = (s) => (typeof s === 'string' ? s.trim() : '');

// ---------- URLs ----------

// Controls, whitespace, zero-width and bidi overrides: never valid inside a link we print.
const BAD_CHARS = /[\u0000- \u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF]/;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Accept only http(s) URLs (bare 'www.' hosts get https://). Anything else, including javascript:, data:,
 * protocol-relative and credentialed URLs, returns null. Returns the parsed, normalized href.
 */
export function normalizeUrl(u) {
  if (typeof u !== 'string') return null;
  let s = u.trim();
  if (!s || s.length > 2048 || BAD_CHARS.test(s)) return null;
  if (/^www\./i.test(s)) s = `https://${s}`;
  if (!/^https?:\/\//i.test(s)) return null;
  let url;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (!HOST_RE.test(url.hostname)) return null;
  return url.href;
}

const URL_CAND = /(https?:\/\/[^\s;,()<>"'“”]+|\bwww\.[^\s;,()<>"'“”]+|(?<![@\w.\-/])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|gov|net|edu|us|health|ly|io)\b(?:\/[^\s;,()<>"'“”]*)?)/gi;

/**
 * First usable link in free brochure text ("www. fepblue.org (drug cost tool); ..."). When the text has
 * per-option segments ("High Option: www.a.com; Consumer Driven Option: https://b..."), `option` picks one.
 */
export function extractUrl(text, option) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) return null;
  let t = text;
  const opt = str(option).toLowerCase();
  if (opt) {
    const seg = t.split(/;\s*/).find((part) => part.trim().toLowerCase().startsWith(`${opt}:`));
    if (seg) t = seg.slice(seg.indexOf(':') + 1);
  }
  t = t.replace(/\bwww\.\s+/gi, 'www.');
  for (const m of t.matchAll(URL_CAND)) {
    const c = m[0].replace(/[.)\]]+$/, '');
    const href = /^(https?:\/\/|www\.)/i.test(c) ? normalizeUrl(c) : normalizeUrl(`https://${c}`);
    if (href) return href;
  }
  return null;
}

// ---------- citations ----------

function brochureUrl(code, facts) {
  const p = own(facts?.plans, code);
  const b = p ? own(facts?.meta?.brochures, p.brochure) : null;
  return b ? normalizeUrl(b.url) : null;
}

/** { label: 'Brochure p.80', short: 'p.80', page, quote, href|null } for a fact of plan `code`, or null. */
export function citation(fact, code, facts = FACTS) {
  if (!fact || typeof fact !== 'object') return null;
  const page = fact.page;
  if (!Number.isInteger(page) || page < 1 || page > 5000) return null;
  const base = brochureUrl(code, facts);
  return {
    label: `Brochure p.${page}`,
    short: `p.${page}`,
    page,
    quote: str(fact.quote).slice(0, 400) || null,
    href: base ? `${base.split('#')[0]}#page=${page}` : null,
  };
}

// ---------- tiers ----------

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
/** 'Tier 2' -> 2, 'Tier IV' -> 4, 'Tier 1 (Preferred generic)' -> 1; named tiers -> null. */
export function tierNumber(name) {
  const m = /^\s*tier\s+(\d|vii|vi|iv|v|iii|ii|i)\b/i.exec(typeof name === 'string' ? name : '');
  if (!m) return null;
  return /\d/.test(m[1]) ? Number(m[1]) : ROMAN[m[1].toUpperCase()];
}

const money = (s) => Number(String(s).replace(/,/g, ''));
/** Per-fill cap and floor stated in coinsurance wording ("up to a $150 maximum", "$30 minimum"). */
export function parseCaps(text) {
  const t = typeof text === 'string' ? text : '';
  const cap = /maximum of \$\s?([\d,]+(?:\.\d+)?)/i.exec(t) ?? /\$\s?([\d,]+(?:\.\d+)?)\s*max(?:imum)?\b/i.exec(t);
  const floor = /minimum of \$\s?([\d,]+(?:\.\d+)?)/i.exec(t) ?? /\$\s?([\d,]+(?:\.\d+)?)\s*min(?:imum)?\b/i.exec(t);
  return { cap: cap ? money(cap[1]) : null, floor: floor ? money(floor[1]) : null };
}

function channelCell(c, code, facts) {
  if (!c || typeof c !== 'object') return null;
  const quote = str(c.quote);
  const cite = citation(c, code, facts);
  if ((c.unit === 'usd' || c.unit === 'pct') && fin(c.value) && c.value >= 0) {
    if (c.unit === 'usd') return { value: c.value, unit: 'usd', text: usdExact(c.value), quote, cap: null, floor: null, cite };
    const { cap, floor } = parseCaps(quote);
    const bits = [floor != null && `min ${usdExact(floor)}`, cap != null && `max ${usdExact(cap)}`].filter(Boolean);
    return { value: c.value, unit: 'pct', text: `${c.value}%${bits.length ? ` (${bits.join(', ')})` : ''}`, quote, cap, floor, cite };
  }
  if (!quote) return null;
  return { value: null, unit: 'text', text: quote, quote, cap: null, floor: null, cite };
}

function badgeOf(t, code, facts) {
  if (t.crosscheck === 'unresolved') {
    return {
      kind: 'unresolved',
      text: 'Not confirmed: check the brochure',
      why: 'The brochure and OPM’s spreadsheet disagree here and the difference could not be settled. Check the brochure page before relying on this amount.',
      cite: citation(t.adjudication, code, facts) ?? citation(t.retail_30, code, facts),
    };
  }
  if (t.crosscheck !== 'adjudicated' && t.crosscheck !== 'adjudicated_brochure') return null;
  const sheet = str(t.crosscheck_sheet) || str(t.sheet_discrepancy);
  if (!sheet) return null;
  const cite = citation(t.adjudication, code, facts);
  const where = cite ? ` on page ${cite.page}` : '';
  return {
    kind: 'differs',
    text: 'Differs from OPM spreadsheet',
    sheet,
    why: `OPM’s spreadsheet lists “${sheet}”. The plan brochure, the plan’s official statement of benefits, says otherwise${where}, so the brochure amount is shown.`,
    detail: str(t.sheet_discrepancy) || null,
    cite,
  };
}

function textFact(f, code, facts) {
  if (!f || typeof f !== 'object') return null;
  const text = str(f.quote);
  return text ? { text, cite: citation(f, code, facts) } : null;
}

function coveredFact(f, code, facts) {
  const t = textFact(f, code, facts);
  if (!t) return null;
  return { ...t, covered: f.covered === true ? true : f.covered === false ? false : null };
}

const sameOption = (a, b) => {
  const x = str(a).toLowerCase();
  const y = str(b).toLowerCase();
  return Boolean(x && y) && (x === y || x === 'all' || x.includes(y) || y.includes(x));
};

const rxCache = new WeakMap();

/**
 * Normalized prescription facts for a plan code, or null (unknown plan / no facts).
 * `option` (the brochure option name, e.g. 'Basic Option') narrows the tiers when it matches some.
 */
export function rxFor(code, option, facts = FACTS) {
  if (!facts || typeof facts !== 'object') return null;
  const p = own(facts.plans, code);
  if (!p || typeof p !== 'object') return null;
  let cache = rxCache.get(facts);
  if (!cache) { cache = new Map(); rxCache.set(facts, cache); }
  const key = `${code}\u0000${option ?? ''}`;
  if (cache.has(key)) return cache.get(key);

  const rx = p.rx && typeof p.rx === 'object' ? p.rx : {};
  let raw = Array.isArray(rx.tiers) ? rx.tiers.filter((t) => t && typeof t === 'object') : [];
  if (option) {
    const only = raw.filter((t) => sameOption(t.option, option));
    if (only.length) raw = only;
  }
  // Some brochures list two tiers under one name (plans 541/544/PT4: 'Tier 3' for non-preferred generics and for
  // non-preferred brands): keep both, told apart by their label ('Tier 3 (other)', 'Tier 3 (non-preferred brand)').
  const baseName = (t) => str(t.tier) || (str(t.label) ? `${t.label[0].toUpperCase()}${t.label.slice(1)} tier` : 'Other tier');
  const counts = new Map();
  for (const t of raw) counts.set(baseName(t), (counts.get(baseName(t)) ?? 0) + 1);
  const seen = new Set();
  const tiers = [];
  for (const t of raw) {
    let name = baseName(t);
    if (counts.get(name) > 1 && str(t.label)) name = `${name} (${str(t.label)})`;
    for (let k = 2; seen.has(name); k++) name = `${baseName(t)} (${k})`;
    seen.add(name);
    tiers.push({
      name,
      number: tierNumber(name),
      label: str(t.label) || null,
      deductibleApplies: t.deductible_applies === true ? true : t.deductible_applies === false ? false : null,
      crosscheck: str(t.crosscheck) || 'n/a',
      badge: badgeOf(t, code, facts),
      retail30: channelCell(t.retail_30, code, facts),
      retail90: channelCell(t.retail_90, code, facts),
      mail: channelCell(t.mail_90, code, facts),
    });
  }
  const oop = (Array.isArray(rx.rx_oop_max) ? rx.rx_oop_max : [])
    .filter((f) => f && typeof f === 'object' && (!option || !f.option || sameOption(f.option, option)))
    .map((f) => ({ ...textFact(f, code, facts), value: fin(f.value) ? f.value : null, option: str(f.option) || null }))
    .filter((f) => f.text);
  const out = {
    code,
    brochure: str(p.brochure) || null,
    option: str(p.option) || null,
    tiers,
    pbm: textFact(rx.pbm, code, facts),
    formularyName: textFact(rx.formulary_name, code, facts),
    lookup: lookupFor(code, facts),
    retailNetwork: textFact(rx.retail_network, code, facts),
    mailOrder: textFact(rx.mail_order, code, facts),
    specialty: textFact(rx.specialty_pharmacy, code, facts),
    priorAuth: textFact(rx.prior_authorization, code, facts),
    stepTherapy: textFact(rx.step_therapy, code, facts),
    quantityLimits: textFact(rx.quantity_limits, code, facts),
    glp1WeightLoss: coveredFact(rx.glp1_weight_loss, code, facts),
    glp1Diabetes: coveredFact(rx.glp1_diabetes, code, facts),
    preventiveFree: textFact(rx.preventive_drugs_free, code, facts),
    rxOopMax: oop,
    otherNotable: (Array.isArray(rx.other_notable) ? rx.other_notable : []).map((f) => textFact(f, code, facts)).filter(Boolean),
  };
  cache.set(key, out);
  return out;
}

// URL shorteners: the link does not show its destination (never followed or expanded here).
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 'ow.ly', 't.co', 'goo.gl', 'rebrand.ly', 'is.gd', 'buff.ly', 'shorturl.at']);

/** 'sharphealthplan.com' from a link (leading www. dropped), or null for anything normalizeUrl rejects. */
export function linkHost(href) {
  const u = normalizeUrl(href);
  return u ? new URL(u).hostname.replace(/^www\./i, '').toLowerCase() : null;
}

/** The fields a lookup button needs (rx-render lookupButton), for board and matrix cells. */
export function lookupLink(l) {
  if (!l) return null;
  return { href: l.href, text: l.text, host: l.host, shortener: l.shortener === true, ...(l.corrected ? { corrected: l.corrected } : {}), ...(l.note ? { note: l.note } : {}) };
}

/**
 * The plan's drug lookup link: drug_lookup_url, else formulary_url, else the member website.
 * A fact corrected by pipeline/link_overrides.json carries `url` (used instead of the printed text) and
 * `corrected` { printed, page, reason }.
 * -> { href, kind: 'lookup'|'formulary'|'website', text, cite, host, shortener, corrected?, note? } | null
 */
export function lookupFor(code, facts = FACTS) {
  const p = own(facts?.plans, code);
  if (!p) return null;
  const tries = [
    ['lookup', p.rx?.drug_lookup_url, 'Look up your drug'],
    ['formulary', p.rx?.formulary_url, 'Look up your drug'],
    ['website', p.member_services?.website, 'Plan website'],
  ];
  for (const [kind, f, text] of tries) {
    if (!f || typeof f !== 'object') continue;
    const fixed = typeof f.url === 'string' ? normalizeUrl(f.url) : null;
    const href = fixed ?? extractUrl(f.quote, p.option);
    if (!href) continue;
    const host = linkHost(href);
    const shortener = SHORTENERS.has(host);
    const out = { href, kind, text, cite: citation(f, code, facts), host, shortener };
    if (fixed && f.corrected && typeof f.corrected === 'object') {
      out.corrected = { printed: str(f.corrected.printed), page: Number.isInteger(f.corrected.page) ? f.corrected.page : null, reason: str(f.corrected.reason) };
      out.note = `Corrected from the brochure’s misprint “${out.corrected.printed}”.`;
    } else if (shortener) {
      out.note = 'Link shortener from the brochure: it does not show where it leads.';
    }
    return out;
  }
  return null;
}

/** GLP-1 for weight loss per the brochure: true (covered), false (not covered), null (not stated / unknown plan). */
export function glp1Status(code, facts = FACTS) {
  const c = own(facts?.plans, code)?.rx?.glp1_weight_loss?.covered;
  return c === true ? true : c === false ? false : null;
}

/** True only when the plan's brochure says GLP-1 drugs for weight loss are covered. */
export function glp1Covered(code, facts = FACTS) {
  return own(facts?.plans, code)?.rx?.glp1_weight_loss?.covered === true;
}

// ---------- matrix rows (Prescriptions section, below the spreadsheet tier rows) ----------

const CHANNELS_ROWS = [
  ['retail30', 'retail 30-day', ''],
  ['retail90', 'retail 90-day', ':r90'],
  ['mail', 'mail order 90-day', ':mail'],
];

function tierCell(t, ch) {
  if (!t) return null;
  const c = t[ch];
  if (!c) return null;
  const notes = [];
  if (t.deductibleApplies === true) notes.push('Deductible applies first');
  else if (t.deductibleApplies === false) notes.push('No deductible');
  if (c.unit === 'pct' && c.quote) notes.push(c.quote);
  const base = { text: c.quote || c.text, name: t.label ?? undefined, note: notes.join(' · ') || undefined, cite: c.cite, badge: t.badge ?? undefined };
  if (c.unit === 'text') return { ...base, kind: 'text', display: c.text };
  if (c.value === 0) return { ...base, kind: 'nothing', display: '$0', value: 0, unit: 'zero' };
  return { ...base, kind: 'value', display: c.text, value: c.value, unit: c.unit };
}

const textCell = (f, extra = {}) => (f ? { text: f.text, kind: 'text', display: f.text, cite: f.cite, ...extra } : null);

function coveredCell(f) {
  if (!f) return null;
  if (f.covered === true) return { text: f.text, kind: 'covered', display: 'Covered', note: f.text, cite: f.cite };
  if (f.covered === false) return { text: f.text, kind: 'notcovered', display: 'Not covered', note: f.text, cite: f.cite };
  return textCell(f);
}

/**
 * Extra row definitions for buildMatrix (matrix-model.js `extra`), all in the 'rx' section:
 * [{ section, key, label, hint, dir, get(plan) -> rich cell | null }]. Rich cells carry `cite`
 * ({ short, href }), optional `link` ({ href, text }) and `badge` (tier crosscheck).
 * Tier rows exist for the tier numbers some plan in `codes` lists; best-in-row stays numeric (matrix rowBest).
 */
export function rxSummaryRows(codes, facts = FACTS) {
  if (!facts) return [];
  const list = (codes ?? []).filter((c) => own(facts.plans, c));
  const rxOf = (p) => rxFor(p.code, undefined, facts);
  const rows = [];
  const add = (key, label, get, { dir = null, hint, sub } = {}) => rows.push({
    section: 'rx', key, label, hint: hint ?? 'From the plan’s 2027 brochure', sub, dir,
    get: (p) => { const rx = rxOf(p); return rx ? get(rx) : null; },
  });

  add('br:pbm', 'Pharmacy program (PBM)', (rx) => (rx.pbm ? textCell(rx.pbm, { note: rx.formularyName ? `Formulary: ${rx.formularyName.text}` : undefined }) : null));
  add('br:lookup', 'Drug lookup / formulary', (rx) => (rx.lookup ? {
    text: rx.lookup.href, kind: 'link', display: rx.lookup.text, cite: rx.lookup.cite,
    link: lookupLink(rx.lookup),
    note: [rx.lookup.kind === 'website' ? 'The brochure names no drug lookup page; this is the plan’s website.' : '', rx.lookup.corrected ? rx.lookup.note : ''].filter(Boolean).join(' ') || undefined,
  } : null), { hint: 'Opens the plan’s own drug search in a new tab. Check which tier each of your drugs is on.' });

  const numbers = new Set();
  let named = false;
  for (const c of list) {
    for (const t of rxFor(c, undefined, facts)?.tiers ?? []) (t.number == null ? (named = true) : numbers.add(t.number));
  }
  for (const n of [...numbers].sort((a, b) => a - b)) {
    for (const [ch, words, suffix] of CHANNELS_ROWS) {
      add(`br:tier${n}${suffix}`, `Tier ${n} · ${words}`, (rx) => tierCell(rx.tiers.find((t) => t.number === n), ch), {
        dir: 'min', hint: 'What you pay per fill, from the brochure. A badge marks tiers where OPM’s spreadsheet says something else.',
      });
    }
  }
  if (named) {
    for (const [ch, words, suffix] of [CHANNELS_ROWS[0], CHANNELS_ROWS[2]]) {
      add(`br:named${suffix}`, `Named tiers · ${words}`, (rx) => {
        const ts = rx.tiers.filter((t) => t.number == null && t[ch]);
        if (!ts.length) return null;
        const line = ts.map((t) => `${t.name}: ${t[ch].unit === 'text' ? 'see brochure' : t[ch].text}`).join(' · ');
        return { text: line, kind: 'text', display: line, cite: ts[0][ch].cite, badge: ts.find((t) => t.badge)?.badge };
      }, { hint: 'Plans that name their tiers (Generic, Preferred brand…) instead of numbering them.' });
    }
  }
  add('br:mailorder', 'Mail-order pharmacy', (rx) => textCell(rx.mailOrder));
  add('br:specialty', 'Specialty pharmacy', (rx) => textCell(rx.specialty));
  add('br:pa', 'Prior authorization', (rx) => textCell(rx.priorAuth));
  add('br:step', 'Step therapy', (rx) => textCell(rx.stepTherapy));
  add('br:ql', 'Quantity limits', (rx) => textCell(rx.quantityLimits));
  add('br:glp1w', 'GLP-1 for weight loss', (rx) => coveredCell(rx.glp1WeightLoss), { hint: 'Drugs such as Wegovy or Zepbound prescribed for weight loss.' });
  add('br:glp1d', 'GLP-1 for diabetes', (rx) => coveredCell(rx.glp1Diabetes));
  add('br:prev', 'Free preventive drugs', (rx) => textCell(rx.preventiveFree));
  add('br:rxoop', 'Rx out-of-pocket max (brochure)', (rx) => {
    const f = rx.rxOopMax.find((x) => !/medicare/i.test(x.text)) ?? rx.rxOopMax[0];
    if (!f) return null;
    // a Medicare-only drug maximum is shown as text so it never "wins" against a plan-wide cap
    if (fin(f.value) && !/medicare/i.test(f.text)) return { text: f.text, kind: 'value', display: usdExact(f.value), value: f.value, unit: 'usd', note: f.text, cite: f.cite };
    return textCell(f);
  }, { dir: 'min' });
  return rows;
}

// ---------- my medications: cost of one drug on one plan ----------

export const CHANNELS = Object.freeze({
  retail30: { cell: 'retail30', days: 30, label: 'retail 30-day', short: 'Retail, 30-day' },
  retail90: { cell: 'retail90', days: 90, label: '90-day retail', short: 'Retail, 90-day' },
  mail: { cell: 'mail', days: 90, label: 'mail order 90-day', short: 'Mail order, 90-day' },
  // specialty drugs are dispensed a month at a time; brochures state them as the tier's 30-day amount
  specialty: { cell: 'retail30', days: 30, label: 'specialty 30-day', short: 'Specialty pharmacy' },
});

const clip = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * What one drug costs a year on one plan, from the plan's brochure tier terms. Ignores the deductible's
 * interaction with your other care (the engine does that); when the deductible applies first it says so.
 * drug: { name, monthlyCost?, fillsPerYear?, channel? }; tier: recorded value: a tier name ('Tier 2'),
 * a number 0-6, 'nc' (not covered), 'pa' (needs prior authorization) or nothing (not looked up yet).
 * -> { status: 'priced'|'missing'|'notcovered'|'pa'|'lookup', text, perFill, annual, days, fills, price,
 *      tierName, share, deductibleApplies, missing?, warning?, cite? }
 * `share` is the engine form: { kind: 'usd'|'pct'|'zero'|'full', value?, cap?, floor? }.
 */
export function annualDrugCost(drug, tier, planRx, { deductibleDefault = false } = {}) {
  const ch = own(CHANNELS, drug?.channel) ?? CHANNELS.retail30;
  const fills = Number.isInteger(drug?.fillsPerYear) && drug.fillsPerYear > 0 && drug.fillsPerYear <= 366 ? drug.fillsPerYear : 12;
  const days = ch.days;
  const monthly = fin(drug?.monthlyCost) && drug.monthlyCost >= 0 ? drug.monthlyCost : null;
  const price = monthly == null ? null : cents((monthly * days) / 30);
  const base = { status: 'missing', text: '', perFill: null, annual: null, days, fills, price, tierName: null, share: null, deductibleApplies: null };
  const per = `/ ${days} days`;

  if (tier == null || tier === '') return { ...base, status: 'lookup', text: 'Look it up' };
  if (tier === 'pa') {
    return { ...base, status: 'pa', text: 'Needs prior authorization', missing: 'the tier it is covered at once approved', warning: 'Needs prior authorization: your doctor has to get approval first.' };
  }
  if (tier === 'nc') {
    const warning = 'Not covered: you would pay the full price.';
    if (price == null) {
      return { ...base, status: 'notcovered', text: 'Not covered · add its monthly cost to estimate', missing: 'its monthly cost (to estimate the full price)', warning };
    }
    const annual = cents(price * fills);
    return { ...base, status: 'notcovered', perFill: price, annual, share: { kind: 'full' }, warning,
      text: `Not covered · ${usdExact(price)} ${per} · ${usd(annual)} a year` };
  }

  const tierName = typeof tier === 'number' && Number.isInteger(tier) ? `Tier ${tier}` : str(tier);
  const out = { ...base, tierName };
  const miss = (missing, text) => ({ ...out, missing, text: text ?? `${tierName} · ${missing}` });
  if (!planRx || !Array.isArray(planRx.tiers)) return miss('this plan’s brochure tier terms are not available');
  const t = planRx.tiers.find((x) => x.name === tierName)
    ?? (tierNumber(tierName) != null ? planRx.tiers.find((x) => x.number === tierNumber(tierName)) : undefined);
  if (!t) return miss(`${tierName} is not in this plan’s brochure tier list`, `${tierName} · not in this plan’s brochure`);
  const cell = t[ch.cell];
  out.cite = cell?.cite ?? null;
  if (!cell) return miss(`the brochure lists no ${ch.label} amount for ${tierName}`, `${tierName} · no ${ch.label} amount in the brochure`);
  if (cell.unit === 'text') {
    return miss(`the brochure states ${ch.label} terms for ${tierName} in words, not an amount: “${clip(cell.quote)}”`,
      `${tierName} · see the brochure for ${ch.label} terms`);
  }
  const ded = t.deductibleApplies ?? (deductibleDefault === true);
  out.deductibleApplies = ded;
  const after = ded ? ' after the deductible' : '';

  if (cell.unit === 'usd') {
    const v = cell.value;
    out.share = v === 0 ? { kind: 'zero' } : { kind: 'usd', value: v };
    if (v === 0) return { ...out, status: 'priced', perFill: 0, annual: 0, deductibleApplies: false, text: `${tierName} · $0 ${per} · $0 a year` };
    if (price == null && ded) {
      return miss(`its monthly cost (the deductible applies before the ${usdExact(v)} copay)`, `${tierName} · ${usdExact(v)} ${per}${after}`);
    }
    const perFill = price == null ? v : Math.min(v, price);
    const annual = cents(perFill * fills);
    return { ...out, status: 'priced', perFill, annual, text: `${tierName} · ${usdExact(perFill)} ${per} · ${usd(annual)} a year${after}` };
  }
  // coinsurance
  const v = cell.value;
  out.share = { kind: 'pct', value: v, cap: cell.cap, floor: cell.floor };
  if (price == null) return miss(`its monthly cost (${tierName} is ${v}% coinsurance)`, `${tierName} · ${cell.text} of the price`);
  let perFill = (price * v) / 100;
  if (cell.floor != null) perFill = Math.max(perFill, Math.min(cell.floor, price));
  if (cell.cap != null) perFill = Math.min(perFill, cell.cap);
  perFill = cents(perFill);
  const annual = cents(perFill * fills);
  return { ...out, status: 'priced', perFill, annual, text: `${tierName} · ${v}% of ${usdExact(price)} = ${usdExact(perFill)} ${per} · ${usd(annual)} a year${after}` };
}

/** HSA plans are HDHPs: drug tiers silent about the deductible sit behind it (same rule as the engine). */
const hdhpDefault = (benefits) => /savings/i.test(String(benefits?.account_type ?? ''));

/**
 * The user's medications on one plan.
 * meds: { drugs: [{ id, name, monthlyCost, fillsPerYear, channel }], records: { [code]: { [drugId]: tier } } }
 * -> null (no drugs) | { count, notLookedUp, pending, factsMissing, items, entries, estimate, lookup }
 *   items: annualDrugCost per drug plus { drugId, name, tier, lookup }
 *   entries: engine `drugs` entries for the priced ones { label, fillsPerYear, price, share, deductibleApplies }
 *   notLookedUp: drugs with no tier recorded for this plan; pending: recorded but not priceable
 *   (prior authorization, a missing price or unknown terms). Neither is counted in the total.
 */
export function planMeds(facts, meds, code, benefits) {
  const drugs = Array.isArray(meds?.drugs) ? meds.drugs : [];
  if (!drugs.length) return null;
  const lookup = facts ? lookupFor(code, facts) : null;
  if (!facts) {
    const items = drugs.map((d) => ({ status: 'pending', text: 'Brochure facts not loaded', drugId: d.id, name: d.name, tier: undefined, lookup: null }));
    return { count: drugs.length, notLookedUp: 0, pending: drugs.length, factsMissing: true, items, entries: [], estimate: 0, lookup: null };
  }
  const rx = rxFor(code, undefined, facts);
  const rec = own(meds?.records, code) ?? {};
  const deductibleDefault = hdhpDefault(benefits);
  const items = drugs.map((d) => {
    const tier = own(rec, d.id);
    return { ...annualDrugCost(d, tier, rx, { deductibleDefault }), drugId: d.id, name: d.name, tier, lookup };
  });
  const entries = [];
  let estimate = 0;
  for (const it of items) {
    if (!it.share || it.annual == null) continue;
    entries.push({ label: it.name, fillsPerYear: it.fills, price: it.price ?? it.perFill, share: it.share, deductibleApplies: it.deductibleApplies, drugId: it.drugId });
    estimate += it.annual;
  }
  return {
    count: drugs.length,
    notLookedUp: items.filter((i) => i.status === 'lookup').length,
    pending: items.filter((i) => i.status !== 'lookup' && (!i.share || i.annual == null)).length,
    factsMissing: false,
    items,
    entries,
    estimate: cents(estimate),
    lookup,
  };
}

// ---------- what changed in 2027 ----------

export const CHANGE_CATEGORIES = Object.freeze([
  { id: 'premium', label: 'Premium' },
  { id: 'copay', label: 'Copays' },
  { id: 'deductible', label: 'Deductible' },
  { id: 'oop_max', label: 'Out-of-pocket max' },
  { id: 'prescription', label: 'Prescriptions' },
  { id: 'benefit_added', label: 'Benefits added' },
  { id: 'benefit_removed', label: 'Benefits removed' },
  { id: 'network', label: 'Network' },
  { id: 'other', label: 'Other changes' },
]);
const CAT_IDS = new Set(CHANGE_CATEGORIES.map((c) => c.id));

/**
 * Brochure "changes for 2027" grouped by category in CHANGE_CATEGORIES order (empty groups dropped).
 * -> [{ category, label, items: [{ summary, from, to, quote, cite }] }]
 */
export function groupChanges(changes, code, facts = FACTS) {
  const by = new Map();
  for (const c of Array.isArray(changes) ? changes : []) {
    if (!c || typeof c !== 'object') continue;
    const summary = str(c.summary) || str(c.quote);
    if (!summary) continue;
    const cat = typeof c.category === 'string' && CAT_IDS.has(c.category) ? c.category : 'other';
    if (!by.has(cat)) by.set(cat, []);
    by.get(cat).push({ summary, from: str(c.from) || null, to: str(c.to) || null, quote: str(c.quote) || null, cite: citation(c, code, facts) });
  }
  return CHANGE_CATEGORIES.filter((c) => by.has(c.id)).map((c) => ({ category: c.id, label: c.label, items: by.get(c.id) }));
}

/** Grouped changes for a plan code ([] when the plan has none or facts are missing). */
export function changesFor(code, facts = FACTS) {
  return groupChanges(own(facts?.plans, code)?.changes_2027, code, facts);
}
