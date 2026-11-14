import json
import re
import sys
from collections import Counter
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
ROOT = PIPELINE.parent
sys.path.insert(0, str(PIPELINE))

import textfix  # noqa: E402
from textfix import build_vocab, fix_spacing  # noqa: E402

VOCAB = Counter({
    "preferred": 116, "preferre": 3, "specialty": 137, "specialt": 6, "essential": 60,
    "essentia": 2, "medicare": 44, "medicar": 2, "deductible": 442, "deducti": 10,
    "contracted": 3, "contract": 40, "pharmacy": 24, "pharma": 1, "generics": 9,
    "generic": 39, "standard": 48, "standar": 1, "copayment": 1192, "copaym": 4,
    "day": 300, "days": 200, "self": 900, "plus": 900, "one": 900, "specialist": 500,
    "primary": 500, "care": 900, "part": 500, "another": 20, "network": 900,
    "payment": 40, "coinsurance": 900, "medications": 6,
})


@pytest.mark.parametrize("before,after", [
    # whitespace
    ("Self Plus  One ", "Self Plus One"),
    ("  $30   Copayment\t", "$30 Copayment"),
    ("$30 Copayment - ", "$30 Copayment"),          # dangling separator
    # punctuation
    ("Retail ; Mail", "Retail; Mail"),
    ("$50 copayment .", "$50 copayment."),
    ("Tier 1 : $10", "Tier 1: $10"),
    ("20 % coinsurance", "20% coinsurance"),
    ("Occupational Therapy )", "Occupational Therapy)"),
    ("supply( $150 Max), $400", "supply ($150 Max), $400"),
    ("our allowance. .One hearing aid", "our allowance. One hearing aid"),
    ("Specialist Visit;$50 Outpatient", "Specialist Visit; $50 Outpatient"),
    ("ForXRays:Copayment $20", "For X-Rays: Copayment $20"),
    # digits
    ("Brand Retail:3 0-day supply: 40", "Brand Retail:30-day supply: 40"),
    ("Retail:9 0 days supply", "Retail:90 days supply"),
    ("Copay: 1 5% after", "Copay: 15% after"),
    # words
    ("Preferre d Brand", "Preferred Brand"),
    ("Specialt y: Filled through a Contract ed Specialt y Pharma cy.",
     "Specialty: Filled through a Contracted Specialty Pharmacy."),
    ("Standar d Plus", "Standard Plus"),
    # misspellings (exact-word repairs)
    ("$400 Copayment - per vist", "$400 Copayment - per visit"),
    ("$15 Copayment - per vsit", "$15 Copayment - per visit"),
    ("$5 per group office isit", "$5 per group office visit"),
    ("specialty care ioffice visit", "specialty care office visit"),
    ("less, deducible does not apply.", "less, deductible does not apply."),
    ("after the deductilble.", "after the deductible."),
    ("One pair of eyeglassess or contact", "One pair of eyeglasses or contact"),
    ("cost share appy if you get care", "cost share apply if you get care"),
    ("GIFT, and ZIFT anr excluded", "GIFT, and ZIFT and excluded"),
    ("(see Inpatient addmission)", "(see Inpatient admission)"),
    ("per admisison up to 5 days", "per admission up to 5 days"),
    ("of Plan Alloowance for up to", "of Plan Allowance for up to"),
    ("of plans allowanceup to three", "of plans allowance up to three"),
    ("$175/day copayup to 5 days", "$175/day copay up to 5 days"),
    ("Prior authorizaton required", "Prior authorization required"),
    ("$350 Calendary Year Deductible", "$350 Calendar Year Deductible"),
    ("inpatient hopsital copay", "inpatient hospital copay"),
    ("up to a maxiumum of $150", "up to a maximum of $150"),
    ("Covered - nnual eye examination", "Covered - annual eye examination"),
    ("$50 - per surery", "$50 - per surgery"),
    ("if you have A&B, co ins is $0", "if you have A&B, coins is $0"),
    ("$500 per inpatient admi", "$500 per inpatient admission"),       # clipped at end
    ("$35 per specialty care offic", "$35 per specialty care office"),
    ("$750 Copayment - per aper admission after the deductible", "$750 Copayment - per admission after the deductible"),
    ("subluxation only. Upto 20 visits per", "subluxation only. Up to 20 visits per"),
    ("the hospital inpat cost per admission", "the hospital inpatient cost per admission"),
    ("$0 copaymen", "$0 copayment"),
    ("10% of the Plan allowanc", "10% of the Plan allowance"),
    ("60% Coinsurance - Non-Preferre d Brand", "60% Coinsurance - Non-Preferred Brand"),
    ("Accidental Emerge ncy waives", "Accidental Emergency waives"),
    ("Intrauter ine (IUI) and Intravagi nal (IVI)", "Intrauterine (IUI) and Intravaginal (IVI)"),
    ("diabetes program participa nts receive", "diabetes program participants receive"),
    ("20% of thePlan allowance", "20% of the Plan allowance"),
    ("up to a $350 maximumfor up to", "up to a $350 maximum for up to"),
    ("per adminss ion hospital copay", "per admission hospital copay"),
    ("deductible 30%coinsurance ded", "deductible 30% coinsurance ded"),
    ("OT,PT, and ST services", "OT, PT, and ST services"),
    ("$5,000 - : $2,500 Self Only/$5,000 Self Plus One", "$5,000 - $2,500 Self Only/$5,000 Self Plus One"),
    ("Medicar e payment", "Medicare payment"),
    ("Generic s Only", "Generics Only"),
])
def test_fixes(before, after):
    assert fix_spacing(before, VOCAB) == after


@pytest.mark.parametrize("text", [
    "Self Plus One", "Self Only", "Self & Family", "$30 Copayment", "No deductible",
    "in-network", "Tier 1: $10", "Tier 1 30-day supply", "Tier 1 3-day", "$10 5% of charges",
    "$10 for a day", "Part B", "Part A and B", "a day", "an other", "Retail:30-day supply",
    "Retail: $10", "30% Coinsurance", "$1,500 Copayment", "RI-73 899", "20% after deductible",
    "Specialist Office Visit: $40 per day", "Primary care a visit", "Preferred Brand",
    "at least 30 days", "w/in 72 hours", "Mail Order", "HMO s",
    "e.g. $5 or 10% of cost", "Up to $50 - $75 a month",
    "primary Assumes A & B", "the Plan allowance", "Self Plus One/ Self & Family", "1,500 PT, OT",
    "plan plans", "Tier Tiers", "HMO PPO", "Plan allowance", "per admission", "admission and visit",
    "per admission after", "per day uper admission", "$15 Copayment - ro primary care", "admi is clipped mid-sentence", "annual visit", "co-insurance applies",
    "Ded applies", "Visit", "office visit", "Calendar Year", "eyeglasses",
    "1-800-555-1234", "9:30 am", "http://example.com/a b", "Plan 104", "R 11 plan",
])
def test_unchanged(text):
    assert fix_spacing(text, VOCAB) == text


def test_word_join_needs_vocab_and_unknown_fragment():
    assert fix_spacing("Preferre d Brand") == "Preferre d Brand"            # no vocab -> no join
    assert fix_spacing("Preferre d Brand", Counter({"preferred": 1})) == "Preferre d Brand"  # rare word
    assert fix_spacing("Another day", VOCAB) == "Another day"
    both_known = Counter(VOCAB, other=50)
    assert fix_spacing("an other", both_known) == "an other"             # both fragments known words
    assert fix_spacing("Part icipation", Counter(part=500, participation=50, icipation=1)) == "Participation"


def test_idempotent_and_preserves_money_and_percent():
    samples = ["Retail:3 0-day $10 Copayment", "Preferre d Brand 20 % of $1,500", "Specialt y;$50"]
    for s in samples:
        once = fix_spacing(s, VOCAB)
        assert fix_spacing(once, VOCAB) == once
        assert re.findall(r"[\d$%]", s) == re.findall(r"[\d$%]", once)


def test_build_vocab_counts_distinct_strings():
    v = build_vocab(["Copayment a", "Copayment a", "copayment b"])
    assert v["copayment"] == 2 and v["a"] == 1 and v["b"] == 1


DATA = ROOT / "data"


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)


@pytest.mark.skipif(not (DATA / "benefits.json").exists(), reason="data not built")
def test_generated_data_is_a_fixed_point():
    """Rebuilt benefit text must already be clean: fix_spacing changes nothing."""
    ben = json.loads((DATA / "benefits.json").read_text(encoding="utf-8"))
    texts = set(_strings(ben))
    vocab = build_vocab(texts)
    changed = [t for t in texts if fix_spacing(t, vocab) != t]
    assert not changed, changed[:5]
