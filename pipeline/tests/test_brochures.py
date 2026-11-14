import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import brochures as b  # noqa: E402


def test_parse_brochure_number():
    assert b.parse_brochure_number("RI 71-005") == "71-005"
    assert b.parse_brochure_number("RI-73 899") == "73-899"
    with pytest.raises(ValueError):
        b.parse_brochure_number("nonsense")


def test_mapping_covers_all_plan_codes_once():
    import json
    codes_in_file = set(json.load(open(b.BENEFITS, encoding="utf-8"))[b.YEAR])
    m = b.build_mapping()
    all_codes = [c for e in m.values() for c in e["plan_codes"]]
    assert len(all_codes) == 118 == len(set(all_codes))
    assert set(all_codes) == codes_in_file
    assert all(e["plan_names"] for e in m.values())


def test_pdf_magic_rejects_html():
    assert b.is_pdf(b"%PDF-1.7\n...")
    assert not b.is_pdf(b"<!DOCTYPE html><html>")


def test_atomic_write_ok_and_no_part_on_failure(tmp_path, monkeypatch):
    p = str(tmp_path / "x.pdf")
    b.atomic_write(p, b"%PDF-1")
    assert open(p, "rb").read() == b"%PDF-1"
    assert not os.path.exists(p + ".part")

    def boom(src, dst):
        raise OSError("nope")
    monkeypatch.setattr(b.os, "replace", boom)
    q = str(tmp_path / "y.pdf")
    with pytest.raises(OSError):
        b.atomic_write(q, b"data")
    assert not os.path.exists(q) and not os.path.exists(q + ".part")


def test_page_delimiter_format():
    out = b.format_pages(["alpha\n", "beta"])
    assert out == "=== PAGE 1 ===\nalpha\n=== PAGE 2 ===\nbeta\n"
