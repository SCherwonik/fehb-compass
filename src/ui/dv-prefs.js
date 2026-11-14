// Dental & Vision local preferences (never in the share link): the carrier / where-offered / network filters per
// kind, "differences only", the open board sections, and the sub-tab used last. One shared, observable copy:
// the filters are edited in the situation panel and read by the Dental & Vision results.
// DOM-free (unit tested); storage is injectable and every access is guarded (state.js safeStorage).
import { safeStorage } from '../state.js';

export const DV_UI_KEY = 'fehb-compass:dv-ui:v1';
export const FILTER0 = Object.freeze({ carriers: Object.freeze([]), area: 'any', oon: false, in2: false });

function filt(f) {
  return {
    carriers: Array.isArray(f?.carriers) ? [...new Set(f.carriers.filter((c) => typeof c === 'string' && c.length > 0 && c.length < 60))].slice(0, 20) : [],
    area: ['any', 'nationwide', 'regional'].includes(f?.area) ? f.area : 'any',
    oon: f?.oon === true,
    in2: f?.in2 === true,
  };
}

/** Saved JSON (or junk) -> a complete, valid prefs object. */
export function parseDvUi(raw) {
  let v = {};
  try { v = JSON.parse(raw ?? '{}') ?? {}; } catch { v = {}; }
  if (typeof v !== 'object' || Array.isArray(v)) v = {};
  return {
    diffOnly: v.diffOnly === true,
    lastKind: v.lastKind === 'vision' ? 'vision' : 'dental',
    open: v.open && typeof v.open === 'object' ? Object.fromEntries(Object.entries(v.open).filter(([, b]) => typeof b === 'boolean').slice(0, 40)) : {},
    dental: filt(v.dental),
    vision: filt(v.vision),
  };
}

/** True when any filter narrows the plans of that kind. */
export const filtersOn = (f) => Boolean(f && (f.carriers?.length || (f.area && f.area !== 'any') || f.oon || f.in2));

/**
 * createDvPrefs(storage?) -> { ui, save(), filter(kind), setFilter(kind, patch), resetFilter(kind), subscribe(fn) }
 * `ui` is the live object (open sections, diffOnly, lastKind are set on it, then save()); filter changes go through
 * setFilter / resetFilter, which save and notify subscribers with (kind).
 */
export function createDvPrefs(storage) {
  const st = safeStorage(storage);
  const ui = parseDvUi(st.get(DV_UI_KEY));
  const subs = new Set();
  const save = () => st.set(DV_UI_KEY, JSON.stringify(ui));
  const kindOf = (k) => (k === 'vision' ? 'vision' : 'dental');
  const notify = (kind) => { for (const fn of [...subs]) { try { fn(kind); } catch (err) { console.error(err); } } };
  return {
    ui,
    save,
    filter: (kind) => ui[kindOf(kind)],
    setFilter(kind, patch) {
      const k = kindOf(kind);
      ui[k] = filt({ ...ui[k], ...patch });
      save();
      notify(k);
    },
    resetFilter(kind) {
      const k = kindOf(kind);
      ui[k] = filt(FILTER0);
      save();
      notify(k);
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

let shared = null;
/** The page's one shared copy (localStorage). */
export const dvPrefs = () => (shared ??= createDvPrefs());
