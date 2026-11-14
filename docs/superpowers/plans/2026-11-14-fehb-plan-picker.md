# FEHB Plan Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static GitHub Pages app that ranks 2027 FEHB plans by estimated total annual cost for the user's situation and shows what changed from 2026.

**Architecture:** A Python script downloads OPM's public-use XLSX files and writes normalized JSON into `data/`. A no-build vanilla JS (ES modules) front end loads that JSON, runs a pure cost engine, and renders cards. All user state lives in the URL hash and localStorage.

**Tech Stack:** Python 3.11 + openpyxl + pytest (pipeline); vanilla JS ES modules + `node:test` (engine); GitHub Pages (hosting).

**Spec:** `docs/superpowers/specs/2026-11-14-fehb-plan-picker-design.md`

## Global Constraints

- Static hosting only: no server, no secrets, no build step for the front end.
- All user inputs stay in the browser (localStorage / URL hash only).
- Data comes only from OPM public-use files for plan years 2026 and 2027 (FEHB; FEDVIP for dental/vision). OPM files contain no formularies or networks.
- Annual premium: biweekly payroll rate x 26 for actives, monthly rate x 12 for retirees.
- Total = annual premium + expected out-of-pocket under the scenario - HSA/HRA contribution.
- Every displayed number is traceable to an OPM file and its published date (stored in `data/meta.json`).
- No disclaimers beyond a small placeholder footer. Working title: "FEHB Compass".
- Responsive, light/dark, accessible, printable.

## Review Focus

- A ZIP/state with zero eligible plans: show an empty state, not a blank page.
- A 2027 plan with no 2026 counterpart (new) or a 2026 plan missing in 2027 (ended): flag it, never show NaN change values.
- Plan option codes that change between years: match via the plan key, not by raw code equality alone.
- Benefit cells that are text, not numbers ("$30 copay", "15% after deductible", "Nothing"): parse or store raw with `null` numeric and show raw text.
- Coinsurance spending that crosses the deductible or the out-of-pocket max: costs must clip at the max and never go negative.
- Zero-usage scenario: total equals premium minus HSA/HRA deposit.
- localStorage unavailable or hash malformed: the app still loads with defaults.

---

### Task 1: Project scaffold and OPM data download

**Files:**
- Create: `pipeline/fetch_opm.py`, `pipeline/inspect_schema.py`, `pipeline/requirements.txt`, `.gitignore`, `README.md`
- Test: `pipeline/tests/test_fetch.py`

**Interfaces:**
- Produces: `fetch_opm.FILES: dict[str, str]` (logical name -> URL, covering 2026 and 2027 FEHB plan key, rates, benefits, service area, payroll rates and FEDVIP rates/benefits/zipcodes/rating regions); `fetch_opm.download_all(dest: Path) -> dict[str, Path]` saving to `pipeline/raw/` (git-ignored).

- [ ] **Step 1: Write failing test** `test_files_cover_both_years` asserting `FEHB_2027_RATES` and `FEHB_2026_RATES` keys exist and every URL starts with `https://www.opm.gov/`.
- [ ] **Step 2: Run** `pytest pipeline/tests/test_fetch.py -v`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `FILES` using the exact URLs from the OPM public-use-files page and `download_all` with `urllib` (skip files already present).
- [ ] **Step 4: Run test.** Expected: PASS.
- [ ] **Step 5: Run** `python pipeline/fetch_opm.py` then `python pipeline/inspect_schema.py`, which prints every sheet name, header row and 3 sample rows per file into `pipeline/schema_report.txt`. This report is the source of truth for column names in Task 2.
- [ ] **Step 6: Commit** `feat: scaffold pipeline and download OPM files`.

### Task 2: Normalize OPM files into JSON

**Files:**
- Create: `pipeline/build_data.py`, `data/` outputs (`plans.json`, `rates.json`, `benefits.json`, `service_area.json`, `dental_vision.json`, `meta.json`)
- Test: `pipeline/tests/test_build_data.py`

**Interfaces:**
- Consumes: `download_all` output from Task 1; column names from `schema_report.txt`.
- Produces JSON schemas: `plans.json` = list of `{code, name, year, type: "FFS"|"HMO"|"HDHP", network_family, hsa: bool, hra: bool, nationwide: bool}`; `rates.json` = `{year: {code: {self, self_plus_one, family: {biweekly_active, monthly_retiree}}}}`; `benefits.json` = `{year: {code: {deductible, oop_max, coinsurance, copays: {...}, raw: {...}}}}` (numeric fields `null` when not parseable); `service_area.json` = `{code: {states: [...], zips: [...]}}`; `meta.json` = `{files: {name: {url, published}}}`.
- Function: `build_data.parse_money_or_pct(cell: object) -> {value: float|None, kind: "usd"|"pct"|"text", raw: str}`.

- [ ] **Step 1: Write failing tests** for `parse_money_or_pct`: `"$30"` -> usd 30.0; `"15%"` -> pct 15.0; `"Nothing"` -> text, value None; `None` -> text, value None.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `parse_money_or_pct` and the per-file loaders; join the two years by plan key. Test also asserts every 2027 plan in `plans.json` has a rate for all three enrollment types.
- [ ] **Step 4: Run tests, expect PASS; run** `python pipeline/build_data.py` and spot-check one known plan's premium against OPM's published rate chart.
- [ ] **Step 5: Commit** `feat: normalize OPM data to JSON`.

### Task 3: Cost engine (pure JS)

**Files:**
- Create: `src/engine/cost.js`, `src/engine/scenarios.js`, `src/engine/assumptions.js`
- Test: `tests/engine/cost.test.js`

**Interfaces:**
- Produces: `annualPremium(rate, {status, enrollment}) -> number`; `expectedOop(benefits, usage, assumptions) -> {deductiblePaid, coinsurancePaid, copays, total}`; `planTotal(plan, inputs) -> {premium, oop, hsaOffset, total, breakdown, firmness: "fixed"|"estimated"}`; `SCENARIOS` = `{healthy, typical, condition, worst}` each a usage object `{pcpVisits, specialistVisits, erVisits, hospitalStays, labs, imaging, rxMonthly}`; `ASSUMED_PRICES` constants (documented in the file).

- [ ] **Step 1: Write failing tests:** zero usage -> total equals premium minus deposit; $50,000 hospital spend on a $1,000 deductible/20%/$6,000 OOP plan -> oop exactly $6,000 (clip); retiree uses monthly x 12; copay-only plan has firmness "fixed".
- [ ] **Step 2: Run** `node --test tests/engine` expecting FAIL.
- [ ] **Step 3: Implement** functions above; cap at `oop_max`, deductible applied before coinsurance, never negative.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: cost engine with scenarios`.

### Task 4: App shell, design system and input panel

**Files:**
- Create: `index.html`, `src/app.js`, `src/state.js`, `src/data.js`, `src/ui/inputs.js`, `styles/tokens.css`, `styles/app.css`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: JSON from Task 2.
- Produces: `loadData() -> Promise<Data>`; `state.get()/set(patch)/subscribe(fn)`; `encodeState(s) -> string` and `decodeState(hash: string) -> State` (malformed -> defaults); inputs: state or ZIP, enrollment type, active/retiree, HSA/HRA preference, network filter, current 2026 plan, scenario.

- [ ] **Step 1: Write failing tests:** `decodeState("#garbage")` returns defaults; encode/decode round-trips; storage-unavailable path does not throw.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** state and the shell. Use the `frontend-design` and `impeccable` skills for the visual system: CSS custom-property tokens, light/dark, distinctive typography, mobile-first.
- [ ] **Step 4: Run tests; open the page in the browser pane and screenshot desktop and mobile.**
- [ ] **Step 5: Commit** `feat: app shell and inputs`.

### Task 5: Results, 2026 vs 2027 comparison and "see the math"

**Files:**
- Create: `src/ui/results.js`, `src/ui/compare.js`, `src/engine/diff.js`
- Test: `tests/engine/diff.test.js`

**Interfaces:**
- Consumes: `planTotal`, `Data`, state.
- Produces: `diffPlan(plan2026, plan2027) -> {premiumChange, premiumPct, deductibleChange, oopMaxChange, coinsuranceChange, flags: string[], status: "same"|"new"|"ended"}`; flags include `"oop_up_no_premium_cut"` and `"deductible_up"`.

- [ ] **Step 1: Write failing tests:** new plan -> status "new", numeric deltas `null`; OOP max up with premium flat -> includes `oop_up_no_premium_cut`; identical plans -> no flags.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `diffPlan`, ranked card list (sort by total, premium, deductible, OOP max), side-by-side compare for up to 4 selected plans, "you'd save $X vs your current plan", expandable math, empty state for zero plans.
- [ ] **Step 4: Run tests, then browser-check ranking and compare views.**
- [ ] **Step 5: Commit** `feat: ranked results and year-over-year comparison`.

### Task 6: Custom scenario lines and worst-case controls

**Files:**
- Create: `src/ui/scenario.js`
- Modify: `src/engine/cost.js`
- Test: `tests/engine/custom-lines.test.js`

**Interfaces:**
- Produces: `usageFromCustom(lines: {label, kind, price, perYear}[]) -> usage`; sliders for hospital stays and ER visits; up to 25 custom lines.

- [ ] **Step 1: Write failing test:** 3 hospital stays added to "typical" raises every plan's OOP total, capped at each plan's max.
- [ ] **Step 2-4:** Run to fail, implement, run to pass, browser-check.
- [ ] **Step 5: Commit** `feat: custom scenarios`.

### Task 7: Dental and vision (FEDVIP)

**Files:**
- Create: `src/ui/dental.js`; modify `pipeline/build_data.py`
- Test: `tests/engine/dental.test.js`

**Interfaces:**
- Produces: `dentalCost(plan, {enrollment, region, visits}) -> {premium, oop, total}`; opt-in toggle adds it to each plan's total.

- [ ] **Step 1: Write failing test:** with dental toggled on, total increases by exactly the dental premium x 26/12 conversion rule from the data.
- [ ] **Step 2-4:** Run to fail, implement (map ZIP to dental rating region), run to pass, browser-check.
- [ ] **Step 5: Commit** `feat: FEDVIP dental and vision`.

### Task 8: My medications panel and formulary links

**Files:**
- Create: `data/formulary_links.json`, `src/ui/drugs.js`
- Test: `tests/drugs.test.js`

**Interfaces:**
- Produces: `formulary_links.json` = `{planCode: {url, pbm}}` (research one URL per plan; blank when unknown); user drug list in localStorage `{name, tierByPlan: {code: 1-5|"nc"}}`; `drugTierCost(tier, assumptions) -> number` feeds `expectedOop`.

- [ ] **Step 1: Write failing tests:** a not-covered ("nc") drug adds its full assumed price; tier 2 adds the plan's tier-2 copay.
- [ ] **Step 2-4:** Run to fail, implement, run to pass, browser-check.
- [ ] **Step 5: Commit** `feat: my medications and formulary links`.

### Task 9: Polish, share/print and GitHub Pages deploy

**Files:**
- Create: `.github/workflows/pages.yml`, `styles/print.css`
- Modify: UI files for polish

- [ ] **Step 1:** Add print stylesheet and "copy share link" button (state hash).
- [ ] **Step 2:** Audit with the `impeccable` and `polish` skills; fix contrast, focus, spacing; verify mobile and dark mode in the browser pane.
- [ ] **Step 3:** Add Pages workflow publishing the repo root; create the GitHub repo and push (confirm repo name and visibility with the user first).
- [ ] **Step 4:** Verify the live URL loads and shows data.
- [ ] **Step 5: Commit** `feat: polish, print, deploy`.
