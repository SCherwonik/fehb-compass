// Number and text formatting for results. DOM-free.

const USD0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const USD2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MINUS = '−';

export const DASH = '—';

/** $1,234 (whole dollars). Missing -> em dash. */
export function usd(n) {
  if (n == null || !Number.isFinite(n)) return DASH;
  const r = Math.round(n);
  return r < 0 ? `${MINUS}${USD0.format(-r)}` : USD0.format(r);
}

/** $7.50 when there are cents, else $8. */
export function usdExact(n) {
  if (n == null || !Number.isFinite(n)) return DASH;
  return Number.isInteger(n) ? USD0.format(n) : USD2.format(n);
}

/** +$260 / −$120 / $0 for deltas. */
export function signedUsd(n) {
  if (n == null || !Number.isFinite(n)) return DASH;
  const r = Math.round(n);
  if (r === 0) return '$0';
  return r > 0 ? `+${USD0.format(r)}` : `${MINUS}${USD0.format(-r)}`;
}

export function signedPct(n) {
  if (n == null || !Number.isFinite(n)) return '';
  if (n === 0) return '0%';
  return n > 0 ? `+${n}%` : `${MINUS}${Math.abs(n)}%`;
}

/** Short cost-share text for one copay entry: "$20", "15%", "$0", or null when unpriceable. */
export function shareText(c) {
  if (!c) return null;
  if (c.kind === 'usd' && c.value != null) return usdExact(c.value);
  if (c.kind === 'pct' && c.value != null) return `${c.value}%`;
  if (c.kind === 'text' && /nothing/i.test(c.raw || '')) return '$0';
  return null;
}

/** "Primary care $20 · Specialist $40 · Generic Rx $7.50 · 20% coinsurance" */
export function costShareSummary(benefits, coinsurance) {
  const c = benefits?.copays ?? {};
  const parts = [];
  const add = (label, key) => {
    const t = shareText(c[key]);
    if (t) parts.push(`${label} ${t}`);
  };
  add('Primary care', 'primary_care');
  add('Specialist', 'specialist');
  add('Generic Rx', 'rx_tier1');
  if (coinsurance != null) parts.push(`${coinsurance}% coinsurance`);
  return parts.join(' · ');
}

/** Tone of a year-over-year delta where higher is worse for the member. */
export function deltaTone(n) {
  if (n == null || !Number.isFinite(n) || Math.round(n) === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}
