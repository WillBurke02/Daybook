"""UK PAYE estimator. Every figure comes from the database; no rates live here.

Update rate_band / tax_year_cfg each April and this keeps working.
"""


def _bands(db, tax_year, kind):
    rows = db.execute(
        "SELECT lower, upper, rate FROM rate_band WHERE tax_year=? AND kind=? ORDER BY lower",
        (tax_year, kind),
    ).fetchall()
    if not rows:  # fall back to the most recent year we do have figures for
        year = db.execute(
            "SELECT MAX(tax_year) FROM rate_band WHERE kind=? AND tax_year<=?", (kind, tax_year)
        ).fetchone()[0]
        if year is None:
            return []
        return _bands(db, year, kind)
    return [tuple(r) for r in rows]


def _apply(bands, amount, periods=1):
    """Progressive bands. periods>1 scales the thresholds to one pay period,
    which is how NI and student loans actually work (they are not cumulative)."""
    return sum(
        max(0.0, min(amount, u / periods) - l / periods) * r for l, u, r in bands
    )


def settings(db):
    return {k: v for k, v in db.execute("SELECT key, value FROM setting")}


def tax_year_of(date_str):
    """'2026-05-01' -> 2026. UK tax year starts 6 April."""
    return int(date_str[:4]) - (date_str[5:10] < "04-06")


def breakdown(db, gross, tax_year, periods=1, **over):
    """Full PAYE breakdown for `gross` earned over one period.

    periods=1  -> gross is a full year's pay
    periods=12 -> gross is one month's pay (thresholds scaled accordingly)

    Keyword overrides: pension_pct, pension_relief, student_loan_plan,
    employer_pension_pct -- anything omitted comes from the setting table.
    """
    s = settings(db)
    s.update({k: v for k, v in over.items() if v is not None})
    gross = float(gross)

    pension = gross * float(s.get("pension_pct", 0)) / 100
    er_pension = gross * float(s.get("employer_pension_pct", 0)) / 100
    relief = s.get("pension_relief", "net_pay")

    # Which base each deduction is charged on depends on how the pension is run.
    if relief == "sacrifice":       # gross is genuinely reduced: saves tax AND NI
        taxable_base = ni_base = sl_base = gross - pension
    elif relief == "net_pay":       # off pay before tax, but NI on the full gross
        taxable_base, ni_base, sl_base = gross - pension, gross, gross
    else:                           # relief_at_source: taken from net pay
        taxable_base = ni_base = sl_base = gross

    cfg = db.execute(
        "SELECT personal_allowance, pa_taper_start, pa_taper_rate FROM tax_year_cfg "
        "WHERE tax_year = (SELECT MAX(tax_year) FROM tax_year_cfg WHERE tax_year<=?)",
        (tax_year,),
    ).fetchone()
    allowance, taper_start, taper_rate = (
        tuple(cfg) if cfg else (12570.0, 100000.0, 0.5)
    )
    # Allowance tapers away above 100k -- the 60% marginal-rate trap.
    annualised = taxable_base * periods
    if annualised > taper_start:
        allowance = max(0.0, allowance - (annualised - taper_start) * taper_rate)

    taxable = max(0.0, taxable_base - allowance / periods)
    tax = _apply(_bands(db, tax_year, "income"), taxable, periods)
    ni = _apply(_bands(db, tax_year, "ni_ee"), ni_base, periods)
    er_ni = _apply(_bands(db, tax_year, "ni_er"), ni_base, periods)

    plan = s.get("student_loan_plan", "none")
    student_loan = (
        float(int(_apply(_bands(db, tax_year, plan), sl_base, periods)))
        if plan and plan != "none" else 0.0
    )  # HMRC rounds the loan deduction down to whole pounds

    net = gross - tax - ni - pension - student_loan
    if relief == "relief_at_source":
        pass  # already excluded from tax relief above; contribution still leaves net
    r = lambda x: round(x, 2)
    return {
        "tax_year": tax_year, "periods": periods,
        "gross": r(gross), "taxable": r(taxable), "allowance": r(allowance / periods),
        "tax": r(tax), "ni": r(ni), "pension": r(pension),
        "student_loan": r(student_loan), "net": r(net),
        "er_ni": r(er_ni), "er_pension": r(er_pension),
        "total_cost_to_employer": r(gross + er_ni + er_pension),
        "effective_rate": r((tax + ni + student_loan) / gross * 100) if gross else 0.0,
        "take_home_pct": r(net / gross * 100) if gross else 0.0,
        "pension_relief": relief, "student_loan_plan": plan,
    }


def month_estimate(db, month):
    """Expected pay for the payslip covering hours worked in 'YYYY-MM': a month
    of basic, plus that month's overtime. Paid on payday the month after."""
    row = db.execute(
        "SELECT COALESCE(SUM(ot_pay),0), COALESCE(SUM(hours),0), COALESCE(SUM(ot_hours),0), "
        "  COALESCE(SUM(CASE WHEN ot_mult < 2 THEN ot_hours END),0), "
        "  COALESCE(SUM(CASE WHEN ot_mult >= 2 THEN ot_hours END),0), "
        "  COALESCE(SUM(CASE WHEN ot_mult < 2 THEN ot_pay END),0), "
        "  COALESCE(SUM(CASE WHEN ot_mult >= 2 THEN ot_pay END),0), MAX(hourly) "
        "FROM v_day_paid WHERE month=?", (month,)
    ).fetchone()
    ot_pay, hours, ot_hours, ot15_h, ot2_h, ot15_pay, ot2_pay, hourly = row
    y, m = int(month[:4]), int(month[5:7])
    day = int(settings(db).get("payday", 17) or 17)
    pay_date = f"{y + m // 12}-{m % 12 + 1:02d}-{min(day, 28):02d}"
    rate = db.execute(
        "SELECT annual FROM pay_rate WHERE from_date <= ? ORDER BY from_date DESC LIMIT 1",
        (pay_date,),
    ).fetchone()
    basic = (rate[0] / 12.0) if rate else 0.0
    gross = basic + ot_pay
    out = breakdown(db, gross, tax_year_of(pay_date), periods=12)
    out.update({"month": month, "pay_date": pay_date, "basic": round(basic, 2),
                "overtime_pay": round(ot_pay, 2), "hours": hours, "ot_hours": ot_hours,
                "ot15_hours": ot15_h, "ot2_hours": ot2_h,
                "ot15_pay": round(ot15_pay, 2), "ot2_pay": round(ot2_pay, 2),
                "hourly": round(hourly, 2) if hourly else None})
    return out


def year_estimate(db, tax_year):
    """Actual payslips so far in the tax year, plus a straight-line projection."""
    row = db.execute(
        "SELECT COUNT(*), COALESCE(SUM(gross),0), COALESCE(SUM(tax),0), COALESCE(SUM(ni),0), "
        "       COALESCE(SUM(net),0), COALESCE(SUM(pension),0), COALESCE(SUM(student_loan),0) "
        "FROM v_payslip WHERE tax_year=?", (tax_year,)
    ).fetchone()
    n, gross, tax, ni, net, pension, sl = row
    if not n:
        rate = db.execute(
            "SELECT annual FROM pay_rate ORDER BY from_date DESC LIMIT 1").fetchone()
        projected = rate[0] if rate else 0.0
    else:
        projected = gross / n * 12          # ponytail: assumes monthly pay
    est = breakdown(db, projected, tax_year)
    return {
        "tax_year": tax_year, "payslips": n,
        "actual": {"gross": round(gross, 2), "tax": round(tax, 2), "ni": round(ni, 2),
                   "net": round(net, 2), "pension": round(pension, 2),
                   "student_loan": round(sl, 2)},
        "projected": est,
        # >0 means the year looks under-taxed so far -- worth checking the tax code.
        "tax_gap": round(est["tax"] - (tax / n * 12 if n else est["tax"]), 2),
    }


def year_check(db, tax_year):
    """The end-of-year check: the tax year's payslips added up, beside the P60
    you type in, and the tax that pay should have cost over the whole year.
    Tax is worked out across the year; NI and student loan are per payslip, so
    only their totals are compared."""
    s = settings(db)
    slips = [dict(r) for r in db.execute(
        "SELECT pay_date, tax_code, gross, tax, ni, pension, student_loan FROM v_payslip "
        "WHERE tax_year = ? ORDER BY pay_date", (tax_year,))]
    add = lambda k: round(sum(x[k] or 0 for x in slips), 2)
    gross, pension = add("gross"), add("pension")
    net_pay = s.get("pension_relief", "net_pay") == "net_pay"      # pension off pay before tax
    taxable = round(gross - pension if net_pay else gross, 2)
    months = [f"{tax_year + (m < 4):04d}-{m:02d}" for m in (4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3)]
    have = {x["pay_date"][:7] for x in slips}
    from datetime import date
    months = [m for m in months if m <= date.today().isoformat()[:7]]      # not the months still to come
    expected = breakdown(db, taxable, tax_year, 1, pension_pct=0)["tax"] if slips else None
    p60 = db.execute("SELECT * FROM p60 WHERE tax_year = ?", (tax_year,)).fetchone()
    return {"tax_year": tax_year, "payslips": len(slips), "missing": [m for m in months if m not in have],
            "gross": gross, "pension": pension, "taxable": taxable, "net_pay_pension": net_pay,
            "tax": add("tax"), "ni": add("ni"), "student_loan": add("student_loan"),
            "tax_code": slips[-1]["tax_code"] if slips else None,
            "expected_tax": expected, "tax_gap": round(add("tax") - expected, 2) if slips else None,
            "p60": dict(p60) if p60 else {}}
