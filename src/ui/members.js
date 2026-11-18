// "Covered people": shown under "Your year" when the enrollment covers more than one person. A family also sets how
// many people it covers. Each person is one collapsible row (only one open at a time) holding their name, their
// expected-care scenario and their own fine-tune sliders. You are member 1 and stay in state.scenario /
// state.overrides; everyone else lives in state.others[i - 1]. Names are typed text and only ever shown as text.
import { h, svg } from './dom.js';
import { segmented } from './inputs.js';
import { createFineTune, SCENARIO_OPTIONS } from './fine-tune.js';
import { memberCount, MAX_MEMBERS } from '../state.js';
import { memberView, memberLabel, memberPatch, setFocusedMember } from './members-model.js';
import { reduceMotion, EASE_OUT } from './motion.js';

const ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-chev"><path d="M4 6l4 4 4-4"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const MAX_NAME = 20;
const SCENARIO_LABEL = Object.fromEntries(SCENARIO_OPTIONS);

export const NAME_PRIVACY = 'Names are saved in the page link and in links you share, so a first name or a role such as Spouse is enough.';

/**
 * createMembersSection({ store }) -> { el, sync(state) }
 */
export function createMembersSection({ store }) {
  const MIN_FAMILY = 3;
  const stepVal = h('output', { class: 'mb-step-val num', 'aria-live': 'polite' });
  const stepLabel = h('span', { class: 'field-label mb-step-label', id: 'mb-size-label' }, 'How many covered people');
  const minus = h('button', { type: 'button', class: 'ft-step mb-step', 'aria-label': 'Fewer covered people' }, svg(ICON_MINUS));
  const plus = h('button', { type: 'button', class: 'ft-step mb-step', 'aria-label': 'More covered people' }, svg(ICON_PLUS));
  // aria-disabled (not disabled) at the ends, so focus stays on the button that was just pressed
  const stepper = h('div', { class: 'mb-stepper', role: 'group', 'aria-labelledby': 'mb-size-label' }, stepLabel,
    h('div', { class: 'mb-step-ctl' }, minus, stepVal, plus));
  const setSize = (n) => {
    const next = Math.min(MAX_MEMBERS, Math.max(MIN_FAMILY, n));
    if (next !== store.get().familySize) store.set({ familySize: next });
  };
  minus.addEventListener('click', () => setSize(store.get().familySize - 1));
  plus.addEventListener('click', () => setSize(store.get().familySize + 1));

  const list = h('ol', { class: 'mb-list', 'aria-label': 'Covered people' });
  const el = h('fieldset', { class: 'field mb', hidden: true },
    h('legend', { class: 'field-label' }, 'Covered people'),
    h('p', { class: 'field-hint field-hint-top' }, 'Each person has their own year of care. Open a row to set theirs.'),
    stepper,
    list);

  /** rows[i]: { el, toggle, body, nameEl, nameIn, scenario, fine, desc } built the first time member i is shown */
  const rows = [];
  let open = 0;
  let last = null;

  function makeRow(i) {
    const id = `mb-${i}`;
    const nameEl = h('span', { class: 'mb-name' });
    const badge = h('span', { class: 'mb-sc' });
    const toggle = h('button', { type: 'button', class: 'mb-toggle', 'aria-expanded': 'false', 'aria-controls': `${id}-body` },
      h('span', { class: 'mb-toggle-copy' }, nameEl, badge), svg(ICON_CHEV));
    const scenario = segmented({ name: `mb-sc-${i}`, legend: 'Expected care in 2027', options: SCENARIO_OPTIONS });
    scenario.el.classList.add('field-scenario');
    const desc = h('p', { class: 'scenario-desc' });
    scenario.el.append(desc);
    const fine = createFineTune({
      idPrefix: `${id}-ft`,
      label: 'Fine-tune this year',
      get: () => { const v = memberView(store.get(), i); return { scenario: v.scenario, overrides: v.overrides }; },
      set: (overrides) => store.set(memberPatch(store.get(), i, { overrides })),
    });
    let nameIn = null;
    const parts = [];
    if (i > 0) {
      nameIn = h('input', {
        type: 'text', class: 'cl-input mb-name-in', id: `${id}-name`, maxlength: String(MAX_NAME), autocomplete: 'off',
        'aria-describedby': `${id}-name-hint`, placeholder: `Person ${i + 1}`,
      });
      parts.push(h('div', { class: 'field mb-name-field' },
        h('label', { class: 'field-label', for: `${id}-name` }, 'Name (optional)'),
        nameIn,
        h('p', { class: 'field-hint', id: `${id}-name-hint` }, NAME_PRIVACY)));
      nameIn.addEventListener('input', () => store.set(memberPatch(store.get(), i, { name: nameIn.value })));
      nameIn.addEventListener('blur', () => { nameIn.value = memberView(store.get(), i).name; });
    }
    parts.push(scenario.el, fine.el);
    const body = h('div', { class: 'mb-body', id: `${id}-body`, role: 'group', 'aria-labelledby': `${id}-title`, hidden: true },
      h('div', { class: 'mb-inner' }, parts));
    nameEl.id = `${id}-title`;
    const rowEl = h('li', { class: 'mb-row' }, h('h4', { class: 'mb-h' }, toggle), body);

    scenario.el.addEventListener('change', (e) => {
      if (e.target.name !== `mb-sc-${i}`) return;
      e.stopPropagation();
      store.set(memberPatch(store.get(), i, { scenario: e.target.value }));
    });
    toggle.addEventListener('click', () => {
      open = open === i ? -1 : i;
      paintOpen(true);
      setFocusedMember(open < 0 ? 0 : open);
    });
    return { el: rowEl, toggle, body, nameEl, badge, nameIn, scenario, fine, desc, shown: false };
  }

  function paintOpen(animate) {
    rows.forEach((r, i) => {
      const isOpen = i === open;
      const was = !r.body.hidden;
      r.body.hidden = !isOpen;
      r.toggle.setAttribute('aria-expanded', String(isOpen));
      r.el.classList.toggle('is-open', isOpen);
      if (animate && isOpen && !was && !reduceMotion()) {
        r.body.animate([{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
          { duration: 320, easing: EASE_OUT });
      }
    });
  }

  function sync(state) {
    const n = memberCount(state);
    el.hidden = n <= 1;
    if (n <= 1) return;
    const family = state.enrollment === 'family';
    stepper.hidden = !family;
    stepVal.textContent = `${state.familySize} people`;
    minus.setAttribute('aria-disabled', String(state.familySize <= MIN_FAMILY));
    plus.setAttribute('aria-disabled', String(state.familySize >= MAX_MEMBERS));
    while (rows.length < n) {
      const r = makeRow(rows.length);
      rows.push(r);
      list.append(r.el);
      paintOpen(false);
    }
    // the stored `open` can point past the people now covered: show it closed, keep it for when they come back
    rows.forEach((r, i) => {
      r.el.hidden = i >= n;
      if (i >= n) return;
      const v = memberView(state, i);
      const label = memberLabel(state, i);
      if (r.nameEl.textContent !== label) r.nameEl.textContent = label;
      const sc = SCENARIO_LABEL[v.scenario] ?? '';
      if (r.badge.textContent !== sc) r.badge.textContent = sc;
      r.scenario.sync(v.scenario);
      if (r.nameIn && document.activeElement !== r.nameIn && r.nameIn.value !== v.name) r.nameIn.value = v.name;
      r.fine.sync(v);
      const text = r.fine.describe(v);
      if (r.desc.textContent !== text) r.desc.textContent = text;
    });
    if (last === null) setFocusedMember(open < 0 ? 0 : open);
    last = n;
  }

  return { el, sync };
}
