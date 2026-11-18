// "Fine-tune your year": one person's worst-case sliders (overrides layered on their scenario). Shared by you
// (bound to state.scenario / state.overrides) and each other covered person (bound to state.others[i]).
import { h, svg } from './dom.js';
import { SCENARIOS, OVERRIDE_FIELDS } from '../engine/scenarios.js';
import { ASSUMED_PRICES } from '../engine/assumptions.js';
import { describeUsage, effectiveUsage, overrideChanges } from './assumptions.js';
import { nextOverrides } from './members-model.js';
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
 * createFineTune({ idPrefix, label, lede, get, set }) -> { el, sync(view), describe(view) }
 * get() -> { scenario, overrides } as currently stored; set(overrides) writes a new overrides object.
 * sync(view) paints from the same { scenario, overrides } shape. idPrefix keeps ids unique per person.
 */
export function createFineTune({ idPrefix = 'ft', label = 'Fine-tune your year', lede = 'Set a worst case.', get, set }) {
  const ftId = `${idPrefix}-body`;
  const ftToggle = h('button', { type: 'button', class: 'ft-toggle', 'aria-expanded': 'false', 'aria-controls': ftId },
    h('span', { class: 'ft-toggle-copy' },
      h('span', { class: 'ft-title' }, label),
      h('span', { class: 'ft-badge', hidden: true })),
    svg(ICON_CHEV));
  const reset = h('button', { type: 'button', class: 'btn btn-quiet ft-reset', hidden: true }, svg(ICON_RESET), 'Reset to scenario');
  const sliders = Object.entries(OVERRIDE_FIELDS).map(([key, f]) => {
    const id = `${idPrefix}-${key}`;
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
  const body = h('div', { class: 'ft-body', id: ftId, role: 'group', 'aria-label': label, hidden: true },
    h('div', { class: 'ft-inner' },
      h('p', { class: 'field-hint ft-lede' }, `${lede} Each change sits on top of the scenario; the tick marks the scenario’s value.`),
      sliders.map((s) => s.row),
      reset));
  const el = h('div', { class: 'field ft' }, ftToggle, body);

  function setValue(s, v) {
    const cur = get();
    set(nextOverrides(cur.scenario, cur.overrides, s.key, v, s.f));
  }
  for (const s of sliders) {
    s.input.addEventListener('input', () => setValue(s, Number(s.input.value)));
    s.minus.addEventListener('click', () => setValue(s, Number(s.input.value) - 1));
    s.plus.addEventListener('click', () => setValue(s, Number(s.input.value) + 1));
  }
  reset.addEventListener('click', () => {
    set({});
    sliders[0].input.focus();
  });
  ftToggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    ftToggle.setAttribute('aria-expanded', String(open));
    el.classList.toggle('is-open', open);
    if (open && !reduceMotion()) {
      body.animate([{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
        { duration: 320, easing: EASE_OUT });
      sliders.forEach((s, i) => s.row.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, delay: 40 + i * 35, easing: EASE_OUT, fill: 'backwards' }));
    }
  });

  let first = true;
  function sync(view) {
    const usage = effectiveUsage(view);
    const base = SCENARIOS[view.scenario] ?? SCENARIOS.typical;
    const changes = overrideChanges(view);
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
    first = false;
  }

  return { el, sync, describe: (view) => describeUsage(effectiveUsage(view)) };
}
