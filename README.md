# FEHB Compass

Static web app for comparing FEHB plans (with FEDVIP dental/vision), built from OPM public-use files.

## Data pipeline

    pip install -r pipeline/requirements.txt
    python pipeline/fetch_opm.py        # downloads 2026+2027 XLSX files into pipeline/raw/ (git-ignored)
    python pipeline/inspect_schema.py   # writes pipeline/schema_report.txt (sheets, headers, sample rows)
    python -m pytest pipeline/tests -v

## Run the app locally

ES modules and `fetch` need http, so serve the repo root instead of opening `index.html` as a file:

    python -m http.server 8000      # then open http://localhost:8000/

## Tests

    npm test                        # node:test: cost engine + state/URL encoding
