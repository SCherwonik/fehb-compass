# FEHB Plan Picker: Design

Date: 2026-11-14. Status: draft for approval.

## Intent and why
A free, beautiful, static web app (hosted on GitHub Pages) that helps a federal employee choose a FEHB health plan for 2027 by estimated **total annual cost for their situation**, not premium alone, and shows exactly **what changed from 2026**. Built first for the owner's own open-season decision; designed so it can be shared publicly later. Inspired by fersready.com/fehb (free, public facts), but different: more polished, plus dental and a drug-aware workflow, which that site lacks.

## Goals
1. Pick **last year's plan (2026)** and any candidate 2027 plans; see side-by-side: premium, deductible, out-of-pocket max, coinsurance/copays, annual total, and the change vs 2026, with "gotchas" flagged (e.g. OOP max rose with no premium cut).
2. **Scenario engine:** healthy / typical / managing a condition / worst case (N hospital stays, ER visits, surgeries), plus custom lines (visits, labs, imaging, Rx).
3. **Recommendation:** rank plans by total cost for the user's inputs; show "you'd save $X vs your current plan" and a break-even view; show the math ("see the math").
4. **Dental/vision:** include FEDVIP premiums and benefits as an optional add-on to the total.
5. **My medications:** user enters drug names once. Each plan card shows those drugs next to that plan's formulary lookup link; user can record the tier they found (saved locally) and the cost model uses it.
6. Filters: state/ZIP (service area), enrollment type (Self / +One / Family), active vs retiree, HSA/HRA preference, network family (Aetna, Blue Cross, Cigna, UHC, plan-owned HMO).
7. Polish: responsive, light/dark, fast, accessible, printable summary, shareable URL that encodes inputs.

## Non-goals (for now)
- Disclaimers/legal copy beyond a small placeholder footer (revisit before sharing publicly).
- Scraping or proxying carrier drug-lookup sites (rejected: ToS, bot protection, breakage, wrong-tier risk).
- PSHB (Postal) plans, Medicare coordination, FSA/FEDVIP-FSA modeling (future ideas).
- User accounts, backend, analytics.

## Anti-goals (failure even if it "works")
- Showing a confident dollar total that hides its assumptions.
- Stale or silently wrong data; every number traceable to an OPM file and date.
- Cluttered, spreadsheet-looking UI. It must look like a product.

## Constraints
- Hosting: GitHub Pages, static only; no secrets, no server.
- Data: OPM public use files (FEHB plan key, rates, benefits, service area, payroll rates; FEDVIP rates/benefits/zip). OPM files contain **no formularies and no networks**; network family comes from plan key/names, drug tiers are out of scope of OPM data.
- Privacy: all user inputs stay in the browser (localStorage / URL only).
- Plan-year data: 2027 (new) and 2026 (comparison) only at first.

## Approaches considered
- **A. Vanilla JS modules + prebuilt JSON, no front-end build step (chosen, my call).** Python script converts XLSX to JSON, committed. Simplest to host and explain; trade-off: hand-rolled state/rendering.
- B. Vite + Preact/TypeScript, built by GitHub Actions. Nicer for a big UI long-term; trade-off: build tooling and more moving parts for a solo first version.
- C. Parse XLSX in the browser at runtime. No pipeline, but slow, large downloads, and fragile.
Formulary options (decided in conversation): link-out now incl. "my drugs" panel; import one formulary later as an experiment; proxy rejected.

## Design decisions (as decided)
- Build for self first; polish and visual quality matter now; disclaimers deferred.
- Formulary: link-out + "my drugs" panel first; import experiment later.

## My calls (please check)
- Approach A (no framework); Python + openpyxl for the data pipeline.
- Cost model: total = annual premium (payroll biweekly x 26 for actives, monthly x 12 for retirees) + expected out-of-pocket under the scenario - HSA/HRA contribution. Coinsurance priced with a documented assumed-price table.
- Testing: unit tests for the cost engine and data pipeline; visual check in a browser. No end-to-end suite.
- Name/branding: working title "FEHB Compass"; owner can rename.

## Left to the builder
Exact layout and visual system; assumed-price table values; scenario presets; the data schema; which formulary link per plan (research); ZIP-to-service-area mapping details; repo structure and Pages deployment.

## Future ideas (parked)
Medicare/Part B coordination for retirees; FSA/HSA contribution optimizer; family-member profiles; plan-brochure PDF links; premium history charts 2020-2027; "plan gotchas" alerts; formulary import; disclaimers and an About/methodology page.

## Visual direction (added by owner, 2026-11-14)
Fluid, clean, modern, techy: think Apple, NVIDIA, AMD, Google; a blend between Material Design and Apple's Liquid Glass. Emphasis on fluidity and attractive animation where it adds meaning: smooth re-ranking of cards when inputs change, animated number transitions on totals, glass/translucent surfaces with blur and soft depth, springy but quick micro-interactions, tasteful gradients and glow accents, strong typography. Respect `prefers-reduced-motion` and keep it fast (CSS/Web Animations, FLIP for reorder, no heavy libraries). Applies to Tasks 4, 5, 6, 8 and 9.
