"""Tests for data/fedvip.json (built by pipeline/build_fedvip.py from the OPM FEDVIP files)."""
import json
import re
import sys
from pathlib import Path

import openpyxl
import pytest

PIPELINE = Path(__file__).resolve().parents[1]
ROOT = PIPELINE.parent
sys.path.insert(0, str(PIPELINE))

import build_fedvip  # noqa: E402

RAW = PIPELINE / "raw"
BEN27 = RAW / "2027-fedvip-benefits_092926.xlsx"
RATES27 = RAW / "2027-fedvip-rates_092926.xlsx"


@pytest.fixture(scope="module")
def doc():
    return json.loads((ROOT / "data" / "fedvip.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def y27(doc):
    return doc["years"]["2027"]


def sheet(path, name):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        return [list(r) for r in wb[name].iter_rows(values_only=True)]
    finally:
        wb.close()


def eligible(doc, year, zip5):
    """Plan ids offered at a ZIP5 and the rating region per brochure (ZIP3 + ZIP5 overrides)."""
    geo = doc["years"][year]["geo"]
    e = geo["zip3"].get(zip5[:3])
    if not e:
        return [], {}
    regions = dict(e["regions"])
    regions.update(geo["zip5_regions"].get(zip5, {}))
    plans = [i for b in regions for i in geo["brochure_plans"][b]]
    return plans, regions


def state_of(doc, zip5):
    if zip5 in doc["zip5_state_exceptions"]:
        return [doc["zip5_state_exceptions"][zip5]]
    return doc["zip3_to_states"].get(zip5[:3], [])


def test_counts_and_shape(doc, y27):
    types = [p["type"] for p in y27["plans"].values()]
    assert types.count("dental") == 21 and types.count("vision") == 10
    assert set(doc["years"]) == {"2027", "2026"}
    for p in y27["plans"].values():
        assert p["carrier"] and p["name"] and p["option"] in ("High", "Standard")
        assert isinstance(p["nationwide"], bool) and p["service_areas"]
    assert doc["meta"]["sources"]["FEDVIP_2027_RATES"]["published"] == "2026-09-29"
    assert doc["meta"]["warnings"] == []


def test_every_2027_plan_has_rates(y27):
    for i in y27["plans"]:
        regs = y27["rates"].get(i)
        assert regs, f"{i} has no rates"
        for reg, enr in regs.items():
            assert set(enr) == {"self", "self_plus_one", "family"}, (i, reg)


def test_premium_conversion_consistent(doc):
    bad, n = [], 0
    for year in doc["years"].values():
        for i, regs in year["rates"].items():
            for reg, enr in regs.items():
                for k, v in enr.items():
                    b, m = v["biweekly_active"], v["monthly_retiree"]
                    if b is None or m is None:
                        bad.append((i, reg, k, "missing"))
                        continue
                    n += 1
                    if abs(m * 12 - b * 26) > 0.01 * b * 26:
                        bad.append((i, reg, k, b, m))
    assert n > 400 and not bad, bad


def test_every_benefit_column_maps_to_exactly_one_section(doc):
    board = doc["meta"]["board"]
    for typ, sheet_name in (("dental", "Dental Benefits"), ("vision", "Vision Benefits")):
        header = sheet(BEN27, sheet_name)[0]
        raw_cols = [str(h).strip() for h in header[4:] if h]
        assert raw_cols == doc["meta"]["raw_columns"][typ]
        for col in raw_cols:
            for net in ("In-Network 1", "In-Network 2", "Out-of-Network"):
                secs = {s["id"] for s in board[typ] for r in s["rows"]
                        if r.get("source") == col and r.get("network") == net}
                assert len(secs) == 1, (typ, col, net, secs)
        keys = [r["key"] for s in board[typ] for r in s["rows"]]
        assert len(keys) == len(set(keys)), "board row keys must be unique"
        ids = [i for i, p in doc["years"]["2027"]["plans"].items() if p["type"] == typ]
        for i in ids:
            cells = doc["years"]["2027"]["benefits"][i]
            for s in board[typ]:
                for r in s["rows"]:
                    if r.get("source") != "rates":
                        assert "text" in cells[r["key"]], (i, r["key"])
            used = {r["key"] for s in board[typ] for r in s["rows"] if r.get("source") != "rates"}
            assert set(cells) == used, (i, set(cells) ^ used)


def test_board_sections_named(doc):
    d = [s["title"] for s in doc["meta"]["board"]["dental"]]
    v = [s["title"] for s in doc["meta"]["board"]["vision"]]
    assert d == ["Cost", "Dental coverage by class", "Annual and lifetime limits",
                 "Waiting periods and orthodontia", "Network and out-of-network"]
    assert v[:5] == ["Cost", "Vision exam", "Lenses", "Frames", "Contacts and additional features"]


@pytest.mark.parametrize("zip5,state", [("22302", "VA"), ("90210", "CA"), ("10001", "NY"), ("99501", "AK")])
def test_zip_lookup(doc, y27, zip5, state):
    plans, regions = eligible(doc, "2027", zip5)
    assert plans, f"no plans for {zip5}"
    nationwide = [i for i, p in y27["plans"].items() if p["nationwide"]]
    assert nationwide and set(nationwide) <= set(plans)
    assert {y27["plans"][i]["type"] for i in plans} == {"dental", "vision"}
    assert state in state_of(doc, zip5)
    for b, reg in regions.items():  # every offered plan has a premium for the ZIP's region
        for i in y27["geo"]["brochure_plans"][b]:
            rates = y27["rates"][i]
            assert reg in rates or "all" in rates, (zip5, i, reg)


def test_regional_plans_follow_geography(doc, y27):
    # Humana is a regional carrier; Triple-S is Puerto Rico only: neither is offered everywhere.
    carriers_va = {y27["plans"][i]["carrier"] for i in eligible(doc, "2027", "22302")[0]}
    carriers_ak = {y27["plans"][i]["carrier"] for i in eligible(doc, "2027", "99501")[0]}
    assert "Triple-S Salud" not in carriers_va | carriers_ak
    assert not {"Humana"} <= carriers_ak


def test_zip3_to_states_shape(doc):
    z = doc["zip3_to_states"]
    assert len(z) > 800 and all(re.fullmatch(r"\d{3}", k) for k in z)
    assert all(re.fullmatch(r"[A-Z]{2,3}", s) for v in z.values() for s in v)
    for k, v in doc["zip5_state_exceptions"].items():
        assert re.fullmatch(r"\d{5}", k) and len(z[k[:3]]) > 1 and v in z[k[:3]]


def test_spot_check_premium_and_annual_max_against_raw(doc, y27):
    rates = sheet(RATES27, "Dental")
    ben = sheet(BEN27, "Dental Benefits")
    header = ben[0]
    col = header.index("Annual Maximum Benefit Per Person")
    for plan_id, name, option, region in (("02AP-01-High", "Aetna Dental", "High", "1"),
                                          ("02AP-10-Standard", "Humana Dental", "Standard", "3")):
        row = next(r for r in rates if r[0] == f"{name} - {option}" and str(r[1]) == region)
        money = lambda c: float(str(c).replace("$", "").replace(",", ""))  # noqa: E731
        got = y27["rates"][plan_id][region]
        assert got["self"]["biweekly_active"] == money(row[2])
        assert got["self_plus_one"]["biweekly_active"] == money(row[3])
        assert got["family"]["biweekly_active"] == money(row[4])
        assert got["self"]["monthly_retiree"] == money(row[5])
        assert got["family"]["monthly_retiree"] == money(row[7])
        braw = next(r for r in ben if r[0] == name and r[2] == option and r[3] == "In-Network 1")
        cell = y27["benefits"][plan_id]["annual_max"]
        assert cell["text"] == str(braw[col]).strip()
        if re.fullmatch(r"[0-9.]+", str(braw[col]).strip()):
            assert cell["value"] == float(braw[col]) and cell["unit"] == "usd"
        oon = next(r for r in ben if r[0] == name and r[2] == option and r[3] == "Out-of-Network")
        assert y27["benefits"][plan_id]["oon_annual_max"]["text"] == str(oon[col]).strip()


def test_spot_check_vision_against_raw(y27):
    rates = sheet(RATES27, "Vision")
    ben = sheet(BEN27, "Vision Benefits")
    row = next(r for r in rates if r[0] == "VSP Vision Care - High")
    pid = "02AP-17-High"
    assert y27["rates"][pid]["all"]["self"]["biweekly_active"] == float(str(row[2]).strip("$"))
    braw = next(r for r in ben if r[0] == "VSP Vision Care" and r[2] == "High" and r[3] == "In-Network 1")
    assert y27["benefits"][pid]["exam"]["text"] == str(braw[4]).strip()
    assert y27["benefits"][pid]["copay"]["text"] == str(braw[7]).strip()


def test_year_matching_and_changes(doc):
    y26, y27 = doc["years"]["2026"], doc["years"]["2027"]
    for typ, c in doc["changes"].items():
        assert c["matched"] > 0
        for i in c["new_in_2027"]:
            assert i in y27["plans"] and i not in y26["plans"]
        for i in c["ended_after_2026"]:
            assert i in y26["plans"] and i not in y27["plans"]
    common = set(y26["plans"]) & set(y27["plans"])
    assert len(common) == 31
    i = "02AP-01-High"
    assert y26["rates"][i]["1"]["self"]["biweekly_active"] != y27["rates"][i]["1"]["self"]["biweekly_active"]


def test_text_is_clean(doc):
    def strings(o):
        if isinstance(o, str):
            yield o
        elif isinstance(o, dict):
            for k, v in o.items():
                yield k
                yield from strings(v)
        elif isinstance(o, list):
            for v in o:
                yield from strings(v)

    for year in doc["years"].values():
        for s in strings([year["plans"], year["benefits"]]):
            assert "�" not in s and "Â" not in s and "â€" not in s, s
            assert "  " not in s and s == s.strip(), repr(s)


def test_parse_cell_rules():
    p = build_fedvip.parse_cell
    assert p("annual_max", "UNLIMITED") == {"text": "UNLIMITED", "unit": "unlimited"}
    assert p("annual_max", "1500") == {"text": "1500", "value": 1500.0, "unit": "usd"}
    assert p("class_c", "60% Coinsurance + Amt. Over Plan Allowance")["value"] == 60.0
    assert p("class_a", "Amt. In Copayment Schedule (Approx 0%) $10")["approx"] is True
    assert p("deductible", "N/A") == {"text": "N/A"}
    assert p("exam", "Every 12 Months $0 Exam, Materials")["value"] == 12.0
    assert build_fedvip.derive("ortho_waiting", "$2000 Per Person No Age Limit")["text"] == "Not stated by OPM"
