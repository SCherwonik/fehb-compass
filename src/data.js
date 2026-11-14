// Data loading plus pure helpers that derive input-panel contents. DOM-free.

const FILES = {
  plans: 'plans.json',
  rates: 'rates.json',
  benefits: 'benefits.json',
  serviceArea: 'service_area.json',
  dentalVision: 'dental_vision.json',
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

/** Fetch every data file in parallel. Resolves to { plans, rates, benefits, serviceArea, dentalVision, meta }. */
export async function loadData(base = DEFAULT_BASE) {
  return loadKeys(Object.keys(FILES), base);
}

// Small files the input panel needs (about 200 KB) vs. the heavy cost data (benefits.json is about 2.3 MB).
const CORE = ['plans', 'serviceArea', 'meta'];
const COST = ['rates', 'benefits', 'dentalVision'];

/**
 * Two stages so the panel paints before benefits.json arrives. The heavy files start only once the
 * small ones are in, so on a slow link they do not steal bandwidth from what the first paint needs.
 * Returns { core: Promise<{plans, serviceArea, meta}>, full: Promise<all six files> }.
 */
export function loadDataProgressive(base = DEFAULT_BASE) {
  const core = loadKeys(CORE, base);
  const cost = core.then(() => loadKeys(COST, base));
  core.catch(() => {}); // surfaced through `full` as well; avoid an unhandled rejection
  cost.catch(() => {});
  const full = Promise.all([core, cost]).then(([a, b]) => ({ ...a, ...b }));
  return { core, full };
}

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
