"""Tests for pipeline/build_zip_county.py and data/zip_county.json (Census ZCTA -> county lookup)."""
import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
ROOT = PIPELINE.parent
sys.path.insert(0, str(PIPELINE))

import build_zip_county as bzc  # noqa: E402

HEADER = "﻿" + "|".join(bzc.COLUMNS)


def row(zcta, fips, name, land, water=0):
    cells = [""] * len(bzc.COLUMNS)
    cells[bzc.COL["GEOID_ZCTA5_20"]] = zcta
    cells[bzc.COL["GEOID_COUNTY_20"]] = fips
    cells[bzc.COL["NAMELSAD_COUNTY_20"]] = name
    cells[bzc.COL["AREALAND_PART"]] = str(land)
    cells[bzc.COL["AREAWATER_PART"]] = str(water)
    return "|".join(cells)


def test_header_must_match():
    bad = HEADER.replace("GEOID_COUNTY_20", "GEOID_COUNTY")
    with pytest.raises(ValueError, match="header"):
        bzc.parse([bad])
    with pytest.raises(ValueError, match="columns"):
        bzc.parse(["A|B|C"])
    with pytest.raises(ValueError, match="empty"):
        bzc.parse([])


def test_threshold_slivers_and_shapes():
    lines = [
        HEADER,
        row("", "51059", "Fairfax County", 0),            # county land outside any ZCTA: skipped
        row("22302", "51510", "Alexandria city", 1000),
        row("22302", "51059", "Fairfax County", 49),     # 4.7%: a sliver, ignored
        row("20181", "51153", "Prince William County", 600),
        row("20181", "51061", "Fauquier County", 400),
        row("99999", "02016", "Aleutians West Census Area", 0, 50),  # water only: largest water part
        row("99999", "02013", "Aleutians East Borough", 0, 10),
    ]
    zips, names = bzc.parse(lines)
    assert zips["22302"] == "51510"
    assert zips["20181"] == ["51061", "51153"]  # several -> array sorted by FIPS
    assert zips["99999"] == "02016"
    assert names == {"51061": "Fauquier County", "51153": "Prince William County"}


def test_bad_row_fails_loudly():
    with pytest.raises(ValueError, match="line 2"):
        bzc.parse([HEADER, "1|2|3"])
    with pytest.raises(ValueError, match="bad ZCTA"):
        bzc.parse([HEADER, row("2230", "51510", "x", 1)])


def test_inversion_round_trips():
    zips = {"20181": ["51061", "51153"], "22302": "51510", "22301": "51510"}
    counties = bzc.counties_from_zips(zips)
    assert counties == {"51061": "20181", "51153": "20181", "51510": "22301 22302"}
    assert bzc.zips_from_counties(counties) == dict(sorted(zips.items()))


@pytest.fixture(scope="module")
def doc():
    return json.loads((ROOT / "data" / "zip_county.json").read_text(encoding="utf-8"))


def test_built_file(doc):
    m = doc["meta"]
    assert m["threshold"] == bzc.THRESHOLD and "Census" in m["source"] and m["url"].startswith("https://www2.census.gov/")
    assert "ZCTA" in m["note"] and "not the same" in m["note"]
    zips = bzc.zips_from_counties(doc["counties"])
    assert len(zips) > 30000
    assert zips["22302"] == "51510"          # Alexandria city, VA
    assert zips["24011"] == "51770"          # Roanoke city, VA
    assert zips["20181"] == ["51061", "51153"]  # Nokesville: Fauquier + Prince William
    assert doc["names"]["51153"] == "Prince William County"
    # names only for counties that share a ZIP with another county
    multi = {f for v in zips.values() if isinstance(v, list) for f in v}
    assert set(doc["names"]) == multi
    assert (ROOT / "data" / "zip_county.json").stat().st_size < 600 * 1024


@pytest.mark.skipif(not bzc.RAW.exists(), reason="raw Census file not downloaded")
def test_built_file_matches_raw(doc):
    fresh = bzc.build()
    assert fresh["counties"] == doc["counties"]
    assert fresh["names"] == doc["names"]
