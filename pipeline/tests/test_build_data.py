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
    assert nf("Aetna Open Access") == "Aetna"
    assert nf("Blue Cross and Blue Shield") == "Blue Cross"
    assert nf("Anthem Blue Cross Select HMO") == "Blue Cross"
    assert nf("UnitedHealthcare Insurance Company, Inc. (Choice Open Access)") == "UnitedHealthcare"
    assert nf("Cigna HealthCare") == "Cigna"
    assert nf("Kaiser Permanente - Colorado") == "Kaiser Permanente"
    assert nf("Kaiser Permanente Washington Options Federal") == "Kaiser Permanente"
    assert nf("GEHA") == nf("GEHA Indemnity Benefit Plan") == "GEHA"
    assert nf("Baylor Scott and White Health Plan") == "Baylor Scott & White"
    assert nf("Medical Mutual of Ohio (Northern)") == "Medical Mutual of Ohio"
    assert nf("UHC Choice Plus") == "UnitedHealthcare"
    assert nf("Fuhcia Health Plan") != "UnitedHealthcare"  # "uhc" inside a word is not UHC


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
    from fetch_opm import FILES
    assert set(FILES) <= set(meta["files"]), sorted(set(FILES) - set(meta["files"]))
    assert isinstance(meta["warnings"], list) and all(isinstance(w, str) for w in meta["warnings"])
    for name, f in meta["files"].items():
        assert f["url"].startswith("https://www.opm.gov/")
        assert len(f["published"]) == 10


@needs_data
def test_dental_vision_shape():
    dv = load("dental_vision.json")
    expected = {
        "dental": {"plans": list, "rates": list, "benefits": list, "rating_regions": list, "zip3_coverage": dict},
        "vision": {"plans": list, "rates": list, "benefits": list},
    }
    for y in ("2026", "2027"):
        for kind, keys in expected.items():
            assert set(dv[y][kind]) >= set(keys), (y, kind)
            for k, typ in keys.items():
                assert isinstance(dv[y][kind][k], typ) and len(dv[y][kind][k]) > 0, (y, kind, k)
            assert {"name", "option", "service_area"} <= set(dv[y][kind]["plans"][0])
            r0 = dv[y][kind]["rates"][0]
            assert {"plan", "option", "region", "biweekly", "monthly"} <= set(r0)
            assert set(r0["biweekly"]) == {"self", "self_plus_one", "family"}
            assert all(isinstance(v, (int, float)) for v in r0["monthly"].values())
            b0 = dv[y][kind]["benefits"][0]
            assert isinstance(b0["fields"], dict) and b0["fields"]


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


@needs_data
def test_network_family_is_informative():
    plans = [p for p in load("plans.json") if p["year"] == 2027]
    fam = {}
    for p in plans:
        fam.setdefault(p["network_family"], []).append(p["code"])
    other = len(fam.get("Other", []))
    assert other / len(plans) < 0.35, (other, len(plans))
    for f in ("Aetna", "Blue Cross", "UnitedHealthcare", "Kaiser Permanente", "GEHA"):
        assert f in fam, f
    # every family value (other than Other) is shared by 2+ plans; Other = singleton carriers
    assert all(len(v) > 1 for k, v in fam.items() if k != "Other")
    assert all(p["network_family"] for p in plans)


def _hdr_cases():
    b = build_data
    return [
        ("plan_key", b.PLAN_KEY_COLS), ("payroll", b.PAYROLL_COLS),
        ("service_area", b.SERVICE_AREA_COLS), ("benefits", b.BENEFITS_COLS),
        ("fedvip_key", b.FEDVIP_KEY_COLS), ("fedvip_benefits", b.FEDVIP_BENEFITS_COLS),
        ("fedvip_rates", b.FEDVIP_RATE_COLS), ("rating_regions", b.RATING_REGION_COLS),
        ("fedvip_zip", b.FEDVIP_ZIP_COLS),
    ]


@pytest.mark.parametrize("name,cols", _hdr_cases())
def test_header_check_accepts_expected_and_rejects_swapped(name, cols):
    p = Path(f"{name}.xlsx")
    good = [c or "" for c in cols]
    build_data.expect_header(p, good, cols)  # no error
    idx = [i for i, c in enumerate(cols) if c]
    mid = len(idx) // 2
    swaps = [(idx[0], idx[-1])]  # first <-> last
    if len(idx) >= 3:
        swaps.append((idx[mid - 1], idx[mid]))  # adjacent middle columns
        swaps.append((idx[mid], idx[-1]))  # middle <-> last
    for a, b in swaps:
        if cols[a] == cols[b]:
            continue  # identical labels: a swap is undetectable by design
        bad = list(good)
        bad[a], bad[b] = bad[b], bad[a]  # reordered columns
        with pytest.raises(ValueError, match=rf"{name}\.xlsx: column"):
            build_data.expect_header(p, bad, cols)


def test_loader_raises_on_reordered_file(tmp_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Gov_Pays", "Enrl_Code", "Emp_Pays", "SE_Pays", "TCC_Pays", "MGov_Pays", "MEmp_Pays"])
    ws.append([1, "AB1", 2, 3, 4, 5, 6])
    f = tmp_path / "payroll.xlsx"
    wb.save(f)
    hdr, _ = build_data.table(f)
    with pytest.raises(ValueError, match="payroll.xlsx: column 1"):
        build_data.expect_header(f, hdr, build_data.PAYROLL_COLS)


# ---- error messages and year handling ----

def test_group_unknown_enrollment_type_names_file_plan_and_column():
    rows = [["Carrier", "Opt", "AB", "Name", "AB1", "Bogus", "PPO", "Traditional"]]
    with pytest.raises(ValueError, match=r"plan_key_2027\.xlsx.*'AB'.*'Bogus'.*column 5"):
        build_data._group(rows, "plan_key_2027.xlsx")


def test_group_missing_self_enrollment_is_clear_error():
    rows = [["Carrier", "Opt", "AB", "Name", "AB2", "Self Plus One", "PPO", "Traditional"]]
    with pytest.raises(ValueError, match=r"plan_key\.xlsx.*'AB'.*no 'Self' enrollment code"):
        build_data._group(rows, "plan_key.xlsx")


def test_payroll_amount_blank_and_invalid_name_file_code_column():
    row = ["AB1", None, None, None, None, None, "x"]
    for col, label in ((2, "Emp_Pays"), (6, "MEmp_Pays")):
        with pytest.raises(ValueError, match=rf"payroll\.xlsx.*'AB1'.*column {col} \({label}\)"):
            build_data._payroll_amount(row, col, "payroll.xlsx", "AB1", label)
    assert build_data._payroll_amount(["AB1", 0, "12.5"], 2, "payroll.xlsx", "AB1", "Emp_Pays") == 12.5


def _fake_paths(tmp_path, pay_code_by_year):
    """Minimal FEHB workbooks: one plan whose Self code is A11; payroll lists the given code per year."""
    def book(name, header, rows):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(header)
        for r in rows:
            ws.append(r)
        f = tmp_path / name
        wb.save(f)
        return f
    b = build_data
    paths = {}
    for y in b.YEARS:
        key_rows = [["Acme Health", "Basic", "A1", "Acme Basic", "A11", "Self", "HMO", "Traditional"]]
        pay_rows = [[pay_code_by_year[y], 0, 1.0, 0, 0, 0, 2.0]]
        paths[f"FEHB_{y}_PLAN_KEY"] = book(f"key{y}.xlsx", [c or "" for c in b.PLAN_KEY_COLS], key_rows)
        paths[f"FEHB_{y}_PAYROLL_RATES"] = book(f"pay{y}.xlsx", [c or "" for c in b.PAYROLL_COLS], pay_rows)
        paths[f"FEHB_{y}_BENEFITS"] = paths[f"FEHB_{y}_SERVICE_AREA"] = tmp_path / "unused.xlsx"
    return paths


def test_missing_payroll_code_raises_for_2027_and_warns_for_2026(tmp_path, monkeypatch):
    monkeypatch.setattr(build_data, "load_benefits", lambda p: {})
    monkeypatch.setattr(build_data, "load_service_area", lambda p: {})
    last = build_data.YEARS[-1]
    bad_last = _fake_paths(tmp_path, {y: "ZZZ" for y in build_data.YEARS})
    with pytest.raises(ValueError, match=rf"pay{last}\.xlsx.*'A11'.*not found in payroll"):
        build_data.build_fehb(bad_last)
    ok = _fake_paths(tmp_path, {y: ("A11" if y == last else "ZZZ") for y in build_data.YEARS})
    _plans, rates, _b, _s, warnings = build_data.build_fehb(ok)
    assert rates["2026"]["A11"] == {}
    assert any(w.startswith("2026") and "A11" in w for w in warnings)
    assert "biweekly_active" in rates[str(last)]["A11"]["self"]


@needs_data
def test_2026_plans_have_rates_and_benefits_or_are_warned():
    plans = load("plans.json")
    rates, benefits = load("rates.json")["2026"], load("benefits.json")["2026"]
    warnings = load("meta.json")["warnings"]
    for p in (p for p in plans if p["year"] == 2026):
        c = p["code"]
        warned = any(f"'{c}'" in w for w in warnings)
        assert (rates.get(c) and all("biweekly_active" in v for v in rates[c].values())) or warned, f"2026 {c}: no rates"
        assert c in benefits or warned, f"2026 {c}: no benefits"


@needs_data
def test_new_and_ended_plans_are_handled():
    plans = load("plans.json")
    codes = {y: {p["code"] for p in plans if p["year"] == y} for y in (2026, 2027)}
    rates, benefits = load("rates.json"), load("benefits.json")
    ended, new = codes[2026] - codes[2027], codes[2027] - codes[2026]
    assert ended or new, "expected at least one plan present in only one year"
    for c in ended:  # 2026-only: described in 2026, absent from 2027 outputs
        assert c in rates["2026"] and c not in rates["2027"] and c not in benefits["2027"]
    for c in new:  # 2027-only: rates and benefits present, nothing in 2026
        assert c in rates["2027"] and c in benefits["2027"] and c not in rates["2026"]


def test_fix_mojibake_repairs_known_sequences():
    f = build_data.fix_mojibake
    assert f("Aspergerâ€™s") == "Asperger’s"
    assert f("Retail â€“ 30") == "Retail – 30"
    assert f("X-ray â€¢ Ultrasound") == "X-ray • Ultrasound"
    assert f("plain text") == "plain text"
    assert f("café ’ ok") == "café ’ ok"


def test_clean_repairs_and_normalizes_quotes_and_spacing():
    assert build_data.clean("Delta Dental’s  Federal") == "Delta Dental's Federal"
    assert build_data.clean("Aspergerâ€™s") == "Asperger's"


def test_no_mojibake_in_data_json():
    bad = ("â€", "Ã", "�")

    def walk(o, where):
        if isinstance(o, str):
            assert not any(b in o for b in bad), f"{where}: {o[:80]!r}"
        elif isinstance(o, dict):
            for k, v in o.items():
                walk(k, where)
                walk(v, where)
        elif isinstance(o, list):
            for v in o:
                walk(v, where)

    for p in sorted(DATA.glob("*.json")):
        walk(json.loads(p.read_text(encoding="utf-8")), p.name)


# ---------- hsa/hra derived from the benefits file's "Type of account" ----------

def _plans(year):
    return [p for p in json.loads((DATA / "plans.json").read_text(encoding="utf-8")) if p["year"] == year]


def _ben(year):
    return json.loads((DATA / "benefits.json").read_text(encoding="utf-8"))[str(year)]


def test_account_flags_unit():
    f = build_data.account_flags
    assert f("HDHP", "Health Savings Account", True) == (True, False, None)
    assert f("CDHP", "Health Reimbursement Arrangement", True) == (False, True, None)
    assert f("Traditional", "Not Applicable", True) == (False, False, None)
    hsa, hra, note = f("HDHP", "Not Applicable", True)
    assert (hsa, hra) == (False, False) and "HDHP" in note and "not an HSA" in note
    hsa, hra, note = f("HDHP", "Health Reimbursement Arrangement", True)
    assert (hsa, hra) == (False, True) and "HRA" in note
    assert f("HDHP", None, False)[:2] == (True, False)  # no benefits row: label fallback


def test_plan_401_2026_is_not_an_hsa_plan():
    p = next(p for p in _plans(2026) if p["code"] == "401")
    assert p["type"] == "HDHP" and p["hsa"] is False and p["hra"] is False
    assert "HDHP" in p["type_note"]


def test_flags_match_account_type_for_every_plan():
    for year in (2026, 2027):
        ben = _ben(year)
        for p in _plans(year):
            acct = (ben[p["code"]]["account_type"] or "").lower()
            assert p["hsa"] == ("savings" in acct), (year, p["code"])
            assert p["hra"] == ("reimburs" in acct), (year, p["code"])


def test_hdhp_label_disagreements_are_recorded():
    for year in (2026, 2027):
        ben = _ben(year)
        for p in _plans(year):
            disagrees = p["option_type"].upper() == "HDHP" and not p["hsa"]
            assert ("type_note" in p) == disagrees, (year, p["code"])


# --------------------------------------------------------------------------- I5: brochure overrides

def _entry(**over):
    e = {
        "deductible": {"self": 5500.0, "self_plus_one": 11000.0, "family": 11000.0},
        "copays": {"rx_tier1": {"value": 15.0, "kind": "usd", "raw": "Preferred Generic - $15 Copayment"}},
        "raw": {"Annual deductible (Self)": "$5,500", "Annual deductible (Self Plus One)": "$11,000",
                "Annual deductible (Self & Family)": "$11,000", "Tier 1": "Preferred Generic - $15 Copayment"},
    }
    e.update(over)
    return e


def _spec(tmp_path, overrides):
    p = tmp_path / "ov.json"
    p.write_text(json.dumps({"overrides": overrides}), encoding="utf-8")
    return p


DED = {"year": 2027, "plan_code": "X1", "field": "deductible",
       "raw_fields": ["Annual deductible (Self)", "Annual deductible (Self Plus One)", "Annual deductible (Self & Family)"],
       "sheet": {"self": 5500, "self_plus_one": 11000, "family": 11000},
       "brochure_value": {"self": 4800, "self_plus_one": 9600, "family": 9600},
       "brochure": "73-937", "page": 24, "quote": "q", "reason": "r"}
TIER = {"year": 2027, "plan_code": "X1", "field": "rx_tier1", "raw_fields": ["Tier 1"],
        "sheet": "Preferred Generic - $15 Copayment", "brochure_value": {"kind": "pct", "value": 20, "cap": 400},
        "brochure_text": "20% Coinsurance up to $400", "brochure": "b", "page": 9, "quote": "q2", "reason": "r2"}


def test_apply_benefit_overrides_patches_engine_and_raw_fields_and_keeps_provenance(tmp_path):
    b = {"2027": {"X1": _entry()}}
    n = build_data.apply_benefit_overrides(b, _spec(tmp_path, [DED, TIER]))
    e = b["2027"]["X1"]
    assert n == 2
    assert e["deductible"] == {"self": 4800.0, "self_plus_one": 9600.0, "family": 9600.0}
    assert e["raw"]["Annual deductible (Self)"] == "$4,800"
    assert e["raw"]["Annual deductible (Self & Family)"] == "$9,600"
    assert e["copays"]["rx_tier1"] == {"value": 20.0, "kind": "pct", "raw": "20% Coinsurance up to $400", "cap": 400.0}
    assert e["raw"]["Tier 1"] == "20% Coinsurance up to $400"
    o = e["overrides"]["Annual deductible (Self)"]
    assert o == {"field": "deductible", "sheet": "$5,500", "brochure": "73-937", "page": 24, "quote": "q", "reason": "r"}
    assert e["overrides"]["Tier 1"]["sheet"] == "Preferred Generic - $15 Copayment"


def test_apply_benefit_overrides_stops_when_the_spreadsheet_value_changed(tmp_path):
    b = {"2027": {"X1": _entry(deductible={"self": 5000.0, "self_plus_one": 10000.0, "family": 10000.0})}}
    with pytest.raises(ValueError, match="X1.*deductible"):
        build_data.apply_benefit_overrides(b, _spec(tmp_path, [DED]))
    b = {"2027": {"X1": _entry()}}
    with pytest.raises(ValueError, match="X1.*rx_tier1"):
        build_data.apply_benefit_overrides(b, _spec(tmp_path, [{**TIER, "sheet": "something else"}]))
    with pytest.raises(ValueError, match="Z9"):
        build_data.apply_benefit_overrides(b, _spec(tmp_path, [{**TIER, "plan_code": "Z9"}]))


def test_tracked_overrides_file_is_complete():
    spec = json.loads((PIPELINE / "benefit_overrides.json").read_text(encoding="utf-8"))
    assert spec["overrides"]
    for o in spec["overrides"]:
        for k in ("year", "plan_code", "field", "raw_fields", "sheet", "brochure_value", "brochure", "page", "quote", "reason"):
            assert k in o, (o.get("plan_code"), k)
        assert o["field"] in ("deductible", "oop_max", "out_of_network.deductible") or o["field"].startswith("rx_tier")


OOP_RAW = ["Annual out-of-pocket maximum (Self)", "Annual out-of-pocket maximum (Self Plus One)",
           "Annual out-of-pocket maximum (Self & Family)"]
OOP = {"year": 2027, "plan_code": "X1", "field": "oop_max", "raw_fields": OOP_RAW,
       "sheet": {"self": 7000, "self_plus_one": 14000, "family": 14000},
       "brochure_value": {"self": 3500, "self_plus_one": 7000, "family": 7000},
       "brochure": "73-129", "page": 24, "quote": "q", "reason": "r"}
OON = {"year": 2027, "plan_code": "X1", "field": "out_of_network.deductible", "raw_fields": [],
       "sheet": {"self": 1600, "self_plus_one": 3200, "family": 3200},
       "brochure_value": {"self": 2000, "self_plus_one": 4000, "family": 4000},
       "brochure": "73-828", "page": 35, "quote": "q3", "reason": "r3"}


def _entry_oop(**over):
    e = _entry(oop_max={"self": 7000.0, "self_plus_one": 14000.0, "family": 14000.0},
               out_of_network={"deductible": {"self": 1600.0, "self_plus_one": 3200.0, "family": 3200.0},
                               "oop_max": {"self": 10000.0, "self_plus_one": 20000.0, "family": 20000.0}})
    e["raw"].update({OOP_RAW[0]: "$7,000", OOP_RAW[1]: "$14,000", OOP_RAW[2]: "$14,000"})
    e.update(over)
    return e


def test_apply_benefit_overrides_patches_oop_max(tmp_path):
    b = {"2027": {"X1": _entry_oop()}}
    assert build_data.apply_benefit_overrides(b, _spec(tmp_path, [OOP])) == 1
    e = b["2027"]["X1"]
    assert e["oop_max"] == {"self": 3500.0, "self_plus_one": 7000.0, "family": 7000.0}
    assert e["raw"][OOP_RAW[0]] == "$3,500" and e["raw"][OOP_RAW[2]] == "$7,000"
    assert e["overrides"][OOP_RAW[0]] == {"field": "oop_max", "sheet": "$7,000", "brochure": "73-129",
                                          "page": 24, "quote": "q", "reason": "r"}
    assert e["out_of_network"]["oop_max"]["self"] == 10000.0 and e["deductible"]["self"] == 5500.0


def test_apply_benefit_overrides_patches_out_of_network_deductible_without_raw_fields(tmp_path):
    b = {"2027": {"X1": _entry_oop()}}
    raw_before = dict(b["2027"]["X1"]["raw"])
    assert build_data.apply_benefit_overrides(b, _spec(tmp_path, [OON])) == 1
    e = b["2027"]["X1"]
    assert e["out_of_network"]["deductible"] == {"self": 2000.0, "self_plus_one": 4000.0, "family": 4000.0}
    assert e["out_of_network"]["oop_max"]["self"] == 10000.0 and e["deductible"]["self"] == 5500.0
    assert e["raw"] == raw_before
    assert e["overrides"] == {build_data.OON_DEDUCTIBLE_KEY: {
        "field": "out_of_network.deductible", "sheet": "$1,600", "brochure": "73-828", "page": 35, "quote": "q3", "reason": "r3"}}


def test_apply_benefit_overrides_stops_when_oop_or_out_of_network_sheet_is_stale(tmp_path):
    b = {"2027": {"X1": _entry_oop(oop_max={"self": 6000.0, "self_plus_one": 12000.0, "family": 12000.0})}}
    with pytest.raises(ValueError, match="X1.*oop_max"):
        build_data.apply_benefit_overrides(b, _spec(tmp_path, [OOP]))
    b = {"2027": {"X1": _entry_oop()}}
    with pytest.raises(ValueError, match="X1.*out_of_network.deductible"):
        build_data.apply_benefit_overrides(b, _spec(tmp_path, [{**OON, "sheet": {"self": 1, "self_plus_one": 2, "family": 2}}]))


@needs_data
def test_every_tracked_override_matches_the_built_data():
    """A spreadsheet refresh that reverts a patched value must fail here, not silently ship the stale number."""
    spec = json.loads((PIPELINE / "benefit_overrides.json").read_text(encoding="utf-8"))
    b = load("benefits.json")
    for o in spec["overrides"]:
        e = b[str(o["year"])][o["plan_code"]]
        where = (o["plan_code"], o["field"])
        if o["field"] == "out_of_network.deductible":
            assert e["out_of_network"]["deductible"] == {k: float(v) for k, v in o["brochure_value"].items()}, where
            assert build_data.OON_DEDUCTIBLE_KEY in e["overrides"], where
        elif o["field"] in ("deductible", "oop_max"):
            want = {k: float(v) for k, v in o["brochure_value"].items()}
            assert e[o["field"]] == want, where
            for f in o["raw_fields"]:
                tier = next(k for k, suf in build_data.ENROLL_SUFFIX if f.endswith(suf))
                assert e["raw"][f] == build_data._usd_text(want[tier]), (where, f)
                assert e["overrides"][f]["field"] == o["field"], (where, f)
        else:
            bv = o["brochure_value"]
            c = e["copays"][o["field"]]
            assert c["value"] == float(bv["value"]) and c["kind"] == bv["kind"] and c["raw"] == o["brochure_text"], where
            assert c.get("cap") == (float(bv["cap"]) if bv.get("cap") is not None else None), where
            for f in o["raw_fields"]:
                assert e["raw"][f] == o["brochure_text"], (where, f)


@needs_data
def test_nm1_self_only_oop_max_is_the_brochure_3500():
    assert load("benefits.json")["2027"]["NM1"]["oop_max"]["self"] == 3500.0


@needs_data
def test_benefits_json_carries_the_brochure_values():
    b = load("benefits.json")["2027"]
    yj1 = b["YJ1"]
    assert yj1["deductible"] == {"self": 4800.0, "self_plus_one": 9600.0, "family": 9600.0}
    assert yj1["raw"]["Annual deductible (Self)"] == "$4,800"
    assert yj1["overrides"]["Annual deductible (Self)"]["sheet"] == "$5,500"
    assert b["634"]["copays"]["rx_tier1"]["value"] == 5.0
    assert b["A84"]["copays"]["rx_tier1"]["value"] == 8.0
    assert b["P84"]["copays"]["rx_tier5"] == {"value": 20.0, "kind": "pct",
                                              "raw": "Preferred Generic Specialty - 20% Coinsurance up to $400", "cap": 400.0}
    # channel difference, not an error: the spreadsheet's plan-pharmacy price is kept
    assert b["L11"]["copays"]["rx_tier1"]["value"] == 10.0 and "overrides" not in b["L11"]
    assert b["YJ4"]["deductible"]["self"] == 0.0 and "overrides" not in b["YJ4"]


def test_amount_not_applicable_deductible():
    assert build_data._amount("Not applicable", True, na_is_zero=True) == 0.0
    assert build_data._amount("Not applicable", True) is None  # out of network: no benefit, not a $0 deductible
    assert build_data._amount("Not applicable", False) is None


@needs_data
def test_not_applicable_in_network_deductible_is_zero_and_raw_kept():
    b = load("benefits.json")
    for y, code in (("2027", "891"), ("2027", "DH4"), ("2026", "431")):
        e = b[y][code]
        assert e["deductible"] == {"self": 0.0, "self_plus_one": 0.0, "family": 0.0}, (y, code)
        assert e["raw"]["Annual deductible (Self)"] == "Not applicable"
        assert e["out_of_network"]["deductible"]["self"] is None  # no out-of-network benefit: stays "not listed"


# --------------------------------------------------------------------------- known gaps

GAP = {"year": 2027, "plan_code": "X1", "kind": "facility_deductible", "affects_cost": True,
       "amounts": {"self": 250, "self_plus_one": 500, "family": 500}, "text": "t", "brochure": "73-718", "page": 29,
       "quote": "q", "reason": "r"}


def _gaps(tmp_path, gaps):
    p = tmp_path / "kg.json"
    p.write_text(json.dumps({"gaps": gaps}), encoding="utf-8")
    return p


def _apply_gaps(tmp_path, gaps, b=None):
    b = b if b is not None else {"2027": {"X1": {"deductible": {}}, "X2": {}}}
    n = build_data.apply_known_gaps(b, _gaps(tmp_path, gaps), tmp_path)  # tmp_path has no brochure text: quotes not checked
    return n, b


def test_known_gaps_attach_only_to_the_named_plan(tmp_path):
    n, b = _apply_gaps(tmp_path, [GAP, {**GAP, "kind": "drug_deductible", "text": "t2"}])
    assert n == 2
    assert [g["kind"] for g in b["2027"]["X1"]["known_gaps"]] == ["facility_deductible", "drug_deductible"]
    assert "known_gaps" not in b["2027"]["X2"]
    assert b["2027"]["X1"]["deductible"] == {}
    assert "plan_code" not in b["2027"]["X1"]["known_gaps"][0] and b["2027"]["X1"]["known_gaps"][0]["page"] == 29


def test_known_gap_for_an_unknown_plan_or_year_fails(tmp_path):
    with pytest.raises(ValueError, match="Z9"):
        _apply_gaps(tmp_path, [{**GAP, "plan_code": "Z9"}])
    with pytest.raises(ValueError, match="X1"):
        _apply_gaps(tmp_path, [{**GAP, "year": 2026}])


def test_known_gap_requires_every_key_and_a_consistent_kind(tmp_path):
    for k in ("kind", "affects_cost", "amounts", "text", "brochure", "page", "quote", "reason"):
        with pytest.raises(ValueError, match=k):
            _apply_gaps(tmp_path, [{kk: v for kk, v in GAP.items() if kk != k}])
    with pytest.raises(ValueError, match="kind"):
        _apply_gaps(tmp_path, [{**GAP, "kind": "other"}])
    with pytest.raises(ValueError, match="affects_cost"):
        _apply_gaps(tmp_path, [{**GAP, "kind": "conflict", "affects_cost": True}])
    with pytest.raises(ValueError, match="affects_cost"):
        _apply_gaps(tmp_path, [{**GAP, "affects_cost": False}])
    with pytest.raises(ValueError, match="amounts"):
        _apply_gaps(tmp_path, [{**GAP, "amounts": {"self": 1}}])
    with pytest.raises(ValueError, match="15 words"):
        _apply_gaps(tmp_path, [{**GAP, "quote": " ".join(["w"] * 15)}])


def test_known_gap_quote_must_be_on_the_named_brochure_page(tmp_path):
    d = tmp_path / "2027"
    d.mkdir()
    (d / "73-718.txt").write_text("=== PAGE 1 ===\nnothing\n=== PAGE 29 ===\nthe $250 inpatient\nand outpatient fee\n", encoding="utf-8")
    ok = {**GAP, "quote": "$250 inpatient and outpatient"}
    b = {"2027": {"X1": {}}}
    assert build_data.apply_known_gaps(b, _gaps(tmp_path, [ok]), tmp_path) == 1
    with pytest.raises(ValueError, match="not on page 1"):
        build_data.apply_known_gaps({"2027": {"X1": {}}}, _gaps(tmp_path, [{**ok, "page": 1}]), tmp_path)


def test_tracked_known_gaps_land_on_the_right_plans():
    spec = json.loads((PIPELINE / "known_gaps.json").read_text(encoding="utf-8"))["gaps"]
    by = {}
    for g in spec:
        by.setdefault(g["plan_code"], []).append(g)
    assert {c: sorted(g["kind"] for g in gs) for c, gs in by.items()} == {
        "V31": ["facility_deductible"], "2G4": ["facility_deductible"],
        "B64": ["drug_deductible", "facility_deductible"], "B41": ["conflict"], "B44": ["conflict"]}
    assert all(g["affects_cost"] is (g["kind"] != "conflict") for g in spec)
    benefits = json.loads((ROOT / "data" / "benefits.json").read_text(encoding="utf-8"))["2027"]
    for code, gs in by.items():
        assert [g["kind"] for g in benefits[code]["known_gaps"]] == [g["kind"] for g in gs]
    assert {c for c, e in benefits.items() if e.get("known_gaps")} == set(by)
    for g in spec:  # the quote is on the cited page, when the brochure text is on this machine
        txt = build_data.brochure_page_text(g["year"], g["brochure"], g["page"])
        if txt is not None:
            assert " ".join(g["quote"].split()) in txt, g["plan_code"]
