// "Your own costs": an inline list editor for up to 25 custom cost lines, plus worst-case preset chips.
// Lines are committed to the store as soon as they are valid (text fields debounced); an invalid field shows
// a message and keeps the last valid value in the state.
import { h, svg, ICON_CHEVRON } from './dom.js';
import {
  CUSTOM_KINDS, CUSTOM_PRESETS, MAX_CUSTOM_LINES, MAX_LINE_PRICE, MAX_PER_YEAR, MAX_LABEL, RX_TIERS,
  sanitizeLine, lineSpend,
} from '../engine/scenarios.js';
import { encodeHash, memberCount } from '../state.js';
import { memberLabel, memberOptions, memberKey, focusedMember } from './members-model.js';
import { customSummary, droppedText } from './assumptions.js';
import { reduceMotion, EASE_OUT, tweenNumber } from './motion.js';

const ICON_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2v9.6M3.2 8h9.6"/></svg>';
const ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"/></svg>';
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const TIER_TEXT = {
  0: 'Tier 0 (preventive)', 1: 'Tier 1 (generic)', 2: 'Tier 2 (preferred brand)', 3: 'Tier 3 (non-preferred)',
  4: 'Tier 4 (specialty)', 5: 'Tier 5 (specialty)', 6: 'Tier 6',
};

let uid = 0;

/**
 * createCustomLines({ store }) -> { el, sync(state) }
 */
export function createCustomLines({ store }) {
  const list = h('ol', { class: 'cl-list', 'aria-label': 'Your own costs' });
  const summary = h('span', { class: 'cl-summary num' });
  const countLive = h('span', { class: 'sr-only', 'aria-live': 'polite' }); // announces add/remove only, not keystrokes
  const droppedMsg = h('span', { class: 'cl-dropped-text' });
  const droppedBtn = h('button', { type: 'button', class: 'btn btn-quiet cl-dropped-dismiss' }, 'Dismiss');
  const dropped = h('div', { class: 'cl-dropped', role: 'status', hidden: true }, droppedMsg, droppedBtn);
  droppedBtn.addEventListener('click', () => store.set({ droppedCustom: 0 }));
  const addBtn = h('button', { type: 'button', class: 'btn btn-quiet cl-add' }, svg(ICON_PLUS), 'Add a cost');
  const presetMsg = h('p', { class: 'field-hint cl-msg', role: 'status' });
  const overflowNote = h('p', { class: 'field-hint cl-overflow', hidden: true });
  const presets = h('div', { class: 'cl-presets', role: 'group', 'aria-label': 'Add a worst-case bundle' },
    CUSTOM_PRESETS.map((p) => h('button', {
      type: 'button', class: 'cl-preset', 'data-preset': p.id, title: p.description,
    }, svg(ICON_PLUS), p.label)));

  // descriptions travel in the page link and share links (unlike the medications list): say so where they are typed
  const privacyHint = h('p', { class: 'field-hint cl-privacy', id: 'cl-label-privacy', hidden: true },
    'Descriptions are saved in the page link and in links you share, so keep them general. Your medications list is never put in a link.');
  const el = h('fieldset', { class: 'field cl' },
    h('legend', { class: 'field-label' }, 'Your own costs'),
    h('p', { class: 'field-hint field-hint-top' },
      'Add visits, tests, prescriptions or out-of-network care at your own prices. They stack on top of the year above.'),
    dropped,
    presets,
    presetMsg,
    list,
    privacyHint,
    h('div', { class: 'cl-foot' }, addBtn, h('span', { class: 'cl-meta' }, summary, countLive)),
    overflowNote);

  /** rows: [{ id, el, line (last valid), fields }] in display order */
  let rows = [];
  let committed = '[]';
  // who is covered: a "For" selector shows only with more than one person (state.enrollment), lines for a person
  // beyond the count are shown dimmed and left out of the footer total
  let people = { count: 1, key: '' };
  const memberOf = (l) => (Number.isInteger(l?.member) && l.member > 0 ? l.member : 0);
  const covered = (l) => memberOf(l) < people.count;

  const lines = () => rows.map((r) => r.line);
  function commit() {
    const next = lines();
    committed = JSON.stringify(next);
    paintMeta();
    store.set({ custom: next });
  }
  let timer = 0;
  const commitSoon = () => { clearTimeout(timer); timer = setTimeout(commit, 260); };

  // ---------- one row ----------
  function makeRow(line) {
    const id = `cl-${++uid}`;
    const kindSel = h('select', { class: 'select cl-kind', id: `${id}-kind`, 'aria-label': 'Kind of cost' },
      Object.entries(CUSTOM_KINDS).map(([k, m]) => h('option', { value: k }, m.label)));
    const label = h('input', {
      type: 'text', class: 'cl-input cl-label', id: `${id}-label`, maxlength: String(MAX_LABEL), autocomplete: 'off',
      'aria-label': 'Description (optional)', 'aria-describedby': 'cl-label-privacy',
    });
    const price = h('input', {
      type: 'number', class: 'cl-input cl-num', id: `${id}-price`, min: '0', max: String(MAX_LINE_PRICE), step: '1',
      inputmode: 'decimal', 'aria-describedby': `${id}-err`,
    });
    const per = h('input', {
      type: 'number', class: 'cl-input cl-num', id: `${id}-per`, min: '0', max: String(MAX_PER_YEAR), step: '1',
      inputmode: 'numeric', 'aria-describedby': `${id}-err`,
    });
    const tier = h('select', { class: 'select cl-tier', id: `${id}-tier` },
      h('option', { value: '' }, 'No tier: pay my price'),
      RX_TIERS.map((t) => h('option', { value: String(t) }, TIER_TEXT[t])));
    const tierField = h('div', { class: 'cl-cell cl-cell-tier' },
      h('label', { class: 'cl-cap', for: `${id}-tier` }, 'Drug tier'),
      h('div', { class: 'select-wrap' }, tier, svg(ICON_CHEVRON)));
    const oon = h('input', { type: 'checkbox', class: 'cl-oon-input', id: `${id}-oon` });
    const memberSel = h('select', { class: 'select cl-member', id: `${id}-for` });
    const forField = h('div', { class: 'cl-cell cl-for', hidden: true },
      h('label', { class: 'cl-cap', for: `${id}-for` }, 'For'),
      h('div', { class: 'select-wrap' }, memberSel, svg(ICON_CHEVRON)));
    const uncovered = h('p', { class: 'cl-uncovered', hidden: true }, 'Not covered at this enrollment');
    const del = h('button', { type: 'button', class: 'cl-del', 'aria-label': 'Remove this cost' }, svg(ICON_X));
    const spend = h('span', { class: 'cl-spend num' });
    const err = h('p', { class: 'cl-err', id: `${id}-err`, role: 'alert' });
    const hint = h('p', { class: 'cl-hint' });

    const rowEl = h('li', { class: 'cl-row', 'data-id': id },
      h('div', { class: 'cl-top' },
        h('div', { class: 'select-wrap cl-kind-wrap' }, kindSel, svg(ICON_CHEVRON)),
        del),
      label,
      forField,
      uncovered,
      h('div', { class: 'cl-grid' },
        h('div', { class: 'cl-cell' },
          h('label', { class: 'cl-cap', for: `${id}-price` }, 'Price each'),
          h('div', { class: 'cl-affix' }, h('span', { class: 'cl-pre', 'aria-hidden': 'true' }, '$'), price)),
        h('div', { class: 'cl-cell' },
          h('label', { class: 'cl-cap', for: `${id}-per` }, 'Times a year'),
          per),
        tierField),
      h('div', { class: 'cl-bottom' },
        h('label', { class: 'cl-oon', for: `${id}-oon` }, oon, h('span', {}, 'Out of network')),
        h('span', { class: 'cl-spend-wrap' }, spend, h('span', { class: 'cl-spend-unit' }, ' a year before your plan pays'))),
      hint,
      err);
    const row = { id, el: rowEl, line, fields: { memberSel, forField, uncovered, kindSel, label, price, per, tier, tierField, oon, del, spend, err, hint } };
    fill(row);
    return row;
  }

  function fill(row) {
    const { line } = row;
    const f = row.fields;
    const meta = CUSTOM_KINDS[line.kind];
    f.kindSel.value = line.kind;
    f.label.value = line.label;
    f.label.placeholder = meta.label;
    f.price.value = String(line.price);
    f.per.value = String(line.perYear);
    f.tier.value = Number.isInteger(line.tier) ? String(line.tier) : '';
    f.tierField.hidden = !meta.rx;
    f.oon.checked = line.outOfNetwork === true;
    paintMember(row);
    paintRow(row, false);
  }

  /** The "For" selector and the dimmed look for a line whose person is not on this enrollment. */
  function paintMember(row) {
    const f = row.fields;
    const m = memberOf(row.line);
    const state = store.get();
    f.forField.hidden = people.count <= 1;
    const opts = memberOptions(state);
    if (m >= people.count) opts.push([String(m), `${memberLabel(state, m)} (not covered)`]);
    f.memberSel.replaceChildren(...opts.map(([v, t]) => h('option', { value: v }, t)));
    f.memberSel.value = String(m);
    const off = people.count > 1 && m >= people.count;
    f.uncovered.hidden = !off;
    row.el.classList.toggle('is-uncovered', off);
  }

  function paintRow(row, animate = true) {
    const { line } = row;
    const f = row.fields;
    const meta = CUSTOM_KINDS[line.kind];
    tweenNumber(f.spend, lineSpend(line), money, { animate });
    const name = (line.label || meta.label).trim();
    f.del.setAttribute('aria-label', `Remove ${name}`);
    row.el.setAttribute('aria-label', name);
    let hint;
    if (line.outOfNetwork) hint = 'Out-of-network estimate: counted at full cost, up to the plan’s out-of-network limit when it lists one.';
    else if (meta.rx && !Number.isInteger(line.tier)) hint = 'Without a tier this counts at the full price you enter. Pick the tier from the plan’s formulary to apply its copay.';
    else if (meta.rx) hint = `Priced with each plan’s ${TIER_TEXT[line.tier].toLowerCase()} copay or coinsurance.`;
    else if (meta.maternity) {
      hint = 'One pregnancy (prenatal care, delivery, postpartum care and the hospital stay for the birth), priced with each plan’s '
        + 'own maternity terms from its 2027 brochure. Where a brochure leaves out a count or share (days, visits, hospital vs doctors), '
        + 'the amount is estimated from stated assumptions and marked so; where it cannot be totaled at all, that plan says so, and '
        + 'plans are ranked without maternity unless every plan shown has a price. '
        + 'Newborn care is not included.';
    }
    else hint = `Priced with each plan’s ${meta.field.toLowerCase()} benefit.`;
    f.hint.textContent = hint;
    row.el.classList.toggle('is-oon', line.outOfNetwork === true);
  }

  /** Read a row's fields into a line; returns { line, error }. */
  function readRow(row) {
    const f = row.fields;
    const errors = [];
    const priceRaw = f.price.value.trim();
    const perRaw = f.per.value.trim();
    const price = priceRaw === '' ? NaN : Number(priceRaw);
    const per = perRaw === '' ? NaN : Number(perRaw);
    const priceOk = Number.isFinite(price) && price >= 0 && price <= MAX_LINE_PRICE && f.price.validity.valid !== false;
    const perOk = Number.isInteger(per) && per >= 0 && per <= MAX_PER_YEAR;
    if (!priceOk) errors.push(`Enter a price from $0 to ${money(MAX_LINE_PRICE)}.`);
    if (!perOk) errors.push(`Enter a whole number of times a year, 0 to ${MAX_PER_YEAR}.`);
    f.price.setAttribute('aria-invalid', String(!priceOk));
    f.per.setAttribute('aria-invalid', String(!perOk));
    const draft = {
      label: f.label.value,
      kind: f.kindSel.value,
      price: priceOk ? price : row.line.price,
      perYear: perOk ? per : row.line.perYear,
    };
    if (f.tier.value !== '' && CUSTOM_KINDS[draft.kind]?.rx) draft.tier = Number(f.tier.value);
    if (f.oon.checked) draft.outOfNetwork = true;
    if (Number(f.memberSel.value) > 0) draft.member = Number(f.memberSel.value);
    return { line: sanitizeLine(draft), error: errors.join(' ') };
  }

  // ---------- events (delegated) ----------
  function rowOf(target) {
    const li = target.closest('.cl-row');
    return li ? rows.find((r) => r.el === li) : null;
  }
  list.addEventListener('input', (e) => {
    const row = rowOf(e.target);
    if (!row || e.target.tagName === 'SELECT' || e.target.type === 'checkbox') return;
    const { line, error } = readRow(row);
    row.fields.err.textContent = error;
    row.el.classList.toggle('is-invalid', Boolean(error));
    if (line) { row.line = line; paintRow(row); paintMeta(); commitSoon(); }
  });
  list.addEventListener('change', (e) => {
    const row = rowOf(e.target);
    if (!row) return;
    const kindChanged = e.target === row.fields.kindSel;
    if (kindChanged) {
      // switching kind pre-fills that kind's typical price unless the user already typed one of their own
      const prevMeta = CUSTOM_KINDS[row.line.kind];
      const meta = CUSTOM_KINDS[e.target.value];
      if (Number(row.fields.price.value) === prevMeta.price) row.fields.price.value = String(meta.price);
      row.fields.tierField.hidden = !meta.rx;
      row.fields.label.placeholder = meta.label;
      if (meta.rx && row.fields.tier.value === '' && !row.line.kind.startsWith('rx_')) row.fields.tier.value = String(meta.tier);
    }
    const { line, error } = readRow(row);
    row.fields.err.textContent = error;
    row.el.classList.toggle('is-invalid', Boolean(error));
    if (line) {
      row.line = line;
      if (e.target === row.fields.memberSel) paintMember(row);
      paintRow(row);
      clearTimeout(timer);
      commit();
    }
  });
  list.addEventListener('focusout', (e) => {
    // leaving a field: show the committed value again (drops stray characters, keeps invalid text visible)
    const row = rowOf(e.target);
    if (row && e.target === row.fields.label) row.fields.label.value = row.line.label;
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.cl-del');
    if (!btn) return;
    const row = rowOf(btn);
    if (row) removeRow(row);
  });

  function removeRow(row) {
    const i = rows.indexOf(row);
    rows.splice(i, 1);
    clearTimeout(timer);
    commit();
    const focusTo = rows[Math.min(i, rows.length - 1)]?.fields.del ?? addBtn;
    const done = () => { row.el.remove(); };
    if (reduceMotion()) done();
    else {
      const hgt = row.el.offsetHeight;
      row.el.style.overflow = 'hidden';
      row.el.animate([
        { opacity: 1, height: `${hgt}px`, transform: 'none' },
        { opacity: 0, height: '0px', marginTop: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'scale(0.97)' },
      ], { duration: 280, easing: EASE_OUT }).finished.then(done, done);
    }
    focusTo.focus({ preventScroll: true });
    paintMeta();
  }

  function appendRows(newLines, { focus = false } = {}) {
    const room = MAX_CUSTOM_LINES - rows.length;
    // new lines are for the person whose row is open in "Covered people" (you when there is only you)
    const who = people.count > 1 ? focusedMember(store.get()) : 0;
    const take = newLines.slice(0, Math.max(0, room)).map((l) => (who > 0 ? { ...l, member: who } : l));
    const made = take.map((l) => makeRow(l));
    rows.push(...made);
    list.append(...made.map((r) => r.el));
    if (!reduceMotion()) {
      made.forEach((r, i) => r.el.animate(
        [{ opacity: 0, transform: 'translateY(8px) scale(0.98)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
        { duration: 360, delay: i * 50, easing: EASE_OUT, fill: 'backwards' },
      ));
    }
    clearTimeout(timer);
    commit();
    if (focus && made[0]) made[0].fields.kindSel.focus();
    paintMeta();
    return take.length;
  }

  addBtn.addEventListener('click', () => {
    if (rows.length >= MAX_CUSTOM_LINES) return;
    appendRows([{ label: '', kind: 'specialist', price: CUSTOM_KINDS.specialist.price, perYear: 1 }], { focus: true });
  });
  presets.addEventListener('click', (e) => {
    const btn = e.target.closest('.cl-preset');
    if (!btn) return;
    const p = CUSTOM_PRESETS.find((x) => x.id === btn.dataset.preset);
    if (!p) return;
    const added = appendRows(p.lines);
    presetMsg.textContent = added === p.lines.length
      ? `Added ${p.label.toLowerCase()}: ${p.lines.length} ${p.lines.length === 1 ? 'line' : 'lines'}.`
      : added === 0 ? `No room: the list holds ${MAX_CUSTOM_LINES} lines.` : `Added ${added} of ${p.lines.length} lines: the list holds ${MAX_CUSTOM_LINES}.`;
  });

  // Footer total: recomputed from the rows' current valid values on every edit, add, remove and sync.
  function paintMeta() {
    const n = rows.length;
    summary.textContent = customSummary(lines().filter(covered));
    const live = `${n} of ${MAX_CUSTOM_LINES} lines`;
    if (countLive.textContent !== live) countLive.textContent = live;
    addBtn.disabled = n >= MAX_CUSTOM_LINES;
    for (const b of presets.querySelectorAll('button')) b.disabled = n >= MAX_CUSTOM_LINES;
    list.hidden = n === 0;
    privacyHint.hidden = n === 0;
  }

  paintMeta();

  return {
    el,
    sync(state) {
      const next = { count: memberCount(state), key: memberKey(state) };
      const peopleChanged = next.count !== people.count || next.key !== people.key;
      people = next;
      const json = JSON.stringify(state.custom);
      if (peopleChanged && json === committed) {
        for (const r of rows) paintMember(r);
        paintMeta();
      }
      if (json !== committed) {
        // changed elsewhere (link, back button, another control): rebuild without animation
        committed = json;
        rows = state.custom.map((l) => makeRow(l));
        list.replaceChildren(...rows.map((r) => r.el));
        paintMeta();
      }
      dropped.hidden = !(state.droppedCustom > 0);
      if (state.droppedCustom > 0) droppedMsg.textContent = droppedText(state.droppedCustom);
      const res = encodeHash(state);
      overflowNote.hidden = res.overflow.length === 0;
      if (res.overflow.length) {
        overflowNote.textContent = `Your link holds the first ${res.inline} ${res.inline === 1 ? 'line' : 'lines'}; `
          + `the other ${res.overflow.length} are saved in this browser only, so a shared link will not include them.`;
      }
    },
  };
}
