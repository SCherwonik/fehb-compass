// Print / Save as PDF: before printing, a "Your situation" summary replaces the input panel on paper
// (styles/print.css), the best plan's math is filled in, and the board fills the columns that print.
// Everything is undone after printing. The summary lists choices only: medications are counted, never named.
import { h } from './dom.js';
import { STATE_NAMES } from '../data.js';
import { shareLink } from '../share.js';
import { overrideChanges } from './assumptions.js';

const STATUS = { active: 'Active employee', retiree: 'Retiree' };
const ENROLLMENT = { self: 'Self only', self_plus_one: 'Self plus one', family: 'Self and family' };
const SCENARIO = { healthy: 'Healthy year', typical: 'Typical year', condition: 'Managing a condition', worst: 'Worst case', nothing: 'Only your own costs' };
const ACCOUNT = { any: 'Any plan', hsa: 'HSA plans only', hra: 'HRA plans only' };
const TAB = { medical: 'Health plans', dental: 'Dental', vision: 'Vision' };

/** [[label, value]] describing the user's choices (pure: exported for reuse). */
export function situationRows(s, { planName = () => null, medsCount = 0 } = {}) {
  const where = s.location.state ? STATE_NAMES[s.location.state] ?? s.location.state : 'No state chosen (nationwide plans)';
  const adjusted = s.custom.length || overrideChanges(s).length;
  return [
    ['Coverage', `${STATUS[s.status]}, ${ENROLLMENT[s.enrollment].toLowerCase()}`],
    ['Location', s.location.zip ? `${where}, ZIP ${s.location.zip}` : where],
    ['Expected care', `${SCENARIO[s.scenario]}${adjusted ? `, adjusted${s.custom.length ? ` (${s.custom.length} cost ${s.custom.length === 1 ? 'line' : 'lines'} of your own)` : ''}` : ''}`],
    ['Plans considered', [ACCOUNT[s.account], s.networks.length ? `networks: ${s.networks.join(', ')}` : 'every network', s.glp1 ? 'GLP-1 weight-loss covered' : ''].filter(Boolean).join('; ')],
    s.currentPlan2026 && ['Your 2026 plan', planName(s.currentPlan2026) ?? s.currentPlan2026],
    medsCount > 0 && ['Medications', `${medsCount} listed (priced on plans where you recorded a tier; names stay on your device)`],
    s.dental && ['Dental and vision', 'Added to the totals'],
    s.tab !== 'medical' && ['Showing', TAB[s.tab]],
  ].filter(Boolean);
}

export function initPrint({ store, results, planName, medsCount }) {
  let undo = null;
  const before = () => {
    const s = store.get();
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const box = h('section', { id: 'print-summary', hidden: true, 'aria-hidden': 'true' },
      h('h2', {}, `Your situation · printed ${today}`),
      h('dl', {}, situationRows(s, { planName, medsCount: medsCount() }).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('p', { class: 'ps-link' }, `Open this comparison: ${shareLink(location.href, s).url}`),
      h('p', { class: 'ps-note' }, 'Totals are estimates for one year: premium plus expected out-of-pocket costs, minus HSA or HRA money.'));
    document.getElementById('print-summary')?.remove();
    document.querySelector('.layout')?.before(box);
    const restore = results.preparePrint?.() ?? (() => {});
    for (const b of document.querySelectorAll('.board')) b._fillFirst?.(6); // print.css prints the best 6 plans
    undo = () => { box.remove(); restore(); };
  };
  const after = () => { undo?.(); undo = null; };
  window.addEventListener('beforeprint', before);
  window.addEventListener('afterprint', after);
}
