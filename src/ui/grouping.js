// Board grouping: split an already ranked list of plan rows into labelled segments.
// Pure and DOM-free (unit tested under node). Generic over the row shape so the dental/vision
// board can reuse it: a row needs `code`, and `plan.network_family` / `plan.type` / `account`
// for the carrier / type / account modes.

export const GROUP_MODES = ['top3', 'carrier', 'type', 'account', 'all'];

/** Control labels for the board's "Show" control, in display order. */
export const GROUP_LABELS = {
  top3: 'Top 3 overall',
  carrier: 'Top 3 per carrier',
  type: 'Top 3 per plan type',
  account: 'Top 3 per account',
  all: 'Everything',
};

// OPM's plan `type` is FFS | HMO | HDHP. FFS plans are the PPO-network plans; every HSA plan is an HDHP,
// so the data's own HDHP type is the HDHP group (no need to infer it from deductibles).
const TYPE_LABELS = { FFS: 'PPO (fee-for-service)', HMO: 'HMO', HDHP: 'High-deductible (HDHP)' };
const ACCOUNT_LABELS = { HSA: 'With an HSA', HRA: 'With an HRA', none: 'No savings account' };

const KEYS = {
  carrier: (r) => r.plan?.network_family || 'Other',
  type: (r) => r.plan?.type || 'Other',
  account: (r) => (r.account === 'HSA' || r.account === 'HRA' ? r.account : 'none'),
};
const LABELS = {
  carrier: (k) => (k === 'Other' ? 'Other carriers' : k),
  type: (k) => TYPE_LABELS[k] ?? k,
  account: (k) => ACCOUNT_LABELS[k] ?? k,
};

/**
 * groupPlans(rows, mode, n = 3) -> [{ key, label, rows, total }]
 * rows: ranked best-first (by total). Each output row is a shallow copy carrying `rank`: the row's own
 * `rank` when it already has one, else its 1-based position in `rows` (the global rank, kept in groups).
 * total: how many rows the group had before the top-n cut.
 * 'top3' -> one group of the first n; 'all' -> one group of everything;
 * 'carrier' | 'type' | 'account' -> top n per group, groups ordered by their best rank.
 * Order is stable (ties keep input order). Empty input -> [].
 */
export function groupPlans(rows, mode, n = 3) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const take = Number.isInteger(n) && n > 0 ? n : 3;
  const ranked = rows.map((r, i) => ({ ...r, rank: Number.isInteger(r.rank) ? r.rank : i + 1 }));
  const m = GROUP_MODES.includes(mode) ? mode : 'top3';

  if (m === 'all') return [{ key: 'all', label: 'All plans', rows: ranked, total: ranked.length }];
  if (m === 'top3') return [{ key: 'top3', label: `Top ${take} overall`, rows: ranked.slice(0, take), total: ranked.length }];

  // Map keeps first-seen order, and rows arrive best-first, so groups come out ordered by best rank.
  const groups = new Map();
  for (const r of ranked) {
    const key = KEYS[m](r);
    let g = groups.get(key);
    if (!g) { g = { key, label: LABELS[m](key), rows: [], total: 0 }; groups.set(key, g); }
    g.total += 1;
    if (g.rows.length < take) g.rows.push(r);
  }
  return [...groups.values()];
}
