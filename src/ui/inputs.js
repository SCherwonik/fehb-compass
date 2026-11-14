// Input panel: builds controls once, then syncs them from state in place (no re-render churn).
import { SCENARIOS } from '../engine/scenarios.js';
import { STATE_NAMES, statesFromServiceArea, plansForYear, networkFamilies } from '../data.js';

const VISIBLE_NETWORKS = 8;
const reduceMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Tiny element builder. Children may be strings, nodes, arrays, or falsy. Text always goes in as text. */
function h(tag, attrs = {}, ...children) {
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

const svg = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup; // static, author-controlled markup only
  return t.content.firstElementChild;
};
const ICON_CHECK = '<svg class="chip-check" viewBox="0 0 16 16" aria-hidden="true"><circle class="chip-ring" cx="8" cy="8" r="6.25"/><path class="chip-tick" d="M4.6 8.4l2.3 2.3 4.5-5"/></svg>';
const ICON_CHEVRON = '<svg class="select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

// ---------- primitives ----------

/** Segmented control: native radios (arrow-key navigation for free) under a sliding glass thumb. */
function segmented({ name, legend, options, hint }) {
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

// ---------- panel ----------

/**
 * renderInputs(form, { data, store }) -> unsubscribe
 * Builds every input, wires change events to store.set, and keeps controls in sync with state.
 */
export function renderInputs(form, { data, store }) {
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
    hint: 'Plans are matched by state for now. ZIP lookup for regional HMOs is coming.',
    groups: [{ options: states.map((c) => [c, STATE_NAMES[c] ?? c]) }],
  });

  // -- current plan, grouped by network family
  const byFamily = new Map();
  for (const p of plans2026) {
    const f = p.network_family || 'Other';
    if (!byFamily.has(f)) byFamily.set(f, []);
    byFamily.get(f).push(p);
  }
  const current = selectField({
    id: 'in-current', label: 'Your 2026 plan', placeholder: 'Not enrolled or skip',
    hint: 'Used to show what changes for you in 2027.',
    groups: [...byFamily.keys()].sort((a, b) => a.localeCompare(b)).map((f) => ({
      label: f,
      options: byFamily.get(f)
        .slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => [p.code, `${p.name} (${p.code})`]),
    })),
  });

  const account = segmented({
    name: 'account', legend: 'Savings account',
    options: [['any', 'Any plan'], ['hsa', 'HSA only'], ['hra', 'HRA only']],
    hint: 'HSA and HRA plans put money toward your costs each year.',
  });

  // -- networks: multi-select chips; none selected means every network
  const chipsId = nextId('chips');
  const chipWrap = h('div', { class: 'chips', id: chipsId });
  const chipEls = families.map(({ name, count }, idx) => {
    const input = h('input', { type: 'checkbox', class: 'chip-input', value: name });
    const label = h('label', { class: 'chip', 'data-rank': idx },
      input, svg(ICON_CHECK), h('span', { class: 'chip-text' }, name), h('span', { class: 'chip-count' }, count));
    chipWrap.append(label);
    return { name, label, input, idx };
  });
  let expanded = false;
  const more = h('button', { type: 'button', class: 'chip-more', 'aria-expanded': 'false', 'aria-controls': chipsId });
  const hiddenCount = Math.max(0, families.length - VISIBLE_NETWORKS);
  const networks = h('fieldset', { class: 'field' },
    h('legend', { class: 'field-label' }, 'Networks'),
    h('p', { class: 'field-hint field-hint-top' }, 'Leave all off to include every network. Numbers are 2027 plan options.'),
    chipWrap,
    hiddenCount > 0 && more);

  // -- scenario
  const scenario = segmented({
    name: 'scenario', legend: 'Expected care in 2027',
    options: [['healthy', 'Healthy'], ['typical', 'Typical'], ['condition', 'Condition'], ['worst', 'Worst case']],
  });
  const scenarioDesc = h('p', { class: 'scenario-desc', 'aria-live': 'polite' });
  scenario.el.append(scenarioDesc);

  // -- dental
  const dentalInput = h('input', { type: 'checkbox', role: 'switch', id: 'in-dental', class: 'switch-input' });
  const dental = h('div', { class: 'field field-switch' },
    h('label', { class: 'switch', for: 'in-dental' },
      h('span', { class: 'switch-copy' },
        h('span', { class: 'switch-title' }, 'Add dental and vision'),
        h('span', { class: 'switch-hint' }, 'Include FEDVIP premiums in your yearly total.')),
      dentalInput,
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-knob' }))));

  const group = (title, ...fields) => h('section', { class: 'group' },
    h('h3', { class: 'group-title' }, title), fields);

  form.replaceChildren(
    group('Coverage', status.el, enrollment.el),
    group('Location', location.el),
    group('Plans to consider', current.el, account.el, networks),
    group('Your year', scenario.el, dental),
  );

  // ---------- events ----------
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'status') store.set({ status: t.value });
    else if (t.name === 'enrollment') store.set({ enrollment: t.value });
    else if (t.name === 'account') store.set({ account: t.value });
    else if (t.name === 'scenario') store.set({ scenario: t.value });
    else if (t === location.select) store.set({ location: { state: t.value || null } });
    else if (t === current.select) store.set({ currentPlan2026: t.value || null });
    else if (t === dentalInput) store.set({ dental: t.checked });
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
    const selected = new Set(s.networks);
    for (const c of chipEls) {
      c.input.checked = selected.has(c.name);
      const show = expanded || c.idx < VISIBLE_NETWORKS || selected.has(c.name);
      const wasHidden = c.label.hidden;
      c.label.hidden = !show;
      if (animate && wasHidden && show && !reduceMotion()) {
        c.label.animate(
          [{ opacity: 0, transform: 'scale(0.92)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
          { duration: 320, delay: (c.idx - VISIBLE_NETWORKS) * 18, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
        );
      }
    }
    more.setAttribute('aria-expanded', String(expanded));
    more.textContent = expanded ? 'Show fewer' : `Show ${hiddenCount} more`;
  }

  let lastScenario = null;
  function syncScenario(s) {
    scenario.sync(s.scenario);
    if (s.scenario === lastScenario) return;
    const text = describeScenario(s.scenario);
    if (lastScenario && !reduceMotion()) {
      scenarioDesc.animate(
        [{ opacity: 0, transform: 'translateY(4px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
        { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
    scenarioDesc.textContent = text;
    lastScenario = s.scenario;
  }

  function sync(s) {
    status.sync(s.status);
    enrollment.sync(s.enrollment);
    location.sync(s.location.state);
    current.sync(s.currentPlan2026);
    account.sync(s.account);
    syncChips(s);
    syncScenario(s);
    dentalInput.checked = s.dental;
  }

  sync(store.get());
  return store.subscribe(sync);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Plain-language summary of an engine scenario, e.g. "3 primary care visits, 2 specialist visits, ...". */
export function describeScenario(key) {
  const u = SCENARIOS[key];
  if (!u) return '';
  const parts = [
    u.pcpVisits && plural(u.pcpVisits, 'primary care visit'),
    u.specialistVisits && plural(u.specialistVisits, 'specialist visit'),
    u.erVisits && plural(u.erVisits, 'ER visit'),
    u.hospitalStays && plural(u.hospitalStays, 'hospital stay'),
    u.labs && plural(u.labs, 'lab test'),
    u.imaging && plural(u.imaging, 'imaging scan'),
    u.rxMonthly && `${plural(u.rxMonthly, 'monthly generic prescription')}`,
  ].filter(Boolean);
  return parts.join(', ') + '.';
}
