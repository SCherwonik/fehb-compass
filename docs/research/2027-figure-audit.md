# 2027 deductible and out-of-pocket figures, audited against each plan's brochure

Scope: all 118 plan codes in `data/benefits.json["2027"]`, covered by the 53 brochures in `data/brochures.json["2027"]`. For each plan I compared the app's `deductible` and `oop_max` objects (self / self_plus_one / family) with the brochure. I also compared `out_of_network.deductible` and `out_of_network.oop_max` wherever the app has them. The app values are the ones in `data/benefits.json` after `pipeline/benefit_overrides.json` has been applied, so the YJ1 deductible already reads $4,800 / $9,600 / $9,600. It still agrees with the brochure and is not reported again.

Evidence comes from `pipeline/raw/brochures_txt/2027/<brochure>.txt`. "p" is the `=== PAGE n ===` number in that file, which is the PDF page, not the printed page number. Quotes are under 15 words.

Method:

1. A throwaway script pulled the Section 4 "Deductible" and "Your catastrophic protection out-of-pocket maximum" paragraphs, the Section 2 "Changes for 2027" lines, and the Summary of Benefits lines that carry dollar amounts.
2. I read those passages, matched each figure to its option name (`raw["Plan Option Name"]`), and compared it with the app.
3. Where the window missed an option or tier, I searched the whole brochure and read the surrounding text.
4. A final sweep confirmed that every non-zero app figure appears somewhere in its brochure. That sweep only finds a figure missing from the brochure, so it is weak on its own. It is why the mismatches below were found by reading the text, not by the sweep.

I reused the previous research (`docs/research/2027-family-rules-from-brochures.md`). Its section 3c leads (NM1, UX1, Baylor Scott & White) were each re-read and confirmed here. Its deductible-rule findings (embedded or aggregate, for example 224, 9K4, KX1 and L14) are about the family rule, not the figures. They are out of scope here, except where they affect a figure.

---

## 1. Summary

| Result | Plans | Codes |
|---|---:|---|
| All figures match the brochure | 103 | every code not listed below |
| At least one confirmed mismatch | 10 | NM1, UX1, A81, P81, A84, P84, RE1, YZ1 (in-network), N61, SF4 (out-of-network deductible only) |
| Unclear | 5 | V31, 2G4, B64 (the brochure has a hospital-facility deductible that the app carries as none or $0), B41, B44 (the out-of-network deductible contradicts itself) |
| **Total** | **118** | |

There are 12 confirmed mismatched fields across those 10 plans (see the JSON in section 4):

- 8 in-network `oop_max` fields: NM1, UX1, A81, P81, A84, P84, RE1, YZ1
- 2 in-network `deductible` fields: A84, P84
- 2 `out_of_network.deductible` fields: N61, SF4

Matched plans by brochure (103):

- **71-004:** 471, 474
- **71-005:** 104, 111
- **71-006:** 311, 314
- **71-007:** 454
- **71-014:** 341
- **71-015:** 441, 444
- **71-017:** 131
- **71-018:** 251, 254
- **71-028:** 421, 424
- **72-001:** 401
- **72-004:** 431
- **73-003:** 591, 594, KC1
- **73-004:** 571, 574, AM1
- **73-005:** 631, 634
- **73-009:** V34
- **73-010:** 871, 874
- **73-012:** 541, 544, PT4
- **73-015:** 521, GY4
- **73-016:** 891
- **73-017:** 644
- **73-019:** 651, 654, N41
- **73-047:** E31, E34, T71
- **73-051:** L11, L14
- **73-052:** JN1, JN4, QQ4
- **73-061:** WJ1, WJ4
- **73-100:** JP1
- **73-197:** EA1
- **73-321:** F81, F84, LA1
- **73-563:** P21, PS1, PS4
- **73-564:** 9K1, 9K4, DK4
- **73-718:** B61
- **73-776:** JK1, JK4, KX1
- **73-797:** 8W4, UW4
- **73-806:** 2X1
- **73-822:** 621, 624, FL1
- **73-828:** 224
- **73-849:** AJ1, GG4
- **73-851:** JC1, JC4, JR1, JR4, P31, P34
- **73-860:** DH1, DH4
- **73-865:** WX1
- **73-877:** B31
- **73-879:** EP1, EP4, F51, F54, G51, G54, H41, H44, JS1, JS4
- **73-889:** NZ1, NZ4, YV1
- **73-890:** LR1
- **73-891:** V41
- **73-899:** YF1
- **73-905:** AS1
- **73-906:** Z24
- **73-936:** W51
- **73-937:** YJ1, YJ4

---

## 2. Confirmed mismatches

"2026 sheet" is the matching tier in `data/benefits.json["2026"]`. "Prior-year brochure value" is the value that the 2027 brochure's Changes section says the figure changed from.

| Code | Plan | Brochure | Field | Tier | App | Brochure | Page | Quote | App = prior year? |
|---|---|---|---|---|---:|---:|---|---|---|
| NM1 | Health Plan of Nevada, High | 73-129 | oop_max | self | 7,000 | 3,500 | p24 | "total $3,500 for Self Only, or $7,000 for a Self Plus One" | It equals the 2026 sheet ($7,000). The 2027 Changes section lists no out-of-pocket change, so the repo cannot show a prior-year brochure value of $7,000. |
| NM1 | | | oop_max | self_plus_one | 14,000 | 7,000 | p24 | "$7,000 for a Self Plus One and Self and Family enrollment" | It equals the 2026 sheet ($14,000). |
| NM1 | | | oop_max | family | 14,000 | 7,000 | p24, p85 | "Nothing after $3,500/Self Only or $7,000/Self Plus One or Self" | It equals the 2026 sheet ($14,000). |
| UX1 | Medical Mutual of Ohio (Northern), Basic | 73-017 | oop_max | self | 6,000 | 6,500 | p25, p83 | "Member Cost BASIC Option without Medicare: $6,500/$13,000" | No. The 2026 sheet was $6,500. The app shows the Standard Option (644) figure. |
| UX1 | | | oop_max | self_plus_one | 12,000 | 13,000 | p25 | "$13,000 for Self Plus One or Self and Family enrollment (for the Basic Option)" | No. The 2026 sheet was $13,000. |
| UX1 | | | oop_max | family | 12,000 | 13,000 | p25, p95 | "Nothing after $6,500/Self Only or $13,000/per" | No. The 2026 sheet was $13,000. |
| A81, P81 | Baylor Scott & White, Basic | 73-881 | oop_max | self | 6,000 | 7,000 | p27, p92 | "is $7,000 for Self Only, $14,000 for Self Plus One, or $14,000" | Yes. The 2026 sheet was $6,000, and p18 says "from $6,000 to $7,000". |
| A81, P81 | | | oop_max | self_plus_one | 12,000 | 14,000 | p27 | (same sentence) | Yes. The 2026 sheet was $12,000, and p18 says "from $12,000 to $14,000". |
| A81, P81 | | | oop_max | family | 12,000 | 14,000 | p27 | (same sentence) | Yes. The 2026 sheet was $12,000. |
| A84, P84 | Baylor Scott & White, Standard | 73-881 | oop_max | self | 5,500 | 6,000 | p27, p90 | "is $6000 for Self Only, $12,000 for Self Plus One, or $12,000" | Yes. The 2026 sheet was $5,500, and p18 says "from $5,500 to $6,000". |
| A84, P84 | | | oop_max | self_plus_one | 11,000 | 12,000 | p27 | (same sentence) | Yes. The 2026 sheet was $11,000. |
| A84, P84 | | | oop_max | family | 11,000 | 12,000 | p27 | (same sentence) | Yes. The 2026 sheet was $11,000. |
| A84, P84 | Baylor Scott & White, Standard | 73-881 | deductible | self | 300 | 350 | p26, p33 | "The calendar year deductible is $350 per person." | Yes. The 2026 sheet was $300, and p18 says "from $300 to $350". |
| A84, P84 | | | deductible | self_plus_one | 600 | 700 | p33 | "$350 for Self Only, $700 for Self Plus One or $700 for Self and Family" | Yes. The 2026 sheet was $600, and p18 says "from $600 to $700". |
| A84, P84 | | | deductible | family | 600 | 700 | p26, p33 | "deductibles are combined and reach $700" | Yes. The 2026 sheet was $600. |
| RE1, YZ1 | Baylor Scott & White, Value | 73-881 | oop_max | self | 9,000 | 9,500 | p27 | "is $9,500 for Self Only, $19,000 for Self Plus One, or $19,000" | Yes. The 2026 sheet was $9,000, and p18 says "from $9,000 to $9,500". |
| RE1, YZ1 | | | oop_max | self_plus_one | 18,000 | 19,000 | p27, p94 | (same sentence) | Yes. The 2026 sheet was $18,000, and p18 says "from $18,000 to $19,000". |
| RE1, YZ1 | | | oop_max | family | 18,000 | 19,000 | p27, p94 | (same sentence) | Yes. The 2026 sheet was $18,000. |
| N61 | Aetna Direct (CDHP) | 73-828 | out_of_network.deductible | self | 1,600 | 2,000 | p35 | "in-network and $2,000 for Self Only, $4,000 for Self Plus One" | Yes. The 2026 sheet was $1,600. p26 says "from $1,600 to $2,000", and that the change applies to both in-network and out-of-network. |
| N61 | | | out_of_network.deductible | self_plus_one | 3,200 | 4,000 | p35 | (same sentence) | Yes. The 2026 sheet was $3,200. |
| N61 | | | out_of_network.deductible | family | 3,200 | 4,000 | p35 | "$4,000 for Self and Family enrollment out-of-network" | Yes. The 2026 sheet was $3,200. |
| SF4 | SelectHealth, Standard | 73-865 | out_of_network.deductible | self | 5,000 | 500 | p27, p73 | "The calendar year deductible is $500 per person under the Standard Option." (p73, out-of-network section) | No. The 2026 sheet was $500, which matches the brochure. Only the 2027 sheet differs. |
| SF4 | | | out_of_network.deductible | self_plus_one | 10,000 | 1,000 | p27 | "$1,000 for Self Plus One, or $1,000 for Self and Family" | No. The 2026 sheet was $1,000. |
| SF4 | | | out_of_network.deductible | family | 10,000 | 1,000 | p27, p73 | "$1,000 for Self and Family enrollment under the Point-of-Service Product" | No. The 2026 sheet was $1,000. |

Notes on the mismatches:

- **NM1.** The only $7,000 / $14,000 in the brochure is the generic IRS sentence on p15: "The IRS limits annual out-of-pocket expenses ... to no more than $7,000". That sentence is the federal ceiling, not this plan's maximum. Section 4 (p24), the Medicare table (p76, "$3,500 self only/$7,000") and the Summary (p85) all say $3,500 / $7,000.
- **UX1.** Section 4 (p25), the Medicare table (p83) and the Summary (p95) all give $6,500 / $13,000 for Basic. The next sentence on p25 says "Self Only of $6,000 applies to each individual". It looks copied from the Standard Option, and it bears on the per-person rule, not on the tier figures. The figure mismatch is consistent across three places, so it is treated as confirmed. The per-person cap is still open (see the earlier family-rules report).
- **Baylor Scott & White.** Section 4 (p26-27), Section 5 (p33), the Summary (p90, p92, p94) and the Changes section (p18) all agree. The Basic deductible ($1,500 / $3,000) and the Value deductible ($2,000 / $4,000) match the app.
- **N61.** Only the out-of-network deductible is wrong. The in-network deductible ($2,000 / $4,000), the in-network maximum ($8,000 / $16,000) and the out-of-network maximum ($10,000 / $20,000) all match.
- **SF4.** The app's out-of-network row matches the brochure's Point-of-Service "Feature Two" (non-participating providers) section in every other respect: its out-of-pocket maximum is $10,000 / $20,000 / $20,000. Only the deductible is 10 times the brochure's figure.
- **Supported fields.** `pipeline/build_data.py` (`apply_benefit_overrides`) currently accepts only the fields `deductible` and `rx_tierN`. The `oop_max` and `out_of_network.deductible` entries below follow the same shape, but the build will reject them as an "unsupported field" until it is extended.

---

## 3. Unclear

| Code | Plan | Issue | Quote 1 | Quote 2 |
|---|---|---|---|---|
| V31 | HealthPartners, High (73-009) | The app has no deductible, and the sheet's `Annual deductible` reads "None". The brochure has a $500 deductible limited to hospital services and MRI/CT. It does not give amounts per tier, and it does not say whether the $500 is per person or per enrollment. | p25: "The calendar year deductible is $500, which applies to inpatient and outpatient hospital services" | p26: "a $500 calendar year deductible specific only to inpatient and outpatient hospital services" |
| 2G4 | CareFirst BlueChoice, Standard (73-718) | The app's deductible is $0 / $0 / $0 (the sheet also says $0). The brochure has a hospital-facility-only deductible of $250 Self Only and $500 for Self Plus One and Self and Family, in-network and out-of-network. Whether it belongs in the app's general deductible field is a modeling question. | p29: "$250 inpatient and outpatient hospital facility deductible for Self Only enrollment" | p20 (Changes): "network deductible is $250 for Self Only and $500 for Self Plus One" |
| B64 | CareFirst Blue Value Plus (73-718) | The same in-network facility deductible ($250 / $500 / $500), plus a separate deductible of $100 / $200 / $200 for Tier 2-5 drugs. The app's deductible is $0 / $0 / $0. | p29: "For Blue Value Plus there is an in-network $250 inpatient and outpatient" | p29: "$100 deductible for Self and $200 for Self Plus One and Self and Family" |
| B41 | Calvo's SelectCare, High (73-874) | Out-of-network deductible only; there is no in-network deductible. The app has $500 / $1,500 / $1,500. Section 4 gives $1,000 for Self Plus One, while every Section 5 page gives $1,500 for Self Plus One. | p27: "for your enrollment reach $1,000 under High and Standard Option" (Self Plus One) | p35 (and p56, p65, p69, p72, p76, p81): "deductible of $500 for Self Only or $1,500 for Self Plus One or Self and Family" |
| B44 | Calvo's SelectCare, Standard (73-874) | The same out-of-network deductible conflict as B41. The app has $500 / $1,500 / $1,500. | p27: "for your enrollment reach $1,000 under High and Standard Option" | p35: "deductible of $500 for Self Only or $1,500 for Self Plus One or Self and Family" |

In every one of these plans the in-network `oop_max` matches the brochure. For B41 and B44 the in-network deductible ($0) also matches.

### Checked and counted as matching (for the record)

- **L14.** The figures ($1,750 / $3,500 / $3,500) match Sections 4 and 5. The Summary's "$1,650 per person for Self Plus One or Self and Family" (p172) affects only the family rule. It does not change any tier figure.
- **Option names.** Five option names differ between the app and the brochure. In each case the figures match their sheet option, so each counts as matching:
  - EA1 (Capital Health Plan): the app's `oop_max` of $3,500 / $7,000 / $7,000 is the medical maximum. The brochure also has a separate pharmacy maximum of $4,600 Self Only / $8,700 (p28), which sits in the sheet's "Annual Out-of-Pocket Maximum for Prescription" fields.
  - JK1, JK4 and KX1 (TakeCare): the brochure has separate prescription drug maximums (p26). These also sit in the sheet's prescription fields.
  - YJ4 (Sharp): the sheet calls it "High Option" and the brochure calls it the Standard Option.
- **Wrong year in the out-of-pocket heading.** Two brochures say "2026" in the heading, but their figures are 2027 figures:
  - 73-563 Presbyterian (p25): "services rendered during the 2026 calendar year". Its $6,350 / $8,150 and $12,700 / $16,300 figures match the app and its own Summary.
  - 73-865 SelectHealth (p28) has the same typo. Its $7,500 / $15,000 matches.
- **B31.** The brochure prints "Self Plus One $3,000 per person" and "$6,000 / Self and Family" (p23 and the Summary). The app's Self Plus One figure of $6,000 follows from the per-person rule for two people.

---

## 4. Machine-readable mismatches

The shape follows the `deductible` entries in `pipeline/benefit_overrides.json`. `sheet` equals the current `data/benefits.json["2027"]` value. The `oop_max` and `out_of_network.deductible` fields are not yet accepted by `build_data.py` (see the note in section 2). For the two out-of-network entries, the sheet's out-of-network row has no raw fields in `raw`, so `raw_fields` is empty.

```json
[
  {"year": 2027, "plan_code": "NM1", "field": "oop_max",
   "raw_fields": ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)", "Annual out-of-pocket maximum (Self & Family)"],
   "sheet": {"self": 7000, "self_plus_one": 14000, "family": 14000},
   "brochure_value": {"self": 3500, "self_plus_one": 7000, "family": 7000},
   "brochure": "73-129", "page": 24,
   "quote": "total $3,500 for Self Only, or $7,000 for a Self Plus One",
   "also": [{"page": 76, "quote": "You pay without Medicare: $3,500 self only/$7,000"},
            {"page": 85, "quote": "Nothing after $3,500/Self Only or $7,000/Self Plus One or Self"}],
   "reason": "Section 4, the Medicare table and the Summary all give $3,500 Self Only / $7,000 Self Plus One and Self and Family; the only $7,000/$14,000 in the brochure is the generic IRS-limit sentence on p15.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-129.txt"},
  {"year": 2027, "plan_code": "UX1", "field": "oop_max",
   "raw_fields": ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)", "Annual out-of-pocket maximum (Self & Family)"],
   "sheet": {"self": 6000, "self_plus_one": 12000, "family": 12000},
   "brochure_value": {"self": 6500, "self_plus_one": 13000, "family": 13000},
   "brochure": "73-017", "page": 25,
   "quote": "$13,000 for Self Plus One or Self and Family enrollment (for the Basic Option)",
   "also": [{"page": 83, "quote": "Member Cost BASIC Option without Medicare: $6,500/$13,000"},
            {"page": 95, "quote": "Nothing after $6,500/Self Only or $13,000/per"}],
   "reason": "Section 4, the Medicare table and the Summary give the Basic Option $6,500 / $13,000; the sheet carries the Standard Option's $6,000 / $12,000 (the 2026 sheet had $6,500 / $13,000).",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-017.txt"},
  {"year": 2027, "plan_code": "A81", "field": "oop_max",
   "raw_fields": ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)", "Annual out-of-pocket maximum (Self & Family)"],
   "sheet": {"self": 6000, "self_plus_one": 12000, "family": 12000},
   "brochure_value": {"self": 7000, "self_plus_one": 14000, "family": 14000},
   "brochure": "73-881", "page": 27,
   "quote": "is $7,000 for Self Only, $14,000 for Self Plus One, or $14,000",
   "also": [{"page": 18, "quote": "Out-Of-Pocket Maximum will increase for the Self Only Plan from $6,000 to $7,000"},
            {"page": 92, "quote": "$7,000 Self Only, $14,000 Self Plus One, $14,000 Self and"}],
   "reason": "Basic Option; the sheet carries the 2026 figures that the Changes section says increased.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-881.txt"},
  {"year": 2027, "plan_code": "P81", "field": "oop_max",
   "raw_fields": ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)", "Annual out-of-pocket maximum (Self & Family)"],
   "sheet": {"self": 6000, "self_plus_one": 12000, "family": 12000},
   "brochure_value": {"self": 7000, "self_plus_one": 14000, "family": 14000},
   "brochure": "73-881", "page": 27,
   "quote": "is $7,000 for Self Only, $14,000 for Self Plus One, or $14,000",
   "also": [{"page": 18, "quote": "Out-Of-Pocket Maximum will increase for the Self Only Plan from $6,000 to $7,000"}],
   "reason": "Basic Option (same brochure as A81); the sheet carries the 2026 figures.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-881.txt"},
  {"year": 2027, "plan_code": "A84", "field": "oop_max",
   "raw_fields": ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)", "Annual out-of-pocket maximum (Self & Family)"],
   "sheet": {"self": 5500, "self_plus_one": 11000, "family": 11000},
   "brochure_value": {"self": 6000, "self_plus_one": 12000, "family": 12000},
   "brochure": "73-881", "page": 27,
   "quote": "is $6000 for Self Only, $12,000 for Self Plus One, or $12,000",
   "also": [{"page": 18, "quote": "Out-Of-Pocket Maximum will increase for the Self Only Plan from $5,500 to $6,000"},
            {"page": 90, "quote": "$6,000 Self Only, $12,000 Self Plus One , $12,000 Self and"}],
   "reason": "Standard Option; the sheet carries the 2026 figures that the Changes section says increased.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-881.txt"},
  {"year": 2027, "plan_code": "P84", "field": "oop_max",
   "raw_fields": ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)", "Annual out-of-pocket maximum (Self & Family)"],
   "sheet": {"self": 5500, "self_plus_one": 11000, "family": 11000},
   "brochure_value": {"self": 6000, "self_plus_one": 12000, "family": 12000},
   "brochure": "73-881", "page": 27,
   "quote": "is $6000 for Self Only, $12,000 for Self Plus One, or $12,000",
   "also": [{"page": 18, "quote": "Out-Of-Pocket Maximum will increase for the Self Only Plan from $5,500 to $6,000"}],
   "reason": "Standard Option (same brochure as A84); the sheet carries the 2026 figures.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-881.txt"},
  {"year": 2027, "plan_code": "A84", "field": "deductible",
   "raw_fields": ["Annual deductible (Self)", "Annual deductible (Self Plus One)", "Annual deductible (Self & Family)", "Net deductible (Self)", "Net deductible (Self Plus One)", "Net deductible (Self & Family)"],
   "sheet": {"self": 300, "self_plus_one": 600, "family": 600},
   "brochure_value": {"self": 350, "self_plus_one": 700, "family": 700},
   "brochure": "73-881", "page": 33,
   "quote": "$350 for Self Only, $700 for Self Plus One or $700 for Self and Family",
   "also": [{"page": 26, "quote": "The calendar year deductible is $350 per person."},
            {"page": 18, "quote": "Deductible will increase for the Self Only from $300 to $350"}],
   "reason": "Standard Option; the sheet carries the 2026 deductible that the Changes section says increased.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-881.txt"},
  {"year": 2027, "plan_code": "P84", "field": "deductible",
   "raw_fields": ["Annual deductible (Self)", "Annual deductible (Self Plus One)", "Annual deductible (Self & Family)", "Net deductible (Self)", "Net deductible (Self Plus One)", "Net deductible (Self & Family)"],
   "sheet": {"self": 300, "self_plus_one": 600, "family": 600},
   "brochure_value": {"self": 350, "self_plus_one": 700, "family": 700},
   "brochure": "73-881", "page": 33,
   "quote": "$350 for Self Only, $700 for Self Plus One or $700 for Self and Family",
   "also": [{"page": 18, "quote": "Deductible will increase for the Self Only from $300 to $350"}],
   "reason": "Standard Option (same brochure as A84); the sheet carries the 2026 deductible.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-881.txt"},
  {"year": 2027, "plan_code": "RE1", "field": "oop_max",
   "raw_fields": ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)", "Annual out-of-pocket maximum (Self & Family)"],
   "sheet": {"self": 9000, "self_plus_one": 18000, "family": 18000},
   "brochure_value": {"self": 9500, "self_plus_one": 19000, "family": 19000},
   "brochure": "73-881", "page": 27,
   "quote": "is $9,500 for Self Only, $19,000 for Self Plus One, or $19,000",
   "also": [{"page": 18, "quote": "Out-Of-Pocket Maximum will increase for the Self Only Plan from $9,000 to $9,500"},
            {"page": 94, "quote": "$19,000 Self Plus One,"}],
   "reason": "Value Option; the sheet carries the 2026 figures that the Changes section says increased.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-881.txt"},
  {"year": 2027, "plan_code": "YZ1", "field": "oop_max",
   "raw_fields": ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)", "Annual out-of-pocket maximum (Self & Family)"],
   "sheet": {"self": 9000, "self_plus_one": 18000, "family": 18000},
   "brochure_value": {"self": 9500, "self_plus_one": 19000, "family": 19000},
   "brochure": "73-881", "page": 27,
   "quote": "is $9,500 for Self Only, $19,000 for Self Plus One, or $19,000",
   "also": [{"page": 18, "quote": "Out-Of-Pocket Maximum will increase for the Self Only Plan from $9,000 to $9,500"}],
   "reason": "Value Option (same brochure as RE1); the sheet carries the 2026 figures.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-881.txt"},
  {"year": 2027, "plan_code": "N61", "field": "out_of_network.deductible",
   "raw_fields": [],
   "sheet": {"self": 1600, "self_plus_one": 3200, "family": 3200},
   "brochure_value": {"self": 2000, "self_plus_one": 4000, "family": 4000},
   "brochure": "73-828", "page": 35,
   "quote": "in-network and $2,000 for Self Only, $4,000 for Self Plus One",
   "also": [{"page": 35, "quote": "$4,000 for Self and Family enrollment out-of-network"},
            {"page": 26, "quote": "from $1,600 to $2,000 and Self Plus One or Self and Family"}],
   "reason": "Aetna Direct: the Changes section raises the deductible to $2,000 / $4,000 for both in-network and out-of-network; the sheet's out-of-network row still has the 2026 $1,600 / $3,200.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-828.txt"},
  {"year": 2027, "plan_code": "SF4", "field": "out_of_network.deductible",
   "raw_fields": [],
   "sheet": {"self": 5000, "self_plus_one": 10000, "family": 10000},
   "brochure_value": {"self": 500, "self_plus_one": 1000, "family": 1000},
   "brochure": "73-865", "page": 27,
   "quote": "$1,000 for Self and Family enrollment under the Point-of-Service Product",
   "also": [{"page": 73, "quote": "The calendar year deductible is $500 per person under the Standard Option."}],
   "reason": "The Point-of-Service Feature Two (non-participating providers) deductible is $500 Self Only / $1,000 Self Plus One and Self and Family in Section 4 and Section 5(i); the same row's $10,000 / $20,000 out-of-pocket maximum matches. The 2026 sheet had $500 / $1,000.",
   "source": "read by hand from pipeline/raw/brochures_txt/2027/73-865.txt"}
]
```
