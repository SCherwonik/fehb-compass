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

// ---------- showing the explanation (tag-tips.js): fake elements and fake timers ----------
import { createTipController, focusedTagKey, restoreTagFocus, LEAVE_GRACE_MS } from '../src/ui/tag-tips.js';

function fakeCard(code, keys) {
  const els = new Map();
  const doc = { getElementById: (id) => els.get(id) ?? null, focused: null };
  const chips = { contains: (n) => tags.includes(n) };
  const tags = keys.map((key) => {
    const attrs = { id: `tag-${code}-${key}`, 'aria-controls': `tip-${code}-${key}`, 'aria-describedby': `tip-${code}-${key}`, 'aria-expanded': 'false', 'data-key': key };
    const b = {
      getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; },
      hasAttribute: (k) => k in attrs, classList: { contains: (c) => c === 'tag-btn' },
      closest: (sel) => (sel === '.tag-btn' ? b : null), focus: () => { doc.focused = b; },
    };
    b.icon = { closest: (sel) => (sel === '.tag-btn' ? b : null) }; // an svg inside the button
    const tip = { hidden: true, getAttribute: (k) => (k === 'data-tag' ? attrs.id : null), closest: (sel) => (sel === '.tag-tip' ? tip : null) };
    b.tip = tip;
    els.set(attrs.id, b); els.set(attrs['aria-controls'], tip);
    return b;
  });
  return { doc, tags, chips };
}
function setup(keys = ['firm', 'flag-deductible_up']) {
  const card = fakeCard('X1', keys);
  let now = 0; const pending = [];
  const timers = { setTimer: (fn, ms) => { const t = { fn, at: now + ms }; pending.push(t); return t; }, clearTimer: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); } };
  const tick = (ms) => { now += ms; for (const t of pending.filter((x) => x.at <= now)) { pending.splice(pending.indexOf(t), 1); t.fn(); } };
  const c = createTipController({ doc: card.doc, group: () => card.tags, ...timers });
  const shown = () => card.tags.map((b) => [b.getAttribute('aria-expanded') === 'true', !b.tip.hidden]);
  return { ...card, c, tick, shown };
}
// aria-expanded and visibility always agree
const agree = (s) => assert.ok(s.shown().every(([a, v]) => a === v), JSON.stringify(s.shown()));

test('click / keyboard: open, one per card, close again; aria-expanded matches the tip', () => {
  const s = setup(); const [a, b] = s.tags;
  assert.equal(s.c.click(a), true); assert.deepEqual(s.shown(), [[true, true], [false, false]]);
  s.c.click(b, { keyboard: true }); assert.deepEqual(s.shown(), [[false, false], [true, true]]);
  assert.equal(s.c.click(b, { keyboard: true }), false); assert.deepEqual(s.shown(), [[false, false], [false, false]]);
  agree(s);
});

test('(a) Escape closes a keyboard-opened tip and returns focus to its tag; a hover-opened one too, without refocus', () => {
  const s = setup(); const [a, b] = s.tags;
  s.c.click(a, { keyboard: true });
  s.doc.focused = null; // focus moved elsewhere (e.g. read the tip with a screen reader)
  assert.equal(s.c.escape([a]), true);
  assert.equal(a.tip.hidden, true); assert.equal(s.doc.focused, a); agree(s);
  s.c.over(b, 'mouse'); assert.equal(b.tip.hidden, false);
  s.doc.focused = null;
  assert.equal(s.c.escape([b]), true);
  assert.equal(b.tip.hidden, true); assert.equal(s.doc.focused, null); agree(s);
  s.c.over(b.icon, 'mouse'); assert.equal(b.tip.hidden, true, 'Escape keeps hover from reopening until the pointer leaves');
  s.c.out(b, null, 'mouse'); s.c.over(b, 'mouse'); assert.equal(b.tip.hidden, false);
  assert.equal(s.c.escape([]), false);
});

test('(b) hover: the tip stays while the pointer moves from the tag onto the tip, and closes after the grace', () => {
  const s = setup(); const [a] = s.tags;
  s.c.over(a, 'mouse'); assert.equal(a.tip.hidden, false);
  s.c.out(a.icon, a, 'mouse'); assert.equal(a.tip.hidden, false, 'moving inside the tag');
  s.c.out(a, null, 'mouse'); s.tick(LEAVE_GRACE_MS - 50); assert.equal(a.tip.hidden, false, 'within the grace');
  s.c.over(a.tip, 'mouse'); s.tick(1000); assert.equal(a.tip.hidden, false, 'on the tip: stays');
  s.c.out(a.tip, null, 'mouse'); s.tick(LEAVE_GRACE_MS); assert.equal(a.tip.hidden, true, 'left both'); agree(s);
  s.c.over(a, 'touch'); assert.equal(a.tip.hidden, true, 'touch is left to the click');
});

test('(b) crossing another tag on the way to the tip does not switch tips; staying on it does', () => {
  const s = setup(); const [a, b] = s.tags;
  s.c.over(a, 'mouse');
  s.c.out(a, b, 'mouse'); s.c.over(b, 'mouse'); // the pointer passes over b
  assert.deepEqual(s.shown(), [[true, true], [false, false]], 'a stays during the grace, b waits');
  s.c.out(b, a.tip, 'mouse'); s.c.over(a.tip, 'mouse'); s.tick(1000);
  assert.deepEqual(s.shown(), [[true, true], [false, false]], 'reached the tip of a: a stays, b never opened');
  s.c.out(a.tip, b, 'mouse'); s.c.over(b, 'mouse'); s.tick(LEAVE_GRACE_MS);
  assert.deepEqual(s.shown(), [[false, false], [true, true]], 'stayed on b: b opens, a closed');
  agree(s);
});

test('(c) one tip per card across hover and click', () => {
  const s = setup(); const [a, b] = s.tags;
  s.c.click(a); s.c.over(b, 'mouse'); assert.deepEqual(s.shown(), [[false, false], [true, true]]);
  s.c.click(a); assert.deepEqual(s.shown(), [[true, true], [false, false]]);
  s.c.out(b, null, 'mouse'); s.tick(LEAVE_GRACE_MS); assert.deepEqual(s.shown(), [[true, true], [false, false]], 'a pinned tip is not closed by a hover timer');
});

test('(d) a click that closes an open tag closes it while the mouse is still on it; hover reopens only after leaving', () => {
  const s = setup(); const [a] = s.tags;
  s.c.over(a, 'mouse'); s.c.click(a); // pins what the hover showed
  assert.equal(a.getAttribute('data-open-by'), 'click'); assert.equal(a.tip.hidden, false);
  assert.equal(s.c.click(a), false); assert.equal(a.tip.hidden, true); agree(s);
  s.c.over(a.icon, 'mouse'); s.c.out(a.icon, a, 'mouse'); s.c.over(a, 'mouse');
  assert.equal(a.tip.hidden, true, 'still on the tag: stays closed'); agree(s);
  s.c.out(a, null, 'mouse'); s.c.over(a, 'mouse'); assert.equal(a.tip.hidden, false, 'left and came back'); agree(s);
});

test('(e) a rebuild keeps focus on the equivalent tag by its key; new tips start closed', () => {
  const s = setup(); const [, b] = s.tags;
  s.c.click(b, { keyboard: true });
  const key = focusedTagKey(s.chips, b);
  assert.equal(key, 'flag-deductible_up');
  assert.equal(focusedTagKey(s.chips, { classList: { contains: () => false } }), null);
  s.c.forget(s.tags);
  const fresh = setup(['vs', 'firm', 'flag-deductible_up']);
  const back = restoreTagFocus(fresh.tags, key);
  assert.equal(back, fresh.tags[2]); assert.equal(fresh.doc.focused, fresh.tags[2]);
  assert.ok(fresh.tags.every((t) => t.tip.hidden && t.getAttribute('aria-expanded') === 'false'));
  assert.equal(restoreTagFocus(fresh.tags, 'gone'), null);
  assert.equal(restoreTagFocus(fresh.tags, null), null);
});
