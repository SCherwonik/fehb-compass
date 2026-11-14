"""Write a readable schema report (sheets, header row, 3 sample rows) for raw OPM files."""
from pathlib import Path

import openpyxl

from fetch_opm import DEFAULT_DEST, FILES

REPORT = Path(__file__).resolve().parent / "schema_report.txt"


def _fmt(row) -> str:
    return " | ".join("" if v is None else str(v) for v in row)


def _is_header(row) -> bool:
    """>= 3 non-empty cells, mostly text (not numbers)."""
    cells = [v for v in row if v is not None and str(v).strip() != ""]
    if len(cells) < 3:
        return False
    text = sum(1 for v in cells if isinstance(v, str))
    return text / len(cells) > 0.5


def find_header_index(rows) -> int:
    """Index of the first header-looking row in the first ~5 rows; falls back to 0."""
    for i, row in enumerate(rows[:5]):
        if _is_header(row):
            return i
    return 0


def build_report(raw: Path = DEFAULT_DEST) -> str:
    lines: list[str] = []
    for name, url in FILES.items():
        path = raw / url.rsplit("/", 1)[1]
        lines += ["=" * 100, f"{name}  ({path.name})"]
        if not path.exists():
            lines += ["  MISSING", ""]
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for ws in wb.worksheets:
            lines.append(f"-- sheet: {ws.title}  (dims: {ws.max_row} rows x {ws.max_column} cols)")
            rows = []
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                rows.append(row)
                if i >= 8:
                    break
            if not rows:
                lines.append("   (empty)")
                continue
            h = find_header_index(rows)
            lines.append(f"   header (row {h + 1}): " + _fmt(rows[h]))
            for n, r in enumerate(rows[h + 1:h + 4], 1):
                lines.append(f"   row{n}:   " + _fmt(r))
        wb.close()
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    REPORT.write_text(build_report(), encoding="utf-8")
    print(f"wrote {REPORT}")
