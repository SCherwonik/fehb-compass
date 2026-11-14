"""Download OPM 2027 FEHB plan brochures and convert them to page-delimited text.

Usage: python pipeline/brochures.py download|convert|all
Idempotent: existing files are skipped. Writes are atomic (.part then rename).
"""
import hashlib
import json
import os
import re
import sys
import time
import datetime
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENEFITS = os.path.join(ROOT, "data", "benefits.json")
MANIFEST = os.path.join(ROOT, "data", "brochures.json")
PDF_DIR = os.path.join(ROOT, "pipeline", "raw", "brochures", "2027")
TXT_DIR = os.path.join(ROOT, "pipeline", "raw", "brochures_txt", "2027")
YEAR = "2027"
URL_TMPL = ("https://www.opm.gov/healthcare-insurance/healthcare/plan-information/"
            "plans/pdf/2027/brochures/{n}.pdf")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
MIN_BYTES = 50_000


def parse_brochure_number(raw):
    """'RI 71-005' -> '71-005'."""
    m = re.search(r"(\d{2})[-\s](\d{3})", raw or "")  # tolerates 'RI-73 899'
    if not m:
        raise ValueError(f"bad brochure number: {raw!r}")
    return f"{m.group(1)}-{m.group(2)}"


def build_mapping(benefits_path=BENEFITS, year=YEAR):
    """brochure number -> {'plan_codes': [...], 'plan_names': [...]} (each code once)."""
    with open(benefits_path, encoding="utf-8") as f:
        data = json.load(f)[year]
    out = {}
    for code, rec in data.items():
        raw = rec["raw"]
        n = parse_brochure_number(raw.get("Brochure Number"))
        e = out.setdefault(n, {"plan_codes": [], "plan_names": []})
        e["plan_codes"].append(code)
        name = raw.get("Plan Name")
        if name and name not in e["plan_names"]:
            e["plan_names"].append(name)
    return dict(sorted(out.items()))


def is_pdf(body):
    return body[:4] == b"%PDF"


def atomic_write(path, data):
    part = path + ".part"
    try:
        with open(part, "wb") as f:
            f.write(data)
        os.replace(part, path)
    except BaseException:
        if os.path.exists(part):
            os.remove(part)
        raise


def fetch(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/pdf,*/*"})
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
            if not is_pdf(body):
                raise ValueError("body does not start with %PDF")
            if len(body) < MIN_BYTES:
                raise ValueError(f"implausibly small: {len(body)} bytes")
            return body
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (404, 403, 410):
                break
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 ** (i + 1))
    raise RuntimeError(last)


def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    return {YEAR: {}}


def format_pages(pages):
    return "".join(f"=== PAGE {i} ===\n{t.rstrip()}\n" for i, t in enumerate(pages, 1))


def pdf_pages(path):
    import pymupdf
    with pymupdf.open(path) as doc:
        return [p.get_text("text", sort=False) for p in doc]


def save_manifest(man):
    atomic_write(MANIFEST, (json.dumps(man, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))


def download():
    mapping = build_mapping()
    os.makedirs(PDF_DIR, exist_ok=True)
    man = load_manifest()
    man.setdefault(YEAR, {})
    failures = {}
    first = True
    for n, m in mapping.items():
        path = os.path.join(PDF_DIR, f"{n}.pdf")
        if os.path.exists(path):
            body = open(path, "rb").read()
            if is_pdf(body):
                ent = man[YEAR].setdefault(n, {})
                ent.setdefault("url", URL_TMPL.format(n=n))
                ent.setdefault("downloaded", datetime.date.today().isoformat())
                ent.update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest(),
                           plan_codes=m["plan_codes"], plan_names=m["plan_names"])
                continue
        if not first:
            time.sleep(1)
        first = False
        url = URL_TMPL.format(n=n)
        try:
            body = fetch(url)
        except RuntimeError as e:
            failures[n] = {"url": url, "error": str(e)}
            print(f"FAIL {n}: {e}", flush=True)
            continue
        atomic_write(path, body)
        man[YEAR][n] = {"url": url, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                        "pages": man[YEAR].get(n, {}).get("pages"),
                        "plan_codes": m["plan_codes"], "plan_names": m["plan_names"],
                        "downloaded": datetime.date.today().isoformat()}
        print(f"ok {n} {len(body)}", flush=True)
    man["meta"] = {"failures": failures}
    save_manifest(man)
    return failures


def convert():
    os.makedirs(TXT_DIR, exist_ok=True)
    man = load_manifest()
    for n, ent in man.get(YEAR, {}).items():
        src = os.path.join(PDF_DIR, f"{n}.pdf")
        dst = os.path.join(TXT_DIR, f"{n}.txt")
        if not os.path.exists(src):
            continue
        if os.path.exists(dst) and ent.get("pages"):
            continue
        pages = pdf_pages(src)
        atomic_write(dst, format_pages(pages).encode("utf-8"))
        ent["pages"] = len(pages)
        print(f"txt {n} {len(pages)}p", flush=True)
    save_manifest(man)


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "download":
        download()
    elif cmd == "convert":
        convert()
    elif cmd == "all":
        download()
        convert()
    else:
        print("usage: brochures.py download|convert|all")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
