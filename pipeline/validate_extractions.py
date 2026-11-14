#!/usr/bin/env python
"""Validate AI-extracted brochure facts against the brochure source text and build
data/brochure_facts.json (verified facts only).

Usage:  python pipeline/validate_extractions.py [--date YYYY-MM-DD] [--no-facts]

Inputs (all read-only):
  pipeline/raw/extractions/2027/<N>.json      extraction (see pipeline/brochure_schema.md)
  pipeline/raw/brochures_txt/2027/<N>.txt     brochure text, pages split by `=== PAGE n ===`
  data/brochures.json, data/plans.json, data/benefits.json
Outputs:
  pipeline/raw/validation_report.json
  data/brochure_facts.json
"""
from __future__ import annotations

import argparse
import datetime
import difflib
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent
ROOT = PIPELINE.parent
YEAR = "2027"
OVERLAP_MIN = 0.8
MAX_QUOTE = 300

PAGE_RE = re.compile(r"^=== PAGE (\d+) ===[ \t]*$", re.M)
ABSENCE_RE = re.compile(
    r"^\s*(not stated|not found|not specified|not applicable|n/?a\b|not listed|not provided|none stated"
    r"|no\b[^.]{0,80}\b(found|stated|mentioned|specified)\b)", re.I)
ZERO_RE = re.compile(r"\b(nothing|no charge|no cost|free|zero)\b", re.I)


# --------------------------------------------------------------------------- text

def load_pages(path: Path) -> dict[int, str]:
    raw = Path(path).read_text(encoding="utf-8", errors="replace")
    parts = PAGE_RE.split(raw)
    pages: dict[int, str] = {}
    for i in range(1, len(parts) - 1, 2):
        pages[int(parts[i])] = parts[i + 1]
    return pages


_PUNCT = {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-",
          "‑": "-", "−": "-", "­": "", " ": " ", "…": "..."}


def _basic(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    for a, b in _PUNCT.items():
        s = s.replace(a, b)
    return s.lower()


def squash(s: str) -> str:
    """Whitespace/case/hyphenation/quote-insensitive form; digit separators are preserved."""
    s = _basic(s)
    s = re.sub(r"(?<=\d)\.(?=\d)", "#", s)
    s = re.sub(r"(?<=\d),(?=\d)", "@", s)
    return re.sub(r"[^a-z0-9$%#@]", "", s)


_TOK_RE = re.compile(r"\d[\d,]*(?:\.\d+)?%?|[a-z]+")


def tokenize(s: str) -> list[str]:
    return _TOK_RE.findall(_basic(s).replace("-", " "))


_NUM_RE = re.compile(r"(\$)?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|percent)?", re.I)


def numbers_in(s: str) -> list[tuple[float, bool, bool]]:
    """[(number, has_dollar, has_pct)] for every number in s."""
    out = []
    for m in _NUM_RE.finditer(_basic(s) if s else ""):
        try:
            n = float(m.group(2).replace(",", ""))
        except ValueError:
            continue
        out.append((n, bool(m.group(1)), bool(m.group(3))))
    return out


def money_pct_numbers(s: str) -> set[float]:
    return {n for n, d, p in numbers_in(s) if d or p}


def split_fragments(q: str) -> list[str]:
    frags = re.split(r"\.\.\.|\[\s*\.\.\.\s*\]", _basic(q))
    return [f for f in frags if squash(f)]


class Doc:
    def __init__(self, pages: dict[int, str]):
        self.pages = pages
        self.n_pages = max(pages) if pages else 0
        self.sq = {p: squash(t) for p, t in pages.items()}
        self.tokens: list[str] = []
        self.tok_page: list[int] = []
        for p in sorted(pages):
            toks = tokenize(pages[p])
            self.tokens.extend(toks)
            self.tok_page.extend([p] * len(toks))
        self.index: dict[str, list[int]] = defaultdict(list)
        for i, t in enumerate(self.tokens):
            self.index[t].append(i)
        self.all_sq = "".join(self.sq[p] for p in sorted(self.sq))
        self.digits = {p: re.sub(r"\D", "", t) for p, t in pages.items()}

    def scope(self, page, radius=1):
        if isinstance(page, int) and not isinstance(page, bool):
            return [p for p in range(page - radius, page + radius + 1) if p in self.pages]
        return sorted(self.pages)

    def find_sq(self, needle_sq: str, pages: list[int], prefer=None):
        """Page containing needle (nearest to `prefer`), or None."""
        if not needle_sq:
            return None
        hits = [p for p in pages if needle_sq in self.sq.get(p, "")]
        if not hits:
            # allow the text to span a page break inside the scope
            for a, b in zip(pages, pages[1:]):
                if b == a + 1 and needle_sq in self.sq[a] + self.sq[b]:
                    hits.append(a)
        if not hits:
            return None
        if prefer is None:
            return hits[0]
        return min(hits, key=lambda p: (abs(p - prefer), p))

    def overlap(self, text: str, pages: list[int], min_unique=4):
        """Best token coverage of `text` inside a local window. -> (score, page)."""
        toks = tokenize(text)
        uniq = list(dict.fromkeys(toks))
        if len(uniq) < min_unique:
            return 0.0, None
        allowed = set(pages)
        cands = []
        for t in uniq:
            pos = [i for i in self.index.get(t, ()) if self.tok_page[i] in allowed]
            if pos:
                cands.append((len(pos), t, pos))
        if not cands:
            return 0.0, None
        cands.sort(key=lambda c: c[0])
        W = len(toks) + 5
        digit_toks = [t for t in uniq if t[0].isdigit()]
        best = (0.0, None)
        for _, _, pos in cands[:3]:
            for i in pos:
                window = set(self.tokens[max(0, i - W): i + W + 1])
                if any(t not in window for t in digit_toks):
                    continue
                score = sum(1 for t in uniq if t in window) / len(uniq)
                if score > best[0]:
                    best = (score, self.tok_page[i])
        return best


# --------------------------------------------------------------------------- structure

def _is_int(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def validate_structure(data, n_pages: int) -> list[str]:
    """Lightweight structural check against pipeline/brochure_schema.md."""
    errs: list[str] = []
    if not isinstance(data, dict):
        return ["top level is not an object"]
    spec = {"brochure": str, "carrier": str, "options": list, "changes_for_2027": list, "prescriptions": dict,
            "network": dict, "member_services": dict, "prior_approval_required": list,
            "notable_limits_and_exclusions": list, "medicare_coordination_summary": (dict, type(None)),
            "extraction_notes": list}
    for k, t in spec.items():
        if k not in data:
            errs.append(f"missing key {k}")
        elif not isinstance(data[k], t):
            errs.append(f"{k}: wrong type {type(data[k]).__name__}")

    def page_ok(path, v, required=True):
        if v is None:
            if required:
                errs.append(f"{path}: missing page")
        elif not _is_int(v):
            errs.append(f"{path}: page is not an int ({v!r})")
        elif not 1 <= v <= n_pages:
            errs.append(f"{path}: page {v} outside 1..{n_pages}")

    for i, c in enumerate(data.get("changes_for_2027") or []):
        p = f"changes_for_2027[{i}]"
        if not isinstance(c, dict):
            errs.append(f"{p}: not an object")
            continue
        for k in ("option", "category", "summary", "quote"):
            if not isinstance(c.get(k), str):
                errs.append(f"{p}.{k}: missing or not a string")
        page_ok(p + ".page", c.get("page"))
    rx = data.get("prescriptions")
    if isinstance(rx, dict):
        for k in ("tiers", "rx_out_of_pocket_max", "other_notable"):
            if not isinstance(rx.get(k), list):
                errs.append(f"prescriptions.{k}: not a list")
        for i, t in enumerate(rx.get("tiers") or []):
            p = f"prescriptions.tiers[{i}]"
            if not isinstance(t, dict):
                errs.append(f"{p}: not an object")
                continue
            for k in ("option", "tier"):
                if not isinstance(t.get(k), str):
                    errs.append(f"{p}.{k}: missing or not a string")
            pages_seen = 0
            for cell in ("retail_30", "retail_90", "mail_90"):
                c = t.get(cell)
                if c is None:
                    continue
                if not isinstance(c, dict):
                    errs.append(f"{p}.{cell}: not an object")
                    continue
                if c.get("text") is not None or c.get("value") is not None:
                    page_ok(f"{p}.{cell}.page", c.get("page"))
                    pages_seen += 1
                if c.get("value") is not None and not isinstance(c["value"], (int, float)):
                    errs.append(f"{p}.{cell}.value: not a number")
                if c.get("unit") not in (None, "usd", "pct", "text"):
                    errs.append(f"{p}.{cell}.unit: bad unit {c.get('unit')!r}")
            if pages_seen == 0:
                errs.append(f"{p}: no cell with a page")
        for i, o in enumerate(rx.get("rx_out_of_pocket_max") or []):
            if not isinstance(o, dict):
                errs.append(f"prescriptions.rx_out_of_pocket_max[{i}]: not an object")
            else:
                page_ok(f"prescriptions.rx_out_of_pocket_max[{i}].page", o.get("page"))
        for k in ("prior_authorization", "step_therapy", "quantity_limits", "preventive_drugs_free",
                  "glp1_weight_loss", "glp1_diabetes"):
            v = rx.get(k)
            if v is None:
                continue
            if not isinstance(v, dict):
                errs.append(f"prescriptions.{k}: not an object")
            else:
                page_ok(f"prescriptions.{k}.page", v.get("page"))
    for sec in ("prior_approval_required", "notable_limits_and_exclusions"):
        for i, c in enumerate(data.get(sec) or []):
            p = f"{sec}[{i}]"
            if not isinstance(c, dict) or not isinstance(c.get("text"), str):
                errs.append(f"{p}: missing text")
                continue
            page_ok(p + ".page", c.get("page"))
    m = data.get("medicare_coordination_summary")
    if isinstance(m, dict):
        page_ok("medicare_coordination_summary.page", m.get("page"))
    net = data.get("network")
    if isinstance(net, dict):
        for k in ("out_of_network", "referrals_required"):
            v = net.get(k)
            if isinstance(v, dict):
                page_ok(f"network.{k}.page", v.get("page"))
    ms = data.get("member_services")
    if isinstance(ms, dict):
        page_ok("member_services.page", ms.get("page"), required=False)
    return errs


# --------------------------------------------------------------------------- facts

class Fact:
    def __init__(self, section, path, text, page, *, kind="text", is_quote=False, value=None, unit=None,
                 option=None, group=None, field=None, extra=None, payload=None, scope="page"):
        self.section, self.path, self.text, self.page = section, path, text, page
        self.kind, self.is_quote, self.value, self.unit = kind, is_quote, value, unit
        self.option, self.group, self.field = option, group, field
        self.extra = extra or {}      # label -> string whose $/% amounts must be inside the quote
        self.payload = payload or {}  # extra carried keys (not verified)
        self.scope = scope            # "page" (claimed page +/-1) | "doc"
        # results
        self.verified = False
        self.found_page = None
        self.match = None
        self.reasons: list[str] = []
        self.emit_text = text
        self.degraded: list[str] = []         # quote verified, but derived fields with unverifiable amounts nulled
        self.unverified_fields: list[str] = []
        self.found_elsewhere = None


def _page_val(p):
    return p if _is_int(p) else None


def collect_facts(data: dict) -> list[Fact]:
    facts: list[Fact] = []
    rx = data.get("prescriptions") or {}
    for i, c in enumerate(data.get("changes_for_2027") or []):
        if not isinstance(c, dict):
            continue
        facts.append(Fact("changes_for_2027", f"changes_for_2027[{i}]", c.get("quote"), c.get("page"),
                          is_quote=True, option=c.get("option"),
                          extra={"summary": c.get("summary"), "from": c.get("from"), "to": c.get("to")},
                          payload={"option": c.get("option"), "category": c.get("category"),
                                   "summary": c.get("summary"), "from": c.get("from"), "to": c.get("to")}))
    for i, t in enumerate(rx.get("tiers") or []):
        if not isinstance(t, dict):
            continue
        for cell in ("retail_30", "retail_90", "mail_90"):
            c = t.get(cell)
            if not isinstance(c, dict):
                continue
            txt = c.get("text")
            if txt is None and c.get("value") is None:
                continue
            facts.append(Fact(f"rx.tiers.{cell}", f"prescriptions.tiers[{i}].{cell}", txt, c.get("page"),
                              value=c.get("value"), unit=c.get("unit"), option=t.get("option"),
                              group=("tiers", i), field=cell))
    for i, o in enumerate(rx.get("rx_out_of_pocket_max") or []):
        if isinstance(o, dict):
            facts.append(Fact("rx.rx_oop_max", f"prescriptions.rx_out_of_pocket_max[{i}]", o.get("text"),
                              o.get("page"), value=o.get("value"), unit=o.get("unit"), option=o.get("option")))
    for k in ("prior_authorization", "step_therapy", "quantity_limits", "preventive_drugs_free",
              "glp1_weight_loss", "glp1_diabetes"):
        v = rx.get(k)
        if isinstance(v, dict) and v.get("text"):
            pl = {"covered": v["covered"]} if "covered" in v else {}
            facts.append(Fact(f"rx.{k}", f"prescriptions.{k}", v.get("text"), v.get("page"), payload=pl))
    for k, name in (("pbm_or_pharmacy_program", "pbm"), ("formulary_name", "formulary_name"),
                    ("retail_network", "retail_network"), ("mail_order", "mail_order"),
                    ("specialty_pharmacy", "specialty_pharmacy"),
                    ("generic_substitution_rules", "generic_substitution_rules")):
        if isinstance(rx.get(k), str) and rx[k].strip():
            facts.append(Fact(f"rx.{name}", f"prescriptions.{k}", rx[k], None, kind="name", scope="doc"))
    for k in ("formulary_url", "drug_lookup_url"):
        if isinstance(rx.get(k), str) and rx[k].strip():
            facts.append(Fact(f"rx.{k}", f"prescriptions.{k}", rx[k], None, kind="url", scope="doc"))
    for i, s in enumerate(rx.get("other_notable") or []):
        if isinstance(s, str) and s.strip():
            facts.append(Fact("rx.other_notable", f"prescriptions.other_notable[{i}]", s, None, scope="doc"))
    net = data.get("network") or {}
    for k in ("out_of_network", "referrals_required"):
        v = net.get(k)
        if isinstance(v, dict) and v.get("text"):
            pl = {key: v[key] for key in ("covered", "value") if key in v}
            facts.append(Fact(f"network.{k}", f"network.{k}", v.get("text"), v.get("page"), payload=pl))
    for k, kind in (("name", "name"), ("service_area_text", "text"), ("directory_url", "url")):
        if isinstance(net.get(k), str) and net[k].strip():
            facts.append(Fact(f"network.{k}", f"network.{k}", net[k], None, kind=kind, scope="doc"))
    ms = data.get("member_services") or {}
    mpage = ms.get("page")
    for k, kind in (("phone", "phone"), ("website", "url"), ("telehealth", "text")):
        if isinstance(ms.get(k), str) and ms[k].strip():
            page = ms.get("telehealth_page") if k == "telehealth" and ms.get("telehealth_page") else mpage
            facts.append(Fact(f"member_services.{k}", f"member_services.{k}", ms[k], page, kind=kind,
                              scope="doc"))
    for sec, label in (("prior_approval_required", "service"), ("notable_limits_and_exclusions", "topic")):
        for i, c in enumerate(data.get(sec) or []):
            if isinstance(c, dict) and c.get("text"):
                facts.append(Fact(sec, f"{sec}[{i}]", c.get("text"), c.get("page"),
                                  payload={label: c.get(label)}))
    m = data.get("medicare_coordination_summary")
    if isinstance(m, dict) and m.get("text"):
        facts.append(Fact("medicare_coordination_summary", "medicare_coordination_summary", m["text"],
                          m.get("page")))
    return [f for f in facts if not (isinstance(f.text, str) and f.value is None and ABSENCE_RE.match(f.text))]


def _strip_url(u: str) -> str:
    u = re.sub(r"^\s*https?://", "", u.strip(), flags=re.I)
    return u.rstrip("/.,;)")


def _check_numbers(f: Fact, quote: str):
    if f.value is not None and f.unit in (None, "usd", "pct") and isinstance(f.value, (int, float)) \
            and not isinstance(f.value, bool):
        nums = numbers_in(quote)
        ok = False
        for n, dollar, pct in nums:
            if math.isclose(n, float(f.value), abs_tol=1e-6):
                if f.unit == "usd" and pct and not dollar:
                    continue
                if f.unit == "pct" and not pct:
                    continue
                ok = True
                break
        if not ok and float(f.value) == 0.0 and ZERO_RE.search(quote):
            ok = True
        if not ok:
            f.reasons.append(f"value {f.value} ({f.unit}) not found in text")
    if f.extra:
        qn = money_pct_numbers(quote)
        for label, s in f.extra.items():
            if not isinstance(s, str):
                continue
            missing = sorted(n for n in money_pct_numbers(s) if not any(math.isclose(n, q, abs_tol=1e-6) for q in qn))
            if missing:
                f.degraded.append(f"{label} has amounts not in quote: {missing}")
                if label in f.payload:
                    f.payload[label] = None
                    f.unverified_fields.append(label)


def verify_fact(f: Fact, doc: Doc) -> Fact:
    text = f.text if isinstance(f.text, str) else None
    if not text or not text.strip():
        f.reasons.append("no text/quote")
        return f
    page = _page_val(f.page)
    if f.scope == "page":
        if page is None:
            f.reasons.append(f"bad or missing page {f.page!r}")
            return f
        if not 1 <= page <= doc.n_pages:
            f.reasons.append(f"page {page} outside 1..{doc.n_pages}")
            return f
        pages = doc.scope(page)
    else:
        pages = doc.scope(None)
    prefer = page

    found = None
    if f.kind == "phone":
        groups = re.findall(r"\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}", text)
        if groups:
            for g in groups:
                d = re.sub(r"\D", "", g)
                hits = [p for p in pages if d in doc.digits[p]]
                if hits:
                    found = min(hits, key=lambda p: abs(p - (prefer or p)))
                    f.match = "exact"
                    break
            else:
                f.reasons.append("phone number not in brochure")
                return f
        else:
            f.reasons.append("no phone number parsed")
            return f
    elif f.kind == "url":
        urls = re.findall(r"(?:https?://)?(?:www\.\s?)?[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9\-]+)*\.[a-z]{2,}[^\s;,)]*",
                          text, flags=re.I) or [text]
        okurls = []
        for u in urls:
            pg = doc.find_sq(squash(_strip_url(u)), pages, prefer)
            if pg is not None:
                okurls.append(u)
                found = found if found is not None else pg
        if not okurls:
            f.reasons.append("url not in brochure")
            return f
        f.match = "exact"
        if len(okurls) < len(urls):
            f.match = "partial"
            f.emit_text = "; ".join(okurls)
            f.degraded.append("some urls not in brochure: " + "; ".join(u for u in urls if u not in okurls))
    elif f.is_quote:
        frags = split_fragments(text)
        sq = [squash(x) for x in frags]
        sq = [x for x in sq if x]
        if not sq:
            f.reasons.append("empty quote")
            return f
        pgs = []
        for x in sq:
            pg = doc.find_sq(x, pages, prefer)
            if pg is None:
                f.found_elsewhere = doc.find_sq(x, doc.scope(None), prefer)
                f.reasons.append("quote not found within +/-1 page of claimed page")
                return f
            pgs.append(pg)
        found = pgs[0]
        f.match = "exact"
    else:
        cand = [text]
        stripped = re.sub(r"\s*\([^)]*\)", "", text).strip()
        if f.kind == "name" and stripped and stripped != text:
            cand.append(stripped)
        for c in cand:
            found = doc.find_sq(squash(c), pages, prefer)
            if found is not None:
                f.match = "exact"
                f.emit_text = c
                break
        if found is None and f.kind != "phone":
            score, pg = doc.overlap(text, pages)
            if score >= OVERLAP_MIN:
                found, f.match = pg, "overlap"
            else:
                f.reasons.append(f"text not found in brochure (best token overlap {score:.2f})")
                return f
    f.found_page = found
    if f.kind in ("text", "name") or f.is_quote:
        _check_numbers(f, text)
    f.verified = not f.reasons
    if not f.verified:
        f.found_page = found
    return f


# --------------------------------------------------------------------------- option -> plan code

_DROP = {"option", "options", "plan", "plans", "the", "and"}


def _forms(name: str) -> list[frozenset]:
    """Normalised token sets for a name: whole, without parentheticals, parenthetical alone."""
    out = []
    n = _basic(name)
    paren = re.findall(r"\(([^)]*)\)", n)
    base = re.sub(r"\([^)]*\)", " ", n)
    for s in [base] + paren:
        toks = frozenset(t for t in re.findall(r"[a-z0-9]+", s) if t not in _DROP)
        if toks:
            out.append(toks)
    return out


def match_option(opt, codes: dict[str, list[str]]):
    """codes: plan code -> list of names for that code (option names). Returns (codes, how)."""
    if opt is None or not str(opt).strip() or re.match(r"^\s*all\b", str(opt), re.I):
        return sorted(codes), "all"
    f_opt = _forms(str(opt))
    multi = bool(re.search(r",|/|&|\band\b|\bor\b", str(opt), re.I))  # "A and B": do not match on one part
    if not f_opt:
        return [], "none"

    def level(code):
        best = 0
        for nm in codes[code]:
            for fc in _forms(nm):
                for fo in f_opt:
                    if fo == fc:
                        best = max(best, 3)
                    elif fo <= fc or (fc <= fo and not multi):
                        best = max(best, 2)
        return best

    lv = {c: level(c) for c in codes}
    top = max(lv.values()) if lv else 0
    if top >= 2:
        sel = [c for c in codes if lv[c] == top]
        names = {frozenset(sorted({tuple(sorted(f)) for nm in codes[c] for f in _forms(nm)})) for c in sel}
        if len(names) == 1:
            return sorted(sel), "exact" if top == 3 else "subset"
        # several distinct option names matched at the same level: ambiguous
        return [], "ambiguous"
    # difflib fallback
    best, sel = 0.0, []
    for c in codes:
        for nm in codes[c]:
            r = difflib.SequenceMatcher(None, " ".join(sorted(next(iter(f_opt)))),
                                        " ".join(sorted(next(iter(_forms(nm)), frozenset())))).ratio()
            if r > best + 1e-9:
                best, sel = r, [c]
            elif abs(r - best) < 1e-9 and c not in sel:
                sel.append(c)
    if best >= 0.85:
        return sorted(sel), "fuzzy"
    return [], "none"


def match_option_multi(opt, codes, single_opt_fallback=False):
    """Handle 'A and B' / 'A, B' by splitting when the whole string does not match."""
    got, how = match_option(opt, codes)
    if got or how == "all":
        return got, [], how
    if single_opt_fallback and len(codes) == 1:
        return sorted(codes), [], "single_option_fallback"
    parts = [p.strip() for p in re.split(r",|/|&|\band\b|\bor\b", str(opt)) if p.strip()]
    if len(parts) > 1:
        gs, bad = [], []
        for p in parts:
            g, h = match_option(p, codes)
            if g:
                gs.extend(g)
            else:
                bad.append(p)
        if gs:
            return sorted(set(gs)), bad, "split"
    return [], [str(opt)], how


# --------------------------------------------------------------------------- crosscheck

def parse_sheet_copay(raw):
    if not isinstance(raw, str):
        return None
    m = re.search(r"\$\s?(\d[\d,]*(?:\.\d+)?)", raw)
    if m:
        return ("usd", float(m.group(1).replace(",", "")))
    m = re.search(r"(\d+(?:\.\d+)?)\s?%", raw)
    if m:
        return ("pct", float(m.group(1)))
    if re.search(r"no charge|nothing|\bfree\b", raw, re.I):
        return ("usd", 0.0)
    return None


def tier_number(label):
    m = re.search(r"tier\s*([1-5])\b", label or "", re.I)
    return int(m.group(1)) if m else None


def crosscheck_tier(tier_label, retail30: dict | None, raw: dict | None):
    n = tier_number(tier_label)
    if n is None or not raw or not retail30:
        return "n/a", None
    sheet = raw.get(f"Tier {n}")
    got = parse_sheet_copay(sheet)
    v, u = retail30.get("value"), retail30.get("unit")
    if got is None or v is None or u not in ("usd", "pct"):
        return "n/a", sheet
    if got[0] == u and math.isclose(got[1], float(v), abs_tol=0.005):
        return "match", sheet
    return "mismatch", sheet


def alt_sheet_tier(tier_label, retail30, raw):
    """Other spreadsheet tier numbers whose copay equals the extraction value (hints at a tier-numbering shift)."""
    n = tier_number(tier_label)
    out = []
    for k in range(1, 6):
        if k == n:
            continue
        got = parse_sheet_copay((raw or {}).get(f"Tier {k}"))
        if got and got[0] == retail30.get("unit") and math.isclose(got[1], float(retail30["value"]), abs_tol=0.005):
            out.append(k)
    return out


# --------------------------------------------------------------------------- run

def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def validate_brochure(num: str, ext_dir: Path, txt_dir: Path):
    """-> (data|None, doc|None, facts, report dict)"""
    rep = {"brochure": num, "carrier": None, "facts": 0, "verified": 0, "verified_pct": None,
           "tiers": 0, "structural_errors": [], "options_check": {}, "failures": [], "flagged": 0}
    tp, ep = txt_dir / f"{num}.txt", ext_dir / f"{num}.json"
    if not tp.exists():
        rep["structural_errors"].append("brochure text file missing")
        return None, None, [], rep
    doc = Doc(load_pages(tp))
    rep["doc_pages"] = doc.n_pages
    try:
        data = read_json(ep)
    except Exception as e:  # noqa: BLE001
        rep["structural_errors"].append(f"cannot load JSON: {e}")
        return None, doc, [], rep
    rep["structural_errors"] = validate_structure(data, doc.n_pages)
    if not isinstance(data, dict):
        return None, doc, [], rep
    rep["carrier"] = data.get("carrier")
    rep["tiers"] = len((data.get("prescriptions") or {}).get("tiers") or [])
    if data.get("brochure") != num:
        rep["structural_errors"].append(f"brochure field {data.get('brochure')!r} != {num}")
    for o in data.get("options") or []:
        if not isinstance(o, str):
            continue
        cands = [o, re.sub(r"\b(option|plan)s?\b", " ", o, flags=re.I)] + re.findall(r"\(([^)]*)\)", o)
        ok = any(squash(c) and squash(c) in doc.all_sq for c in cands)
        rep["options_check"][o] = ok
    facts = collect_facts(data)
    for f in facts:
        verify_fact(f, doc)
    rep["facts"] = len(facts)
    rep["verified"] = sum(f.verified for f in facts)
    rep["verified_pct"] = round(100.0 * rep["verified"] / len(facts), 1) if facts else None
    for f in facts:
        if f.verified and f.degraded:
            rep.setdefault("degraded", []).append({"path": f.path, "notes": f.degraded})
        if not f.verified:
            q = f.text if isinstance(f.text, str) else None
            rep["failures"].append({"path": f.path, "claimed_page": f.page, "found_elsewhere_page": f.found_elsewhere,
                                    "quote": q[:MAX_QUOTE] if q else q, "reasons": f.reasons})
    rep["flagged"] = (len(rep["failures"]) + len(rep["structural_errors"])
                      + sum(1 for v in rep["options_check"].values() if not v))
    return data, doc, facts, rep


def trim(s):
    return s if not isinstance(s, str) or len(s) <= MAX_QUOTE else s[: MAX_QUOTE - 1].rstrip() + "…"


def fact_obj(f: Fact, trim_quotes=False):
    q = f.emit_text
    o = {"quote": trim(q) if trim_quotes else q, "page": f.found_page}
    if _page_val(f.page) is not None and f.page != f.found_page:
        o["claimed_page"] = f.page
    if f.value is not None:
        o["value"] = f.value
        o["unit"] = f.unit
    o.update(f.payload)
    o["match"] = f.match
    if f.unverified_fields:
        o["unverified_fields_removed"] = f.unverified_fields
    return o


def build_brochure_entries(num, data, facts, codes_names, bench, trim_quotes):
    """Group verified facts by plan code. Returns (per_code dict, unmatched dict, dropped Counter, stats)."""
    per_code = {c: {"brochure": num, "option": None,
                    "rx": {"tiers": [], "rx_oop_max": [], "other_notable": []},
                    "changes_2027": [], "network": {}, "member_services": {},
                    "prior_approval_required": [], "limits_and_exclusions": [],
                    "medicare_coordination_summary": None} for c in codes_names}
    for c, names in codes_names.items():
        per_code[c]["option"] = names[0] if names else None
    unmatched: dict[str, dict] = defaultdict(lambda: {"changes_2027": [], "rx_tiers": [], "rx_oop_max": []})
    dropped: Counter = Counter()
    match_log = []
    n_opts = len([o for o in (data.get("options") or []) if isinstance(o, str)])
    cache: dict = {}

    def targets(opt):
        key = opt if isinstance(opt, str) else None
        if key not in cache:
            cache[key] = match_option_multi(opt, codes_names, single_opt_fallback=(n_opts == 1))
        return cache[key]

    # ---- tiers (grouped cells)
    tier_cells: dict = defaultdict(dict)
    tier_src = {}
    for f in facts:
        if f.group:
            tier_src[f.group] = f
            if f.verified:
                tier_cells[f.group][f.field] = f
            else:
                dropped[f.section] += 1
        elif not f.verified:
            dropped[f.section] += 1
    tiers = (data.get("prescriptions") or {}).get("tiers") or []
    for (g, i), cells in sorted(tier_cells.items()):
        t = tiers[i]
        base = {"option": t.get("option"), "tier": t.get("tier"), "label": t.get("label"),
                "deductible_applies": t.get("deductible_applies")}
        for cell in ("retail_30", "retail_90", "mail_90"):
            base[cell] = fact_obj(cells[cell], trim_quotes) if cell in cells else None
        got, bad, how = targets(t.get("option"))
        match_log.append((t.get("option"), how, bool(got)))
        for c in got:
            tier = dict(base)
            if cells.get("retail_30") is not None:
                r30 = {"value": cells["retail_30"].value, "unit": cells["retail_30"].unit}
                tier["crosscheck"], sheet = crosscheck_tier(t.get("tier"), r30, (bench.get(c) or {}).get("raw"))
                if tier["crosscheck"] == "mismatch":
                    tier["crosscheck_sheet"] = sheet
                    tier["_alt"] = alt_sheet_tier(t.get("tier"), r30, (bench.get(c) or {}).get("raw"))
            else:
                tier["crosscheck"] = "n/a"
            per_code[c]["rx"]["tiers"].append(tier)
        if bad or not got:
            unmatched[str(t.get("option"))]["rx_tiers"].append(base)

    for f in facts:
        if not f.verified or f.group:
            continue
        o = fact_obj(f, trim_quotes)
        s = f.section
        if s == "changes_for_2027":
            got, bad, how = targets(f.option)
            match_log.append((f.option, how, bool(got)))
            for c in got:
                per_code[c]["changes_2027"].append(o)
            if bad or not got:
                unmatched[str(f.option)]["changes_2027"].append(o)
        elif s == "rx.rx_oop_max":
            got, bad, how = targets(f.option)
            o["option"] = f.option
            match_log.append((f.option, how, bool(got)))
            for c in got:
                per_code[c]["rx"]["rx_oop_max"].append(o)
            if bad or not got:
                unmatched[str(f.option)]["rx_oop_max"].append(o)
        else:
            for c in per_code:
                p = per_code[c]
                if s == "rx.other_notable":
                    p["rx"]["other_notable"].append(o)
                elif s.startswith("rx."):
                    p["rx"][s[3:]] = o
                elif s.startswith("network."):
                    p["network"][s[8:]] = o
                elif s.startswith("member_services."):
                    p["member_services"][s[16:]] = o
                elif s == "prior_approval_required":
                    p["prior_approval_required"].append(o)
                elif s == "notable_limits_and_exclusions":
                    p["limits_and_exclusions"].append(o)
                elif s == "medicare_coordination_summary":
                    p["medicare_coordination_summary"] = o
    net = data.get("network") or {}
    if isinstance(net.get("type"), str):
        for c in per_code:
            per_code[c]["network"]["type"] = net["type"]
            per_code[c]["network"]["derived_fields"] = ["type"]
    for c in per_code:
        for k in ("pbm", "formulary_name", "formulary_url", "drug_lookup_url", "retail_network", "mail_order",
                  "specialty_pharmacy", "prior_authorization", "step_therapy", "quantity_limits",
                  "glp1_weight_loss", "glp1_diabetes", "preventive_drugs_free", "generic_substitution_rules"):
            per_code[c]["rx"].setdefault(k, None)
    return per_code, dict(unmatched), dropped, match_log


def run(args) -> int:
    ext_dir = Path(args.extractions)
    txt_dir = Path(args.text)
    manifest = read_json(ROOT / "data" / "brochures.json")[YEAR]
    plans = {p["code"]: p for p in read_json(ROOT / "data" / "plans.json") if str(p.get("year")) == YEAR}
    bench = read_json(ROOT / "data" / "benefits.json")[YEAR]

    nums = sorted(p.stem for p in ext_dir.glob("*.json"))
    reports, built = {}, {}
    totals = Counter()
    for n in nums:
        data, doc, facts, rep = validate_brochure(n, ext_dir, txt_dir)
        reports[n] = rep
        totals["facts"] += rep["facts"]
        totals["verified"] += rep["verified"]
        if data is not None:
            built[n] = (data, facts)
        if n not in manifest:
            rep["structural_errors"].append("brochure not in data/brochures.json")

    # ---- summary table
    print(f"{'brochure':9} {'carrier':32} {'facts':>5} {'ver%':>6} {'tiers':>5} {'flagged':>7}")
    for n, r in reports.items():
        pct = "-" if r["verified_pct"] is None else f"{r['verified_pct']:.1f}"
        print(f"{n:9} {(r['carrier'] or '?')[:32]:32} {r['facts']:5d} {pct:>6} {r['tiers']:5d} {r['flagged']:7d}")
    tp = 100.0 * totals["verified"] / totals["facts"] if totals["facts"] else 0.0
    print(f"{'TOTAL':9} {'':32} {totals['facts']:5d} {tp:6.1f}")

    # ---- facts file + crosscheck
    cc_counts, cc_all = Counter(), []
    match_stats = Counter()
    unmatched_report = {}
    out_report = {"generated": args.date, "totals": {"facts": totals["facts"], "verified": totals["verified"],
                                                      "verified_pct": round(tp, 2)},
                  "brochures": reports}
    if not args.no_facts:
        meta_dropped = {"total": 0, "by_section": Counter(), "by_brochure": {}}
        plans_out, meta_b = {}, {}
        for n, (data, facts) in built.items():
            m = manifest.get(n)
            if not m:
                continue
            codes_names = {}
            for c in m["plan_codes"]:
                names = []
                for nm in ((bench.get(c) or {}).get("raw", {}).get("Plan Option Name"), (plans.get(c) or {}).get("option")):
                    if nm and nm not in names:
                        names.append(nm)
                codes_names[c] = names
            per_code, unmatched, dropped, mlog = build_brochure_entries(n, data, facts, codes_names, bench,
                                                                         args.trim_quotes)
            for opt, how, ok in mlog:
                match_stats["matched" if ok else "unmatched"] += 1
                match_stats[f"how:{how}"] += 1
            for c, p in per_code.items():
                plans_out[c] = p
                for t in p["rx"]["tiers"]:
                    alt = t.pop("_alt", None)
                    cc_counts[t["crosscheck"]] += 1
                    if t["crosscheck"] == "mismatch":
                        cc_all.append({"brochure": n, "plan_code": c, "option": p["option"], "tier": t["tier"],
                                       "extraction": (t["retail_30"] or {}).get("quote"),
                                       "extraction_value": [(t["retail_30"] or {}).get("value"),
                                                            (t["retail_30"] or {}).get("unit")],
                                       "spreadsheet": (bench.get(c) or {}).get("raw", {}).get(
                                           f"Tier {tier_number(t['tier'])}"),
                                       "page": (t["retail_30"] or {}).get("page"),
                                       "extraction_value_matches_sheet_tier": alt})
            meta_b[n] = {"url": m["url"], "sha256": m["sha256"], "pages": m["pages"], "plan_codes": m["plan_codes"]}
            if unmatched:
                meta_b[n]["unmatched_options"] = unmatched
                unmatched_report[n] = {o: {k: len(v) for k, v in d.items()} for o, d in unmatched.items()}
            d_tot = sum(dropped.values())
            meta_dropped["total"] += d_tot
            meta_dropped["by_section"].update(dropped)
            meta_dropped["by_brochure"][n] = d_tot
        meta_dropped["by_section"] = dict(sorted(meta_dropped["by_section"].items()))
        out = {"meta": {"source": "OPM 2027 brochures", "generated": args.date, "dropped": meta_dropped,
                        "kept_facts": totals["verified"],
                        "notes": ["Only facts whose quote/text was verified against the brochure text are included.",
                                  "match=exact: normalized substring; match=overlap: >=80% token overlap (not verbatim).",
                                  "tier label/deductible_applies, network.type, covered/value flags and "
                                  "prior-approval/limit labels are extraction-derived, not verbatim-verified.",
                                  "tier notes are not carried.",
                                  "crosscheck compares Tier N retail 30-day copay with data/benefits.json raw 'Tier N'."],
                        "brochures": meta_b},
               "plans": plans_out}
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        txt = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
        out_path.write_text(txt, encoding="utf-8")
        out_report["crosscheck"] = {"counts": dict(cc_counts), "mismatch_total": len(cc_all),
                                    "mismatch_examples": cc_all[:10], "mismatches": cc_all}
        out_report["option_matching"] = {"matched": match_stats["matched"], "unmatched": match_stats["unmatched"],
                                         "how": {k[4:]: v for k, v in match_stats.items() if k.startswith("how:")},
                                         "unmatched_options": unmatched_report}
        out_report["facts_file_bytes"] = len(txt.encode("utf-8"))
        print(f"\nwrote {out_path} ({len(txt.encode('utf-8')) / 1e6:.2f} MB); dropped {meta_dropped['total']}")
        print(f"crosscheck: {dict(cc_counts)}; option matching: matched {match_stats['matched']}, "
              f"unmatched {match_stats['unmatched']}")
    rp = Path(args.report)
    rp.parent.mkdir(parents=True, exist_ok=True)
    rp.write_text(json.dumps(out_report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {rp}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--extractions", default=str(PIPELINE / "raw" / "extractions" / YEAR))
    ap.add_argument("--text", default=str(PIPELINE / "raw" / "brochures_txt" / YEAR))
    ap.add_argument("--report", default=str(PIPELINE / "raw" / "validation_report.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "brochure_facts.json"))
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--no-facts", action="store_true", help="validate only; do not write data/brochure_facts.json")
    ap.add_argument("--trim-quotes", action="store_true", help=f"trim emitted quotes to {MAX_QUOTE} chars")
    args = ap.parse_args(argv)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
