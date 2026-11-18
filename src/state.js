// App state: shape, defaults, validation, URL-hash encoding and a tiny store.
// DOM-free so it imports cleanly under node:test.
//
// State shape
// {
//   status:          'active' | 'retiree'              premium basis (payroll biweekly x26 vs annuity monthly x12)
//   enrollment:      'self' | 'self_plus_one' | 'family'
//   location:        { state: string|null, zip: string|null }   2-letter USPS code; 5-digit ZIP (sets the state and
//                    drives FEDVIP dental regions/eligibility; ui/zip.js)
//   account:         'any' | 'hsa' | 'hra'               HSA/HRA preference filter
//   networks:        string[]                             network_family names; [] means "all"
//   currentPlan2026: string|null                          2026 enrollment code, e.g. '104'
//   scenario:        'healthy' | 'typical' | 'condition' | 'worst' | 'nothing'   keys of engine SCENARIOS
//   overrides:       { hospitalStays?, erVisits?, specialistVisits?, pcpVisits?, rxMonthly? }   "fine-tune" counts
//                    layered on the scenario (ranges: engine OVERRIDE_FIELDS)
//   custom:          line[] (max 25)                      { label, kind, price, perYear, tier?, outOfNetwork? }
//                    validated by engine/scenarios.js sanitizeLine
//   familySize:      integer 3..8 (default 4)             people on a family enrollment (memberCount)
//   others:          { name, scenario, overrides }[] (max 7)   the other people, costed one at a time (name: plain text,
//                    max 20 chars); member 1 (you) is scenario/overrides above; custom lines may carry member 1..7
//   dental:          boolean                              add FEDVIP dental/vision to the medical totals
//   tab:             'medical' | 'dental' | 'vision'      results tab (Dental & Vision has the two sub-tabs)
//   dentalUse:       'cleanings' | 'typical' | 'major' | 'braces'   dental usage preset (engine/dental.js)
//   visionUse:       'exam' | 'glasses' | 'contacts'      vision usage preset
//   dentalPlan:      null | 'none' | FEDVIP id            plan added to the total (null = cheapest for you)
//   visionPlan:      null | 'none' | FEDVIP id            e.g. '02AP-17-High' (<brochure>-<option>)
//   myDental:        null | FEDVIP id                     your 2026 dental plan (same id in 2027), pinned on the board
//   myVision:        null | FEDVIP id                     your 2026 vision plan
//   dvGroup:         'top3' | 'carrier' | 'all'           which plans the dental/vision board shows ("Show")
//   selectedPlans:   string[]                             2027 enrollment codes pinned for comparison
//   view:            'cards' | 'board'                    results layout (ranked cards or the horizontal compare board)
//   dvView:          'cards' | 'board'                    the same choice on the Dental & Vision tab (its own key: `dv`)
//   group:           'top3' | 'carrier' | 'type' | 'account' | 'all'   which plans the board shows
//   includeMine:     boolean                              always show the 2027 version of currentPlan2026 (pinned first)
//   glp1:            boolean                              only plans whose 2027 brochure covers GLP-1 drugs for weight loss
//   includeUnconfirmed: boolean                           the savings banner may pick a plan whose service area is not
//                    confirmed for the user's county/ZIP (default off; ranked lists show such plans either way)
// }
// (The user's medications are private: they live in localStorage under ui/meds-store.js, never in this state or the hash.)
//
// URL hash: URLSearchParams with compact keys, default values omitted, e.g.
//   #s=r&e=f&st=VA&a=h&n=Aetna&n=Kaiser+Permanente&c=104&sc=w&d=1&p=104,224&v=b&g=c
// Every field is validated independently; a malformed or unknown value falls back to its default.
// Fine-tune overrides: o=h3.e2 (field letter + count). Custom lines go last, one `l` param each:
//   l=<kind letter><price>_<perYear><flags>_<label>   flags: 'o' out-of-network, 't<n>' drug tier, 'm<n>' member
// Family: fs=<n> (family size, only when family and not 4); one mb=<scenario letter>_<overrides>_<name> per entry of
//   `others` (name = everything after the second '_'); entries equal to the default are still written to keep positions.
//   (links made before this format used cl=<kind>_<price>_<perYear>_<flags>_<label>; still decoded)
// When the lines would push the hash past HASH_BUDGET chars, the ones that do not fit are saved in localStorage
// (OVERFLOW_KEY, keyed by a signature of the inline lines) and `cx=N` records how many; the same browser restores
// them; any other browser gets the inline lines only, and decode reports the rest in `droppedCustom`.
//
// droppedCustom: integer 0..25, a notice only (never encoded): how many custom lines a pasted link announced
// with cx=N that this browser could not restore. The UI shows it until dismissed (set back to 0).

import { plainText } from './text.js';
import { SCENARIOS, sanitizeLines, sanitizeOverrides, MAX_CUSTOM_LINES } from './engine/scenarios.js';

export const STORAGE_KEY = 'fehb-compass:state:v1';
export const OVERFLOW_KEY = 'fehb-compass:custom-overflow:v1';
/** Longest hash (characters, without '#') written before custom lines spill to localStorage. */
export const HASH_BUDGET = 1500;
/** Most people on one enrollment (you plus up to 7 others). */
export const MAX_MEMBERS = 8;
const MAX_NAME = 20;

export const DEFAULT_STATE = Object.freeze({
  status: 'active',
  enrollment: 'self',
  location: Object.freeze({ state: null, zip: null }),
  account: 'any',
  networks: Object.freeze([]),
  currentPlan2026: null,
  scenario: 'typical',
  overrides: Object.freeze({}),
  familySize: 4,
  others: Object.freeze([]),
  custom: Object.freeze([]),
  dental: false,
  selectedPlans: Object.freeze([]),
  view: 'cards',
  dvView: 'cards',
  group: 'top3',
  includeMine: true,
  glp1: false,
  includeUnconfirmed: false,
  tab: 'medical',
  dentalUse: 'typical',
  visionUse: 'glasses',
  dentalPlan: null,
  visionPlan: null,
  myDental: null,
  myVision: null,
  dvGroup: 'top3',
  droppedCustom: 0,
});

export function defaultState() {
  return {
    ...DEFAULT_STATE,
    location: { ...DEFAULT_STATE.location },
    networks: [],
    overrides: {},
    others: [],
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
  imaging: 'i', therapy: 't', rx_generic: 'g', rx_brand: 'b', rx_specialty: 'x', other: 'z', maternity: 'm',
};
const VIEW = { cards: 'c', board: 'b' };
const GROUP = { top3: 't', carrier: 'c', type: 'p', account: 'a', all: 'x' };
const TAB = { medical: 'm', dental: 'd', vision: 'v' };
const DENTAL_USE = { cleanings: 'c', typical: 't', major: 'm', braces: 'b' };
const VISION_USE = { exam: 'e', glasses: 'g', contacts: 'c' };
const DV_GROUP = { top3: 't', carrier: 'c', all: 'x' };

const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const STATUS_IN = invert(STATUS);
const ENROLLMENT_IN = invert(ENROLLMENT);
const ACCOUNT_IN = invert(ACCOUNT);
const SCENARIO_IN = invert(SCENARIO);
const VIEW_IN = invert(VIEW);
const GROUP_IN = invert(GROUP);
const TAB_IN = invert(TAB);
const DENTAL_USE_IN = invert(DENTAL_USE);
const VISION_USE_IN = invert(VISION_USE);
const DV_GROUP_IN = invert(DV_GROUP);
const OVERRIDE_IN = invert(OVERRIDE);
const KIND_IN = invert(KIND);

const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

const STATE_RE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}$/;
const PLAN_RE = /^[A-Z0-9]{2,4}$/;
/** FEDVIP plan id: OPM brochure number plus option, e.g. 02AP-17-High. */
export const FEDVIP_ID_RE = /^[0-9A-Z]{4}-[0-9]{2}-(High|Standard)$/;
const MAX_LIST = 40;

// ---- field validators: return a valid value or the default ----

const pickEnum = (v, allowed, dflt) => (has(allowed, v) ? v : dflt);
const validState = (v) => (typeof v === 'string' && STATE_RE.test(v) ? v : null);
const validZip = (v) => (typeof v === 'string' && ZIP_RE.test(v) ? v : null);
const validPlan = (v) => (typeof v === 'string' && PLAN_RE.test(v) ? v : null);
const validFedvip = (v) => (typeof v === 'string' && FEDVIP_ID_RE.test(v) ? v : null);
const validPick = (v) => (v === 'none' ? 'none' : validFedvip(v));

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

/** People on the enrollment: 1, 2, or familySize. */
export function memberCount(state) {
  if (state.enrollment === 'self') return 1;
  if (state.enrollment === 'self_plus_one') return 2;
  return state.familySize;
}

function validOthers(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_MEMBERS - 1).map((x) => {
    const o = x && typeof x === 'object' ? x : {};
    const scenario = pickEnum(o.scenario, SCENARIOS, DEFAULT_STATE.scenario);
    return {
      name: plainText(o.name, MAX_NAME),
      scenario,
      overrides: pruneOverrides(sanitizeOverrides(o.overrides), SCENARIOS[scenario]),
    };
  });
}

/** Validate a (possibly partial or hostile) object into a complete, valid State. */
export function sanitizeState(input) {
  const s = input && typeof input === 'object' ? input : {};
  const loc = s.location && typeof s.location === 'object' ? s.location : {};
  const scenario = pickEnum(s.scenario, SCENARIO, DEFAULT_STATE.scenario);
  return {
    status: pickEnum(s.status, STATUS, DEFAULT_STATE.status),
    enrollment: pickEnum(s.enrollment, ENROLLMENT, DEFAULT_STATE.enrollment),
    location: { state: validState(loc.state), zip: validZip(loc.zip) },
    account: pickEnum(s.account, ACCOUNT, DEFAULT_STATE.account),
    networks: validNetworks(s.networks),
    currentPlan2026: validPlan(s.currentPlan2026),
    scenario,
    overrides: pruneOverrides(sanitizeOverrides(s.overrides), SCENARIOS[scenario]),
    familySize: Number.isFinite(s.familySize) ? Math.min(MAX_MEMBERS, Math.max(3, Math.round(s.familySize))) : DEFAULT_STATE.familySize,
    others: validOthers(s.others),
    custom: sanitizeLines(s.custom),
    dental: s.dental === true,
    selectedPlans: validPlanList(s.selectedPlans),
    view: pickEnum(s.view, VIEW, DEFAULT_STATE.view),
    dvView: pickEnum(s.dvView, VIEW, DEFAULT_STATE.dvView),
    group: pickEnum(s.group, GROUP, DEFAULT_STATE.group),
    includeMine: s.includeMine !== false,
    glp1: s.glp1 === true,
    includeUnconfirmed: s.includeUnconfirmed === true,
    tab: pickEnum(s.tab, TAB, DEFAULT_STATE.tab),
    dentalUse: pickEnum(s.dentalUse, DENTAL_USE, DEFAULT_STATE.dentalUse),
    visionUse: pickEnum(s.visionUse, VISION_USE, DEFAULT_STATE.visionUse),
    dentalPlan: validPick(s.dentalPlan),
    visionPlan: validPick(s.visionPlan),
    myDental: validFedvip(s.myDental),
    myVision: validFedvip(s.myVision),
    dvGroup: pickEnum(s.dvGroup, DV_GROUP, DEFAULT_STATE.dvGroup),
    droppedCustom: Number.isInteger(s.droppedCustom) && s.droppedCustom > 0 ? Math.min(MAX_CUSTOM_LINES, s.droppedCustom) : 0,
  };
}

/** Overrides equal to the active scenario's own value are dropped, so a stale one cannot resurface later. */
function pruneOverrides(o, base) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!base || base[k] !== v) out[k] = v;
  return out;
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

/** One custom line -> '<kind><price>_<perYear><flags>_<label>' (the label may contain anything, including '_'). */
function encodeLine(l) {
  const flags = `${l.outOfNetwork ? 'o' : ''}${Number.isInteger(l.tier) ? `t${l.tier}` : ''}${Number.isInteger(l.member) && l.member > 0 ? `m${l.member}` : ''}`;
  return `${KIND[l.kind]}${l.price}_${l.perYear}${flags}_${l.label}`;
}

function decodeLine(str) {
  if (typeof str !== 'string' || str.length > 400) return null;
  const parts = str.split('_');
  if (parts.length < 3) return null;
  const head = parts[0].match(/^([a-z])(\d+(?:\.\d+)?)$/);
  const mid = parts[1].match(/^(\d+)(o?)(?:t(\d))?(?:m(\d))?$/);
  if (!head || !mid || !has(KIND_IN, head[1])) return null;
  const line = { label: parts.slice(2).join('_'), kind: KIND_IN[head[1]], price: Number(head[2]), perYear: Number(mid[1]) };
  if (mid[2]) line.outOfNetwork = true;
  if (mid[3] !== undefined) line.tier = Number(mid[3]);
  if (mid[4] !== undefined) line.member = Number(mid[4]);
  return line;
}

/** Lines from links made before the compact format: 'kind_price_perYear_flags_label' in `cl` params. */
function decodeLegacyLine(str) {
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

function decodeMember(str) {
  if (typeof str !== 'string' || str.length > 400) return null;
  const parts = str.split('_');
  if (parts.length < 3 || !has(SCENARIO_IN, parts[0])) return null;
  return { name: parts.slice(2).join('_'), scenario: SCENARIO_IN[parts[0]], overrides: decodeOverrides(parts[1]) };
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
  if (s.enrollment === 'family' && s.familySize !== DEFAULT_STATE.familySize) p.set('fs', String(s.familySize));
  for (const o of s.others.slice(0, memberCount(s) - 1)) p.append('mb', `${SCENARIO[o.scenario]}_${encodeOverrides(o.overrides)}_${o.name}`);
  if (s.dental) p.set('d', '1');
  if (s.selectedPlans.length) p.set('p', s.selectedPlans.join(','));
  if (s.view !== DEFAULT_STATE.view) p.set('v', VIEW[s.view]);
  if (s.dvView !== DEFAULT_STATE.dvView) p.set('dv', VIEW[s.dvView]);
  if (s.group !== DEFAULT_STATE.group) p.set('g', GROUP[s.group]);
  if (!s.includeMine) p.set('m', '0');
  if (s.glp1) p.set('w', '1');
  if (s.includeUnconfirmed) p.set('u', '1');
  if (s.tab !== DEFAULT_STATE.tab) p.set('t', TAB[s.tab]);
  if (s.dentalUse !== DEFAULT_STATE.dentalUse) p.set('du', DENTAL_USE[s.dentalUse]);
  if (s.visionUse !== DEFAULT_STATE.visionUse) p.set('vu', VISION_USE[s.visionUse]);
  if (s.dentalPlan) p.set('dp', s.dentalPlan);
  if (s.visionPlan) p.set('vp', s.visionPlan);
  if (s.myDental) p.set('md', s.myDental);
  if (s.myVision) p.set('mv', s.myVision);
  if (s.dvGroup !== DEFAULT_STATE.dvGroup) p.set('dg', DV_GROUP[s.dvGroup]);

  const encoded = [];
  let i = 0;
  for (; i < s.custom.length; i++) {
    const e = encodeLine(s.custom[i]);
    const trial = new URLSearchParams(p);
    trial.append('l', e);
    // reserve room for "&cx=NN" in case later lines have to spill
    if (trial.toString().length + 7 > HASH_BUDGET) break;
    p.append('l', e);
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
  // custom lines: compact `l` params, the older `cl` params, or the oldest JSON `cu` param
  const ls = p.getAll('l').slice(0, MAX_CUSTOM_LINES);
  const cl = p.getAll('cl').slice(0, MAX_CUSTOM_LINES);
  const inlineRaw = ls.length ? ls : cl;
  let custom = sanitizeLines(ls.length ? ls.map(decodeLine) : cl.map(decodeLegacyLine));
  const cu = one('cu');
  if (!inlineRaw.length && cu) {
    try { custom = sanitizeLines(JSON.parse(cu)); } catch { custom = []; }
  }
  // cx=N: N more lines did not fit the link. Restore them from this browser when asked; report the rest.
  const cxRaw = one('cx');
  const cx = cxRaw && /^\d{1,4}$/.test(cxRaw) ? Number(cxRaw) : 0;
  let droppedCustom = 0;
  if (cx > 0) {
    const room = MAX_CUSTOM_LINES - custom.length;
    const restored = opts && Object.prototype.hasOwnProperty.call(opts, 'storage')
      ? readOverflow(opts.storage, lineSig(inlineRaw), room)
      : [];
    custom = custom.concat(restored);
    droppedCustom = Math.max(0, Math.min(cx, room) - restored.length);
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
    familySize: /^\d$/.test(one('fs') ?? '') ? Number(one('fs')) : undefined,
    others: p.getAll('mb').slice(0, MAX_MEMBERS - 1).map(decodeMember).filter(Boolean),
    custom,
    dental: one('d') === '1',
    selectedPlans: (one('p') ?? '').split(',').filter(Boolean),
    view: has(VIEW_IN, one('v')) ? VIEW_IN[one('v')] : undefined,
    dvView: has(VIEW_IN, one('dv')) ? VIEW_IN[one('dv')] : undefined,
    group: has(GROUP_IN, one('g')) ? GROUP_IN[one('g')] : undefined,
    includeMine: one('m') !== '0',
    glp1: one('w') === '1',
    includeUnconfirmed: one('u') === '1',
    tab: has(TAB_IN, one('t')) ? TAB_IN[one('t')] : undefined,
    dentalUse: has(DENTAL_USE_IN, one('du')) ? DENTAL_USE_IN[one('du')] : undefined,
    visionUse: has(VISION_USE_IN, one('vu')) ? VISION_USE_IN[one('vu')] : undefined,
    dentalPlan: one('dp'),
    visionPlan: one('vp'),
    myDental: one('md'),
    myVision: one('mv'),
    dvGroup: has(DV_GROUP_IN, one('dg')) ? DV_GROUP_IN[one('dg')] : undefined,
    droppedCustom,
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
