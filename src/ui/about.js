// "How it works": the methodology dialog opened from the footer. A native modal <dialog> (focus stays inside,
// Esc closes, the page behind is inert), labelled by its heading; focus returns to the button that opened it.
// Every number in the tables comes from the engine's own constants, so the dialog cannot drift from the math.
import { h } from './dom.js';
import { ASSUMED_PRICES } from '../engine/assumptions.js';
import { SCENARIOS, MATERNITY_SOURCE } from '../engine/scenarios.js';
import { MATERNITY_ASSUMPTIONS } from '../engine/maternity-assumptions.js';
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

/** The three maternity assumptions (engine/maternity-assumptions.js), with their sources. */
function maternityAssumptionsTable() {
  const link = (s) => h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label);
  const rows = Object.values(MATERNITY_ASSUMPTIONS).map((a) => h('tr', {},
    h('th', { scope: 'row' }, a.what),
    h('td', {}, a.label),
    h('td', {}, a.basis, ...a.sources.flatMap((s) => [' ', link(s)]))));
  return h('table', { class: 'ab-table ab-table-text' },
    h('caption', {}, 'Assumptions used only where a plan’s brochure leaves the count or share out'),
    h('thead', {}, h('tr', {}, ['What', 'Assumed', 'Source'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows));
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
      h('p', {}, 'Each scenario is a year of care for one person. With Self Plus One or Self and Family coverage you set up each covered person’s year (“Covered people”), and the plan is costed for the whole household. “Fine-tune your year” and your own cost lines adjust a person’s year.'),
      h('p', {}, 'With Self Plus One or Self and Family coverage, the premium is the one for your coverage, and each covered person’s care is run through the plan one person after another.'),
      h('p', {}, 'How a family deductible works differs by plan, and OPM’s data does not record it. Some brochures state it plainly, and this tool follows what they state: UnitedHealthcare’s HSA high-deductible plan says the full Self Plus One or Self and Family deductible must be met first; Aetna’s HealthFund high-deductible plan says one person’s deductible stops at $3,500 of its $4,000 family deductible, and the rest can be met by one or more family members, so one person pays at most $3,500 of deductible and the family at most $4,000. Others do not state it, and SelectHealth’s high-deductible plan words it unclearly. The TakeCare and Kaiser Permanente Washington high-deductible brochures contradict themselves about it: their estimates use the shared family deductible, are marked estimated for Self Plus One and Self and Family, and “See the math” says what each brochure states. Where a plan’s brochure does not state it, this tool assumes: for regular plans, each person meets their own self-only deductible until everyone’s deductible spending together reaches the family deductible; for HSA high-deductible plans whose family deductible is exactly twice the self-only one, one family deductible shared by everyone; for every other high-deductible plan (SelectHealth’s included), a shared family deductible too, the cautious choice.'),
      h('p', {}, 'There is no single out-of-pocket figure for everyone: this tool caps each person at that plan’s own self-only out-of-pocket maximum, and the family out-of-pocket maximum (when the plan lists one) caps the sum of everyone’s costs. That is also an assumption for plans whose brochure does not say so: Blue Cross and Blue Shield’s brochure and one GEHA high-deductible plan’s state it, and OPM’s Carrier Letter 2025-04 asks plans to count each member’s costs separately from 2026, but it has not been checked plan by plan. The board’s “Deductible type” row shows which deductible rule each plan gets.'),
      h('p', {}, 'People are costed in the order listed. On a plan with a shared deductible the first person uses it up first; on other plans the order matters only once the family deductible is reached (who meets it first decides which care falls under it). Names you give people are saved in the page link, so a shared link shows them; medications are not saved in the link.'),
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
      h('h3', {}, 'Having a baby'),
      h('p', {}, `The “Having a baby” cost in “Fine-tune your year” stands for one pregnancy: prenatal care, delivery, postpartum care and the hospital stay for the birth. It is priced at ${usd(MATERNITY_SOURCE.price)}, the average health spending associated with pregnancy, childbirth and postpartum care for women with employer insurance (${MATERNITY_SOURCE.publisher}, ${MATERNITY_SOURCE.date}, from ${MATERNITY_SOURCE.basis}; they paid ${usd(MATERNITY_SOURCE.oop)} of it out of pocket on average). No primary source splitting vaginal and cesarean births was found, so the two are not priced apart.`),
      h('ul', {},
        h('li', {}, 'Each plan’s share comes from its own 2027 brochure, read by hand, because OPM’s spreadsheet was wrong about the hospital stay for the birth for about a quarter of the plans checked. The plan’s deductible and out-of-pocket maximum apply as for any other care.'),
        h('li', {}, 'Some brochures state maternity costs in a way that cannot be totaled for one pregnancy: per hospital day, per visit, or by percentage of the hospital bill and the doctors’ bill separately. Where the stated terms themselves were checked in the brochure, the app fills in the one missing count or share from the table below and marks the amount “estimated”, with a note saying what it assumes and why. The assumptions stand in for information missing from the plan’s brochure, not for anything the plan states.'),
        h('li', {}, 'Where even that is not possible (the brochure’s terms are unclear, or totaling them would need another assumption), the plan says “Maternity not priced: the plan’s brochure doesn’t give a total”. This is a gap in the plan’s published information, not in this app: see its brochure.'),
        h('li', {}, 'So that those plans never look cheaper just because their maternity is not priced, plans are ranked without maternity (“excl. maternity”) unless every plan shown has a maternity price (stated or estimated); what one pregnancy adds on each plan is shown apart. When estimates are in the ranked totals, the totals say “incl. maternity (some estimated)”. 2026 plans are never maternity-priced.'),
        h('li', {}, `The baby’s own care is not included: it is billed under the baby’s coverage (newborn care averages ${usd(MATERNITY_SOURCE.newbornPrice)}, ${usd(MATERNITY_SOURCE.newbornOop)} out of pocket, in the same study). Switch to Self Plus One or Self and Family to see the baby’s premium.`),
        h('li', {}, h('a', { href: MATERNITY_SOURCE.url, target: '_blank', rel: 'noopener noreferrer' }, 'KFF: Health costs associated with pregnancy, childbirth, and postpartum care'))),
      maternityAssumptionsTable()),
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
