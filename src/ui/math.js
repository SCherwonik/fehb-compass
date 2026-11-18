// "See the math": how one plan's yearly total is built, for the plan cards (inline) and the Board (a dialog).
// mathContent(row, state, data, basis) -> the nodes for the panel; openMathDialog(...) shows them on their own.
import { h, svg } from './dom.js';
import { effectiveUsage, describeUsage, overrideChanges, inNetworkAtMax } from './assumptions.js';
import { personLimitsNote, rankTotal } from './model.js';
import { memberLabel } from './members-model.js';
import { memberBlockInput, familyInNetwork, assumedHeading, memberAssumed, householdDeductibleNote, labelledByMember, itemWho, familyDeductibleUse, sharedDeductible, oopNote, gapNote, deductibleHow, gapFirmness } from './math-family.js';
import { dvMathLines } from './dental-board.js';
import { ASSUMED_PRICES, ASSUMPTIONS_NOTE } from '../engine/assumptions.js';
import { UNCLEAR_FAMILY_DEDUCTIBLE } from '../engine/cost.js';
import { usd, usdExact } from './format.js';
import { reduceMotion, EASE_OUT } from './motion.js';

export const ICON_WARN = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-warn"><path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.6v3.2M8 11.6v.1"/></svg>';

const PRICE_LABELS = {
  pcpVisit: 'Primary care visit', specialistVisit: 'Specialist visit', erVisit: 'Emergency room visit',
  inpatientStay: 'Hospital stay (facility)', surgery: 'Surgery during a stay', lab: 'Lab or X-ray',
  imaging: 'MRI or CT scan', rxGenericFill: 'Generic prescription fill',
};

// the scenario's services as the member reads them (engine breakdown.services[].service)
const SERVICE_NAMES = {
  primary_care: 'Primary care visits', specialist: 'Specialist visits', lab_xray: 'Lab tests and X-rays', imaging: 'Imaging (MRI, CT)',
  emergency: 'Emergency room visits', inpatient_admission: 'Hospital stays', inpatient_surgeon: 'Surgery during stays',
  rx_tier1: 'Generic prescription fills',
};

const SERVICE_SINGULAR = {
  primary_care: 'Primary care visit', specialist: 'Specialist visit', lab_xray: 'Lab test or X-ray', imaging: 'Imaging scan (MRI, CT)',
  emergency: 'Emergency room visit', inpatient_admission: 'Hospital stay', inpatient_surgeon: 'Surgery during a stay',
  rx_tier1: 'Generic prescription fill',
};

export function mathLine(label, value, cls = '') {
  return h('div', { class: `math-line ${cls}` }, h('span', { class: 'math-label' }, label), h('span', { class: 'math-val' }, value));
}

// One sentence on how the pregnancy stands in this plan's ranked total (only with a "Having a baby" line).
function matMathLine(row, { medsInRank, matInRank, matEstimated }) {
  const m = row.maternity;
  if (!m) return null;
  let text;
  if (!m.priced) {
    text = row.isEnded
      ? 'No maternity cost is in this 2026 total: maternity is priced only for 2027 plans, from their brochures.'
      : 'No maternity cost is in this total: the plan’s brochure gives no way to total it for one pregnancy (see Your own costs below).';
  } else if (matInRank) {
    text = `Every shown plan has a maternity price${matEstimated ? ' (some estimated)' : ''}, so the ${usd(m.cost)} this pregnancy adds here${m.estimated ? ' (estimated)' : ''} is in the ranked total.`;
  } else {
    text = `Plans are ranked without maternity, because some shown plans’ brochures give no maternity total: the ${usd(m.cost)} `
      + `this pregnancy adds here${m.estimated ? ' (estimated)' : ''} is left out of the ranked total (${usd(rankTotal(row, medsInRank, false))}).`;
  }
  // an estimate's reason (what it assumes and why) is the line's own note under "Your own costs"
  return [mathLine(text + (m.estimated ? ' See Your own costs below for what the estimate assumes.' : ''), '', 'math-sub math-note math-mat')];
}

// "Primary care visit" for one, "Primary care visits" for more
const serviceName = (s, n) => {
  const plural = SERVICE_NAMES[s.service] ?? (s.label ? s.label[0].toUpperCase() + s.label.slice(1) : 'Care');
  return n === 1 ? (SERVICE_SINGULAR[s.service] ?? plural) : plural;
};

/**
 * "Toward the deductible: $250 of $3,000" with a bar of how much of it this year uses (medications' share included).
 * `ctx.before` (a shared family deductible): what earlier people already used, so the bar shows the use so far.
 */
function deductibleLines(b, drugsDed, ctx = {}) {
  const limit = Number.isFinite(b.deductible) ? b.deductible : null;
  const before = ctx.before ?? 0;
  const used = before + b.deductiblePaid;
  const shown = b.deductiblePaid - drugsDed;
  if (!limit) return [mathLine('Toward the deductible', usd(shown), 'math-sub'), mathLine('This plan has no deductible to meet.', '', 'math-sub math-note')];
  const pct = Math.max(0, Math.min(100, (used / limit) * 100));
  return [
    mathLine(h('span', {}, 'Toward the deductible ', h('span', { class: 'math-how' }, deductibleHow(b, ctx))), usd(shown), 'math-sub'),
    h('div', {
      class: 'math-meter', role: 'img',
      'aria-label': `${usd(used)} of the ${usd(limit)} deductible used${drugsDed > 0 ? `, ${usd(drugsDed)} of it by your medications` : ''}`,
    }, h('i', { style: `width:${pct.toFixed(1)}%` })),
    h('p', { class: 'math-how math-meter-note' },
      (ctx.shared ? `The bar is the shared deductible used so far, in the order people are listed${before > 0 ? `: ${usd(before)} by those before them` : ''}. ` : '')
      + (used >= limit - 0.5 ? 'Deductible fully met this year.'
        : ctx.familyDedMet ? `The family’s ${usd(ctx.familyDeductible)} deductible is met, so no more deductible applies to anyone this year.`
          : `${usd(limit - used)} of the deductible is left unused${drugsDed > 0 ? `; medications used ${usd(drugsDed)} of it` : ''}.`)),
  ];
}

/** "Toward the out-of-pocket max: $890 of $6,000" with a bar; in-network care only (out-of-network has its own limit). */
function oopMaxLines(b, cost, hitMax, label = 'Toward the out-of-pocket max', ctx = {}) {
  const limit = Number.isFinite(b.oopMax) ? b.oopMax : null;
  if (!limit) return [mathLine('This plan lists no out-of-pocket max.', '', 'math-sub math-note')];
  const used = Math.max(0, cost.oop - (b.oonPaid || 0) - (b.notCoveredPaid || 0));
  const pct = Math.max(0, Math.min(100, (used / limit) * 100));
  return [
    mathLine(h('span', {}, `${label} `, h('span', { class: 'math-how' }, `of ${usd(limit)}${b.onePerson ? ' (one person)' : ''}`)), usd(used), 'math-sub'),
    h('div', { class: 'math-meter', role: 'img', 'aria-label': `${usd(used)} of the ${usd(limit)} out-of-pocket max reached` }, h('i', { style: `width:${pct.toFixed(1)}%` })),
    h('p', { class: 'math-how math-meter-note' }, oopNote(b, used, hitMax, ctx)),
  ];
}

/** One scenario service: "3 × $150 = $450 billed" and what the member pays after the plan's rule, with the rule itself. */
function serviceItem(s, capped) {
  const name = SERVICE_NAMES[s.service] ?? (s.label ? s.label[0].toUpperCase() + s.label.slice(1) : 'Care');
  const free = s.cost < 0.005;
  return h('li', {},
    h('div', { class: 'mc-row' },
      h('span', { class: 'mc-name' }, name, h('span', { class: 'math-how' }, `${s.count} × ${usdExact(s.price)} = ${usd(s.spend)} billed`)),
      h('span', { class: 'num mc-cost' }, free ? '$0' : `+ ${usd(s.cost)}`)),
    s.rule && h('p', { class: 'mc-note' }, `Plan rule: ${s.rule}`),
    capped && free && s.spend > 0 && !s.rule ? h('p', { class: 'mc-note' }, 'Nothing more to pay: the out-of-pocket max was already reached.') : null);
}

// what a person's care adds up to, before any rounding line
const careSumOf = (b) => b.deductiblePaid - (b.drugsDeductible || 0) + b.coinsurancePaid + b.copays + (b.oonPaid || 0) + (b.drugsPaid || 0);

// the services, then the own lines, then medications, as they add up to care costs (one person's, or one member's)
function itemLines(b, medsLabel) {
  return [
    ...(b.services ?? []).map((s) => mathLine(
      h('span', {}, `${s.count} × ${serviceName(s, s.count)} `, h('span', { class: 'math-how' }, `${usdExact(s.price)} billed each`)),
      s.cost < 0.005 ? '$0' : usd(s.cost), 'math-sub math-svc-line')),
    ...(b.custom ?? []).map((c) => mathLine(
      h('span', {}, `${c.perYear} × ${c.label} `, h('span', { class: 'math-how' }, `${usdExact(c.price)} each`)),
      c.unpriced ? 'not counted' : usd(c.cost), 'math-sub math-svc-line')),
    medsLabel && mathLine(medsLabel, usd(b.drugsPaid || 0), 'math-sub math-svc-line'),
  ];
}

/** "How that was paid:" with the deductible and out-of-pocket max bars (`ctx`: a shared deductible's use so far). */
function paidLines(b, cost, hitMax, ctx) {
  return [
    h('p', { class: 'math-how math-split-h' }, 'How that was paid:'),
    ...deductibleLines(b, b.drugsDeductible || 0, ctx),
    mathLine('Coinsurance', usd(b.coinsurancePaid), 'math-sub'),
    mathLine('Copays', usd(b.copays), 'math-sub'),
    ...oopMaxLines(b, cost, hitMax, undefined, ctx),
    b.oonPaid > 0 && mathLine('Out of network, at full cost', usd(b.oonPaid), 'math-sub'),
  ];
}

const roundingLine = (b, oop) => Math.abs(careSumOf(b) - oop) > 1 && mathLine('Rounding', usd(oop - careSumOf(b)), 'math-sub');

/** One covered person's block: their name, their care lines, and how it was paid (the deductible bar is shared on HDHPs). */
function memberBlock(state, b, i) {
  const { b: mb, ...ctx } = memberBlockInput(b, i);
  const cost = { oop: mb.oop, breakdown: mb };
  const hasDrugs = (mb.drugs ?? []).length > 0 || (mb.drugsPaid || 0) > 0;
  return h('div', { class: 'math-member' },
    h('p', { class: 'math-h math-member-title' }, memberLabel(state, i)),
    mathLine(h('span', {}, h('i', { class: 'dot dot-oop' }), 'Expected care costs'), `+ ${usd(mb.oop)}`),
    ...itemLines(mb, hasDrugs && 'Medications'),
    ...paidLines(mb, cost, inNetworkAtMax(cost), ctx),
    roundingLine(mb, mb.oop));
}

/** "Toward the family deductible: $X of $Y" with a bar: everyone's deductible spending (embedded) or the one shared pot. */
function familyDeductibleLines(b) {
  const use = familyDeductibleUse(b);
  if (!use) return [];
  const { used, limit } = use;
  const pct = Math.max(0, Math.min(100, (used / limit) * 100));
  const met = used >= limit - 0.5;
  return [
    mathLine(h('span', {}, 'Toward the family deductible ', h('span', { class: 'math-how' }, `of ${usd(limit)}`)), usd(used), 'math-sub'),
    h('div', { class: 'math-meter', role: 'img', 'aria-label': `${usd(used)} of the family’s ${usd(limit)} deductible used` }, h('i', { style: `width:${pct.toFixed(1)}%` })),
    h('p', { class: 'math-how math-meter-note' }, `${usd(used)} of the family’s ${usd(limit)} deductible. `
      + (sharedDeductible(b)
        ? (met ? 'Met: no more deductible applies to anyone this year.' : `${usd(limit - used)} of it is left unused.`)
        : (b.deductibleType === 'individual'
          ? `As the plan’s brochure states, each person’s deductible stops at ${usd(b.deductible)}, and everyone’s deductible spending together stops at ${usd(limit)}`
          : `Each person meets their own ${usd(b.deductible)} deductible until everyone’s deductible spending together reaches ${usd(limit)}`)
          + (met ? ', which it did (in the order people are listed), so no more deductible applies to anyone this year.' : `; ${usd(limit - used)} of it is left unused.`))),
  ];
}

/** The "Whole family" block: the care sum, the family deductible and out-of-pocket max bars, and what limits each person. */
function familyBlock(b, cost, code) {
  const inNet = familyInNetwork(b);
  const famMax = b.familyOopMax;
  const shared = sharedDeductible(b);
  const unclear = UNCLEAR_FAMILY_DEDUCTIBLE[code];
  const uses = 'the first person’s care listed uses it up first, then the next.';
  const order = unclear
    ? `How this plan’s family deductible works is unclear. ${unclear}. It is treated as shared (the cautious choice): ${uses}`
    : b.deductibleType === 'aggregate'
      ? `This plan’s family deductible is treated as shared (an HSA plan whose family deductible is twice the self-only one): ${uses}`
      : `How a family deductible works differs by plan, and this plan’s data does not say, so it is treated as shared (the cautious choice): ${uses}`;
  return h('div', { class: 'math-member math-family' },
    h('p', { class: 'math-h math-member-title' }, 'Whole family'),
    mathLine(h('span', {}, h('i', { class: 'dot dot-oop' }), 'Expected care costs, everyone'), `+ ${usd(cost.oop)}`),
    ...familyDeductibleLines(b),
    ...(famMax == null
      ? [mathLine('This plan’s data lists no family out-of-pocket max, so each person is capped at the self-only max and no family cap is applied.', '', 'math-sub math-note')]
      : oopMaxLines({ oopMax: famMax, onePerson: false }, { oop: inNet }, inNet >= famMax - 0.5, 'Toward the family out-of-pocket max')),
    Number.isFinite(b.oopMax) && mathLine(`No one pays more than ${usd(b.oopMax)} in-network, this plan’s self-only out-of-pocket max (the tool’s assumption where the brochure does not say).`, '', 'math-sub math-note'),
    shared && mathLine(order, '', 'math-sub math-note'),
    roundingLine(b, cost.oop));
}

/**
 * The panel's nodes: [summary lines, notes]. `basis` = { medsInRank, matInRank, matEstimated } as the results view
 * knows them (which extras are in the ranked totals).
 */
export function mathContent(row, state, data, basis) {
  const { cost } = row;
  const b = cost.breakdown;
  const year = row.isEnded ? 2026 : 2027; // the ended reference card is costed from 2026 rates and benefits
  const rate = data.rates[year][row.code][state.enrollment];
  const premiumHow = state.status === 'retiree'
    ? `${usdExact(rate.monthly_retiree)} a month × 12`
    : `${usdExact(rate.biweekly_active)} per paycheck × 26`;
  const family = b.memberCount > 1;
  const hitMax = !family && inNetworkAtMax(cost); // in-network part only: OON spend has its own limit
  const raw = row.account ? row.benefits.account_contribution?.[state.enrollment] ?? 0 : 0;
  const premiumLine = mathLine(h('span', {}, h('i', { class: 'dot dot-prem' }), 'Premium ', h('span', { class: 'math-how' }, premiumHow)), usd(cost.premium));
  const tail = [
    row.account && mathLine(
      h('span', {}, h('i', { class: 'dot dot-dep' }), row.account === 'HRA' ? 'HRA credit used ' : 'HSA deposit ',
        h('span', { class: 'math-how' }, row.account === 'HRA'
          ? `${usd(raw)} available; only counts against care costs`
          : 'the plan puts this in your account')),
      `− ${usd(cost.hsaOffset)}`),
    ...dvMathLines(row.dv, mathLine),
    mathLine('Estimated yearly total', usd(cost.total), 'math-total'),
    ...(matMathLine(row, basis) ?? []),
  ];

  // 2+ covered people: a block each, then the whole family; one person: the plain list
  const lines = (family
    ? [premiumLine, ...b.members.map((_, i) => memberBlock(state, b, i)), familyBlock(b, cost, row.code), ...tail]
    : [
      premiumLine,
      mathLine(h('span', {}, h('i', { class: 'dot dot-oop' }), 'Expected care costs'), `+ ${usd(cost.oop)}`),
      // what makes up that figure: each service of the scenario, "1 × Primary care visit", then your own lines
      ...itemLines(b, row.meds && 'Your medications'),
      ...paidLines(b, cost, hitMax, {}),
      b.onePerson && mathLine(personLimitsNote(b), '', 'math-sub math-note math-person'),
      roundingLine(b, cost.oop),
      ...tail,
    ]).filter(Boolean);

  const prices = Object.entries(ASSUMED_PRICES).map(([k, v]) =>
    h('li', {}, h('span', {}, PRICE_LABELS[k] ?? k), h('span', { class: 'num' }, usd(v))));

  // the scenario's own services, one by one: how many, what they bill, what you pay under the plan's rule
  const services = b.services ?? [];
  const serviceBlock = services.length > 0 && [
    h('p', { class: 'math-h' }, family ? 'What each part of the year costs the family here' : 'What each part of the year costs you here'),
    h('ul', { class: 'math-custom math-svc' }, services.map((s) => serviceItem(s, hitMax))),
    h('p', { class: 'math-p math-fine' }, `Services add up to ${usd(services.reduce((a, s) => a + s.cost, 0))}`
      + `${(b.custom ?? []).length || row.meds ? ', before your own costs and medications below' : ''}. `
      + (family ? householdDeductibleNote(b) : 'The deductible is used up by the first services billed, in the order listed.')),
  ];

  // custom lines: what each one adds to this plan's care costs, with its own notes and warnings
  const customs = b.custom ?? [];
  // a household's merged list says whose each line is
  const ownCosts = family ? labelledByMember(state, b.members.map((m) => m.custom)) : customs.map((item) => ({ item, who: null }));
  const lineMsgs = new Set(customs.flatMap((c) => c.warnings));
  const otherWarnings = b.warnings.filter((w) => !lineMsgs.has(w));
  const customBlock = customs.length > 0 && [
    h('p', { class: 'math-h' }, 'Your own costs'),
    h('ul', { class: 'math-custom' }, ownCosts.map(({ item: c, who }) => h('li', { class: c.warnings.length ? 'has-warn' : '' },
      h('div', { class: 'mc-row' },
        h('span', { class: 'mc-name' }, who ? `${who}: ${c.label}` : c.label,
          h('span', { class: 'math-how' }, `${c.perYear} × ${usdExact(c.price)}${c.outOfNetwork ? ', out of network' : ''}`)),
        h('span', { class: 'num mc-cost' }, c.unpriced ? 'not counted' : `+ ${usd(c.cost)}${c.estimated ? ' (estimated)' : ''}`)),
      [...c.warnings.map((w) => h('p', { class: 'mc-warn' }, svg(ICON_WARN), w)),
        ...c.notes.map((n) => h('p', { class: 'mc-note' }, n))]))),
  ];
  const changes = overrideChanges(state);
  // medications: what each priced drug adds here (deductible and OOP max applied), and which ones are left out
  const drugRows = family ? labelledByMember(state, b.members.map((m) => m.drugs)) : (b.drugs ?? []).map((item) => ({ item, who: null }));
  const medsBlock = row.meds && [
    h('p', { class: 'math-h' }, 'Your medications'),
    h('ul', { class: 'math-custom' },
      drugRows.map(({ item: dl, who }) => h('li', {},
        h('div', { class: 'mc-row' },
          h('span', { class: 'mc-name' }, who ? `${who}: ${dl.label}` : dl.label, h('span', { class: 'math-how' }, `${dl.fillsPerYear} fills, from the brochure tier you recorded`)),
          h('span', { class: 'num mc-cost' }, `+ ${usd(dl.cost)}`)))),
      row.meds.items.filter((it) => !it.share || it.annual == null).map((it) => h('li', { class: 'has-warn' },
        h('div', { class: 'mc-row' }, h('span', { class: 'mc-name' }, family ? `${itemWho(state, it)}: ${it.name}` : it.name), h('span', { class: 'num mc-cost' }, 'not counted')),
        h('p', { class: 'mc-warn' }, svg(ICON_WARN), it.status === 'lookup' ? 'Not looked up for this plan yet.' : it.missing ? `Missing ${it.missing}.` : it.text)))),
  ];

  // the card tags explain themselves in a hover title; this repeats it for touch and keyboard users
  const gaps = b.gaps ?? [];
  const firmness = cost.firmness === 'fixed'
    ? 'Fixed cost: every service in this scenario is a flat copay, so this total does not depend on assumed prices.'
    : gaps.length > 0
      ? gapFirmness(gaps)
      : 'Estimated: part of this total depends on the assumed prices listed below.';
  const oonNote = b.oonEstimate === true
    ? ' Out-of-network lines are counted at full cost: OPM publishes no out-of-network cost sharing.'
    : '';
  return [
    h('div', { class: 'math-sum' }, lines),
    h('div', { class: 'math-notes' },
      h('p', { class: 'math-p math-firm' }, firmness + oonNote),
      ...gaps.map((g) => h('p', { class: 'mc-warn math-gap' }, svg(ICON_WARN), gapNote(g))),
      ...(family
        ? b.members.flatMap((_, i) => { const a = memberAssumed(state, i); return [h('p', { class: 'math-h' }, a.title), h('p', { class: 'math-p' }, a.text)]; })
        : [h('p', { class: 'math-h' }, assumedHeading(state.scenario, changes.length > 0)),
          h('p', { class: 'math-p' }, describeUsage(effectiveUsage(state)))]),
      serviceBlock,
      customBlock,
      medsBlock,
      h('p', { class: 'math-h' }, 'Assumed price of each service'),
      h('ul', { class: 'math-prices' }, prices),
      h('p', { class: 'math-p math-fine' }, `${ASSUMPTIONS_NOTE.replace('ASSUMED_PRICES', 'these prices')} Your plan's copays and coinsurance come from OPM's ${year} benefits file.`),
      otherWarnings.length > 0 && h('p', { class: 'math-h' }, 'Could not price'),
      otherWarnings.length > 0 && h('ul', { class: 'math-warn' }, otherWarnings.map((w) => h('li', {}, w)))),
  ];
}

// ---------- the Board's version: the same panel in a dialog ----------
let dialog = null;

/** Open the math for one plan in a modal dialog. `from` gets focus back on close. */
export function openMathDialog(row, state, data, basis, from) {
  if (!dialog) {
    const close = h('button', { type: 'button', class: 'icon-btn ab-close', 'aria-label': 'Close' }, h('span', { 'aria-hidden': 'true' }, '×'));
    dialog = h('dialog', { class: 'about glass math-dialog', 'aria-labelledby': 'math-dialog-title' },
      h('header', { class: 'ab-head' }, h('h2', { id: 'math-dialog-title', class: 'ab-title' }), close),
      h('div', { class: 'ab-body math-inner' }));
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
    document.body.append(dialog);
  }
  dialog.querySelector('.ab-title').textContent = `${row.plan?.name ?? row.code}: how the total adds up`;
  dialog.querySelector('.ab-body').replaceChildren(...mathContent(row, state, data, basis));
  dialog.onclose = () => from?.focus({ preventScroll: true });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  dialog.querySelector('.ab-body').scrollTop = 0;
  dialog.querySelector('.ab-close').focus();
  if (!reduceMotion()) {
    dialog.animate([{ opacity: 0, transform: 'translateY(12px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_OUT });
  }
}
