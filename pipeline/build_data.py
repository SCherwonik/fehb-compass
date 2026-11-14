"""Normalize the OPM FEHB / FEDVIP XLSX files into compact JSON under data/.

Run:  python pipeline/build_data.py   (downloads missing raw files first)

Outputs (data/):
  plans.json         list of plans, one entry per (plan, year)
  rates.json         {year: {code: {self|self_plus_one|family: {biweekly_active, monthly_retiree}}}}
  benefits.json      {year: {code: {deductible, oop_max, coinsurance, copays, raw, ...}}}
  service_area.json  {code: {states, zips, ...}}  (2027 service area)
  dental_vision.json {year: {dental|vision: {plans, rates, benefits, ...}}}
  meta.json          {files: {name: {url, published}}}

Plan identity
-------------
OPM's "Plan Code" (two characters, e.g. EP) is shared by several options, and the
enrollment code is plan code + a digit: 1/2/3 and 4/5/6 are two option groups
(Self / Self & Family / Self Plus One in each; the plan key states the mapping).
A plan here is one (plan code, option name). Its `code` is the enrollment code of
its Self row (e.g. "EP1", "EP4", "104"), which is stable between 2026 and 2027, so
the two years join on it. Files that carry only (plan code, option name) -- benefits,
service area -- are joined through the normalized option name.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_opm  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
YEARS = (2026, 2027)

ENROLL_KEYS = {"Self": "self", "Self Plus One": "self_plus_one", "Self & Family": "family"}


# --------------------------------------------------------------------------- helpers

_MONEY = re.compile(r"\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)")
_PCT = re.compile(r"([0-9]+(?:\.[0-9]+)?)\s*%")


def parse_money_or_pct(cell: object) -> dict:
    """Parse a benefit cell into {value, kind, raw}.

    The first dollar amount or percentage in the text wins ("$30" -> usd 30.0,
    "15% Coinsurance" -> pct 15.0, "Preferred Generic - $10 Copayment" -> usd 10.0).
    Real numbers are treated as dollars. Anything else ("Nothing", "Not covered",
    None) is kind "text" with value None.
    """
    if cell is None:
        return {"value": None, "kind": "text", "raw": ""}
    if isinstance(cell, bool):
        return {"value": None, "kind": "text", "raw": str(cell)}
    if isinstance(cell, (int, float)):
        return {"value": float(cell), "kind": "usd", "raw": str(cell)}
    raw = str(cell).strip()
    m, p = _MONEY.search(raw), _PCT.search(raw)
    cands = [(x.start(), k, x) for k, x in (("usd", m), ("pct", p)) if x]
    if not cands:
        return {"value": None, "kind": "text", "raw": raw}
    _, kind, x = min(cands, key=lambda c: c[0])
    return {"value": float(x.group(1).replace(",", "")), "kind": kind, "raw": raw}


def money(cell: object) -> float | None:
    """Plain numeric value of a dollar cell, or None."""
    r = parse_money_or_pct(cell)
    return r["value"] if r["kind"] == "usd" else None


def norm(s: object) -> str:
    return re.sub(r"\s+", " ", str(s if s is not None else "")).strip().lower()


def clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s if s is not None else "")).strip()


def published_from_filename(name: str) -> str:
    """ISO date from the MMDDYY (or MMDDYYYY) stamp at the end of an OPM file name."""
    m = re.search(r"[_-](\d{2})(\d{2})(\d{2}|\d{4})\.xlsx$", name)
    if not m:
        raise ValueError(f"no date stamp in {name}")
    mm, dd, yy = int(m.group(1)), int(m.group(2)), m.group(3)
    year = int(yy) if len(yy) == 4 else 2000 + int(yy)
    return date(year, mm, dd).isoformat()


def network_family(carrier: str, plan_name: str = "") -> str:
    """Heuristic carrier family from the plan key's carrier / plan name.

    OPM publishes no provider networks, so this is name-based only:
      Aetna (also Altius, Aetna Health of Utah), Blue Cross (Blue Cross and Blue
      Shield, Anthem, CareFirst BlueChoice), Cigna, UnitedHealthcare (UnitedHealthcare,
      UHC). Everything else (Kaiser, GEHA, MHBP, APWU, HMSA, union / employee-
      association plans and independent HMOs) is "Other", i.e. plan-owned.
    """
    s = norm(f"{carrier} {plan_name}")
    if "cigna" in s:
        return "Cigna"
    if "unitedhealthcare" in s or "united healthcare" in s or re.search(r"\buhc\b", s):
        return "UnitedHealthcare"
    if "aetna" in s or "altius" in s:
        return "Aetna"
    if "blue cross" in s or "bluecross" in s or "anthem" in s or "carefirst" in s or "blue shield" in s:
        return "Blue Cross"
    return "Other"


def sheet_rows(path: Path, index: int = 0):
    """Stream rows of the index-th sheet (by position: names differ between years)."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for row in wb.worksheets[index].iter_rows(values_only=True):
            yield list(row)
    finally:
        wb.close()


def table(path: Path, index: int = 0, marker: str | None = None):
    """Return (header, rows). With `marker`, the header is the first row whose first
    cell equals it (banner rows above are skipped); otherwise the first row."""
    it = iter(sheet_rows(path, index))
    header = None
    for r in it:
        if marker is None or norm(r[0] if r else None) == norm(marker):
            header = r
            break
    if header is None:
        raise ValueError(f"header {marker!r} not found in {path.name}")
    return header, [r for r in it if any(c not in (None, "") for c in r)]


# --------------------------------------------------------------------------- FEHB

def _group(plan_key_rows):
    """Collapse plan-key rows into plans keyed by (plan code, normalized option)."""
    plans: dict[tuple[str, str], dict] = {}
    for r in plan_key_rows:
        if not r[2]:
            continue
        key = (clean(r[2]), norm(r[1]))
        p = plans.setdefault(key, {
            "plan_code": clean(r[2]), "carrier": clean(r[0]), "option": clean(r[1]),
            "plan_name": clean(r[3]), "network": clean(r[6]), "option_type": clean(r[7]),
            "enrollment": {},
        })
        p["enrollment"][ENROLL_KEYS[clean(r[5])]] = clean(r[4])
    return plans


def _tokens(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", norm(s)))


def _display_name(p: dict) -> str:
    base, opt = p["plan_name"], p["option"]
    # generic plan names ("HDHP PPO", "Standard HMO") get the carrier prepended
    if not (_tokens(base) & _tokens(p["carrier"])):
        base = f"{p['carrier']} {base}"
    if not opt or norm(opt) in norm(base):
        return base
    return f"{base} {opt}"


def _plan_type(option_type: str, network: str) -> str:
    if option_type.upper() == "HDHP":
        return "HDHP"
    if network.upper() in ("HMO", "HMO/POS"):
        return "HMO"
    return "FFS"  # PPO / EPO / indemnity-style options


def load_benefits(path: Path):
    """Return {(plan code, normalized option): {"in": {header: cell}, "out": {...}}}.

    Each 'X Additional Details' column is folded into X as 'value - details'.
    """
    header, rows = table(path)
    hs = [clean(h) for h in header]
    out: dict = {}
    for r in rows:
        if not r[2]:
            continue
        side = "in" if norm(r[4]).startswith("in") else "out"
        d: dict = {}
        for h, c in zip(hs, r):
            if not h or c in (None, ""):
                continue
            if h.endswith(" Additional Details"):
                base = h[: -len(" Additional Details")]
                if base in d:
                    d[base] = f"{d[base]} - {clean(c)}"
                continue
            d[h] = c if isinstance(c, (int, float)) else clean(c)
        out.setdefault((clean(r[2]), norm(r[0])), {})[side] = d
    return out


COPAY_FIELDS = {
    "preventive": "Preventive Care",
    "primary_care": "Primary Care Office Visit",
    "specialist": "Specialist Office Visit",
    "emergency": "Emergency Care",
    "urgent_care": "Urgent Care",
    "inpatient_surgeon": "Doctor Costs for Inpatient Surgery",
    "inpatient_admission": "Hospital Inpatient Cost Per Admission",
    "hospital_room": "Hospital Room Costs",
    "outpatient_surgeon": "Doctor Costs for Outpatient Surgery",
    "outpatient_facility": "Other Outpatient Surgery Costs",
    "lab_xray": "Diagnostic Tests or Procedures (e.g., Blood Tests",
    "imaging": "Diagnostic Tests or Procedures (e.g., CT scans",
    "mental_health_professional": "Professional Services (Mental Health",
    "physical_therapy": "Physical Therapy",
    "maternity": "Prenatal Care, Screening for Gestational Diabetes",
    "durable_equipment": "Durable Medical Equipment",
    "rx_tier1": "Tier 1", "rx_tier2": "Tier 2", "rx_tier3": "Tier 3",
    "rx_tier4": "Tier 4", "rx_tier5": "Tier 5", "rx_mail": "Mail Order Pharmacy",
}
# Headline coinsurance: first percentage found in these in-network services.
COINS_ORDER = ("inpatient_admission", "hospital_room", "specialist", "primary_care")
ENROLL_SUFFIX = (("self", "(Self)"), ("self_plus_one", "(Self Plus One)"), ("family", "(Self & Family)"))


def _field(d: dict, prefix: str):
    if prefix in d:
        return d[prefix]
    low = prefix.lower()
    for h, v in d.items():
        if h.lower().startswith(low):
            return v
    return None


def _amount(cell: object, none_is_zero: bool) -> float | None:
    if none_is_zero and norm(cell) in ("none", "no deductible"):
        return 0.0  # OPM writes "None" for a plan with no deductible
    return money(cell)


def _per_enrollment(d: dict, stem: str, none_is_zero: bool = False) -> dict:
    return {k: _amount(d.get(f"{stem} {suf}"), none_is_zero) for k, suf in ENROLL_SUFFIX}


def benefit_entry(sides: dict) -> dict:
    inn, out = sides.get("in", {}), sides.get("out", {})
    copays = {k: parse_money_or_pct(_field(inn, h)) for k, h in COPAY_FIELDS.items()}
    coins = None
    for k in COINS_ORDER:
        if copays[k]["kind"] == "pct":
            coins = copays[k]["value"]
            break
    return {
        "deductible": _per_enrollment(inn, "Annual deductible", True),
        "oop_max": _per_enrollment(inn, "Annual out-of-pocket maximum"),
        "coinsurance": coins,
        "copays": copays,
        "account_type": inn.get("Type of account"),
        "account_contribution": _per_enrollment(inn, "Medical account contribution"),
        "out_of_network": {
            "deductible": _per_enrollment(out, "Annual deductible", True),
            "oop_max": _per_enrollment(out, "Annual out-of-pocket maximum"),
        },
        "raw": inn,
    }


def load_service_area(path: Path):
    """{(plan code, normalized option): {nationwide, states, statewide, counties, zips}}.

    states   every state with any coverage
    statewide states covered in full
    counties 5-digit FIPS of counties covered in full (state not statewide)
    zips     ZIP codes listed for partially covered counties
    """
    header, rows = table(path)
    out: dict = {}
    for r in rows:
        if not r[1]:
            continue
        e = out.setdefault((clean(r[1]), norm(r[0])), {
            "nationwide": False, "states": set(), "statewide": set(), "counties": set(), "zips": set()})
        if clean(r[4]).upper() == "Y":
            e["nationwide"] = True
            continue
        st = clean(r[5])
        if not st:
            continue
        e["states"].add(st)
        if clean(r[6]).upper() == "Y":
            e["statewide"].add(st)
        elif r[8] not in (None, ""):
            if clean(r[9]).upper() == "Y":
                e["counties"].add(str(int(r[8])).zfill(5))
            if r[10]:
                e["zips"].update(z.strip() for z in str(r[10]).split(",") if z.strip())
    return out


def build_fehb(paths: dict):
    plans_out: list[dict] = []
    rates_out: dict = {}
    benefits_out: dict = {}
    service_out: dict = {}
    for year in YEARS:
        _, key_rows = table(paths[f"FEHB_{year}_PLAN_KEY"])
        plans = _group(key_rows)
        benefits = load_benefits(paths[f"FEHB_{year}_BENEFITS"])
        sa = load_service_area(paths[f"FEHB_{year}_SERVICE_AREA"])
        _, pay_rows = table(paths[f"FEHB_{year}_PAYROLL_RATES"])
        payroll = {clean(r[0]): r for r in pay_rows}  # Emp_Pays = col 2, MEmp_Pays = col 6

        rates_out[str(year)] = {}
        benefits_out[str(year)] = {}
        for pkey, p in sorted(plans.items(), key=lambda kv: kv[1]["enrollment"].get("self", "")):
            code = p["enrollment"]["self"]
            sides = benefits.get(pkey, {})
            acct = norm(sides.get("in", {}).get("Type of account"))
            hsa = "savings" in acct or p["option_type"].upper() == "HDHP"
            hra = "reimburs" in acct
            area = sa.get(pkey, {})
            first_digit = int(code[-1])
            plans_out.append({
                "code": code,
                "name": _display_name(p),
                "year": year,
                "type": _plan_type(p["option_type"], p["network"]),
                "network_family": network_family(p["carrier"], p["plan_name"]),
                "hsa": hsa,
                "hra": hra,
                "nationwide": bool(area.get("nationwide")),
                "plan_code": p["plan_code"],
                "option": p["option"],
                "option_group": 0 if first_digit <= 3 else 1,
                "carrier": p["carrier"],
                "option_type": p["option_type"],
                "network": p["network"],
                "_states": sorted(area.get("statewide", ())) or sorted(area.get("states", ())),
            })
            r = {}
            for etype, ecode in p["enrollment"].items():
                row = payroll.get(ecode)
                if row is not None:
                    r[etype] = {"biweekly_active": float(row[2]), "monthly_retiree": float(row[6])}
            rates_out[str(year)][code] = r
            if sides:
                benefits_out[str(year)][code] = benefit_entry(sides)
            if year == YEARS[-1]:
                service_out[code] = {
                    "nationwide": bool(area.get("nationwide")),
                    "states": sorted(area.get("states", ())),
                    "statewide": sorted(area.get("statewide", ())),
                    "counties": sorted(area.get("counties", ())),
                    "zips": sorted(area.get("zips", ())),
                }
    # Display names collide when options share a plan name, or one plan is sold in
    # several regions under different plan codes. Disambiguate by option, then by
    # service-area states, and finally by plan code, so each (year, name) is unique.
    for year in YEARS:
        ps = [p for p in plans_out if p["year"] == year]
        for step in ("option", "states", "code"):
            groups: dict = defaultdict(list)
            for p in ps:
                groups[p["name"]].append(p)
            for g in groups.values():
                if len(g) == 1:
                    continue
                for p in g:
                    if step == "option" and len({x["option"] for x in g}) > 1:
                        if not norm(p["name"]).endswith(norm(p["option"])):
                            p["name"] += f" ({p['option']})"
                    elif step == "states":
                        st = p.get("_states") or []
                        if st and len({tuple(x.get("_states") or []) for x in g}) > 1:
                            p["name"] += " [" + (", ".join(st) if len(st) <= 4 else f"{len(st)} states") + "]"
                    elif step == "code":
                        p["name"] += f" ({p['code']})"
    for p in plans_out:
        p.pop("_states", None)
    return plans_out, rates_out, benefits_out, service_out


# --------------------------------------------------------------------------- FEDVIP

def _split_plan_option(s: str):
    s = clean(s)
    if " - " in s:
        a, b = s.rsplit(" - ", 1)
        return a, b
    return s, ""


def _fedvip_plans(path: Path, sheet: int):
    _, rows = table(path, sheet)
    seen: dict = {}
    for r in rows:
        if not r[0]:
            continue
        k = (clean(r[0]), clean(r[2]))
        seen.setdefault(k, {
            "name": clean(r[0]), "option": clean(r[2]), "service_area": clean(r[1]),
            "brochure": clean(r[4]), "phone": clean(r[5]),
            "website": clean(r[6]), "directory": clean(r[7]),
        })
    return list(seen.values())


def _fedvip_rates(path: Path, sheet: int, region_col: bool):
    _, rows = table(path, sheet, marker="Plan - Option")
    out = []
    for r in rows:
        if not r[0] or not isinstance(r[2], (str, int, float)) or money(r[2]) is None:
            continue  # footnote / blank rows
        name, option = _split_plan_option(r[0])
        vals = [money(c) for c in r[2:8]]
        out.append({
            "plan": name, "option": option,
            "region": clean(r[1]) if region_col and r[1] not in (None, "") else None,
            "biweekly": dict(zip(("self", "self_plus_one", "family"), vals[:3])),
            "monthly": dict(zip(("self", "self_plus_one", "family"), vals[3:])),
        })
    return out


def _fedvip_benefits(path: Path, sheet: int):
    header, rows = table(path, sheet)
    hs = [clean(h) for h in header]
    out = []
    for r in rows:
        if not r[0] or not r[3]:
            continue
        fields = {}
        for h, c in zip(hs[4:], r[4:]):
            if h and c not in (None, "") and norm(c) != "n/a":
                fields[h] = c if isinstance(c, (int, float)) else clean(c)
        if not fields:
            continue
        out.append({"plan": clean(r[0]), "option": clean(r[2]), "network": clean(r[3]), "fields": fields})
    return out


def _rating_regions(path: Path):
    header, rows = table(path, marker="State")
    carriers = [clean(h) for h in header[2:] if h]
    out = []
    for r in rows:
        if not r[0] or r[1] is None:
            continue
        regions = {}
        for c, v in zip(carriers, r[2:]):
            regions[c] = None if norm(v) in ("n/a", "") else int(v)
        out.append({"state": clean(r[0]), "area": clean(r[1]), "regions": regions})
    return out


def zip_coverage(path: Path):
    """Stream the ~1M-row FEDVIP zip file into {plan: {option: {region: [zip3...]}}}.

    Only the first three ZIP digits are kept (the OPM rating chart is by ZIP3), which
    keeps the JSON small. Rows are never held in memory, only the distinct ZIP3 sets.
    """
    acc: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))
    it = iter(sheet_rows(path))
    next(it)  # header
    for r in it:
        if not r or not r[0] or r[5] in (None, ""):
            continue
        acc[clean(r[0])][clean(r[2])][clean(r[3])].add(str(r[5]).strip().zfill(5)[:3])
    return {p: {o: {reg: sorted(z) for reg, z in regs.items()} for o, regs in opts.items()}
            for p, opts in acc.items()}


def build_fedvip(paths: dict):
    out = {}
    for year in YEARS:
        key, rates = paths[f"FEDVIP_{year}_PLAN_KEY"], paths[f"FEDVIP_{year}_RATES"]
        ben = paths[f"FEDVIP_{year}_BENEFITS"]
        # sheet order is stable across both years: Dental first in rates/benefits, Vision first in key
        out[str(year)] = {
            "dental": {
                "plans": _fedvip_plans(key, 1),
                "rates": _fedvip_rates(rates, 0, True),
                "benefits": _fedvip_benefits(ben, 0),
                "rating_regions": _rating_regions(paths[f"FEDVIP_{year}_RATING_REGIONS"]),
                "zip3_coverage": zip_coverage(paths[f"FEDVIP_{year}_ZIPCODES"]),
            },
            "vision": {
                "plans": _fedvip_plans(key, 0),
                "rates": _fedvip_rates(rates, 1, False),
                "benefits": _fedvip_benefits(ben, 1),
            },
        }
    return out


# --------------------------------------------------------------------------- main

def write_json(name: str, obj) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    p = DATA_DIR / name
    p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False, sort_keys=False), encoding="utf-8")
    print(f"  {name}: {p.stat().st_size / 1024:.0f} KB")
    return p


def main() -> None:
    paths = fetch_opm.download_all()
    plans, rates, benefits, service = build_fehb(paths)
    write_json("plans.json", plans)
    write_json("rates.json", rates)
    write_json("benefits.json", benefits)
    write_json("service_area.json", service)
    write_json("dental_vision.json", build_fedvip(paths))
    write_json("meta.json", {"files": {
        name: {"url": url, "published": published_from_filename(url.rsplit("/", 1)[1])}
        for name, url in fetch_opm.FILES.items()}})


if __name__ == "__main__":
    main()
