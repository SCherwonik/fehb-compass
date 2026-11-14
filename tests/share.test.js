// Share link: what "Copy link" puts on the clipboard, and the privacy invariant that "My medications"
// (drug names, monthly costs, the tiers recorded per plan) never reaches the URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shareLink } from '../src/share.js';
import { defaultState, decodeState, encodeState, sanitizeState, createStore } from '../src/state.js';
import { createMedsStore, MEDS_KEY } from '../src/ui/meds-store.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('dvGroup (dental board "Show") defaults to top3, round-trips, and junk falls back', () => {
  assert.equal(defaultState().dvGroup, 'top3');
  assert.equal(encodeState(defaultState()), '');
  for (const g of ['top3', 'carrier', 'all']) {
    const s = { ...defaultState(), dvGroup: g };
    assert.equal(decodeState(encodeState(s)).dvGroup, g);
  }
  assert.match(encodeState({ ...defaultState(), dvGroup: 'carrier' }), /(^|&)dg=c(&|$)/);
  assert.equal(decodeState('#dg=zz').dvGroup, 'top3');
  assert.equal(decodeState('#dg=carrier').dvGroup, 'top3'); // long forms are not hash tokens
  assert.equal(sanitizeState({ dvGroup: '__proto__' }).dvGroup, 'top3');
  assert.equal(sanitizeState({ dvGroup: 'type' }).dvGroup, 'top3'); // a medical-only mode
});

test('shareLink: page URL without its old hash plus the encoded state', () => {
  const s = { ...defaultState(), location: { state: 'VA', zip: null }, scenario: 'worst', tab: 'dental', dentalUse: 'major', dvGroup: 'all' };
  const r = shareLink('https://example.github.io/fehb-compass/index.html?x=1#old=1', s);
  assert.equal(r.url.split('#')[0], 'https://example.github.io/fehb-compass/index.html?x=1');
  const back = decodeState(r.url.slice(r.url.indexOf('#')));
  assert.equal(back.location.state, 'VA');
  assert.equal(back.scenario, 'worst');
  assert.equal(back.tab, 'dental');
  assert.equal(back.dentalUse, 'major');
  assert.equal(back.dvGroup, 'all');
  assert.equal(r.leftOut, 0);
});

test('shareLink: the default state shares the bare page URL', () => {
  assert.equal(shareLink('http://localhost:8000/#st=VA', defaultState()).url, 'http://localhost:8000/');
});

test('shareLink: reports custom lines that do not fit the link', () => {
  const custom = Array.from({ length: 25 }, (_, i) => ({ label: `A long custom line label number ${i} ${'x'.repeat(50)}`, kind: 'other', price: 1000 + i, perYear: 3 }));
  const r = shareLink('http://localhost:8000/', { ...defaultState(), custom });
  assert.ok(r.leftOut > 0);
  assert.ok(r.url.length < 1700);
});

test('PRIVACY: medications and recorded tiers never reach the share link or the hash', () => {
  const storage = memStorage();
  const meds = createMedsStore({ storage });
  meds.add({ name: 'Ozempiczz Secretdrug', monthlyCost: 935, fillsPerYear: 12, channel: 'mail' });
  meds.add({ name: 'Metforminqq', monthlyCost: 4 });
  const [d1] = meds.get().drugs;
  meds.record('104', d1.id, 'Tier 4');
  meds.record('224', d1.id, 'nc');
  const saved = storage.getItem(MEDS_KEY);
  assert.ok(saved && saved.includes('Ozempiczz'), 'the list itself is stored locally');

  // a state with every shareable field set, plus private data smuggled in under likely keys
  const store = createStore({
    ...defaultState(),
    location: { state: 'VA', zip: '22030' }, scenario: 'condition', dental: true, glp1: true,
    selectedPlans: ['104', '224'], view: 'board', group: 'carrier', tab: 'vision', visionUse: 'contacts', dvGroup: 'carrier',
    meds: meds.get(), drugs: meds.get().drugs, records: meds.get().records,
  }, { storage: memStorage() });
  const state = store.get();
  assert.equal('meds' in state || 'drugs' in state || 'records' in state, false, 'sanitizeState drops unknown keys');

  const { url } = shareLink('https://example.github.io/fehb-compass/', state);
  const hay = decodeURIComponent(url).toLowerCase();
  for (const secret of ['ozempiczz', 'secretdrug', 'metforminqq', 'tier 4', d1.id, '935']) {
    assert.equal(hay.includes(secret.toLowerCase()), false, `share link leaks ${secret}`);
  }
  assert.equal(url.includes(MEDS_KEY), false);
});
