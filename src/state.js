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
//   scenario:        'healthy' | 'typical' | 'condition' | 'worst'   keys of engine SCENARIOS
//   custom:          object[]                             custom usage lines (shape owned by a later task)
//   dental:          boolean                              add FEDVIP dental/vision to totals
//   selectedPlans:   string[]                             2027 enrollment codes pinned for comparison
// }
//
// URL hash: URLSearchParams with compact keys, default values omitted, e.g.
//   #s=r&e=f&st=VA&a=h&n=Aetna&n=Kaiser+Permanente&c=104&sc=w&d=1&p=104,224
// Every field is validated independently; a malformed or unknown value falls back to its default.

export const STORAGE_KEY = 'fehb-compass:state:v1';

export const DEFAULT_STATE = Object.freeze({
  status: 'active',
  enrollment: 'self',
  location: Object.freeze({ state: null, zip: null }),
  account: 'any',
  networks: Object.freeze([]),
  currentPlan2026: null,
  scenario: 'typical',
  custom: Object.freeze([]),
  dental: false,
  selectedPlans: Object.freeze([]),
});

export function defaultState() {
  return {
    ...DEFAULT_STATE,
    location: { ...DEFAULT_STATE.location },
    networks: [],
    custom: [],
    selectedPlans: [],
  };
}

// Long value <-> short hash token.
const STATUS = { active: 'a', retiree: 'r' };
const ENROLLMENT = { self: 's', self_plus_one: '1', family: 'f' };
const ACCOUNT = { any: 'n', hsa: 'h', hra: 'r' };
const SCENARIO = { healthy: 'h', typical: 't', condition: 'c', worst: 'w' };

const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const STATUS_IN = invert(STATUS);
const ENROLLMENT_IN = invert(ENROLLMENT);
const ACCOUNT_IN = invert(ACCOUNT);
const SCENARIO_IN = invert(SCENARIO);

const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

const STATE_RE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}$/;
const PLAN_RE = /^[A-Z0-9]{2,4}$/;
const MAX_LIST = 40;
const MAX_CUSTOM = 50;

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

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
function validCustom(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v.slice(0, MAX_CUSTOM)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const clean = {};
    let ok = true;
    for (const [k, val] of Object.entries(item)) {
      const okVal = (typeof val === 'number' && Number.isFinite(val))
        || typeof val === 'boolean'
        || (typeof val === 'string' && val.length <= 120);
      if (!KEY_RE.test(k) || !okVal) { ok = false; break; }
      clean[k] = val;
    }
    if (ok && Object.keys(clean).length) out.push(clean);
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
    custom: validCustom(s.custom),
    dental: s.dental === true,
    selectedPlans: validPlanList(s.selectedPlans),
  };
}

// ---- URL hash ----

/** State -> hash body (no leading '#'). Defaults are omitted, so defaults encode to ''. */
export function encodeState(state) {
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
  if (s.custom.length) p.set('cu', JSON.stringify(s.custom));
  if (s.dental) p.set('d', '1');
  if (s.selectedPlans.length) p.set('p', s.selectedPlans.join(','));
  return p.toString();
}

/** Hash string (with or without '#') -> State. Never throws; bad fields become defaults. */
export function decodeState(hash) {
  if (typeof hash !== 'string') return defaultState();
  let p;
  try {
    p = new URLSearchParams(hash.replace(/^#/, ''));
  } catch {
    return defaultState();
  }
  const one = (k) => p.get(k) ?? undefined;
  let custom = [];
  const cu = one('cu');
  if (cu) {
    try { custom = JSON.parse(cu); } catch { custom = []; }
  }
  return sanitizeState({
    status: STATUS_IN[one('s')] ?? undefined,
    enrollment: has(ENROLLMENT_IN, one('e')) ? ENROLLMENT_IN[one('e')] : undefined,
    location: { state: one('st'), zip: one('z') },
    account: has(ACCOUNT_IN, one('a')) ? ACCOUNT_IN[one('a')] : undefined,
    networks: p.getAll('n'),
    currentPlan2026: one('c'),
    scenario: has(SCENARIO_IN, one('sc')) ? SCENARIO_IN[one('sc')] : undefined,
    custom,
    dental: one('d') === '1',
    selectedPlans: (one('p') ?? '').split(',').filter(Boolean),
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
  if (typeof hash === 'string' && hash.replace(/^#/, '').length > 0) return decodeState(hash);
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
