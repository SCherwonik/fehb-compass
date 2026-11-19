# 2027 account-credit plans and three card fixes

## Job 1: plans that pay from an account before the deductible

The batch report listed six plans with the same pattern as 474 (APWU CDHP), but no one had read their brochures. I have now read all six. None of them matches 474. In 474 the plan deductible includes the account. In these six, the brochure puts the account in front of the whole deductible. Each brochure says three things:

- The Medical Fund is used first.
- Then the full deductible must be met.
- "The Medical Fund does not reduce the deductible and/or the out-of-pocket maximum."

The estimate does something different. It gives each person the deductible and then subtracts the fund money as the HRA offset, capped at expected costs. That lets the fund pay the deductible. Because this behaves differently from the app's HRA offset, all six get **verdict (a)**.

| Plan | Brochure, page | Fund (Self / SP1 / Family) | Deductible | Quote (on that page) |
|---|---|---|---|---|
| N61 Aetna Direct | 73-828 p17 (also p16, p115, p117, p161) | $900 / $1,800 / $1,800 | $2,000 / $4,000 / $4,000 | "Once you have exhausted your medical fund, the annual deductible of $2,000" |
| EP1, F51, G51, H41, JS1 Aetna HealthFund CDHP | 73-879 p15 (also p43, p49, p54, p89) | $1,000 / $2,000 / $2,000 | $1,000 / $2,000 / $2,000 | "Once you have exhausted your medical fund, the annual deductible of $1,000" |

- **Prescriptions.** Drugs also come out of the fund first (73-879 p89; 73-828 p161). So `applies_when` is `any_care`.
- **Per person.** The per-person rule is unchanged: once one person meets the Self Only deductible, coverage begins for that person.
- **The earlier summary was wrong.** The batch report said N61's account sits inside its deductible, and that the five CDHPs have a $0 net deductible. The brochures say neither.

**What I changed.**
- Added six `rule_differs` entries to `pipeline/known_gaps.json`, in the same form as 474's:
  - affects_cost is true and `enrollments` covers every enrollment, Self Only included (extended in the follow-up below).
  - `amounts` is null.
  - The figures in the text come from `data/benefits.json`, and a pytest checks them.
- For every enrollment, "See the math" shows the brochure's order, with the Self Only and the family fund and deductible figures. It says the estimate "leaves out the deductible paid after the fund is used up and may be too low, by up to the fund amount".
- The board's deductible-type note gains its existing exception automatically.
- The cost engine is unchanged.

**How much the estimate may be off.** I measured this with the app's scenarios: 2027, active, one person. For the brochure's order, I raised that person's deductible and out-of-pocket max by the fund amount and then subtracted the fund. The care is priced at the app's own prices. A negative number means the app's total is lower than the brochure's order would give.

| | healthy | typical | condition | worst |
|---|---|---|---|---|
| EP1/F51/G51/H41/JS1, Self Plus One or Family | 0 | 0 | −$1,700 | −$2,000 |
| N61, Self Plus One or Family | 0 | 0 | −$1,440 | −$1,800 |
| EP1/F51/G51/H41/JS1, **Self** | 0 | −$722.50 | −$850 | −$1,000 |
| N61, **Self** | 0 | 0 | −$720 | −$900 |

**Self Only has the same gap, and it is now flagged** (follow-up below). The flag changes no total, only the note and the firmness.

**Regeneration.**
- I ran `python pipeline/build_data.py`. Only `data/benefits.json` changed. Within it, only `known_gaps` changed, and only on N61, EP1, F51, G51, H41 and JS1.
- I compared 8c315ec, extracted with `git archive` into the OS temp directory, against the final HEAD. The comparison covered every 2026 and 2027 plan, the 5 scenarios, active and retiree, the 3 enrollments, and household sizes 1–3 (Self: 1). That is 17,500 combinations.
- **0 totals changed and 0 firmness values changed.** These plans' totals were already 'estimated' whenever there is care, because they use coinsurance. In 'nothing' the gap does not apply.
- The note shows for every enrollment, Self included, in every scenario with care and in a year with only pharmacy fills. Node tests check this.

## Job 2: three card defects

1. **Card tags.**
   - Problem: a tag explained itself only with `title` on a non-focusable `<li>`.
   - Fix: a tag with an explanation is now a `<button>`, following the board's `bd-hint`/`bd-tip` disclosure pattern. It has `aria-expanded` and `aria-controls`, and its `aria-describedby` points to a tip paragraph below the chips. Clicking or tapping it shows the tip and closes the card's other tips. I removed the title, so the text has one source.
   - This covers Estimated, Fixed cost, Out-of-network, maternity, vs-your-plan, service area and 2026 rates.
   - The warning flags now have real text, built from the 2026 and 2027 figures the flag was computed from (`flagTip`). Example: "The deductible goes from $100 in 2026 to $150 in 2027." When a figure is missing, there is no tip.
2. **Drug name on phones.** Below 560 px the drug row wraps, so the name takes its own line, and it breaks only between words. Wider layouts are unchanged (checked at 1280 px: same row, `overflow-wrap: anywhere`).
3. **"per year, estimated" caption.** The caption now follows the total's firmness, like the tag, so a fixed total reads "per year". This also holds in the board header. Tests updated.

## Browser checks (local `http.server`, server stopped afterwards)

- **375 px.** "Zorbitol" is on one line and the "Not looked up" select sits below it.
- **Keyboard.** Tab reaches Estimated and then each flag tag. Enter opens the tip: `aria-expanded` is true and the tip is visible. Its text is the button's `aria-describedby` target. `read_page` does not print descriptions, so I read that link from the DOM.
- **Tap.** Tapping "Deductible went up" shows its tip.
- **"Nothing" scenario.** The caption reads "per year" and the tag reads "Fixed cost".
- **Light theme** (set with the app's own toggle). The family inputs (people list, the expanded person, the scenario control), a card's "See the math" (bars and text) and the full-screen Board dialog were all readable, with visible bars. I found no defect. The person's scenario selector is tight at 800 px ("Typical" and "Condition" nearly touch), but that is not specific to the light theme, and I did not change it.
- **Not checked:** a real screen reader, and real touch hardware (I only used a mouse click at mobile emulation).

## Tests

- Node: 489 → 495 (new: six-plan gap test, `tests/tag-tips.test.js` ×4, caption test).
- Pytest: 303 → 304.
- Both suites passed before each commit.

## Follow-up: the note now covers Self Only too, the 474 check, and the hover tip

**1. The six fund-first entries now apply to every enrollment.**
- The rule is the same for Self Only in both brochures: 73-828 p17 and 73-879 p15 state the fund first, then the whole deductible, for every enrollment.
- The six entries now list all three enrollments, and `applies_when` stays `any_care`.
- The text states the brochure's own figures for Self Only and for the family enrollments, and what the estimate leaves out. For example, EP1 reads: "Medical Fund ($1,000 for Self Only, $2,000 for Self Plus One or Self and Family) is used first, and only then does the whole deductible apply…". It then says the estimate "leaves out the deductible paid after the fund is used up and may be too low, by up to the fund amount". It states no other amount.
- The "Self is not flagged" sentence is gone from each entry's `reason`.

**Regeneration and comparison.**
- Only `known_gaps` changed in `data/benefits.json`, and only on N61, EP1, F51, G51, H41 and JS1.
- Compared again against 8c315ec (a fresh `git archive` in the OS temp directory) over the same grid of 17,500 combinations: **0 totals changed and 0 firmness values changed**. These plans' totals are already 'estimated' whenever a scenario has care, and in 'nothing' the gap does not apply.
- An extra probe adds a pharmacy-only year (one monthly generic, nothing else). Over 21,000 combinations it still has 0 total changes. Firmness goes from fixed to estimated in exactly these cases:
  - N61, EP1, F51, G51, H41 and JS1, Self (household 1);
  - the same six, Self Plus One and Self and Family (households 1, 2 and 3).
- Those firmness changes come only from the pharmacy-only year: the five standard scenarios show none.
  - The family ones were already introduced by 6ec98ab.
  - The Self ones are new in 2458558.

**474 (APWU CDHP) for Self Only: not extended.**
- 71-004 p28 for Self Only: the $2,200 plan deductible is reduced by the $1,200 PCA, and the net deductible is $1,000.
- The estimate does the same thing: a $2,200 deductible, then the $1,200 account subtracted. That gives the same order for Self, so the first $1,200 of care costs nothing and the next $1,000 is the member's.
- The rule the estimate does not model is family-only, and p28 states it only for "Self Plus One or Self and Family coverage": one person meets $1,000, and the other members meet an additional $1,000.
- So the 474 entry stays Self Plus One and Self and Family.
- One question remains open, and it is unchanged from the earlier report. The brochure does not say whether account payments count toward the out-of-pocket limit (p31: "If you have exceeded your Personal Care Account and met your Deductible"). This affects Self too: in a worst-case year the Self estimate could be $1,200 low under one reading. That is an unstated rule, not the p28 rule, so I did not flag it. The owner may decide.

**2. Hover.**
- Removing `title` had removed the mouse tooltip. A mouse pointer over a tag now shows the same tip paragraph (`hoverTip`, class `is-hover`, which beats the global `[hidden]` rule). Leaving the tag hides it, unless a click opened it.
- Click, tap, Enter and Space toggle it as before, and only one tip is open per card.
- The logic moved to `src/ui/tag-tips.js`. Tests drive `toggleTip` and `hoverTip` with fake elements.
- Browser check (800 px, dark theme, local server stopped afterwards):
  - hovering Estimated showed the tip;
  - moving away hid it;
  - a click kept it open after the pointer left;
  - Enter on the focused tag closed it, and Space opened it again;
  - `aria-describedby` points to the tip text.
- Not checked: real touch hardware and a screen reader.

**Tests:** node 497 (was 495; +2 tag-tips tests) and pytest 304 (the fund-first test was rewritten for every enrollment). Both suites passed before each commit.

## Final review: Minor items and the 474 owner decision

**The six account-first plans stay flagged, not modeled.**
- Plans: N61, EP1, F51, G51, H41 and JS1.
- The owner chose the safe default. The brochures do not fully state how the fund interacts with copays and with the out-of-pocket max.
- The entries change no total, only the note and the firmness.

**1. Tag tips** (`src/ui/tag-tips.js` `createTipController`, wired in `src/ui/results.js`).
- **(a) Escape** closes the open tips.
  - It returns focus to a tag whose tip the keyboard opened.
  - A tip opened by hover stays closed until the pointer leaves the tag.
  - When a dialog is open (the full-screen board), Escape belongs to the dialog.
- **(b) Hover** keeps the tip open while the pointer is on the tag or on the tip.
  - Leaving both closes the tip after 300 ms.
  - On the way to the tip, the pointer may cross another tag of the same card. That tag opens only if the pointer is still on it when the 300 ms grace ends.
- **(c) One tip per card**, whether it was opened by hover, click or keyboard.
- **(d) Clicking a pinned tip closes it**, even with the mouse still on the tag, and hover does not reopen it until the pointer leaves and comes back.
  - A click on a tip that hover opened pins it instead.
  - `aria-expanded` always matches whether the tip shows.
- **(e) Rebuilds keep focus.**
  - Each tag has a stable key, with ids `tag-<code>-<key>` and `tip-<code>-<key>`.
  - When a card's chips rebuild, focus returns to the tag with the same key, pending timers are dropped, and the new tips start closed.
- **(f) Heights:** `.tag-btn` min-height is now 24 px (the tag's 26 px less its two 1 px borders). Tags with and without a tip both measure 26 px in the browser.
- **Tests:** the controller is tested with fake elements and fake timers, one test each for (a) to (e), plus the crossing case for (b).

**Browser check** (800 px; local server stopped afterwards):
- all 76 tag ids and their tip ids are unique;
- every `aria-describedby` points to its own tip;
- hovering Estimated and then moving onto its tip, crossing the "Deductible went up" tag on the way, kept the Estimated tip open, and Escape closed it;
- the keyboard opened the deductible tip; with focus moved to "See the math", Escape closed the tip and focus went back to its tag;
- a click on a tip opened by hover pinned it, and a second click with the mouse still on the tag closed it (`aria-expanded` false);
- changing the scenario rebuilt a focused "vs your plan" tag (+$404 became +$914): focus stayed on the new tag, and no tip was left open.

Not checked: real touch hardware and a screen reader.

**2. "In-network" in the six notes.**
- The notes now say "the whole in-network deductible" and name the out-of-network deductible:
  - 73-879 p15: $1,500 Self Only, $3,000 Self Plus One or Self and Family;
  - 73-828 p17: "the same".
- The build re-checked the quotes, which are unchanged and still on their pages.

**3a. "Fixed cost" tip.**
- `fixedTitle`: a year with no services, medications or own cost lines reads "No care is assumed in this scenario, so no cost sharing applies and this total does not depend on assumed prices."
- Otherwise the tip keeps the flat-copay sentence.
- The same text is used on the card tag and in "See the math". Checked in the browser for "Start from nothing".

**3b. Caption.** With the dental/vision add-on, the caption now reads "per year, estimated, incl. dental/vision". Before, the add-on label replaced "estimated".

**4. 474 out-of-pocket assumption (owner decision).**
- **What the brochure says.** 71-004 p31 gives the limit ($6,500 Self Only, $13,000 Self Plus One or Self and Family, in-network) "If you have exceeded your Personal Care Account and met your Deductible". It does not say whether the account's payments count toward the limit.
- **What the engine does, read in `src/engine/cost.js`.**
  - `planTotal` and `familyTotal` cap all cost sharing at the out-of-pocket maximum, including the costs the account pays. Each person is capped at the Self Only maximum, and the family at the enrollment's.
  - Then they subtract the account money as the HRA offset, capped at those costs.
  - So the estimate counts the account's payments toward the limit. The behaviour is stable and defined.
  - A test checks it: Self, worst year: costs equal $6,500 and the offset equals $1,200.
- **New entry.** A second 474 entry with the new kind `rule_assumed`:
  - affects cost; applies to every enrollment; `applies_when` any_care; page 31;
  - quote: "If you have exceeded your Personal Care Account and met your Deductible";
  - text: the brochure does not say whether account payments count; the estimate assumes they do; and how it applies that. It states only brochure amounts.
- **Supporting changes.**
  - The build accepts the new kind.
  - The firmness line and the Estimated tip say "the plan's brochure does not state a rule this estimate has to assume".
  - The family net-deductible entry (`rule_differs`) is unchanged and listed first.
  - Self now shows only the new note.

**Totals.**
- Compared a4cf311 (`git archive` into the OS temp directory, deleted afterwards) with HEAD: every 2026 and 2027 plan, 5 scenarios, active and retiree, 3 enrollments, households 1–3 (17,500 combinations).
- **0 totals changed and 0 firmness values changed.**
- With the pharmacy-only year added (21,000 combinations), the result is also 0 and 0. 474's totals were already estimated in every year with care, because of its coinsurance.
- Regenerating the data changed only `known_gaps` on 474, N61, EP1, F51, G51, H41 and JS1.

**Tests:** node 505 (was 497), pytest 305 (was 304). Both suites passed before each commit.
