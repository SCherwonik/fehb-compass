"""Build data/zip_county.json: ZIP code -> county FIPS lookup for the service-area check.

Run:  python -I pipeline/build_zip_county.py   (reads the Census file already in pipeline/raw/census/)

OPM's service-area file lists a regional plan's coverage as county FIPS codes (plus some
ZIP codes) but has no ZIP -> county map, so a ZIP alone could not confirm a county-listed
plan. This adds one from the U.S. Census Bureau's 2020 ZCTA-to-county relationship file
(a U.S. government work), downloaded once into pipeline/raw/census/ (git-ignored).

Output shape (compact JSON):
  meta      {source, url, file, generated, threshold, format, note}
  counties  {countyFips: "zip5 zip5 ..."}          (the ZIPs each county holds, space-separated, sorted)
  names     {countyFips: "Fairfax County"}         (only counties in a multi-county ZIP)

The lookup the app uses is ZIP -> county, {zip5: countyFips | [countyFips, ...]} (an array, sorted by
FIPS, when a ZIP is in several counties): `zips_from_counties` here and `zipCountyLookup` in
src/data.js invert the file into it. It is stored inverted because a ZIP-keyed object is about
630 KB while the county-keyed one is less than half of that.

For each ZCTA, a county is kept when its share of the ZCTA's land area (AREALAND_PART over
the ZCTA's total land overlap) is at least THRESHOLD; slivers below that are ignored. ZCTAs
with no land overlap at all (water-only) fall back to their largest water overlap.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data as bd  # noqa: E402

RAW = Path(__file__).resolve().parent / "raw" / "census" / "tab20_zcta520_county20_natl.txt"
URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
THRESHOLD = 0.05

COLUMNS = [
    "OID_ZCTA5_20", "GEOID_ZCTA5_20", "NAMELSAD_ZCTA5_20", "AREALAND_ZCTA5_20", "AREAWATER_ZCTA5_20",
    "MTFCC_ZCTA5_20", "CLASSFP_ZCTA5_20", "FUNCSTAT_ZCTA5_20", "OID_COUNTY_20", "GEOID_COUNTY_20",
    "NAMELSAD_COUNTY_20", "AREALAND_COUNTY_20", "AREAWATER_COUNTY_20", "MTFCC_COUNTY_20", "CLASSFP_COUNTY_20",
    "FUNCSTAT_COUNTY_20", "AREALAND_PART", "AREAWATER_PART",
]
COL = {name: i for i, name in enumerate(COLUMNS)}

NOTE = (
    "ZIP code -> county FIPS, from the U.S. Census Bureau 2020 ZCTA-to-county relationship file "
    "(a U.S. government work, not copyrighted). ZCTAs (ZIP Code Tabulation Areas) approximate USPS ZIP "
    "codes but are not the same thing: PO-box-only and single-building ZIPs have no ZCTA and are absent "
    "here, ZIP boundaries change after 2020, and a ZCTA is built from census blocks, so its edges can "
    "differ from mail delivery routes. A county is listed for a ZIP when it holds at least the threshold "
    "share of that ZCTA's land area (smaller slivers are ignored). Use it to confirm a plan's county-based "
    "service area, not as an address lookup; 'names' carries county names only for ZIPs in several counties."
)


def parse(lines, threshold: float = THRESHOLD, path: Path = RAW) -> tuple[dict, dict]:
    """Rows of the pipe-delimited file -> (zips {zip5: fips | [fips]}, names {fips: name} for multi-county ZIPs)."""
    it = iter(lines)
    try:
        header = next(it).lstrip("﻿").rstrip("\r\n").split("|")
    except StopIteration:
        raise ValueError(f"{path.name}: empty file") from None
    if len(header) != len(COLUMNS):
        raise ValueError(f"{path.name}: {len(header)} columns, expected {len(COLUMNS)}")
    bd.expect_header(path, header, COLUMNS)

    land: dict[str, dict[str, int]] = defaultdict(dict)
    water: dict[str, dict[str, int]] = defaultdict(dict)
    county_name: dict[str, str] = {}
    for n, line in enumerate(it, 2):
        line = line.rstrip("\r\n")
        if not line:
            continue
        cells = line.split("|")
        if len(cells) != len(COLUMNS):
            raise ValueError(f"{path.name}: line {n} has {len(cells)} columns, expected {len(COLUMNS)}")
        zcta = cells[COL["GEOID_ZCTA5_20"]].strip()
        if not zcta:
            continue  # county land not covered by any ZCTA
        fips = cells[COL["GEOID_COUNTY_20"]].strip()
        if not (len(zcta) == 5 and zcta.isdigit() and len(fips) == 5 and fips.isdigit()):
            raise ValueError(f"{path.name}: line {n}: bad ZCTA {zcta!r} or county {fips!r}")
        land[zcta][fips] = land[zcta].get(fips, 0) + int(cells[COL["AREALAND_PART"]] or 0)
        water[zcta][fips] = water[zcta].get(fips, 0) + int(cells[COL["AREAWATER_PART"]] or 0)
        county_name.setdefault(fips, cells[COL["NAMELSAD_COUNTY_20"]].strip())

    zips: dict = {}
    names: dict[str, str] = {}
    for zcta in sorted(land):
        parts = land[zcta]
        total = sum(parts.values())
        if total > 0:
            keep = sorted(f for f, a in parts.items() if a / total >= threshold)
        else:  # water-only ZCTA: its largest water overlap
            keep = [max(sorted(water[zcta]), key=lambda f: water[zcta][f])]
        if len(keep) == 1:
            zips[zcta] = keep[0]
        else:
            zips[zcta] = keep
            for f in keep:
                names[f] = county_name.get(f, "")
    return zips, dict(sorted(names.items()))


def counties_from_zips(zips: dict) -> dict[str, str]:
    """{zip5: fips | [fips]} -> {fips: "zip5 zip5 ..."} (the stored, inverted form)."""
    by: dict[str, list[str]] = defaultdict(list)
    for z in sorted(zips):
        for f in zips[z] if isinstance(zips[z], list) else [zips[z]]:
            by[f].append(z)
    return {f: " ".join(by[f]) for f in sorted(by)}


def zips_from_counties(counties: dict) -> dict:
    """The stored {fips: "zip5 ..."} -> {zip5: fips | [fips sorted]} (mirrors zipCountyLookup in src/data.js)."""
    acc: dict[str, list[str]] = defaultdict(list)
    for f in sorted(counties):
        for z in counties[f].split():
            acc[z].append(f)
    return {z: (v[0] if len(v) == 1 else v) for z, v in sorted(acc.items())}


def build(path: Path = RAW, threshold: float = THRESHOLD) -> dict:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        zips, names = parse(fh, threshold, path)
    return {
        "meta": {
            "source": "U.S. Census Bureau, 2020 ZCTA to County Relationship File",
            "url": URL,
            "file": path.name,
            "generated": date.today().isoformat(),
            "threshold": threshold,
            "format": "counties[countyFips] = the ZIP codes (ZCTAs) in that county, space-separated; invert it for "
                      "ZIP -> county (a ZIP listed under several counties is in all of them). names[countyFips] = "
                      "Census county name, only for counties that share a ZIP with another county.",
            "note": NOTE,
        },
        "counties": counties_from_zips(zips),
        "names": names,
    }


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"missing raw Census file: {RAW} (download it from {URL})")
    doc = build()
    zips = zips_from_counties(doc["counties"])
    multi = sum(1 for v in zips.values() if isinstance(v, list))
    bd.write_json("zip_county.json", doc)
    print(f"  {len(zips)} ZIPs ({multi} in several counties) in {len(doc['counties'])} counties, "
          f"{len(doc['names'])} county names")


if __name__ == "__main__":
    main()
