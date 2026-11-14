// Data loading plus pure helpers that derive input-panel contents. DOM-free.

const FILES = {
  plans: 'plans.json',
  rates: 'rates.json',
  benefits: 'benefits.json',
  serviceArea: 'service_area.json',
  meta: 'meta.json',
};

const DEFAULT_BASE = new URL('../data/', import.meta.url);

async function fetchJson(file, base) {
  const res = await fetch(new URL(file, base));
  if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status})`);
  return res.json();
}

async function loadKeys(keys, base) {
  const entries = await Promise.all(keys.map(async (key) => [key, await fetchJson(FILES[key], base)]));
  return Object.fromEntries(entries);
}

/** Fetch the core and cost data files in parallel. Resolves to { plans, rates, benefits, serviceArea, meta }. */
export async function loadData(base = DEFAULT_BASE) {
  return loadKeys(Object.keys(FILES), base);
}

// Small files the input panel needs (about 200 KB) vs. the heavy cost data (benefits.json is about 2.3 MB).
const CORE = ['plans', 'serviceArea', 'meta'];
// (Dental and vision come from fedvip.json, loaded lazily: see loadFedvip. The pipeline's older
// dental_vision.json is not used by the app and is not deployed.)
const COST = ['rates', 'benefits'];

/**
 * Two stages so the panel paints before benefits.json arrives. The heavy files start only once the
 * small ones are in, so on a slow link they do not steal bandwidth from what the first paint needs.
 * Returns { core: Promise<{plans, serviceArea, meta}>, full: Promise<core plus rates and benefits> }.
 */
export function loadDataProgressive(base = DEFAULT_BASE) {
  const core = loadKeys(CORE, base);
  const cost = core.then(() => loadKeys(COST, base));
  core.catch(() => {}); // surfaced through `full` as well; avoid an unhandled rejection
  cost.catch(() => {});
  const full = Promise.all([core, cost]).then(([a, b]) => ({ ...a, ...b }));
  return { core, full };
}

/**
 * Brochure facts (data/brochure_facts.json, about 1.6 MB): prescription tiers, drug lookup links and the
 * "what changed in 2027" lists, verified against the 2027 plan brochures. Loaded after the plans are ranked
 * (it is not needed for the first paint). Resolves to the parsed file, or null when it is missing or broken:
 * the app then works without brochure facts.
 */
export async function loadBrochureFacts(base = DEFAULT_BASE) {
  try {
    const facts = await fetchJson('brochure_facts.json', base);
    return facts && typeof facts === 'object' && facts.plans && typeof facts.plans === 'object' ? facts : null;
  } catch (err) {
    console.warn('Brochure facts not loaded:', err?.message ?? err);
    return null;
  }
}

let fedvipPromise = null;
/**
 * FEDVIP dental and vision data (data/fedvip.json, about 530 KB: plans, regional rates, benefits, ZIP geography,
 * both years). Loaded once, on demand or after the medical plans are ranked. Resolves to the parsed file, or
 * null when it is missing or malformed (a later call retries).
 */
export function loadFedvip(base = DEFAULT_BASE) {
  if (!fedvipPromise) {
    fedvipPromise = fetchJson('fedvip.json', base)
      .then((fv) => (fv && typeof fv === 'object' && fv.years?.['2027']?.plans && fv.meta?.board ? fv : null))
      .catch((err) => { console.warn('FEDVIP data not loaded:', err?.message ?? err); return null; })
      .then((fv) => { if (!fv) fedvipPromise = null; return fv; });
  }
  return fedvipPromise;
}

// One shared handle on the FEDVIP data for every view (ZIP field, dental tab, add-on, medical totals).
let fvData = null;
const fvSubs = new Set();
export const fedvipHub = {
  get: () => fvData,
  /** Start (or join) the load; subscribers hear about it once it arrives. */
  load(base) {
    return loadFedvip(base).then((fv) => {
      if (fv && fv !== fvData) {
        fvData = fv;
        for (const fn of [...fvSubs]) { try { fn(fv); } catch (err) { console.error(err); } }
      }
      return fv;
    });
  },
  subscribe(fn) { fvSubs.add(fn); return () => fvSubs.delete(fn); },
};

/**
 * ZIP -> county lookup from data/zip_county.json (Census 2020 ZCTA-to-county file, about 360 KB). The file is
 * stored county -> "zip zip ..." (smaller); this inverts it into the lookup model.js areaStatus takes:
 * { zips: { zip5: countyFips | [countyFips, ...] (sorted) }, names: { countyFips: 'Fairfax County' } }.
 * null when the document is not the expected shape.
 */
export function zipCountyLookup(doc) {
  if (!doc || typeof doc !== 'object' || !doc.counties || typeof doc.counties !== 'object') return null;
  const zips = Object.create(null);
  for (const fips of Object.keys(doc.counties).sort()) {
    const list = doc.counties[fips];
    if (typeof list !== 'string' || !/^\d{5}$/.test(fips)) continue;
    for (const z of list.split(' ')) {
      if (!/^\d{5}$/.test(z)) continue;
      const cur = zips[z];
      zips[z] = cur === undefined ? fips : Array.isArray(cur) ? [...cur, fips] : [cur, fips];
    }
  }
  const names = doc.names && typeof doc.names === 'object' ? doc.names : {};
  return { zips, names };
}

let zcPromise = null;
/** Fetch and decode data/zip_county.json once; null (and a later call retries) when it is missing or broken. */
export function loadZipCounty(base = DEFAULT_BASE) {
  if (!zcPromise) {
    zcPromise = fetchJson('zip_county.json', base)
      .then(zipCountyLookup)
      .catch((err) => { console.warn('ZIP-to-county lookup not loaded:', err?.message ?? err); return null; })
      .then((zc) => { if (!zc) zcPromise = null; return zc; });
  }
  return zcPromise;
}

// One shared handle on the ZIP -> county lookup (results, network counts, GLP-1 chip). Loaded only once the
// user has a ZIP; until it arrives (or if it never does) plans serving part of a state stay "confirm your county".
let zcData = null;
const zcSubs = new Set();
export const zipCountyHub = {
  get: () => zcData,
  load(base) {
    return loadZipCounty(base).then((zc) => {
      if (zc && zc !== zcData) {
        zcData = zc;
        for (const fn of [...zcSubs]) { try { fn(zc); } catch (err) { console.error(err); } }
      }
      return zc;
    });
  },
  subscribe(fn) { zcSubs.add(fn); return () => zcSubs.delete(fn); },
};

/** Sorted unique state codes that appear in any plan's service area. */
export function statesFromServiceArea(serviceArea) {
  const set = new Set();
  for (const area of Object.values(serviceArea ?? {})) {
    for (const st of area?.states ?? []) set.add(st);
  }
  return [...set].sort();
}

export function plansForYear(plans, year) {
  return (plans ?? []).filter((p) => p.year === year);
}

/** [{ name, count }] network families for a year, most plans first, then by name. */
export function networkFamilies(plans, year) {
  const counts = new Map();
  for (const p of plansForYear(plans, year)) {
    const f = p.network_family || 'Other';
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// USPS names for the codes present in the OPM service-area file (incl. territories and freely associated states).
export const STATE_NAMES = {
  AK: 'Alaska', AL: 'Alabama', AR: 'Arkansas', AZ: 'Arizona', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DC: 'District of Columbia', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', GU: 'Guam',
  HI: 'Hawaii', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland', ME: 'Maine', MI: 'Michigan', MN: 'Minnesota',
  MO: 'Missouri', MP: 'Northern Mariana Islands', MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina',
  ND: 'North Dakota', NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada',
  NY: 'New York', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico',
  PW: 'Palau', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VA: 'Virginia', VI: 'U.S. Virgin Islands', VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin',
  WV: 'West Virginia', WY: 'Wyoming',
};
