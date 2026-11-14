// FEDVIP (dental and vision) cost engine. Pure and DOM-free.
//
// Premiums: OPM lists a per-paycheck rate for active employees and a monthly rate for annuitants.
//   active  -> biweekly x 26     retiree -> monthly x 12     (the same rule as FEHB premiums)
//
// Dental out-of-pocket for a usage preset, per plan, from OPM's benefits summary cells
// (data/fedvip.json benefits[plan]: deductible, annual_max, class_a..class_d, ortho_lifetime):
//   - each service has an ASSUMED price (DENTAL_SERVICES, below) and a coverage class:
//       A preventive/diagnostic, B basic ("intermediate"), C major, D orthodontia
//   - the per-person deductible applies to Class B and C services only (FEDVIP plans do not apply it to
//     preventive care; OPM's file does not say whether it applies to orthodontia, so we assume not)
//   - plan share = (charge - deductible part) x (100 - your coinsurance %) ; you pay the rest
//   - Class A-C plan payments stop at the annual maximum (unlimited = no cap); Class D is paid against the
//     lifetime orthodontic maximum instead, which is separate from the annual maximum (when OPM's text gives
//     separate adult and child figures, the preset's audience picks one: braces are for a child)
//   - the assumed prices are typical list fees; in-network negotiated fees are usually lower, so these
//     out-of-pocket figures are more likely to be high than low
//   - "Amt. In Copayment Schedule (Approx N%)" plans (Dominion, Humana Standard) are priced at OPM's
//     approximate percentage and flagged `approx`
//   - a cell the preset needs that has no number (OPM text we cannot read as a %, $ or "unlimited") makes the
//     preset NOT priced for that plan: oop = null, priced = false, with a warning naming the cell. Never NaN.
// The presets describe ONE person's year (the deductible and maximums are per person).
//
// Vision: OPM publishes only text for exam, lenses, frames and copays (no dollar allowances). visionOop
// prices what the copay text states ("$0 Exam $10 Lenses") and says when the rest is in the text only.

const cents = (n) => Math.round(n * 100) / 100;
const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** Annual premium from an OPM FEDVIP rate cell { biweekly_active, monthly_retiree }. null when unknown. */
export function annualPremium(rate, status) {
  if (!rate || typeof rate !== 'object') return null;
  const v = status === 'retiree' ? rate.monthly_retiree : rate.biweekly_active;
  if (!fin(v) || v < 0) return null;
  return cents(v * (status === 'retiree' ? 12 : 26));
}

/** How a premium was annualized, for "See the math": { per: 'paycheck'|'month', count, each }. */
export function premiumBasis(rate, status) {
  const retiree = status === 'retiree';
  const each = retiree ? rate?.monthly_retiree : rate?.biweekly_active;
  return fin(each) ? { per: retiree ? 'month' : 'paycheck', count: retiree ? 12 : 26, each } : null;
}

/**
 * Assumed prices (2027 dollars, typical U.S. fees before insurance; your dentist's fees will differ).
 * Sources of the ballpark: published ADA fee survey ranges and carrier fee guides; we round to round numbers.
 */
export const DENTAL_SERVICES = Object.freeze({
  exam_cleaning: { label: 'Checkup and cleaning', price: 150, cls: 'a' },
  xrays: { label: 'Bitewing X-rays (one set)', price: 75, cls: 'a' },
  filling: { label: 'Filling (two-surface, tooth-colored)', price: 200, cls: 'b' },
  crown: { label: 'Crown (porcelain or ceramic)', price: 1300, cls: 'c' },
  // Many FEDVIP plans pay endodontics as Basic (Class B); we count it as Major, the more cautious choice.
  root_canal: { label: 'Root canal (molar)', price: 1100, cls: 'c' },
  // A full course of braces, counted in one year: the lifetime ortho maximum caps what the plan pays overall.
  braces: { label: 'Braces, full course (child)', price: 6000, cls: 'd' },
});

const CLEANINGS = [['exam_cleaning', 2], ['xrays', 1]];
export const DENTAL_PRESETS = Object.freeze({
  cleanings: { label: 'Cleanings only', short: 'Cleanings', services: CLEANINGS },
  typical: { label: 'Typical', short: 'Typical', services: [...CLEANINGS, ['filling', 1]] },
  major: { label: 'Major work', short: 'Major work', services: [...CLEANINGS, ['crown', 1], ['root_canal', 1]] },
  braces: { label: 'Braces (child)', short: 'Braces', services: [...CLEANINGS, ['braces', 1]], audience: 'child' },
});

export const VISION_PRESETS = Object.freeze({
  exam: { label: 'Exam only', short: 'Exam', needs: ['exam'] },
  glasses: { label: 'Exam + glasses', short: 'Exam + glasses', needs: ['exam', 'materials'] },
  contacts: { label: 'Exam + contacts', short: 'Exam + contacts', needs: ['exam', 'contacts'] },
});

export const CLASS_LABEL = { a: 'Preventive (Class A)', b: 'Basic (Class B)', c: 'Major (Class C)', d: 'Orthodontia (Class D)' };

/** Plain text describing a dental preset: "2 × Checkup and cleaning ($150), 1 × ...". */
export function describeDentalPreset(key) {
  const p = own(DENTAL_PRESETS, key);
  if (!p) return '';
  return p.services.map(([k, n]) => `${n} × ${DENTAL_SERVICES[k].label} ($${DENTAL_SERVICES[k].price.toLocaleString('en-US')})`).join(', ');
}

const cellText = (c) => (c && typeof c.text === 'string' ? c.text : 'not listed');

/** Dollar cap from a cell: number, Infinity for unlimited, or null when unreadable. */
function capOf(cell) {
  if (!cell || typeof cell !== 'object') return null;
  if (cell.unit === 'unlimited') return Infinity;
  return fin(cell.value) && cell.value >= 0 ? cell.value : null;
}

/**
 * Lifetime orthodontic maximum for an audience ('child' | 'adult'). Some plans list two figures in one OPM cell
 * ("$2000 Per Adult $4000 Per Child ..."), and the pipeline's numeric `value` is simply the first one; here the
 * text decides. Falls back to the cell's value (or Infinity for no lifetime maximum, null when unreadable).
 */
export function orthoCap(cell, audience = 'child') {
  if (!cell || typeof cell !== 'object') return null;
  const text = typeof cell.text === 'string' ? cell.text.slice(0, 500) : '';
  const found = {};
  for (const m of text.matchAll(/\$\s*([0-9][0-9,]*)\s*Per\s+(Adult|Child)/gi)) {
    const who = m[2].toLowerCase();
    if (found[who] == null) found[who] = Number(m[1].replace(/,/g, ''));
  }
  const want = audience === 'adult' ? 'adult' : 'child';
  if (fin(found[want])) return found[want];
  return capOf(cell);
}

const notPriced = (warnings, extra = {}) => ({
  priced: false, oop: null, planPaid: null, billed: null, lines: [], warnings, approx: false, capped: false, orthoCapped: false, ...extra,
});

/**
 * Expected out-of-pocket for one person's year under a dental preset, from the plan's In-Network 1 cells.
 * -> { priced, oop, planPaid, billed, lines: [{ key, label, cls, count, charge, youPay }], approx, capped,
 *      orthoCapped, warnings: string[] }
 */
export function dentalOop(benefits, presetKey) {
  const preset = own(DENTAL_PRESETS, presetKey);
  if (!preset) return notPriced(['Unknown usage preset.']);
  if (!benefits || typeof benefits !== 'object') return notPriced(['No OPM benefits for this plan.']);
  const warnings = [];
  const services = preset.services.map(([k, n]) => ({ key: k, count: n, ...DENTAL_SERVICES[k] }));
  const classes = new Set(services.map((s) => s.cls));

  const ded = capOf(own(benefits, 'deductible'));
  const needsDed = classes.has('b') || classes.has('c');
  if (needsDed && (ded == null || ded === Infinity)) warnings.push(`Deductible: OPM lists “${cellText(own(benefits, 'deductible'))}”, which we cannot read as a dollar amount.`);
  const annualMax = capOf(own(benefits, 'annual_max'));
  if (annualMax == null) warnings.push(`Annual maximum: OPM lists “${cellText(own(benefits, 'annual_max'))}”, which we cannot read as a dollar amount.`);
  const pct = {};
  let approx = false;
  for (const cls of classes) {
    const cell = own(benefits, `class_${cls}`);
    const v = cell && fin(cell.value) && cell.unit === 'pct' && cell.value >= 0 && cell.value <= 100 ? cell.value : null;
    if (v == null) warnings.push(`${CLASS_LABEL[cls]}: OPM lists “${cellText(cell)}”, which we cannot read as a percentage.`);
    else { pct[cls] = v; if (cell.approx) approx = true; }
  }
  let orthoMax = Infinity;
  if (classes.has('d')) {
    orthoMax = orthoCap(own(benefits, 'ortho_lifetime'), preset.audience ?? 'adult');
    if (orthoMax == null) warnings.push(`Orthodontia lifetime maximum: OPM lists “${cellText(own(benefits, 'ortho_lifetime'))}”, which we cannot read as a dollar amount.`);
  }
  if (warnings.length) return notPriced(warnings, { approx });

  let dedLeft = needsDed ? ded : 0;
  let maxLeft = annualMax;
  let orthoLeft = orthoMax;
  let planPaid = 0;
  let billed = 0;
  let capped = false;
  let orthoCapped = false;
  const lines = [];
  // preventive first, then basic, major, ortho: the order the deductible and the maximum are used up
  const order = [...services].sort((a, b) => a.cls.localeCompare(b.cls));
  for (const s of order) {
    let youPay = 0;
    for (let i = 0; i < s.count; i++) {
      const charge = s.price;
      billed += charge;
      const dedPart = s.cls === 'b' || s.cls === 'c' ? Math.min(dedLeft, charge) : 0;
      dedLeft -= dedPart;
      const share = (charge - dedPart) * (1 - pct[s.cls] / 100);
      let paid;
      if (s.cls === 'd') {
        paid = Math.min(share, orthoLeft);
        if (paid < share) orthoCapped = true;
        orthoLeft -= paid;
      } else {
        paid = Math.min(share, maxLeft);
        if (paid < share) capped = true;
        maxLeft -= paid;
      }
      planPaid += paid;
      youPay += charge - paid;
    }
    lines.push({ key: s.key, label: s.label, cls: s.cls, count: s.count, charge: s.price, youPay: cents(youPay) });
  }
  return {
    priced: true, oop: cents(billed - planPaid), planPaid: cents(planPaid), billed: cents(billed),
    lines, approx, capped, orthoCapped, warnings: [],
  };
}

/**
 * Copays stated in OPM's vision "Copay" text: { exam, materials, unlabeled } in dollars or null.
 * "Lenses", "Glasses" and "Materials" all count as the materials copay. A lone "$10" is `unlabeled`.
 */
export function parseVisionCopays(text) {
  const out = { exam: null, materials: null, unlabeled: null };
  if (typeof text !== 'string' || !text.trim() || text.length > 500) return out;
  const exam = text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:for\s+)?exam/i);
  const mat = text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:for\s+)?(?:lenses|glasses|materials|eyewear)/i);
  if (exam) out.exam = Number(exam[1]);
  if (mat) out.materials = Number(mat[1]);
  if (!exam && !mat) {
    const one = text.trim().match(/^\$\s*([0-9]+(?:\.[0-9]+)?)$/);
    if (one) out.unlabeled = Number(one[1]);
  }
  return out;
}

const VISION_TEXT_NOTE = 'benefit details in text: OPM publishes no dollar allowances for frames or contacts';

/**
 * Vision out-of-pocket for a preset, from the copay text only.
 * -> { priced, oop, parts: [{ key, label, amount|null }], note }
 * priced = every part of the preset has a stated copay; oop = the sum of the parts that do (null when none).
 */
export function visionOop(benefits, presetKey) {
  const preset = own(VISION_PRESETS, presetKey);
  const copayText = own(own(benefits, 'copay') ?? {}, 'text');
  const c = parseVisionCopays(typeof copayText === 'string' ? copayText : '');
  if (!preset) return { priced: false, oop: null, parts: [], note: 'Unknown usage preset.' };
  const LABELS = { exam: 'Eye exam copay', materials: 'Lenses and frames copay', contacts: 'Contact lenses' };
  const parts = preset.needs.map((k) => {
    let amount = null;
    if (k === 'exam') amount = c.exam;
    else if (k === 'materials') amount = c.materials;
    return { key: k, label: LABELS[k], amount };
  });
  // a lone unlabelled copay: shown, but we do not guess what it covers
  if (c.unlabeled != null && parts.every((p) => p.amount == null)) {
    return {
      priced: false, oop: c.unlabeled, parts,
      note: `OPM lists a single $${c.unlabeled} copay without saying what it covers; ${VISION_TEXT_NOTE}.`,
    };
  }
  const known = parts.filter((p) => fin(p.amount));
  const priced = known.length === parts.length;
  const oop = known.length ? cents(known.reduce((s, p) => s + p.amount, 0)) : null;
  let note = 'Copays from OPM’s text. Costs above the plan’s frame or lens allowance are not counted: OPM does not publish allowances.';
  if (!priced) note = `${parts.filter((p) => !fin(p.amount)).map((p) => p.label).join(' and ')}: ${VISION_TEXT_NOTE}.`;
  return { priced, oop, parts, note };
}
