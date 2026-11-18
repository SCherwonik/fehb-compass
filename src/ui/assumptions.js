// "What you're assuming": plain-language summaries of the scenario, fine-tune overrides and custom lines.
// DOM-free (shared by the input panel and the results header; unit tested under node).
import { SCENARIOS, OVERRIDE_FIELDS, MAX_CUSTOM_LINES, applyOverrides, lineSpend } from '../engine/scenarios.js';
import { memberCount } from '../state.js';
import { memberView, memberLabel, isUncovered } from './members-model.js';

export const SCENARIO_LABELS = {
  healthy: 'Healthy', typical: 'Typical', condition: 'Managing a condition', worst: 'Worst case', nothing: 'Start from nothing',
};

/** How each scenario reads as "a ___" in a sentence (the whole phrase, so each one is grammatical on its own). */
export const YEAR_TEXT = { healthy: 'healthy year', typical: 'typical year', condition: 'year managing a condition', worst: 'worst-case year' };
const cap = (t) => t[0].toUpperCase() + t.slice(1);

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

const yearText = (scenario) => (scenario === 'nothing' ? 'Only your own costs' : cap(YEAR_TEXT[scenario] ?? YEAR_TEXT.typical));

const scenarioKey = (k) => (Object.prototype.hasOwnProperty.call(SCENARIOS, k) ? k : 'typical');

/** The custom lines that are costed: those for people the enrollment covers. */
export const coveredLines = (state) => (state.custom ?? []).filter((l) => !isUncovered(l, memberCount(state)));

/**
 * How the people on the enrollment are set up: { count, keys (each person's scenario), same, allNothing, adjusted }.
 * `adjusted`: someone's year is fine-tuned, or a costed custom line adds to it.
 */
export function household(state) {
  const count = memberCount(state);
  const views = Array.from({ length: count }, (_, i) => memberView(state, i));
  const keys = views.map((v) => scenarioKey(v.scenario));
  return {
    count, views, keys,
    same: keys.every((k) => k === keys[0]),
    allNothing: keys.every((k) => k === 'nothing'),
    adjusted: coveredLines(state).length > 0 || views.some((v) => overrideChanges(v).length > 0),
  };
}

/**
 * One short phrase for a household's expected care (2+ people): "4 people, typical year each",
 * "3 people, mixed years, adjusted", "3 people, no assumed care", "3 people, the household's own costs".
 */
export function householdCareText(state) {
  const hh = household(state);
  if (hh.allNothing) return `${hh.count} people, ${coveredLines(state).length ? 'the household’s own costs' : 'no assumed care'}`;
  const base = hh.same ? `${YEAR_TEXT[hh.keys[0]]} each` : 'mixed years';
  return `${hh.count} people, ${base}${hh.adjusted ? ', adjusted' : ''}`;
}

/** The scenario chip for a household: one shared scenario, or a short "mixed" note with each person in the title. */
function householdScenarioChip(state, count) {
  const hh = household(state);
  const one = (k) => (k === 'nothing' ? 'No assumed care' : yearText(k));
  const title = hh.views.map((v, i) => `${memberLabel(state, i)}: ${one(hh.keys[i])}. ${describeUsage(effectiveUsage(v))}`).join(' ');
  return {
    id: 'scenario',
    text: hh.allNothing ? `${count} people, no assumed care`
      : hh.same ? `${count} people, ${yearText(hh.keys[0]).toLowerCase()} each` : `${count} people, mixed scenarios`,
    tone: 'plain',
    title,
  };
}

/**
 * The caption under a card's expected care (and the Board's "Expected care" cell). One person: the scenario's year
 * ("typical year", "start-from-nothing year"), or "..., adjusted" / "your own costs" once fine-tuning or a costed
 * custom line changes it. A household: householdCareText.
 */
export function careCaption(state) {
  if (memberCount(state) > 1) return householdCareText(state);
  const k = scenarioKey(state.scenario);
  const adjusted = coveredLines(state).length > 0 || overrideChanges(state).length > 0;
  if (adjusted) return k === 'nothing' ? 'your own costs' : `${YEAR_TEXT[k]}, adjusted`;
  return k === 'nothing' ? 'start-from-nothing year' : YEAR_TEXT[k];
}

/**
 * Chips for the results header: [{ id, text, tone: 'plain'|'accent'|'warn', title }].
 * Scenario first, then the fine-tune changes (folded into "N adjustments" past two), custom lines, OON flag.
 * With several covered people the scenario and adjustments cover everyone; lines for people beyond the enrollment are not counted.
 */
export function assumptionChips(state) {
  const count = memberCount(state);
  const chips = [count > 1 ? householdScenarioChip(state, count) : {
    id: 'scenario',
    text: yearText(state.scenario),
    tone: 'plain',
    title: describeUsage(effectiveUsage(state)),
  }];
  const changes = [];
  for (let i = 0; i < count; i++) {
    const v = memberView(state, i);
    for (const c of overrideChanges(i === 0 ? state : v)) changes.push({ ...c, who: count > 1 ? memberLabel(state, i) : '' });
  }
  const ctext = (c) => (c.who ? `${changeText(c)} (${c.who})` : changeText(c));
  if (changes.length > 2) {
    chips.push({ id: 'changes', text: `${changes.length} adjustments`, tone: 'accent',
      title: changes.map((c) => `${c.who ? `${c.who}: ` : ''}${c.label}: ${c.from} → ${c.to}`).join('; ') });
  } else {
    for (const c of changes) chips.push({ id: `o-${c.who ? `${c.who}-` : ''}${c.key}`, text: ctext(c), tone: 'accent', title: `${c.who ? `${c.who}, ` : ''}${c.label}: scenario has ${c.from}` });
  }
  const custom = coveredLines(state);
  if (custom.length) {
    const spend = custom.reduce((a, l) => a + lineSpend(l), 0);
    chips.push({ id: 'custom', text: plural(custom.length, 'custom line'), tone: 'accent',
      title: `${money(spend)} a year of ${count > 1 ? 'the household’s' : 'your'} own costs before plan cost sharing` });
  }
  if (state.droppedCustom > 0) {
    chips.push({ id: 'dropped', text: `${plural(state.droppedCustom, 'line')} not in link`, tone: 'warn', dismissible: true,
      title: droppedText(state.droppedCustom) });
  }
  if (custom.some((l) => l.outOfNetwork && l.perYear > 0)) {
    chips.push({ id: 'oon', text: 'Out-of-network estimate', tone: 'warn',
      title: 'Out-of-network lines are counted at full cost: OPM publishes no out-of-network cost sharing.' });
  }
  return chips;
}

/** Notice for a pasted link whose extra custom lines live only in the sender's browser. */
export function droppedText(n) {
  return `This link had ${n} more custom ${n === 1 ? 'line' : 'lines'} that couldn’t be included in the link.`;
}

/** Editor footer: "N of 25 lines, $X a year" (spend before plan cost sharing), from the lines themselves. */
export function customSummary(lines) {
  const list = lines ?? [];
  const head = `${list.length} of ${MAX_CUSTOM_LINES} lines`;
  if (!list.length) return head;
  return `${head}, ${money(list.reduce((a, l) => a + lineSpend(l), 0))} a year`;
}

/** True when the IN-NETWORK part of expected care reached the in-network OOP max (OON spend is separate). */
export function inNetworkAtMax(cost) {
  const max = cost?.breakdown?.oopMax;
  if (max == null) return false;
  return (cost.oop - (cost.breakdown.oonPaid || 0) - (cost.breakdown.notCoveredPaid || 0)) >= max - 0.5;
}
