// "My medications": the user's private drug list and the tiers they recorded per plan.
// PRIVATE: kept in localStorage only (every access wrapped), never in the URL hash, never sent anywhere.
// Also the shared hub for brochure facts (loaded after first paint) and the current top-ranked plans, so the
// input panel and the results can talk without importing each other. DOM-free (node tested).
//
// Stored shape (MEDS_KEY): { drugs: [{ id, name, monthlyCost|null (the 30-day price: the form takes the price of one fill and converts), fillsPerYear, channel }],
//                            records: { [planCode]: { [drugId]: 'Tier 2' | 'nc' | 'pa' } } }
import { safeStorage } from '../state.js';
import { plainText } from '../text.js';

export const MEDS_KEY = 'fehb-compass:meds:v1';
export const MAX_DRUGS = 15;
export const MAX_NAME = 80;
export const CHANNEL_IDS = Object.freeze(['retail30', 'retail90', 'mail', 'specialty']);

const ID_RE = /^[a-z0-9]{1,12}$/;
const PLAN_RE = /^[A-Z0-9]{2,4}$/;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** Free-text drug name (src/text.js plainText: the same rule as custom cost labels), at most MAX_NAME; null if empty. */
export function sanitizeName(v) {
  return plainText(v, MAX_NAME) || null;
}

export function sanitizeDrug(d) {
  if (!d || typeof d !== 'object') return null;
  const id = typeof d.id === 'string' && ID_RE.test(d.id) && d.id !== '__proto__' ? d.id : null;
  const name = sanitizeName(d.name);
  if (!id || !name) return null;
  const cost = typeof d.monthlyCost === 'string' && d.monthlyCost.trim() !== '' ? Number(d.monthlyCost) : d.monthlyCost;
  const fills = typeof d.fillsPerYear === 'string' ? Number(d.fillsPerYear) : d.fillsPerYear;
  const mem = typeof d.member === 'string' && d.member.trim() !== '' ? Number(d.member) : d.member;
  return {
    id,
    name,
    monthlyCost: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost <= 100000 ? Math.round(cost * 10000) / 10000 : null, // 4 decimals: a 90-day price kept as a 30-day price must come back to the cent
    fillsPerYear: Number.isInteger(fills) && fills >= 1 && fills <= 365 ? fills : 12,
    channel: typeof d.channel === 'string' && CHANNEL_IDS.includes(d.channel) ? d.channel : 'retail30',
    // which household member takes it: 1..7 = another member; absent = you (member 0), so records stay as they were
    ...(Number.isInteger(mem) && mem >= 1 && mem <= 7 ? { member: mem } : {}),
  };
}

/** A recorded lookup result: 'nc', 'pa', a tier number 0-6 (-> 'Tier N') or a short plain tier name. */
export function sanitizeRecord(v) {
  if (v === 'nc' || v === 'pa') return v;
  if (Number.isInteger(v)) return v >= 0 && v <= 6 ? `Tier ${v}` : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 80 || /[<>\u0000-\u001F]/.test(s)) return null;
  return s;
}

export function sanitizeMeds(v) {
  const out = { drugs: [], records: {} };
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.drugs)) return out;
  const ids = new Set();
  for (const d of v.drugs) {
    const s = sanitizeDrug(d);
    if (!s || ids.has(s.id)) continue;
    ids.add(s.id);
    out.drugs.push(s);
    if (out.drugs.length >= MAX_DRUGS) break;
  }
  const recs = v.records && typeof v.records === 'object' && !Array.isArray(v.records) ? v.records : {};
  for (const code of Object.keys(recs)) {
    if (!PLAN_RE.test(code)) continue;
    const r = recs[code];
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const clean = {};
    for (const id of Object.keys(r)) {
      if (!ids.has(id)) continue;
      const t = sanitizeRecord(r[id]);
      if (t) clean[id] = t;
    }
    if (Object.keys(clean).length) out.records[code] = clean;
  }
  return out;
}

function newId(taken) {
  for (let i = 0; i < 50; i++) {
    const id = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 12);
    if (ID_RE.test(id) && !taken.has(id)) return id;
  }
  return `d${taken.size}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * createMedsStore({ storage }) (storage omitted = localStorage; null = none)
 * -> { get, add, update, remove, record, subscribe, persistent, setFacts, facts, factsStatus, setTop, top }
 * `persistent` is false when storage is missing or refuses writes: the list then lives for this page only.
 * Subscribers get (meds, reason) with reason 'meds' | 'facts' | 'top'.
 */
export function createMedsStore({ storage } = {}) {
  const st = safeStorage(storage);
  let meds = { drugs: [], records: {} };
  try { meds = sanitizeMeds(JSON.parse(st.get(MEDS_KEY) ?? 'null')); } catch { meds = { drugs: [], records: {} }; }
  // probe: can we write? (private mode, blocked site data, quota)
  const probe = '__fehb_probe__';
  let persistent = st.set(probe, '1');
  st.remove(probe);
  let facts;
  let factsState = 'loading';
  let top = [];
  const subs = new Set();

  const emit = (reason) => {
    for (const fn of [...subs]) {
      try { fn(meds, reason); } catch (err) { console.error(err); }
    }
  };
  const commit = (next) => {
    meds = sanitizeMeds(next);
    if (persistent && !st.set(MEDS_KEY, JSON.stringify(meds))) persistent = false;
    emit('meds');
  };

  return {
    get: () => meds,
    get persistent() { return persistent; },
    /** Add a drug; returns the stored drug, or null when the list is full or the name is empty. */
    add(d) {
      if (meds.drugs.length >= MAX_DRUGS) return null;
      const drug = sanitizeDrug({ ...(d && typeof d === 'object' ? d : {}), id: newId(new Set(meds.drugs.map((x) => x.id))) });
      if (!drug) return null;
      commit({ ...meds, drugs: [...meds.drugs, drug] });
      return meds.drugs.find((x) => x.id === drug.id) ?? null;
    },
    update(id, patch) {
      const i = meds.drugs.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const next = sanitizeDrug({ ...meds.drugs[i], ...(patch && typeof patch === 'object' ? patch : {}), id });
      if (!next) return null;
      const drugs = meds.drugs.slice();
      drugs[i] = next;
      commit({ ...meds, drugs });
      return next;
    },
    remove(id) {
      if (!meds.drugs.some((x) => x.id === id)) return;
      const records = {};
      for (const [code, r] of Object.entries(meds.records)) {
        const { [id]: _gone, ...rest } = r;
        if (Object.keys(rest).length) records[code] = rest;
      }
      commit({ drugs: meds.drugs.filter((x) => x.id !== id), records });
    },
    /** Record (or clear, with tier null) what the plan's lookup said about a drug. */
    record(code, id, tier) {
      if (typeof code !== 'string' || !PLAN_RE.test(code) || !meds.drugs.some((x) => x.id === id)) return;
      const t = tier == null || tier === '' ? null : sanitizeRecord(tier);
      if (tier != null && tier !== '' && !t) return;
      const cur = own(meds.records, code) ? { ...meds.records[code] } : {};
      if (t) cur[id] = t; else delete cur[id];
      const records = { ...meds.records };
      if (Object.keys(cur).length) records[code] = cur; else delete records[code];
      commit({ ...meds, records });
    },
    /** Put back a whole earlier snapshot (undo after a remove). */
    replace(snapshot) { commit(snapshot); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    // brochure facts: undefined while loading, null when missing
    setFacts(f) { facts = f && typeof f === 'object' ? f : null; factsState = facts ? 'ready' : 'missing'; emit('facts'); },
    facts: () => facts ?? null,
    factsStatus: () => factsState,
    /** Top-ranked plans from the results: [{ code, name, rank }] (not persisted). */
    setTop(list) {
      const next = (Array.isArray(list) ? list : []).filter((x) => x && PLAN_RE.test(x.code)).slice(0, 10)
        .map((x) => ({ code: x.code, name: String(x.name ?? x.code), rank: Number.isInteger(x.rank) ? x.rank : null }));
      if (JSON.stringify(next) === JSON.stringify(top)) return;
      top = next;
      emit('top');
    },
    top: () => top,
  };
}
