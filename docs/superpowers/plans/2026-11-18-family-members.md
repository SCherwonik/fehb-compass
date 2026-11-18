# Family Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self Plus One and Family enrollments cost one year of care per covered person, with per-person and family limits applied.

**Architecture:** `expectedOop` gets an optional running tally (`carry`) so members can be costed one after another; a new `planTotal` path sums the members. State keeps member 1 in today's fields and adds `others` (members 2 to 8) and `familySize`. Custom lines and medications gain a `member` index. "See the math" renders one block per member plus a family block.

**Tech Stack:** Vanilla JS ES modules, no build; `node --test tests/*.test.js tests/engine/*.test.js`.

**Spec:** `docs/superpowers/specs/2026-11-18-family-members-design.md`

**Deviation from the spec (same behavior, simpler):** members are identified by index (0 to 7), not by id. Member 1 ("You") stays in `state.scenario`, `state.overrides` and the existing custom lines; `state.others` holds members 2 to 8. This makes old links and old saved data work with no migration code. Only members 2 and up have a name (member 1 is "You").

## Global Constraints

- No contact email anywhere. Medications never in the URL, per member included (`meds-store.js` stays localStorage-only).
- Member names go in the link (like custom-cost labels); the privacy hint under the name field must say so.
- Self enrollment: totals, hash and UI identical to today (every existing test passes unchanged).
- Limits: `MAX_MEMBERS = 8`; `familySize` 3 to 8, default 4; member names at most 20 characters after `plainText`.
- Embedded plans: each member's deductible and out-of-pocket max are the self-only ones; family out-of-pocket max (the enrollment's value) caps the sum. Aggregate and unknown HDHPs: one shared deductible (the enrollment's), each member's out-of-pocket max still capped at the self-only one, plus the family cap.
- A missing family value falls back to the self-only value and says so in "See the math".
- Commits: `-c user.name=SCherwonik -c user.email=32806675+SCherwonik@users.noreply.github.com`, ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; explicit file lists; Bash git is `"/c/Program Files/Git/cmd/git.exe"`.

## Review Focus

- Switching Family to Self and back keeps members 2 to 8 and their settings.
- Drugs and custom lines tied to a member beyond the current count stay saved, are left out of totals, and are shown as "not covered at this enrollment".
- A maternity line on member 2 is priced once and its cost shows under member 2.
- Old links (no `mb`, no `fs`, no member flag on lines) and old saved medications (no `member`) open as a one-person year with identical totals.
- Member names with `_`, `&`, `=`, `<` survive the link and render as plain text.

## File Structure

- `src/engine/cost.js`: `carry` in `expectedOop`; members path in `planTotal`.
- `src/engine/scenarios.js`: `member` on custom lines.
- `src/state.js`: `familySize`, `others`, `memberCount`, hash codec.
- `src/ui/model.js`: `memberUsages`, `withDrugs`, `costInputs`, `makeRow`, maternity.
- `src/ui/meds-store.js`, `src/ui/rx-model.js`: `member` on drugs and entries.
- `src/ui/scenario.js`, `src/ui/inputs.js`, `src/ui/custom-lines.js`, `src/ui/meds.js`, new `src/ui/members.js`: inputs.
- `src/ui/math.js`, `src/ui/results.js`, `src/ui/results-board.js`: output.
- Tests: new `tests/engine/family.test.js`, `tests/state-members.test.js`, `tests/members-model.test.js`; extend none of the existing ones.

---

### Task 1: Engine: running tally and the members path

**Files:**
- Modify: `src/engine/cost.js` (`expectedOop`, `planTotal`)
- Test: `tests/engine/family.test.js` (new)

**Interfaces:**
- Produces: `expectedOop(benefits, usage, assumptions = {}, drugs = [], carry = null)`. `benefits` may carry `familyOopMax` and `oon.familyOopMax` (number or null). `carry = { dedUsed, oopUsed, oonUsed }` (all default 0). `dedLeft` starts at `deductible - dedUsed` (min 0). The in-network cap is `min(oopMax - total, familyOopMax - oopUsed - total)`; out-of-network likewise with `oonUsed`. The result adds `carryOut = { dedUsed: dedUsed + deductiblePaid, oopUsed: oopUsed + (in-network total before oon and not-covered), oonUsed: oonUsed + oonPaid }`. With `carry` null and no `familyOopMax`, every field is identical to today.
- Produces: `planTotal(plan, inputs)` where `inputs.members` is an optional `[{ usage, drugs }]`. With no `members` or one member the result is exactly today's. With 2 or more: run the members in order, passing each `carryOut` on; for embedded plans pass `dedUsed: 0` to every member (their deductibles are separate); for `aggregate` and `unknown` plans pass the running `dedUsed` and use `person.deductible` from `personLimits` (the enrollment's). `familyOopMax` is `resolveBenefits(...).oopMax` (null falls back to self-only, flagged `breakdown.familyFallback = true`). Result: same shape as today with `oop` the sum, plus `breakdown.members = [{ oop, deductiblePaid, coinsurancePaid, copays, oonPaid, services, drugs, drugsPaid, drugsDeductible, notCoveredPaid, custom, unpriced, estimated, warnings }]` and top-level fields as sums (services merged by `service|label` with counts and costs added; `custom` and `drugs` concatenated; warnings de-duplicated); `breakdown.onePerson` is `false`, `breakdown.memberCount` the count, `breakdown.familyOopMax` the cap used.

- [ ] **Step 1: Write the failing tests** in `tests/engine/family.test.js` (load `rates.json` and `benefits.json` the way `tests/engine/services-breakdown.test.js` does; `SCENARIOS` from `src/engine/scenarios.js`; `deductibleType` and `resolveBenefits` from `src/engine/cost.js`):
  - `one member equals today's total`: for every costable plan, scenarios healthy, typical, condition, worst, enrollments self and family, `planTotal(plan, { ...base, members: [{ usage }] })` deep-equals the `oop`, `total` and `breakdown.deductiblePaid` of `planTotal(plan, { ...base, usage })`.
  - `carry`: for one plan, `expectedOop(b, usage, {}, [], { dedUsed: b.deductible })` has `deductiblePaid === 0`; `{ oopUsed: b.oopMax }` has `total === 0`; `carryOut.oopUsed` equals the plain run's in-network total.
  - `embedded plans cap the sum at the family max`: for every plan with `deductibleType === 'embedded'` and a finite `resolveBenefits(...).oopMax`, 3 identical `worst` members on enrollment family give `oop` within 0.02 of `min(3 * single, familyMax)`, where `single` is the one-member family-enrollment `oop`.
  - `one sick member never exceeds the self-only max`: members `[worst, nothing, nothing]` on an embedded plan give `oop` equal to the one-member `oop`.
  - `order does not matter on embedded plans`: members `[typical, worst]` and `[worst, typical]` give the same `oop` (within 0.02).
  - `aggregate plans share the deductible`: for every plan with `deductibleType === 'aggregate'`, members `[typical, typical]` give `breakdown.deductiblePaid <= person.deductible + 0.02` (the enrollment's deductible).
  - `family fallback`: a plan whose enrollment `oopMax` is missing sets `breakdown.familyFallback`.
- [ ] **Step 2: Run** `node --test tests/engine/family.test.js` and expect FAIL (members unsupported).
- [ ] **Step 3: Implement** `carry` in `expectedOop` (initial `dedLeft`, the two `take` caps, `carryOut`), and the members path in `planTotal` as specified above. Keep the single-person branch byte-for-byte as today.
- [ ] **Step 4: Run** `node --test tests/*.test.js tests/engine/*.test.js` and expect all pass (376 plus the new ones).
- [ ] **Step 5: Commit** `src/engine/cost.js tests/engine/family.test.js`: `feat: cost a family one member at a time, with a running family tally`.

---

### Task 2: State and link: members, family size, line member

**Files:**
- Modify: `src/engine/scenarios.js` (`sanitizeLine` keeps `member`), `src/state.js`
- Test: `tests/state-members.test.js` (new)

**Interfaces:**
- Produces in `src/state.js`: `MAX_MEMBERS = 8`; state fields `familySize` (integer 3 to 8, default 4) and `others` (array of at most 7 of `{ name, scenario, overrides }`, default `[]`); `export function memberCount(state)` returns 1 for self, 2 for self_plus_one, `state.familySize` for family. `sanitizeLine` accepts `member` (integer 0 to 7; 0 is omitted from the stored line).
- Produces hash params: `fs=<n>` (only when family and not 4); one `mb=<scenario letter>_<overrides>_<name>` per entry of `others` (overrides in the existing `o` form, empty allowed; the name takes the rest after the second `_`, like line labels); a line flag `m<n>` after the tier flag. Missing params decode to defaults, so old links give a one-person year.

- [ ] **Step 1: Write the failing tests** in `tests/state-members.test.js` (use `encodeHash`, `decodeHash`, `sanitizeState`, `defaultState`, `memberCount`):
  - `memberCount`: self 1, self_plus_one 2, family with `familySize` 6 gives 6.
  - Defaults: `defaultState()` has `familySize` 4 and `others` `[]`; `encodeHash(defaultState()).hash` is `''`.
  - Round trip: a family state with `familySize` 5 and `others` `[{ name: 'Jo_n & <b>', scenario: 'worst', overrides: { hospitalStays: 2 } }, { name: '', scenario: 'healthy', overrides: {} }]`, and a custom line with `member: 2`, decodes (via `decodeHash(encodeHash(s).hash)`) to a deep-equal state, name included.
  - Legacy: the hash `e=f&sc=w&o=h3` decodes with `others` `[]`, `familySize` 4 and every line `member` unset.
  - Sanitize: `familySize` 99 gives 8 and 1 gives 3; 12 entries in `others` give 7; a non-string name gives `''`; an unknown scenario gives `typical`; a line with `member` 9 gives 0 (dropped field).
  - Medications absent: `JSON.stringify(encodeHash(s))` never contains a `meds` key (nothing about drugs is encoded).
- [ ] **Step 2: Run** `node --test tests/state-members.test.js` and expect FAIL.
- [ ] **Step 3: Implement** `sanitizeLine` (`member`), `DEFAULT_STATE`, `sanitizeState`, `memberCount`, `encodeLine`/`decodeLine` (the `m<n>` flag; update the `mid` regexp to `^(\d+)(o?)(?:t(\d))?(?:m(\d))?$`), `mb` and `fs` in `encodeHash` and `decodeHash`. Names use `plainText` (as in `src/text.js`), at most 20 characters. Update the header comment of `state.js` with the new fields.
- [ ] **Step 4: Run** the full suite; the existing `state*.test.js` must pass unchanged.
- [ ] **Step 5: Commit** `src/engine/scenarios.js src/state.js tests/state-members.test.js`: `feat: family members in the state and the link`.

---

### Task 3: Model: members into the costs, per-member medications

**Files:**
- Modify: `src/ui/model.js` (`costInputs`, `makeRow`, `maternityPart`, a new `withDrugs`), `src/ui/meds-store.js` (`sanitizeDrug` keeps `member`), `src/ui/rx-model.js` (`planMeds` entries and items carry `member`)
- Test: `tests/members-model.test.js` (new)

**Interfaces:**
- Consumes: Task 1 `planTotal` `inputs.members`; Task 2 `memberCount`, `others`, line `member`.
- Produces: `costInputs(state)` returns `{ status, enrollment, usage, members }`, where `usage` is member 1's usage (kept for existing readers) and `members` is `[{ usage }]` of length `memberCount(state)`; member `i` (1 or more) uses `SCENARIOS[others[i-1].scenario]` with its `overrides`, and `custom` lines whose `member === i` (member 1 gets lines with `member` unset or 0); lines whose `member >= memberCount` are left out. `export function withDrugs(inputs, entries)` returns inputs with `entries` split by `entry.member ?? 0` into `members[i].drugs` (entries for members beyond the count are dropped); for a one-member `inputs` it sets `drugs` as today. A medication's `member` is an integer 0 to 7 (default 0) stored on the drug and copied onto its `planMeds` entry and item.

- [ ] **Step 1: Write the failing tests** in `tests/members-model.test.js` (build a state with `defaultState()` and `computeRows`-style data as `tests/rank-basis.test.js` or the audit script does):
  - `costInputs` on self returns `members.length === 1`; on family with `familySize` 4 returns 4; member 2's usage matches `others[0]`'s scenario and overrides; a line with `member: 2` lands only in member 3's `usage.custom`.
  - Self enrollment: `computeRows` totals for a default state are deep-equal to the totals before this task (compare against a state with `others` filled in: they must not change a self total).
  - Family with 2 `worst` others costs more than the same state on self (expected care) on a plan with a finite family max, and never more than `memberCount` times the self-limits cost.
  - `withDrugs`: three entries with `member` 0, 1, 1 on a 2-member input land 1 and 2 in `members[0]` and `members[1]`; an entry with `member: 3` on a 2-member input is dropped.
  - Maternity: a `maternity` line on `member: 1` in a 2-member state gives `row.maternity.cost > 0` on a plan that prices maternity, equal to the cost with and without that line.
  - `sanitizeDrug` keeps `member` 0 to 7, drops others to 0; an old record without `member` reads as 0.
- [ ] **Step 2: Run** the new test and expect FAIL.
- [ ] **Step 3: Implement.** Replace every `{ ...inputs, drugs: meds.entries }` in `model.js` (grep `drugs:` across `src/ui` first, and update each caller found) with `withDrugs(inputs, meds.entries)`. In `maternityPart`, remove the maternity lines from every member's `custom` for the "without" run. `hasMaternityLine` checks every member.
- [ ] **Step 4: Run** the full suite.
- [ ] **Step 5: Commit** the files above plus the test: `feat: cost a household, with each member's own care and medications`.

---

### Task 4: Inputs: members, family size, member pickers

**Files:**
- Create: `src/ui/members.js` (exports `createMembersSection({ store })` -> `{ el, sync(state) }`)
- Modify: `src/ui/scenario.js`, `src/ui/inputs.js`, `src/ui/custom-lines.js`, `src/ui/meds.js`, `styles/inputs.css` (or the stylesheet that holds `.ft-*`; grep first)

**Interfaces:**
- Consumes: Task 2 `memberCount`; `store.set({ others, familySize, ... })`.
- Produces: under "Your year", when `memberCount(state) > 1`: a "Covered people" group above "Expected care in 2027". Family shows a stepper "How many covered people" (3 to 8, `store.set({ familySize })`). Each member is a collapsible row (member 1 labelled "You", the rest with a name field and a scenario control); only one row is open at a time; the open row shows that member's scenario control and fine-tune sliders (member 1's use the existing controls bound to `scenario` and `overrides`; others write `others[i-1]`). A privacy hint under the name field: "Names are saved in the page link and in links you share, so a first name or a role such as Spouse is enough." Custom costs and "My medications" get a "For" selector (the member's name) shown only when `memberCount > 1`; rows tied to a member beyond the count show dimmed with "Not covered at this enrollment" and are left out of totals.
- Self enrollment shows none of this and renders exactly as today.

- [ ] **Step 1: Build `members.js`** reusing `segmented`, the fine-tune sliders factory in `scenario.js` (extract the slider block into a function taking `{ get, set }` so member 1 and the others share it), and `OVERRIDE_FIELDS`. Keyboard: the row header is a button with `aria-expanded`; the stepper has labelled minus and plus buttons; focus stays on the control after a change.
- [ ] **Step 2: Wire** it in `inputs.js` (`year.el` gains the section) and add the "For" selectors in `custom-lines.js` (new lines default to the member chosen in the selector; the line's `member` is saved) and `meds.js` (the drug's `member` is saved through `meds.update`).
- [ ] **Step 3: Verify in a browser** with a local server (`python -m http.server <port>` in the repo): self shows no member UI; family with 4 shows 4 rows; changing member 3 to `worst` raises expected care on a plan card; reload keeps names and scenarios from the link; the same link in a Private tab shows no medications. Check narrow width (mobile preset) and keyboard use.
- [ ] **Step 4: Run** the full suite.
- [ ] **Step 5: Commit** the files: `feat: set up each covered person's year`.

---

### Task 5: See the math: a block per member, then the family

**Files:**
- Modify: `src/ui/math.js` (`mathContent`), `styles/results.css`, `styles/board.css` if needed
- Test: `tests/members-model.test.js` (add cases) or a DOM-free helper test for any new pure function

**Interfaces:**
- Consumes: Task 1 `breakdown.members`, `breakdown.memberCount`, `breakdown.familyOopMax`, `breakdown.familyFallback`.
- Produces: with `memberCount > 1`, `mathContent` renders Premium; then per member a block titled with the name ("You", "Jordan") holding that member's itemized care, "How that was paid" lines, deductible bar (their own, or the shared family one for HDHPs) and out-of-pocket max bar (their self-only max); then a "Whole family" block: expected care sum, the family out-of-pocket max bar ("$X of $Y"), a line saying any member stops paying at the self-only max, a note on member order only for `aggregate` and `unknown` plans, and the `familyFallback` note when set. One-member output is unchanged (`b.onePerson` path).

- [ ] **Step 1: Write a failing test** for any pure helper added (for example `memberTitle(index, others)` returning "You" for 0 and the trimmed name or "Person N" otherwise).
- [ ] **Step 2: Implement** and reuse `deductibleLines` and `oopMaxLines` per member, with their `b` argument built from the member's breakdown plus the plan-level limits.
- [ ] **Step 3: Verify in a browser** on a card and on the Board dialog, on one embedded plan and one aggregate HDHP, with one sick member of four and with two sick members; confirm the bars never exceed their limits and the totals match the cards.
- [ ] **Step 4: Run** the full suite.
- [ ] **Step 5: Commit**: `feat: See the math shows each member, then the whole family`.

---

### Task 6: Wording, other readers, final checks and release

**Files:**
- Modify: wherever the app says "one covered person" or `onePerson` is read (grep `onePerson`, `personLimitsNote`, `Modeled as one`), `src/ui/about.js` (How it works), `README.md` if it describes the model

- [ ] **Step 1: Grep** `onePerson`, `personLimitsNote`, `one covered person`, `one person` in `src` and `README.md`; update each to read correctly for households (self still says one person).
- [ ] **Step 2: Update About > How it works**: each member has their own limits, the family out-of-pocket max caps the sum, HDHPs may share the deductible, and the embedded assumption for regular plans is stated as OPM's data not saying so.
- [ ] **Step 3: Run** `node --test tests/*.test.js tests/engine/*.test.js` and `python -I -m pytest pipeline/tests -q`; both must pass.
- [ ] **Step 4: Browser pass** with the Review Focus list: Family to Self and back; old-style link; a drug on member 3 then shrink to 2 people; a maternity line on member 2; a name `A_&=<b>`.
- [ ] **Step 5: Commit, push to master**, and confirm the Pages deploy finished with PowerShell `Invoke-WebRequest` (plain curl is broken here).
