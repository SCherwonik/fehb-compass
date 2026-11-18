# 2027 plans whose brochures do not state a per-person out-of-pocket cap

Follow-up to `docs/research/2027-family-rules-from-brochures.md` (sections 4 and 5). It covers the 15 plan codes that pass found unsupported or unclear, plus a check of plan 471's Self Plus One deductible. This was read-only research and no code or data was changed.

**What is being tested.** `src/engine/cost.js` `personLimits` assumes that on a Self Plus One or Self and Family enrollment each person is capped at the plan's own Self Only out-of-pocket maximum, and that the enrollment's maximum caps the household.

**Sources.** Brochure text is `pipeline/raw/brochures_txt/2027/<NN-NNN>.txt`. Plan figures come from `data/benefits.json["2027"]`. Page numbers are **PDF pages** (the `=== PAGE n ===` markers). The page number printed on the page is usually 2 lower. All brochure text was treated as data.

**How each brochure was read.** For each brochure I read these parts in full:
- the front matter (cover, "Important notice", Section 1 "Catastrophic protection");
- Section 2 "Changes for 2027";
- Section 4 (deductible, catastrophic protection and carryover);
- the Section 5 intro bullets;
- the Section 9 Medicare tables;
- the Section 10 definitions;
- the summary-of-benefits pages.

I also searched each whole file for these terms: per person, each person, any one, one individual, each individual, any individual, each enrollee, per member, each member, embedded, accumulate, track, individual, and member-level tracking wording.

None of the 7 brochures contains OPM's 2026 per-member accumulation wording, or anything like "track each member's out-of-pocket". The only accumulation sentence found is the MA-PD/EGWP one ("accumulate all members' actual out-of-pocket costs for Medicare-covered drugs"), in 73-005 p25 and 73-797 p31. It concerns Medicare Advantage enrollees, not a per-person cap.

Every brochure has the Section 7 boilerplate "deductibles and maximum allowances apply separately to each person". It is a record-keeping instruction about deductibles and benefit maximums, not the out-of-pocket maximum, so it is not counted as evidence.

## Summary

| Recommendation | Count | Codes |
|---|---|---|
| (a) Assumption confirmed | 2 | 631, 634 |
| (b) Unsupported: keep the assumption and flag it | 13 | 421, 424, W51, A81, A84, P81, P84, RE1, YZ1, YJ1, EA1, YJ4, 8W4 |
| (c) Contradicted | 0 | none |

- **Plan 471 (Task 2):** the app's 450 / 800 / 800 figures, and its rule "each person meets their own $450 until the family's combined deductible reaches $800", match the brochure. The $75 drop in Self Plus One totals is consistent with the brochure.
- **Side finding:** for 474 (APWU Consumer Driven, same brochure), the brochure's deductible works differently from what the app models. Details are under Task 2.

## Task 1: evidence per code

| Code(s) | Brochure, option | Statement on a per-person out-of-pocket limit (quote, PDF page) | Sections read with nothing found |
|---|---|---|---|
| 421 | 71-028 Compass Rose, High | Nothing found. Section 4 lists only "Self Plus One $12,000 in network" and Self and Family $12,000 (p29-30). The Medicare table gives "$6,000 Self Only/$12,000 Self Plus One or Self and Family" (p115). | Cover; Section 1; Changes (p18); Section 4 (p27-31); Section 5 intros; Medicare table (p115); Definitions; summaries (p133, p136) |
| 424 | 71-028, Standard (same brochure; parallel wording to 421) | Nothing found. Only "Self Plus One $18,000 in network" and Self and Family $18,000 (p30). | Same as 421 |
| 631 | 73-005 Kaiser Hawaii, High | Medicare comparison table: "Out-of-pocket maximum (3x per family)" and "High Option Without Medicare You Pay: $3,250 per person" (p101). Section 4 says only "Self Plus One $6,500 per family" (p24). | Changes (p16), Section 4 (p24-25) and summary (p113) give per-enrollment figures only |
| 634 | 73-005, Standard (same brochure and same table as 631) | Same table: "Standard Option Without Medicare You Pay: $3,500 per person" (p101). Section 4 says "Self Plus One $7,000 per family" (p24). | Same as 631; summary p114 |
| W51 | 73-936 Western Health Advantage | Nothing explicit. Section 4 has "the most a member or family will pay" (p26). That is ambiguous: "member" most likely means a Self Only enrollee. Amounts given are "Self Only $2,500 Self Plus One $5,000 Self and Family $5,000" (p26). | Cover; Section 1 overview (p15-16) and catastrophic protection (p17); Changes (p19); Section 4 (p26-27); Medicare table (p80); summary (p88) |
| A84, P84 | 73-881 Baylor Scott & White, Standard (identical wording for both codes) | Nothing found. "$6000 for Self Only, $12,000 for Self Plus One, or $12,000 for Self and Family" (p27). The deductible paragraph is per-person ("both family members must meet the individual deductible", p26), but nothing like that is said for the out-of-pocket maximum. | Cover; Changes (p18: "Self Only Plan from $5,500 to $6,000 ... $11,000 to $12,000"); Section 4 (p26-27); Medicare table (p81); summary (p88) |
| A81, P81 | 73-881, Basic (identical wording) | Nothing found. "$7,000 for Self Only, $14,000 for Self Plus One" (p27). | Same as A84; Medicare table (p82); summary (p90) |
| RE1, YZ1 | 73-881, Value (identical wording) | Nothing found. "$9,500 for Self Only, $19,000 for Self Plus One" (p27). | Same as A84; summary (p92) |
| YJ1 | 73-937 Sharp, Basic | Nothing found. Only "Self Only $8,100", then "Self Plus One $16,200" and "Self and Family $16,200" (p24-25). The deductible is described per person; the out-of-pocket maximum is not. | Cover; Section 1 (p15); Changes (p17); Section 4 (p24-25); Medicare table (p80: "$8,100 self only / $16,200 family"); summary (p91) |
| YJ4 | 73-937, Standard (same brochure as YJ1, but a different option and wording) | "Self Plus One $6,000 per person", next to "Self and Family $6,000" with no "per person" (p24). Unclear, see below. | Same as YJ1; Medicare table (p80: "$3,000 self only / $6,000 family"); summary (p89: "$6,000 Self Plus One or Self and Family") |
| EA1 | 73-197 Capital Health Plan | Medical: "Self Plus One $7,000 per person", "Self and Family $7,000 per person". Pharmacy: "$8,700 per person" for both (p28). Unclear, see below. | Cover; Section 1 (p14); Changes; Section 4 (p28-29); pharmacy intro (p61: "$4,600 Self / $8,700 Self Plus One / $8,700 Self and Family"); Medicare table (p80); summary (p89) |
| 8W4 | 73-797 UPMC, HDHP | "Self Plus One $12,000 per person [$16,000 out of network]" (p30). The "each enrollee ... $6,000" example on the same page is under the Standard Option only. HDHP text: "family out-of-pocket maximum must be met by one or more members" (p92, p104). Unclear, see below. | Cover; Section 1 (p16, p20); Section 4 (p29-31); HDHP Section 5 (p88-106); Medicare table (p164, Standard Option only); Definitions (p168-169); summary (p179) |

### Is the "per person" text in EA1, YJ4 and 8W4 a template artifact?

All three brochures share a pattern: "Self Only $X in network", then "Self Plus One $2X per person", then "Self and Family $2X". Searching all 2027 brochures for "Self Plus One/Self and Family $N per person" turns up only six: 73-197 (EA1), 73-797 (8W4), 73-937 (YJ4), 73-865 (p28), 73-891 (p24) and 73-877 (p23).

The 73-865 and 73-891 lines have exactly this layout. The previous pass found that those brochures state the Self Only amount as the per-person cap elsewhere. So the line reads as an OPM Section 4 form-template placeholder that some carriers left filled in. Judgement per plan:

- **YJ4: very likely an artifact (high confidence).** In the same list, the Self and Family line drops "per person". The Medicare table (p80) and the summary (p89) give "$6,000 family" and "$6,000 Self Plus One or Self and Family" as enrollment amounts. Nothing else in the brochure is per-person for the out-of-pocket maximum.
- **8W4: very likely an artifact as wording (high confidence).** The identical "Self Plus One $12,000 per person" line appears for the Standard Option on the same page. For that option, the brochure's own example says "each enrollee will have an out of pocket maximum of $6,000", so the line cannot mean $12,000 per person there.
  - Whether the HDHP has any per-person cap is still unstated. Its HDHP pages say the family maximum "must be met by one or more members of the family before benefits are payable at 100%" (p92, p104), which on its own reads like a single family limit.
  - The same sentence appears in the Definitions (p168) for all options, including the Standard Option, which is explicitly per-person. The same definition says limits "can be either embedded or aggregate" without saying which applies to which option.
  - So this is not a contradiction, but it is the weakest of the 13 unsupported cases. The HDHP's deductible is a shared family amount (p29).
- **EA1: probably an artifact (moderate confidence).** Both family lines say "per person", for medical and for pharmacy, so there is no internal inconsistency within Section 4.
  - Every other place restates the figures as enrollment amounts with no "per person": the pharmacy intro (p61), the Medicare table (p80) and the summary (p89).
  - Read literally, a Self and Family enrollment would have no household cap at all, which none of those restatements suggest.
  - p14 also says the plan's limit cannot exceed the IRS $14,000 family figure. That page's figures do not tie out cleanly with the plan's own medical plus pharmacy amounts, so it is weak support.

## Task 2: plan 471 and the other 71-004 option

| Item | Brochure (71-004 APWU) | App |
|---|---|---|
| 471 High, PPO deductible | "the calendar year deductible is $450 person" (p27; the word "per" is missing). Self Plus One is satisfied when "the combined covered expenses ... reach $800" (p27). Self and Family: "reach $800" (p27). Section 5 intros: "PPO - $450 per person ($800 per Self Plus One enrollment" (p37, p52, p59, p63, p66, p78). Medicare table: "$450 Self Only/$800 Family" (p146). | `deductible` 450 / 800 / 800; type 'embedded' |
| 471 non-PPO deductible | "$1,000 per person ($2,000 per Self Plus One and Self and Family)"; the total "will not exceed $1,000 per person" whether or not PPO providers are used (p27) | `out_of_network.deductible` 1000 / 2000 / 2000 |
| 471 out-of-pocket maximum | "the maximum out-of-pocket for any individual in the family will not exceed" the Self Only maximum (p30) | 6,500 / 13,000 / 13,000, each person capped at 6,500 |
| 474 Consumer Driven | Plan deductible 2,200 / 4,400 / 4,400. The PCA the plan funds is 1,200 / 2,400 / 2,400. The net deductible the member pays is 1,000 / 2,000 / 2,000. "once one individual meets the Self Only Net Deductible of $1,000, Traditional Health Coverage begins for that individual" (p28). | `deductible` 2200 / 4400 / 4400, HRA credit 1200 / 2400 / 2400, treated as 'embedded' ("CDHP" does not match the HDHP test) |

**471 verdict: consistent.**
- The brochure states a per-person $450 together with a Self Plus One / Self and Family amount of $800 that is met by combined spending. That is the app's rule.
- For two people, the first person pays up to $450 and the second only the remaining $350, so the deductible total drops by up to $100 against 2 × $450. The $75 drop in Self Plus One totals is a case of this and is what the brochure wording produces.
- The missing "per" on p27 is a typo; the "per person" wording is repeated six times in Section 5.

**474 (not asked, flagged for the owner).** The brochure's order is: the shared PCA ($2,400 for a family) is used first, then each person pays a $1,000 net deductible.
- The app instead gives each person a $2,200 deductible and then applies the $2,400 HRA credit against costs.
- For one heavy user on Self Plus One, the brochure has that person paying $1,000 of deductible after the $2,400 PCA is used up.
- The app's HRA credit appears to absorb that person's whole $2,200 deductible, so 474 family totals may be understated. I did not run the engine to measure this.

## Task 3: recommendations

| Code(s) | Recommendation | Basis |
|---|---|---|
| 631, 634 | (a) Confirmed | 73-005 p101: "(3x per family)" with "$3,250 per person" (High) and "$3,500 per person" (Standard), in the "Without Medicare" rows. The Section 4 "per family" figures (6,500 / 9,750 and 7,000 / 10,500) are 2× and 3× those amounts, which is consistent. Caveat: the statement is in the Section 9 comparison table, not Section 4. |
| 421, 424 | (b) Keep and flag | Per-enrollment amounts only (71-028 p29-30) |
| W51 | (b) Keep and flag | Per-enrollment amounts only; "a member or family" (p26) is ambiguous |
| A81, P81, A84, P84, RE1, YZ1 | (b) Keep and flag | Per-enrollment amounts only (73-881 p27), even though the deductible is per person (p26) |
| YJ1 | (b) Keep and flag | Per-enrollment amounts only (73-937 p24-25) |
| YJ4 | (b) Keep and flag ("per person" line is very likely an artifact) | 73-937 p24, p80, p89 |
| EA1 | (b) Keep and flag ("per person" lines are probably an artifact) | 73-197 p28, p61, p80, p89 |
| 8W4 | (b) Keep and flag (artifact as wording; HDHP text leans toward a single family limit but does not say so) | 73-797 p30, p92, p104, p168 |

### Proposed user-facing sentences

Use these for the 10 plans with per-enrollment amounts only: 421, 424, W51, A81, A84, P81, P84, RE1, YZ1 and YJ1.

> This plan's brochure gives out-of-pocket limits only for the whole enrollment and does not say whether each person also has their own limit. The estimate assumes no one person pays more than the plan's Self Only limit of $X.

Use these for EA1, YJ4 and 8W4.

> This plan's brochure prints "per person" next to its Self Plus One out-of-pocket limit but does not say plainly whether each person has their own limit. The estimate assumes no one person pays more than the plan's Self Only limit of $X.

Fill in $X from `oop_max.self` (8W4 $6,000; EA1 $3,500, medical only; YJ4 $3,000).

## Not done

- The PDFs were not opened. The text extractions were used throughout, and the table layout on 73-005 p101 was not checked against the PDF.
- The engine was not run, so the size of the 474 discrepancy was not measured.
- EA1's separate $4,600 pharmacy maximum is outside this question and was not checked against the app.
