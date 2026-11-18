# 2027 individual deductible threshold: report

Date: 2026-11-18. Base: 5744f3c.

## What changed

- **New rule, stated by the brochure.** Some HDHPs say that under Self Plus One or Self and Family, one person's
  deductible stops at an individual threshold below the family deductible, and the rest of the family deductible can be
  met by one or more family members. `pipeline/individual_deductibles.json` lists such plans. `pipeline/build_data.py`
  (`apply_individual_deductibles`) attaches the threshold as `deductible_individual` and its source as
  `deductible_individual_source`. The build checks that the plan exists, that the amounts are finite numbers for
  self_plus_one and family, that each is at most the enrollment deductible and at least the Self Only deductible, that
  no plan is listed twice, that the quote is under 15 words, and that the quote is on the cited page.
- **Aetna HealthFund HDHP (224), brochure 73-828.** "Once an individual meets a $3,500 deductible under the Self Plus
  One" (p15, Section 1). The same sentence is on p35 (Section 4), p26, p42, p60, p62, p77, p86, p90, p93 and p97.
  Threshold: $3,500 for Self Plus One and for Self and Family. The family deductible is $4,000 and Self Only is $2,000.
  Aetna Direct (N61) is in the same brochure, says "the Self Only deductible" instead, and is not changed.
- **Engine.** `deductibleType` returns `'individual'` when a plan has a threshold. For Self Plus One and Family,
  `personLimits` uses the threshold as each person's in-network deductible. `familyTotal` caps the household at the
  family deductible with the same `famDedUsed` tally that embedded plans use. Self enrollment and out-of-network limits
  do not change.
- **UI.** See the math labels the deductible bar "individual stops at $3,500 of the family’s $4,000" (`deductibleHow`).
  The one-person note, the household services note, the family-deductible bar note and the board's "Deductible type"
  row ("Individual threshold (brochure)") all say that the brochure states this rule.
- **Conflict gaps that affect cost.** A known gap of kind `conflict` may now have `affects_cost: true`, and any gap can
  carry an optional `enrollments` list. `costGaps(benefits, enrollment)` filters on that list. For a conflict, the math
  note shows the gap's own sentence (with no "Not included in this estimate:" prefix), and the firmness line says the
  brochure contradicts itself.
  - **KX1 (TakeCare HDHP, 73-776).** "The deductible is $2,000 per person ($4,000 per Self Plus One enrollment" (p102)
    contradicts p104: "deductible can be satisfied by one or more family members". The estimate keeps the shared $4,000
    deductible and may be too high by up to $2,000.
  - **L14 (Kaiser Permanente WA Options HDHP, 73-051).** "Self Plus One or Self and Family enrollment is $3,500 per
    family unit" (p26) contradicts the Summary: "$1,650 per person" (p172), and "$1,750 per person" one line later. The
    estimate keeps the shared $3,500 deductible and may be too high for one person by up to $1,850.
  - Both gaps apply to Self Plus One and Self and Family only, so Self results are unchanged.
- **About and README** now describe the rule (with Aetna as the example) and the two brochures that contradict
  themselves.

## 9K4 was not flagged

The brief described the Altius HDHP (9K4, 73-564) as contradicting itself. It does not. All four "Once an individual
meets the Self Only deductible" sentences (p15, p30, p36 and later Section 5 pages) are about the High and Standard
Options ($50/$100 and $100/$200). Every HDHP page (p17, p22, p30, p104, p105, p120, p129, p133, p136, p139, p146, p174)
says "Once an individual meets a deductible of $3,500 under the Self Plus One", with a $3,600 family deductible. A
user-facing note saying the brochure contradicts itself would be untrue, so 9K4 was left unchanged.

9K4 is a consistent case of the same rule. It could be added to `individual_deductibles.json` as
{self_plus_one: 3500, family: 3500}, page 30. For one person the most this would lower the deductible is $100.

## Money effect on 224 (2027, Self and Family, active employee, everyone in the same scenario)

| Sick people (scenario) | Before total | After total | Deductible paid, before → after |
|---|---|---|---|
| 1 (chronic condition) | $11,699.10 | $11,274.10 (−$425) | $4,000 → $3,500 |
| 2 (chronic condition) | $13,139.10 | $13,139.10 | $4,000 → $4,000 (3,500 + 500) |
| 4 (chronic condition) | $16,019.10 | $16,019.10 | $4,000 → $4,000 |
| 1 (worst case) | $14,359.10 | $14,359.10 | $4,000 → $3,500 (capped at the $7,500 out-of-pocket max either way) |
| 2 (worst case) | $21,859.10 | $21,859.10 | $4,000 → $4,000 |
| 4 (worst case) | $21,859.10 | $21,859.10 | $4,000 (family out-of-pocket max $15,000 reached) |

Self Plus One shows the same one-person effect. A mixed household can cost more than before. Worst plus condition went
from $15,799.10 to $16,224.10 (+$425): the first person now stops at $3,500, so $500 of deductible falls on the second
person's care. Before, the first person used up the whole $4,000 and was capped at the out-of-pocket max regardless.

## Verification

- Before and after comparison against 5744f3c (git worktree in the OS temp directory): 12,500 results. These cover
  every plan with rates in 2026 and 2027, all 5 scenarios, Self / Self Plus One / Family, active and retiree, one
  person, and 5 household mixes. Totals differ only for 224 under Self Plus One and Family. Firmness differs only for
  KX1 and L14 under Self Plus One and Family ('healthy': fixed → estimated). Self is identical for every plan.
- `python -I -m pytest pipeline/tests -q`: 290 passed. `node --test tests/*.test.js tests/engine/*.test.js`: 466
  passed.
- Browser check of 224, Self and Family, 4 people: the bars read "individual stops at $3,500 of the family’s $4,000",
  and the family bar is $4,000 of $4,000. There were no console errors.
