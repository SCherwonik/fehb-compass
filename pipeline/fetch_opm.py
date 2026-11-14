"""Download OPM FEHB / FEDVIP public-use files into pipeline/raw/."""
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = (
    "https://www.opm.gov/healthcare-insurance/healthcare/"
    "transparency-in-healthcare/public-use-files/"
)

_PATHS = {
    "FEHB_2027_PLAN_KEY": "2027/fehb/2027-fehb-plan-key_101526.xlsx",
    "FEHB_2027_RATES": "2027/fehb/2027-fehb-rates_092926.xlsx",
    "FEHB_2027_BENEFITS": "2027/fehb/2027-fehb-plan-benefits_102626.xlsx",
    "FEHB_2027_SERVICE_AREA": "2027/fehb/2027-fehb-service-area_100926.xlsx",
    "FEHB_2027_PAYROLL_RATES": "2027/fehb/2027-fehb-payroll-rates_092926.xlsx",
    "FEDVIP_2027_PLAN_KEY": "2027/fedvip/2027-fedvip-plan-key_092926.xlsx",
    "FEDVIP_2027_RATES": "2027/fedvip/2027-fedvip-rates_092926.xlsx",
    "FEDVIP_2027_RATING_REGIONS": "2027/fedvip/2027-dental-rating-region_093026.xlsx",
    "FEDVIP_2027_BENEFITS": "2027/fedvip/2027-fedvip-benefits_092926.xlsx",
    "FEDVIP_2027_ZIPCODES": "2027/fedvip/2027-fedvip-zipcodes_092926.xlsx",
    "FEHB_2026_PLAN_KEY": "2026/fehb/2026-fehb-plan-key-11202025.xlsx",
    "FEHB_2026_RATES": "2026/fehb/2026-fehb-rates-10232025.xlsx",
    "FEHB_2026_BENEFITS": "2026/fehb/2026-fehb-plan-benefits-11202025.xlsx",
    "FEHB_2026_SERVICE_AREA": "2026/fehb/2026-fehb-service-area-03242026.xlsx",
    "FEHB_2026_PAYROLL_RATES": "2026/fehb/2026-fehb-payroll-rates-100525.xlsx",
    "FEDVIP_2026_PLAN_KEY": "2026/fedvip/2026-fedvip-plan-key-100525.xlsx",
    "FEDVIP_2026_RATES": "2026/fedvip/2026-fedvip-rates-100525.xlsx",
    "FEDVIP_2026_RATING_REGIONS": "2026/fedvip/2026-dental-rating-regions-100525.xlsx",
    "FEDVIP_2026_BENEFITS": "2026/fedvip/2026-plan-benefits-100525.xlsx",
    "FEDVIP_2026_ZIPCODES": "2026/fedvip/2026-zip-codes-100525.xlsx",
}

FILES: dict[str, str] = {k: BASE + v for k, v in _PATHS.items()}

DEFAULT_DEST = Path(__file__).resolve().parent / "raw"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _get(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def _is_xlsx(data: bytes) -> bool:
    return data[:2] == b"PK"


def fetch(url: str) -> bytes:
    """GET url; retry with a browser User-Agent on 403 or non-XLSX body."""
    try:
        data = _get(url)
        if _is_xlsx(data):
            return data
    except urllib.error.HTTPError as e:
        if e.code != 403:
            raise
    data = _get(url, {"User-Agent": BROWSER_UA, "Accept": "*/*"})
    if not _is_xlsx(data):
        raise ValueError(f"Not an XLSX body: {url}")
    return data


def download_all(dest: Path = DEFAULT_DEST) -> dict[str, Path]:
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for name, url in FILES.items():
        path = dest / url.rsplit("/", 1)[1]
        if not path.exists():
            print(f"downloading {name}")
            path.write_bytes(fetch(url))
        out[name] = path
    return out


if __name__ == "__main__":
    paths = download_all()
    print(f"{len(paths)} files in {DEFAULT_DEST}")
    sys.exit(0)
