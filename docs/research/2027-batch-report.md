# 2027 batch: per-person cap notes, 9K4, 474, hospital-deductible triggers, tooltip, wording

Date: 2026-11-18. Base: ccc1996. All brochure quotes were re-read in `pipeline/raw/brochures_txt/2027/` (PDF page numbers) and pass the build's quote check.

## What changed, by letter

**A. Per-person cap not stated (13 plans).**
- New known-gap kind `cap_not_stated` in `pipeline/known_gaps.json`. Each entry has `affects_cost: false` and `enrollments: [self_plus_one, family]`.
- 421, 424, W51, A81, P81, A84, P84, RE1, YZ1 and YJ1 use the "enrollment-wide amounts only" sentence. EA1, YJ4 and 8W4 use the "prints “per person”" sentence.
- Each sentence names the plan's own Self Only maximum. The build checks that it does.
- The engine's `capNotes` feeds "See the math", which shows the sentence for Self Plus One and Self and Family. No total or firmness changes.
- Quotes and pages: 71-028 p29 and p30; 73-936 p26; 73-881 p27; 73-937 p24 and p25; 73-197 p28; 73-797 p30.
- Kaiser Hawaii 631 and 634: 73-005 p101 says "$3,250 per person" (High) and "$3,500 per person" (Standard), under "Out-of-pocket maximum (3x per family)". I verified this. The data has no natural place for evidence that confirms the assumption, so nothing was added and no note is shown.

**B. Altius 9K4.**
- Added to `pipeline/individual_deductibles.json` as 3,500 / 3,500, brochure 73-564 p30: "Once an individual meets a deductible of $3,500 under the Self Plus One". The same sentence is on p17, p22, p104, p105, p120, p129, p133, p136, p139, p146 and p174, with the $3,600 family deductible.
- 9K1 and DK4 are untouched.
- Money effect (2027, active and retiree alike): one person on Self Plus One or Family in the chronic-condition year pays **$100 less**. SP1 goes from $13,043.12 to $12,943.12, and Family from $11,824.76 to $11,724.76.
- Every other scenario and household is unchanged. In the worst case the $6,000 cap applies either way.
- A mixed household moves by the person order. Family worst+condition gains $100; condition+worst loses $100.

**C. APWU CDHP 474 (not fixed; flagged).**
- Brochure 71-004 p28: the Personal Care Account ($1,200 / $2,400) is used first. Then the Net Deductible applies ($1,000 / $2,000), and "once one individual meets the Self Only Net Deductible of $1,000" coverage begins for that person.
- The app gives each person the $2,200 deductible inside $4,400 and subtracts the HRA credit afterwards. The `Net deductible` raw fields are used only as a Board matrix row (`src/ui/matrix-model.js`), not by the engine.
- Measured with a throwaway script (premium included, 2027, active). The brochure order was computed by hand: account first, then $1,000 per person (family $2,000), then 15%. Generic drugs were priced as the app prices them.

| Enrollment, people (scenario) | App | Brochure order, read as A: account payments do not count toward the out-of-pocket max (not what the brochure says; see below) | Brochure order, read as B: they count (what the brochure says, p31-32) |
|---|---|---|---|
| SP1, 1 (condition) | $6,529.56 | $7,549.56 (app −$1,020) | same |
| SP1, 2 (typical) | $7,579.56 | $6,964.56 (app +$615) | same |
| SP1, 1 (worst) | $9,899.56 | $12,299.56 (app −$2,400) | $9,899.56 (0) |
| Family, 1 (condition) | $7,056.84 | $8,076.84 (app −$1,020) | same |
| Family, 2 (condition) | $10,186.84 | same | same |
| Family, 4 (typical) | $8,968.84 | $9,016.84 (app −$48) | same |
| Family, 1 / 2 / 4 (worst) | $10,426.84 / $16,926.84 / $16,926.84 | app −$2,400 each | 0 |

- The hand model does not let the account pay for drugs. That simplification alone moves a typical year by up to $180, so the small figures are approximate.
- *Corrected after the final review:* this report first said the brochure leaves open whether account payments count toward the out-of-pocket max. It does not leave it open: p31-32 list "The Personal Care Account (PCA) of $1,200 for Self Only or $2,400 for Self Plus One or Self and Family" among the out-of-pocket expenses that count toward the limit. So column B is the brochure's order, and the app counts the account that way too (it caps costs, the account-paid ones included, then subtracts the account). The worst-case difference is $0. The model was not changed: the remaining difference is the account-first, then $1,000-per-person deductible rule (p28).
- Added a cost-affecting gap instead: new kind `rule_differs`, Self Plus One and Self and Family only. The total is unchanged, firmness is 'estimated', and "See the math" carries a plain sentence.
- Self Only matches the brochure order: the account is used first, then the $1,000 net deductible (p28), and account payments count toward the limit (p31-32). Self is not flagged, because Self results must not change.
- Same pattern, not fixed (from `account_type`): the plan deductible includes the account, and the app gives each person the Self Only share.
  - N61 (Aetna Direct CDHP): $900 / $1,800 account inside a $2,000 / $4,000 deductible.
  - EP1, F51, G51, H41 and JS1 (CDHPs): the account equals the whole deductible, with a $0 net deductible.
  - 8W4 (HDHP with HRA) is modeled as shared, so its total matches the net amount.
  - None of these brochures was read for this.

**D. Hospital-deductible note only when it can apply.**
- Gaps may carry `applies_when`. The words are hospital, outpatient_surgery, imaging and brand_drugs; the build and the engine share the list, and a test compares them.
  - V31: hospital, outpatient_surgery, imaging.
  - 2G4 and B64 (facility): hospital, outpatient_surgery.
  - B64 (drug): brand_drugs.
- What counts as each trigger:
  - "hospital": a scenario stay, an own hospital-stay line, or a maternity line (it includes the birth stay).
  - "brand_drugs": an own drug line on tier 2 or higher, or with no tier; any medication from the list (its tier number is unknown); never monthly generics.
  - ER visits do not trigger. In 73-009 and 73-718 the ER is a flat copay.
- In 'nothing' the note is gone and firmness is what it would be without the gap ('fixed' for all three). In 'worst' the note shows.

**E. Tooltip.** `estimatedTitle` (`src/ui/math-family.js`) names what makes the total an estimate:
- a known gap;
- a brochure that contradicts itself;
- a brochure rule the estimate does not model;
- assumed prices (new breakdown flag `pricesMatter`).

With assumed prices as the only reason, the old sentence stays. The card's chip key includes the tooltip.

**F. Reviewer items.**
1. About and README now list Aetna HealthFund (224) and Altius (9K4) among the brochures that state the per-person cap, and describe 9K4's threshold.
   - The 224 statement is on p16 and p37, not p15. p15 has the $3,500 deductible sentence; the out-of-pocket sentence starts at the end of p15 and finishes on p16. 9K4's is on p17 and p104.
   - `personLimitsNote` (individual type) now says "as the brochure also states" for the cap. The about text of `individual_deductibles.json` requires this of any future entry.
   - The Board label "Embedded (assumed)" became "Embedded (per person)". Its note says many brochures state the rule and the tool assumes it otherwise.
2. Build checks:
   - The year must be an integer and the quote a string, for both files, with a clear ValueError.
   - An individual threshold requires an HSA plan or an HDHP. Without one, `deductibleType` would call it 'embedded' and ignore the threshold. 224 and 9K4 are 'aggregate' before their threshold.
   - Without `pipeline/raw/brochures_txt`, the build prints "quote check skipped for N entries (...)".
3. Wording: "(the cautious choice)" was added to the KX1/L14 wording in About and README, and "marks those estimates estimated" now reads "marks those totals as estimated".

## Checks

- Tests: `python -I -m pytest pipeline/tests -q` passed 300 (was 290). `node --test tests/*.test.js tests/engine/*.test.js` passed 487 (was 472). Both suites ran before each commit.
- Data: after each regeneration only `data/benefits.json` changed. Within it, only `deductible_individual(_source)` changed on 224 (reason text) and 9K4, and `known_gaps` on the 13 cap plans, V31, 2G4, B64 and 474.
- Base versus final: ccc1996 (via `git archive`) against the final code and data. That is 22,500 runs: every plan with rates in both trees, 2026 and 2027, active and retiree, 5 scenarios, Self ×1 and Self Plus One / Family × 1-4 people in the same scenario.
  - Totals differ only for 9K4, SP1 and Family, condition, 1 person (−$100).
  - Firmness differs only for:
    - 474 (SP1 and Family, 'nothing': fixed → estimated);
    - V31 (healthy and nothing: estimated → fixed);
    - 2G4 and B64 (healthy, typical, condition and nothing: estimated → fixed).
  - Self totals are identical for every plan. Self firmness changed only for V31, 2G4 and B64 (the gap rule).
- Browser (local server, desktop width): no console errors.
  - A81, A84 and YZ1 (Family, TX 76502): "See the math" shows the note with the right Self Only limit.
  - V31 (Self, MN 55401): in 'worst' it shows the $500 note, an 'estimated' firmness line and the tooltip naming the gap. In 'nothing' it is "Fixed cost" with no note.
  - 9K4 (Family, UT 84101): the bars read "individual stops at $3,500 of the family’s $3,600".

## Not checked

- 2G4, B64 and 474 cards in the browser, the Board dialog, dark theme, and narrow widths.
- The tooltip was read from the DOM `title`, not hovered.
- EA1's separate $4,600 pharmacy maximum against the app.
- The 474 PDF layout, and the brochures of the other CDHP plans listed under C.

## Decisions for the owner

- **474.** Decide whether to model "account first, then $1,000 per person" (p28). Account payments count toward the out-of-pocket max (p31-32), which is what the app already does. The same question applies to N61, EP1, F51, G51, H41 and JS1.
- **Triggers.** ER visits do not trigger the V31, 2G4 and B64 deductibles. Brochure medications always trigger B64's Tier 2-5 deductible, because their tier number is not known to the engine.

## Fixes after the final review

Base for this pass: 778cb3b. Every brochure page cited below was re-read in the brochure text.

- **2G4/B64 facility deductible (Important 1).**
  - 73-718 p74 lists "Outpatient Hospital (Non-Surgical and Clinic Visit): deductible, then" a copay: $100 for Standard BlueChoice and $50 for Blue Value Plus.
  - For diagnostic services (labs, X-rays and other tests) received at an outpatient hospital, "the deductible applies in addition to the copay" (p74 and p75).
  - The app does not know where care is received, so the facility gap now uses a new `applies_when` token, `any_care`. It counts any scenario service, own line or medication; only a year with no care at all stays unflagged.
  - The note now names those services. B64's drug-deductible gap keeps `brand_drugs`.
  - V31 is unchanged. 73-009 p36 charges labs and X-rays 20% with no deductible, while MRI/CT carries the $500 hospital deductible "even for services received in an office", and p25 limits the deductible to hospital services and MRI/CT.
  - In the browser (MD 20901, Self), 2G4 and B64 show "Estimated" in the healthy year with the gap note and tooltip, and "Fixed cost" with no note only in "nothing". No console errors.
- **474 note (Important 2).**
  - 71-004 p28 says the account is used first. Once one individual meets the $1,000 Self Only net deductible, coverage begins for that individual; once the other covered members meet "the additional $1,000", it begins for them.
  - The note now says exactly that, with $2,000 in all for the family, and gets `applies_when: ["any_care"]`. The measured differences above used this rule (the others share the additional $1,000), so they stand.
- **Board label (Minor a).**
  - New `pipeline/embedded_deductibles.json` lists the 61 codes in the research summary row "Brochure confirms per-person (embedded)". Brochure and page come from the research table; the build attaches each as `deductible_rule_source` and checks every quote on its page (61 of 61 pass).
  - The board reads "Embedded (per person, brochure)" with brochure and page for these, and "Embedded (assumed)" for every other embedded plan (WJ4 and AS1 included).
  - Where a table row covers several options and its quote names another option's amount, the quote is that option's own sentence on the page the research cites: 424, KC1, AM1 and N41 on 71-028 p27, 73-003 p25, 73-004 p26 and 73-019 p27; 254 on 71-018 p26; PS4 on 73-563 p31.
  - 73-879's Value Plan codes (EP4, F54, G54, H44, JS4) use the p16 sentence the research cites.
- **Minor b–e.**
  - b: an individual-threshold column gives its own plan's amounts and page (9K4: $3,500 of $3,600, 73-564 p30).
  - c: About and README no longer say "state it" twice.
  - d: EA1's note now covers both family lines, the $7,000 medical and $8,700 pharmacy amounts, and the p74 "apply separately to each person" sentence.
  - e: the relabel-or-rebuild decision of `setOptions` is now the pure `optionsUpdate` (tested), and the unused `sameOptionValues` is gone.
- **Checks.**
  - Before each commit of this pass: pytest passed 303 and node passed 489.
  - 778cb3b against the final tree, 22,500 runs: **no total changed**. Firmness changed only for:
    - 2G4 and B64, all enrollments, healthy, typical and condition: fixed → estimated;
    - 474, Self Plus One and Family, all-'nothing' households: estimated → fixed.

## Fixes after the scoped re-review

Base for this pass: 6478ed6.

- **GG4 (Important).**
  - 73-849 p24 says "$350 per person under self only enrollment in our Standard Option". For Self Plus One and Self and Family the same paragraph gives only the combined $700; it states no per-person rule within a family enrollment.
  - GG4 is removed from `pipeline/embedded_deductibles.json` (now 60 plans) and moved from the "Brochure confirms per-person" row (now 60) to "Not stated" (now 3) in `docs/research/2027-family-rules-from-brochures.md`. The table still totals 118, and a test checks that sum.
  - The board now says "Embedded (assumed)" for GG4. After regeneration only GG4's `deductible_rule_source` changed.
- **Same standard applied to the other 60.** I read each quote together with the text after it on its page.
  - None restricts the per-person amount to Self Only enrollment.
  - The "$X per person" quotes (471, 421, 424, 401, 594, KC1, 574, AM1, 634, V34, 874, PT4, GY4, UX1, 654, N41, T71, L11, LA1, PS1, PS4, FL1, DH1, SF4, YV1, YF1, YJ1) state the amount per person without an enrollment qualifier. Each is followed by the family rule (combined covered expenses reaching the family amount) or the per-enrollment amounts.
  - The other quotes state the rule within a family enrollment directly:
    - 104, 131 and the 73-881 codes: "both family members must meet the individual deductible";
    - 311, 314, 251, 254: "satisfied for an individual";
    - 441, 444, 454: "per person limit for any covered individual";
    - 431: "one individual not to exceed";
    - QQ4, 9K1, DK4, N61, Z24 and the 73-879 codes: "Once an individual meets the Self Only deductible under the Self Plus One";
    - UW4: "if one member meets the individual deductible";
    - 474: the individual net deductible.
  - No other plan moved.
- **474 on the board (Minor 1).** A plan whose known gaps include a cost-affecting `rule_differs` entry now gets an exception in its board note: the brochure describes its deductible in a way this tool does not model, see the math, brochure 71-004 page 28. This comes from the data; there is no plan-code check.
- **Pharmacy-only years (Minor 2).**
  - A new token, `medical_care`, counts any care except pharmacy (scenario visits, labs, imaging, ER, stays, and own lines that are not drugs). The 2G4 and B64 facility gaps now use it, so a year whose only care is pharmacy no longer triggers them.
  - B64's drug-deductible gap keeps `brand_drugs`.
  - 474 keeps `any_care`, which includes medications. 71-004 p89 says that during the deductible phase prescription costs are paid from the PCA and then the net deductible, so drugs do count for its account rule.
  - Side finding, not changed: the app prices 474's generic fills at 25% outside the deductible, while p89 says the member pays the whole drug cost (from the PCA, then the net deductible) until the deductible phase ends.
- **EA1 (Minor 3).** The note now says the brochure "does not say plainly whether that is each person’s own limit".
- **Checks.**
  - pytest passed 303 and node passed 489.
  - 6478ed6 against the final tree, 22,500 runs: no total changed and **no firmness changed**. No built-in scenario is pharmacy-only: 'nothing' has no care and every other scenario has visits.
