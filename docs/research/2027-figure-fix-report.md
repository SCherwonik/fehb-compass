# 2027 figure fix report

Source: docs/research/2027-figure-audit.md (12 entries copied verbatim into pipeline/benefit_overrides.json).

## Before (spreadsheet) -> after (brochure), Self / Self Plus One / Family
- NM1 oop_max: 7,000/14,000/14,000 -> 3,500/7,000/7,000
- UX1 oop_max: 6,000/12,000/12,000 -> 6,500/13,000/13,000
- A81 oop_max: 6,000/12,000/12,000 -> 7,000/14,000/14,000
- P81 oop_max: 6,000/12,000/12,000 -> 7,000/14,000/14,000
- A84 oop_max: 5,500/11,000/11,000 -> 6,000/12,000/12,000
- P84 oop_max: 5,500/11,000/11,000 -> 6,000/12,000/12,000
- RE1 oop_max: 9,000/18,000/18,000 -> 9,500/19,000/19,000
- YZ1 oop_max: 9,000/18,000/18,000 -> 9,500/19,000/19,000
- A84 deductible: 300/600/600 -> 350/700/700 (Annual and Net raw fields too)
- P84 deductible: 300/600/600 -> 350/700/700
- N61 out_of_network.deductible: 1,600/3,200/3,200 -> 2,000/4,000/4,000
- SF4 out_of_network.deductible: 5,000/10,000/10,000 -> 500/1,000/1,000

## Code
- build_data.apply_benefit_overrides now accepts oop_max and out_of_network.deductible. The out-of-network entry has empty raw_fields; its provenance record is stored under overrides["Out-of-network annual deductible"] (build_data.OON_DEDUCTIBLE_KEY). A stale `sheet` value stops the build.
- src/ui/results.js: the card's out-of-pocket max fact shows the "Differs from OPM spreadsheet" badge (same as deductible). The matrix already badges any raw field with an override record, so oop rows badge automatically. Nothing in the app reads the out-of-network record.

## Data diff
Only data/benefits.json changed, and only for NM1, UX1, A81, P81, A84, P84, RE1, YZ1, N61, SF4: the engine fields, their raw display fields and new overrides records. data/meta.json and the other data files are untouched (no timestamp churn).

## Tests
- pytest pipeline/tests: 278 passed (new: oop_max branch, out-of-network branch with empty raw_fields, stale sheet stops build, every tracked override matches built data, NM1 Self oop 3,500).
- node: 448 pass, 0 fail. No node test pinned the old figures, so none were changed.

## Notes
- Existing rx overrides for A81/P81/A84/P84 are untouched; those plans now carry both rx and deductible/oop records.
