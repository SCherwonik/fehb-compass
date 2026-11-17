// "See the math": how one plan's yearly total is built, for the plan cards (inline) and the Board (a dialog).
// mathContent(row, state, data, basis) -> the nodes for the panel; openMathDialog(...) shows them on their own.
import { h, svg } from './dom.js';
import { effectiveUsage, describeUsage, overrideChanges, inNetworkAtMax } from './assumptions.js';
import { personLimitsNote, rankTotal } from './model.js';
import { dvMathLines } from './dental-board.js';
import { ASSUMED_PRICES, ASSUMPTIONS_NOTE } from '../engine/assumptions.js';
import { usd, usdExact } from './format.js';
import { reduceMotion, EASE_OUT } from './motion.js';

export const SCENARIO_TEXT = { healthy: 'healthy', typical: 'typical', condition: 'managing a condition', worst: 'worst case', nothing: 'start-from-nothing' };
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
  // medications are reported as their own line; the part of the deductible they used moves with them
  const drugsDed = b.drugsDeductible || 0;
  const careSum = b.deductiblePaid - drugsDed + b.coinsurancePaid + b.copays + (b.oonPaid || 0) + (b.drugsPaid || 0);
  const hitMax = inNetworkAtMax(cost); // in-network part only: OON spend has its own limit
  const raw = row.account ? row.benefits.account_contribution?.[state.enrollment] ?? 0 : 0;

  const lines = [
    mathLine(h('span', {}, h('i', { class: 'dot dot-prem' }), 'Premium ', h('span', { class: 'math-how' }, premiumHow)), usd(cost.premium)),
    mathLine(h('span', {}, h('i', { class: 'dot dot-oop' }), 'Expected care costs'), `+ ${usd(cost.oop)}`),
    mathLine('Toward the deductible', usd(b.deductiblePaid - drugsDed), 'math-sub'),
    mathLine('Coinsurance', usd(b.coinsurancePaid), 'math-sub'),
    mathLine('Copays', usd(b.copays), 'math-sub'),
    b.oonPaid > 0 && mathLine('Out of network, at full cost', usd(b.oonPaid), 'math-sub'),
    row.meds && mathLine(h('span', {}, 'Your medications ',
      h('span', { class: 'math-how' }, `${row.meds.entries.length} of ${row.meds.count} priced${b.notCoveredPaid > 0 ? `, ${usd(b.notCoveredPaid)} not covered` : ''}`)),
    usd(b.drugsPaid || 0), 'math-sub math-meds'),
    hitMax && mathLine(`Capped at the ${usd(b.oopMax)} out-of-pocket max${b.onePerson ? ' for one person' : ''}`, '', 'math-sub math-note'),
    b.onePerson && mathLine(personLimitsNote(b), '', 'math-sub math-note math-person'),
    Math.abs(careSum - cost.oop) > 1 && mathLine('Rounding', usd(cost.oop - careSum), 'math-sub'),
    row.account && mathLine(
      h('span', {}, h('i', { class: 'dot dot-dep' }), row.account === 'HRA' ? 'HRA credit used ' : 'HSA deposit ',
        h('span', { class: 'math-how' }, row.account === 'HRA'
          ? `${usd(raw)} available; only counts against care costs`
          : 'the plan puts this in your account')),
      `− ${usd(cost.hsaOffset)}`),
    ...dvMathLines(row.dv, mathLine),
    mathLine('Estimated yearly total', usd(cost.total), 'math-total'),
    ...(matMathLine(row, basis) ?? []),
  ].filter(Boolean);

  const prices = Object.entries(ASSUMED_PRICES).map(([k, v]) =>
    h('li', {}, h('span', {}, PRICE_LABELS[k] ?? k), h('span', { class: 'num' }, usd(v))));

  // the scenario's own services, one by one: how many, what they bill, what you pay under the plan's rule
  const services = b.services ?? [];
  const serviceBlock = services.length > 0 && [
    h('p', { class: 'math-h' }, 'What each part of the year costs you here'),
    h('ul', { class: 'math-custom math-svc' }, services.map((s) => serviceItem(s, hitMax))),
    h('p', { class: 'math-p math-fine' }, `Services add up to ${usd(services.reduce((a, s) => a + s.cost, 0))}`
      + `${(b.custom ?? []).length || row.meds ? ', before your own costs and medications below' : ''}. `
      + 'The deductible is used up by the first services billed, in the order listed.'),
  ];

  // custom lines: what each one adds to this plan's care costs, with its own notes and warnings
  const customs = b.custom ?? [];
  const lineMsgs = new Set(customs.flatMap((c) => c.warnings));
  const otherWarnings = b.warnings.filter((w) => !lineMsgs.has(w));
  const customBlock = customs.length > 0 && [
    h('p', { class: 'math-h' }, 'Your own costs'),
    h('ul', { class: 'math-custom' }, customs.map((c) => h('li', { class: c.warnings.length ? 'has-warn' : '' },
      h('div', { class: 'mc-row' },
        h('span', { class: 'mc-name' }, c.label,
          h('span', { class: 'math-how' }, `${c.perYear} × ${usdExact(c.price)}${c.outOfNetwork ? ', out of network' : ''}`)),
        h('span', { class: 'num mc-cost' }, c.unpriced ? 'not counted' : `+ ${usd(c.cost)}${c.estimated ? ' (estimated)' : ''}`)),
      [...c.warnings.map((w) => h('p', { class: 'mc-warn' }, svg(ICON_WARN), w)),
        ...c.notes.map((n) => h('p', { class: 'mc-note' }, n))]))),
  ];
  const changes = overrideChanges(state);
  // medications: what each priced drug adds here (deductible and OOP max applied), and which ones are left out
  const medsBlock = row.meds && [
    h('p', { class: 'math-h' }, 'Your medications'),
    h('ul', { class: 'math-custom' },
      (b.drugs ?? []).map((dl) => h('li', {},
        h('div', { class: 'mc-row' },
          h('span', { class: 'mc-name' }, dl.label, h('span', { class: 'math-how' }, `${dl.fillsPerYear} fills, from the brochure tier you recorded`)),
          h('span', { class: 'num mc-cost' }, `+ ${usd(dl.cost)}`)))),
      row.meds.items.filter((it) => !it.share || it.annual == null).map((it) => h('li', { class: 'has-warn' },
        h('div', { class: 'mc-row' }, h('span', { class: 'mc-name' }, it.name), h('span', { class: 'num mc-cost' }, 'not counted')),
        h('p', { class: 'mc-warn' }, svg(ICON_WARN), it.status === 'lookup' ? 'Not looked up for this plan yet.' : it.missing ? `Missing ${it.missing}.` : it.text)))),
  ];

  // the card tags explain themselves in a hover title; this repeats it for touch and keyboard users
  const firmness = cost.firmness === 'fixed'
    ? 'Fixed cost: every service in this scenario is a flat copay, so this total does not depend on assumed prices.'
    : 'Estimated: part of this total depends on the assumed prices listed below.';
  const oonNote = b.oonEstimate === true
    ? ' Out-of-network lines are counted at full cost: OPM publishes no out-of-network cost sharing.'
    : '';
  return [
    h('div', { class: 'math-sum' }, lines),
    h('div', { class: 'math-notes' },
      h('p', { class: 'math-p math-firm' }, firmness + oonNote),
      h('p', { class: 'math-h' }, state.scenario === 'nothing'
        ? 'Care assumed: none beyond your own costs'
        : `Care assumed for a ${SCENARIO_TEXT[state.scenario]} year${changes.length ? ', fine-tuned' : ''}`),
      h('p', { class: 'math-p' }, describeUsage(effectiveUsage(state))),
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
