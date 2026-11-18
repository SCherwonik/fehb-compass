# 2027 family deductible and out-of-pocket rules, checked against each plan's brochure

Scope: all 118 plan codes in `data/benefits.json["2027"]`, covered by the 53 brochures listed under `data/brochures.json["2027"]`. Evidence comes from the page-delimited text in `pipeline/raw/brochures_txt/2027/` (page numbers below are the `=== PAGE n ===` numbers of that text, i.e. the PDF page, not the printed page number). All 53 brochures were readable; none were skipped.

Method: a throwaway script pulled every sentence that mentions a deductible or the out-of-pocket / catastrophic maximum together with family words ("per person", "individual", "each member", "Self Only", "combined", "one or more family members", and so on). The snippets were then read by hand, and the Section 4 "Deductible" and "Your catastrophic protection out-of-pocket maximum" pages were read in full wherever the snippets were thin. When a plan was marked "not stated", the whole brochure was searched again with a looser pattern. Each statement was assigned to its option (High/Standard/Basic/Prosper/HDHP/CDHP/Value) by the option name in the sentence or the heading above it.

What the app assumes (from `src/engine/cost.js`):

- **A. Deductible.** `deductibleType` returns `embedded` for every non-HDHP plan: each person pays up to the plan's Self Only deductible, and once the family's combined deductible spending reaches the family deductible, nobody pays more. It returns `aggregate` for HSA HDHPs whose family deductible is exactly twice the Self Only one: one shared family deductible applies before the plan pays for anyone's non-preventive care. Those are 224, 341, 9K4, B61, KX1, L14, V41 and WX1. It returns `unknown` for 8W4, which is modeled like `aggregate`.
- **B. Out-of-pocket maximum.** Each person on Self Plus One or Self and Family is capped at that plan's own Self Only out-of-pocket maximum, and the family maximum caps the household's total. This is the app's own assumption. It is not a legal rule.

Quotes are kept under 15 words, with at most one per cell. "p" means the page in the text file.

---

## 1. Summary

### Deductible rule (118 plans)

| Verdict | Plans | Codes |
|---|---:|---|
| Brochure confirms per-person (embedded), and the app assumes embedded | 61 | 471, 474, 104, 311, 314, 454, 441, 444, 131, 251, 254, 421, 424, 401, 431, 594, KC1, 574, AM1, 634, V34, 874, PT4, GY4, UX1, 654, N41, T71, L11, QQ4, LA1, PS1, PS4, 9K1, DK4, UW4, FL1, N61, GG4, DH1, SF4, EP1, EP4, F51, F54, G51, G54, H41, H44, JS1, JS4, A81, A84, P81, P84, RE1, YZ1, YV1, YF1, Z24, YJ1 |
| Brochure confirms one shared family deductible, and the app assumes aggregate or unknown | 5 | 341, B61, V41, WX1, 8W4 |
| Brochure contradicts the app | 3 | 224, 9K4, KX1 |
| Unclear: the brochure contradicts itself, or has a deductible that is missing from the app data and whose family rule is unclear | 4 | L14, V31, 2G4, B64 |
| Not stated: the plan has a deductible but the brochure gives no per-person or family rule | 2 | WJ4, AS1 |
| No in-network calendar-year deductible, so there is nothing to test (the app's $0 is consistent) | 43 | 111, 591, 571, 631, 871, 541, 544, 521, 891, 644, 651, E31, E34, JN1, JN4, WJ1, JP1, NM1, EA1, F81, F84, P21, JK1, JK4, 2X1, 621, 624, AJ1, JC1, JC4, JR1, JR4, P31, P34, DH4, B41, B44, B31, NZ1, NZ4, LR1, W51, YJ4 |
| **Total** | **118** | |

### Out-of-pocket cap (118 plans)

| Verdict | Plans | Codes |
|---|---:|---|
| Brochure confirms each person is capped at the Self Only amount | 102 | All plans not listed in the three rows below. For 441 and 444 the support comes only from the Summary page ("$5,000 per person"). For NM1 the rule is confirmed, but the app's Self Only figure is wrong (see section 3). |
| Brochure states a different per-individual amount | 1 | UX1 (the only per-individual sentence names $6,000, while the brochure's Basic Option Self Only maximum is $6,500) |
| Brochure gives only per-enrollment amounts, with no per-person rule | 12 | 421, 424, 631, 634, W51, A81, A84, P81, P84, RE1, YZ1, YJ1 |
| Unclear: the brochure prints "per person" next to the Self Plus One amount (twice the Self Only figure), and no other per-person statement exists | 3 | EA1, YJ4, 8W4 |
| **Total** | **118** | |

Unreadable brochures: 0 of 53.

---

## 2. Per-brochure evidence

Key to "App assumes": **E** = embedded, **A** = aggregate (shared), **U** = unknown (modeled as aggregate). "OOP self" is the app's per-person cap.

| Brochure | Codes (option) | App assumes | Deductible: brochure says | Out-of-pocket: brochure says | Verdict (deductible / OOP) |
|---|---|---|---|---|---|
| 71-004 | 471 (High) | E $450; OOP self $6,500 | "If you use PPO providers, the calendar year deductible is $450 person." (p27) | "the maximum out-of-pocket for any individual in the family will not exceed" (p30) | Confirms / confirms |
| 71-004 | 474 (CDHP) | E $2,200; OOP self $6,500 | "once one individual meets the Self Only Net Deductible of $1,000" (p28). The individual threshold is the net deductible that applies after the family's $2,400 PCA is used up. | Same sentence for the CDHP (p31) | Confirms per-person (but the mechanics differ: PCA plus net deductible) / confirms |
| 71-005 | 104 (Standard), 111 (Basic) | E; OOP self $7,000 / $8,500 | 104: "Under a Self Plus One enrollment, both family members must meet the individual deductible." (p29). 111 has no deductible. | "once any individual family member reaches the Self Only catastrophic protection out-of-pocket maximum" (p34) | 104 confirms, 111 no deductible / confirms |
| 71-006 | 311 (High), 314 (Standard) | E $500; OOP self $7,500 / $8,000 | "once the calendar year deductible amount of $500 is satisfied for an individual" (p26) | "will never have to satisfy more than ... under a Self Only enrollment" (p28) | Confirms / confirms |
| 71-007 | 454 | E $500; OOP self $8,000 | "will not exceed the per-person limit for any covered individual" (p29) | "once an individual reaches the Self Only maximum" (p31) | Confirms / confirms |
| 71-014 | 341 (HDHP) | A $3,600; OOP self $6,000 | "combined covered expenses ... for any combination of family member(s) reaches ... $3,600" (p27). The same paragraph opens with "$1,800 per person", which is loose wording. | "any combination of family members, not to exceed $6,000 per person" (p35) | Confirms shared / confirms |
| 71-015 | 441 (High), 444 (Standard) | E $300 / $350; OOP self $5,000 / $6,000 | "will not exceed the per person limit for any covered individual" (p25) | "PPO: Nothing after $5,000 per person, per calendar year" (Summary, p121). Section 4 (p27) lists only enrollment totals. | Confirms / confirms (Summary only) |
| 71-017 | 131 | E $1,000; OOP self $11,000 | "both family members must meet the individual deductible" (p29) | "once any individual family member reaches the Self Only catastrophic protection out-of-pocket maximum" (p31) | Confirms / confirms |
| 71-018 | 251, 254 | E $200 / $750; OOP self $7,000 / $10,600 | "once the calendar year deductible amount of $200 is satisfied for an individual" (p26) | "will never have to satisfy more than ... under a Self only enrollment" (p28) | Confirms / confirms |
| 71-028 | 421 (High), 424 (Standard) | E $350 / $500; OOP self $6,000 / $9,000 | "The calendar year deductible for PPO is $350 per person" (p27) | Section 4 (p29-30) lists only Self Only, Self Plus One and Self and Family amounts | Confirms / per-contract only |
| 72-001 | 401 | E $300; OOP self $6,000 | "The calendar year deductible is $300 per person for in-network providers" (p27) | "once any individual family member reaches the Self Only catastrophic protection out-of-pocket maximum" (p30) | Confirms / confirms |
| 72-004 | 431 | E $300; OOP self $12,000 | "(one individual not to exceed $300)" (p31) | "will never have to satisfy more than what is required ... under Self Only" (p26) | Confirms / confirms |
| 73-003 | 591 (High) | No deductible; OOP self $4,000 | No deductible | "High Option $4,000 per person up to $8,000 per family enrollment" (p26) | n/a / confirms |
| 73-003 | 594 (Standard), KC1 (Prosper) | E $100 / $500; OOP self $5,000 / $7,000 | "The calendar year deductible is $100 per person under the Standard Option." (p25) | "Standard Option $5,000 per person up to $10,000 per family enrollment" (p26) | Confirms / confirms |
| 73-004 | 571 (High) | No deductible; OOP self $5,000 | No deductible | "$5,000 per person, up to $10,000 per family enrollment" (p27) | n/a / confirms |
| 73-004 | 574 (Standard), AM1 (Prosper) | E $150 / $300 | "The calendar year deductible for the Standard Option is $150 per person." (p26) | "$6,000 per person, up to $12,000 per family enrollment" (p27) | Confirms / confirms |
| 73-005 | 631 (High) | No deductible; OOP self $3,250 | No deductible | Only "Self Plus One $6,500 per family" and "Self and Family $9,750 per family" (p24) | n/a / per-contract only |
| 73-005 | 634 (Standard) | E $150; OOP self $3,500 | "The calendar year deductible for the Standard Option is $150 per person." (p24) | Only "Self Plus One $7,000 per family" (p24) | Confirms / per-contract only |
| 73-009 | V31 (High) | App data: no deductible; OOP self $8,000 | "calendar year deductible is $500, which applies to inpatient and outpatient hospital services" (p25). Not in the app's deductible field, and the brochure does not say whether it is per person or per family. | "However, each enrollee will not pay more than $8,000." (p26) | Unclear / confirms |
| 73-009 | V34 (Standard) | E $750; OOP self $10,000 | "The calendar year deductible is $750 per person under the Standard Option." (p25) | "each enrollee will not pay more than $10,000" (p26) | Confirms / confirms |
| 73-010 | 871 (High) | No deductible; OOP self $3,000 | No deductible | "however, no individual member pays more than $3,000." (p28) | n/a / confirms |
| 73-010 | 874 (Standard) | E $150; OOP self $5,000 | "The calendar year deductible is $150 per person under the Standard Option." (p27) | "no individual member pays more than $5,000." (p28) | Confirms / confirms |
| 73-012 | 541, 544 | No deductible; OOP self $3,500 / $5,000 | No deductible | "$3,500 per person up to $7,000 per family enrollment" (p26) | n/a / confirms |
| 73-012 | PT4 (Prosper) | E $300; OOP self $6,000 | "The calendar year deductible for Prosper is $300 per person." (p25) | "$6,000 per person up to $12,000 per family enrollment" (p26) | Confirms / confirms |
| 73-015 | 521 (High) | No deductible; OOP self $6,350 | No deductible | "Self Only of $6,350 applies to each individual" (p25) | n/a / confirms |
| 73-015 | GY4 (Standard) | E $350; OOP self $6,350 | "The calendar year deductible is $350 per person under the Standard Option." (p24) | Same sentence (p25) | Confirms / confirms |
| 73-016 | 891 | No deductible; OOP self $6,600 | No deductible | "$13,200 combined but will not exceed $6,600 per member" (p24) | n/a / confirms |
| 73-017 | 644 (Standard) | No deductible; OOP self $6,000 | No deductible | "Self Only of $6,000 applies to each individual" (p25) | n/a / confirms |
| 73-017 | UX1 (Basic) | E $750; OOP self $6,000 | "The Basic Option calendar year deductible is $750 per person." (p24) | "$6,500 for Self Only, or $13,000 for Self Plus One or Self and Family" (p25, Basic). The per-individual sentence names $6,000. | Confirms / different amount (see sections 3 and 5) |
| 73-019 | 651 (High) | No deductible; OOP self $5,000 | No deductible | "$5,000 per person, up to $10,000 per family enrollment" (p28) | n/a / confirms |
| 73-019 | 654 (Standard), N41 (Prosper) | E $150 / $350 | "The calendar year deductible for the Standard Option is $150 per person." (p27) | "$6,500 per person, up to $13,000 per family enrollment" (p28) | Confirms / confirms |
| 73-047 | E31, E34 | No deductible; OOP self $3,750 / $4,500 | No deductible | "$3,750 per person, up to $7,500 per family enrollment" (p26) | n/a / confirms |
| 73-047 | T71 (Prosper) | E $150; OOP self $5,300 | "The calendar year deductible is $150 per person for Prosper." (p25) | "$5,300 per person, up to $10,600 per family enrollment" (p26) | Confirms / confirms |
| 73-051 | L11 (Standard) | E $350; OOP self $5,000 | "The Standard Option calendar year deductible is $350 per person." (p26) | "$5,000 per person up to $10,000 per family unit" (p27) | Confirms / confirms |
| 73-051 | L14 (HDHP) | A $3,500; OOP self $5,000 | Summary: "$1,650 per person for Self Plus One or Self and Family enrollment" (p172). Section 4 (p26) and Section 5 say "$3,500 per family unit", and the next Summary line says "$1,750 per person". | "$5,000 per person up to $10,000 per family unit" (p27, HDHP) | Unclear (the brochure contradicts itself) / confirms |
| 73-052 | JN1, JN4 | No deductible; OOP self $5,000 / $7,500 | No deductible | "Once an individual meets the Self Only out-of-pocket maximum" (p27) | n/a / confirms |
| 73-052 | QQ4 (Saver) | E $1,000; OOP self $8,500 | "Once an individual meets the Self Only deductible ... they will then be covered" (p87) | Same out-of-pocket sentence (p27) | Confirms / confirms |
| 73-061 | WJ1 (High) | No deductible; OOP self $7,150 | No deductible | "Self Only of $7,150 applies to each individual" (p23) | n/a / confirms |
| 73-061 | WJ4 (Standard) | E $1,000; OOP self $7,150 | Lists $1,000 Self Only and $2,000 Self Plus One / Self and Family only (p23). No per-person rule anywhere. | Same sentence (p23) | Not stated / confirms |
| 73-100 | JP1 | No deductible; OOP self $5,000 | No deductible | "Self Only of $5,000 applies to each individual" (p24) | n/a / confirms |
| 73-129 | NM1 | No deductible; OOP self **$7,000** | No deductible | "Self Only of $3,500 applies to each individual" (p24) | n/a / confirms the rule, but the app's figure is wrong (section 3) |
| 73-197 | EA1 | No deductible; OOP self $3,500 | No deductible | "Self Plus One $7,000 per person" (p28). There is a separate pharmacy maximum of $4,600 Self Only and "$8,700 per person". | n/a / unclear |
| 73-321 | F81, F84 | No deductible; OOP self $4,250 / $5,250 | No deductible | "High Option $4,250 per person up to $8,500 per family enrollment" (p26) | n/a / confirms |
| 73-321 | LA1 (Prosper) | E $300; OOP self $6,750 | "The calendar year deductible for Prosper is $300 per person." (p25) | "Prosper $6,750 per person up to $13,500 per family enrollment" (p26) | Confirms / confirms |
| 73-563 | P21 (High) | No deductible; OOP self $6,350 | No deductible | "Self Plus One $6,350 or $8,150/person" (p25). The page also says "2026 calendar year", a typo. | n/a / confirms |
| 73-563 | PS1 (Wellness), PS4 (Standard) | E $2,000 / $500 | "$2,000 per person ($4,000 per Self Plus One enrollment" (p31) | Same line (p25) | Confirms / confirms |
| 73-564 | 9K1 (High), DK4 (Standard) | E $50 / $100 | "Once an individual meets the Self Only deductible under the Self Plus One" (p30) | "Once an individual meets the Self Only out-of-pocket maximum" (p15) | Confirms / confirms |
| 73-564 | 9K4 (HDHP) | A $3,600; OOP self $6,000 | "Once an individual meets a deductible of $3,500 under the Self Plus One" (p30; same on p17 and p139) | "Once an individual meets the Self Only out-of- pocket maximum" (p104) | **Contradicts** (embedded at $3,500) / confirms |
| 73-718 | 2G4 (Standard), B64 (Blue Value Plus) | App data: no deductible; OOP self $7,500 / $8,500 | "services for any or all members contribute to the deductible" (p29). This refers to the $250 Self Only / $500 family facility deductible, plus B64's $100 / $200 Tier 2-5 drug deductible. Neither is in the app's deductible field. | "Each Member can satisfy their own individual out-of-pocket maximum" (p17) | Unclear / confirms |
| 73-718 | B61 (HDHP) | A $3,500; OOP self $7,500 | "There is no individual deductible with family coverage." (p29) | "cannot contribute more than the individual out-of- pocket maximum" (p31) | Confirms shared / confirms |
| 73-776 | JK1 (High), JK4 (Standard) | No deductible; OOP self $2,000 / $3,000 | "Under the High and Standard Options, there is no calendar year deductible." (p25) | "will never have to satisfy more than ... under a Self Only enrollment" (p26) | n/a / confirms |
| 73-776 | KX1 (HDHP) | A $4,000; OOP self $3,000 | "satisfied when at least two (2) covered family members have met their individual deductible" (p25). p102 says "$2,000 per person", but p104 says "can be satisfied by one or more family members". | Same "never ... Self Only" sentence covers all three options (p26) | **Contradicts** (Section 4 describes per-person $2,000) / confirms |
| 73-797 | UW4 (Standard) | E $850; OOP self $6,000 | "if one member meets the individual deductible, the deductible is satisfied for that member" (p29) | "each enrollee will have an out of pocket maximum of $6,000" (p30) | Confirms / confirms |
| 73-797 | 8W4 (HDHP) | U (modeled as shared) $4,000; OOP self $6,000 | "benefits are payable for all family members when the combined covered expenses" (p29). p106 says "one or more family members"; the p134 drug section says "$2,000 per person". | "Self Plus One $12,000 per person" (p30, HDHP). The "each enrollee $6,000" example is under the Standard Option only. | Confirms shared / unclear |
| 73-806 | 2X1 | No deductible; OOP self $5,000 | No deductible | "Once an individual meets the Self Only out-of- pocket maximum" (p28) | n/a / confirms |
| 73-822 | 621, 624 | No deductible; OOP self $4,000 / $5,000 | No deductible | "High Option: $4,000 per person up to $8,000 per family enrollment" (p26) | n/a / confirms |
| 73-822 | FL1 (Prosper) | E $250; OOP self $7,000 | "The calendar year deductible is $250 per person under Prosper." (p25) | "Prosper $7,000 per person up to $14,000 per family enrollment" (p26) | Confirms / confirms |
| 73-828 | 224 (HDHP) | A $4,000; OOP self $7,500 | "Once an individual meets a $3,500 deductible under the Self Plus One" (p35; same on p15 and p26) | "Once an individual meets the Self Only out-of-pocket maximum" (p16) | **Contradicts** (embedded at $3,500) / confirms |
| 73-828 | N61 (Aetna Direct) | E $2,000; OOP self $8,000 | "Once an individual meets the Self Only deductible under the Self Plus One" (p17). This applies after the medical fund is used up. | Same out-of-pocket sentence (p17) | Confirms / confirms |
| 73-849 | AJ1 (Basic) | No deductible; OOP self $8,550 | No deductible | "any remaining qualified medical expenses for that individual will be covered fully" (p25) | n/a / confirms |
| 73-849 | GG4 (Standard) | E $350; OOP self $5,000 | "$350 per person under self only enrollment in our Standard Option" (p24) | Same kind of example (p25) | Confirms / confirms |
| 73-851 | JC1, JC4, JR1, JR4, P31, P34 | No deductible; OOP self $5,000 / $7,000 | No deductible | "Once an individual meets the Self Only out-of-pocket maximum" (p28) | n/a / confirms |
| 73-860 | DH1 (High) | E $500; OOP self $5,000 | "the calendar year deductible for In-Network Providers is $500 per person" (p23) | "Self Only of $5,000 applies to each individual" (p24) | Confirms / confirms |
| 73-860 | DH4 (Standard) | No deductible; OOP self $5,500 | "Under Standard Option, there is no calendar year deductible" (p23) | "Self Only of $5,500 applies to each individual" (p24) | n/a / confirms |
| 73-865 | SF4 (Standard) | E $250; OOP self $7,500 | "The calendar year deductible is $250 per person under the Standard Option Plan." (p32) | "The out of pocket maximum is $7,500 per person" (p33) | Confirms / confirms |
| 73-865 | WX1 (HDHP) | A $4,000; OOP self $7,500 | "benefits are payable for all family members when the combined covered expenses reach $4,000" (p27). p90 also says "$2,000 per person". | "total $7,500 per person, $15,000 per Self Plus One enrollment" (p90) | Confirms shared / confirms |
| 73-874 | B41 (High), B44 (Standard) | No in-network deductible; OOP self $2,000 / $3,000 | No in-network deductible. The out-of-network deductible is "$500 per person" (p27). | "Self Only of $2,000 applies to each individual" (p16) | n/a / confirms |
| 73-877 | B31 | No deductible; OOP self $3,000 | No deductible | "Self Plus One $3,000 per person" (p23) | n/a / confirms |
| 73-879 | EP1, F51, G51, H41, JS1 (CDHP) | E $1,000; OOP self $5,000 | "Once an individual meets the Self Only deductible under the Self Plus One" (p15). This applies after the medical fund is used up. | "Once an individual meets the Self Only out-of-pocket maximum" (p15) | Confirms / confirms |
| 73-879 | EP4, F54, G54, H44, JS4 (Value) | E $700; OOP self $6,000 | Same sentence for the Value Plan (p16) | Same sentence for the Value Plan (p16) | Confirms / confirms |
| 73-881 | A81, P81 (Basic), A84, P84 (Standard), RE1, YZ1 (Value) | E; OOP self $6,000 / $5,500 / $9,000 (app data) | "both family members must meet the individual deductible" (p26) | Only "$6000 for Self Only, $12,000 for Self Plus One, or $12,000 for Self and Family" and the equivalents for the other options (p27) | Confirms / per-contract only (the app figures also differ from the brochure, see section 3) |
| 73-889 | NZ1, NZ4 | No deductible; OOP self $4,000 / $5,000 | No deductible | "High Option $4,000 per person up to $8,000 per family enrollment" (p25) | n/a / confirms |
| 73-889 | YV1 (Prosper) | E $250; OOP self $7,000 | "The calendar year deductible is $250 per person under Prosper." (p24) | "Prosper $7,000 per person up to $14,000 per family enrollment" (p25) | Confirms / confirms |
| 73-890 | LR1 | No deductible; OOP self $5,000 | No deductible | "Self Only of $5,000 applies to each individual" (p23) | n/a / confirms |
| 73-891 | V41 (HDHP) | A $4,000; OOP self $6,000 | "The full Self plus One or Self and Family deductible must be satisfied" (p24) | "limited to $6,000 per person or $12,000 per Self Plus One" (p31) | Confirms shared / confirms |
| 73-899 | YF1 (Basic) | E $750; OOP self $6,500 | "The Basic Option calendar year deductible is $750 per person." (p24) | "any remaining qualified medical expenses for that individual will be covered fully" (p26) | Confirms / confirms |
| 73-905 | AS1 | E $750; OOP self $7,350 | Gives only the $750 Self Only amount and the combined $1,500 family amount (p24). No per-person rule anywhere. | "The maximum annual limitation on cost sharing applies to each individual" (p25) | Not stated / confirms |
| 73-906 | Z24 (Aetna Advantage) | E $2,000; OOP self $8,500 | "Once an individual meets the Self Only deductible under the Self Plus One" (p32). The same rule applies to the separate $1,000 pharmacy deductible (p83). | "Once an individual meets the Self Only out-of-pocket maximum" (p14) | Confirms / confirms |
| 73-936 | W51 | No deductible; OOP self $2,500 | No deductible | Only "Self Only $2,500 Self Plus One $5,000 Self and Family $5,000" (p26) | n/a / per-contract only |
| 73-937 | YJ1 (Basic) | E $4,800; OOP self $8,100 | "The calendar year deductible for the Basic Option is $4,800 per person." (p24) | Lists only $8,100 Self Only and $16,200 for Self Plus One and Self and Family (p24-25) | Confirms / per-contract only |
| 73-937 | YJ4 (the brochure calls it the Standard Option) | No deductible; OOP self $3,000 | "There is no calendar year deductible for the Standard Option." | "Self Plus One $6,000 per person" (p24) | n/a / unclear |

---

## 3. Contradicted or suspect plans, with the money at stake

Money estimates use `data/benefits.json` figures (deductible, in-network coinsurance, out-of-pocket maximum). They assume one family member has heavy costs and the others have none, which is where the difference is largest.

### 3a. The deductible rule contradicts the app (aggregate HDHPs that the brochure describes as embedded)

1. **224, Aetna HealthFund HDHP (73-828).** The brochure says "Once an individual meets a $3,500 deductible under the Self Plus One" (p35, repeated on p15 and p26). That describes an embedded individual deductible of $3,500 inside the $4,000 family deductible. $3,500 is the 2027 HDHP family minimum the brochure quotes on p199. The app makes one person pay up to $4,000. **Effect:** the app overstates a heavy user's cost by up to $500 × (1 − 15% coinsurance) = **about $425 a year**. There is no difference once two or more people share the deductible spending.
2. **9K4, Altius HDHP (73-564).** The brochure says "Once an individual meets a deductible of $3,500 under the Self Plus One" (p30, also p17 and p139), with a $3,600 family deductible. **Effect:** up to $100 × (1 − 10%) = **about $90 a year**.
3. **KX1, TakeCare HDHP (73-776).** Section 4 says "satisfied when at least two (2) covered family members have met their individual deductible" (p25), and p102 says "$2,000 per person". That reads as a $2,000 per-person deductible within a $4,000 family deductible. p104 instead says the family deductible "can be satisfied by one or more family members", so the brochure is internally inconsistent. Also, a $2,000 embedded individual deductible would sit below the HDHP family minimum the IRS sets for an HSA plan. **Effect, if Section 4 is right:** the app charges one heavy user the full $4,000 deductible, but the app's per-person cap ($3,000 Self Only) limits the gap. For a person with $3,000 of allowed charges, the app says $3,000 and the brochure says $2,000 + 20% × $1,000 = $2,200, so **up to about $800 a year**. The gap shrinks to $0 once the person reaches the $3,000 cap under both readings.

### 3b. Unclear deductibles that could change the result

4. **L14, Kaiser Permanente WA Options HDHP (73-051).** Sections 4 and 5 say "$3,500 per family unit", which matches the app's aggregate rule. The Summary says "$1,650 per person for Self Plus One or Self and Family enrollment" (p172) and, one line later, "$1,750 per person". **Effect if the Summary is right:** one heavy user pays $1,650 to $1,750 instead of $3,500, so the app overstates by up to about $1,850 × 80% = **about $1,480 a year**. Section 4 is the controlling description, and the Summary's per-person figure would fall below the HDHP family minimum, so the app's reading is the more likely one. Still, the plan should be marked unclear.
5. **V31, HealthPartners High (73-009).** The app data has no deductible, but the brochure has a "$500 calendar year deductible" for inpatient and outpatient hospital services and MRI/CT (p25-26). It does not say whether the $500 is per person or per family. If the app prices hospital stays without it, a family could be understated by $500 per person, or $500 per family. This was not checked against how the copay strings are parsed.
6. **2G4 and B64, CareFirst Standard and Blue Value Plus (73-718).** The app data has no deductible. The brochure has a hospital facility deductible of $250 Self Only / $500 family (2G4 has one for in-network and one for out-of-network). B64 also has a $100 Self Only / $200 family deductible for Tier 2-5 drugs. The only family wording is "services for any or all members contribute to the deductible" (p29). The possible understatement is up to $500 per family for facility care (B64: up to $200 more for drugs).

### 3c. Out-of-pocket figures in the app that differ from the 2027 brochure (found along the way; not an exhaustive data audit)

7. **NM1, Health Plan of Nevada (73-129).** The brochure's maximum is $3,500 Self Only and $7,000 Self Plus One / Self and Family: "Self Only of $3,500 applies to each individual" (p24; the Summary of Benefits also says "Nothing after $3,500/Self Only"). The app (and the OPM raw field) has **$7,000 / $14,000 / $14,000**. **Effect:** the app caps a heavy user at $7,000 instead of $3,500, overstating by up to **$3,500 per person and $7,000 per family**. One possible explanation is that the OPM field adds a separate drug maximum to the medical one; the brochure's Section 4 states no separate drug maximum.
8. **UX1, Medical Mutual of Ohio (Northern) Basic (73-017).** The brochure's Basic Option maximum is $6,500 Self Only / $13,000 family (p25; the Medicare line of the summary table also says $6,500 / $13,000). The app has **$6,000 / $12,000**, which is the Standard Option figure. The brochure's only per-individual sentence says "Self Only of $6,000 applies to each individual", which looks copied from the Standard Option. **Effect:** if the true cap is $6,500, the app understates a heavy user by **$500 per person (up to $1,000 per family)**.
9. **Baylor Scott & White, all six codes (73-881).** The app figures match the brochure's "from" values in its Changes section, so they look like 2026 numbers:
   - Standard (A84, P84): the brochure has a $350 deductible and a $6,000 / $12,000 maximum. The app has $300 and **$5,500 / $11,000**.
   - Basic (A81, P81): the brochure maximum is $7,000 / $14,000. The app has **$6,000 / $12,000**.
   - Value (RE1, YZ1): the brochure maximum is $9,500 / $19,000 ("will increase ... from $9,000 to $9,500", p18). The app has **$9,000 / $18,000**.

   **Effect:** the app understates a heavy user by **$500 (Standard and Value) to $1,000 (Basic) per person, and $1,000 to $2,000 per family**, and understates the Standard deductible by $50 per person.
10. **EA1, Capital Health Plan (73-197).** The app uses $3,500 Self Only and $7,000 family. The brochure prints "Self Plus One $7,000 per person" (p28) and has a **separate** pharmacy maximum of $4,600 Self Only and $8,700 for Self Plus One / Self and Family. If "per person" is meant literally, one person on a family enrollment could pay up to $7,000 in medical costs instead of $3,500. That would be an understatement of up to $3,500, plus whatever the separate pharmacy maximum adds. The wording is unclear (see section 5).
11. **YJ4 (Sharp) and 8W4 (UPMC HDHP).** These carry the same "Self Plus One $X per person" wording, with X equal to twice the Self Only figure. See section 5.

### 3d. Smaller points (not contradictions)

- **Separate drug deductibles that the app does not model as a separate family deductible:** Z24 ($1,000 / $2,000 pharmacy deductible, embedded, p83), SF4 ("$150 per person" pharmacy deductible, p62), AS1 ($250 / $500 Tier 3-4 pharmacy deductible, p24) and B64 (above).
- **Several brochures follow a correct "Self Only ... applies to each individual" sentence with an example that contradicts it.** The example says a second family member keeps paying "up to a maximum of $[family maximum]": 644 (p25), LR1 (p23), AJ1 and GG4 (p25), B41 and B44 (p17), AS1 (p25). The operative sentence was counted as the evidence; the example looks like an OPM template error.
- **8W4:** the app's `account_type` is HRA, but the brochure describes an HSA, with an HRA only for members who cannot have an HSA (p178). This has no effect on the family rules.
- **WX1:** `UNCLEAR_FAMILY_DEDUCTIBLE` in `cost.js` cites the 2026 summary. The 2027 brochure's Section 4 now says the family deductible is met "when the combined covered expenses reach $4,000" (p27), which matches the app's aggregate rule. One loose line, "$2,000 per person ($4,000 per Self Plus One ...)", remains in Section 5 (p90).

---

## 4. Plans with no statement at all (the app's assumption is unsupported)

**Deductible: 2 plans, both non-HDHP plans with a deductible: WJ4 (Group Health Cooperative of South Central Wisconsin Standard) and AS1 (UnitedHealthcare Choice Plus Primary East).** Each brochure gives only the Self Only amount and a combined family amount ($1,000 / $2,000 and $750 / $1,500). It never says whether one person can meet the Self Only amount alone. The app's embedded treatment is plausible, since every other non-HDHP plan that states a rule states embedded, but nothing in these brochures supports it. If either plan actually requires the full family deductible first, the app understates a heavy user by up to $1,000 (WJ4) or $750 (AS1), less the coinsurance on that amount.

**Out-of-pocket: 12 plans whose brochures give only per-enrollment amounts.** These are 421 and 424 (Compass Rose), 631 and 634 (Kaiser Hawaii), W51 (Western Health Advantage), the six Baylor Scott & White codes, and YJ1 (Sharp Basic). The searches found no "individual", "per person", "each member" or "Self Only applies to each" wording near their out-of-pocket maximums. The only matches were the general claims-filing line, "deductibles and maximum allowances apply separately to each person", which is about benefit maximums, not the out-of-pocket cap. So for these plans the app's per-person Self Only cap rests only on its own assumption.

What that means in dollars: if one of these plans applied only the family maximum, a single heavy user on a family enrollment could pay up to the family maximum instead of the Self Only one:

- Compass Rose: $12,000 vs $6,000 (High), $18,000 vs $9,000 (Standard)
- Kaiser Hawaii: $6,500 / $9,750 vs $3,250 (High), $7,000 / $10,500 vs $3,500 (Standard)
- Western Health Advantage: $5,000 vs $2,500
- Baylor Scott & White, using brochure figures: $12,000 / $14,000 / $19,000 vs $6,000 / $7,000 / $9,500
- Sharp Basic: $16,200 vs $8,100

The app would understate those costs by the difference. Nothing in the brochures says these plans do this. They simply do not say either way.

---

## 5. Per-individual out-of-pocket amounts that differ from the Self Only figure

Most brochures that state an individual cap state the plan's own Self Only figure. Across the 118 plans those figures range from $2,000 (JK1, B41) to $12,000 (431), so there is no single number. The exceptions and doubtful cases are:

| Code | Self Only maximum | What the brochure prints for one person on a family enrollment | Reading |
|---|---:|---|---|
| UX1 (MMO Northern, Basic) | $6,500 (brochure); app $6,000 | "Self Only of $6,000 applies to each individual" (p25) | The sentence names the Standard Option's $6,000, not Basic's $6,500. Either the individual cap really is $6,000 (below Self Only) or the sentence was copied from Standard. Unclear; counted as a different amount. |
| EA1 (Capital Health Plan) | $3,500 medical, $4,600 pharmacy | "Self Plus One $7,000 per person" (p28); pharmacy "$8,700 per person" | Read literally, the per-person cap is twice the Self Only figure. No other sentence says otherwise. Unclear. |
| YJ4 (Sharp, called "Standard Option" in the brochure) | $3,000 | "Self Plus One $6,000 per person" (p24) | Same pattern. Unclear. |
| 8W4 (UPMC HDHP) | $6,000 | "Self Plus One $12,000 per person" (p30) | Same pattern. The "each enrollee $6,000" example on the same page sits under the Standard Option heading only. Unclear. |

**The same "Self Plus One $[2× Self Only] per person" line also appears in SF4/WX1 (p28), UW4 (p30) and V41 (p24).** In each of those brochures an explicit sentence elsewhere says the per-person cap is the Self Only amount ("$7,500 per person", "each enrollee ... $6,000", "$6,000 per person"). So the line looks like an OPM form-template artifact rather than a real per-person cap. That makes EA1, YJ4 and 8W4 more likely to follow the Self Only cap too, but their brochures do not say so.

Plans where "per person" next to Self Plus One equals the Self Only figure, and so is consistent with the app: B31 ("Self Plus One $3,000 per person"), P21 / PS1 / PS4 ("$6,350 or $8,150/person"), and B44 ("Self Plus One: $3,000 per person").

Kaiser Hawaii (631, 634), HMSA 871, TakeCare JK1 and Calvo's B41 / B44 have a Self and Family maximum of three times Self Only (or $6,000 / $8,000). For HMSA, JK1 and B41 / B44 the brochure still states a per-person Self Only cap. Kaiser Hawaii states none (section 4).
