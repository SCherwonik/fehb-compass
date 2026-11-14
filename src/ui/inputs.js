// Input panel: builds controls once, then syncs them from state in place (no re-render churn).
import { SCENARIOS } from '../engine/scenarios.js';
import { STATE_NAMES, statesFromServiceArea, plansForYear, networkFamilies } from '../data.js';
import { countsByFamily, groupCurrentPlanOptions } from './model.js';
import { describeUsage } from './assumptions.js';
import { createScenarioSection } from './scenario.js';
import { glp1Filter } from './meds.js';
import { createZipField, lookupZip, zipKeepsWith } from './zip.js';
import { createDvAddon } from './dental-board.js';
import { fedvipHub } from '../data.js';

const VISIBLE_NETWORKS = 8;
const reduceMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Tiny element builder. Children may be strings, nodes, arrays, or falsy. Text always goes in as text. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const svg = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup; // static, author-controlled markup only
  return t.content.firstElementChild;
};
export const ICON_CHECK = '<svg class="chip-check" viewBox="0 0 16 16" aria-hidden="true"><circle class="chip-ring" cx="8" cy="8" r="6.25"/><path class="chip-tick" d="M4.6 8.4l2.3 2.3 4.5-5"/></svg>';
export const ICON_CHEVRON = '<svg class="select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

// ---------- primitives ----------

/** Segmented control: native radios (arrow-key navigation for free) under a sliding glass thumb. */
export function segmented({ name, legend, options, hint }) {
  const hintId = hint ? nextId('hint') : null;
  const track = h('div', { class: 'segmented', style: `--n:${options.length};--i:0` },
    h('span', { class: 'seg-thumb', 'aria-hidden': 'true' }),
    options.map(([value, label]) =>
      h('label', { class: 'seg' },
        h('input', { type: 'radio', name, value, class: 'seg-input' }),
        h('span', { class: 'seg-label' }, label))));
  const fs = h('fieldset', { class: 'field', 'aria-describedby': hintId },
    h('legend', { class: 'field-label' }, legend),
    track,
    hint && h('p', { class: 'field-hint', id: hintId }, hint));
  const values = options.map(([v]) => v);
  return {
    el: fs,
    sync(value) {
      const i = Math.max(0, values.indexOf(value));
      track.style.setProperty('--i', i);
      for (const input of track.querySelectorAll('input')) input.checked = input.value === value;
    },
  };
}

function selectField({ id, label, hint, placeholder, groups }) {
  const hintId = hint ? nextId('hint') : null;
  const select = h('select', { id, class: 'select', 'aria-describedby': hintId },
    h('option', { value: '' }, placeholder),
    groups.map((g) => (g.label
      ? h('optgroup', { label: g.label }, g.options.map(([v, t]) => h('option', { value: v }, t)))
      : g.options.map(([v, t]) => h('option', { value: v }, t)))));
  const el = h('div', { class: 'field' },
    h('label', { class: 'field-label', for: id }, label),
    h('div', { class: 'select-wrap' }, select, svg(ICON_CHEVRON)),
    hint && h('p', { class: 'field-hint', id: hintId }, hint));
  return {
    el,
    select,
    sync(value) {
      const v = value ?? '';
      select.value = [...select.options].some((o) => o.value === v) ? v : '';
      select.classList.toggle('is-empty', select.value === '');
    },
  };
}

/**
 * Searchable single-select (ARIA 1.2 editable combobox with a listbox popup).
 * Type to filter, ArrowUp/Down to move, Enter to choose, Esc to close and restore, Tab to leave.
 * setModel({ groups: [{ id, label, options: [{ code, name, carrier, continues }] }] }); sync(code).
 */
export function combobox({ id, label, hint, placeholder, emptyLabel, onSelect }) {
  const listId = `${id}-list`;
  const hintId = hint ? nextId('hint') : null;
  const input = h('input', {
    type: 'text', id, class: 'select cb-input is-empty', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
    'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-describedby': hintId,
    placeholder,
  });
  const list = h('div', { class: 'cb-list', id: listId, role: 'listbox', 'aria-label': label, hidden: true });
  const live = h('p', { class: 'sr-only', role: 'status' });
  const chevron = svg(ICON_CHEVRON);
  const el = h('div', { class: 'field cb' },
    h('label', { class: 'field-label', for: id }, label),
    h('div', { class: 'select-wrap cb-wrap' }, input, chevron, list),
    hint && h('p', { class: 'field-hint', id: hintId }, hint),
    live);

  let model = { groups: [] };
  let selected = '';
  let dirty = false; // the text box holds a search, not the chosen plan's name
  let open = false;
  let active = -1;
  let flat = []; // [{ code, node }] in display order, including the clear option

  const nameOf = (code) => {
    for (const g of model.groups) for (const o of g.options) if (o.code === code) return o.name;
    return '';
  };
  const showSelected = () => {
    input.value = nameOf(selected);
    input.classList.toggle('is-empty', !selected);
    dirty = false;
  };

  function optionNode(o, optId) {
    const badge = o.continues === undefined ? null
      : h('span', { class: `cb-badge ${o.continues ? 'is-continues' : 'is-ended'}` }, o.continues ? 'continues in 2027' : 'ended in 2027');
    return h('div', { class: 'cb-option', role: 'option', id: optId, 'data-code': o.code, 'aria-selected': String(o.code === selected) },
      h('span', { class: 'cb-name' }, o.name),
      (o.code || badge) && h('span', { class: 'cb-sub' },
        o.code && h('span', { class: 'cb-meta' }, o.carrier ? `${o.carrier} · plan ${o.code}` : `Plan ${o.code}`),
        badge));
  }

  function render() {
    const tokens = dirty ? input.value.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const match = (o) => {
      const hay = `${o.name} ${o.carrier} ${o.code}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    };
    flat = [];
    const nodes = [];
    let n = 0;
    if (!tokens.length) {
      const node = optionNode({ code: '', name: emptyLabel }, `${id}-o${n++}`);
      node.classList.add('cb-clear');
      flat.push({ code: '', node });
      nodes.push(node);
    }
    for (const g of model.groups) {
      const opts = g.options.filter(match);
      if (!opts.length) continue;
      const gid = `${id}-g-${g.id}`;
      const body = opts.map((o) => {
        const node = optionNode(o, `${id}-o${n++}`);
        flat.push({ code: o.code, node });
        return node;
      });
      nodes.push(h('div', { class: 'cb-group', role: 'group', 'aria-labelledby': gid },
        h('div', { class: 'cb-group-label', id: gid, role: 'presentation' }, g.label), body));
    }
    const count = flat.filter((f) => f.code).length;
    if (!count) nodes.push(h('p', { class: 'cb-empty' }, `No 2026 plan matches “${input.value.trim()}”.`));
    list.replaceChildren(...nodes);
    live.textContent = count ? `${count} ${count === 1 ? 'plan' : 'plans'} available` : 'No matching plans';
    active = tokens.length ? (count ? 0 : -1) : Math.max(0, flat.findIndex((f) => f.code === selected));
    paintActive(false);
  }

  function paintActive(scroll = true) {
    flat.forEach((f, i) => f.node.classList.toggle('is-active', i === active));
    const cur = flat[active]?.node;
    if (cur) {
      input.setAttribute('aria-activedescendant', cur.id);
      if (scroll) cur.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function setOpen(next) {
    if (next === open) return;
    open = next;
    input.setAttribute('aria-expanded', String(open));
    chevron.classList.toggle('is-open', open);
    if (open) {
      list.hidden = false;
      render();
      flat[active]?.node.scrollIntoView({ block: 'nearest' });
      if (!reduceMotion()) {
        list.animate(
          [{ opacity: 0, transform: 'translateY(-4px) scale(0.985)' }, { opacity: 1, transform: 'none' }],
          { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        );
      }
    } else {
      list.hidden = true;
      input.removeAttribute('aria-activedescendant');
      showSelected();
    }
  }

  function choose(code) {
    selected = code;
    showSelected();
    setOpen(false);
    onSelect(code || null);
  }

  input.addEventListener('click', () => setOpen(true));
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => setOpen(false));
  input.addEventListener('input', () => {
    dirty = true;
    input.classList.remove('is-empty');
    if (open) render(); else setOpen(true);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!flat.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + d + flat.length) % flat.length;
      paintActive();
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();
        if (flat[active]) choose(flat[active].code);
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    }
  });
  // mousedown (not click) keeps focus in the input so blur does not close the list first
  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const opt = e.target.closest('.cb-option');
    if (opt) choose(opt.dataset.code);
  });
  list.addEventListener('mousemove', (e) => {
    const opt = e.target.closest('.cb-option');
    const i = flat.findIndex((f) => f.node === opt);
    if (i >= 0 && i !== active) { active = i; paintActive(false); }
  });
  chevron.addEventListener('mousedown', (e) => {
    e.preventDefault();
    input.focus();
    setOpen(!open);
  });

  return {
    el,
    input,
    setModel(m) {
      model = m;
      if (open) render(); else showSelected();
    },
    sync(code) {
      selected = code ?? '';
      if (open) render(); else showSelected();
    },
  };
}

// ---------- panel ----------

/**
 * renderInputs(form, { data, store }) -> unsubscribe
 * Builds every input, wires change events to store.set, and keeps controls in sync with state.
 */
export function renderInputs(form, { data, store, meds }) {
  const states = statesFromServiceArea(data.serviceArea);
  const families = networkFamilies(data.plans, 2027);
  const plans2026 = plansForYear(data.plans, 2026);

  // -- who
  const status = segmented({
    name: 'status', legend: 'Employment',
    options: [['active', 'Active employee'], ['retiree', 'Retiree']],
  });
  const enrollment = segmented({
    name: 'enrollment', legend: 'Who is covered',
    options: [['self', 'Self only'], ['self_plus_one', 'Self plus one'], ['family', 'Family']],
  });

  // -- where
  const location = selectField({
    id: 'in-state', label: 'State', placeholder: 'Choose your state',
    hint: 'Plans are matched by state. Your ZIP code fills this in.',
    groups: [{ options: states.map((c) => [c, STATE_NAMES[c] ?? c]) }],
  });

  const stateName = (c) => STATE_NAMES[c] ?? c;
  const stateHint = location.el.querySelector('.field-hint');
  const zip = createZipField({ h, store, getFedvip: fedvipHub.get, onNeedData: () => fedvipHub.load(), stateName });
  fedvipHub.subscribe(() => { zip.refresh(); sync(store.get()); });

  // -- current plan: searchable, grouped by whether it carries into 2027 for the chosen state
  const plans27 = plansForYear(data.plans, 2027);
  const current = combobox({
    id: 'in-current', label: 'Your 2026 plan', placeholder: 'Search plans, or skip', emptyLabel: 'Not enrolled or skip',
    hint: 'Shows 2026 plans; plans marked ended have no 2027 version.',
    onSelect: (code) => store.set({ currentPlan2026: code }),
  });
  let currentFor; // state the combobox groups were last built for
  function syncCurrentModel(st) {
    if (st === currentFor) return;
    currentFor = st;
    current.setModel(groupCurrentPlanOptions(plans2026, plans27, data.serviceArea, st, STATE_NAMES[st] ?? st));
  }

  // -- include my plan: keep the 2027 version of the current plan in every comparison (only with a current plan)
  const mine = mineSwitch('in-mine');

  const account = segmented({
    name: 'account', legend: 'Savings account',
    options: [['any', 'Any plan'], ['hsa', 'HSA only'], ['hra', 'HRA only']],
    hint: 'HSA and HRA plans put money toward your costs each year.',
  });

  // -- networks: multi-select chips; none selected means every network.
  // Counts follow the chosen state and savings account (not the network choice itself).
  const chipsId = nextId('chips');
  const chipWrap = h('div', { class: 'chips', id: chipsId });
  const chipEls = networkFamilies(data.plans, 2027).map(({ name }) => {
    const input = h('input', { type: 'checkbox', class: 'chip-input', value: name });
    const count = h('span', { class: 'chip-count' }, '0');
    const label = h('label', { class: 'chip', title: name }, input, svg(ICON_CHECK), h('span', { class: 'chip-text' }, name), count);
    chipWrap.append(label);
    return { name, label, input, count, rank: 0, n: null };
  });
  const chipByName = new Map(chipEls.map((c) => [c.name, c]));
  let expanded = false;
  let order = '';
  const more = h('button', { type: 'button', class: 'chip-more', 'aria-expanded': 'false', 'aria-controls': chipsId });
  const scope = h('p', { class: 'field-hint chip-scope' });
  const networks = h('fieldset', { class: 'field' },
    h('legend', { class: 'field-label' }, 'Networks'),
    h('p', { class: 'field-hint field-hint-top' }, 'Leave all off to include every network.'),
    scope,
    chipWrap,
    more);

  // -- GLP-1 weight-loss coverage (brochure facts; src/ui/meds.js)
  const glp1 = meds ? glp1Filter({ store, meds, data }) : null;

  // -- scenario, fine-tune overrides and custom lines (src/ui/scenario.js)
  const year = createScenarioSection({ store });

  // -- dental
  const dentalInput = h('input', { type: 'checkbox', role: 'switch', id: 'in-dental', class: 'switch-input' });
  const dental = h('div', { class: 'field field-switch' },
    h('label', { class: 'switch', for: 'in-dental' },
      h('span', { class: 'switch-copy' },
        h('span', { class: 'switch-title' }, 'Add dental and vision'),
        h('span', { class: 'switch-hint' }, 'Include a FEDVIP dental and vision plan in your yearly total.')),
      dentalInput,
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-knob' }))));
  const dvAddon = createDvAddon({ store });

  const group = (title, ...fields) => h('section', { class: 'group' },
    h('h3', { class: 'group-title' }, title), fields);

  form.replaceChildren(
    group('Coverage', status.el, enrollment.el),
    group('Location', zip.el, location.el),
    group('Plans to consider', current.el, mine.el, account.el, networks, glp1?.el),
    group('Your year', year.el, dental, dvAddon.el),
  );

  // ---------- events ----------
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'status') store.set({ status: t.value });
    else if (t.name === 'enrollment') store.set({ enrollment: t.value });
    else if (t.name === 'account') store.set({ account: t.value });
    else if (t.name === 'scenario') store.set({ scenario: t.value });
    else if (t === location.select) {
      // only a state that clearly contradicts the ZIP drops it (it would price dental for the wrong place);
      // ZIPs on a state line or without a state in OPM's list (Puerto Rico) stay
      const z = store.get().location.zip;
      const st = t.value || null;
      const keep = !st || zipKeepsWith(fedvipHub.get(), z, st);
      store.set({ location: { state: st, zip: keep ? z : null } });
      if (!keep) zip.note(`ZIP ${z} is in ${stateName(lookupZip(fedvipHub.get(), z).state ?? '') || 'another state'}, so it was cleared. Enter a ZIP in ${stateName(st)} to price dental.`);
    }
    else if (t === dentalInput) store.set({ dental: t.checked });
    else if (t === mine.input) store.set({ includeMine: t.checked });
    else if (t.classList.contains('chip-input')) {
      store.set({ networks: chipEls.filter((c) => c.input.checked).map((c) => c.name) });
    }
  });
  more.addEventListener('click', () => {
    expanded = !expanded;
    syncChips(store.get(), true);
  });

  // ---------- sync ----------
  function syncChips(s, animate = false) {
    const st = s.location.state;
    const counts = countsByFamily(plans27, data.serviceArea, { state: st, zip: s.location.zip, account: s.account });
    const selected = new Set(s.networks);
    const where = st ? (STATE_NAMES[st] ?? st) : null;
    scope.textContent = where
      ? `Numbers are plans open to you in ${where}${s.account === 'any' ? '' : `, ${s.account.toUpperCase()} only`}.`
      : 'Numbers are nationwide plans. Choose a state to add regional plans.';

    counts.families.forEach((f, i) => {
      const c = chipByName.get(f.name);
      c.rank = i;
      c.input.checked = selected.has(f.name);
      const zero = f.count === 0;
      c.input.disabled = zero && !selected.has(f.name); // a selected empty chip stays clickable so it can be cleared
      c.label.classList.toggle('is-zero', zero);
      if (c.n !== f.count) {
        const changed = c.n !== null;
        c.n = f.count;
        c.count.textContent = f.count;
        if (changed && animate && !reduceMotion()) {
          c.count.animate(
            [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }],
            { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
          );
        }
      }
    });
    // Most plans first, empty families last. Reorder the DOM only when the order changed (never on a chip
    // toggle, since counts ignore the network choice), so focus is not lost mid-click.
    const nextOrder = counts.families.map((f) => f.name).join('|');
    if (nextOrder !== order) {
      order = nextOrder;
      chipWrap.append(...counts.families.map((f) => chipByName.get(f.name).label));
    }

    let hiddenCount = 0;
    for (const c of chipEls) {
      const show = expanded || c.rank < VISIBLE_NETWORKS || selected.has(c.name);
      if (!show) hiddenCount += 1;
      const wasHidden = c.label.hidden;
      c.label.hidden = !show;
      if (animate && wasHidden && show && !reduceMotion()) {
        c.label.animate(
          [{ opacity: 0, transform: 'scale(0.92)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
          { duration: 320, delay: Math.max(0, c.rank - VISIBLE_NETWORKS) * 18, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
        );
      }
    }
    more.hidden = hiddenCount === 0 && !expanded;
    more.setAttribute('aria-expanded', String(expanded));
    more.textContent = expanded ? 'Show fewer' : `Show ${hiddenCount} more`;
  }

  function sync(s) {
    status.sync(s.status);
    enrollment.sync(s.enrollment);
    location.sync(s.location.state);
    zip.sync(s);
    const z = s.location.zip;
    const zs = z && fedvipHub.get() ? lookupZip(fedvipHub.get(), z).state : null;
    stateHint.textContent = z && zs && zs === s.location.state
      ? `From ZIP ${z}. Choose another state to override it.`
      : z ? `ZIP ${z} prices dental; health plans follow the state you pick here.` : 'Plans are matched by state. Your ZIP code fills this in.';
    syncCurrentModel(s.location.state);
    current.sync(s.currentPlan2026);
    mine.sync(s);
    account.sync(s.account);
    syncChips(s, true);
    year.sync(s);
    dentalInput.checked = s.dental;
    dvAddon.sync(s);
    glp1?.sync(s);
  }

  sync(store.get());
  return store.subscribe(sync);
}

/**
 * "Include my plan (2027 version)" switch, bound by the caller to state.includeMine.
 * Shown only when a 2026 plan is chosen. sync(state) sets checked/hidden.
 */
export function mineSwitch(id, { compact = false } = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch', id, class: 'switch-input' });
  const el = h('div', { class: `field field-switch field-mine${compact ? ' is-compact' : ''}` },
    h('label', { class: 'switch', for: id },
      h('span', { class: 'switch-copy' },
        h('span', { class: 'switch-title' }, 'Include my plan (2027 version)'),
        !compact && h('span', { class: 'switch-hint' }, 'Always compare against what staying put costs in 2027, whatever the filters.')),
      input,
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-knob' }))));
  return {
    el,
    input,
    sync(s) {
      el.hidden = !s.currentPlan2026;
      input.checked = s.includeMine !== false;
    },
  };
}

/** Plain-language summary of an engine scenario, e.g. "3 primary care visits, 2 specialist visits, ...". */
export function describeScenario(key) {
  const u = SCENARIOS[key];
  return u ? describeUsage(u) : '';
}
