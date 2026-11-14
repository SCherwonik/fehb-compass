"""Build data/fedvip.json: UI-ready FEDVIP (dental + vision) data for 2026 and 2027.

Run:  python pipeline/build_fedvip.py     (reads the OPM files already in pipeline/raw/)

Only OPM public-use files are used (plan key, rates, benefits, dental rating regions,
zipcodes). The OPM web compare tool is dynamic and is never scraped.

Output shape (data/fedvip.json "meta.notes" states the same contract in prose):
  meta        {sources: {NAME: {url, published}}, board, raw_columns, notes, warnings}
  years       {"2027": {plans, rates, benefits, geo}, "2026": {...}}
  changes     {type: {matched, new_in_2027, ended_after_2026, service_area_changes}}
  zip3_to_states         {zip3: [state abbreviations]}  (from OPM's own zipcodes file)
  zip5_state_exceptions  {zip5: state}                  (only ZIP3s that span several states)

Plan identity: `<brochure number>-<option>`, e.g. "02AP-01-High". OPM's brochure number
(the zip file calls it "Plan Code") is identical in 2026 and 2027, so it is the cross-year
key. High and Standard of one brochure share rating regions and ZIP coverage.
"""
from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data as bd  # noqa: E402
import fetch_opm  # noqa: E402

YEARS = (2027, 2026)
ENROLL = {"Self": "self", "Self Plus One": "self_plus_one", "Self & Family": "family"}

CARRIERS = (  # normalized name prefix -> carrier label; an unmatched name fails the build
    ("aetna", "Aetna"), ("bluecross", "Blue Cross Blue Shield FEP"), ("delta", "Delta Dental"),
    ("dominion", "Dominion National"), ("emblem", "EmblemHealth"), ("geha", "GEHA"),
    ("humana", "Humana"), ("themetlife", "MetLife"), ("triples", "Triple-S Salud"),
    ("unitedconcordia", "United Concordia"), ("unitedhealthcare", "UnitedHealthcare"),
    ("vsp", "VSP"),
)
STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District Of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "Guam": "GU", "Military": "MIL",
}
NO_STATE = "No State Mapping Found"
NETWORKS = (("In-Network 1", ""), ("In-Network 2", "in2_"), ("Out-of-Network", "oon_"))

# Board rows (listed in raw column order): (short key, raw OPM column, home section, label). The In-Network 1 cell of a row
# lives in its home section; the In-Network 2 / Out-of-Network cells live in "network".
# Derived rows (waiting period, age limit) are read out of the raw lifetime-max cell.
ROWS = {
    "dental": [
        ("deductible", "Per Person Deductible", "cost", "Deductible (per person)"),
        ("annual_max", "Annual Maximum Benefit Per Person", "limits", "Annual maximum (per person)"),
        ("class_a", "Class A - Preventive", "coverage", "Preventive (Class A), you pay"),
        ("class_b", "Class B - Intermediate", "coverage", "Basic (Class B), you pay"),
        ("class_c", "Class C - Major", "coverage", "Major (Class C), you pay"),
        ("class_d", "Class D - Orthodontic", "ortho", "Orthodontia (Class D), you pay"),
        ("ortho_lifetime", "Class D - Orthodontic Lifetime Maximum", "ortho", "Orthodontia lifetime maximum"),
        ("ortho_waiting", "Class D - Orthodontic Lifetime Maximum", "ortho", "Orthodontic waiting period"),
        ("ortho_age", "Class D - Orthodontic Lifetime Maximum", "ortho", "Orthodontic age limit"),
    ],
    "vision": [
        ("exam", "Vision - Vision Exam", "exam", "Exam"),
        ("lenses", "Vision - Vision Lenses Only", "lenses", "Lenses"),
        ("frames", "Vision - Frames", "frames", "Frames"),
        ("copay", "Vision - Copay", "cost", "Copay"),
        ("extras", "Vision - Additional Features", "contacts", "Contacts and additional features"),
    ],
}
SECTIONS = {
    "dental": [("cost", "Cost"), ("coverage", "Dental coverage by class"),
               ("limits", "Annual and lifetime limits"),
               ("ortho", "Waiting periods and orthodontia"),
               ("network", "Network and out-of-network")],
    "vision": [("cost", "Cost"), ("exam", "Vision exam"), ("lenses", "Lenses"), ("frames", "Frames"),
               ("contacts", "Contacts and additional features"),
               ("network", "Network and out-of-network")],
}
DERIVED = {"ortho_waiting", "ortho_age"}
BEN_HEAD = {t: ["Plan Code Name", "Contract Type", "Plan Code Option Type", "Network Type"]
            + list(dict.fromkeys(r[1] for r in ROWS[t])) for t in ROWS}


def _nk(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def carrier_of(name: str) -> str:
    k = _nk(name)
    for prefix, label in CARRIERS:
        if k.startswith(prefix):
            return label
    raise ValueError(f"unknown FEDVIP carrier for plan {name!r}; extend CARRIERS")


def pid(brochure: str, option: str) -> str:
    return f"{brochure}-{option}"


# --------------------------------------------------------------------------- cells

def _is_na(text: str) -> bool:
    return text.lower() in ("n/a", "na", "")


def parse_cell(short: str, raw) -> dict:
    """{text, value?, unit?, approx?}; `text` keeps OPM's wording (whitespace-cleaned only)."""
    text = bd.clean(raw)
    cell: dict = {"text": text}
    low = text.lower()
    if _is_na(text):
        return cell
    if short in ("deductible", "annual_max"):
        if re.fullmatch(r"\$?[0-9][0-9,]*(\.[0-9]+)?", text):
            cell["value"], cell["unit"] = float(text.replace("$", "").replace(",", "")), "usd"
        elif low in ("unlimited", "no maximum"):
            cell["unit"] = "unlimited"
        elif low == "none":
            cell["value"], cell["unit"] = 0.0, "usd"
    elif short.startswith("class_"):
        m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*%", text)
        if m:  # the member's share; "Approx" marks OPM's copayment-schedule estimate
            cell["value"], cell["unit"] = float(m.group(1)), "pct"
            if "approx" in low:
                cell["approx"] = True
    elif short == "ortho_lifetime":
        m = re.search(r"\$\s*([0-9][0-9,]*)", text)
        if m:
            cell["value"], cell["unit"] = float(m.group(1).replace(",", "")), "usd"
        elif "no lifetime" in low:
            cell["unit"] = "unlimited"
    elif short in ("exam", "lenses", "frames"):
        m = re.match(r"every\s+([0-9]+)\s+months", low)
        if m:
            cell["value"], cell["unit"] = float(m.group(1)), "months"
    return cell


def derive(short: str, raw) -> dict:
    t = bd.clean(raw)
    low = t.lower()
    if _is_na(t):
        return {"text": t}
    if short == "ortho_waiting":
        return {"text": "No Waiting Period" if "no waiting period" in low else "Not stated by OPM"}
    m = re.search(r"(Up to Age \d+|Up To Max(?:imum)? Eligibility)", t, re.I)
    return {"text": "No Age Limit" if "no age limit" in low else (m.group(1) if m else "Not stated by OPM")}


def parse_benefits(path: Path, sheet: int, typ: str):
    """-> ({(name, option): {rowkey: cell}}, raw column labels, {(name, option): tiers with data})."""
    header, rows = bd.table(path, sheet)
    bd.expect_header(path, header, BEN_HEAD[typ])
    labels = [bd.clean(h) for h in header]
    cols = [(i, h) for i, h in enumerate(labels) if i >= 4 and h]
    known = {r[1] for r in ROWS[typ]}
    if {h for _, h in cols} != known:
        raise ValueError(f"{path.name}: benefit columns {sorted({h for _, h in cols} ^ known)} are not mapped to a board row")
    by_col = defaultdict(list)
    for short, col, _, _ in ROWS[typ]:
        by_col[col].append(short)
    out: dict = defaultdict(dict)
    tiers: dict = defaultdict(list)
    for r in rows:
        if not r[0] or not r[3]:
            continue
        key, net = (bd.clean(r[0]), bd.clean(r[2])), bd.clean(r[3])
        suffix = dict(NETWORKS).get(net)
        if suffix is None:
            raise ValueError(f"{path.name}: unknown network type {net!r}")
        has = False
        for i, col in cols:
            for short in by_col[col]:
                cell = derive(short, r[i]) if short in DERIVED else parse_cell(short, r[i])
                out[key][suffix + short] = cell
            has = has or not _is_na(bd.clean(r[i]))
        if has:
            tiers[key].append(net)
    return out, [h for _, h in cols], tiers


def board() -> dict:
    out = {}
    for typ in ROWS:
        secs = []
        for sid, title in SECTIONS[typ]:
            rows = []
            if sid == "cost":
                for enr, lab in (("self", "Self Only"), ("self_plus_one", "Self Plus One"), ("family", "Self and Family")):
                    rows.append({"key": f"premium_{enr}", "label": f"Premium, {lab}", "source": "rates"})
            for short, col, home, label in ROWS[typ]:
                extra = {"derived": True} if short in DERIVED else {}
                if sid == home:
                    rows.append({"key": short, "label": label, "source": col, "network": "In-Network 1", **extra})
                if sid == "network":
                    for net, suf in NETWORKS[1:]:
                        rows.append({"key": suf + short, "label": f"{label} ({net})", "source": col,
                                     "network": net, **extra})
            secs.append({"id": sid, "title": title, "rows": rows})
        out[typ] = secs
    return out


# --------------------------------------------------------------------------- plans / rates

def parse_plans(path: Path) -> dict:
    plans: dict = {}
    for sheet, typ in ((1, "dental"), (0, "vision")):
        hdr, rows = bd.table(path, sheet)
        bd.expect_header(path, hdr, bd.FEDVIP_KEY_COLS)
        for r in rows:
            if not r[0]:
                continue
            name, area, option, enr, broch = (bd.clean(r[i]) for i in range(5))
            if enr not in ENROLL:
                raise ValueError(f"{path.name}: unknown enrollment type {enr!r}")
            p = plans.setdefault(pid(broch, option), {
                "type": typ, "carrier": carrier_of(name), "name": name, "option": option,
                "brochure": broch, "nationwide": False, "service_areas": [],
                "phone": bd.clean(r[5]), "website": bd.clean(r[6]), "directory": bd.clean(r[7])})
            if area not in p["service_areas"]:
                p["service_areas"].append(area)
            if area.lower() == "nationwide":
                p["nationwide"] = True
    return plans


def parse_rates(path: Path, plans: dict) -> dict:
    by_name = {(p["name"], p["option"]): i for i, p in plans.items()}
    rates: dict = defaultdict(dict)
    for sheet, regional in ((0, True), (1, False)):
        for r in bd._fedvip_rates(path, sheet, regional):
            i = by_name.get((r["plan"], r["option"]))
            if i is None:
                raise ValueError(f"{path.name}: rate row for unknown plan {r['plan']!r} - {r['option']!r}")
            reg = r["region"] if regional else "all"
            rates[i][reg] = {k: {"biweekly_active": r["biweekly"][k], "monthly_retiree": r["monthly"][k]}
                             for k in ("self", "self_plus_one", "family")}
    return dict(rates)


# --------------------------------------------------------------------------- geography

def scan_zip_file(path: Path):
    """-> (zip5 -> state label, {(brochure, zip3): Counter(region)}, {zip5: {brochure: region}}, #conflicts)."""
    it = iter(bd.sheet_rows(path))
    bd.expect_header(path, next(it), bd.FEDVIP_ZIP_COLS)
    z5_state: dict = {}
    reg5: dict = defaultdict(dict)
    opt_reg: dict = defaultdict(set)
    for r in it:
        if not r or not r[0] or r[5] in (None, ""):
            continue
        broch, region, state = bd.clean(r[1]), bd.clean(r[3]), bd.clean(r[4])
        z = str(r[5]).strip().zfill(5)
        if z5_state.setdefault(z, state) != state:
            raise ValueError(f"{path.name}: ZIP {z} maps to two states")
        reg5[z].setdefault(broch, region)
        opt_reg[(broch, z)].add(region)
    reg3: dict = defaultdict(Counter)
    for z, d in reg5.items():
        for b, reg in d.items():
            reg3[(b, z[:3])][reg] += 1
    return z5_state, reg3, reg5, sum(1 for v in opt_reg.values() if len(v) > 1)


def build_geo(path: Path, plans: dict):
    z5_state, reg3, reg5, conflicts = scan_zip_file(path)
    brochure_plans: dict = defaultdict(list)
    for i, p in plans.items():
        brochure_plans[p["brochure"]].append(i)
    z3: dict = {}
    mixed_z3 = set()
    for (b, z), cnt in sorted(reg3.items()):
        e = z3.setdefault(z, {"regions": {}})
        e["regions"][b] = cnt.most_common(1)[0][0]
        if len(cnt) > 1:
            mixed_z3.add(z)
            e.setdefault("mixed", []).append(b)
    zip5_regions = {z: d for z, d in sorted(reg5.items()) if z[:3] in mixed_z3}
    states3: dict = defaultdict(set)
    for z, s in z5_state.items():
        if s != NO_STATE:
            states3[z[:3]].add(STATE_ABBR[s])
    multi = {z for z, s in states3.items() if len(s) > 1}
    zip5_states = {z: STATE_ABBR[s] for z, s in sorted(z5_state.items())
                   if z[:3] in multi and s != NO_STATE}
    unmapped = sorted(z for z, s in z5_state.items() if s == NO_STATE)
    geo = {"zip3": z3, "brochure_plans": dict(brochure_plans), "zip5_regions": zip5_regions}
    return geo, {z: sorted(s) for z, s in sorted(states3.items())}, zip5_states, unmapped, conflicts, len(z5_state)


def validate_regions(path: Path, plans: dict, geo: dict) -> tuple[list[str], dict, int]:
    """Cross-check OPM's dental rating chart (rows with explicit ZIP3s) against the zip file.

    Returns (problems, {brochure: region of the chart's 'International' row}, #cells compared).
    """
    hdr, rows = bd.table(path, marker="State")
    heads = [bd.clean(h) for h in hdr]
    col_b = {}
    for ci, h in enumerate(heads[2:], 2):
        for p in plans.values():
            if p["type"] == "dental" and _nk(h).startswith(_nk(p["name"])):
                col_b[ci] = p["brochure"]
    problems = []
    intl: dict = {}
    compared = 0
    for r in rows:
        if r[0] and bd.norm(r[0]) == "international":
            intl = {b: bd.clean(r[ci]) for ci, b in col_b.items() if bd.norm(r[ci]) != "n/a"}
            continue
        spec = str(r[1] if r[1] is not None else "")
        if not r[0] or not re.fullmatch(r"[0-9,\- ]+", spec):
            continue
        z3s = []
        for part in spec.split(","):
            a, _, b = part.strip().partition("-")
            z3s += [f"{n:03d}" for n in range(int(a), int(b or a) + 1)]
        for ci, b in col_b.items():
            want = bd.clean(r[ci])
            if want.lower() == "n/a":
                continue
            for z in z3s:
                e = geo["zip3"].get(z)
                got = e["regions"].get(b) if e else None
                if got is not None and b not in e.get("mixed", []):
                    compared += 1
                    if got != want:
                        problems.append(f"chart {r[0]} {z} {b}: chart region {want} vs zip file {got}")
    return problems, intl, compared


# --------------------------------------------------------------------------- build

def build_year(year: int, paths: dict, warnings: list[str]) -> dict:
    plans = parse_plans(paths[f"FEDVIP_{year}_PLAN_KEY"])
    rates = parse_rates(paths[f"FEDVIP_{year}_RATES"], plans)
    ben_path = paths[f"FEDVIP_{year}_BENEFITS"]
    by_name = {(p["name"], p["option"]): i for i, p in plans.items()}
    benefits: dict = {}
    raw_cols: dict = {}
    for sheet, typ in ((0, "dental"), (1, "vision")):
        cells, cols, tiers = parse_benefits(ben_path, sheet, typ)
        raw_cols[typ] = cols
        for key, row in cells.items():
            i = by_name.get(key)
            if i is None:
                raise ValueError(f"{ben_path.name}: benefits for unknown plan {key}")
            benefits[i] = row
            plans[i]["network_tiers"] = tiers[key]
    for i in plans:
        if i not in benefits:
            warnings.append(f"{year}: plan {i} has no benefits row")
        if i not in rates:
            warnings.append(f"{year}: plan {i} has no rates row")
    for i, regs in rates.items():
        for reg, enr in regs.items():
            for k, v in enr.items():
                b, m = v["biweekly_active"], v["monthly_retiree"]
                if b is None or m is None:
                    warnings.append(f"{year}: {i} region {reg} {k}: missing premium")
                elif abs(m * 12 - b * 26) > 0.01 * b * 26:
                    warnings.append(f"{year}: {i} region {reg} {k}: monthly x12 vs biweekly x26 differ by more than 1%")
    geo, states3, zip5_states, unmapped, conflicts, nzip = build_geo(paths[f"FEDVIP_{year}_ZIPCODES"], plans)
    if conflicts:
        warnings.append(f"{year}: {conflicts} (brochure, ZIP5) pairs list High and Standard in different regions")
    problems, intl, compared = validate_regions(paths[f"FEDVIP_{year}_RATING_REGIONS"], plans, geo)
    warnings += [f"{year}: {p}" for p in problems]
    geo["international_region"] = intl
    chart_checks = compared
    zip_regions = defaultdict(set)
    for e in geo["zip3"].values():
        for b, reg in e["regions"].items():
            zip_regions[b].add(reg)
    for i, regs in rates.items():
        extra = set(regs) - zip_regions[plans[i]["brochure"]] - {"all"}
        for reg in sorted(extra):
            want = intl.get(plans[i]["brochure"])
            if reg == "0" and want in regs and regs["0"] == regs[want]:
                continue  # region 0 = the chart's International rating, priced like that region
            warnings.append(f"{year}: {i} has premium rows for region {reg} that no ZIP maps to")
    return {"plans": plans, "rates": rates, "benefits": benefits, "geo": geo,
            "_states3": states3, "_zip5_states": zip5_states, "_unmapped": unmapped,
            "_raw_cols": raw_cols, "_nzip": nzip, "_chart_checks": chart_checks}


def changes(y27: dict, y26: dict) -> dict:
    out = {}
    for typ in ("dental", "vision"):
        a = {i for i, p in y27["plans"].items() if p["type"] == typ}
        b = {i for i, p in y26["plans"].items() if p["type"] == typ}
        sa = {}
        for i in sorted(a & b):
            new, old = set(y27["plans"][i]["service_areas"]), set(y26["plans"][i]["service_areas"])
            if new != old:
                sa[i] = {"added": sorted(new - old), "removed": sorted(old - new)}
        out[typ] = {"matched": len(a & b), "new_in_2027": sorted(a - b),
                    "ended_after_2026": sorted(b - a), "service_area_changes": sa}
    return out


NOTES = {
    "plan_id": "<brochure>-<option>, e.g. 02AP-01-High; brochure numbers are identical in 2026 and 2027, so they join the years.",
    "rates": "rates[plan][region][self|self_plus_one|family] = {biweekly_active, monthly_retiree}; vision plans use region 'all'. Region '0' (some nationwide dental carriers) is OPM's International rating: it equals the region listed in geo.international_region[brochure] and no ZIP maps to it. Region ids are per brochure (carrier) and not comparable across carriers.",
    "benefits": "benefits[plan][rowkey] = {text (OPM wording), value?, unit? (usd|pct|months|unlimited), approx?}. Unprefixed keys are In-Network 1; in2_ / oon_ prefixes are In-Network 2 / Out-of-Network. meta.board lists sections and rows (rows with source 'rates' are premiums read from rates). Class coinsurance value is the member's share.",
    "geo": "years[y].geo.zip3[zip3].regions[brochure] = rating region. Eligible plans = geo.brochure_plans[brochure] for every brochure present; a brochure absent from a ZIP3 is not offered there. 'mixed' lists brochures whose region differs by ZIP5 inside that ZIP3 (use geo.zip5_regions[zip5]).",
    "zip_precision": "OPM publishes eligibility and region per ZIP5, but within every ZIP3 each plan is offered in all of its ZIP5s or none, so lookups are exact at ZIP3 plus the zip5_regions overrides. ZIP5 -> state: zip3_to_states, with zip5_state_exceptions for ZIP3s spanning several states. ZIPs OPM labels 'No State Mapping Found' carry no state. This table lists only ZIPs present in OPM's file, so an unknown ZIP5 is not validated.",
    "limits": "OPM's public benefits file is a flat summary: no waiting periods for preventive/basic/major, no network type (PPO/HMO/indemnity), no vision dollar allowances, and no contact-lens detail beyond the 'Additional Features' text.",
}


def main() -> None:
    paths = {n: fetch_opm.DEFAULT_DEST / u.rsplit("/", 1)[1] for n, u in fetch_opm.FILES.items()
             if n.startswith("FEDVIP_")}
    missing = [str(v) for v in paths.values() if not v.exists()]
    if missing:
        raise SystemExit(f"missing raw OPM files (run pipeline/fetch_opm.py): {missing}")
    warnings: list[str] = []
    built = {y: build_year(y, paths, warnings) for y in YEARS}
    if built[2027]["_states3"] != built[2026]["_states3"]:
        warnings.append("ZIP3 -> state sets differ between the 2026 and 2027 files; 2027 used")
    b27 = built[2027]
    doc = {
        "meta": {
            "sources": {n: {"url": u, "published": bd.published_from_filename(u.rsplit("/", 1)[1])}
                        for n, u in fetch_opm.FILES.items() if n.startswith("FEDVIP_")},
            "board": board(), "raw_columns": b27["_raw_cols"], "notes": NOTES, "warnings": warnings,
        },
        "years": {str(y): {k: v for k, v in b.items() if not k.startswith("_")} for y, b in built.items()},
        "changes": changes(b27, built[2026]),
        "zip3_to_states": b27["_states3"],
        "zip5_state_exceptions": b27["_zip5_states"],
    }
    bd.write_json("fedvip.json", doc)
    print(f"  chart cross-check compared {b27['_chart_checks']} cells (2027)")
    print(f"  {b27['_nzip']} ZIP5s in 2027 file; {len(b27['_unmapped'])} without state; {len(warnings)} warnings")
    for w in warnings[:25]:
        print("  warning:", w)


if __name__ == "__main__":
    main()
