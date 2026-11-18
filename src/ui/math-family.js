// Pure pieces of the family "See the math" blocks (DOM-free, node tested). `b` is planTotal's breakdown for 2+ members.

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
