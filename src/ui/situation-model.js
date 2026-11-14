// "Your situation" bar: the one-line summary chips and the open-or-closed decision on first load.
// DOM-free (unit tested); the bar itself is src/ui/situation.js.
import { STATE_NAMES } from '../data.js';
import { decodeState, encodeState, sanitizeState } from '../state.js';
import { overrideChanges } from './assumptions.js';
import { DENTAL_PRESETS, VISION_PRESETS } from '../engine/dental.js';

const STATUS = { active: 'active employee', retiree: 'retiree' };
const ENROLLMENT = { self: 'Self only', self_plus_one: 'Self plus one', family: 'Self and family' };
const SCENARIO = { healthy: 'Healthy year', typical: 'Typical year', condition: 'Managing a condition', worst: 'Worst case', nothing: 'Only my own costs' };
const AREA = { nationwide: 'Nationwide plans only', regional: 'Regional plans only' };

const list = (names, one, many) => (names.length === 1 ? `${one}: ${names[0]}` : `${names.length} ${many}`);

/**
 * summaryChips(state, opts) -> [{ id, text, title? }] in reading order: who, where, then what the active tab uses.
 * opts: planName(code) -> 2026 FEHB plan name | null; medsCount: number;
 *       dvFilter: { carriers, area, oon, in2 } for the active dental/vision tab; dvPlanName(id) -> name | null.
 * Medication names never appear (only a count), the same rule as the printed summary.
 */
export function summaryChips(state, { planName = () => null, medsCount = 0, dvFilter = null, dvPlanName = () => null } = {}) {
  const s = sanitizeState(state);
  const out = [];
  out.push({ id: 'who', text: `${ENROLLMENT[s.enrollment]}, ${STATUS[s.status]}` });
  const st = s.location.state;
  const where = st ? STATE_NAMES[st] ?? st : null;
  if (where || s.location.zip) {
    out.push({ id: 'where', text: [where, s.location.zip && `ZIP ${s.location.zip}`].filter(Boolean).join(', ') });
  } else {
    out.push({ id: 'where', text: 'No state chosen', tone: 'warn', title: 'Only nationwide plans are shown until you choose a state.' });
  }

  if (s.tab === 'medical') {
    const adjusted = s.custom.length > 0 || overrideChanges(s).length > 0;
    out.push({ id: 'scenario', text: `${SCENARIO[s.scenario]}${adjusted ? ', adjusted' : ''}` });
    if (s.currentPlan2026) {
      out.push({ id: 'plan', text: `2026 plan: ${planName(s.currentPlan2026) ?? s.currentPlan2026}` });
    }
    if (s.account !== 'any') out.push({ id: 'account', text: `${s.account.toUpperCase()} plans only` });
    if (s.networks.length) out.push({ id: 'networks', text: list(s.networks, 'Network', 'networks'), title: s.networks.join(', ') });
    if (s.glp1) out.push({ id: 'glp1', text: 'Covers GLP-1 for weight loss' });
    if (s.dental) out.push({ id: 'dental', text: 'Dental and vision added' });
    if (medsCount > 0) out.push({ id: 'meds', text: `${medsCount} ${medsCount === 1 ? 'medication' : 'medications'}` });
    return out;
  }

  const kind = s.tab === 'vision' ? 'vision' : 'dental';
  const preset = kind === 'dental' ? DENTAL_PRESETS[s.dentalUse] : VISION_PRESETS[s.visionUse];
  out.push({ id: 'use', text: `${kind === 'dental' ? 'Dental' : 'Vision'}: ${preset?.label ?? ''}`.trim() });
  const mine = kind === 'dental' ? s.myDental : s.myVision;
  if (mine) out.push({ id: 'plan', text: `2026 plan: ${dvPlanName(mine) ?? mine}` });
  const f = dvFilter ?? {};
  const carriers = Array.isArray(f.carriers) ? f.carriers : [];
  if (carriers.length) out.push({ id: 'carriers', text: list(carriers, 'Carrier', 'carriers'), title: carriers.join(', ') });
  if (AREA[f.area]) out.push({ id: 'area', text: AREA[f.area] });
  if (f.oon) out.push({ id: 'oon', text: 'Pays out of network' });
  if (f.in2 && kind === 'dental') out.push({ id: 'in2', text: 'Second network tier' });
  return out;
}

/** The editor's open/closed choice is remembered per main tab: Health plans, or Dental & Vision (both sub-tabs). */
export const tabGroup = (tab) => (tab === 'dental' || tab === 'vision' ? 'dv' : 'medical');

/** Parse the remembered choice ({ medical?: boolean, dv?: boolean }) from its saved JSON; junk -> {}. */
export function parseOpenPrefs(raw) {
  let v = null;
  try { v = JSON.parse(raw ?? 'null'); } catch { v = null; }
  const out = {};
  if (v && typeof v === 'object') for (const k of ['medical', 'dv']) if (typeof v[k] === 'boolean') out[k] = v[k];
  return out;
}

/**
 * Open the editor for this tab? The person's own choice for the tab wins; otherwise startExpanded.
 * remembered: parseOpenPrefs output; fallback: what to use when nothing is remembered (default startExpanded).
 */
export function situationOpen({ tab = 'medical', remembered = {}, hash = '', stored = null, fallback } = {}) {
  const r = remembered?.[tabGroup(tab)];
  if (typeof r === 'boolean') return r;
  return typeof fallback === 'boolean' ? fallback : startExpanded({ hash, stored });
}

/**
 * Should the situation editor start open? Yes on a first visit (no link state, nothing saved, or only defaults
 * saved); no when the page opens from a link with state or from inputs saved on this device.
 * hash: location.hash; stored: the raw saved state string (state.js STORAGE_KEY) or null.
 */
export function startExpanded({ hash = '', stored = null } = {}) {
  if (typeof hash === 'string' && encodeState(decodeState(hash)) !== '') return false;
  if (typeof stored !== 'string' || !stored) return true;
  try {
    return encodeState(sanitizeState(JSON.parse(stored))) === '';
  } catch {
    return true;
  }
}
