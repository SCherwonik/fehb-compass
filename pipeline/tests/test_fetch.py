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
