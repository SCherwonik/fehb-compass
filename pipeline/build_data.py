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
import textfix  # noqa: E402

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


_MOJIBAKE_RUN = re.compile("[Â-ô][\u0080-¿Œ-Ÿˆ˜–-›€™]+")
_QUOTES = str.maketrans({"‘": "'", "’": "'", "‚": "'", "‛": "'",
                         "“": '"', "”": '"', "„": '"'})


def _unmojibake_run(m: re.Match) -> str:
    try:
        return m.group(0).encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return m.group(0)


def fix_mojibake(s: str) -> str:
    """Repair UTF-8 text that was decoded as cp1252 (e.g. 'Aspergerâ€™s' -> "Asperger's")."""
    try:
        return s.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    s = _MOJIBAKE_RUN.sub(_unmojibake_run, s)
    return s.replace("�", "")


def clean(s: object) -> str:
    t = fix_mojibake(str(s if s is not None else "")).translate(_QUOTES)
    return re.sub(r"\s+", " ", t).strip()


def published_from_filename(name: str) -> str:
    """ISO date from the MMDDYY (or MMDDYYYY) stamp at the end of an OPM file name."""
    m = re.search(r"[_-](\d{2})(\d{2})(\d{2}|\d{4})\.xlsx$", name)
    if not m:
        raise ValueError(f"no date stamp in {name}")
    mm, dd, yy = int(m.group(1)), int(m.group(2)), m.group(3)
    year = int(yy) if len(yy) == 4 else 2000 + int(yy)
    return date(year, mm, dd).isoformat()


# Carrier-name prefixes that should collapse into one family label.
_FAMILY_ALIASES = (
    ("kaiser permanente", "Kaiser Permanente"),
    ("geha", "GEHA"),
    ("g.e.h.a", "GEHA"),
    ("baylor scott", "Baylor Scott & White"),
    ("medical mutual", "Medical Mutual of Ohio"),
)


def network_family(carrier: str) -> str:
    """Family label derived from the plan key's carrier name.

    OPM publishes no provider networks, so this is name-based. Carrier names are
    normalized through a small alias table, then:
      Cigna, UnitedHealthcare (UnitedHealthcare / UHC), Aetna (also Altius, Aetna Health
      of Utah) and Blue Cross (Blue Cross and Blue Shield, Anthem, CareFirst BlueChoice)
      are the big carrier families;
      known aliases collapse regional variants (e.g. "Kaiser Permanente - Colorado" ->
      "Kaiser Permanente", GEHA and GEHA Indemnity -> "GEHA");
      any other carrier is labelled with its own cleaned name (text before " - ", "(",
      ":" or ","), which is "plan-owned".
    build_fehb then relabels carriers that have only a single plan in a year as "Other".
    """
    s = norm(carrier)
    if "cigna" in s:
        return "Cigna"
    if "unitedhealthcare" in s or "united healthcare" in s or re.search(r"\buhc\b", s):
        return "UnitedHealthcare"
    if "aetna" in s or "altius" in s:
        return "Aetna"
    if "blue cross" in s or "bluecross" in s or "anthem" in s or "carefirst" in s or "blue shield" in s:
        return "Blue Cross"
    for prefix, label in _FAMILY_ALIASES:
        if s.startswith(prefix):
            return label
    return clean(re.split(r" - |\(|:|,", clean(carrier))[0]) or "Other"


def expect_header(path: Path, header: list, expected: list, start: int = 0) -> None:
    """Fail loudly when a sheet's header row does not carry the expected column labels.

    `expected` labels are compared (alphanumerics only, lower case) against the header
    cells from index `start`; None in `expected` skips a column. Raised before any rows
    are read by index, so a reordered OPM file cannot silently yield wrong values.
    """
    def key(x):
        return re.sub(r"[^a-z0-9]", "", str(x if x is not None else "").lower())

    for i, want in enumerate(expected, start):
        if want is None:
            continue
        got = header[i] if i < len(header) else None
        if key(got) != key(want):
            raise ValueError(f"{path.name}: column {i + 1} header is {got!r}, expected {want!r}")


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

PLAN_KEY_COLS = ["Carrier Name", "Plan Option Name", "Plan Code", "Plan Code Name",
                 "Enrollment Code", "Enrollment Type", "Network Type", "Plan Option Type"]
PAYROLL_COLS = ["Enrl_Code", "Gov_Pays", "Emp_Pays", "SE_Pays", "TCC_Pays", "MGov_Pays", "MEmp_Pays"]
SERVICE_AREA_COLS = ["Option", "Plan Code", "Plan Name", "Enrollment Code", "Nationwide (Y/N)",
                     "State code", "Statewide (Y/N)", "County", "County FIPS", "Countywide (Y/N)", "ZIP code"]
BENEFITS_COLS = ["Plan Option Name", "Brochure Number", "Plan Code", "Plan Name", "In-network/out-of-network"]
FEDVIP_KEY_COLS = ["Plan Code Name", "Service Area", "Plan Code Option Type", "Enrollment Type",
                   "Brochure Number", "Phone Number", "Contract Website", "Contract Provider Directory"]
FEDVIP_BENEFITS_COLS = ["Plan Code Name", "Contract Type", "Plan Code Option Type", "Network Type"]
FEDVIP_RATE_COLS = ["Plan - Option", None, "Self Only", "Self Plus One", "Self & Family",
                    "Self Only", "Self Plus One", "Self & Family"]
RATING_REGION_COLS = ["State", "State/ZIP(first 3)"]
FEDVIP_ZIP_COLS = ["Plan Name", "Plan Code", "Option Type", "Region", "State Name", "ZIP Code"]


def _group(plan_key_rows, source: str = "plan key"):
    """Collapse plan-key rows into plans keyed by (plan code, normalized option)."""
    plans: dict[tuple[str, str], dict] = {}
    for r in plan_key_rows:
        if not r[2]:
            continue
        if clean(r[5]) not in ENROLL_KEYS:
            raise ValueError(
                f"{source}: plan {clean(r[2])!r} ({clean(r[1])!r}) has unknown enrollment type "
                f"{clean(r[5])!r} in column 5; expected one of {sorted(ENROLL_KEYS)}")
        key = (clean(r[2]), norm(r[1]))
        p = plans.setdefault(key, {
            "plan_code": clean(r[2]), "carrier": clean(r[0]), "option": clean(r[1]),
            "plan_name": clean(r[3]), "network": clean(r[6]), "option_type": clean(r[7]),
            "enrollment": {},
        })
        p["enrollment"][ENROLL_KEYS[clean(r[5])]] = clean(r[4])
    for p in plans.values():
        if not p["enrollment"].get("self"):
            raise ValueError(
                f"{source}: plan {p['plan_code']!r} ({p['option']!r}) has no 'Self' enrollment code "
                f"(found {sorted(p['enrollment'])}); cannot key the plan")
    return plans


def _payroll_amount(row, col: int, source: str, code: str, label: str) -> float:
    """Parse a payroll rate cell, naming file, enrollment code and column when blank/invalid."""
    v = row[col]
    try:
        if v is None or (isinstance(v, str) and not v.strip()):
            raise ValueError("blank")
        return float(v)
    except (TypeError, ValueError):
        raise ValueError(
            f"{source}: enrollment code {code!r}: column {col} ({label}) is {v!r}, expected a number") from None


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
    expect_header(path, header, BENEFITS_COLS)
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


def _amount(cell: object, none_is_zero: bool, na_is_zero: bool = False) -> float | None:
    if none_is_zero and norm(cell) in ("none", "no deductible"):
        return 0.0  # OPM writes "None" for a plan with no deductible
    if na_is_zero and norm(cell) == "not applicable":
        return 0.0  # in network, "Not applicable" = the plan has no deductible (891, DH4); the raw text is kept
    return money(cell)


def _per_enrollment(d: dict, stem: str, none_is_zero: bool = False, na_is_zero: bool = False) -> dict:
    return {k: _amount(d.get(f"{stem} {suf}"), none_is_zero, na_is_zero) for k, suf in ENROLL_SUFFIX}


def benefit_entry(sides: dict) -> dict:
    inn, out = sides.get("in", {}), sides.get("out", {})
    copays = {k: parse_money_or_pct(_field(inn, h)) for k, h in COPAY_FIELDS.items()}
    coins = None
    for k in COINS_ORDER:
        if copays[k]["kind"] == "pct":
            coins = copays[k]["value"]
            break
    return {
        "deductible": _per_enrollment(inn, "Annual deductible", True, na_is_zero=True),
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
    expect_header(path, header, SERVICE_AREA_COLS)
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


def account_flags(option_type: str, account_type: object, has_benefits: bool):
    """(hsa, hra, type_note) for one plan-year.

    hsa/hra come from the benefits file's "Type of account" (the plan key's HDHP label is
    not reliable: e.g. 401 and C54 are labelled HDHP but have no account). `type` stays as
    OPM labels it; a type_note records any disagreement. Without a benefits row we can only
    fall back to the label.
    """
    label = (option_type or "").upper()
    if not has_benefits:
        return label == "HDHP", False, "no benefits row: hsa inferred from the HDHP label" if label == "HDHP" else None
    acct = norm(account_type)
    hsa, hra = "savings" in acct, "reimburs" in acct
    note = None
    if label == "HDHP" and not hsa:
        shown = clean(account_type) or "none"
        note = (f"OPM labels this option HDHP but its benefits row lists account type '{shown}'"
                f"{', so it is not an HSA plan' if not hra else ' (an HRA, not an HSA)'}")
    return hsa, hra, note


def build_fehb(paths: dict):
    plans_out: list[dict] = []
    rates_out: dict = {}
    benefits_out: dict = {}
    service_out: dict = {}
    warnings: list[str] = []
    for year in YEARS:
        hdr, key_rows = table(paths[f"FEHB_{year}_PLAN_KEY"])
        expect_header(paths[f"FEHB_{year}_PLAN_KEY"], hdr, PLAN_KEY_COLS)
        plans = _group(key_rows, paths[f"FEHB_{year}_PLAN_KEY"].name)
        benefits = load_benefits(paths[f"FEHB_{year}_BENEFITS"])
        sa = load_service_area(paths[f"FEHB_{year}_SERVICE_AREA"])
        hdr, pay_rows = table(paths[f"FEHB_{year}_PAYROLL_RATES"])
        expect_header(paths[f"FEHB_{year}_PAYROLL_RATES"], hdr, PAYROLL_COLS)
        pay_name = paths[f"FEHB_{year}_PAYROLL_RATES"].name
        payroll = {clean(r[0]): r for r in pay_rows}  # Emp_Pays = col 2, MEmp_Pays = col 6

        rates_out[str(year)] = {}
        benefits_out[str(year)] = {}
        for pkey, p in sorted(plans.items(), key=lambda kv: kv[1]["enrollment"].get("self", "")):
            code = p["enrollment"]["self"]
            sides = benefits.get(pkey, {})
            acct = norm(sides.get("in", {}).get("Type of account"))
            hsa, hra, type_note = account_flags(p["option_type"], sides.get("in", {}).get("Type of account"),
                                                bool(sides))
            area = sa.get(pkey, {})
            if not code[-1:].isdigit():
                raise ValueError(
                    f"{paths[f'FEHB_{year}_PLAN_KEY'].name}: plan {p['plan_code']!r} ({p['option']!r}): "
                    f"enrollment code {code!r} does not end in a digit")
            first_digit = int(code[-1])
            plans_out.append({
                "code": code,
                "name": _display_name(p),
                "year": year,
                "type": _plan_type(p["option_type"], p["network"]),
                "network_family": network_family(p["carrier"]),
                "hsa": hsa,
                "hra": hra,
                **({"type_note": type_note} if type_note else {}),
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
                if row is None:
                    msg = (f"{pay_name}: enrollment code {ecode!r} ({etype}) of plan {code!r} "
                           f"({_display_name(p)!r}) not found in payroll rates")
                    if year == YEARS[-1]:
                        raise ValueError(msg)
                    warnings.append(f"{year}: {msg}; rate omitted")
                    continue
                r[etype] = {
                    "biweekly_active": _payroll_amount(row, 2, pay_name, ecode, "Emp_Pays"),
                    "monthly_retiree": _payroll_amount(row, 6, pay_name, ecode, "MEmp_Pays"),
                }
            rates_out[str(year)][code] = r
            if sides:
                benefits_out[str(year)][code] = benefit_entry(sides)
            elif year != YEARS[-1]:
                warnings.append(f"{year}: plan {code!r} ({_display_name(p)!r}) has no benefits rows")
            if year == YEARS[-1]:
                service_out[code] = {
                    "nationwide": bool(area.get("nationwide")),
                    "states": sorted(area.get("states", ())),
                    "statewide": sorted(area.get("statewide", ())),
                    "counties": sorted(area.get("counties", ())),
                    "zips": sorted(area.get("zips", ())),
                }
    # Carriers with a single plan in a year are not a family: label them "Other".
    for year in YEARS:
        ps = [p for p in plans_out if p["year"] == year]
        counts_f: dict = defaultdict(int)
        for p in ps:
            counts_f[p["network_family"]] += 1
        for p in ps:
            if counts_f[p["network_family"]] == 1:
                p["network_family"] = "Other"
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
    return plans_out, rates_out, benefits_out, service_out, warnings


# --------------------------------------------------------------------------- FEDVIP

def _split_plan_option(s: str):
    s = clean(s)
    if " - " in s:
        a, b = s.rsplit(" - ", 1)
        return a, b
    return s, ""


def _fedvip_plans(path: Path, sheet: int):
    hdr, rows = table(path, sheet)
    expect_header(path, hdr, FEDVIP_KEY_COLS)
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
    hdr, rows = table(path, sheet, marker="Plan - Option")
    expect_header(path, hdr, FEDVIP_RATE_COLS)
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
    expect_header(path, header, FEDVIP_BENEFITS_COLS)
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
    expect_header(path, header, RATING_REGION_COLS)
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
    expect_header(path, next(it), FEDVIP_ZIP_COLS)
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

def apply_text_fixes(plans: list, benefits: dict) -> None:
    """Repair PDF-extraction spacing in benefit text and plan names, in place.

    Runs after parsing, so numeric fields (deductibles, copay values, oop_max,
    coinsurance) are never affected; only display strings change.
    """
    def entries():
        for year in benefits.values():
            yield from year.values()

    texts: list[str] = []
    for e in entries():
        texts += [v for v in e["raw"].values() if isinstance(v, str)]
        texts += [c["raw"] for c in e["copays"].values() if isinstance(c.get("raw"), str)]
    texts += [p[k] for p in plans for k in ("name", "plan_name", "option") if p.get(k)]
    vocab = textfix.build_vocab(texts)
    for e in entries():
        for k, v in e["raw"].items():
            if isinstance(v, str):
                e["raw"][k] = textfix.fix_spacing(v, vocab)
        for c in e["copays"].values():
            if isinstance(c.get("raw"), str):
                c["raw"] = textfix.fix_spacing(c["raw"], vocab)
    for p in plans:
        for k in ("name", "plan_name", "option"):
            if p.get(k):
                p[k] = textfix.fix_spacing(p[k], vocab)


OVERRIDES_PATH = Path(__file__).resolve().parent / "benefit_overrides.json"


def _usd_text(v: float) -> str:
    return f"${v:,.0f}" if float(v).is_integer() else f"${v:,.2f}"


def apply_benefit_overrides(benefits: dict, path: Path = OVERRIDES_PATH) -> int:
    """Patch benefits where a hand-checked 2027 brochure value replaces OPM's spreadsheet (I5).

    Each entry of pipeline/benefit_overrides.json names a plan, an engine field ('deductible' or 'rx_tierN'),
    the spreadsheet value it expects, the brochure value, and the raw fields that display it. The engine
    field gets the brochure value, the raw fields show the brochure text, and entry["overrides"][raw field]
    keeps the spreadsheet text, brochure number, page, quote and reason (the app's "Differs from OPM
    spreadsheet" badge). A spreadsheet value that no longer matches stops the build: re-check the brochure.
    Returns the number of entries applied.
    """
    if not Path(path).exists():
        return 0
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    n = 0
    for o in spec.get("overrides", []):
        code, field, year = o["plan_code"], o["field"], str(o["year"])
        e = benefits.get(year, {}).get(code)
        if e is None:
            raise ValueError(f"{Path(path).name}: plan {code!r} is not in the {year} benefits")
        meta = {k: o[k] for k in ("brochure", "page", "quote", "reason") if k in o}
        record = e.setdefault("overrides", {})
        if field == "deductible":
            want = {k: float(v) for k, v in o["sheet"].items()}
            if e["deductible"] != want:
                raise ValueError(f"{Path(path).name}: {code} deductible is {e['deductible']}, expected {want}: re-check")
            e["deductible"] = {k: float(v) for k, v in o["brochure_value"].items()}
            for f in o["raw_fields"]:
                tier = next((k for k, suf in ENROLL_SUFFIX if f.endswith(suf)), None)
                if tier is None or f not in e["raw"]:
                    raise ValueError(f"{Path(path).name}: {code} has no raw field {f!r}")
                record[f] = {"field": field, "sheet": e["raw"][f], **meta}
                e["raw"][f] = _usd_text(e["deductible"][tier])
        elif re.fullmatch(r"rx_tier[0-9]", field):
            c = e["copays"].get(field) or {}
            if c.get("raw") != o["sheet"]:
                raise ValueError(f"{Path(path).name}: {code} {field} reads {c.get('raw')!r}, expected {o['sheet']!r}: re-check")
            bv = o["brochure_value"]
            new = {"value": float(bv["value"]), "kind": bv["kind"], "raw": o["brochure_text"]}
            if bv.get("cap") is not None:
                new["cap"] = float(bv["cap"])
            e["copays"][field] = new
            for f in o["raw_fields"]:
                if f not in e["raw"]:
                    raise ValueError(f"{Path(path).name}: {code} has no raw field {f!r}")
                record[f] = {"field": field, "sheet": e["raw"][f], **meta}
                e["raw"][f] = o["brochure_text"]
        else:
            raise ValueError(f"{Path(path).name}: {code}: unsupported field {field!r}")
        n += 1
    return n


# --------------------------------------------------------------------------- maternity

MATERNITY_TERMS_PATH = Path(__file__).resolve().parent / "maternity_terms.json"
MATERNITY_ROW = "Prenatal Care, Screening for Gestational Diabetes, Delivery, and Postpartum Care (Maternity Care)"
BIRTH_STAY_ROW = "Hospital Stay--Vaginal Birth, Cesarean Birth (Maternity Care)"

# Deductible wording that settles the question (the same phrase classes as src/engine/cost.js).
_MAT_NO_DED = re.compile(r"no deductible|deductibles? (?:does|do) not apply", re.I)
_MAT_DED = re.compile(r"after\b[^.;]{0,40}?deductible|calendar year deductible", re.I)
# A cell that is plainly "you pay nothing", with at most a deductible or plan-allowance remark.
_MAT_ZERO = re.compile(
    r"(?:member pays nothing|\$0 copayment)"
    r"(?: - (?:no deductible|deductible does not apply|\(?after (?:the )?deductible(?: is met)?\)?|of our plan allowance))?\.?",
    re.I)
# One flat hospital copay for the whole admission (never per day), with at most a deductible remark.
_MAT_FLAT = re.compile(
    r"\$([0-9][0-9,]*(?:\.[0-9]+)?)(?: copayment)?"
    r"(?: - (?:per (?:admission|admit)(?:;? after (?:the )?deductible)?|after (?:the )?deductible\.?))?",
    re.I)
# A plain coinsurance, with at most a deductible remark.
_MAT_PCT = re.compile(r"([0-9]+(?:\.[0-9]+)?)% coinsurance(?: - (?:after (?:the )?deductible|\$[0-9,]+ calendar year deductible))?", re.I)


def _ded_flag(*texts: str):
    """True / False when a text says so (False wins, as in the engine), None when every text is silent."""
    if any(_MAT_NO_DED.search(t) for t in texts):
        return False
    if any(_MAT_DED.search(t) for t in texts):
        return True
    return None


def maternity_term(e: dict) -> dict:
    """What one pregnancy (prenatal care, delivery, postpartum care and the hospital stay for the birth) costs the
    member under this plan, read from OPM's two maternity rows when they are plain enough to be certain.

    -> {"priced": True, "kind": "zero"|"usd"|"pct", "value", "deductible": True|False|None (None: the plan default),
        "per": "pregnancy"|"admission", "source": "opm", "maternity": raw, "stay": raw}
    or {"priced": False, "reason", "source": "opm", "maternity", "stay"}. Only these are priced:
      both rows "nothing"                                  -> zero
      maternity care "nothing", birth stay one flat copay  -> usd (per admission; never a per-day copay)
      both rows the same plain coinsurance                 -> pct
    Anything else needs the plan's brochure (pipeline/maternity_terms.json) or stays unpriced; and even a plain
    term is only a suggestion until a reviewed entry confirms it (see apply_maternity_terms).
    """
    m = clean(e.get("raw", {}).get(MATERNITY_ROW))
    s = clean(e.get("raw", {}).get(BIRTH_STAY_ROW))
    base = {"source": "opm", "maternity": m, "stay": s}
    full = lambda rx, t: rx.fullmatch(t.strip()) if t else None  # noqa: E731
    if full(_MAT_ZERO, m) and full(_MAT_ZERO, s):
        return {"priced": True, "kind": "zero", "value": 0.0, "deductible": _ded_flag(s, m), "per": "pregnancy", **base}
    f = full(_MAT_FLAT, s)
    if full(_MAT_ZERO, m) and f:
        return {"priced": True, "kind": "usd", "value": float(f.group(1).replace(",", "")),
                "deductible": _ded_flag(s, m), "per": "admission", **base}
    p = full(_MAT_PCT, m)
    if p and m == s:
        return {"priced": True, "kind": "pct", "value": float(p.group(1)), "deductible": _ded_flag(s, m), "per": "pregnancy", **base}
    return {"priced": False, "reason": _maternity_gap(m, s), **base}


def _maternity_gap(m: str, s: str) -> str:
    if not m or not s:
        return "OPM lists no maternity terms for this plan."
    if re.search(r"per day|/day|days?\b", s, re.I):
        return "The hospital stay for the birth has a per-day copay, and the number of days is not known."
    if "%" in s or "%" in m:
        return ("Coinsurance applies to only part of the care (the hospital stay for the birth or the maternity care), "
                "and how the bill splits between the hospital and the doctors is not known.")
    if re.search(r"visit", m + " " + s, re.I):
        return "Maternity care has per-visit copays, and the number of visits is not known."
    return "OPM's maternity terms are not plain enough to price without the plan brochure."


MATERNITY_ASSUMPTION_KEYS = ("days", "visits", "split")
_PART_KINDS = ("zero", "pct", "usd", "per_day", "per_visit")
_PART_OF = ("hospital", "doctors", "all")
_PART_VISITS = ("all", "prenatal", "postpartum", "postpartum_after_first", "initial")


def check_maternity_estimate(est: dict, where: str) -> dict:
    """Validate a reviewed entry's "estimate": {"assumed": [...], "parts": [...], "note"?}. Each part is one charge the
    brochure states ({of: hospital|doctors|all, kind: zero|pct|usd|per_day|per_visit, value, deductible: true|false,
    cap?, maxDays?, visits?}); the counts and shares it leaves out come from the app's approved assumptions
    (src/engine/maternity-assumptions.js), and "assumed" must name exactly the ones the parts need:
    split for a coinsurance part on the hospital's or the doctors' share, days for per-day charges, visits for
    per-visit charges."""
    assumed = list(est.get("assumed") or [])
    parts = list(est.get("parts") or [])
    if not parts or any(a not in MATERNITY_ASSUMPTION_KEYS for a in assumed) or len(set(assumed)) != len(assumed):
        raise ValueError(f"{where}: bad estimate {est!r}")
    for q in parts:
        if q.get("of") not in _PART_OF or q.get("kind") not in _PART_KINDS or q.get("deductible") not in (True, False):
            raise ValueError(f"{where}: bad estimate part {q!r}")
        if q["kind"] in ("pct", "usd", "per_day", "per_visit") and not isinstance(q.get("value"), (int, float)):
            raise ValueError(f"{where}: estimate part needs a value {q!r}")
        if q["kind"] == "per_visit" and q.get("visits") not in _PART_VISITS:
            raise ValueError(f"{where}: per-visit part needs visits {q!r}")
    # only a coinsurance part depends on how the bill divides (a copay or a per-day / per-visit charge does not)
    need = {"split"} if any(q["of"] != "all" and q["kind"] == "pct" for q in parts) else set()
    need |= {"days"} if any(q["kind"] == "per_day" for q in parts) else set()
    need |= {"visits"} if any(q["kind"] == "per_visit" for q in parts) else set()
    if need != set(assumed):
        raise ValueError(f"{where}: estimate assumes {sorted(assumed)} but its parts need {sorted(need)}")
    out = {"assumed": assumed, "parts": parts}
    if est.get("note"):
        out["note"] = est["note"]
    return out


def apply_maternity_terms(benefits: dict, path: Path = MATERNITY_TERMS_PATH) -> tuple[int, int]:
    """Give every plan benefits[year][code]["maternity"] (see maternity_term), then apply the brochure-reviewed
    entries of pipeline/maternity_terms.json (2027 only). Each entry names the plan, the two OPM cells it was
    reviewed against ("sheet": a changed cell stops the build: re-check the brochure), and either a term
    {kind: zero|usd|pct, value, deductible, per} or term null (left unpriced, with the reason), plus the
    brochure number, page, verbatim quote and reason. Returns (reviewed entries applied, plans priced in 2027).
    """
    for year in benefits.values():
        for e in year.values():
            e["maternity"] = maternity_term(e)
    n = 0
    if Path(path).exists():
        spec = json.loads(Path(path).read_text(encoding="utf-8"))
        for o in spec.get("terms", []):
            code, year = o["plan_code"], str(o["year"])
            e = benefits.get(year, {}).get(code)
            if e is None:
                raise ValueError(f"{Path(path).name}: plan {code!r} is not in the {year} benefits")
            cur = e["maternity"]
            want = o["sheet"]
            if cur["maternity"] != want["maternity"] or cur["stay"] != want["stay"]:
                raise ValueError(f"{Path(path).name}: {code} maternity cells changed "
                                 f"({cur['maternity']!r} / {cur['stay']!r}): re-check the brochure")
            meta = {k: o[k] for k in ("brochure", "page", "quote", "reason") if k in o}
            t = o["term"]
            if t is None and o.get("estimate") is not None:
                est = check_maternity_estimate(o["estimate"], f"{Path(path).name}: {code}")
                e["maternity"] = {"priced": True, "estimated": True, **est, "source": "brochure",
                                  "maternity": cur["maternity"], "stay": cur["stay"], **meta}
            elif t is None:
                e["maternity"] = {"priced": False, "source": "brochure", "maternity": cur["maternity"], "stay": cur["stay"],
                                  **meta, "reason": o["unpriced"]}
            else:
                if t["kind"] not in ("zero", "usd", "pct") or t["per"] not in ("pregnancy", "delivery", "admission"):
                    raise ValueError(f"{Path(path).name}: {code}: bad term {t!r}")
                if t["deductible"] not in (True, False, None):
                    raise ValueError(f"{Path(path).name}: {code}: deductible must be true, false or null")
                e["maternity"] = {"priced": True, "kind": t["kind"], "value": float(t["value"]),
                                  "deductible": t["deductible"], "per": t["per"], "source": "brochure",
                                  "maternity": cur["maternity"], "stay": cur["stay"], **meta}
            n += 1
    # OPM's two rows were wrong for about a quarter of the 2027 plans checked by hand: a plan is priced only from a
    # brochure-reviewed entry. A plain OPM term without one stays unpriced (it is kept as "suggested").
    for year in benefits.values():
        for e in year.values():
            t = e["maternity"]
            if t["priced"] and t["source"] == "opm":
                suggested = {k: t[k] for k in ("kind", "value", "deductible", "per")}
                e["maternity"] = {"priced": False, "reason": "OPM's maternity terms were not checked against the plan brochure.",
                                  "source": "opm", "maternity": t["maternity"], "stay": t["stay"], "suggested": suggested}
    priced = sum(1 for e in benefits.get("2027", {}).values() if e["maternity"]["priced"])
    return n, priced


def write_json(name: str, obj) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    p = DATA_DIR / name
    p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False, sort_keys=False), encoding="utf-8")
    print(f"  {name}: {p.stat().st_size / 1024:.0f} KB")
    return p


def main() -> None:
    paths = fetch_opm.download_all()
    plans, rates, benefits, service, warnings = build_fehb(paths)
    apply_text_fixes(plans, benefits)
    print(f"  {apply_benefit_overrides(benefits)} brochure overrides applied ({OVERRIDES_PATH.name})")
    reviewed, priced = apply_maternity_terms(benefits)
    print(f"  maternity: {priced} plans priced in 2027, {reviewed} brochure-reviewed ({MATERNITY_TERMS_PATH.name})")
    write_json("plans.json", plans)
    write_json("rates.json", rates)
    write_json("benefits.json", benefits)
    write_json("service_area.json", service)
    write_json("dental_vision.json", build_fedvip(paths))
    write_json("meta.json", {"files": {
        name: {"url": url, "published": published_from_filename(url.rsplit("/", 1)[1])}
        for name, url in fetch_opm.FILES.items()}, "warnings": warnings})


if __name__ == "__main__":
    main()
