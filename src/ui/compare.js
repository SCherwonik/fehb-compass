// Side-by-side compare for up to MAX_COMPARE pinned 2027 plans, each showing 2026 -> 2027.
import { h, svg } from './inputs.js';
import { makeRow, planInput, costInputs } from './model.js';
import { planTotal } from '../engine/cost.js';
import { FLAG_TEXT } from '../engine/diff.js';
import { usd, signedUsd, deltaTone, DASH } from './format.js';
import { reduceMotion, EASE_OUT } from './motion.js';
import { createMatrixPanel } from './matrix.js';

// One matrix panel for the page: it keeps its search text and open sections while the grid re-renders.
let matrixPanel = null;

const ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-x"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';

function total2026(data, state, code) {
  const input = planInput(data, 2026, code);
  if (!input || !input.rate[state.enrollment]) return null;
  try { return planTotal(input, costInputs(state)).total; } catch { return null; }
}

// Metric rows. get(row, side) -> number|null where side is '2027' or '2026'. lowerIsBetter marks the winner.
const METRICS = [
  {
    key: 'total', label: 'Estimated yearly total', strong: true,
    get: (r, side) => (side === '2027' ? r.cost.total : r.total2026),
  },
  { key: 'premium', label: 'Premium', get: (r, side) => (side === '2027' ? r.facts : r.facts2026)?.premium ?? null },
  { key: 'deductible', label: 'Deductible', get: (r, side) => (side === '2027' ? r.facts : r.facts2026)?.deductible ?? null },
  { key: 'oopMax', label: 'Out-of-pocket max', get: (r, side) => (side === '2027' ? r.facts : r.facts2026)?.oopMax ?? null },
  { key: 'oop', label: 'Expected care costs', get: (r, side) => (side === '2027' ? r.cost.oop : null) },
  { key: 'deposit', label: 'HSA / HRA money used', higherIsBetter: true, get: (r, side) => (side === '2027' ? (r.account ? r.cost.hsaOffset : null) : null) },
];

/**
 * renderCompare(section, { data, state, onRemove(code), onClose() })
 * Rebuilds the compare grid (at most 4 columns: cheap) each time state changes while open.
 */
export function renderCompare(section, { data, state, onRemove, onClose }) {
  const rows = state.selectedPlans
    .map((code) => makeRow(data, state, code))
    .filter(Boolean)
    .map((r) => ({ ...r, total2026: total2026(data, state, r.code) }));

  const head = h('div', { class: 'compare-head' },
    h('div', {},
      h('h2', { class: 'compare-title', id: 'compare-title' }, 'Side by side'),
      h('p', { class: 'compare-sub' }, rows.length < 2
        ? 'Pick at least two plans with Compare to see them side by side.'
        : 'Each value shows 2027, with 2026 underneath for the same plan.')),
    h('button', { type: 'button', class: 'btn btn-quiet', onclick: onClose }, 'Close'));

  if (!rows.length) {
    section.replaceChildren(head);
    return;
  }

  const best = {};
  for (const m of METRICS) {
    const vals = rows.map((r) => m.get(r, '2027')).filter((v) => v != null);
    if (vals.length > 1) best[m.key] = m.higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  }

  const grid = h('div', { class: 'compare-grid', role: 'table', 'aria-labelledby': 'compare-title', style: `--cols:${rows.length}` });
  // header row
  grid.append(h('div', { class: 'cg-row cg-header', role: 'row' },
    h('div', { class: 'cg-label', role: 'columnheader' }, h('span', { class: 'sr-only' }, 'Measure')),
    rows.map((r) => h('div', { class: 'cg-cell cg-plan', role: 'columnheader' },
      h('span', { class: 'cg-plan-name' }, r.plan.name),
      h('span', { class: 'cg-plan-meta' }, `${r.plan.type} · ${r.code}${r.diff.status === 'new' ? ' · new for 2027' : ''}`),
      h('button', {
        type: 'button', class: 'cg-remove', 'aria-label': `Remove ${r.plan.name} from compare`,
        onclick: () => onRemove(r.code),
      }, svg(ICON_X))))));

  for (const m of METRICS) {
    grid.append(h('div', { class: `cg-row${m.strong ? ' cg-strong' : ''}`, role: 'row' },
      h('div', { class: 'cg-label', role: 'rowheader' }, m.label),
      rows.map((r) => {
        const now = m.get(r, '2027');
        const was = m.get(r, '2026');
        const isBest = best[m.key] != null && now === best[m.key];
        const d = now != null && was != null ? now - was : null;
        // higher is worse for every metric except money put into your account
        const tone = m.higherIsBetter ? { up: 'down', down: 'up', flat: 'flat' }[deltaTone(d)] : deltaTone(d);
        return h('div', { class: `cg-cell${isBest ? ' is-best' : ''}`, role: 'cell' },
          h('span', { class: 'cg-now' }, usd(now)),
          was != null
            ? h('span', { class: 'cg-was' }, `2026 ${usd(was)} `, h('span', { class: `delta delta-${tone}` }, tone === 'flat' ? 'no change' : signedUsd(d)))
            : m.key !== 'oop' && m.key !== 'deposit' && h('span', { class: 'cg-was' }, r.diff.status === 'new' ? 'New in 2027' : `2026 ${DASH}`));
      })));
  }

  // Primary care, specialist and every other cost share live in the full benefits matrix below.
  grid.append(h('div', { class: 'cg-row', role: 'row' },
    h('div', { class: 'cg-label', role: 'rowheader' }, 'Coinsurance'),
    rows.map((r) => h('div', { class: 'cg-cell', role: 'cell' },
      h('span', { class: 'cg-now cg-text' }, r.facts.coinsurance != null ? `${r.facts.coinsurance}%` : DASH),
      h('span', { class: 'cg-was' }, r.facts.coinsurance != null ? 'plan-wide' : 'varies by service')))));
  grid.append(h('div', { class: 'cg-row', role: 'row' },
    h('div', { class: 'cg-label', role: 'rowheader' }, 'What changed'),
    rows.map((r) => h('div', { class: 'cg-cell', role: 'cell' },
      r.diff.flags.length
        ? h('ul', { class: 'cg-flags' }, r.diff.flags.map((f) => h('li', {}, FLAG_TEXT[f] ?? f)))
        : h('span', { class: 'cg-was' }, r.diff.status === 'new' ? 'New plan for 2027' : 'No warning signs')))));

  matrixPanel ??= createMatrixPanel();
  matrixPanel.update({
    year: 2027,
    enrollment: state.enrollment,
    status: state.status,
    plans: rows.map((r) => ({ code: r.code, name: r.plan.name, benefits: r.benefits })),
  });
  section.replaceChildren(head, h('div', { class: 'compare-scroll' }, grid), matrixPanel.el);
}

/** Reveal the compare section with a short rise; reduced motion just shows it. */
export function revealCompare(section) {
  section.hidden = false;
  if (reduceMotion()) return;
  section.animate(
    [{ opacity: 0, transform: 'translateY(-8px) scale(0.99)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
    { duration: 380, easing: EASE_OUT },
  );
}
