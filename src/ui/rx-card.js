// Plan card additions: "Your medications" (per-drug tier, cost, lookup) and an expandable
// "What changed in 2027" list from the plan's brochure. Kept out of results.js; results calls these.
import { h, svg } from './inputs.js';
import { rxFor, changesFor } from './rx-model.js';
import { drugLines, medsStatusText, changesList, changeCount, lookupButton, ICON_WARN } from './rx-render.js';
import { usd } from './format.js';
import { medsCost } from './model.js';

const ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-chev"><path d="M4 6l4 4 4-4"/></svg>';
const ICON_SPARK = '<svg viewBox="0 0 16 16" aria-hidden="true" class="rx-chg-icon"><path d="M2.5 8h3l1.5-4 2 8 1.5-4h3"/></svg>';

/** -> { meds: element (above the actions), button: element (in the actions row), panel: element (below) } */
export function createRxCard(code) {
  const medsBox = h('div', { class: 'rx-card-meds', hidden: true, 'data-rx-scope': `card-${code}` });
  const label = h('span', { class: 'btn-text' }, 'What changed in 2027');
  const count = h('span', { class: 'rx-chg-count', hidden: true });
  const panelId = `chg-${code}`;
  const button = h('button', { type: 'button', class: 'btn btn-quiet chg-toggle', 'aria-expanded': 'false', 'aria-controls': panelId, hidden: true },
    svg(ICON_SPARK), label, count, svg(ICON_CHEV));
  const inner = h('div', { class: 'chg-inner' });
  const panel = h('div', { class: 'card-chg', id: panelId, role: 'region', 'aria-label': 'What changed in 2027, from the plan brochure' },
    h('div', { class: 'chg-clip' }, inner));
  const rec = { code, medsBox, button, panel, inner, open: false, medsKey: '', chgKey: '' };
  button.addEventListener('click', () => {
    rec.open = !rec.open;
    button.setAttribute('aria-expanded', String(rec.open));
    button.closest('.card')?.classList.toggle('is-chg-open', rec.open);
  });
  return rec;
}

/**
 * Refresh the card parts for a costed row. factsStatus: 'loading' | 'ready' | 'missing'.
 * Rebuilds the DOM only when what it shows changed (cards update on every input change).
 */
export function updateRxCard(rec, row, factsStatus) {
  // ---- what changed in 2027
  const groups = factsStatus === 'ready' ? changesFor(row.code) : [];
  const chgKey = `${factsStatus}|${changeCount(groups)}`;
  if (chgKey !== rec.chgKey) {
    rec.chgKey = chgKey;
    rec.button.hidden = factsStatus !== 'ready';
    const n = changeCount(groups);
    rec.button.querySelector('.rx-chg-count').hidden = !n;
    rec.button.querySelector('.rx-chg-count').textContent = String(n);
    rec.inner.replaceChildren(
      h('p', { class: 'chg-lede' }, n ? 'From the plan’s 2027 brochure, “Changes for 2027”. Each item links to its page.' : ''),
      changesList(groups));
  }

  // ---- your medications
  const m = row.meds;
  const key = m ? JSON.stringify([factsStatus, m.items.map((i) => [i.drugId, i.status, i.text, i.tier, i.missing]), m.estimate, row.cost?.total]) : '';
  if (key === rec.medsKey) return;
  rec.medsKey = key;
  rec.medsBox.hidden = !m;
  if (!m) { rec.medsBox.replaceChildren(); return; }
  const status = medsStatusText(m);
  const rx = factsStatus === 'ready' ? rxFor(row.code) : null;
  rec.medsBox.replaceChildren(
    h('div', { class: 'rx-card-head' },
      h('h4', { class: 'rx-card-title' }, 'Your medications'),
      m.entries.length > 0 && h('span', { class: 'rx-card-sum' }, `+ ${usd(medsCost(row))} a year`, h('span', { class: 'rx-card-sum-sub' }, ' in this total')),
      m.lookup && lookupButton(m.lookup, { compact: true, planName: row.plan.name })),
    status && h('p', { class: 'rx-card-warn', role: 'note' }, svg(ICON_WARN), status),
    factsStatus === 'loading'
      ? h('p', { class: 'rx-card-loading' }, 'Reading this plan’s brochure for drug tiers…')
      : factsStatus === 'missing'
        ? h('p', { class: 'rx-card-loading' }, 'Brochure drug tiers did not load; your medications are not priced.')
        : drugLines(m, rx, { code: row.code, planName: row.plan.name }));
}
