// "What you're assuming": plain-language summaries of the scenario, fine-tune overrides and custom lines.
// DOM-free (shared by the input panel and the results header; unit tested under node).
import { SCENARIOS, OVERRIDE_FIELDS, applyOverrides, lineSpend } from '../engine/scenarios.js';

export const SCENARIO_LABELS = {
  healthy: 'Healthy', typical: 'Typical', condition: 'Managing a condition', worst: 'Worst case', nothing: 'Start from nothing',
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/** "3 primary care visits, 2 specialist visits, ..." for a usage object. */
export function describeUsage(u) {
  if (!u) return '';
  const parts = [
    u.pcpVisits && plural(u.pcpVisits, 'primary care visit'),
    u.specialistVisits && plural(u.specialistVisits, 'specialist visit'),
    u.erVisits && plural(u.erVisits, 'ER visit'),
    u.hospitalStays && plural(u.hospitalStays, 'hospital stay'),
    u.labs && plural(u.labs, 'lab test'),
    u.imaging && plural(u.imaging, 'imaging scan'),
    u.rxMonthly && plural(u.rxMonthly, 'monthly generic prescription'),
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')}.` : 'No care assumed beyond what you add.';
}

const baseOf = (state) => (Object.prototype.hasOwnProperty.call(SCENARIOS, state.scenario) ? SCENARIOS[state.scenario] : SCENARIOS.typical);

/** The scenario's usage with the fine-tune overrides applied. */
export function effectiveUsage(state) {
  return applyOverrides(baseOf(state), state.overrides);
}

/** Overrides that actually differ from the scenario: [{ key, label, from, to }]. */
export function overrideChanges(state) {
  const base = baseOf(state);
  const eff = effectiveUsage(state);
  return Object.entries(OVERRIDE_FIELDS)
    .filter(([k]) => eff[k] !== base[k])
    .map(([k, f]) => ({ key: k, label: f.label, from: base[k], to: eff[k], unit: f.unit }));
}

/** Short text for one change, e.g. "3 hospital stays". */
export function changeText(c) {
  const noun = {
    hospitalStays: ['hospital stay', 'hospital stays'],
    erVisits: ['ER visit', 'ER visits'],
    specialistVisits: ['specialist visit', 'specialist visits'],
    pcpVisits: ['primary care visit', 'primary care visits'],
    rxMonthly: ['monthly prescription', 'monthly prescriptions'],
  }[c.key];
  return `${c.to} ${c.to === 1 ? noun[0] : noun[1]}`;
}

/**
 * Chips for the results header: [{ id, text, tone: 'plain'|'accent'|'warn', title }].
 * Scenario first, then the fine-tune changes (folded into "N adjustments" past two), custom lines, OON flag.
 */
export function assumptionChips(state) {
  const chips = [{
    id: 'scenario',
    text: state.scenario === 'nothing' ? 'Only your own costs' : `${SCENARIO_LABELS[state.scenario] ?? 'Typical'} year`,
    tone: 'plain',
    title: describeUsage(effectiveUsage(state)),
  }];
  const changes = overrideChanges(state);
  if (changes.length > 2) {
    chips.push({ id: 'changes', text: `${changes.length} adjustments`, tone: 'accent',
      title: changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ') });
  } else {
    for (const c of changes) chips.push({ id: `o-${c.key}`, text: changeText(c), tone: 'accent', title: `${c.label}: scenario has ${c.from}` });
  }
  const custom = state.custom ?? [];
  if (custom.length) {
    const spend = custom.reduce((a, l) => a + lineSpend(l), 0);
    chips.push({ id: 'custom', text: plural(custom.length, 'custom line'), tone: 'accent',
      title: `${money(spend)} a year of your own costs before plan cost sharing` });
  }
  if (custom.some((l) => l.outOfNetwork && l.perYear > 0)) {
    chips.push({ id: 'oon', text: 'Out-of-network estimate', tone: 'warn',
      title: 'Out-of-network lines are counted at full cost: OPM publishes no out-of-network cost sharing.' });
  }
  return chips;
}
