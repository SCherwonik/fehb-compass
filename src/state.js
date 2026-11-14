// App state: shape, defaults, validation, URL-hash encoding and a tiny store.
// DOM-free so it imports cleanly under node:test.
//
// State shape
// {
//   status:          'active' | 'retiree'              premium basis (payroll biweekly x26 vs annuity monthly x12)
//   enrollment:      'self' | 'self_plus_one' | 'family'
//   location:        { state: string|null, zip: string|null }   2-letter USPS code; 5-digit ZIP (no UI yet)
//   account:         'any' | 'hsa' | 'hra'               HSA/HRA preference filter
//   networks:        string[]                             network_family names; [] means "all"
//   currentPlan2026: string|null                          2026 enrollment code, e.g. '104'
//   scenario:        'healthy' | 'typical' | 'condition' | 'worst' | 'nothing'   keys of engine SCENARIOS
//   overrides:       { hospitalStays?, erVisits?, specialistVisits?, pcpVisits?, rxMonthly? }   "fine-tune" counts
//                    layered on the scenario (ranges: engine OVERRIDE_FIELDS)
//   custom:          line[] (max 25)                      { label, kind, price, perYear, tier?, outOfNetwork? }
//                    validated by engine/scenarios.js sanitizeLine
//   dental:          boolean                              add FEDVIP dental/vision to totals
//   selectedPlans:   string[]                             2027 enrollment codes pinned for comparison
//   view:            'cards' | 'board'                    results layout (ranked cards or the horizontal compare board)
//   group:           'top3' | 'carrier' | 'type' | 'account' | 'all'   which plans the board shows
//   includeMine:     boolean                              always show the 2027 version of currentPlan2026 (pinned first)
// }
//
// URL hash: URLSearchParams with compact keys, default values omitted, e.g.
//   #s=r&e=f&st=VA&a=h&n=Aetna&n=Kaiser+Permanente&c=104&sc=w&d=1&p=104,224&v=b&g=c
// Every field is validated independently; a malformed or unknown value falls back to its default.
// Fine-tune overrides: o=h3.e2 (field letter + count). Custom lines go last, one `cl` param each:
//   cl=<kind letter>_<price>_<perYear>_<flags>_<label>   flags: 'o' out-of-network, 't<n>' drug tier
// When the lines would push the hash past HASH_BUDGET chars, the ones that do not fit are saved in localStorage
// (OVERFLOW_KEY, keyed by a signature of the inline lines) and `cx=N` records how many; the same browser restores
// them, any other browser gets the inline lines only.

import { sanitizeLines, sanitizeOverrides, MAX_CUSTOM_LINES } from './engine/scenarios.js';

export const STORAGE_KEY = 'fehb-compass:state:v1';
export const OVERFLOW_KEY = 'fehb-compass:custom-overflow:v1';
/** Longest hash (characters, without '#') written before custom lines spill to localStorage. */
export const HASH_BUDGET = 1500;

export const DEFAULT_STATE = Object.freeze({
  status: 'active',
  enrollment: 'self',
  location: Object.freeze({ state: null, zip: null }),
  account: 'any',
  networks: Object.freeze([]),
  currentPlan2026: null,
  scenario: 'typical',
  overrides: Object.freeze({}),
  custom: Object.freeze([]),
  dental: false,
  selectedPlans: Object.freeze([]),
  view: 'cards',
  group: 'top3',
  includeMine: true,
});

export function defaultState() {
  return {
    ...DEFAULT_STATE,
    location: { ...DEFAULT_STATE.location },
    networks: [],
    overrides: {},
    custom: [],
    selectedPlans: [],
  };
}

// Long value <-> short hash token.
const STATUS = { active: 'a', retiree: 'r' };
const ENROLLMENT = { self: 's', self_plus_one: '1', family: 'f' };
const ACCOUNT = { any: 'n', hsa: 'h', hra: 'r' };
const SCENARIO = { healthy: 'h', typical: 't', condition: 'c', worst: 'w', nothing: 'n' };
const OVERRIDE = { hospitalStays: 'h', erVisits: 'e', specialistVisits: 's', pcpVisits: 'p', rxMonthly: 'r' };
const KIND = {
  pcp: 'p', specialist: 's', urgent: 'u', er: 'e', hospital_stay: 'h', surgery_outpatient: 'o', lab: 'l',
  imaging: 'i', therapy: 't', rx_generic: 'g', rx_brand: 'b', rx_specialty: 'x', other: 'z',
};
const VIEW = { cards: 'c', board: 'b' };
const GROUP = { top3: 't', carrier: 'c', type: 'p', account: 'a', all: 'x' };

const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const STATUS_IN = invert(STATUS);
const ENROLLMENT_IN = invert(ENROLLMENT);
const ACCOUNT_IN = invert(ACCOUNT);
const SCENARIO_IN = invert(SCENARIO);
const VIEW_IN = invert(VIEW);
const GROUP_IN = invert(GROUP);
const OVERRIDE_IN = invert(OVERRIDE);
const KIND_IN = invert(KIND);

const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

const STATE_RE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}$/;
const PLAN_RE = /^[A-Z0-9]{2,4}$/;
const MAX_LIST = 40;

// ---- field validators: return a valid value or the default ----

const pickEnum = (v, allowed, dflt) => (has(allowed, v) ? v : dflt);
const validState = (v) => (typeof v === 'string' && STATE_RE.test(v) ? v : null);
const validZip = (v) => (typeof v === 'string' && ZIP_RE.test(v) ? v : null);
const validPlan = (v) => (typeof v === 'string' && PLAN_RE.test(v) ? v : null);

function validPlanList(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    const code = validPlan(x);
    if (code && !out.includes(code)) out.push(code);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

function validNetworks(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (typeof x === 'string' && x.length > 0 && x.length <= 80 && !out.includes(x)) out.push(x);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

/** Validate a (possibly partial or hostile) object into a complete, valid State. */
export function sanitizeState(input) {
  const s = input && typeof input === 'object' ? input : {};
  const loc = s.location && typeof s.location === 'object' ? s.location : {};
  return {
    status: pickEnum(s.status, STATUS, DEFAULT_STATE.status),
    enrollment: pickEnum(s.enrollment, ENROLLMENT, DEFAULT_STATE.enrollment),
    location: { state: validState(loc.state), zip: validZip(loc.zip) },
    account: pickEnum(s.account, ACCOUNT, DEFAULT_STATE.account),
    networks: validNetworks(s.networks),
    currentPlan2026: validPlan(s.currentPlan2026),
    scenario: pickEnum(s.scenario, SCENARIO, DEFAULT_STATE.scenario),
    overrides: sanitizeOverrides(s.overrides),
    custom: sanitizeLines(s.custom),
    dental: s.dental === true,
    selectedPlans: validPlanList(s.selectedPlans),
    view: pickEnum(s.view, VIEW, DEFAULT_STATE.view),
    group: pickEnum(s.group, GROUP, DEFAULT_STATE.group),
    includeMine: s.includeMine !== false,
  };
}

/** Most plans the side-by-side compare view shows at once. */
export const MAX_COMPARE = 4;

/**
 * Second pass once data has loaded: drop values the data does not know.
 * vocab = { states: Set, networks: Set, plans2026: Set, plans2027: Set } (any may be missing = skip that check).
 * Returns the SAME object when nothing changes, so callers can cheaply skip a store write.
 */
export function sanitizeAgainstData(state, vocab) {
  if (!vocab) return state;
  const keep = (set, v) => !set || set.has(v);
  const st = state.location.state && !keep(vocab.states, state.location.state) ? null : state.location.state;
  const networks = state.networks.filter((n) => keep(vocab.networks, n));
  const current = state.currentPlan2026 && !keep(vocab.plans2026, state.currentPlan2026) ? null : state.currentPlan2026;
  const selected = state.selectedPlans.filter((c) => keep(vocab.plans2027, c)).slice(0, MAX_COMPARE);
  const same = st === state.location.state
    && networks.length === state.networks.length
    && current === state.currentPlan2026
    && selected.length === state.selectedPlans.length;
  if (same) return state;
  return {
    ...state,
    location: { ...state.location, state: st },
    networks,
    currentPlan2026: current,
    selectedPlans: selected,
  };
}

// ---- URL hash ----

/** One custom line -> 'kind_price_perYear_flags_label' (the label may contain anything, including '_'). */
function encodeLine(l) {
  const flags = `${l.outOfNetwork ? 'o' : ''}${Number.isInteger(l.tier) ? `t${l.tier}` : ''}`;
  return `${KIND[l.kind]}_${l.price}_${l.perYear}_${flags}_${l.label}`;
}

function decodeLine(str) {
  if (typeof str !== 'string' || str.length > 400) return null;
  const parts = str.split('_');
  if (parts.length < 5) return null;
  const [k, price, perYear, flags] = parts;
  if (!has(KIND_IN, k) || !/^(o?)(t\d)?$/.test(flags)) return null;
  const NUM = /^\d+(\.\d+)?$/;
  if (!NUM.test(price) || !NUM.test(perYear)) return null;
  const line = { label: parts.slice(4).join('_'), kind: KIND_IN[k], price: Number(price), perYear: Number(perYear) };
  if (flags.includes('o')) line.outOfNetwork = true;
  const t = flags.match(/t(\d)/);
  if (t) line.tier = Number(t[1]);
  return line;
}

function encodeOverrides(o) {
  return Object.entries(OVERRIDE).filter(([k]) => has(o, k)).map(([k, c]) => `${c}${o[k]}`).join('.');
}

function decodeOverrides(str) {
  const out = {};
  if (typeof str !== 'string') return out;
  for (const tok of str.split('.').slice(0, 10)) {
    const m = tok.match(/^([a-z])(\d{1,4})$/);
    if (m && has(OVERRIDE_IN, m[1])) out[OVERRIDE_IN[m[1]]] = Number(m[2]);
  }
  return out;
}

const lineSig = (encodedLines) => encodedLines.join('\n');

/**
 * State -> { hash, inline, overflow }. hash has no leading '#'; defaults are omitted (defaults encode to '').
 * Custom lines are appended while the hash stays within HASH_BUDGET; the rest are returned in `overflow`
 * (and announced with cx=N) for saveOverflow to keep in localStorage.
 */
export function encodeHash(state) {
  const s = sanitizeState(state);
  const p = new URLSearchParams();
  if (s.status !== DEFAULT_STATE.status) p.set('s', STATUS[s.status]);
  if (s.enrollment !== DEFAULT_STATE.enrollment) p.set('e', ENROLLMENT[s.enrollment]);
  if (s.location.state) p.set('st', s.location.state);
  if (s.location.zip) p.set('z', s.location.zip);
  if (s.account !== DEFAULT_STATE.account) p.set('a', ACCOUNT[s.account]);
  for (const n of s.networks) p.append('n', n);
  if (s.currentPlan2026) p.set('c', s.currentPlan2026);
  if (s.scenario !== DEFAULT_STATE.scenario) p.set('sc', SCENARIO[s.scenario]);
  const ov = encodeOverrides(s.overrides);
  if (ov) p.set('o', ov);
  if (s.dental) p.set('d', '1');
  if (s.selectedPlans.length) p.set('p', s.selectedPlans.join(','));
  if (s.view !== DEFAULT_STATE.view) p.set('v', VIEW[s.view]);
  if (s.group !== DEFAULT_STATE.group) p.set('g', GROUP[s.group]);
  if (!s.includeMine) p.set('m', '0');

  const encoded = [];
  let i = 0;
  for (; i < s.custom.length; i++) {
    const e = encodeLine(s.custom[i]);
    const trial = new URLSearchParams(p);
    trial.append('cl', e);
    // reserve room for "&cx=NN" in case later lines have to spill
    if (trial.toString().length + 7 > HASH_BUDGET) break;
    p.append('cl', e);
    encoded.push(e);
  }
  const overflow = s.custom.slice(i);
  if (overflow.length) p.set('cx', String(overflow.length));
  return { hash: p.toString(), inline: i, overflow, sig: lineSig(encoded) };
}

/** State -> hash body (no leading '#'). See encodeHash for the custom-line budget. */
export function encodeState(state) {
  return encodeHash(state).hash;
}

/**
 * Keep (or clear) the custom lines that did not fit in the hash. `res` is encodeHash output.
 * storage: a Storage-like object; omitted = localStorage. Returns whether the write succeeded.
 */
export function saveOverflow(res, storage) {
  const st = safeStorage(storage);
  if (!res || !res.overflow || res.overflow.length === 0) return st.remove(OVERFLOW_KEY);
  return st.set(OVERFLOW_KEY, JSON.stringify({ sig: res.sig, lines: res.overflow }));
}

function readOverflow(storage, sig, room) {
  const raw = safeStorage(storage).get(OVERFLOW_KEY);
  if (!raw || room <= 0) return [];
  try {
    const rec = JSON.parse(raw);
    if (!rec || rec.sig !== sig || !Array.isArray(rec.lines)) return [];
    return sanitizeLines(rec.lines).slice(0, room);
  } catch {
    return [];
  }
}

/**
 * Hash string (with or without '#') -> State. Never throws; bad fields become defaults.
 * opts.storage (a Storage-like object, or undefined for localStorage) restores custom lines that spilled out of
 * the hash on this browser; without the option, decode is pure.
 */
export function decodeState(hash, opts = {}) {
  if (typeof hash !== 'string') return defaultState();
  let p;
  try {
    p = new URLSearchParams(hash.replace(/^#/, ''));
  } catch {
    return defaultState();
  }
  const one = (k) => p.get(k) ?? undefined;
  // custom lines: compact `cl` params, or the older JSON `cu` param
  const cl = p.getAll('cl').slice(0, MAX_CUSTOM_LINES);
  let custom = sanitizeLines(cl.map(decodeLine));
  const cu = one('cu');
  if (!cl.length && cu) {
    try { custom = sanitizeLines(JSON.parse(cu)); } catch { custom = []; }
  }
  const cx = Number(one('cx'));
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'storage') && Number.isInteger(cx) && cx > 0) {
    const sig = lineSig(cl);
    custom = custom.concat(readOverflow(opts.storage, sig, MAX_CUSTOM_LINES - custom.length));
  }
  return sanitizeState({
    status: STATUS_IN[one('s')] ?? undefined,
    enrollment: has(ENROLLMENT_IN, one('e')) ? ENROLLMENT_IN[one('e')] : undefined,
    location: { state: one('st'), zip: one('z') },
    account: has(ACCOUNT_IN, one('a')) ? ACCOUNT_IN[one('a')] : undefined,
    networks: p.getAll('n'),
    currentPlan2026: one('c'),
    scenario: has(SCENARIO_IN, one('sc')) ? SCENARIO_IN[one('sc')] : undefined,
    overrides: decodeOverrides(one('o')),
    custom,
    dental: one('d') === '1',
    selectedPlans: (one('p') ?? '').split(',').filter(Boolean),
    view: has(VIEW_IN, one('v')) ? VIEW_IN[one('v')] : undefined,
    group: has(GROUP_IN, one('g')) ? GROUP_IN[one('g')] : undefined,
    includeMine: one('m') !== '0',
  });
}

// ---- storage (every access wrapped: private mode, blocked cookies, quota) ----

function resolveStorage(explicit) {
  if (explicit !== undefined) return explicit;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Wrap a Storage-like object so no call can throw. Omit the arg to use localStorage. */
export function safeStorage(storage) {
  const st = resolveStorage(storage);
  return {
    get(key) {
      try { return st ? st.getItem(key) : null; } catch { return null; }
    },
    set(key, value) {
      try { if (!st) return false; st.setItem(key, value); return true; } catch { return false; }
    },
    remove(key) {
      try { if (!st) return false; st.removeItem(key); return true; } catch { return false; }
    },
  };
}

/** Initial state: a non-empty URL hash wins, then saved state, then defaults. */
export function loadInitialState({ hash = '', storage } = {}) {
  if (typeof hash === 'string' && hash.replace(/^#/, '').length > 0) return decodeState(hash, { storage });
  const raw = safeStorage(storage).get(STORAGE_KEY);
  if (raw) {
    try { return sanitizeState(JSON.parse(raw)); } catch { /* fall through */ }
  }
  return defaultState();
}

// ---- store ----

/**
 * createStore(initial, { storage }) -> { get, set, subscribe }
 * set(patch) shallow-merges (location merges one level deep), re-validates, persists best-effort,
 * and notifies subscribers with (state, prevState) when anything changed.
 */
export function createStore(initial = defaultState(), { storage } = {}) {
  const store = safeStorage(storage);
  let state = sanitizeState(initial);
  const subs = new Set();

  return {
    get: () => state,
    set(patch = {}) {
      const prev = state;
      const merged = { ...state, ...patch };
      if (patch.location) merged.location = { ...state.location, ...patch.location };
      const next = sanitizeState(merged);
      if (JSON.stringify(next) === JSON.stringify(prev)) return;
      state = next;
      store.set(STORAGE_KEY, JSON.stringify(state));
      for (const fn of [...subs]) {
        try { fn(state, prev); } catch (err) { console.error(err); }
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
