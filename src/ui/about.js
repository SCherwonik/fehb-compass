// "How it works": the methodology dialog opened from the footer. A native modal <dialog> (focus stays inside,
// Esc closes, the page behind is inert), labelled by its heading; focus returns to the button that opened it.
// Every number in the tables comes from the engine's own constants, so the dialog cannot drift from the math.
import { h } from './dom.js';
import { ASSUMED_PRICES } from '../engine/assumptions.js';
import { SCENARIOS } from '../engine/scenarios.js';
import { DENTAL_SERVICES, DENTAL_PRESETS } from '../engine/dental.js';
import { usd } from './format.js';
import { reduceMotion, EASE_OUT } from './motion.js';

const PRICE_ROWS = [
  ['pcpVisit', 'Primary care visit'], ['specialistVisit', 'Specialist visit'], ['erVisit', 'Emergency room visit'],
  ['inpatientStay', 'Hospital stay (facility)'], ['surgery', 'Surgery during a stay'], ['lab', 'Lab test or X-ray'],
  ['imaging', 'MRI or CT scan'], ['rxGenericFill', 'Generic prescription fill (30 days)'],
];
const SCENARIO_ROWS = [['healthy', 'Healthy'], ['typical', 'Typical'], ['condition', 'Condition'], ['worst', 'Worst case']];
const USAGE_COLS = [['pcpVisits', 'Primary care'], ['specialistVisits', 'Specialist'], ['erVisits', 'ER'], ['hospitalStays', 'Hospital stays'],
  ['labs', 'Labs'], ['imaging', 'Imaging'], ['rxMonthly', 'Monthly generics']];

function table(caption, head, rows, cls = '') {
  return h('table', { class: `ab-table ${cls}` },
    h('caption', {}, caption),
    h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', { class: 'num' }, c)))))));
}

function content() {
  const dentalUse = Object.values(DENTAL_PRESETS).map((p) => `${p.label}: ${p.services.map(([k, n]) => `${n > 1 ? `${n} × ` : ''}${DENTAL_SERVICES[k].label.toLowerCase()}`).join(', ')}`);
  return [
    h('section', {},
      h('h3', {}, 'The yearly total'),
      h('p', { class: 'ab-formula' }, h('strong', {}, 'Total'), ' = premium + expected out-of-pocket costs − HSA or HRA money'),
      h('ul', {},
        h('li', {}, 'Premium: OPM’s 2027 rate for your coverage. Employees pay the per-paycheck rate × 26; retirees pay the monthly rate × 12.'),
        h('li', {}, 'Expected out-of-pocket: the care in your scenario, priced at the assumed amounts below, run through each plan’s deductible, copays, coinsurance and out-of-pocket maximum from OPM’s 2027 benefits file.'),
        h('li', {}, 'HSA or HRA money: the plan’s yearly deposit. HSA money counts in full (it is yours to keep); HRA credit counts only up to the care costs it can pay.'),
        h('li', {}, 'Your medications and dental/vision add the amounts shown in “See the math” when you turn them on.'),
        h('li', {}, 'Ranking with medications: your drugs are priced only on plans where you recorded their tiers, so plans are ranked without them unless every plan shown has every drug priced. Each plan then shows what your medications add on it, or “not looked up”.'))),
    h('section', {},
      h('h3', {}, 'Scenarios'),
      h('p', {}, 'Each scenario is a year of care for one person. “Fine-tune your year” and your own cost lines adjust it.'),
      h('p', {}, 'With Self Plus One or Self and Family coverage, the premium is the one for your coverage, but the care is still one covered person’s, so one person’s limits apply: the self-only deductible and the self-only out-of-pocket maximum (most plans set these inside the family amounts). OPM’s data does not say how each family deductible works, so this is an assumption. HSA plans whose family deductible is exactly twice the self-only one are treated as a single shared family deductible (one person must meet all of it), and every other high-deductible plan the same way, to be cautious; one person’s out-of-pocket costs are still capped at the self-only maximum. The board’s “Deductible type” row shows which rule each plan gets. If several family members need care, real family costs can be higher than these estimates.'),
      h('div', { class: 'ab-scroll' }, table('Care counted in each scenario',
        ['Scenario', ...USAGE_COLS.map(([, l]) => l)],
        SCENARIO_ROWS.map(([k, l]) => [l, ...USAGE_COLS.map(([f]) => String(SCENARIOS[k][f] ?? 0))])))),
    h('section', {},
      h('h3', {}, 'Where plans are offered'),
      h('p', {}, 'OPM lists each regional plan’s service area by state, by whole county, and by ZIP code for counties a plan covers only in part. OPM’s data does not say which county a ZIP code is in, so this tool matches your ZIP code to its county with the U.S. Census Bureau’s 2020 ZIP-to-county file (Census ZIP areas only approximate postal ZIP codes):'),
      h('ul', {},
        h('li', {}, 'A plan that lists your ZIP code’s county is treated as offered to you; one that lists none of its counties is left out.'),
        h('li', {}, 'A plan that serves only some counties of your state is marked “Serves part of [state]: confirm your county” when that match is not possible (no ZIP code yet, or a PO-box ZIP code the Census file does not have), and “Serves part of your ZIP: confirm your address” when your ZIP code spans a county it serves and one it does not. Check the plan brochure’s service area before choosing it.'),
        h('li', {}, 'Those plans stay in the ranking, but the savings banner does not name one as your best plan unless you turn on “Include plans I may not be eligible for”.'),
        h('li', {}, 'A plan that serves your state only in listed ZIP codes is left out when your ZIP code is not one of them.'))),
    h('section', {},
      h('h3', {}, 'Assumed prices'),
      h('p', {}, 'OPM publishes cost sharing, not prices. These amounts stand in for what a plan allows for each service; each hospital stay includes one surgery.'),
      table('Assumed price of each service', ['Service', 'Assumed price'],
        PRICE_ROWS.map(([k, l]) => [l, usd(ASSUMED_PRICES[k])]))),
    h('section', {},
      h('h3', {}, 'Dental and vision'),
      h('ul', {},
        h('li', {}, 'Premiums come from OPM’s 2027 FEDVIP rates for your ZIP code’s rating region, with the same paycheck × 26 or month × 12 rule.'),
        h('li', {}, 'Dental costs use typical list fees, so they are more likely high than low: in-network dentists usually charge plan members less.'),
        ...dentalUse.map((t) => h('li', {}, t)),
        h('li', {}, 'Vision: OPM publishes only text for exams, lenses, frames and contacts, so only stated copays are priced; frame and contact allowances are not.')),
      table('Assumed dental fees', ['Service', 'Assumed fee'], Object.values(DENTAL_SERVICES).map((s) => [s.label, usd(s.price)]))),
    h('section', {},
      h('h3', {}, 'Facts from the plan brochures'),
      h('p', {}, 'Prescription tiers, drug lookup links and “what changed in 2027” come from the 2027 plan brochures. An AI model read each brochure and extracted these facts with quotes. Every fact was then checked against the brochure text: about 77% matched their quote and were kept; the rest were dropped. Where a brochure’s drug tiers disagreed with OPM’s benefits spreadsheet, each disagreement was checked by hand against the brochure, and the board notes when OPM’s spreadsheet differs. One misprinted link (Sharp Health Plan’s drug search, printed as “sharphealtplan.com”) is corrected to the plan’s own site and labelled; links a brochure prints through a link shortener (bit.ly) are labelled as such, since they do not show where they lead.')),
    h('section', {},
      h('h3', {}, 'Known limits'),
      h('ul', {},
        h('li', {}, 'Retiree estimates assume you are not relying on Medicare. With Medicare as your primary coverage, plans pay differently (many waive deductibles and copays); see each plan’s “With Medicare” section.'),
        h('li', {}, 'No provider networks: check that your doctors and hospitals are in network with the plan.'),
        h('li', {}, 'No formulary search: use each plan’s drug lookup link and record the tier you find.'),
        h('li', {}, 'Out-of-network care is counted at full cost, because OPM publishes no out-of-network cost sharing.'),
        h('li', {}, 'OPM’s spreadsheet has a few errors. Where a brochure disagrees and the difference was checked by hand, the totals use the brochure value and mark it “Differs from OPM spreadsheet”: Sharp Health Plan Basic’s deductible ($4,800 per person, not $5,500) and 21 drug-tier prices in 10 plans. Differences that are only a pharmacy channel or tier numbering keep the spreadsheet value.'),
        h('li', {}, 'Estimates, not quotes. The plan brochure is the only contractual statement of coverage.'))),
  ];
}

let dialog = null;

/** Open the dialog (built on first use). `from` gets focus back on close. */
export function openAbout(from) {
  if (!dialog) {
    const close = h('button', { type: 'button', class: 'icon-btn ab-close', 'aria-label': 'Close' },
      h('span', { 'aria-hidden': 'true' }, '×'));
    dialog = h('dialog', { class: 'about glass', 'aria-labelledby': 'about-title' },
      h('header', { class: 'ab-head' }, h('h2', { id: 'about-title', class: 'ab-title' }, 'How FEHB Compass works'), close),
      h('div', { class: 'ab-body' }, content()));
    close.addEventListener('click', () => dialog.close());
    // a click on the backdrop (outside the dialog box) closes it
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
    document.body.append(dialog);
  }
  dialog.onclose = () => from?.focus({ preventScroll: true });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  dialog.querySelector('.ab-body').scrollTop = 0;
  dialog.querySelector('.ab-close').focus();
  if (!reduceMotion()) {
    dialog.animate([{ opacity: 0, transform: 'translateY(12px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_OUT });
  }
}

export function initAbout(button) {
  button?.addEventListener('click', () => openAbout(button));
}
