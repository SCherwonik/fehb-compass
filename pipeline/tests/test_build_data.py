import json
import sys
from pathlib import Path

import openpyxl
import pytest

PIPELINE = Path(__file__).resolve().parents[1]
ROOT = PIPELINE.parent
sys.path.insert(0, str(PIPELINE))

import build_data  # noqa: E402

DATA = ROOT / "data"
RAW = PIPELINE / "raw"


def test_parse_usd():
    assert build_data.parse_money_or_pct("$30") == {"value": 30.0, "kind": "usd", "raw": "$30"}


def test_parse_usd_with_commas_and_words():
    r = build_data.parse_money_or_pct("$1,500 Copayment")
    assert r["kind"] == "usd" and r["value"] == 1500.0


def test_parse_pct():
    r = build_data.parse_money_or_pct("15%")
    assert r["kind"] == "pct" and r["value"] == 15.0 and r["raw"] == "15%"


def test_parse_pct_with_words():
    r = build_data.parse_money_or_pct("15% Coinsurance")
    assert r["kind"] == "pct" and r["value"] == 15.0


def test_parse_text():
    r = build_data.parse_money_or_pct("Nothing")
    assert r["kind"] == "text" and r["value"] is None and r["raw"] == "Nothing"


def test_parse_none():
    r = build_data.parse_money_or_pct(None)
    assert r["kind"] == "text" and r["value"] is None and r["raw"] == ""


def test_parse_number_cell():
    r = build_data.parse_money_or_pct(2000)
    assert r["kind"] == "usd" and r["value"] == 2000.0


def test_published_date_from_filename():
    assert build_data.published_from_filename("2027-fehb-rates_092926.xlsx") == "2026-09-29"
    assert build_data.published_from_filename("2026-fehb-plan-key-11202025.xlsx") == "2025-11-20"


def test_network_family():
    nf = build_data.network_family
    assert nf("Aetna Open Access", "Aetna Open Access") == "Aetna"
    assert nf("Blue Cross and Blue Shield", "Blue Cross and Blue Shield Service Benefit Plan Standard Option") == "Blue Cross"
    assert nf("Anthem Blue Cross Select HMO", "Anthem Blue Cross - Select HMO") == "Blue Cross"
    assert nf("UnitedHealthcare Insurance Company, Inc. (Choice Open Access)", "UnitedHealthcare Insurance Company, Inc.") == "UnitedHealthcare"
    assert nf("Cigna HealthCare", "Cigna") == "Cigna"
    assert nf("Kaiser Permanente - Colorado", "Kaiser Permanente - Colorado") == "Other"


# ---- tests against generated data/ and raw files ----

needs_data = pytest.mark.skipif(not (DATA / "plans.json").exists(), reason="run pipeline/build_data.py first")


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


@needs_data
def test_plan_shape():
    plans = load("plans.json")
    assert plans
    for p in plans:
        for k in ("code", "name", "year", "type", "network_family", "hsa", "hra", "nationwide"):
            assert k in p
        assert p["type"] in ("FFS", "HMO", "HDHP")
        assert isinstance(p["hsa"], bool) and isinstance(p["hra"], bool) and isinstance(p["nationwide"], bool)
    assert {p["year"] for p in plans} == {2026, 2027}
    for y in (2026, 2027):
        codes = [p["code"] for p in plans if p["year"] == y]
        assert len(codes) == len(set(codes))
    assert any(p["hsa"] for p in plans) and any(p["hra"] for p in plans)
    assert any(p["nationwide"] for p in plans)


def _rates_file_codes_2027():
    path = next(RAW.glob("2027-fehb-rates_*.xlsx"), None)
    if path is None:
        pytest.skip("raw files not downloaded")
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    codes = set()
    for r in list(wb.worksheets[0].iter_rows(values_only=True))[1:]:
        if r[0] is not None:
            codes.add(f"{r[0]}{r[1]}")
    return codes, wb


@needs_data
def test_every_2027_plan_in_rates_file_has_all_three_enrollment_types():
    file_codes, _ = _rates_file_codes_2027()
    plans = [p for p in load("plans.json") if p["year"] == 2027]
    rates = load("rates.json")["2027"]
    checked = 0
    for p in plans:
        # plan is "in the rates file" when its Self enrollment code is in that file
        if p["code"] not in file_codes:
            continue
        checked += 1
        r = rates[p["code"]]
        for t in ("self", "self_plus_one", "family"):
            assert r[t]["biweekly_active"] > 0, (p["code"], t)
            assert r[t]["monthly_retiree"] > 0, (p["code"], t)
    assert checked == len(plans) > 100


@needs_data
def test_rates_match_opm_rates_file():
    path = next(RAW.glob("2027-fehb-rates_*.xlsx"), None)
    if path is None:
        pytest.skip("raw files not downloaded")
    plans = {p["code"]: p for p in load("plans.json") if p["year"] == 2027}
    by_stem = {}
    for p in plans.values():
        by_stem[(p["plan_code"], p["option_group"])] = p["code"]
    rates = load("rates.json")["2027"]
    typ = {1: "self", 2: "family", 3: "self_plus_one"}
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    n = 0
    for r in list(wb.worksheets[0].iter_rows(values_only=True))[1:]:
        code = f"{r[0]}{r[1]}"
        base = int(r[1])
        group = 0 if base <= 3 else 1
        code_self = by_stem[(r[0], group)]
        t = typ[(base - 1) % 3 + 1]
        if r[2] == "NP Active" and r[5] == "Biweekly":
            assert rates[code_self][t]["biweekly_active"] == pytest.approx(float(r[6])), code
            n += 1
        if r[2] == "Annuitant" and r[5] == "Monthly":
            assert rates[code_self][t]["monthly_retiree"] == pytest.approx(float(r[6])), code
            n += 1
    assert n > 600


@needs_data
def test_benefits_shape():
    b = load("benefits.json")
    assert set(b) == {"2026", "2027"}
    plans27 = {p["code"] for p in load("plans.json") if p["year"] == 2027}
    assert plans27 <= set(b["2027"])
    sample = next(iter(b["2027"].values()))
    for k in ("deductible", "oop_max", "coinsurance", "copays", "raw"):
        assert k in sample
    nums = [v["deductible"]["self"] for v in b["2027"].values() if v["deductible"]["self"] is not None]
    assert len(nums) > 100


@needs_data
def test_service_area_and_meta():
    sa = load("service_area.json")
    plans27 = [p for p in load("plans.json") if p["year"] == 2027]
    for p in plans27:
        assert p["code"] in sa
        e = sa[p["code"]]
        assert "states" in e and "zips" in e
        if not p["nationwide"]:
            assert e["states"], p["code"]
    meta = load("meta.json")
    assert len(meta["files"]) == 20
    for name, f in meta["files"].items():
        assert f["url"].startswith("https://www.opm.gov/")
        assert len(f["published"]) == 10


@needs_data
def test_dental_vision_shape():
    dv = load("dental_vision.json")
    for y in ("2026", "2027"):
        assert dv[y]["dental"]["rates"] and dv[y]["vision"]["rates"]
        assert dv[y]["dental"]["plans"] and dv[y]["vision"]["plans"]


@needs_data
def test_plan_names_unique_per_year():
    plans = load("plans.json")
    for y in (2026, 2027):
        names = [p["name"] for p in plans if p["year"] == y]
        assert len(names) == len(set(names))


@needs_data
def test_no_deductible_is_zero():
    b = load("benefits.json")["2027"]
    # EP1 (Aetna CDHP) has a $1,000 deductible; a plan with "None" deductible must be 0.0
    assert b["EP1"]["deductible"]["self"] == 1000.0
    assert any(v["deductible"]["self"] == 0.0 for v in b.values())
