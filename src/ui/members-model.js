// Household helpers for the input panel: who is on the enrollment, what to call them, and how a change to one
// person is written back to the state. DOM-free (node tested).
import { memberCount, MAX_MEMBERS } from '../state.js';
import { SCENARIOS } from '../engine/scenarios.js';

/** A member beyond you who has not been set up yet. */
export const DEFAULT_OTHER = Object.freeze({ name: '', scenario: 'typical', overrides: Object.freeze({}) });

/** The state's entry for member i (0 = you, whose care lives in scenario/overrides; others in others[i-1]). */
export function memberView(state, i) {
  if (i === 0) return { name: '', scenario: state.scenario, overrides: state.overrides };
  const o = state.others?.[i - 1];
  return o ? { name: o.name ?? '', scenario: o.scenario, overrides: o.overrides ?? {} } : { ...DEFAULT_OTHER, overrides: {} };
}

/** What to call member i: "You", the typed name, or "Person N". */
export function memberLabel(state, i) {
  if (i === 0) return 'You';
  const name = state.others?.[i - 1]?.name;
  return name && name.trim() ? name.trim() : `Person ${i + 1}`;
}

/** [[value, label]] for every member on the enrollment (value is the member index as a string). */
export function memberOptions(state) {
  return Array.from({ length: memberCount(state) }, (_, i) => [String(i), memberLabel(state, i)]);
}

/**
 * The next `others` array with a patch applied to the entry for others[index]. Entries before it that do not exist
 * yet are filled with defaults; entries after it (members beyond the current count) are kept as they are.
 */
export function withOther(others, index, patch) {
  const out = Array.isArray(others) ? others.map((o) => ({ ...o })) : [];
  while (out.length <= index && out.length < MAX_MEMBERS - 1) out.push({ ...DEFAULT_OTHER, overrides: {} });
  if (index >= out.length) return out;
  out[index] = { ...out[index], ...patch };
  return out;
}

/** The patch for a state to write member i's change: { scenario } / { overrides } for you, { others } for the rest. */
export function memberPatch(state, i, change) {
  if (i === 0) return change;
  return { others: withOther(state.others, i - 1, change) };
}

/** Overrides after setting one field: a value equal to the scenario's own is dropped (no stale override). */
export function nextOverrides(scenarioKey, overrides, key, value, field) {
  const base = (SCENARIOS[scenarioKey] ?? SCENARIOS.typical)[key];
  const clamped = Math.min(field.max, Math.max(field.min, value));
  const next = { ...overrides };
  if (clamped === base) delete next[key]; else next[key] = clamped;
  return next;
}

/** The member the "For" selectors start on: the open row of "Covered people" (set by members.js), clamped to the count. */
const focus = { index: 0 };
export const setFocusedMember = (i) => { focus.index = Number.isInteger(i) && i >= 0 ? i : 0; };
export const focusedMember = (state) => Math.min(focus.index, memberCount(state) - 1);

/** A key that changes when the names or the count do, so pickers rebuild only then. */
export const memberKey = (state) => memberOptions(state).map(([, l]) => l).join('\u0001');
