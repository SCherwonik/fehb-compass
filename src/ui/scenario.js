// "Your year": scenario picker, the "Fine-tune your year" worst-case controls (overrides layered on the
// scenario) and the "Your own costs" custom line editor.
import { h, svg } from './dom.js';
import { segmented } from './inputs.js';
import { SCENARIOS, OVERRIDE_FIELDS } from '../engine/scenarios.js';
import { ASSUMED_PRICES } from '../engine/assumptions.js';
import { describeUsage, effectiveUsage, overrideChanges } from './assumptions.js';
import { createCustomLines } from './custom-lines.js';
import { reduceMotion, EASE_OUT, tweenNumber } from './motion.js';

const ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-chev"><path d="M4 6l4 4 4-4"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const ICON_RESET = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5"/><path d="M3 2.6v2.6h2.6"/></svg>';

export const SCENARIO_OPTIONS = [
  ['healthy', 'Healthy'], ['typical', 'Typical'], ['condition', 'Condition'], ['worst', 'Worst'], ['nothing', 'None'],
];

/** Per-field note under the value, e.g. "Priced at $250 a visit." */
function fieldNote(key, v) {
  const cost = {
    hospitalStays: [ASSUMED_PRICES.inpatientStay + ASSUMED_PRICES.surgery, 'a stay'],
    erVisits: [ASSUMED_PRICES.erVisit, 'a visit'],
    specialistVisits: [ASSUMED_PRICES.specialistVisit, 'a visit'],
    pcpVisits: [ASSUMED_PRICES.pcpVisit, 'a visit'],
    rxMonthly: [ASSUMED_PRICES.rxGenericFill * 12, 'a year each'],
  }[key];
  if (!cost) return '';
  return `Priced at $${cost[0].toLocaleString('en-US')} ${cost[1]}.`;
}

/**
 * createScenarioSection({ store }) -> { el: Node[], sync(state) }
 */
export function createScenarioSection({ store }) {
  const scenario = segmented({ name: 'scenario', legend: 'Expected care in 2027', options: SCENARIO_OPTIONS });
  scenario.el.classList.add('field-scenario');
  const desc = h('p', { class: 'scenario-desc', 'aria-live': 'polite' });
  scenario.el.append(desc);

  // ---------- fine-tune ----------
  const ftId = 'ft-body';
  const ftToggle = h('button', { type: 'button', class: 'ft-toggle', 'aria-expanded': 'false', 'aria-controls': ftId },
    h('span', { class: 'ft-toggle-copy' },
      h('span', { class: 'ft-title' }, 'Fine-tune your year'),
      h('span', { class: 'ft-badge', hidden: true })),
    svg(ICON_CHEV));
  const reset = h('button', { type: 'button', class: 'btn btn-quiet ft-reset', hidden: true }, svg(ICON_RESET), 'Reset to scenario');
  const sliders = Object.entries(OVERRIDE_FIELDS).map(([key, f]) => {
    const id = `ft-${key}`;
    const input = h('input', {
      type: 'range', class: 'ft-range', id, min: String(f.min), max: String(f.max), step: '1',
      'aria-describedby': `${id}-note`,
    });
    const out = h('output', { class: 'ft-val num', for: id });
    const minus = h('button', { type: 'button', class: 'ft-step', 'aria-label': `Fewer ${f.label.toLowerCase()}`, tabindex: '-1' }, svg(ICON_MINUS));
    const plus = h('button', { type: 'button', class: 'ft-step', 'aria-label': `More ${f.label.toLowerCase()}`, tabindex: '-1' }, svg(ICON_PLUS));
    const note = h('span', { class: 'ft-note', id: `${id}-note` });
    const row = h('div', { class: 'ft-row' },
      h('div', { class: 'ft-head' },
        h('label', { class: 'ft-label', for: id }, f.label),
        out),
      h('div', { class: 'ft-ctl' }, minus, h('div', { class: 'ft-track' }, input, h('span', { class: 'ft-def', 'aria-hidden': 'true' })), plus),
      note);
    return { key, f, input, out, minus, plus, note, row };
  });
  const body = h('div', { class: 'ft-body', id: ftId, role: 'group', 'aria-label': 'Fine-tune your year', hidden: true },
    h('div', { class: 'ft-inner' },
      h('p', { class: 'field-hint ft-lede' }, 'Set your own worst case. Each change sits on top of the scenario; the tick marks the scenario’s value.'),
      sliders.map((s) => s.row),
      reset));
  const fineTune = h('div', { class: 'field ft' }, ftToggle, body);

  const custom = createCustomLines({ store });

  // ---------- events ----------
  function setValue(s, v) {
    const state = store.get();
    const base = (SCENARIOS[state.scenario] ?? SCENARIOS.typical)[s.key];
    const next = { ...state.overrides };
    const clamped = Math.min(s.f.max, Math.max(s.f.min, v));
    if (clamped === base) delete next[s.key]; else next[s.key] = clamped;
    store.set({ overrides: next });
  }
  for (const s of sliders) {
    s.input.addEventListener('input', () => setValue(s, Number(s.input.value)));
    s.minus.addEventListener('click', () => setValue(s, Number(s.input.value) - 1));
    s.plus.addEventListener('click', () => setValue(s, Number(s.input.value) + 1));
  }
  reset.addEventListener('click', () => {
    store.set({ overrides: {} });
    (sliders[0].input).focus();
  });
  ftToggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    ftToggle.setAttribute('aria-expanded', String(open));
    fineTune.classList.toggle('is-open', open);
    if (open && !reduceMotion()) {
      body.animate([{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
        { duration: 320, easing: EASE_OUT });
      sliders.forEach((s, i) => s.row.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, delay: 40 + i * 35, easing: EASE_OUT, fill: 'backwards' }));
    }
  });

  // ---------- sync ----------
  let lastDesc = null;
  let first = true;
  function sync(state) {
    scenario.sync(state.scenario);
    const usage = effectiveUsage(state);
    const base = SCENARIOS[state.scenario] ?? SCENARIOS.typical;
    const text = describeUsage(usage);
    if (text !== lastDesc) {
      if (lastDesc !== null && !reduceMotion()) {
        desc.animate([{ opacity: 0.2, filter: 'blur(2px)' }, { opacity: 1, filter: 'none' }], { duration: 260, easing: EASE_OUT });
      }
      desc.textContent = text;
      lastDesc = text;
    }
    const changes = overrideChanges(state);
    for (const s of sliders) {
      const v = usage[s.key];
      if (document.activeElement !== s.input || Number(s.input.value) !== v) s.input.value = String(v);
      const span = s.f.max - s.f.min;
      s.row.style.setProperty('--p', ((v - s.f.min) / span).toFixed(4));
      s.row.style.setProperty('--d', ((base[s.key] - s.f.min) / span).toFixed(4));
      tweenNumber(s.out, v, (n) => String(Math.round(n)), { animate: !first, dur: 300 });
      s.input.setAttribute('aria-valuetext', `${v} ${v === 1 ? s.f.unit[0] : s.f.unit[1]}${v !== base[s.key] ? `, scenario has ${base[s.key]}` : ''}`);
      s.minus.disabled = v <= s.f.min;
      s.plus.disabled = v >= s.f.max;
      const changed = v !== base[s.key];
      s.row.classList.toggle('is-changed', changed);
      s.note.textContent = changed
        ? `Scenario has ${base[s.key]}. ${fieldNote(s.key, v)}`
        : fieldNote(s.key, v);
    }
    reset.hidden = changes.length === 0;
    const badge = ftToggle.querySelector('.ft-badge');
    badge.hidden = changes.length === 0;
    badge.textContent = `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`;
    custom.sync(state);
    first = false;
  }

  return { el: [scenario.el, fineTune, custom.el], sync };
}
