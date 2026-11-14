import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
ROOT = PIPELINE.parent
sys.path.insert(0, str(PIPELINE))

import validate_extractions as v  # noqa: E402

EXT = PIPELINE / "raw" / "extractions" / "2027"
TXT = PIPELINE / "raw" / "brochures_txt" / "2027"
have_raw = (EXT / "73-891.json").exists() and (TXT / "73-891.txt").exists()
needs_raw = pytest.mark.skipif(not have_raw, reason="raw extractions / brochure text not present (git-ignored)")


def make_doc(*pages):
    return v.Doc({i + 1: t for i, t in enumerate(pages)})


# ---------------------------------------------------------------- normalisation

def test_squash_ignores_case_whitespace_hyphens_quotes():
    a = "Your share of the\nplan’s co-\npayment is “High-Deductible”"
    b = "your share of the plan's copayment is \"high deductible\""
    assert v.squash(a) == v.squash(b)


def test_squash_keeps_number_integrity():
    assert v.squash("$37.50") != v.squash("$3750")
    assert v.squash("$1,500") != v.squash("$1500")


def test_numbers_in():
    nums = v.numbers_in("$37.50 copay, 30% of allowance, $1,500 max")
    assert (37.5, True, False) in nums and (30.0, False, True) in nums and (1500.0, True, False) in nums


def test_split_fragments_on_ellipsis():
    assert len(v.split_fragments("We increased ... to $30 copayment")) == 2


# ---------------------------------------------------------------- quote verification

def quote_fact(q, page, **kw):
    return v.Fact("changes_for_2027", "changes_for_2027[0]", q, page, is_quote=True, **kw)


def test_quote_found_on_claimed_and_adjacent_page():
    doc = make_doc("intro", "Increase primary care doctor visit from $15 to\n$30 copayment.", "other", "end")
    q = "Increase primary care doctor visit from $15 to $30 copayment."
    f = v.verify_fact(quote_fact(q, 2), doc)
    assert f.verified and f.found_page == 2 and f.match == "exact"
    f = v.verify_fact(quote_fact(q, 3), doc)
    assert f.verified and f.found_page == 2          # +/-1 accepted, real page recorded
    f = v.verify_fact(quote_fact(q, 4), doc)
    assert not f.verified and f.found_elsewhere == 2


def test_quote_with_wrong_number_fails():
    doc = make_doc("copay is $15 per visit")
    assert not v.verify_fact(quote_fact("copay is $25 per visit", 1), doc).verified


def test_quote_with_ellipsis_all_fragments_needed():
    doc = make_doc("We increased the network deductible to $500 for Self Only and $1,000 for family")
    assert v.verify_fact(quote_fact("We increased ... $1,000 for family", 1), doc).verified
    assert not v.verify_fact(quote_fact("We increased ... $9,000 for family", 1), doc).verified


def test_bad_page_is_unverified():
    doc = make_doc("hello world quote here")
    assert not v.verify_fact(quote_fact("hello world quote here", 7), doc).verified
    assert not v.verify_fact(quote_fact("hello world quote here", None), doc).verified


def test_changes_amounts_in_from_to_must_be_in_quote_else_degraded():
    doc = make_doc("Increase primary care doctor visit from $15 to $30 copayment.")
    f = v.verify_fact(quote_fact("Increase primary care doctor visit from $15 to $30 copayment.", 1,
                                 extra={"from": "$15", "to": "$40"}, payload={"from": "$15", "to": "$40"}), doc)
    assert f.verified and f.payload["to"] is None and "to" in f.unverified_fields and f.payload["from"] == "$15"


# ---------------------------------------------------------------- numbers / text

def cell(text, page, value, unit):
    return v.Fact("rx.tiers.retail_30", "p", text, page, value=value, unit=unit)


def test_value_must_appear_in_text():
    doc = make_doc("Tier 1: $37.50 copayment")
    assert v.verify_fact(cell("Tier 1: $37.50 copayment", 1, 37.5, "usd"), doc).verified
    assert not v.verify_fact(cell("Tier 1: $37.50 copayment", 1, 37.0, "usd"), doc).verified
    assert not v.verify_fact(cell("Tier 1: $37.50 copayment", 1, 37.5, "pct"), doc).verified


def test_unit_mismatch_pct_vs_usd():
    doc = make_doc("Tier 2: 30% of the Plan allowance")
    assert v.verify_fact(cell("Tier 2: 30% of the Plan allowance", 1, 30, "pct"), doc).verified
    assert not v.verify_fact(cell("Tier 2: 30% of the Plan allowance", 1, 30, "usd"), doc).verified


def test_zero_value_nothing():
    doc = make_doc("You pay Nothing (no deductible)")
    assert v.verify_fact(cell("Nothing (no deductible)", 1, 0, "usd"), doc).verified


def test_text_overlap_accepts_light_rewording_but_not_other_numbers():
    src = ("Specialty drugs must be filled through the designated specialty pharmacy "
           "up to a 30-day supply at a $25 copayment")
    doc = make_doc(src)
    ok = v.Fact("rx.mail_order", "x", src + " each", 1)
    assert v.verify_fact(ok, doc).verified
    bad = v.Fact("rx.mail_order", "x", src.replace("$25", "$35"), 1)
    assert not v.verify_fact(bad, doc).verified


def test_invented_text_fails():
    doc = make_doc("Prior approval is required for bariatric surgery and transplants")
    f = v.Fact("prior_approval_required", "x", "GLP-1 drugs are covered without any limits for all members", 1)
    assert not v.verify_fact(f, doc).verified


def test_url_phone_checks():
    doc = make_doc("Customer Service: 877-835-9861\nwww.uhcfeds.com")
    assert v.verify_fact(v.Fact("m", "x", "877-835-9861", 1, kind="phone", scope="doc"), doc).verified
    assert not v.verify_fact(v.Fact("m", "x", "877-835-9862", 1, kind="phone", scope="doc"), doc).verified
    assert v.verify_fact(v.Fact("m", "x", "https://www.uhcfeds.com/", None, kind="url", scope="doc"), doc).verified
    assert not v.verify_fact(v.Fact("m", "x", "www.example.org", None, kind="url", scope="doc"), doc).verified


def test_absence_notes_are_not_facts():
    data = {"prescriptions": {"tiers": [{"option": "A", "tier": "Tier 1", "retail_90": {
        "value": None, "unit": "text", "text": "Not stated; retail is up to 30 days", "page": 1}}],
        "glp1_diabetes": {"covered": None, "text": "No GLP-1 diabetes statement found in the brochure.",
                          "page": None}}}
    assert v.collect_facts(data) == []


# ---------------------------------------------------------------- structure

def good_doc():
    return {"brochure": "x", "carrier": "c", "options": ["A"],
            "changes_for_2027": [{"option": "all", "category": "copay", "summary": "s", "from": None, "to": None,
                                  "page": 3, "quote": "q"}],
            "prescriptions": {"tiers": [{"option": "A", "tier": "Tier 1",
                                         "retail_30": {"value": 1, "unit": "usd", "text": "$1", "page": 2}}],
                              "rx_out_of_pocket_max": [], "other_notable": []},
            "network": {}, "member_services": {"page": 1}, "prior_approval_required": [],
            "notable_limits_and_exclusions": [], "medicare_coordination_summary": {"text": "t", "page": 4},
            "extraction_notes": []}


def test_structure_ok_and_errors():
    assert v.validate_structure(good_doc(), 10) == []
    d = good_doc()
    del d["carrier"]
    d["changes_for_2027"][0]["page"] = 99
    d["prescriptions"]["tiers"][0]["tier"] = None
    d["prescriptions"]["tiers"][0]["retail_30"]["page"] = "2"
    errs = " | ".join(v.validate_structure(d, 10))
    assert "missing key carrier" in errs and "outside 1..10" in errs and "tier" in errs and "not an int" in errs


# ---------------------------------------------------------------- option matching & crosscheck

CODES = {"104": ["Standard Option"], "111": ["Basic Option"]}


def test_match_option():
    assert v.match_option("Standard Option", CODES) == (["104"], "exact")
    assert v.match_option("Basic", CODES)[0] == ["111"]
    assert v.match_option("all", CODES)[0] == ["104", "111"]
    assert v.match_option("Prosper", CODES)[0] == []
    codes = {"EP1": ["Aetna HealthFund CDHP"], "EP4": ["Value Plan"], "F51": ["Aetna HealthFund CDHP"]}
    assert v.match_option("CDHP", codes)[0] == ["EP1", "F51"]
    codes = {"224": ["Aetna HealthFund HDHP"], "N61": ["Aetna Direct"]}
    assert v.match_option("High Deductible Health Plan (HDHP)", codes)[0] == ["224"]
    assert v.match_option("Aetna Direct Plan", codes)[0] == ["N61"]


def test_match_option_multi_split():
    got, bad, how = v.match_option_multi("Standard Option and Basic Option", CODES)
    assert got == ["104", "111"] and not bad
    got, bad, how = v.match_option_multi("Standard Option and Prosper", CODES)
    assert got == ["104"] and bad == ["Prosper"]


def test_crosscheck():
    raw = {"Tier 1": "Preferred Generic - $7.50 Copayment", "Tier 2": "Preferred Brand - 30% Coinsurance"}
    assert v.crosscheck_tier("Tier 1", {"value": 7.5, "unit": "usd"}, raw)[0] == "match"
    assert v.crosscheck_tier("Tier 1", {"value": 8, "unit": "usd"}, raw)[0] == "mismatch"
    assert v.crosscheck_tier("Tier 2", {"value": 30, "unit": "pct"}, raw)[0] == "match"
    assert v.crosscheck_tier("Tier 2", {"value": 30, "unit": "usd"}, raw)[0] == "mismatch"
    assert v.crosscheck_tier("Specialty", {"value": 30, "unit": "pct"}, raw)[0] == "n/a"
    assert v.crosscheck_tier("Tier 3", {"value": 30, "unit": "pct"}, raw)[0] == "n/a"
    assert v.crosscheck_tier("Tier 1", {"value": None, "unit": "text"}, raw)[0] == "n/a"


# ---------------------------------------------------------------- pilot brochures (real data)

_cache = {}


def run_pilot(num):
    if num not in _cache:
        data, _, facts, rep = v.validate_brochure(num, EXT, TXT)
        _cache[num] = (data, facts, rep)
    return _cache[num]


def find_cell(num, option, tier, field):
    data, facts, _ = run_pilot(num)
    tiers = data["prescriptions"]["tiers"]
    for f in facts:
        if f.group and f.field == field:
            t = tiers[f.group[1]]
            if t["option"] == option and t["tier"] == tier:
                return f
    return None


def check_cell(num, option, tier, field, value, unit):
    f = find_cell(num, option, tier, field)
    assert f is not None, (num, option, tier, field)
    assert f.value == value and f.unit == unit
    assert f.verified, f.reasons


@needs_raw
def test_pilot_73_891():
    check_cell("73-891", "HDHP Option", "Tier 1", "retail_30", 15, "usd")
    check_cell("73-891", "HDHP Option", "Tier 1", "mail_90", 37.5, "usd")
    _, facts, _ = run_pilot("73-891")
    hit = [f for f in facts if f.section == "changes_for_2027" and f.payload.get("from") == "$15"
           and f.payload.get("to") == "$30" and "primary care" in f.payload["summary"].lower()]
    assert hit and hit[0].verified and not hit[0].unverified_fields


@needs_raw
def test_pilot_71_005():
    check_cell("71-005", "Standard Option", "Tier 1", "retail_30", 7.5, "usd")
    check_cell("71-005", "Standard Option", "Tier 1", "retail_90", 22.5, "usd")
    check_cell("71-005", "Basic Option", "Tier 1", "retail_30", 15, "usd")
    check_cell("71-005", "Basic Option", "Tier 1", "retail_90", 40, "usd")
    check_cell("71-005", "Standard Option", "Tier 2", "retail_30", 30, "pct")
    assert "plan allowance" in find_cell("71-005", "Standard Option", "Tier 2", "retail_30").text.lower()


def test_facts_file_pilot_values():
    path = ROOT / "data" / "brochure_facts.json"
    if not path.exists():
        pytest.skip("facts file not built")
    d = json.loads(path.read_text(encoding="utf-8"))
    t = d["plans"]["104"]["rx"]["tiers"][0]
    assert t["tier"] == "Tier 1" and t["retail_30"]["value"] == 7.5 and t["crosscheck"] == "match"
    assert t["retail_30"]["page"] and t["retail_30"]["quote"]
    t = d["plans"]["V41"]["rx"]["tiers"][0]
    assert t["retail_30"]["value"] == 15 and t["mail_90"]["value"] == 37.5


def test_facts_file_every_fact_has_provenance():
    path = ROOT / "data" / "brochure_facts.json"
    if not path.exists():
        pytest.skip("facts file not built")
    d = json.loads(path.read_text(encoding="utf-8"))
    assert set(d) == {"meta", "plans"} and d["meta"]["source"] == "OPM 2027 brochures"

    def walk(o):
        if isinstance(o, dict):
            if "quote" in o:
                assert isinstance(o["page"], int) and o["quote"] and o["match"] in ("exact", "overlap", "partial")
            for x in o.values():
                walk(x)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(d["plans"])
