// "My medications" panel (input area), the GLP-1 filter chip and the global wiring for the tier pickers that
// cards, the board, the compare view and the quick look-up render. Private data: see meds-store.js.
import { h, svg, ICON_CHECK, ICON_CHEVRON } from './inputs.js';
import { MAX_DRUGS, MAX_NAME } from './meds-store.js';
import { rxFor, glp1Covered, planMeds } from './rx-model.js';
import { availablePlans } from './model.js';
import { usdExact } from './format.js';
import { lookupButton, tierSelect, channelLabel, wireBadges } from './rx-render.js';

const ICON_PILL = '<svg viewBox="0 0 20 20" aria-hidden="true" class="md-icon"><rect x="2.6" y="7" width="14.8" height="6" rx="3" transform="rotate(-35 10 10)"/><path d="M8.3 6.4l3.4 7.2" transform="rotate(-35 10 10)"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true" class="md-lock"><rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6"/><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.9l2.5 2.5-7.4 7.4-3 .5.5-3z"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V3.6A1.1 1.1 0 0 0 9.4 2.5H3.6a1.1 1.1 0 0 0-1.1 1.1v5.8a1.1 1.1 0 0 0 1.1 1.1h1.9"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4h7.5M6 8h7.5M6 12h7.5"/><circle cx="3" cy="4" r=".9"/><circle cx="3" cy="8" r=".9"/><circle cx="3" cy="12" r=".9"/></svg>';
const reduceMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const CHANNEL_OPTS = [['retail30', 'Retail, 30-day'], ['retail90', 'Retail, 90-day'], ['mail', 'Mail order, 90-day'], ['specialty', 'Specialty pharmacy']];
const NINETY = new Set(['retail90', 'mail']);
let wired = false;

/**
 * One delegated listener for every tier picker (.rx-tier-select[data-drug][data-plan]) on the page, plus the
 * badge disclosures. After the record re-renders the results, focus returns to the same picker.
 */
export function wireRxControls(meds) {
  if (wired) return;
  wired = true;
  wireBadges(document);
  document.addEventListener('change', (e) => {
    const sel = e.target.closest?.('.rx-tier-select');
    if (!sel) return;
    const { drug, plan } = sel.dataset;
    const scope = sel.closest('[data-rx-scope]')?.dataset.rxScope ?? '';
    meds.record(plan, drug, sel.value || null);
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const q = `.rx-tier-select[data-drug="${CSS.escape(drug)}"][data-plan="${CSS.escape(plan)}"]`;
      const again = (scope && document.querySelector(`[data-rx-scope="${CSS.escape(scope)}"] ${q}`)) || document.querySelector(q);
      again?.focus({ preventScroll: true });
    });
  });
}

/** GLP-1 weight-loss filter chip for the "Plans to consider" group. sync(state) keeps it current. */
export function glp1Filter({ store, meds, data }) {
  const input = h('input', { type: 'checkbox', class: 'chip-input', id: 'in-glp1' });
  const count = h('span', { class: 'chip-count' }, '…');
  const label = h('label', { class: 'chip chip-glp1', for: 'in-glp1' }, input, svg(ICON_CHECK), h('span', { class: 'chip-text' }, 'GLP-1 weight-loss covered'), count);
  const hint = h('p', { class: 'field-hint' });
  const el = h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Prescription coverage'), h('div', { class: 'chips' }, label), hint);
  input.addEventListener('change', () => store.set({ glp1: input.checked }));
  const plans27 = (data.plans ?? []).filter((p) => p.year === 2027);

  function sync(s = store.get()) {
    input.checked = s.glp1 === true;
    const status = meds.factsStatus();
    const facts = meds.facts();
    if (status !== 'ready') {
      count.textContent = status === 'loading' ? '…' : '–';
      input.disabled = !input.checked;
      hint.textContent = status === 'loading'
        ? 'Reading the plan brochures…'
        : 'Brochure facts did not load, so this filter cannot be applied.';
      return;
    }
    input.disabled = false;
    const open = availablePlans(plans27, data.serviceArea, s.location.state)
      .filter((p) => (s.account === 'hsa' ? p.hsa : s.account === 'hra' ? p.hra : true));
    const n = open.filter((p) => glp1Covered(p.code, facts)).length;
    count.textContent = String(n);
    label.classList.toggle('is-zero', n === 0);
    hint.textContent = 'Only plans whose 2027 brochure says drugs like Wegovy or Zepbound are covered for weight loss. Each plan sets its own rules.';
  }
  meds.subscribe((_, reason) => { if (reason === 'facts') sync(); });
  return { el, sync };
}

/**
 * The collapsible "My medications" card, mounted after the input form. Returns { el }.
 */
export function createMedsPanel({ meds }) {
  wireRxControls(meds);
  let open = meds.get().drugs.length > 0;
  let editing = null; // drug id being edited
  let quick = null; // drug id in "check on my top plans"
  let undo = null; // { name, snapshot }
  let fillsTouched = false;

  const countEl = h('span', { class: 'md-count' });
  const toggle = h('button', { type: 'button', class: 'md-toggle', 'aria-expanded': String(open), 'aria-controls': 'md-body' },
    svg(ICON_PILL),
    h('span', { class: 'md-title' }, 'My medications'),
    countEl,
    svg(ICON_CHEVRON));
  const privacy = h('p', { class: 'md-private' }, svg(ICON_LOCK), h('span', { class: 'md-private-text' }));

  // ---- add / edit form ----
  const nameIn = h('input', { class: 'cl-input', id: 'md-name', type: 'text', maxlength: String(MAX_NAME), autocomplete: 'off', spellcheck: 'false', placeholder: 'Drug name, e.g. Eliquis 5 mg' });
  const costIn = h('input', { class: 'cl-input cl-num', id: 'md-cost', type: 'number', min: '0', max: '100000', step: '0.01', inputmode: 'decimal', placeholder: 'optional' });
  const fillsIn = h('input', { class: 'cl-input cl-num', id: 'md-fills', type: 'number', min: '1', max: '365', step: '1', inputmode: 'numeric', value: '12' });
  const chanSel = h('select', { class: 'select', id: 'md-chan' }, CHANNEL_OPTS.map(([v, t]) => h('option', { value: v }, t)));
  const submit = h('button', { type: 'submit', class: 'btn btn-primary md-add' }, svg(ICON_PLUS), h('span', { class: 'btn-text' }, 'Add drug'));
  const cancel = h('button', { type: 'button', class: 'btn btn-quiet', hidden: true }, 'Cancel');
  const msg = h('p', { class: 'md-msg', role: 'status' });
  const form = h('form', { class: 'md-form', novalidate: true },
    h('div', { class: 'cl-cell md-cell-name' }, h('label', { class: 'cl-cap', for: 'md-name' }, 'Drug'), nameIn),
    h('div', { class: 'cl-grid' },
      h('div', { class: 'cl-cell' }, h('label', { class: 'cl-cap', for: 'md-cost' }, 'Full price a month'),
        h('div', { class: 'cl-affix' }, h('span', { class: 'cl-pre', 'aria-hidden': 'true' }, '$'), costIn)),
      h('div', { class: 'cl-cell' }, h('label', { class: 'cl-cap', for: 'md-fills' }, 'Fills a year'), fillsIn),
      h('div', { class: 'cl-cell cl-cell-tier' }, h('label', { class: 'cl-cap', for: 'md-chan' }, 'Where you fill it'),
        h('div', { class: 'select-wrap' }, chanSel, svg(ICON_CHEVRON)))),
    h('p', { class: 'md-hint' }, 'Price is optional. It is needed when a tier is a percentage, when a drug is not covered, and before an HDHP deductible is met. Use 4 fills for 90-day supplies.'),
    h('div', { class: 'md-actions' }, submit, cancel),
    msg);

  const list = h('ul', { class: 'md-list', 'aria-label': 'Your medications' });
  const empty = h('div', { class: 'md-empty' },
    h('p', {}, 'Add the drugs you take. Then open each plan’s drug lookup, find your drug, and record the tier it shows.'),
    h('p', {}, 'Each plan is priced from its own 2027 brochure. Nothing leaves this browser.'));
  const quickEl = h('section', { class: 'md-quick', hidden: true, 'aria-label': 'Check a drug on your top plans', 'data-rx-scope': 'quick' });
  const undoEl = h('p', { class: 'md-undo', hidden: true });

  const body = h('div', { class: 'md-body', id: 'md-body' }, h('div', { class: 'md-clip' }, privacy, empty, list, undoEl, quickEl, form));
  const el = h('section', { class: `md${open ? ' is-open' : ''}`, 'aria-labelledby': 'md-h' },
    h('h3', { class: 'md-h', id: 'md-h' }, toggle), body);
  body.inert = !open;

  toggle.addEventListener('click', () => {
    open = !open;
    el.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    body.inert = !open;
    if (open && !meds.get().drugs.length) setTimeout(() => nameIn.focus({ preventScroll: true }), reduceMotion() ? 0 : 200);
  });

  chanSel.addEventListener('change', () => {
    if (!fillsTouched) fillsIn.value = NINETY.has(chanSel.value) ? '4' : '12';
  });
  fillsIn.addEventListener('input', () => { fillsTouched = true; });

  function resetForm() {
    editing = null;
    fillsTouched = false;
    form.reset();
    fillsIn.value = '12';
    chanSel.value = 'retail30';
    submit.querySelector('.btn-text').textContent = 'Add drug';
    cancel.hidden = true;
    nameIn.removeAttribute('aria-invalid');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fields = {
      name: nameIn.value,
      monthlyCost: costIn.value.trim() === '' ? null : costIn.value,
      fillsPerYear: fillsIn.value.trim() === '' ? 12 : Math.round(Number(fillsIn.value)),
      channel: chanSel.value,
    };
    let done;
    if (editing) done = meds.update(editing, fields);
    else {
      if (meds.get().drugs.length >= MAX_DRUGS) { msg.textContent = `You can list up to ${MAX_DRUGS} drugs.`; return; }
      done = meds.add(fields);
    }
    if (!done) {
      nameIn.setAttribute('aria-invalid', 'true');
      msg.textContent = 'Type the drug’s name (letters and numbers).';
      nameIn.focus();
      return;
    }
    msg.textContent = editing ? `Saved ${done.name}.` : `Added ${done.name}. Record its tier on each plan.`;
    undo = null;
    resetForm();
    nameIn.focus();
  });
  cancel.addEventListener('click', () => { resetForm(); msg.textContent = ''; });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]')?.dataset.id;
    const d = meds.get().drugs.find((x) => x.id === id);
    if (!d) return;
    if (btn.dataset.act === 'edit') {
      editing = id;
      fillsTouched = true;
      nameIn.value = d.name;
      costIn.value = d.monthlyCost ?? '';
      fillsIn.value = String(d.fillsPerYear);
      chanSel.value = d.channel;
      submit.querySelector('.btn-text').textContent = 'Save changes';
      cancel.hidden = false;
      msg.textContent = `Editing ${d.name}.`;
      nameIn.focus();
    } else if (btn.dataset.act === 'remove') {
      undo = { name: d.name, snapshot: structuredClone(meds.get()) };
      if (editing === id) resetForm();
      if (quick === id) quick = null;
      meds.remove(id);
    } else if (btn.dataset.act === 'quick') {
      quick = quick === id ? null : id;
      render();
      if (quick) quickEl.querySelector('.md-quick-copy')?.focus({ preventScroll: true });
    }
  });
  undoEl.addEventListener('click', (e) => {
    if (!e.target.closest('button') || !undo) return;
    meds.replace(undo.snapshot);
    undo = null;
    render();
  });
  quickEl.addEventListener('click', async (e) => {
    if (e.target.closest('.md-quick-close')) { quick = null; render(); return; }
    const copy = e.target.closest('.md-quick-copy');
    if (!copy) return;
    const name = copy.dataset.name ?? '';
    let ok = false;
    try { await navigator.clipboard.writeText(name); ok = true; } catch {
      // older browsers / blocked clipboard: select a hidden field and copy
      const ta = h('textarea', { class: 'sr-only', readonly: true });
      ta.value = name;
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    const label = copy.querySelector('.btn-text');
    label.textContent = ok ? 'Copied' : 'Copy failed';
    copy.classList.toggle('is-done', ok);
    setTimeout(() => { label.textContent = 'Copy name'; copy.classList.remove('is-done'); }, 1600);
  });

  function drugRow(d) {
    return h('li', { class: 'md-drug', 'data-id': d.id },
      h('div', { class: 'md-drug-main' },
        h('span', { class: 'md-drug-name' }, d.name),
        h('span', { class: 'md-drug-meta' }, [
          d.monthlyCost != null ? `${usdExact(d.monthlyCost)} a month` : 'no price',
          `${d.fillsPerYear} ${d.fillsPerYear === 1 ? 'fill' : 'fills'} a year`,
          channelLabel(d.channel),
        ].join(' · '))),
      h('div', { class: 'md-drug-acts' },
        h('button', { type: 'button', class: `md-act md-act-quick${quick === d.id ? ' is-on' : ''}`, 'data-act': 'quick', 'aria-pressed': String(quick === d.id), title: 'Check this drug on all my top plans', 'aria-label': `Check ${d.name} on all my top plans` }, svg(ICON_LIST)),
        h('button', { type: 'button', class: 'md-act', 'data-act': 'edit', title: 'Edit', 'aria-label': `Edit ${d.name}` }, svg(ICON_EDIT)),
        h('button', { type: 'button', class: 'md-act md-act-del', 'data-act': 'remove', title: 'Remove', 'aria-label': `Remove ${d.name}` }, svg(ICON_X))));
  }

  function renderQuick(state) {
    const d = state.drugs.find((x) => x.id === quick);
    quickEl.hidden = !d;
    if (!d) { quickEl.replaceChildren(); return; }
    const top = meds.top();
    const facts = meds.facts();
    const head = h('div', { class: 'md-quick-head' },
      h('div', {},
        h('h4', { class: 'md-quick-title' }, `Check ${d.name} on your top plans`),
        h('p', { class: 'md-quick-sub' }, 'Open each lookup, search the name, then record what it says. Plans are in your ranking order.')),
      h('button', { type: 'button', class: 'md-act md-quick-close', 'aria-label': 'Close the quick look-up' }, svg(ICON_X)));
    const copy = h('button', { type: 'button', class: 'btn btn-quiet md-quick-copy', 'data-name': d.name }, svg(ICON_COPY), h('span', { class: 'btn-text' }, 'Copy name'));
    let rows;
    if (!top.length) rows = h('p', { class: 'md-quick-empty' }, 'Your ranked plans appear here once plan costs load.');
    else if (!facts) rows = h('p', { class: 'md-quick-empty' }, meds.factsStatus() === 'loading' ? 'Reading the plan brochures…' : 'Brochure facts did not load, so lookup links are unavailable.');
    else {
      rows = h('ol', { class: 'md-quick-list' }, top.map((p) => {
        const m = planMeds(facts, { drugs: [d], records: state.records }, p.code, null);
        const item = m.items[0];
        const rx = rxFor(p.code, undefined, facts);
        return h('li', { class: 'md-quick-row' },
          h('span', { class: 'md-quick-rank', 'aria-hidden': 'true' }, String(p.rank ?? '')),
          h('span', { class: 'md-quick-name' }, h('span', { class: 'sr-only' }, `Rank ${p.rank}: `), p.name),
          h('span', { class: 'md-quick-go' }, lookupButton(m.lookup, { compact: true, planName: p.name }) ?? h('span', { class: 'md-quick-nolink' }, 'No lookup link in the brochure')),
          h('span', { class: 'md-quick-tier' }, tierSelect(item, rx, { code: p.code, planName: p.name })));
      }));
    }
    quickEl.replaceChildren(head, copy, rows);
  }

  function render(state = meds.get()) {
    const n = state.drugs.length;
    countEl.textContent = n ? String(n) : '';
    countEl.hidden = !n;
    privacy.querySelector('.md-private-text').textContent = meds.persistent
      ? 'Private: saved only in this browser, never in the share link.'
      : 'Private, and this browser is blocking storage: the list lasts until you close this tab.';
    privacy.classList.toggle('is-warn', !meds.persistent);
    empty.hidden = n > 0;
    list.replaceChildren(...state.drugs.map(drugRow));
    if (undo) {
      undoEl.hidden = false;
      undoEl.replaceChildren(`Removed ${undo.name}. `, h('button', { type: 'button', class: 'md-undo-btn' }, 'Undo'));
    } else undoEl.hidden = true;
    const full = n >= MAX_DRUGS && !editing;
    submit.disabled = full;
    if (full) msg.textContent = `That is the limit of ${MAX_DRUGS} drugs.`;
    renderQuick(state);
  }

  meds.subscribe((state, reason) => {
    if (reason === 'meds' && undo && state.drugs.length && JSON.stringify(state) === JSON.stringify(undo.snapshot)) undo = null;
    render(state);
  });
  render();
  return { el };
}
