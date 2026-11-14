// Compare Board sections from the brochures: "Drugs" (lookup link, your medications, one row per drug) and
// "What changed in 2027" (one row per change category). Section/row shapes: see board-model.js.
// Rich content goes through board hooks ('rxdrug', 'rxchg'), rendered with rx-render.js.
import { h } from './inputs.js';
import { rxFor, lookupFor, changesFor, CHANGE_CATEGORIES } from './rx-model.js';
import { drugLines, changesList, medsSummary } from './rx-render.js';
import { DASH } from './format.js';

/**
 * rxBoardSections({ codes, factsStatus, meds }) -> [drugsSection, changesSection?]
 * codes: plan codes on the board (to know which change categories to show); meds: { drugs } or null.
 */
export function rxBoardSections({ codes = [], factsStatus = 'loading', meds = null } = {}) {
  const ready = factsStatus === 'ready';
  const waiting = { text: factsStatus === 'loading' ? 'Loading…' : DASH, sub: factsStatus === 'loading' ? 'reading brochures' : 'brochure facts unavailable', tone: 'muted', value: null };
  const drugs = meds?.drugs ?? [];
  const rows = [
    {
      key: 'rxLookup', label: 'Drug lookup', best: null, hint: 'The plan’s own drug search, from its 2027 brochure. Opens in a new tab.',
      cell: (r) => {
        if (!ready) return waiting;
        const l = lookupFor(r.code);
        if (!l) return { text: 'No link in the brochure', tone: 'muted', value: null };
        return { text: l.text, link: { href: l.href, text: l.text }, cite: l.cite, value: null, sub: l.kind === 'website' ? 'plan website' : undefined };
      },
    },
  ];
  if (drugs.length) {
    rows.push({
      key: 'rxMeds', label: 'Your medications', strong: true, best: 'min',
      hint: 'What your drugs cost a year on each plan, from the tiers you recorded and the brochure’s tier terms. Drugs not looked up yet are left out.',
      cell: (r) => {
        const s = medsSummary(r.meds);
        if (!s) return { text: DASH, tone: 'muted', value: null };
        const complete = r.meds.entries.length === r.meds.count;
        return { text: s.text, sub: s.sub, tone: s.warn ? 'warn' : undefined, value: complete ? r.meds.estimate : null };
      },
    });
    for (const d of drugs) {
      rows.push({ key: `rxDrug:${d.id}`, label: d.name, labelSub: 'what the lookup says', best: null, cell: () => ({ hook: 'rxdrug', drugId: d.id, text: '' }) });
    }
  }
  const out = [{ key: 'drugs', label: 'Drugs', rows }];

  if (ready) {
    const present = new Set();
    for (const c of codes) for (const g of changesFor(c)) present.add(g.category);
    const chgRows = [{
      key: 'chgCount', label: 'Changes listed', best: null, hint: 'From each plan’s 2027 brochure, “Changes for 2027”.',
      cell: (r) => {
        const n = changesFor(r.code).reduce((k, g) => k + g.items.length, 0);
        return n ? { text: `${n} ${n === 1 ? 'change' : 'changes'}`, value: null } : { text: 'None listed', sub: 'No changes listed in the brochure', tone: 'muted', value: null };
      },
    }];
    for (const c of CHANGE_CATEGORIES) {
      if (!present.has(c.id)) continue;
      chgRows.push({ key: `chg:${c.id}`, label: c.label, best: null, cell: () => ({ hook: 'rxchg', category: c.id, text: '' }) });
    }
    out.push({ key: 'changes27', label: 'What changed in 2027', note: 'From each plan’s brochure. Every item links to its page.', rows: chgRows });
  }
  return out;
}

/** Board hooks: render one drug line, or one change category, inside a board cell. */
export const rxBoardHooks = {
  rxdrug(row, td, cell) {
    const m = row.meds;
    const item = m?.items.find((i) => i.drugId === cell.drugId);
    td.dataset.rxScope = `board-${row.code}`;
    if (!item) { td.replaceChildren(h('span', { class: 'bd-v' }, DASH)); return; }
    td.replaceChildren(drugLines({ ...m, items: [item] }, rxFor(row.code), { code: row.code, planName: row.plan?.name }) ?? '');
  },
  rxchg(row, td, cell) {
    const g = changesFor(row.code).filter((x) => x.category === cell.category);
    td.replaceChildren(g.length ? changesList(g, { compact: true }) : h('span', { class: 'bd-v rx-none' }, DASH));
  },
};
