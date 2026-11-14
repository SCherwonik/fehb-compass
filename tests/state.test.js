import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATE, defaultState, encodeState, decodeState, createStore, safeStorage, loadInitialState, STORAGE_KEY,
} from '../src/state.js';
import { statesFromServiceArea, plansForYear, networkFamilies } from '../src/data.js';

const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); },
};

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

const FULL = {
  status: 'retiree',
  enrollment: 'family',
  location: { state: 'VA', zip: '22030' },
  account: 'hsa',
  networks: ['Aetna', 'Blue Cross', 'Kaiser Permanente'],
  currentPlan2026: '2X1',
  scenario: 'worst',
  overrides: { hospitalStays: 4, erVisits: 3 },
  droppedCustom: 0,
  custom: [{ label: 'Physio', kind: 'therapy', price: 120, perYear: 12 }, { label: 'Insulin', kind: 'rx_brand', price: 300, perYear: 12, tier: 3, outOfNetwork: true }],
  dental: true,
  selectedPlans: ['104', '224', '8W4'],
  view: 'board',
  group: 'carrier',
  includeMine: false,
  glp1: true,
};

test('decodeState("#garbage") returns defaults', () => {
  assert.deepEqual(decodeState('#garbage'), defaultState());
});

test('decodeState handles empty, null and non-string input', () => {
  assert.deepEqual(decodeState(''), defaultState());
  assert.deepEqual(decodeState('#'), defaultState());
  assert.deepEqual(decodeState(null), defaultState());
  assert.deepEqual(decodeState(undefined), defaultState());
  assert.deepEqual(decodeState(42), defaultState());
  assert.deepEqual(decodeState('#%E0%A4%A'), defaultState()); // malformed percent-encoding
});

test('encode/decode round-trips a fully populated state', () => {
  const hash = encodeState(FULL);
  assert.equal(typeof hash, 'string');
  assert.deepEqual(decodeState(hash), FULL);
  assert.deepEqual(decodeState('#' + hash.replace(/^#/, '')), FULL);
});

test('encode/decode round-trips defaults to an empty hash', () => {
  assert.equal(encodeState(defaultState()), '');
  assert.deepEqual(decodeState(encodeState(defaultState())), defaultState());
});

test('network names with reserved characters survive the round trip', () => {
  const s = { ...defaultState(), networks: ['Baylor Scott & White', "Calvo's SelectCare", 'a,b~c=d#e'] };
  assert.deepEqual(decodeState(encodeState(s)).networks, s.networks);
});

test('unknown or malformed values fall back to defaults field by field', () => {
  const d = decodeState('#s=x&e=f&st=Virginia&z=123&a=zzz&sc=worst&c=<script>&d=yes&p=104,!!,224&cu=%7Bbad');
  assert.equal(d.status, DEFAULT_STATE.status); // bad
  assert.equal(d.enrollment, 'family'); // good
  assert.equal(d.location.state, null); // bad
  assert.equal(d.location.zip, null); // bad
  assert.equal(d.account, 'any'); // bad
  assert.equal(d.scenario, DEFAULT_STATE.scenario); // long form not accepted
  assert.equal(d.currentPlan2026, null);
  assert.equal(d.dental, false);
  assert.deepEqual(d.selectedPlans, ['104', '224']); // bad entry dropped
  assert.deepEqual(d.custom, []);
});

test('unknown keys are ignored', () => {
  assert.deepEqual(decodeState('#foo=bar&__proto__=1&constructor=2'), defaultState());
});

test('defaultState returns a fresh copy each time', () => {
  const a = defaultState();
  a.networks.push('x');
  a.location.state = 'VA';
  assert.deepEqual(defaultState().networks, []);
  assert.equal(defaultState().location.state, null);
});

test('safeStorage does not throw when storage is unavailable', () => {
  const s = safeStorage(throwingStorage);
  assert.equal(s.get('k'), null);
  assert.equal(s.set('k', 'v'), false);
  assert.equal(s.remove('k'), false);
  const none = safeStorage(null);
  assert.equal(none.get('k'), null);
  assert.equal(none.set('k', 'v'), false);
});

test('safeStorage survives a globalThis.localStorage getter that throws', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    const s = safeStorage();
    assert.equal(s.get('k'), null);
    assert.equal(s.set('k', 'v'), false);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
});

test('store set/subscribe works and persistence failure does not throw', () => {
  const store = createStore(defaultState(), { storage: throwingStorage });
  const seen = [];
  const off = store.subscribe((s, prev) => seen.push([s.scenario, prev.scenario]));
  store.set({ scenario: 'condition' });
  assert.equal(store.get().scenario, 'condition');
  store.set({ location: { state: 'MD' } });
  assert.equal(store.get().location.state, 'MD');
  assert.equal(store.get().location.zip, null, 'nested location patch merges');
  off();
  store.set({ scenario: 'healthy' });
  assert.deepEqual(seen, [['condition', 'typical'], ['condition', 'condition']]);
});

test('store sanitizes patches through the same validation as decode', () => {
  const store = createStore(defaultState(), { storage: null });
  store.set({ status: 'nonsense', enrollment: 'self_plus_one', networks: 'notarray' });
  assert.equal(store.get().status, DEFAULT_STATE.status);
  assert.equal(store.get().enrollment, 'self_plus_one');
  assert.deepEqual(store.get().networks, []);
});

test('store persists to working storage and loadInitialState prefers hash, then storage', () => {
  const mem = memoryStorage();
  const store = createStore(defaultState(), { storage: mem });
  store.set({ enrollment: 'family', location: { state: 'TX' } });
  assert.ok(mem._m.get(STORAGE_KEY));
  assert.equal(loadInitialState({ hash: '', storage: mem }).location.state, 'TX');
  assert.equal(loadInitialState({ hash: '#st=CA', storage: mem }).location.state, 'CA');
  assert.deepEqual(loadInitialState({ hash: '', storage: throwingStorage }), defaultState());
  mem.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(loadInitialState({ hash: '', storage: mem }), defaultState());
});

test('data helpers derive dropdown contents', () => {
  const sa = {
    A: { nationwide: true, states: [], statewide: [], counties: [], zips: [] },
    B: { nationwide: false, states: ['VA', 'MD'], statewide: [], counties: [], zips: [] },
    C: { nationwide: false, states: ['DC', 'VA'], statewide: [], counties: [], zips: [] },
  };
  assert.deepEqual(statesFromServiceArea(sa), ['DC', 'MD', 'VA']);
  const plans = [
    { code: '1', year: 2026, network_family: 'Aetna', name: 'x' },
    { code: '2', year: 2027, network_family: 'Aetna', name: 'y' },
    { code: '3', year: 2027, network_family: 'Kaiser', name: 'z' },
    { code: '4', year: 2027, network_family: 'Aetna', name: 'w' },
  ];
  assert.deepEqual(plansForYear(plans, 2026).map((p) => p.code), ['1']);
  assert.deepEqual(networkFamilies(plans, 2027), [{ name: 'Aetna', count: 2 }, { name: 'Kaiser', count: 1 }]);
});

test('view and group default to cards / top3 and are omitted from the hash', () => {
  const d = defaultState();
  assert.equal(d.view, 'cards');
  assert.equal(d.group, 'top3');
  assert.equal(encodeState(d), '');
});

test('every view and group value round-trips through the hash', () => {
  for (const view of ['cards', 'board']) {
    for (const group of ['top3', 'carrier', 'type', 'account', 'all']) {
      const s = { ...defaultState(), view, group };
      const back = decodeState(encodeState(s));
      assert.equal(back.view, view);
      assert.equal(back.group, group);
    }
  }
});

test('bad view or group values fall back to defaults', () => {
  const d = decodeState('#v=zz&g=__proto__');
  assert.equal(d.view, 'cards');
  assert.equal(d.group, 'top3');
  const d2 = decodeState('#v=board&g=carrier'); // long forms are not hash tokens
  assert.equal(d2.view, 'cards');
  assert.equal(d2.group, 'top3');
  const store = createStore(defaultState(), { storage: null });
  store.set({ view: 'grid', group: 'everything' });
  assert.equal(store.get().view, 'cards');
  assert.equal(store.get().group, 'top3');
  store.set({ view: 'board', group: 'all' });
  assert.equal(store.get().view, 'board');
  assert.equal(store.get().group, 'all');
});

test('includeMine defaults to true, only "off" is written to the hash, and junk falls back to true', () => {
  assert.equal(defaultState().includeMine, true);
  assert.equal(encodeState(defaultState()), '');
  const off = { ...defaultState(), currentPlan2026: '401', includeMine: false };
  assert.match(encodeState(off), /(^|&)m=0(&|$)/);
  assert.equal(decodeState(encodeState(off)).includeMine, false);
  assert.equal(decodeState('#m=1').includeMine, true);
  assert.equal(decodeState('#m=false').includeMine, true);
  const store = createStore(defaultState(), { storage: null });
  store.set({ includeMine: 'no' });
  assert.equal(store.get().includeMine, true);
  store.set({ includeMine: false });
  assert.equal(store.get().includeMine, false);
});
