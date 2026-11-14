import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, encodeState, encodeHash, decodeState, sanitizeState, saveOverflow, loadInitialState,
  HASH_BUDGET, OVERFLOW_KEY, createStore,
} from '../src/state.js';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

const L = (kind, price, perYear, extra = {}) => ({ label: `${kind} line`, kind, price, perYear, ...extra });

test('custom lines and overrides round-trip through a compact hash (no JSON)', () => {
  const s = {
    ...defaultState(),
    scenario: 'nothing',
    overrides: { hospitalStays: 3, erVisits: 2, rxMonthly: 1 },
    custom: [
      L('pcp', 150, 4),
      L('rx_brand', 412.5, 12, { tier: 2 }),
      L('specialist', 300, 2, { outOfNetwork: true }),
      { label: 'Physio_* & co ~ 100% "fun"', kind: 'therapy', price: 120, perYear: 12 },
      { label: '', kind: 'other', price: 0, perYear: 0 },
    ],
  };
  const hash = encodeState(s);
  assert.ok(!/%5B|%7B/.test(hash) && !/cu=/.test(hash), `no JSON in ${hash}`);
  assert.match(hash, /sc=n/);
  const d = decodeState(hash);
  assert.deepEqual(d.custom, s.custom);
  assert.deepEqual(d.overrides, s.overrides);
  assert.equal(d.scenario, 'nothing');
});

test('defaults: no overrides, no custom lines, empty hash', () => {
  assert.deepEqual(defaultState().overrides, {});
  assert.equal(encodeState(defaultState()), '');
});

test('hostile custom input is sanitized: __proto__, huge numbers, NaN strings, HTML labels', () => {
  const hostile = JSON.parse(`{
    "custom": [
      {"__proto__": {"polluted": true}, "kind": "pcp", "label": "<b>Dr</b> visit", "price": 1e300, "perYear": 1e9},
      {"kind": "constructor", "price": 1, "perYear": 1},
      {"kind": "lab", "price": "NaN", "perYear": 1},
      {"kind": "lab", "price": 10, "perYear": "Infinity"},
      "string", null, [1,2],
      {"kind": "rx_generic", "price": 9, "perYear": 12, "tier": "<script>"}
    ],
    "overrides": {"__proto__": {"hospitalStays": 4}, "erVisits": 1e9, "toString": 3}
  }`);
  const s = sanitizeState(hostile);
  assert.deepEqual(s.custom, [
    { label: 'bDr/b visit', kind: 'pcp', price: 1e6, perYear: 365 },
    { label: '', kind: 'rx_generic', price: 9, perYear: 12 },
  ]);
  assert.deepEqual(s.overrides, { erVisits: 10 });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(s.overrides), Object.prototype);
});

test('garbage custom/override params decode safely', () => {
  for (const h of [
    '#cl=zzz', '#cl=p_abc_1__x', '#cl=p_1', '#cl=__proto___1_1__x', '#cl=%E0%A4%A', '#o=h99.e.zz.p-3',
    '#cl=p_1e400_1__x', '#cl=p_NaN_1__x', '#cu=%7Bbad', '#cu=[{"kind":"pcp"}]', '#cx=abc', '#cx=999',
  ]) {
    const d = decodeState(h);
    assert.ok(Array.isArray(d.custom), h);
    assert.ok(d.custom.length <= 25, h);
    for (const l of d.custom) assert.ok(Number.isFinite(l.price) && Number.isFinite(l.perYear), h);
  }
  assert.deepEqual(decodeState('#o=h99.e.zz.p-3.s4').overrides, { hospitalStays: 6, specialistVisits: 4 });
});

test('legacy JSON "cu" param still decodes valid lines', () => {
  const cu = encodeURIComponent(JSON.stringify([L('er', 2200, 1), { kind: 'specialistVisits', count: 4 }]));
  assert.deepEqual(decodeState(`#cu=${cu}`).custom, [L('er', 2200, 1)]);
});

test('26 lines: the store keeps 25', () => {
  const store = createStore(defaultState(), { storage: null });
  store.set({ custom: Array.from({ length: 26 }, (_, i) => L('lab', i + 1, 1)) });
  assert.equal(store.get().custom.length, 25);
});

// ---------- URL budget and localStorage overflow ----------

const BIG = Array.from({ length: 25 }, (_, i) => ({
  label: `Ω visit #${i} “quoted” & <weird> ${'é'.repeat(30)}`.slice(0, 60),
  kind: 'specialist', price: 123456.78, perYear: 365, outOfNetwork: true,
}));

test('a long custom list keeps the hash under budget and spills the rest', () => {
  const s = { ...defaultState(), custom: BIG };
  const res = encodeHash(s);
  assert.ok(res.hash.length <= HASH_BUDGET, `hash is ${res.hash.length}`);
  assert.ok(res.overflow.length > 0 && res.inline > 0);
  assert.equal(res.inline + res.overflow.length, 25);
  assert.match(res.hash, new RegExp(`cx=${res.overflow.length}`));
  assert.equal(encodeState(s), res.hash);
  // without the overflow store: only the inline lines, and the decode says how many are missing
  const bare = decodeState(res.hash);
  assert.equal(bare.custom.length, res.inline);
});

test('overflow lines come back from storage on the same browser, never from a mismatched save', () => {
  const storage = memoryStorage();
  const s = { ...defaultState(), custom: BIG };
  const res = encodeHash(s);
  assert.equal(saveOverflow(res, storage), true);
  assert.ok(storage._m.has(OVERFLOW_KEY));
  assert.deepEqual(decodeState(res.hash, { storage }).custom, sanitizeState(s).custom);
  assert.deepEqual(loadInitialState({ hash: res.hash, storage }).custom, sanitizeState(s).custom);
  // a different link with the same cx count does not pick up these lines
  const other = encodeHash({ ...defaultState(), custom: BIG.map((l) => ({ ...l, price: 1 })) });
  assert.equal(decodeState(other.hash, { storage }).custom.length, other.inline);
  // short list: overflow record is cleared
  saveOverflow(encodeHash(defaultState()), storage);
  assert.ok(!storage._m.has(OVERFLOW_KEY));
  // tampered storage is ignored
  storage.setItem(OVERFLOW_KEY, '{"sig":1,"lines":"x"}');
  assert.equal(decodeState(res.hash, { storage }).custom.length, res.inline);
  storage.setItem(OVERFLOW_KEY, 'not json');
  assert.equal(decodeState(res.hash, { storage }).custom.length, res.inline);
});

test('a short list stays fully in the hash', () => {
  const res = encodeHash({ ...defaultState(), custom: [L('pcp', 150, 4), L('er', 2200, 1)] });
  assert.equal(res.overflow.length, 0);
  assert.equal(res.inline, 2);
  assert.ok(!/cx=/.test(res.hash));
});

// ---------- review fixes ----------

test('a link whose overflow is not in this browser reports how many lines were left out', () => {
  const lines = [L('pcp', 150, 4), L('er', 2200, 1)];
  const hash = `${encodeState({ ...defaultState(), custom: lines })}&cx=2`;
  const d = decodeState(hash);
  assert.equal(d.droppedCustom, 2);
  assert.deepEqual(d.custom, lines);
  // same browser with the overflow saved: nothing dropped
  const storage = memoryStorage();
  const big = { ...defaultState(), custom: BIG };
  const res = encodeHash(big);
  saveOverflow(res, storage);
  assert.equal(decodeState(res.hash, { storage }).droppedCustom, 0);
  assert.equal(decodeState(res.hash, { storage: memoryStorage() }).droppedCustom, res.overflow.length);
  assert.equal(decodeState(res.hash).droppedCustom, res.overflow.length);
  // never more than the list could hold, never from garbage
  assert.equal(decodeState('#cx=999').droppedCustom, 25);
  assert.equal(decodeState('#cx=abc').droppedCustom, 0);
  assert.equal(decodeState('#cx=-3').droppedCustom, 0);
});

test('droppedCustom is a notice, not part of the link: defaults to 0, never encoded, sanitized', () => {
  assert.equal(defaultState().droppedCustom, 0);
  assert.equal(encodeState({ ...defaultState(), droppedCustom: 3 }), '');
  assert.equal(sanitizeState({ droppedCustom: 3 }).droppedCustom, 3);
  for (const bad of [-1, 2.5, '3', NaN, 1e9, null]) assert.ok([0, 25].includes(sanitizeState({ droppedCustom: bad }).droppedCustom), String(bad));
  // round trip of a fully populated state is unchanged
  const s = { ...defaultState(), scenario: 'worst', overrides: { hospitalStays: 4 }, custom: [L('pcp', 150, 4), L('rx_brand', 30, 12, { tier: 2, outOfNetwork: true })] };
  assert.deepEqual(decodeState(encodeState(s)), s);
});

test('compact line encoding: one short key, kind+price and count+flags fused, older cl= links still decode', () => {
  const s = { ...defaultState(), custom: [L('pcp', 150, 4), L('rx_brand', 412.5, 12, { tier: 2, outOfNetwork: true })] };
  const hash = encodeState(s);
  assert.match(hash, /(^|&)l=p150_4_pcp\+line(&|$)/);
  assert.match(hash, /(^|&)l=b412\.5_12ot2_rx_brand\+line(&|$)/);
  assert.ok(!/cl=/.test(hash));
  assert.deepEqual(decodeState('#cl=e_2200_1__ER+visit&cl=b_400_12_ot2_Pill').custom, [
    { label: 'ER visit', kind: 'er', price: 2200, perYear: 1 },
    { label: 'Pill', kind: 'rx_brand', price: 400, perYear: 12, tier: 2, outOfNetwork: true },
  ]);
  for (const bad of ['#l=q150_1_x', '#l=p_1_x', '#l=p1e9_1_x', '#l=p150_1x_x', '#l=p150', '#l=p150_1']) {
    assert.deepEqual(decodeState(bad).custom, [], bad);
  }
});

test('overrides equal to the active scenario are pruned, so they cannot resurface on a scenario change', () => {
  const s = sanitizeState({ scenario: 'condition', overrides: { erVisits: 1, hospitalStays: 3 } });
  assert.deepEqual(s.overrides, { hospitalStays: 3 }); // condition already has 1 ER visit
  const store = createStore({ ...defaultState(), overrides: { erVisits: 1 } }, { storage: null });
  store.set({ scenario: 'condition' });
  assert.deepEqual(store.get().overrides, {});
  store.set({ scenario: 'typical' });
  assert.deepEqual(store.get().overrides, {}, 'the stale ER override does not come back');
  assert.ok(!/o=/.test(encodeState(store.get())));
});
