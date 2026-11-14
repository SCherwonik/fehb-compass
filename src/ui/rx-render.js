// DOM pieces for brochure facts and "my medications", shared by the cards, the board and the compare view.
// Text goes in as text (h() never parses HTML); every href here has already passed rx-model normalizeUrl.
import { h, svg } from './inputs.js';
import { usd } from './format.js';
import { normalizeUrl, CHANNELS } from './rx-model.js';

const ICON_EXT = '<svg viewBox="0 0 16 16" aria-hidden="true" class="rx-ext"><path d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5"/><path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5"/></svg>';
const ICON_DOC = '<svg viewBox="0 0 16 16" aria-hidden="true" class="rx-doc"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5"/></svg>';
export const ICON_WARN = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-warn"><path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.6v3.2M8 11.6v.1"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 16 16" aria-hidden="true" class="rx-search"><circle cx="7" cy="7" r="4.4"/><path d="M10.3 10.3l3.3 3.3"/></svg>';
const ICON_ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true" class="rx-arrow"><path d="M3 8h9.5M8.5 4l4 4-4 4"/></svg>';

const ext = (attrs) => ({ ...attrs, target: '_blank', rel: 'noopener noreferrer' });

/** Tiny 'p.80' chip that opens the brochure PDF at that page (or plain text when there is no safe link). */
export function citeChip(cite) {
  if (!cite) return null;
  const href = cite.href ? normalizeUrl(cite.href) : null;
  const title = cite.quote ? `${cite.label}: “${cite.quote}”` : cite.label;
  if (!href) return h('span', { class: 'rx-cite is-plain', title }, cite.short);
  return h('a', ext({ class: 'rx-cite', href, title, 'aria-label': `${cite.label} (opens the PDF in a new tab)` }), svg(ICON_DOC), cite.short);
}

/** "Look up your drug" button for a plan's lookup link ({ href, text }). */
export function lookupButton(link, { compact = false, planName } = {}) {
  const href = link?.href ? normalizeUrl(link.href) : null;
  if (!href) return null;
  const label = link.text || 'Look up your drug';
  return h('a', ext({
    class: `rx-lookup${compact ? ' is-compact' : ''}`, href,
    'aria-label': `${label}${planName ? ` on ${planName}` : ''} (opens the plan’s site in a new tab)`,
  }), svg(ICON_SEARCH), h('span', {}, label), svg(ICON_EXT));
}

let tipId = 0;
/** "Differs from OPM spreadsheet" / "Not confirmed" badge with a disclosure that explains it. */
export function badgeEl(badge) {
  if (!badge) return null;
  const id = `rxb-${++tipId}`;
  const btn = h('button', {
    type: 'button', class: `rx-badge is-${badge.kind}`, 'aria-expanded': 'false', 'aria-controls': id, 'data-rx-badge': '',
  }, svg(ICON_WARN), h('span', {}, badge.text));
  const body = h('span', { class: 'rx-badge-body', id, hidden: true },
    h('span', { class: 'rx-badge-why' }, badge.why),
    badge.sheet && badge.kind === 'differs' && h('span', { class: 'rx-badge-sheet' }, h('span', { class: 'rx-k' }, 'Spreadsheet: '), badge.sheet),
    badge.cite && citeChip(badge.cite));
  return h('span', { class: 'rx-badge-wrap' }, btn, body);
}

/** Delegated toggle for badgeEl disclosures inside `root` (call once per container). */
export function wireBadges(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rx-badge]');
    if (!btn || !root.contains(btn)) return;
    const body = btn.parentElement.querySelector('.rx-badge-body');
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    if (body) body.hidden = !open;
  });
}

/** Cite / link / badge decorations for a matrix or board cell descriptor (null-safe). */
export function cellDecorations(d) {
  const bits = [];
  if (d?.link) bits.push(lookupButton(d.link, { compact: true }));
  if (d?.cite || d?.badge) bits.push(h('span', { class: 'rx-deco' }, citeChip(d.cite), badgeEl(d.badge)));
  return bits.filter(Boolean);
}

// ---------- what changed in 2027 ----------

/** Grouped changes (rx-model groupChanges) as a compact definition list; empty -> the brochure's silence. */
export function changesList(groups, { compact = false } = {}) {
  if (!groups?.length) return h('p', { class: 'rx-none' }, 'No changes listed in the brochure.');
  return h('div', { class: `rx-changes${compact ? ' is-compact' : ''}` }, groups.map((g) =>
    h('section', { class: `rx-chg-group c-${g.category}` },
      h('h5', { class: 'rx-chg-h' }, g.label, h('span', { class: 'rx-chg-n' }, String(g.items.length))),
      h('ul', { class: 'rx-chg-list' }, g.items.map((it) => h('li', { class: 'rx-chg' },
        h('span', { class: 'rx-chg-sum' }, it.summary),
        (it.from || it.to) && h('span', { class: 'rx-chg-ft' },
          h('span', { class: 'rx-from' }, it.from ?? 'not stated'),
          svg(ICON_ARROW),
          h('span', { class: 'rx-to' }, it.to ?? 'not stated')),
        citeChip(it.cite)))))));
}

export const changeCount = (groups) => (groups ?? []).reduce((n, g) => n + g.items.length, 0);

// ---------- my medications on one plan ----------

const STATUS_TONE = { priced: 'ok', notcovered: 'bad', pa: 'warn', missing: 'warn', lookup: 'todo', pending: 'muted' };

/**
 * Tier picker for one (drug, plan): the plan's brochure tiers by name, then Not covered / Needs prior
 * authorization. Value '' = not looked up yet. data-drug / data-plan let the caller delegate 'change'.
 */
export function tierSelect(item, rx, { code, planName } = {}) {
  const names = (rx?.tiers ?? []).map((t) => t.name);
  const opts = names.length ? names : ['Tier 0', 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6'];
  const cur = item.tier ?? '';
  // a recorded tier the brochure list no longer has stays selectable, so it is never silently dropped
  if (cur && cur !== 'nc' && cur !== 'pa' && !opts.includes(cur)) opts.push(cur);
  const sel = h('select', {
    class: 'rx-tier-select', 'data-drug': item.drugId, 'data-plan': code,
    'aria-label': `What ${planName ?? 'this plan'}’s lookup says about ${item.name}`,
  },
  h('option', { value: '' }, 'Not looked up'),
  h('optgroup', { label: 'Covered at' }, opts.map((n) => h('option', { value: n }, n))),
  h('option', { value: 'nc' }, 'Not covered'),
  h('option', { value: 'pa' }, 'Needs prior authorization'));
  sel.value = cur;
  return h('span', { class: 'rx-tier-wrap' }, sel);
}

/** One line per drug: name, tier picker, cost text, and what is missing or the lookup link. */
export function drugLines(meds, rx, { code, planName, editable = true } = {}) {
  if (!meds) return null;
  return h('ul', { class: 'rx-drugs' }, meds.items.map((it) => {
    const tone = STATUS_TONE[it.status] ?? 'muted';
    const kids = [
      h('span', { class: 'rx-drug-name' }, it.name),
      editable && meds.factsMissing !== true ? tierSelect(it, rx, { code, planName }) : null,
    ];
    let detail;
    if (it.status === 'lookup') {
      detail = h('span', { class: 'rx-drug-detail' }, 'Not looked up yet. ',
        it.lookup ? lookupButton(it.lookup, { compact: true, planName }) : 'This brochure gives no lookup link.');
    } else if (it.status === 'pending') {
      detail = h('span', { class: 'rx-drug-detail' }, it.text);
    } else {
      detail = h('span', { class: 'rx-drug-detail' },
        h('span', { class: 'rx-drug-cost' }, it.text),
        it.missing && h('span', { class: 'rx-drug-miss' }, `Missing: ${it.missing}. Not in the total.`),
        it.status === 'notcovered' && it.annual != null && h('span', { class: 'rx-drug-miss' }, it.warning),
        it.cite && citeChip(it.cite));
    }
    return h('li', { class: `rx-drug t-${tone}` }, h('div', { class: 'rx-drug-top' }, kids), detail);
  }));
}

/** Short status line: "2 of your 3 drugs not yet looked up for this plan" etc. ('' when everything is priced). */
export function medsStatusText(meds) {
  if (!meds) return '';
  if (meds.factsMissing) return 'Brochure drug tiers are not loaded, so your medications are not in this total.';
  const bits = [];
  if (meds.notLookedUp) bits.push(`${meds.notLookedUp} of your ${meds.count} ${meds.count === 1 ? 'drug' : 'drugs'} not yet looked up for this plan`);
  if (meds.pending) bits.push(`${meds.pending} ${meds.pending === 1 ? 'needs' : 'need'} more information`);
  return bits.length ? `${bits.join('; ')}: left out of the total.` : '';
}

/** Short summary for a board cell / compare cell: "$1,284 a year · 2 of 3 priced". */
export function medsSummary(meds) {
  if (!meds) return null;
  const priced = meds.entries.length;
  return {
    text: meds.factsMissing ? 'Loading…' : priced ? `${usd(meds.estimate)} a year` : 'Not priced yet',
    sub: meds.factsMissing ? 'brochure tiers' : `${priced} of ${meds.count} priced`,
    warn: !meds.factsMissing && priced < meds.count,
  };
}

export const channelLabel = (id) => CHANNELS[id]?.short ?? 'Retail, 30-day';
