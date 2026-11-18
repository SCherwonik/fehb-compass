# 2027 known gaps: report

A known gap is a brochure cost term the app's estimate does not include. The app says so plainly instead of guessing the amount.

## What was added

- `pipeline/known_gaps.json`: six entries (year, plan_code, kind, affects_cost, amounts, text, brochure, page, quote, reason).
- `pipeline/build_data.py`: `apply_known_gaps` attaches them to `data/benefits.json` as `benefits[year][code]["known_gaps"]`, run after the brochure overrides. The build stops on an unknown plan or year, a missing key, an unknown kind, an `affects_cost` that does not fit the kind (deductible kinds true, `conflict` false), malformed `amounts`, a quote of 15 words or more, or a quote not on the cited page of the brochure text (checked when `pipeline/raw/brochures_txt` is present).
- Engine (`src/engine/cost.js`): `costGaps(benefits)` returns the cost-affecting gaps. `planTotal` and the household path add `breakdown.gaps` (only when a gap applies) and force firmness `estimated`. No amount is added to any total.
- "See the math" (`src/ui/math.js`, `gapNote` in `src/ui/math-family.js`): a line "Not included in this estimate: <text> (Brochure <number>, page <n>.)" with the warning icon, under the firmness line. The firmness sentence says the total leaves out a cost the brochure lists.

## Entries

| Plan | Kind | Cost-affecting | Brochure, page |
|---|---|---|---|
| V31 | facility_deductible, $500, hospital services and MRI/CT, no tier amounts, per person or family not stated | yes | 73-009, p25 (also p26) |
| 2G4 | facility_deductible $250 / $500 / $500 | yes | 73-718, p29 |
| B64 | facility_deductible $250 / $500 / $500 | yes | 73-718, p29 |
| B64 | drug_deductible (Tier 2-5) $100 / $200 / $200 | yes | 73-718, p29 |
| B41, B44 | conflict: out-of-network Self Plus One deductible $1,000 (Section 4, p27) vs $1,500 (Section 5, p35 and others); the app keeps $1,500 | no | 73-874, p27 |

Conflict entries are kept in the data and this document only. Out-of-network deductibles do not feed the estimate, and the Board matrix has no simple spot for them, so nothing is shown to users.

## Checks

- Regenerating with `python pipeline/build_data.py` changed only `data/benefits.json`, and in it only the five plans above (verified plan by plan: apart from `known_gaps`, every plan entry is identical to before).
- Node test over every 2027 plan, scenario and enrollment, one person and a two-person household: all totals and breakdown fields are identical with and without the gaps, firmness differs only on V31, 2G4 and B64, and `fixed` is kept elsewhere.
- Pytest covers the build step; a DOM-free test covers the note text.
- Browser: the V31 card's "See the math" (ZIP 55401, local server) shows the firmness line and the V31 note with Brochure 73-009, page 25. Not checked: screenshot of the styling, the 2G4 and B64 cards, the Board's dialog, and a dark theme.

## Limits

- The card's "Estimated" tag tooltip still reads "Part of this total depends on assumed prices for care. See the math." For a gap plan the math panel gives the real reason.
- The note appears for every scenario, even one with no hospital care, because the brochure term can apply to any year.
- V31's text does not name amounts per enrollment type: the brochure gives none.
