import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import fetch_opm  # noqa: E402


def test_files_cover_both_years():
    assert "FEHB_2027_RATES" in fetch_opm.FILES
    assert "FEHB_2026_RATES" in fetch_opm.FILES
    for name, url in fetch_opm.FILES.items():
        assert url.startswith("https://www.opm.gov/"), name
        assert url.endswith(".xlsx"), name


def test_expected_keys_present():
    for year in (2026, 2027):
        for k in ("RATES", "PLAN_KEY", "BENEFITS", "SERVICE_AREA", "PAYROLL_RATES"):
            assert f"FEHB_{year}_{k}" in fetch_opm.FILES
        for k in ("RATES", "BENEFITS", "ZIPCODES", "RATING_REGIONS", "PLAN_KEY"):
            assert f"FEDVIP_{year}_{k}" in fetch_opm.FILES
    assert len(fetch_opm.FILES) == 20


# --- download_all / fetch without network ---

import urllib.error  # noqa: E402

import pytest  # noqa: E402

XLSX = b"PK\x03\x04fake-xlsx-body"


def _one_file(monkeypatch):
    monkeypatch.setattr(
        fetch_opm, "FILES", {"X": "https://www.opm.gov/a/b/file.xlsx"}
    )


def test_download_all_skips_existing(tmp_path, monkeypatch):
    _one_file(monkeypatch)
    (tmp_path / "file.xlsx").write_bytes(b"existing")

    def boom(*a, **k):
        raise AssertionError("network called")

    monkeypatch.setattr(fetch_opm, "_get", boom)
    out = fetch_opm.download_all(tmp_path)
    assert out["X"].read_bytes() == b"existing"


def test_download_all_writes_file(tmp_path, monkeypatch):
    _one_file(monkeypatch)
    monkeypatch.setattr(fetch_opm, "_get", lambda url, headers=None: XLSX)
    out = fetch_opm.download_all(tmp_path)
    assert out["X"].read_bytes() == XLSX
    assert list(tmp_path.glob("*.part")) == []


def test_fetch_rejects_non_xlsx_after_retry(monkeypatch):
    calls = []

    def fake(url, headers=None):
        calls.append(headers)
        return b"<html>blocked</html>"

    monkeypatch.setattr(fetch_opm, "_get", fake)
    with pytest.raises(ValueError):
        fetch_opm.fetch("https://www.opm.gov/x.xlsx")
    assert len(calls) == 2
    assert calls[1] and "User-Agent" in calls[1]


def test_fetch_retries_on_403(monkeypatch):
    def fake(url, headers=None):
        if not headers:
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, None)
        return XLSX

    monkeypatch.setattr(fetch_opm, "_get", fake)
    assert fetch_opm.fetch("https://www.opm.gov/x.xlsx") == XLSX


def test_failure_leaves_no_file_or_part(tmp_path, monkeypatch):
    _one_file(monkeypatch)
    monkeypatch.setattr(fetch_opm, "_get", lambda url, headers=None: b"nope")
    with pytest.raises(ValueError):
        fetch_opm.download_all(tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_failed_rename_cleans_part(tmp_path, monkeypatch):
    _one_file(monkeypatch)
    monkeypatch.setattr(fetch_opm, "_get", lambda url, headers=None: XLSX)

    def bad_replace(src, dst):
        raise OSError("disk")

    monkeypatch.setattr(fetch_opm.os, "replace", bad_replace)
    with pytest.raises(OSError):
        fetch_opm.download_all(tmp_path)
    assert list(tmp_path.iterdir()) == []
