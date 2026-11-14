// Dental & Vision (FEDVIP) UI: the Medical | Dental & Vision tab switch, the Dental & Vision panel (usage
// presets, filters, "your 2026 plan", the ranked board with search / differences only / expand-collapse), the
// "add dental and vision" picks in the input panel, and the See-the-math lines for the medical cards.
// The model lives in dv-model.js (DOM-free); every value reaches the DOM through textContent or attributes,
// and links only through normalizeUrl (rx-model.js, via the board's lookupButton).
import { h, svg, ICON_CHECK, ICON_CHEVRON } from './dom.js';
import { segmented } from './inputs.js';
import { createBoard } from './board.js';
import { scopeText } from './board-model.js';
import { groupPlans } from './grouping.js';
import {
  dvRows, rankDv, filterDvRows, dvCarriers, dvContext, dvSections, filterDvSections, dvHeader, dvAddOn, plans2026,
  DV_GROUP_MODES, DV_GROUP_LABELS, OPM_LIMITS, ENROLLMENT_LABEL,
} from './dv-model.js';
import { DENTAL_PRESETS, VISION_PRESETS, describeDentalPreset } from '../engine/dental.js';
import { fedvipHub } from '../data.js';
import { safeStorage } from '../state.js';
import { usd } from './format.js';
import { reduceMotion, EASE_OUT } from './motion.js';

const UI_KEY = 'fehb-compass:dv-ui:v1';
const ICON_SEARCH = '<svg viewBox="0 0 16 16" aria-hidden="true" class="mx-search-icon"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4l3.4 3.4"/></svg>';
const ICON_DIFF = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h10M3 11h6"/><circle cx="12" cy="11" r="1.6"/></svg>';
const ICON_TOOTH = '<svg viewBox="0 0 20 20" aria-hidden="true" class="dv-ico"><path d="M6.2 3.2c1.5 0 2.3.8 3.8.8s2.3-.8 3.8-.8c2.2 0 3.4 1.9 3.1 4.4-.3 2.4-1.4 3.6-1.8 6-.3 2-.8 3.6-1.9 3.6-1.3 0-1.4-4.2-3.2-4.2s-1.9 4.2-3.2 4.2c-1.1 0-1.6-1.6-1.9-3.6-.4-2.4-1.5-3.6-1.8-6C2.8 5.1 4 3.2 6.2 3.2z"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 20 20" aria-hidden="true" class="dv-ico"><path d="M1.8 10S5 4.6 10 4.6 18.2 10 18.2 10 15 15.4 10 15.4 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.6"/></svg>';
const ICON_HEART = '<svg viewBox="0 0 20 20" aria-hidden="true" class="dv-ico"><path d="M10 16.6S2.6 12.3 2.6 7.3A3.9 3.9 0 0 1 10 5.4a3.9 3.9 0 0 1 7.4 1.9c0 5-7.4 9.3-7.4 9.3z"/></svg>';
const PAY = { active: 'active employee rates', retiree: 'retiree rates' };

// ---------- UI prefs (local conveniences: never in the shareable hash) ----------
const FILTER0 = { carriers: [], area: 'any', oon: false, in2: false };
function loadUi() {
  let v = {};
  try { v = JSON.parse(safeStorage().get(UI_KEY) ?? '{}') ?? {}; } catch { v = {}; }
  const filt = (f) => ({
    carriers: Array.isArray(f?.carriers) ? f.carriers.filter((c) => typeof c === 'string' && c.length < 60).slice(0, 20) : [],
    area: ['any', 'nationwide', 'regional'].includes(f?.area) ? f.area : 'any',
    oon: f?.oon === true,
    in2: f?.in2 === true,
  });
  return {
    diffOnly: v.diffOnly === true,
    lastKind: v.lastKind === 'vision' ? 'vision' : 'dental',
    open: v.open && typeof v.open === 'object' ? Object.fromEntries(Object.entries(v.open).filter(([, b]) => typeof b === 'boolean').slice(0, 40)) : {},
    dental: filt(v.dental),
    vision: filt(v.vision),
  };
}
const saveUi = (ui) => safeStorage().set(UI_KEY, JSON.stringify(ui));

// ---------- tabs ----------
/** Accessible tablist: buttons with roving tabindex, arrow keys, a sliding glass thumb. */
function tabList({ label, tabs, onPick, cls = '' }) {
  const thumb = h('span', { class: 'dvt-thumb', 'aria-hidden': 'true' });
  const btns = tabs.map(([value, text, icon]) => h('button', {
    type: 'button', role: 'tab', class: 'dvt-tab', 'data-value': value, id: `dvt-${value}`, 'aria-selected': 'false', tabindex: '-1',
  }, icon && svg(icon), h('span', {}, text)));
  const el = h('div', { class: `dvt ${cls}`, role: 'tablist', 'aria-label': label, style: `--n:${tabs.length};--i:0` }, thumb, btns);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.dvt-tab');
    if (b) onPick(b.dataset.value);
  });
  el.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: btns.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const j = (moves[e.key] + btns.length) % btns.length;
    btns[j].focus();
    onPick(btns[j].dataset.value);
  });
  return {
    el,
    sync(value, controls) {
      const i = Math.max(0, btns.findIndex((b) => b.dataset.value === value));
      el.style.setProperty('--i', i);
      btns.forEach((b, j) => {
        b.setAttribute('aria-selected', String(j === i));
        b.tabIndex = j === i ? 0 : -1;
        if (controls) b.setAttribute('aria-controls', controls);
      });
    },
  };
}

/**
 * Top-of-results tab switch. createDvTabs({ store }) -> { el, sync(state) }.
 * Dental & Vision opens on the sub-tab used last.
 */
export function createDvTabs({ store }) {
  const t = tabList({
    label: 'Plans to compare',
    cls: 'dvt-main',
    tabs: [['medical', 'Health plans', ICON_HEART], ['dv', 'Dental & Vision', ICON_TOOTH]],
    onPick: (v) => {
      if (v === 'medical') store.set({ tab: 'medical' });
      else if (store.get().tab === 'medical') { fedvipHub.load(); store.set({ tab: loadUi().lastKind }); }
    },
  });
  return {
    el: h('nav', { class: 'dv-tabs', 'aria-label': 'Health or dental and vision' }, t.el),
    sync(s) { t.sync(s.tab === 'medical' ? 'medical' : 'dv', s.tab === 'medical' ? 'results-frame' : 'dv-panel'); },
  };
}

// ---------- the Dental & Vision panel ----------
const chip = (value, text, cls = 'chip-input') => {
  const input = h('input', { type: 'checkbox', class: cls, value });
  return { label: h('label', { class: 'chip' }, input, svg(ICON_CHECK), h('span', { class: 'chip-text' }, text)), input };
};

/** createDvPanel({ store }) -> { el, render(state) } (re-renders itself when FEDVIP data arrives). */
export function createDvPanel({ store }) {
  const ui = loadUi();
  let query = '';
  let open = false;
  const kindTabs = tabList({
    label: 'Dental or vision', cls: 'dvt-sub',
    tabs: [['dental', 'Dental', ICON_TOOTH], ['vision', 'Vision', ICON_EYE]],
    onPick: (v) => store.set({ tab: v }),
  });
  const title = h('h2', { class: 'rhead-title dv-title', id: 'dv-title' });
  const sub = h('p', { class: 'rhead-sub dv-sub' });
  const dPreset = segmented({ name: 'dv-dental-use', legend: 'Your dental year', options: Object.entries(DENTAL_PRESETS).map(([k, p]) => [k, p.label]) });
  const vPreset = segmented({ name: 'dv-vision-use', legend: 'Your vision year', options: Object.entries(VISION_PRESETS).map(([k, p]) => [k, p.label]) });
  dPreset.el.classList.add('tool', 'dv-preset');
  vPreset.el.classList.add('tool', 'dv-preset');
  const presetHow = h('p', { class: 'field-hint dv-preset-how' });
  const groupSel = h('select', { id: 'dv-group', class: 'select' }, DV_GROUP_MODES.map((m) => h('option', { value: m }, DV_GROUP_LABELS[m])));
  const groupCtl = h('div', { class: 'field tool tool-select' },
    h('label', { class: 'field-label', for: 'dv-group' }, 'Show'), h('div', { class: 'select-wrap' }, groupSel, svg(ICON_CHEVRON)));
  const mineSel = h('select', { id: 'dv-mine', class: 'select' });
  const mineCtl = h('div', { class: 'field tool tool-select dv-mine-ctl' },
    h('label', { class: 'field-label', for: 'dv-mine' }, 'Your 2026 plan'), h('div', { class: 'select-wrap' }, mineSel, svg(ICON_CHEVRON)));
  const areaCtl = segmented({ name: 'dv-area', legend: 'Where offered', options: [['any', 'Any'], ['nationwide', 'Nationwide'], ['regional', 'Regional']] });
  areaCtl.el.classList.add('tool');
  const carriersWrap = h('div', { class: 'chips dv-carriers' });
  const carriersFs = h('fieldset', { class: 'field tool dv-filter' }, h('legend', { class: 'field-label' }, 'Carriers'), carriersWrap);
  const oon = chip('oon', 'Pays out of network', 'chip-input dv-net');
  const in2 = chip('in2', 'Has a second network tier', 'chip-input dv-net');
  const netFs = h('fieldset', { class: 'field tool dv-filter' }, h('legend', { class: 'field-label' }, 'Networks'), h('div', { class: 'chips' }, oon.label, in2.label));
  const filtered = h('p', { class: 'rhead-filtered dv-filtered', hidden: true });
  const limits = h('p', { class: 'dv-limits' });
  const mineNote = h('p', { class: 'rhead-mine', hidden: true });

  // board + its own toolbar (same look as the medical board's)
  const board = createBoard({
    label: 'Dental and vision plan board. Columns are plans, best first.',
    legend: [['prem', 'Premium'], ['oop', 'Expected out-of-pocket']],
    onSectionToggle: (key, isOpen) => { ui.open[key] = isOpen; saveUi(ui); },
  });
  const qInput = h('input', { type: 'search', id: 'dv-q', class: 'mx-search-input', autocomplete: 'off', spellcheck: 'false', placeholder: 'Find a row: orthodontia, frames, deductible…', 'aria-describedby': 'dv-q-count' });
  const diff = h('input', { type: 'checkbox', role: 'switch', id: 'dv-diff', class: 'mx-switch-input' });
  const count = h('span', { class: 'mx-count', id: 'dv-q-count', 'aria-live': 'polite' });
  const expand = h('button', { type: 'button', class: 'mx-btn' }, 'Expand all');
  const collapse = h('button', { type: 'button', class: 'mx-btn' }, 'Collapse all');
  const tools = h('div', { class: 'mx-tools mx-tools-board', role: 'group', 'aria-label': 'Board rows' },
    h('div', { class: 'mx-search' }, h('label', { class: 'sr-only', for: 'dv-q' }, 'Find a row'), svg(ICON_SEARCH), qInput),
    h('label', { class: 'mx-switch', for: 'dv-diff' }, diff, h('span', { class: 'mx-switch-track', 'aria-hidden': 'true' }, h('span', { class: 'mx-switch-thumb' })),
      h('span', { class: 'mx-switch-text' }, svg(ICON_DIFF), 'Differences only')),
    h('span', { class: 'mx-tools-end' }, count, h('span', { class: 'mx-btns' }, expand, collapse)));
  board.el.insertBefore(tools, board.scroller.parentElement);

  const empty = h('section', { class: 'results-none dv-empty', hidden: true });
  const status = h('p', { class: 'sr-only', role: 'status' });
  const controls = h('div', { class: 'dv-controls' },
    h('div', { class: 'dv-row' }, dPreset.el, vPreset.el, groupCtl, mineCtl),
    presetHow,
    h('div', { class: 'dv-row dv-row-filters' }, carriersFs, areaCtl.el, netFs));
  const head = h('header', { class: 'rhead dv-head' },
    h('div', { class: 'rhead-copy' }, title, filtered, sub, limits, mineNote), kindTabs.el);
  const el = h('section', { class: 'dv', id: 'dv-panel', role: 'tabpanel', 'aria-labelledby': 'dv-title', hidden: true },
    head, controls, board.el, empty, status);

  // ---------- events ----------
  const kindOf = () => (store.get().tab === 'vision' ? 'vision' : 'dental');
  const setFilter = (patch) => { ui[kindOf()] = { ...ui[kindOf()], ...patch }; saveUi(ui); render(store.get(), { animate: true }); };
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'dv-dental-use') store.set({ dentalUse: t.value });
    else if (t.name === 'dv-vision-use') store.set({ visionUse: t.value });
    else if (t.name === 'dv-area') setFilter({ area: t.value });
    else if (t === groupSel) store.set({ dvGroup: t.value }); // in the share link (state.js), so it re-renders
    else if (t === mineSel) store.set(kindOf() === 'dental' ? { myDental: t.value || null } : { myVision: t.value || null });
    else if (t === diff) { ui.diffOnly = t.checked; saveUi(ui); render(store.get(), { animate: false }); }
    else if (t === oon.input) setFilter({ oon: t.checked });
    else if (t === in2.input) setFilter({ in2: t.checked });
    else if (t.classList.contains('dv-carrier')) setFilter({ carriers: [...carriersWrap.querySelectorAll('input:checked')].map((i) => i.value) });
  });
  let qt = 0;
  qInput.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { query = qInput.value; render(store.get(), { animate: false }); }, 110); });
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Escape' && qInput.value) { e.stopPropagation(); qInput.value = ''; query = ''; render(store.get(), { animate: false }); } });
  const setAll = (isOpen) => {
    for (const k of Object.keys(ui.open)) delete ui.open[k];
    for (const s of lastSections) if (s.collapsible) ui.open[s.key] = isOpen;
    saveUi(ui);
    board.setSections(Object.fromEntries(lastSections.filter((s) => s.collapsible).map((s) => [s.key, isOpen])));
  };
  expand.addEventListener('click', () => setAll(true));
  collapse.addEventListener('click', () => setAll(false));
  empty.addEventListener('click', (e) => {
    if (e.target.closest('[data-reset]')) { ui[kindOf()] = { ...FILTER0 }; saveUi(ui); render(store.get()); }
    if (e.target.closest('[data-zip]')) {
      const z = document.getElementById('in-zip');
      z?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      z?.focus({ preventScroll: true });
    }
  });

  let carrierKey = '';
  function syncCarriers(kind, all) {
    const names = dvCarriers(all);
    const key = `${kind}:${names.join('|')}`;
    const sel = new Set(ui[kind].carriers);
    if (key !== carrierKey) {
      carrierKey = key;
      carriersWrap.replaceChildren(...names.map((n) => chip(n, n, 'chip-input dv-carrier').label));
    }
    for (const i of carriersWrap.querySelectorAll('input')) i.checked = sel.has(i.value);
  }

  let mineKey = '';
  function syncMine(fv, kind, s) {
    const list = plans2026(fv, kind);
    const key = `${kind}:${list.length}`;
    if (key !== mineKey) {
      mineKey = key;
      mineSel.replaceChildren(h('option', { value: '' }, 'None or skip'), ...list.map((p) => h('option', { value: p.id }, `${p.name}, ${p.option}`)));
    }
    mineSel.value = (kind === 'dental' ? s.myDental : s.myVision) ?? '';
  }

  function showEmpty(titleText, body, button) {
    board.el.hidden = true;
    empty.hidden = false;
    empty.replaceChildren(h('h3', { class: 'results-none-title' }, titleText), h('p', { class: 'results-none-body' }, body), button);
  }

  let lastSections = [];
  function render(s = store.get(), { animate = true } = {}) {
    const isDv = s.tab !== 'medical';
    el.hidden = !isDv;
    if (!isDv) { open = false; return; }
    const kind = s.tab === 'vision' ? 'vision' : 'dental';
    if (ui.lastKind !== kind) { ui.lastKind = kind; saveUi(ui); }
    kindTabs.sync(kind, 'dv-panel');
    el.dataset.kind = kind;
    dPreset.el.hidden = kind !== 'dental';
    vPreset.el.hidden = kind !== 'vision';
    dPreset.sync(s.dentalUse);
    vPreset.sync(s.visionUse);
    in2.label.hidden = kind !== 'dental';
    presetHow.textContent = kind === 'dental'
      ? `${describeDentalPreset(s.dentalUse)}. Assumed list prices for one person: in-network dentists usually charge plan members less, so out-of-pocket here is more likely high than low.`
      : 'Copays come from OPM’s text. Frame and contact allowances are not published by OPM, so costs above them are not counted.';
    groupSel.value = s.dvGroup;
    diff.checked = ui.diffOnly;
    limits.textContent = OPM_LIMITS[kind];
    const f = ui[kind];
    areaCtl.sync(f.area);
    oon.input.checked = f.oon;
    in2.input.checked = f.in2;

    const fv = fedvipHub.get();
    if (!fv) {
      title.textContent = kind === 'dental' ? 'Dental plans' : 'Vision plans';
      sub.textContent = 'Loading FEDVIP plans from OPM’s data…';
      controls.hidden = true;
      showEmpty('Loading dental and vision plans', 'This takes a moment the first time.', null);
      fedvipHub.load().then((x) => { if (!x) showEmpty('Dental and vision data did not load', 'Check your connection and reload the page.', null); });
      return;
    }
    controls.hidden = false;
    syncMine(fv, kind, s);
    const zip = s.location.zip;
    const all = dvRows(fv, s, kind);
    syncCarriers(kind, all);
    const who = `${ENROLLMENT_LABEL[s.enrollment]}, ${PAY[s.status]}`;
    if (kind === 'dental' && !zip) {
      title.textContent = 'Dental plans';
      sub.textContent = 'FEDVIP dental is separate from your health plan: enroll in it or not, whatever health plan you pick.';
      filtered.hidden = true;
      mineNote.hidden = true;
      showEmpty('Enter your ZIP code to compare dental plans',
        'Dental premiums depend on where you live, and some carriers serve only some areas. Your ZIP sets both.',
        h('button', { type: 'button', class: 'btn btn-primary', 'data-zip': '' }, 'Enter ZIP code'));
      status.textContent = 'Enter a ZIP code to compare dental plans.';
      return;
    }
    if (!all.length) {
      title.textContent = kind === 'dental' ? 'Dental plans' : 'Vision plans';
      showEmpty(`No ${kind} plans listed for ZIP ${zip}`, 'OPM’s list has no FEDVIP plan for this ZIP. Check the ZIP code.', null);
      return;
    }
    const rows = filterDvRows(all, f);
    const myId = kind === 'dental' ? s.myDental : s.myVision;
    const res = rankDv(rows, { withMine: true, mineId: myId, all });
    const where = zip ? ` for ZIP ${zip}` : '';
    title.textContent = `${all.length} ${kind} ${all.length === 1 ? 'plan' : 'plans'}${where}`;
    const preset = (kind === 'dental' ? DENTAL_PRESETS[s.dentalUse] : VISION_PRESETS[s.visionUse]).label.toLowerCase();
    sub.textContent = `Ranked by yearly premium plus expected ${kind === 'dental' ? 'out-of-pocket' : 'copays'} for “${preset}”: ${who}. FEDVIP is separate from your health plan.`;
    const filtersOn = f.carriers.length || f.area !== 'any' || f.oon || f.in2;
    filtered.hidden = !filtersOn;
    filtered.textContent = `${rows.length} of ${all.length} after filters`;
    const myName = myId ? plans2026(fv, kind).find((p) => p.id === myId) : null;
    mineNote.hidden = res.mineStatus === 'none';
    if (res.mineStatus === 'not-offered') mineNote.textContent = `${myName ? `${myName.name} ${myName.option}` : 'Your plan'} is not offered${zip ? ` at ZIP ${zip}` : ' without a ZIP code'}, so it cannot be pinned.`;
    else if (res.mine) mineNote.textContent = `${res.mine.plan.name} ${res.mine.plan.option} ranks #${res.mine.globalRank} of ${all.length} for you in 2027. It is pinned first so you can compare.`;

    if (!rows.length && !res.mine) {
      showEmpty('No plans match these filters', 'Try another carrier or network option.', h('button', { type: 'button', class: 'btn btn-primary', 'data-reset': '' }, 'Show all plans'));
      return;
    }
    empty.hidden = true;
    board.el.hidden = false;
    const groups = groupPlans(res.others, s.dvGroup);
    if (res.mine) groups.unshift({ key: 'mine', label: 'Your plan', rows: [res.mine], total: 1, note: '2027 rates' });
    const ctx = dvContext(res.ranked, s, kind, res.mine);
    const onBoard = groups.flatMap((g) => g.rows);
    const built = dvSections(fv, kind, ctx).map((sec) => (sec.collapsible && typeof ui.open[sec.key] === 'boolean' ? { ...sec, open: ui.open[sec.key] } : sec));
    const fs = filterDvSections(built, onBoard, ctx, { diffOnly: ui.diffOnly, query });
    lastSections = fs.sections;
    const bits = [];
    if (query.trim()) bits.push(fs.matched ? `${fs.matched} ${fs.matched === 1 ? 'match' : 'matches'}` : 'No matches');
    if (fs.hiddenRows) bits.push(`${fs.hiddenRows} identical ${fs.hiddenRows === 1 ? 'row' : 'rows'} hidden`);
    count.textContent = bits.join(', ');
    const shown = groups.reduce((n, g) => n + (g.key === 'mine' ? 0 : g.rows.length), 0);
    board.update({
      groups,
      sections: fs.sections,
      header: (row, g) => dvHeader(row, g.rows, ctx, g.key === 'mine' ? '' : scopeText(s.dvGroup, g)),
      ctx,
      summary: `Showing ${shown} of ${rows.length} ${kind} plans${res.mine ? ', plus your plan' : ''}.`,
      enter: !open,
      animate,
    });
    open = true;
    const top = res.others[0];
    status.textContent = top ? `${rows.length} ${kind} plans. Lowest estimated total: ${top.plan.name} ${top.plan.option}, ${usd(top.cost.total)} a year.` : '';
  }

  fedvipHub.subscribe(() => render(store.get(), { animate: false }));
  return { el, render };
}

// ---------- "Add dental and vision" picks (input panel) ----------
/**
 * createDvAddon({ store }) -> { el, sync(state) }: the dental and vision plan picks shown under the
 * "Add dental and vision" switch, with what each adds. Default pick: the cheapest plan for you by total.
 */
export function createDvAddon({ store }) {
  const mk = (kind, label) => {
    const sel = h('select', { id: `in-${kind}-pick`, class: 'select', 'data-kind': kind });
    const out = h('p', { class: 'field-hint dv-add-line', 'aria-live': 'polite' });
    return { sel, out, el: h('div', { class: 'field dv-add-field' }, h('label', { class: 'field-label', for: `in-${kind}-pick` }, label), h('div', { class: 'select-wrap' }, sel, svg(ICON_CHEVRON)), out) };
  };
  const d = mk('dental', 'Dental plan');
  const v = mk('vision', 'Vision plan');
  const goto = h('button', { type: 'button', class: 'chip-more dv-add-goto' }, 'Compare dental and vision plans');
  const hint = h('p', { class: 'field-hint' }, 'This adds the same amount to every health plan, so the ranking does not change: totals read “incl. dental/vision”, and comparisons with 2026 or your plan leave it out.');
  const el = h('div', { class: 'dv-add', hidden: true }, d.el, v.el, hint, goto);
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t === d.sel) store.set({ dentalPlan: t.value || null });
    if (t === v.sel) store.set({ visionPlan: t.value || null });
  });
  goto.addEventListener('click', () => store.set({ tab: store.get().tab === 'medical' ? 'dental' : store.get().tab }));
  let keys = { dental: '', vision: '' };

  function fill(slot, kind, s, fv, item) {
    const rows = fv ? rankDv(dvRows(fv, s, kind)) : [];
    const key = rows.map((r) => `${r.code}:${Math.round(r.cost.total)}`).join('|');
    if (key !== keys[kind]) {
      keys[kind] = key;
      slot.sel.replaceChildren(
        h('option', { value: '' }, rows.length ? `Cheapest for me (${rows[0].plan.name} ${rows[0].plan.option})` : 'Cheapest for me'),
        ...rows.map((r) => h('option', { value: r.code }, `${r.plan.name} ${r.plan.option}: ${usd(r.cost.total)} a year`)),
        h('option', { value: 'none' }, `Leave out ${kind}`));
    }
    const pick = kind === 'dental' ? s.dentalPlan : s.visionPlan;
    slot.sel.value = pick && [...slot.sel.options].some((o) => o.value === pick) ? pick : '';
    if (!fv) slot.out.textContent = 'Loading FEDVIP plans…';
    else if (pick === 'none') slot.out.textContent = 'Not added.';
    else if (!item || item.amount == null) slot.out.textContent = item?.note || 'Not priced.';
    else {
      const use = kind === 'dental' ? DENTAL_PRESETS[s.dentalUse].label : VISION_PRESETS[s.visionUse].label;
      slot.out.textContent = `Adds ${usd(item.amount)} a year: ${usd(item.premium)} premium${item.oop != null ? ` + ${usd(item.oop)} ${kind === 'dental' ? 'out-of-pocket' : 'copays'}` : ''} (${use.toLowerCase()}).${item.note ? ` ${item.note}` : ''}`;
    }
  }

  function sync(s) {
    el.hidden = !s.dental;
    if (!s.dental) return;
    const fv = fedvipHub.get();
    if (!fv) fedvipHub.load();
    const add = fv ? dvAddOn(fv, s) : null;
    fill(d, 'dental', s, fv, add?.dental);
    fill(v, 'vision', s, fv, add?.vision);
  }
  fedvipHub.subscribe(() => sync(store.get()));
  return { el, sync };
}

/** See-the-math lines for a medical card: 'Dental (plan, use)' and 'Vision (plan, use)', or nothing. */
export function dvMathLines(dv, mathLine) {
  if (!dv) return [];
  const out = [];
  for (const it of [dv.dental, dv.vision]) {
    if (!it) continue;
    const name = it.kind === 'dental' ? 'Dental' : 'Vision';
    if (it.amount == null) {
      out.push(mathLine(h('span', {}, h('i', { class: 'dot dot-dv' }), `${name}: `, h('span', { class: 'math-how' }, it.note || 'not priced')), 'not added'));
      continue;
    }
    out.push(mathLine(
      h('span', {}, h('i', { class: 'dot dot-dv' }), `${name}: ${usd(it.amount)} `,
        h('span', { class: 'math-how' }, `(${it.name} ${it.option}, ${it.use.toLowerCase()}${it.auto ? ', cheapest for you' : ''})`)),
      `+ ${usd(it.amount)}`));
    out.push(mathLine(`${name} premium`, usd(it.premium), 'math-sub'));
    out.push(mathLine(it.kind === 'dental' ? 'Dental out-of-pocket' : 'Vision copays', it.oop != null ? usd(it.oop) : 'not priced', 'math-sub'));
    if (it.note) out.push(mathLine(it.note, '', 'math-sub math-note'));
  }
  if (out.length) out.push(mathLine('Same dental/vision amount on every plan: the ranking does not change', '', 'math-sub math-note'));
  return out;
}

/** Fade the incoming panel when the tab changes (respects reduced motion). */
export function revealPanel(el) {
  if (reduceMotion() || el.hidden) return;
  el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_OUT });
}
