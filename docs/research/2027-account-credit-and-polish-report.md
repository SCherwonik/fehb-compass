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
  - affects_cost is true and `enrollments` is Self Plus One and Self and Family.
  - `amounts` is null.
  - The figures in the text come from `data/benefits.json`, and a pytest checks them.
- For the family enrollments, "See the math" shows the brochure's order and says the estimate "may be too low, by up to the fund's $2,000" ($1,800 for N61).
- The board's deductible-type note gains its existing exception automatically.
- The cost engine is unchanged.

**How much the estimate may be off.** I measured this with the app's scenarios: 2027, active, one person. For the brochure's order, I raised that person's deductible and out-of-pocket max by the fund amount and then subtracted the fund. The care is priced at the app's own prices. A negative number means the app's total is lower than the brochure's order would give.

| | healthy | typical | condition | worst |
|---|---|---|---|---|
| EP1/F51/G51/H41/JS1, Self Plus One or Family | 0 | 0 | −$1,700 | −$2,000 |
| N61, Self Plus One or Family | 0 | 0 | −$1,440 | −$1,800 |
| EP1/F51/G51/H41/JS1, **Self** | 0 | −$722.50 | −$850 | −$1,000 |
| N61, **Self** | 0 | 0 | −$720 | −$900 |

**Concern: Self Only has the same gap.** I did not flag Self, because the owner rule says Self results must not change. Flagging Self would add the note and the Estimated reason for Self. The owner needs to decide this.

**Regeneration.**
- I ran `python pipeline/build_data.py`. Only `data/benefits.json` changed. Within it, only `known_gaps` changed, and only on N61, EP1, F51, G51, H41 and JS1.
- I compared 8c315ec, extracted with `git archive` into the OS temp directory, against the final HEAD. The comparison covered every 2026 and 2027 plan, the 5 scenarios, active and retiree, the 3 enrollments, and household sizes 1–3 (Self: 1). That is 17,500 combinations.
- **0 totals changed and 0 firmness values changed.** These plans' totals were already 'estimated' whenever there is care, because they use coinsurance. In 'nothing' the gap does not apply.
- The new note does show for family enrollments in every scenario with care, and for a year with only pharmacy fills. For Self it never shows. Node tests check this.

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
