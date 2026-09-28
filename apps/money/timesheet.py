"""Hours in and hours out.

In:  Clockify exports and plain spreadsheets, so a backlog can be loaded rather
     than retyped. Re-importing the same Clockify entry updates it instead of
     duplicating, because its id comes with it.
Out: the monthly sheet HR gets, as tab-separated text that pastes straight into
     Excel or an email, and the same thing as a CSV file.
"""
import csv
import io
import re

from core import db as _db
from .importer import norm_date, parse_csv

HHMM = re.compile(r"^(\d{1,2})[:.](\d{2})")


def to_hhmm(v):
    """'09:00', '9:00 AM', '0900', '1/1/1900 09:00' -> '09:00'"""
    s = str(v or "").strip()
    if not s:
        return None
    ampm = re.search(r"\b(AM|PM)\b", s, re.I)
    m = HHMM.search(s)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
    elif re.fullmatch(r"\d{3,4}", s):
        h, mi = int(s[:-2]), int(s[-2:])
    else:
        return None
    if ampm:
        up = ampm.group(1).upper()
        if up == "PM" and h < 12:
            h += 12
        if up == "AM" and h == 12:
            h = 0
    if not (0 <= h <= 23 and 0 <= mi <= 59):
        return None
    return f"{h:02d}:{mi:02d}"


def to_minutes(v):
    """Clockify's duration column: '1:30:00', '1:30', or decimal hours."""
    s = str(v or "").strip()
    if not s:
        return 0
    parts = s.split(":")
    if len(parts) >= 2 and all(p.strip().isdigit() for p in parts[:2]):
        h, mi = int(parts[0]), int(parts[1])
        return h * 60 + mi
    try:
        return int(round(float(s) * 60))
    except ValueError:
        return 0


def _col(header, *names):
    low = [re.sub(r"[^a-z]", "", (h or "").lower()) for h in header]
    for i, h in enumerate(low):
        if h and any(h == n or n in h for n in names):
            return i
    return -1


def plan_hours(text, filename="hours.csv"):
    """Read a Clockify export or a plain timesheet. Returns rows plus what was
    recognised, so the UI can show it before anything is written."""
    header, body = parse_csv(text)
    cell = lambda r, i: (r[i] if 0 <= i < len(r) else "")

    c_start_date = _col(header, "startdate", "date")
    c_start_time = _col(header, "starttime")
    c_end_time = _col(header, "endtime")
    c_end_date = _col(header, "enddate")
    c_dur = _col(header, "durationdecimal", "durationh", "duration", "hours")
    c_proj = _col(header, "project", "job", "task")
    c_desc = _col(header, "description", "note", "comment")
    c_id = _col(header, "id")
    c_from = _col(header, "from", "in", "start")
    c_to = _col(header, "to", "out", "finish", "end")

    if c_start_time < 0 and c_from >= 0 and c_from != c_start_date:
        c_start_time = c_from
    if c_end_time < 0 and c_to >= 0:
        c_end_time = c_to

    source = "clockify" if (c_start_date >= 0 and c_start_time >= 0
                            and _col(header, "billable") >= 0) else "spreadsheet"

    rows, skipped, notes = [], 0, []
    for r in body:
        date = norm_date(cell(r, c_start_date))
        if not date:
            skipped += 1
            continue
        start = to_hhmm(cell(r, c_start_time))
        end = to_hhmm(cell(r, c_end_time))

        if not start and c_dur >= 0:
            # A duration with no clock times: park it at 09:00 so the day still
            # totals correctly, and say so rather than inventing a shift.
            mins = to_minutes(cell(r, c_dur))
            if not mins:
                skipped += 1
                continue
            start = "09:00"
            end = f"{(9 + mins // 60) % 24:02d}:{mins % 60:02d}"
            notes.append(date)
        if not start or not end:
            skipped += 1
            continue

        rows.append({
            "date": date, "start": start, "end": end,
            "project": (cell(r, c_proj) or "").strip() or None,
            "note": (cell(r, c_desc) or "").strip() or None,
            "source": source,
            "external_id": (cell(r, c_id) or "").strip() or None,
        })

    rows.sort(key=lambda x: (x["date"], x["start"]))
    total = sum(_span(r) for r in rows)
    return {
        "filename": filename, "source": source, "rows": rows,
        "count": len(rows), "skipped": skipped,
        "from_date": rows[0]["date"] if rows else None,
        "to_date": rows[-1]["date"] if rows else None,
        "total_hours": round(total, 2),
        "assumed_times": sorted(set(notes)),
        "columns": {"date": c_start_date, "start": c_start_time, "end": c_end_time,
                    "duration": c_dur, "project": c_proj, "note": c_desc},
        "sample": rows[:8],
    }


def _span(r):
    sh, sm = int(r["start"][:2]), int(r["start"][3:])
    eh, em = int(r["end"][:2]), int(r["end"][3:])
    mins = (eh * 60 + em) - (sh * 60 + sm)
    if mins < 0:
        mins += 24 * 60                      # crossed midnight
    return mins / 60.0


def commit_hours(db, plan, replace_range=False):
    """Write the shifts. A Clockify id that is already here updates in place, so
    re-exporting the same week does not double it."""
    rows = plan["rows"]
    if not rows:
        raise ValueError("no rows could be read — check the date and time columns")
    undo, added, updated = [], [], 0
    if replace_range and plan["from_date"]:
        gone = [dict(r) for r in db.execute(
            "SELECT * FROM shift WHERE date BETWEEN ? AND ? AND source <> 'manual'",
            (plan["from_date"], plan["to_date"]))]
        db.execute("DELETE FROM shift WHERE date BETWEEN ? AND ? AND source <> 'manual'",
                   (plan["from_date"], plan["to_date"]))
        undo.append({"op": "restore", "table": "shift", "rows": gone})
    for r in rows:
        if r["external_id"]:
            old = db.execute("SELECT * FROM shift WHERE external_id=?", (r["external_id"],)).fetchone()
            if old:
                db.execute("UPDATE shift SET date=?,start=?,end=?,project=?,note=?,source=? "
                           "WHERE id=?", (r["date"], r["start"], r["end"], r["project"],
                                         r["note"], r["source"], old["id"]))
                undo.append({"op": "restore", "table": "shift", "rows": [dict(old)]})
                updated += 1
                continue
        added.append(db.execute(
            "INSERT INTO shift (date,start,end,project,note,source,external_id) "
            "VALUES (?,?,?,?,?,?,?)",
            (r["date"], r["start"], r["end"], r["project"], r["note"], r["source"],
             r["external_id"])).lastrowid)
    undo.insert(0, {"op": "remove", "table": "shift", "pk": "id", "ids": added})
    _db.log_change(db, "import", "shift",
                   f"Imported hours from {plan['filename']}: {len(added)} added, {updated} updated "
                   f"({plan['from_date']} to {plan['to_date']})", rows=len(added) + updated,
                   detail={"undo": undo})
    db.commit()
    return {"added": len(added), "updated": updated}


# --- out to HR ---------------------------------------------------------------
# The same columns as the spreadsheet HR already gets: one row per shift, hours
# as hh:mm, a split day as two rows. Totals underneath.

HR_COLUMNS = ["Date", "Started", "Finished", "Hours", "Notes"]


def hhmm(hours):
    m = int(round((hours or 0) * 60))
    return f"{m // 60:02d}:{m % 60:02d}"


def hr_table(db, month):
    out = [HR_COLUMNS]
    for r in db.execute("SELECT date, start, end, hours, note, project FROM v_shift "
                        "WHERE month = ? ORDER BY date, start", (month,)):
        y, mo, d = r["date"].split("-")
        out.append([f"{d}/{mo}/{y}", r["start"], r["end"], hhmm(r["hours"]),
                    r["note"] or r["project"] or ""])
    m = db.execute("SELECT * FROM v_month_hours WHERE month = ?", (month,)).fetchone()
    get = lambda k: (m[k] if m else 0) or 0
    out += [[],
            ["Total hours", "", "", hhmm(get("hours")), ""],
            ["Overtime x1.5", "", "", hhmm(get("ot15_hours")), ""],
            ["Overtime x2", "", "", hhmm(get("ot2_hours")), ""]]
    return out


def hr_tsv(db, month):
    """Tab-separated: pastes into Excel as columns, and into an email as a block."""
    return "\n".join("\t".join(str(c) for c in row) for row in hr_table(db, month))


def hr_csv(db, month):
    buf = io.StringIO()
    csv.writer(buf).writerows(hr_table(db, month))
    return buf.getvalue()
