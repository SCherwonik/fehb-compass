// Pure pieces of the family "See the math" blocks (DOM-free, node tested). `b` is planTotal's breakdown for 2+ members.
import { effectiveUsage, describeUsage, overrideChanges, YEAR_TEXT } from './assumptions.js';
import { memberView, memberLabel, memberOfItem } from './members-model.js';
import { usd } from './format.js';
import { perPersonDeductible } from '../engine/cost.js';

/** True when the plan's deductible is one pot for the whole enrollment (aggregate, or unknown and treated so). */
export const sharedDeductible = (b) => !perPersonDeductible(b.deductibleType);

/**
 * The words after "Toward the deductible" for one person: "of $3,000" with who it is for, or, on a plan whose brochure
 * states an individual threshold (type 'individual') under a family enrollment, "individual stops at $3,500 of the
 * family’s $4,000". `ctx`: a household member's memberBlockInput (shared, familyDeductible), {} for one person.
 */
export function deductibleHow(b, ctx = {}) {
  const family = Number.isFinite(ctx.familyDeductible) ? ctx.familyDeductible : b.onePerson ? b.enrollmentDeductible : null;
  if (b.deductibleType === 'individual' && Number.isFinite(family) && Number.isFinite(b.deductible) && family > b.deductible) {
    return `individual stops at ${usd(b.deductible)} of the family’s ${usd(family)}`;
  }
  return `of ${usd(b.deductible)}${ctx.shared ? ' (shared by the family)' : b.onePerson ? ' (one person)' : ''}`;
}

/** A member's in-network care: what counts toward the out-of-pocket max (out-of-network and not-covered spend do not). */
export const memberInNetwork = (m) => Math.max(0, m.oop - (m.oonPaid || 0) - (m.notCoveredPaid || 0));

/** The whole family's in-network care: what counts toward the family out-of-pocket max. */
export const familyInNetwork = (b) => b.members.reduce((a, m) => a + memberInNetwork(m), 0);

/**
 * What the deductible / out-of-pocket max lines need for member i: `b` (the member's own breakdown plus the plan's
 * per-person limits), `before` (deductible earlier members already used, in member order; 0 unless shared), `shared`,
 * `familyDedMet` (embedded: the family deductible was reached by now, so no more deductible applies to anyone) and
 * `familyCapped` (the family's out-of-pocket max stopped this person's in-network care before their own max did).
 */
export function memberBlockInput(b, i) {
  const shared = sharedDeductible(b);
  const dedBefore = b.members.slice(0, i).reduce((a, m) => a + m.deductiblePaid, 0);
  const before = shared ? dedBefore : 0;
  const m = b.members[i];
  const famDed = Number.isFinite(b.familyDeductible) ? b.familyDeductible : null;
  const familyDedMet = !shared && famDed !== null && dedBefore + m.deductiblePaid >= famDed - 0.5;
  const famMax = Number.isFinite(b.familyOopMax) ? b.familyOopMax : null;
  const inNetBefore = b.members.slice(0, i).reduce((a, x) => a + memberInNetwork(x), 0);
  const own = Number.isFinite(b.oopMax) ? b.oopMax : Infinity;
  const familyCapped = famMax !== null && inNetBefore + memberInNetwork(m) >= famMax - 0.5 && memberInNetwork(m) < own - 0.5;
  return {
    shared, before, familyDedMet, familyDeductible: famDed, familyCapped, familyOopMax: famMax,
    b: { ...m, deductible: b.deductible, oopMax: b.oopMax, deductibleType: b.deductibleType, onePerson: false },
  };
}

/**
 * The family's deductible use for the "Whole family" block: { used, limit } (embedded: everyone's deductible spending
 * against the family deductible; shared: the one pot), or null when the plan has no such deductible.
 */
export function familyDeductibleUse(b) {
  const limit = sharedDeductible(b) ? b.deductible : b.familyDeductible;
  if (!Number.isFinite(limit) || !(limit > 0)) return null;
  return { used: b.members.reduce((a, m) => a + m.deductiblePaid, 0), limit };
}

const money = usd;

/**
 * The note under an out-of-pocket max bar. `used`: in-network care toward `b.oopMax`. `ctx.familyCapped` (a household
 * member whose care the family's max stopped first; ctx.familyOopMax) replaces "below the max", which would be false.
 */
export function oopNote(b, used, hitMax, ctx = {}) {
  const limit = b.oopMax;
  if (hitMax) return `Capped: the plan pays everything in-network after this, so care costs stop at ${money(limit)}.`;
  if (ctx.familyCapped) {
    return `Stopped by the family’s out-of-pocket max: the family reached ${money(ctx.familyOopMax)}, so the plan pays everything in-network after this.`;
  }
  return `${money(limit - used)} below the max. If this year went worse, in-network care would stop at ${money(limit)}.`;
}

// ---------- the notes below the numbers, for a household ----------

/** The "Care assumed ..." heading for one person (`who` set for a household member, absent for the one-person text). */
export function assumedHeading(scenario, fineTuned, who = null) {
  if (scenario === 'nothing') return who ? `Care assumed for ${who}: none beyond their own costs` : 'Care assumed: none beyond your own costs';
  return `Care assumed for ${who ? `${who}: a` : 'a'} ${YEAR_TEXT[scenario] ?? YEAR_TEXT.typical}${fineTuned ? ', fine-tuned' : ''}`;
}

/** Member i's assumed care: { title, text } from their own scenario and fine-tuning. */
export function memberAssumed(state, i) {
  const v = memberView(state, i);
  return { title: assumedHeading(v.scenario, overrideChanges(v).length > 0, i === 0 ? 'you' : memberLabel(state, i)), text: describeUsage(effectiveUsage(v)) };
}

/** What the services list's note says about the deductible, for a household (embedded / individual: each person's own; else shared). */
export const householdDeductibleNote = (b) => (b.deductibleType === 'individual'
  ? `These services are everyone’s added together. As the plan’s brochure states, each person’s deductible stops at ${usd(b.deductible)}, used up by their own first services billed, and everyone’s deductible spending together stops at the family’s ${usd(b.familyDeductible ?? b.enrollmentDeductible)} (see each person above).`
  : b.deductibleType === 'embedded'
  ? 'These services are everyone’s added together. Each person has their own deductible, which their own first services billed use up, until everyone’s deductible spending together reaches the family deductible (see each person above).'
  : 'These services are everyone’s added together. The family shares one deductible, used up by care in the order the people are listed above.');

/** The member name for each entry of a merged list (drug rows, own costs): [{ item, who }] from per-member lists. */
export const labelledByMember = (state, lists) => lists.flatMap((list, i) => (list ?? []).map((item) => ({ item, who: memberLabel(state, i) })));

/** A medication that is not counted, with the person it is for (items beyond the count keep their own member index). */
export const itemWho = (state, it) => memberLabel(state, memberOfItem(it));

// known-gap kinds that are a brochure cost the estimate leaves out (the others are sentences of their own)
const LEFT_OUT = new Set(['facility_deductible', 'drug_deductible']);

/**
 * The note for one known gap (engine breakdown.gaps or capNotes entry), and where the brochure says so: what the
 * estimate leaves out, or (kind 'conflict', 'cap_not_stated' and the like) the gap's own sentence.
 */
export const gapNote = (g) => `${LEFT_OUT.has(g.kind) ? 'Not included in this estimate: ' : ''}${g.text} (Brochure ${g.brochure}, page ${g.page}.)`;

/**
 * The firmness line for a total with known gaps: a brochure cost it leaves out, a brochure that contradicts itself, a
 * brochure rule the estimate does not model (kind 'rule_differs'), or several of these.
 */
export function gapFirmness(gaps) {
  const conflict = gaps.some((g) => g.kind === 'conflict');
  const differs = gaps.some((g) => g.kind === 'rule_differs');
  const missing = gaps.some((g) => LEFT_OUT.has(g.kind));
  const why = [missing && 'this total leaves out a cost the plan’s brochure lists', conflict && 'the plan’s brochure contradicts itself about a figure it uses',
    differs && 'the plan’s brochure describes a rule this estimate does not model']
    .filter(Boolean).join(', and ');
  return `Estimated: ${why} (see the note below), and part of it may depend on the assumed prices listed below.`;
}

/**
 * The card's "Estimated" tag tooltip, naming the real reason(s) from planTotal's breakdown: a known gap (a brochure
 * cost the total leaves out), a brochure that contradicts itself, a brochure rule the estimate does not model, and
 * assumed prices (`pricesMatter`; absent counts as true). Assumed prices alone keep the plain sentence.
 */
export function estimatedTitle(b) {
  const gaps = b?.gaps ?? [];
  const prices = b?.pricesMatter !== false;
  const why = [
    gaps.some((g) => LEFT_OUT.has(g.kind)) && 'this total leaves out a cost the plan’s brochure lists (a known gap)',
    gaps.some((g) => g.kind === 'conflict') && 'the plan’s brochure contradicts itself about a figure this total uses',
    gaps.some((g) => g.kind === 'rule_differs') && 'the plan’s brochure describes a rule this estimate does not model',
  ].filter(Boolean);
  if (!why.length) return 'Part of this total depends on assumed prices for care. See the math.';
  if (prices) why.push('part of it depends on assumed prices for care');
  const text = why.length < 3 ? why.join(', and ') : `${why.slice(0, -1).join(', ')}, and ${why.at(-1)}`;
  return `Estimated: ${text}. See the math.`;
}
