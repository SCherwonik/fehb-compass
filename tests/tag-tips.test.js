// The card's warning tags say why, from the 2026 and 2027 figures the flag was computed from (engine/diff.js). The tip
// is shown by a disclosure button (keyboard and touch) and is the button's accessible description.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flagTip } from '../src/ui/board-model.js';
import { diffPlan } from '../src/engine/diff.js';

const row = (before, after) => ({ facts2026: before, facts: after, diff: diffPlan(before, after) });

test('premium up 10% or more: both yearly premiums and the change', () => {
  const r = row({ premium: 2000, deductible: 500, oopMax: 6000, coinsurance: 20 }, { premium: 2300, deductible: 500, oopMax: 6000, coinsurance: 20 });
  assert.deepEqual(r.diff.flags, ['premium_up_10']);
  assert.equal(flagTip('premium_up_10', r), 'Your yearly premium goes from $2,000 in 2026 to $2,300 in 2027 (+15%), from OPM’s rate files.');
});

test('out-of-pocket max rose with no premium cut: both maximums and both premiums', () => {
  const r = row({ premium: 2000, deductible: 500, oopMax: 6000, coinsurance: 20 }, { premium: 2000, deductible: 500, oopMax: 7000, coinsurance: 20 });
  assert.deepEqual(r.diff.flags, ['oop_up_no_premium_cut']);
  assert.equal(flagTip('oop_up_no_premium_cut', r),
    'The out-of-pocket max goes from $6,000 in 2026 to $7,000 in 2027, and the yearly premium did not go down ($2,000 in 2026, $2,000 in 2027).');
});

test('deductible and coinsurance up: both years', () => {
  const r = row({ premium: 2000, deductible: 500, oopMax: 6000, coinsurance: 20 }, { premium: 1900, deductible: 750, oopMax: 6000, coinsurance: 25 });
  assert.deepEqual(r.diff.flags, ['deductible_up', 'coinsurance_up']);
  assert.equal(flagTip('deductible_up', r), 'The deductible goes from $500 in 2026 to $750 in 2027.');
  assert.equal(flagTip('coinsurance_up', r), 'Coinsurance goes from 20% in 2026 to 25% in 2027.');
});

test('no tip when a figure is missing or the flag is unknown (never an invented reason)', () => {
  const r = row({ premium: 2000, deductible: 500, oopMax: 6000, coinsurance: 20 }, { premium: 2300, deductible: 500, oopMax: 6000, coinsurance: 20 });
  assert.equal(flagTip('premium_up_10', { ...r, facts2026: null }), null);
  assert.equal(flagTip('something_else', r), null);
  assert.equal(flagTip('deductible_up', { ...r, facts: { ...r.facts, deductible: null } }), null);
});

// ---------- showing the explanation: click / tap / keyboard keeps it open; a mouse hover shows it too ----------
import { toggleTip, hoverTip } from '../src/ui/tag-tips.js';

const fakeTip = () => {
  const cls = new Set();
  return { hidden: true, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) } };
};
const fakeBtn = (id) => {
  const attrs = { 'aria-controls': id, 'aria-expanded': 'false' };
  const btn = {
    getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; },
    closest: (sel) => (sel === '.tag-btn' ? btn : null), contains: (n) => n === btn || n === btn.child,
  };
  btn.child = { closest: (sel) => (sel === '.tag-btn' ? btn : null) };
  return btn;
};
const page = () => {
  const tips = { a: fakeTip(), b: fakeTip() };
  return { tips, doc: { getElementById: (id) => tips[id] ?? null }, a: fakeBtn('a'), b: fakeBtn('b') };
};

test('toggleTip: opens one tip, closes the others, closes it again', () => {
  const { tips, doc, a, b } = page();
  assert.equal(toggleTip([a, b], a, doc), true);
  assert.equal(a.getAttribute('aria-expanded'), 'true');
  assert.equal(tips.a.hidden, false);
  assert.equal(tips.b.hidden, true);
  toggleTip([a, b], b, doc);
  assert.equal(tips.a.hidden, true);
  assert.equal(a.getAttribute('aria-expanded'), 'false');
  assert.equal(tips.b.hidden, false);
  assert.equal(toggleTip([a, b], b, doc), false);
  assert.equal(tips.b.hidden, true);
});

test('hoverTip: a mouse over the tag shows its tip, leaving hides it; moving inside the tag or touch does nothing', () => {
  const { tips, doc, a } = page();
  assert.equal(hoverTip({ pointerType: 'mouse', target: a.child }, true, doc), true);
  assert.equal(tips.a.classList.contains('is-hover'), true);
  assert.equal(hoverTip({ pointerType: 'mouse', target: a.child, relatedTarget: a }, false, doc), false);
  assert.equal(tips.a.classList.contains('is-hover'), true);
  hoverTip({ pointerType: 'mouse', target: a, relatedTarget: null }, false, doc);
  assert.equal(tips.a.classList.contains('is-hover'), false);
  assert.equal(hoverTip({ pointerType: 'touch', target: a }, true, doc), false);
  assert.equal(tips.a.classList.contains('is-hover'), false);
  assert.equal(hoverTip({ pointerType: 'mouse', target: { closest: () => null } }, true, doc), false);
});
