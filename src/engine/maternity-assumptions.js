// The three assumptions behind "Having a baby" ESTIMATES, in one place. A plan whose brochure states its maternity
// cost per hospital day, per visit, or separately for the hospital and the doctors gives no way to total it for one
// pregnancy; for those plans (and only when the stated terms themselves were checked in the brochure:
// pipeline/maternity_terms.json, `estimate.assumed`) the engine fills the missing count or share from here.
// The engine (cost.js), the About dialog and every tooltip read these values: change one and everything follows.

export const MATERNITY_ASSUMPTIONS = {
  /** Days in the hospital for the birth, for plans that charge per hospital day. */
  days: {
    value: 3,
    label: '3-day hospital stay',
    what: 'Hospital stay for the birth',
    basis: 'Health Care Cost Institute: births to women with employer insurance in 2020 averaged about 2.9 days '
      + '(vaginal) and 4.0 days (cesarean); 3 days is a rounded blend. HCUP Statistical Brief #131 (all payers, older '
      + 'data) gives 1.9 and 3.5 days.',
    sources: [
      { label: 'Health Care Cost Institute', url: 'https://healthcostinstitute.org/' },
      { label: 'HCUP Statistical Brief #131', url: 'https://www.hcup-us.ahrq.gov/reports/statbriefs/sb131.jsp' },
    ],
  },
  /** Office visits for one pregnancy, for plans that charge per visit. */
  visits: {
    prenatal: 12,
    postpartum: 1,
    label: '12 prenatal visits and 1 postpartum visit',
    what: 'Prenatal and postpartum visits',
    basis: 'The traditional ACOG schedule of 12-14 prenatal visits, plus one postpartum visit. ACOG’s 2025 guidance '
      + 'also allows about 8-9 visits for average-risk pregnancies.',
    sources: [{ label: 'ACOG (American College of Obstetricians and Gynecologists)', url: 'https://www.acog.org/' }],
  },
  /** Share of the pregnancy's charges billed by the hospital (the rest: doctors and other care). */
  split: {
    hospital: 0.5,
    label: '50% hospital, 50% doctors and other care',
    what: 'Hospital and doctors’ shares of the bill',
    basis: 'A placeholder: no published national split of maternity charges between the hospital and the doctors '
      + 'was found, so the charges are split evenly.',
    sources: [],
  },
};

/** The assumption values the engine uses, with optional overrides ({days, prenatal, postpartum, hospitalShare}). */
export function maternityAssumptionValues(over = {}) {
  const A = MATERNITY_ASSUMPTIONS;
  return {
    days: over.days ?? A.days.value,
    prenatal: over.prenatal ?? A.visits.prenatal,
    postpartum: over.postpartum ?? A.visits.postpartum,
    hospitalShare: over.hospitalShare ?? A.split.hospital,
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * The "Estimated: ..." sentence for a plan whose maternity amount uses these assumptions: what is assumed and why
 * (the brochure does not say). `assumed`: the keys used ('days' | 'visits' | 'split'); `note`: optional plan detail.
 */
export function estimateText(assumed, v = maternityAssumptionValues(), note = '') {
  const what = [];
  const why = [];
  const list = assumed ?? [];
  if (list.includes('days')) {
    what.push(`a ${v.days}-day hospital stay (typical for employer-insured births)`);
    why.push('charges per hospital day but does not say how many days');
  }
  if (list.includes('visits')) {
    what.push(`${v.prenatal} prenatal visits and ${v.postpartum} postpartum visit${v.postpartum === 1 ? '' : 's'} (the traditional prenatal schedule)`);
    why.push('charges per visit but does not say how many visits');
  }
  if (list.includes('split')) {
    what.push(`the charges split ${pct(v.hospitalShare)} hospital and ${pct(1 - v.hospitalShare)} doctors and other care (a placeholder: no published national split was found)`);
    why.push('charges the hospital and the doctors differently but does not say how the bill divides');
  }
  const and = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  return `Estimated: assumes ${and(what)}. This plan’s brochure ${why.length === 2 ? why.join(', and ') : and(why)}, so the amount is an estimate, not a figure from the plan.`
    + (note ? ` ${note}` : '');
}
