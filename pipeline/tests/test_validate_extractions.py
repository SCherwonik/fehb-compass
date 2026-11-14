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
                assert isinstance(o["page"], int) and o["quote"]
                if "ruling" not in o:  # adjudication blocks carry ruling/page/quote, not a match kind
                    assert o["match"] in ("exact", "overlap", "partial", "adjudicated")
            for x in o.values():
                walk(x)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(d["plans"])


# ---------------------------------------------------------------- Rx adjudication

def mk_tier(tier="Tier 2", value=60, unit="usd", option="Standard Option", cc="mismatch"):
    return {"option": option, "tier": tier, "label": "preferred brand", "deductible_applies": False,
            "retail_30": {"quote": f"${value}", "page": 5, "value": value, "unit": unit, "match": "exact"},
            "retail_90": None, "mail_90": {"quote": "$150", "page": 5, "value": 150, "unit": "usd", "match": "exact"},
            "crosscheck": cc, "crosscheck_sheet": "Generic - $5 Copayment", "_alt": [3]}


def mk_dec(ruling, conf="high", corrected=None, **kw):
    d = {"plan_code": "654", "brochure": "73-019", "option": "Standard Option", "tier": "Tier 2",
         "sheet": "Generic - $5 Copayment", "ruling": ruling, "confidence": conf, "page": 5,
         "quote": "decisive text", "corrected": corrected, "reason": "because"}
    d.update(kw)
    return d


def test_adjudicate_brochure_correct_keeps_values_and_notes_sheet():
    r = v.adjudicate_tier(mk_tier(), mk_dec("brochure_correct"))
    assert r["crosscheck"] == "adjudicated_brochure"
    assert r["sheet_discrepancy"] == "Generic - $5 Copayment"
    assert r["retail_30"]["value"] == 60 and "_alt" not in r
    assert r["adjudication"] == {"ruling": "brochure_correct", "confidence": "high", "page": 5, "quote": "decisive text"}
    r = v.adjudicate_tier(mk_tier(), mk_dec("brochure_correct", sheet_note="custom note"))
    assert r["sheet_discrepancy"] == "custom note"


def test_adjudicate_sheet_correct_replaces_with_corrected_values():
    corr = {"tier": "Tier 3", "retail_30": {"value": 80, "unit": "usd", "quote": "$80 copay", "page": 6},
            "mail_90": {"value": 200, "unit": "usd", "quote": "$200", "page": 6}, "deductible_applies": True}
    t = mk_tier()
    r = v.adjudicate_tier(t, mk_dec("sheet_correct", "medium", corrected=corr))
    assert r["crosscheck"] == "adjudicated" and r["tier"] == "Tier 3" and r["deductible_applies"] is True
    assert r["retail_30"] == {"quote": "$80 copay", "page": 6, "value": 80, "unit": "usd", "match": "adjudicated"}
    assert r["mail_90"]["value"] == 200 and r["adjudication"]["ruling"] == "sheet_correct"
    assert "sheet_discrepancy" not in r and "crosscheck_sheet" not in r
    assert t["retail_30"]["value"] == 60                      # input not mutated
    only_mail = {"mail_90": {"value": 1, "unit": "usd", "quote": "q", "page": 2}}
    r = v.adjudicate_tier(mk_tier(), mk_dec("both_wrong", corrected=only_mail))
    assert r["crosscheck"] == "adjudicated" and r["mail_90"]["value"] == 1 and r["retail_30"]["value"] == 60
    assert r["sheet_discrepancy"] == "Generic - $5 Copayment"


def test_adjudicate_drop_undeterminable_and_low_confidence():
    assert v.adjudicate_tier(mk_tier(), mk_dec("sheet_correct", corrected=None, action="drop")) is None
    r = v.adjudicate_tier(mk_tier(), mk_dec("undeterminable", reason="columns collapsed"))
    assert r["crosscheck"] == "unresolved" and r["flag"] == "rx_tier_unresolved"
    assert r["flag_reason"] == "columns collapsed" and r["retail_30"]["value"] == 60
    # low confidence, or a correction ruling without corrected values, must not be applied
    for d in (mk_dec("brochure_correct", "low"),
              mk_dec("sheet_correct", "low", corrected={"tier": "Tier 9"}),
              mk_dec("both_wrong", "high", corrected=None)):
        r = v.adjudicate_tier(mk_tier(), d)
        assert r["crosscheck"] == "unresolved" and r["tier"] == "Tier 2"


def test_adjudicate_plans_only_touches_mismatches():
    plans = {"654": {"brochure": "73-019", "rx": {"tiers": [mk_tier("Tier 1", cc="match"), mk_tier("Tier 2"),
                                                              mk_tier("Tier 3"), mk_tier("Tier 4")]}}}
    adj = {"decisions": [mk_dec("brochure_correct"), mk_dec("sheet_correct", tier="Tier 3", action="drop"),
                         mk_dec("undeterminable", tier="Tier 4")]}
    counts, dropped, unresolved = v.adjudicate_plans(plans, adj)
    assert [t["crosscheck"] for t in plans["654"]["rx"]["tiers"]] == ["match", "adjudicated_brochure", "unresolved"]
    assert counts == {"adjudicated_brochure": 1, "dropped": 1, "unresolved": 1}
    assert dropped[0]["tier"] == "Tier 3" and dropped[0]["value"] == 60
    assert unresolved == [{"brochure": "73-019", "plan_code": "654", "option": "Standard Option", "tier": "Tier 4",
                           "reason": "because"}]
    # a mismatch without a decision stays a mismatch (so the final-file test can catch it)
    plans = {"654": {"brochure": "73-019", "rx": {"tiers": [mk_tier("Tier 5")]}}}
    v.adjudicate_plans(plans, adj)
    assert plans["654"]["rx"]["tiers"][0]["crosscheck"] == "mismatch"


def test_option_map_for_and_attachment_of_unmatched_options():
    adj = {"unmatched_options": [
        {"brochure": "73-937", "option": "Standard Option", "ruling": "map_to:YJ4"},
        {"brochure": "73-937", "option": "Medicare Advantage", "ruling": "map_to:YJ1,YJ4"},
        {"brochure": "73-937", "option": "Other", "ruling": "no_fehb_plan"},
        {"brochure": "99-999", "option": "Standard Option", "ruling": "map_to:ZZ9"}]}
    codes = {"YJ1": ["Basic Option"], "YJ4": ["High Option"]}
    m = v.option_map_for(adj, "73-937", codes)
    assert m == {"Standard Option": ["YJ4"], "Medicare Advantage": ["YJ1", "YJ4"]}
    with pytest.raises(ValueError):
        v.option_map_for(adj, "99-999", codes)
    # the map makes build_brochure_entries attach facts that matching could not place
    f = v.Fact("changes_for_2027", "changes_for_2027[0]", "Premium rises.", 1, is_quote=True, option="Standard Option")
    f.verified, f.match = True, "exact"
    f.payload = {"category": "premium", "summary": "s", "option": "Standard Option"}
    data = {"options": ["Standard Option", "Basic Option"], "prescriptions": {"tiers": []}, "network": {}}
    got, unmatched, _, _ = v.build_brochure_entries("73-937", data, [f], codes, {}, False, option_map=m)
    assert [x["option"] for x in got["YJ4"]["changes_2027"]] == ["Standard Option"] and not got["YJ1"]["changes_2027"]
    assert unmatched == {}
    got, unmatched, _, _ = v.build_brochure_entries("73-937", data, [f], codes, {}, False)
    assert "Standard Option" in unmatched


def load_facts():
    path = ROOT / "data" / "brochure_facts.json"
    if not path.exists():
        pytest.skip("facts file not built")
    return json.loads(path.read_text(encoding="utf-8"))


def test_final_facts_have_no_unadjudicated_mismatch():
    facts = load_facts()
    counts, unresolved = v.crosscheck_states(facts)
    assert counts.get("mismatch", 0) == 0, dict(counts)
    assert set(counts) <= {"match", "n/a", "adjudicated", "adjudicated_brochure", "unresolved"}
    for p in facts["plans"].values():
        for t in p["rx"]["tiers"]:
            if t["crosscheck"] == "adjudicated_brochure":
                assert t["sheet_discrepancy"] and t["adjudication"]["quote"]
            if t["crosscheck"] == "adjudicated":
                assert t["adjudication"]["ruling"] in ("sheet_correct", "both_wrong")
            if t["crosscheck"] == "unresolved":
                assert t["flag"] == "rx_tier_unresolved" and t["flag_reason"]


def test_unresolved_counts_listed_and_match_adjudication_file():
    facts = load_facts()
    adj = v.load_adjudication()
    assert adj is not None
    counts, unresolved = v.crosscheck_states(facts)
    expected = [d for d in adj["decisions"] if d["ruling"] == "undeterminable" or d["confidence"] == "low"]
    by_brochure = {}
    for u in unresolved:
        by_brochure[u["brochure"]] = by_brochure.get(u["brochure"], 0) + 1
    print("unresolved rx tiers by brochure:", by_brochure or "none")
    assert len(unresolved) == len(expected) == counts.get("unresolved", 0)
    meta = facts["meta"]["rx_adjudication"]
    assert len(meta["unresolved_tiers"]) == len(unresolved)
    # every decision is accounted for in the facts file (dropped tiers are listed in meta)
    assert len(adj["decisions"]) == sum(meta["tiers"].values())
    assert len(meta["dropped_tiers"]) == sum(1 for d in adj["decisions"] if d.get("action") == "drop")


def test_adjudication_file_shape_and_unmatched_options_attached():
    adj = v.load_adjudication()
    facts = load_facts()
    assert adj["generated_by"] and adj["summary"]["decisions"] == len(adj["decisions"])
    rulings = {d["ruling"] for d in adj["decisions"]}
    assert adj["summary"]["by_ruling"] == {r: sum(1 for d in adj["decisions"] if d["ruling"] == r) for r in rulings}
    for d in adj["decisions"]:
        assert d["ruling"] in ("brochure_correct", "sheet_correct", "both_wrong", "undeterminable")
        assert d["confidence"] in ("high", "medium", "low") and d["quote"] and d["page"] and d["reason"]
    for u in adj["unmatched_options"]:
        assert u["ruling"].startswith(("map_to:", "no_fehb_plan", "undeterminable"))
        if u["ruling"].startswith("map_to:"):
            assert u["option"] not in facts["meta"]["brochures"][u["brochure"]].get("unmatched_options", {})
            for code in u["ruling"][7:].split(","):
                assert facts["plans"][code]["brochure"] == u["brochure"]
    assert facts["plans"]["YJ4"]["option"] == "Standard Option"


@needs_raw
def test_adjudication_quotes_are_in_the_brochure_text():
    adj = v.load_adjudication()
    cache = {}
    for d in adj["decisions"]:
        pages = cache.setdefault(d["brochure"], v.load_pages(TXT / f"{d['brochure']}.txt"))
        cites = [(d["quote"], d["page"])] + [(c["quote"], c["page"]) for c in (d["corrected"] or {}).values()
                                              if isinstance(c, dict) and "quote" in c]
        for q, pg in cites:
            assert v.squash(q) in v.squash(pages[pg]), (d["brochure"], d["plan_code"], d["tier"], q)
