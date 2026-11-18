// Pure pieces of the family "See the math" blocks (DOM-free, node tested). `b` is planTotal's breakdown for 2+ members.
import { effectiveUsage, describeUsage, overrideChanges, YEAR_TEXT } from './assumptions.js';
import { memberView, memberLabel, memberOfItem } from './members-model.js';

/** True when the plan's deductible is one pot for the whole enrollment (aggregate, or unknown and treated so). */
export const sharedDeductible = (b) => b.deductibleType !== 'embedded';

/** A member's in-network care: what counts toward the out-of-pocket max (out-of-network and not-covered spend do not). */
export const memberInNetwork = (m) => Math.max(0, m.oop - (m.oonPaid || 0) - (m.notCoveredPaid || 0));

/** The whole family's in-network care: what counts toward the family out-of-pocket max. */
export const familyInNetwork = (b) => b.members.reduce((a, m) => a + memberInNetwork(m), 0);

/**
 * What the deductible / out-of-pocket max lines need for member i: `b` (the member's own breakdown plus the plan's
 * per-person limits), `before` (deductible earlier members already used, in member order; 0 unless shared) and `shared`.
 */
export function memberBlockInput(b, i) {
  const shared = sharedDeductible(b);
  const before = shared ? b.members.slice(0, i).reduce((a, m) => a + m.deductiblePaid, 0) : 0;
  const m = b.members[i];
  return {
    shared, before,
    b: { ...m, deductible: b.deductible, oopMax: b.oopMax, deductibleType: b.deductibleType, onePerson: false },
  };
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

/** What the services list's note says about the deductible, for a household (embedded: each person's own; else shared). */
export const householdDeductibleNote = (b) => (b.deductibleType === 'embedded'
  ? 'These services are everyone’s added together. Each person has their own deductible, which their own first services billed use up (see each person above).'
  : 'These services are everyone’s added together. The family shares one deductible, used up by care in the order the people are listed above.');

/** The member name for each entry of a merged list (drug rows, own costs): [{ item, who }] from per-member lists. */
export const labelledByMember = (state, lists) => lists.flatMap((list, i) => (list ?? []).map((item) => ({ item, who: memberLabel(state, i) })));

/** A medication that is not counted, with the person it is for (items beyond the count keep their own member index). */
export const itemWho = (state, it) => memberLabel(state, memberOfItem(it));
