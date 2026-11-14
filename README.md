# FEHB Compass

Which 2027 FEHB health plan costs you least? FEHB Compass ranks every plan open to you by your **estimated
yearly total**: premium plus expected out-of-pocket care, minus any HSA or HRA money. It shows what changed
from 2026, compares plans side by side or on a horizontal ranked board with the full benefit details, prices
your own medications from the plan brochures' drug tiers, and adds FEDVIP dental and vision for your ZIP code.

It is a static site (no server, no build step, no tracking). Everything you enter stays in your browser: the
comparison lives in the URL hash (so a link reproduces it) and in localStorage; your medication list lives
only in localStorage and is never put in a link.

Not affiliated with OPM or the U.S. government. Estimates, not an official statement of benefits; the plan
brochure is the only contractual statement of coverage.

## Screenshots

_To add: cards view, compare board, dental and vision, light and dark._

## Run it locally

ES modules and `fetch` need http, so serve the repository root instead of opening `index.html` as a file:

    python -m http.server 8000      # then open http://localhost:8000/

## Tests

    node --test "tests/engine/*.test.js" "tests/*.test.js"     # or: npm test
    python -I -m pytest pipeline/tests -q

The JavaScript tests cover the cost engine, state and URL encoding, the share link (including a test that your
medications never reach it), the board and matrix models, and an audit that fails if any shipped file uses an
absolute asset path (the site must work from a sub-path). The Python tests cover the data pipeline.

## Data

All plan data comes from OPM's public use files and the 2027 plan brochures. Dates for each file are in
`data/meta.json`; the app's footer shows them.

| File (in `data/`) | What | Source |
|---|---|---|
| `plans.json`, `rates.json`, `benefits.json`, `service_area.json` | FEHB plans, 2026 and 2027 rates, benefits and service areas | OPM FEHB public use files (2027 files published Sep 29 to Oct 26, 2026) |
| `fedvip.json` | FEDVIP dental and vision plans, regional rates, benefits, ZIP geography | OPM FEDVIP public use files (published Sep 29 to Sep 30, 2026) |
| `brochure_facts.json` | Drug tiers, drug lookup links, what changed in 2027 | 2027 plan brochures (read Nov 14, 2026), AI-extracted and quote-verified |
| `meta.json` | Source URL and published date of every OPM file | |
| `brochures.json` | Brochure download manifest (URLs, checksums) | used by the pipeline only |
| `dental_vision.json` | Older FEDVIP output, superseded by `fedvip.json` | written by `build_data.py`; not used by the app, not deployed |

### Rebuild the data

    pip install -r pipeline/requirements.txt
    python pipeline/fetch_opm.py          # 1. download the OPM XLSX files into pipeline/raw/ (git-ignored)
    python pipeline/inspect_schema.py     # 2. optional: pipeline/schema_report.txt (sheets, headers, samples)
    python pipeline/build_data.py         # 3. plans, rates, benefits, service areas, meta
    python pipeline/build_fedvip.py       # 4. fedvip.json

Brochure facts (`brochure_facts.json`) are partly manual:

    pip install -r pipeline/requirements-brochures.txt
    python pipeline/brochures.py all      # 5. download the 2027 brochures and convert them to page-split text
    # 6. AI-assisted, outside this repo: extract one JSON per brochure into pipeline/raw/extractions/2027/
    #    following pipeline/brochure_schema.md (every fact carries its page and a verbatim quote)
    python pipeline/validate_extractions.py   # 7. keep only facts whose quote is found in the brochure text

Step 7 also applies the hand-checked rulings in `pipeline/rx_adjudication.json` where a brochure's drug tiers
disagree with OPM's benefits spreadsheet. In the current data about 77% of extracted facts verified; the rest
were dropped.

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` runs the JavaScript tests and publishes the site on every push to `main` (or by
hand from the Actions tab). It uploads only what the site serves: `index.html`, `404.html`, `robots.txt`,
`src/`, `styles/`, `assets/` and the data files the app fetches. Not uploaded: `pipeline/`, `docs/`, `tests/`,
`.superpowers/`, `data/dental_vision.json`, `data/brochures.json`.

To turn it on: push the repository to GitHub, then in Settings > Pages choose "GitHub Actions" as the source.
All asset paths are relative, so the site works at `https://<user>.github.io/<repo>/`.

What a visitor downloads: about 0.6 MB of code and styles plus up to 4.7 MB of JSON (benefits 2.3 MB, brochure
facts 1.6 MB, FEDVIP 0.5 MB, the rest small). GitHub Pages serves them gzip-compressed: about 0.5 MB in total
over the wire. The app paints the input panel from the small files first and loads the large ones after.

## Project structure

    index.html, 404.html      the page, and a Pages fallback that returns to it
    src/app.js                entry point: staged data loading, wiring
    src/state.js              app state, validation, URL hash encoding
    src/share.js              the share link
    src/data.js               data loading
    src/engine/               pure cost engine: premiums, deductibles, coinsurance, OOP max, scenarios, dental
    src/ui/                   input panel, results cards, compare, board, matrix, medications, dental/vision, dialog
    styles/                   tokens.css (design tokens, light/dark), component styles, print.css
    assets/                   favicon
    data/                     generated JSON (see Data)
    pipeline/                 Python: download and normalize OPM files, brochure extraction checks
    tests/                    node:test suites

## Known limitations

- No provider networks: check that your doctors and hospitals are in network.
- No formulary search: each plan has a drug lookup link; you record the tier you find.
- Care is priced at assumed amounts (shown in "See the math" and "How it works"); real prices vary.
- Out-of-network care is counted at full cost, because OPM publishes no out-of-network cost sharing.
- OPM's spreadsheet has a few errors; where a brochure disagrees, the brochure is followed and the difference
  is noted.
- Dental costs use typical list fees, so they are more likely high than low; vision frame and contact
  allowances are not published by OPM and are not counted.
- The Geist font loads from Google Fonts; the page falls back to system fonts if it is blocked.
