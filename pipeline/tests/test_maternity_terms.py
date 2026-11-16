"""Maternity terms: build_data.maternity_term (OPM's two maternity rows), pipeline/maternity_terms.json (the
brochure-reviewed terms) and their application to data/benefits.json."""
import json
import re
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
ROOT = PIPELINE.parent
sys.path.insert(0, str(PIPELINE))

import build_data  # noqa: E402

DATA = ROOT / "data"
TXT = PIPELINE / "raw" / "brochures_txt" / "2027"
SPEC = json.loads((PIPELINE / "maternity_terms.json").read_text(encoding="utf-8"))
needs_data = pytest.mark.skipif(not (DATA / "benefits.json").exists(), reason="run pipeline/build_data.py first")

M, S = build_data.MATERNITY_ROW, build_data.BIRTH_STAY_ROW


def entry(m, s):
    return {"raw": {M: m, S: s}}


def ws(s):
    return re.sub(r"\s+", " ", s).strip()


def page_text(brochure, page):
    parts = re.split(r"=== PAGE (\d+) ===\n?", (TXT / f"{brochure}.txt").read_text(encoding="utf-8"))
    return next((ws(parts[i + 1]) for i in range(1, len(parts), 2) if int(parts[i]) == page), "")


# --------------------------------------------------------------------------- OPM rows -> a suggested term

def test_both_rows_nothing_is_zero_with_the_deductible_wording():
    t = build_data.maternity_term(entry("Member Pays Nothing", "Member Pays Nothing"))
    assert (t["priced"], t["kind"], t["value"], t["deductible"], t["per"]) == (True, "zero", 0.0, None, "pregnancy")
    t = build_data.maternity_term(entry("Member Pays Nothing - (After deductible)", "Member Pays Nothing - (After deductible)"))
    assert t["deductible"] is True
    t = build_data.maternity_term(entry("Member Pays Nothing - No Deductible", "Member Pays Nothing - No Deductible"))
    assert t["deductible"] is False


def test_one_flat_stay_copay_is_usd_per_admission_but_a_per_day_copay_is_not_priced():
    t = build_data.maternity_term(entry("Member Pays Nothing", "$350 Copayment - per admit"))
    assert (t["kind"], t["value"], t["per"], t["deductible"]) == ("usd", 350.0, "admission", None)
    t = build_data.maternity_term(entry("Member Pays Nothing", "$900 Copayment - After deductible"))
    assert (t["value"], t["deductible"]) == (900.0, True)
    t = build_data.maternity_term(entry("Member Pays Nothing", "$250 Copayment - $250 per day up to a maximum of $1000 per admission"))
    assert t["priced"] is False and "per-day" in t["reason"]


def test_same_plain_coinsurance_on_both_rows_is_pct_and_a_split_is_not_priced():
    t = build_data.maternity_term(entry("15% Coinsurance - after deductible", "15% Coinsurance - after deductible"))
    assert (t["kind"], t["value"], t["deductible"]) == ("pct", 15.0, True)
    t = build_data.maternity_term(entry("Member Pays Nothing", "20% Coinsurance - of our Plan Allowance"))
    assert t["priced"] is False and "splits" in t["reason"]
    t = build_data.maternity_term(entry("15% Coinsurance", "Member Pays Nothing"))
    assert t["priced"] is False
    t = build_data.maternity_term(entry("Member Pays Nothing - $20 Copay per visit for postpartum care visits", "Member Pays Nothing"))
    assert t["priced"] is False and "visit" in t["reason"]


# --------------------------------------------------------------------------- reviewed entries

def _spec(tmp_path, terms):
    p = tmp_path / "mt.json"
    p.write_text(json.dumps({"terms": terms}), encoding="utf-8")
    return p


REVIEWED = {"year": 2027, "plan_code": "X1", "sheet": {"maternity": "Member Pays Nothing", "stay": "Member Pays Nothing"},
            "term": {"kind": "usd", "value": 250, "deductible": False, "per": "admission"},
            "brochure": "73-000", "page": 9, "quote": "q", "reason": "r"}


def test_apply_maternity_terms_prices_only_reviewed_plans(tmp_path):
    b = {"2027": {"X1": entry("Member Pays Nothing", "Member Pays Nothing"), "X2": entry("Member Pays Nothing", "Member Pays Nothing")},
         "2026": {"X1": entry("Member Pays Nothing", "Member Pays Nothing")}}
    n, priced = build_data.apply_maternity_terms(b, _spec(tmp_path, [REVIEWED]))
    assert (n, priced) == (1, 1)
    x1 = b["2027"]["X1"]["maternity"]
    assert x1 == {"priced": True, "kind": "usd", "value": 250.0, "deductible": False, "per": "admission", "source": "brochure",
                  "maternity": "Member Pays Nothing", "stay": "Member Pays Nothing",
                  "brochure": "73-000", "page": 9, "quote": "q", "reason": "r"}
    # a plain OPM term without a review is only a suggestion
    for t in (b["2027"]["X2"]["maternity"], b["2026"]["X1"]["maternity"]):
        assert t["priced"] is False and "not checked" in t["reason"]
        assert t["suggested"] == {"kind": "zero", "value": 0.0, "deductible": None, "per": "pregnancy"}


def test_apply_maternity_terms_unpriced_entry_and_build_stops(tmp_path):
    b = {"2027": {"X1": entry("Member Pays Nothing", "Member Pays Nothing")}}
    build_data.apply_maternity_terms(b, _spec(tmp_path, [{**REVIEWED, "term": None, "unpriced": "why"}]))
    assert b["2027"]["X1"]["maternity"]["priced"] is False and b["2027"]["X1"]["maternity"]["reason"] == "why"
    with pytest.raises(ValueError, match="X1 maternity cells changed"):
        build_data.apply_maternity_terms(b, _spec(tmp_path, [{**REVIEWED, "sheet": {"maternity": "x", "stay": "y"}}]))
    with pytest.raises(ValueError, match="Z9"):
        build_data.apply_maternity_terms(b, _spec(tmp_path, [{**REVIEWED, "plan_code": "Z9"}]))
    with pytest.raises(ValueError, match="bad term"):
        build_data.apply_maternity_terms(b, _spec(tmp_path, [{**REVIEWED, "term": {**REVIEWED["term"], "per": "day"}}]))


def test_tracked_maternity_terms_file_is_complete_and_quotes_are_verbatim():
    assert SPEC["about"] and SPEC["terms"]
    codes = [t["plan_code"] for t in SPEC["terms"]]
    assert len(codes) == len(set(codes)), "one entry per plan"
    for t in SPEC["terms"]:
        code = t["plan_code"]
        for k in ("year", "plan_code", "sheet", "term", "brochure", "page", "quote", "reason"):
            assert k in t, (code, k)
        assert t["year"] == 2027 and isinstance(t["page"], int) and t["quote"].strip(), code
        assert set(t["sheet"]) == {"maternity", "stay"}, code
        if t["term"] is None:
            assert t["unpriced"].strip(), code
        else:
            assert t["term"]["kind"] in ("zero", "usd", "pct") and t["term"]["per"] in ("pregnancy", "delivery", "admission"), code
            assert t["term"]["deductible"] in (True, False, None), code
        f = TXT / f"{t['brochure']}.txt"
        if f.exists():  # the brochure texts are git-ignored: checked wherever they were downloaded
            for q in [t] + t.get("also", []):
                assert ws(q["quote"]) in page_text(t["brochure"], q["page"]), (code, q["page"], q["quote"])


@needs_data
def test_benefits_json_carries_the_reviewed_maternity_terms():
    b = json.loads((DATA / "benefits.json").read_text(encoding="utf-8"))
    brochures = json.loads((DATA / "brochures.json").read_text(encoding="utf-8"))["2027"]
    for t in SPEC["terms"]:
        m = b["2027"][t["plan_code"]]["maternity"]
        assert m["source"] == "brochure" and m["priced"] == (t["term"] is not None), t["plan_code"]
        assert t["plan_code"] in brochures[t["brochure"]]["plan_codes"], (t["plan_code"], t["brochure"])
    priced = {c for c, e in b["2027"].items() if e["maternity"]["priced"]}
    assert priced == {t["plan_code"] for t in SPEC["terms"] if t["term"] is not None}
    assert len(priced) == 42 and len(b["2027"]) == 118
    assert b["2027"]["131"]["maternity"]["value"] == 3000.0 and b["2027"]["131"]["maternity"]["per"] == "pregnancy"
    assert not any(e["maternity"]["priced"] for e in b["2026"].values())
