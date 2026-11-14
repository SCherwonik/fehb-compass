"""Conservative repairs for PDF-extraction spacing artifacts in OPM benefit text.

Rules (all deliberately narrow; when in doubt the text is left alone):
  * whitespace: NBSP / runs of spaces collapse to one space, ends trimmed, a dangling
    trailing ' -' (empty "Additional Details") is dropped
  * punctuation: no space before , ; ) % or before a sentence-final . or :, none after (,
    a space after 'word;' and 'word:Capital' when the text is glued
  * split digits: '3 0-day' -> '30-day' (only right after start / : ; ( , / and only when
    followed by -day(s), 'day(s)' or %), so 'Tier 1 30-day' and '$10 5%' are untouched
  * split words: 'Preferre d' -> 'Preferred', using a vocabulary counted from the corpus
    itself; the joined word must be a frequent corpus word of 6+ letters and at least one
    fragment must NOT be a known word, so 'a day', 'Part B', 'Self Plus One' never join.
Digits, '$' and '%' are never added, removed or reordered (see tests).
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Iterable

# Real short words: never treated as an artifact fragment.
SHORT_WORDS = frozenset(
    "a i of in on or to an as at be by if is it no up us we do so my he me am go vs re".split())
# Common function words: never joined onto a neighbour.
FUNCTION_WORDS = frozenset(
    "the and for per any all are not you can may but with our one two who its his her out "
    "from that this than then them they was were has had have will your each when what which "
    "also only more most such less over into upon plus max min limit visit visits day days "
    "year years month months other others self family tier".split())

# Healthcare / benefit words that may occur intact fewer than MIN_JOINED_COUNT times in
# the corpus, so split copies of them ('Emerge ncy') still join.
HAND_WORDS = frozenset(
    "essential emergency allowance occupational participants participant admission "
    "intrauterine intravaginal inseminations insemination chiropractic deductible "
    "copayment coinsurance preventive medications specialty pharmacy medicare "
    "outpatient inpatient combined accidental".split())

# Exact glued / garbled strings seen in OPM sheets (high confidence, whole-token match).
GLUED = {
    "maximumfor": "maximum for",
    "thePlan": "the Plan",
    "ForXRays": "For X-Rays",
    "primaryAssumes": "primary Assumes",
    "adminss ion": "admission",
}
_GLUED = re.compile(
    "(?<![A-Za-z])(" + "|".join(re.escape(k) for k in GLUED) + ")(?![a-z])")

# Plain misspellings found by a corpus sweep (rare word within edit distance 1-2 of a
# frequent one, judged unambiguous from context). Whole-word, case-insensitive,
# initial capital preserved.
TYPOS = {
    "vist": "visit", "vsit": "visit", "isit": "visit", "ioffice": "office",
    "deducible": "deductible", "deductilble": "deductible",
    "eyeglassess": "eyeglasses", "appy": "apply", "anr": "and",
    "addmission": "admission", "admisison": "admission", "alloowance": "allowance",
    "allowanceup": "allowance up", "copayup": "copay up", "authorizaton": "authorization",
    "calendary": "calendar", "hopsital": "hospital", "maxiumum": "maximum",
    "nnual": "annual", "surery": "surgery", "co ins": "coins",
}
# Clipped at the end of the cell text (only repaired when it is the last word).
TRUNCATED = {"admi": "admission", "offic": "office", "copaymen": "copayment",
             "allowanc": "allowance"}
_TYPOS = re.compile(
    r"(?<![A-Za-z'])(" + "|".join(re.escape(k) for k in TYPOS) + r")(?![A-Za-z'])", re.I)
_TRUNC = re.compile(
    r"(?<![A-Za-z'])(" + "|".join(TRUNCATED) + r")$", re.I)


def _keep_case(m: re.Match, table: dict) -> str:
    rep = table[m.group(1).lower()]
    return rep[0].upper() + rep[1:] if m.group(1)[0].isupper() else rep


MIN_JOINED_COUNT = 3     # joined word must appear intact in >= 3 distinct corpus strings
MIN_JOINED_LEN = 6
KNOWN_FRAGMENT_COUNT = 8  # a 3+ letter fragment counts as a real word from this many strings
KNOWN_FRAGMENT_RATIO = 0.25  # ...and only if not rarer than 1/4 of the word it would form

_WORD = re.compile(r"[A-Za-z]+")
# Zero-width so that overlapping pairs ('Max copaym ent') are all examined.
_PAIR = re.compile(r"(?=(?<![\w$%/.'])([A-Za-z]+) ([a-z]+)(?![\w'/\-]))")
_DIGITS = re.compile(
    r"(?:(?<![^:;(,/])|(?<=[:;(,/] ))(\d) (\d{1,2})(?=-days?\b| days?\b|%)")


def build_vocab(texts: Iterable[str]) -> Counter:
    """Lower-cased alphabetic token -> number of DISTINCT strings containing it."""
    vocab: Counter = Counter()
    for t in set(texts):
        vocab.update({w.lower() for w in _WORD.findall(t)})
    return vocab


def _known(frag: str, joined: str, vocab: Counter) -> bool:
    if frag in SHORT_WORDS:
        return True
    n = vocab.get(frag, 0)
    return len(frag) >= 3 and n >= KNOWN_FRAGMENT_COUNT and n >= KNOWN_FRAGMENT_RATIO * vocab.get(joined, 0)


def _should_join(a: str, b: str, vocab: Counter) -> bool:
    if len(a) > 1 and a.isupper():  # acronym such as 'HMO s'
        return False
    al = a.lower()
    joined = al + b
    if len(joined) < MIN_JOINED_LEN or (vocab.get(joined, 0) < MIN_JOINED_COUNT and joined not in HAND_WORDS):
        return False
    if al in FUNCTION_WORDS or b in FUNCTION_WORDS:
        return False
    return not (_known(al, joined, vocab) and _known(b, joined, vocab))


def _join_words(text: str, vocab: Counter) -> str:
    out, pos = [], 0
    for m in _PAIR.finditer(text):
        a, b = m.group(1), m.group(2)
        start = m.start()
        if start < pos or not _should_join(a, b, vocab):
            continue
        out.append(text[pos:start] + a + b)
        pos = start + len(a) + 1 + len(b)
    return "".join(out) + text[pos:]


_PUNCT_RULES = (
    (re.compile(r"(?<=[\w)%]) +(?=[,;])"), ""),
    (re.compile(r"(?<=[\w)%]) +(?=[.:](?:\s|$))"), ""),
    (re.compile(r"(?<=\d) +%"), "%"),
    (re.compile(r"(?<=\w) +\)"), ")"),
    (re.compile(r"\( +(?=\S)"), "("),
    (re.compile(r"\.\s+\.(?=[A-Z])"), ". "),
    (re.compile(r"(?<=[a-z]);(?=[A-Za-z$\d])"), "; "),
    (re.compile(r"(?<=[a-z]):(?=[A-Z$])"), ": "),
    (re.compile(r"(?<=%)(?=[A-Za-z]{3})"), " "),          # '30%coinsurance'
    (re.compile(r"(?<=[A-Z]),(?=[A-Z])"), ", "),           # 'PT,OT' abbreviation lists
    (re.compile(r"(?<=[a-z])\((?=\$)"), " ("),              # 'supply($150' (after '( ' fix)
    (re.compile(r" - : "), " - "),                          # stray ':' after a dash
)


def fix_spacing(text: str, vocab: Counter | None = None) -> str:
    """Repair spacing artifacts in `text`; word joins need a `vocab` from build_vocab()."""
    t = re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()
    t = _GLUED.sub(lambda m: GLUED[m.group(1)], t)
    t = _TYPOS.sub(lambda m: _keep_case(m, TYPOS), t)
    t = _TRUNC.sub(lambda m: _keep_case(m, TRUNCATED), t)
    t = _DIGITS.sub(r"\1\2", t)
    for rx, rep in _PUNCT_RULES:
        t = rx.sub(rep, t)
    if vocab:
        t = _join_words(t, vocab)
    t = re.sub(r" {2,}", " ", t)
    return re.sub(r"\s+-$", "", t).strip()
