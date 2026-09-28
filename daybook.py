#!/usr/bin/env python3
"""Daybook: Money, Log and Learn, one server, one password, a database each.

    python3 daybook.py                     serve on 127.0.0.1:8765
    python3 daybook.py serve --open        ...and open a browser
    python3 daybook.py serve --host 0.0.0.0     reachable from other devices
    python3 daybook.py password            set the password (asks twice)
    python3 daybook.py check               Money: integrity, reconciliation, gaps
    python3 daybook.py import <files...>   Money: import statements from the command line
    python3 daybook.py backup              force today's copy of every database
    python3 daybook.py export              one zip of every database
    python3 daybook.py install             Start menu and desktop shortcuts to Daybook.pyw
    python3 daybook.py install --service   a systemd service (Raspberry Pi)
    python3 daybook.py sync --folder PATH  start syncing with other computers through a folder
    python3 daybook.py sync --folder PATH --code CODE      join from another computer
    python3 daybook.py sync                one round now, and what it did
    python3 daybook.py update              take the newest code from GitHub (--check, --rollback)
"""
import argparse
import getpass
import json
import os
import sys
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from core import db as _db, server, suite as _suite, sync as _sync   # noqa: E402
from core.suite import SUITE                          # noqa: E402


def _setup(a):
    return _suite.setup(a.data, a.backup_dir)


def _money(a):
    """Money's database: --db if given, else the one the suite opens."""
    _setup(a)
    _suite.open_store().close()
    path = os.path.expanduser(a.db) if a.db else _suite.path("money")
    return _db.open_db(path, SUITE.apps["money"], SUITE.backup_dir, no_backup=a.no_backup)


# --- commands ----------------------------------------------------------------

def cmd_serve(a):
    _setup(a)
    _suite.open_all(quiet=False, no_backup=a.no_backup)
    local = a.host in server.LOCAL
    if not local and _suite.password_is_default():
        raise _db.Stop(f"The password is still '{_suite.DEFAULT_PASSWORD}'. Change it first: "
                       "python3 daybook.py password\n(or Admin → Password), then open Daybook to other devices.")
    srv = server.serve(a.host, a.port, extra_hosts=a.allow_host)
    shown = "127.0.0.1" if local else (a.host if a.host != "0.0.0.0" else server.lan_ip())
    url = f"http://{shown}:{a.port}/"
    print(f"daybook → {url}")
    print(f"   data: {SUITE.data}")
    if not local:
        print("   Reachable from other devices. Keep it to a private network —\n"
              "   a VPN such as Tailscale, never a forwarded port.")
    print("   ctrl-c to stop")
    if a.open:
        webbrowser.open(url)
    _sync.start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        _sync.run()                                # what was changed in the last minute goes out too
        print("\nbye")


def cmd_password(a):
    _setup(a)
    _suite.open_store().close()
    new = getpass.getpass("New password: ")
    if new != getpass.getpass("Again: "):
        raise _db.Stop("The two passwords differ; nothing changed.")
    try:
        _suite.set_password(new)
    except ValueError as e:
        raise _db.Stop(str(e))
    print("Password changed. Every device will need to sign in again.")


def cmd_check(a):
    db = _money(a)
    h = SUITE.apps["money"].check(db)
    bad = 0
    print("\naccounts")
    for x in h["accounts"]:
        flags = []
        if x["gaps"]:
            flags.append(f"{x['gaps']} gap(s)")
        if x["unreconciled"]:
            flags.append(f"{x['unreconciled']} unreconciled")
        bal = "—" if x["balance"] is None else f"{x['balance']:,.2f}"
        bad += len(flags)
        print(f"  {x['name']:<26} {bal:>11}  statement to {x['as_of'] or '—'}  {'; '.join(flags)}")
    for key, label in (("unreconciled", "statements that do not balance"),
                       ("gaps", "coverage gaps"), ("overlaps", "overlapping statements")):
        if h[key]:
            bad += len(h[key])
            print(f"\n{label}")
            for x in h[key]:
                print("  " + json.dumps({k: v for k, v in x.items()
                                         if k in ("account", "filename", "gap_from",
                                                  "gap_to", "days", "discrepancy")}))
    print(f"\n{h['unmatched']} unmatched payee(s), "
          f"{h['uncategorised_txns']} transaction(s) without a category")
    print("ok — nothing to fix" if not bad else f"\n{bad} thing(s) to look at")
    db.close()
    return 1 if bad else 0


def cmd_import(a):
    from apps.money import importer
    db = _money(a)
    files = [(f, open(f, encoding="utf-8", errors="replace").read()) for f in a.files]
    if len(files) == 1 and not a.bulk:
        plan = importer.plan_one(db, files[0][1], files[0][0], account_id=a.account)
        print(f"{plan['filename']}: {plan['count']} rows, "
              f"{plan['period_start']} → {plan['period_end']}, "
              f"{plan['money_out']} out / {plan['money_in']} in")
        if plan["duplicate"]:
            print(f"  already imported as {plan['duplicate']['filename']}")
            return 1
        if not a.yes and input("import? [y/N] ").lower() != "y":
            return 0
        importer.commit(db, plan, make_current=not a.history)
    else:
        bulk = importer.plan_bulk(db, [(n, t, a.account) for n, t in files])
        for g in bulk["groups"]:
            print(f"  {g['account']:<26} {g['files']:>3} files  "
                  f"{g['period_start']} → {g['period_end']}  {g['rows']:>5} rows"
                  + (f"  {len(g['gaps'])} gap(s)" if g["gaps"] else ""))
        if bulk["duplicates"]:
            print(f"  {len(bulk['duplicates'])} duplicate(s) skipped")
        if bulk["unassigned"]:
            print("  ! choose the account with --account <id>")
            return 1
        if not a.yes and input(f"import {bulk['total_rows']} rows? [y/N] ").lower() != "y":
            return 0
        importer.commit_bulk(db, bulk)
    print("done")
    db.close()
    return 0


def cmd_backup(a):
    _setup(a)
    for p in [_suite.store_path()] + [_suite.path(n) for n in SUITE.apps]:
        if os.path.exists(p):
            print(f"copied to {_db.back_up(p, SUITE.backup_dir)}")


def cmd_export(a):
    import zipfile
    from datetime import date
    _setup(a)
    out = a.out or os.path.join(HERE, f"daybook-{date.today():%Y-%m-%d}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in [_suite.store_path()] + [_suite.path(n) for n in SUITE.apps]:
            if os.path.exists(p):
                _db.check_integrity(p)
                z.write(p, os.path.basename(p))
    print(f"bundle written to {out}")


UNIT = """[Unit]
Description=Daybook
After=network-online.target

[Service]
User={user}
WorkingDirectory={here}
ExecStart={py} {here}/daybook.py serve --host 127.0.0.1 --port 8765 {hosts}
Environment=DAYBOOK_DATA={data}
Restart=on-failure

[Install]
WantedBy=multi-user.target
"""


def cmd_install(a):
    """Shortcuts that open Daybook.pyw, with the app's icon; or, with --service,
    a systemd unit so a Raspberry Pi runs it from boot."""
    import subprocess
    if a.service:
        _setup(a)
        hosts = " ".join(f"--allow-host {h}" for h in a.allow_host)
        unit = UNIT.format(user=os.environ.get("SUDO_USER") or getpass.getuser(), here=HERE,
                           py=sys.executable, data=SUITE.data, hosts=hosts)
        dest = "/etc/systemd/system/daybook.service"
        try:
            with open(dest, "w") as f:
                f.write(unit)
        except OSError:
            print(unit)
            print(f"Not allowed to write {dest}. Run again with sudo, or save the text above there.")
            return 1
        print(f"Wrote {dest}. Now:\n  sudo systemctl daemon-reload && sudo systemctl enable --now daybook\n"
              "  sudo tailscale serve --bg --https=443 http://127.0.0.1:8765")
        return 0
    app = os.path.join(HERE, "Daybook.pyw")
    icons = os.path.join(HERE, "web", "assets", "icons")
    py = sys.executable
    if sys.platform == "win32":
        pyw = os.path.join(os.path.dirname(py), "pythonw.exe")
        ps = ("foreach ($w in 'Programs','DesktopDirectory') {"
              " $d = [Environment]::GetFolderPath($w);"
              " $p = Join-Path $d 'Daybook.lnk';"
              " $s = (New-Object -ComObject WScript.Shell).CreateShortcut($p);"
              " $s.TargetPath = $env:PYW; $s.Arguments = [char]34 + $env:APP + [char]34; $s.WorkingDirectory = $env:HERE;"
              " $s.IconLocation = $env:ICO; $s.Description = 'Money, Log and Learn'; $s.Save(); $p }")
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True,
                             text=True, env=dict(os.environ, PYW=pyw if os.path.exists(pyw) else py, APP=app,
                                                 HERE=HERE, ICO=os.path.join(icons, "daybook.ico")))
        if out.returncode:
            raise _db.Stop(out.stderr.strip() or "PowerShell could not make the shortcuts")
        made = out.stdout.split()
    elif sys.platform == "darwin":
        root = os.path.expanduser("~/Applications/Daybook.app/Contents")
        os.makedirs(root + "/MacOS", exist_ok=True)
        os.makedirs(root + "/Resources", exist_ok=True)
        with open(root + "/MacOS/Daybook", "w") as f:
            f.write(f'#!/bin/sh\nexec "{py}" "{app}"\n')
        os.chmod(root + "/MacOS/Daybook", 0o755)
        with open(root + "/Info.plist", "w") as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
                    + "".join(f"<key>{k}</key><string>{v}</string>" for k, v in (
                        ("CFBundleName", "Daybook"), ("CFBundleExecutable", "Daybook"),
                        ("CFBundleIdentifier", "local.daybook"), ("CFBundlePackageType", "APPL"),
                        ("CFBundleIconFile", "Daybook"))) + "</dict></plist>\n")
        subprocess.run(["sips", "-s", "format", "icns", os.path.join(icons, "icon-512.png"),
                        "--out", root + "/Resources/Daybook.icns"], capture_output=True)   # the icon is a nicety
        made = [os.path.dirname(root)]
    else:
        folder = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "applications")
        os.makedirs(folder, exist_ok=True)
        made = [os.path.join(folder, "daybook.desktop")]
        with open(made[0], "w") as f:
            f.write(f'[Desktop Entry]\nType=Application\nName=Daybook\nComment=Money, Log and Learn\n'
                    f'Exec="{py}" "{app}"\nIcon={os.path.join(icons, "icon-512.png")}\nTerminal=false\n'
                    f'Categories=Office;\n')
    print("Made:\n  " + "\n  ".join(made))
    print("Open Daybook from there. On a USB stick the shortcut works while the stick keeps the same\n"
          "drive letter; run install again if it moves.")


def cmd_sync(a):
    """Start, join, run or leave sync. The folder is any one every computer can reach:
    OneDrive, Google Drive, Dropbox, a NAS, a USB stick; or a GitHub repository."""
    _setup(a)
    _suite.open_all()
    try:
        if a.leave:
            _sync.leave()
            print("Sync is off on this computer. Its data stays as it is.")
            return 0
        if a.folder or a.github:
            token = a.token or _suite.env("GITHUB_TOKEN")
            code = _sync.setup("github" if a.github else "folder", path=a.folder, repo=a.github,
                               token=token, branch=a.branch, code=a.code)
            print(f"Syncing through {_sync.status()['where']}.")
            if not a.code:
                print(f"\nThe sync code, for each other computer (keep it somewhere safe; it never goes in the folder):\n\n"
                      f"    {code}\n\nOn the next computer:  python3 daybook.py sync --folder <its path to the same folder> "
                      f"--code {code}")
    except ValueError as e:
        raise _db.Stop(str(e))
    out = _sync.STATE.last if (a.folder or a.github) else _sync.run()      # setting up ran the first round
    if out is None:
        print("Sync is not on. Start it:  python3 daybook.py sync --folder <a folder OneDrive or Google Drive keeps>")
        return 1
    for name, r in out["apps"].items():
        if r.get("off"):
            continue
        print(f"  {name:<6} sent {r.get('sent', 0)} file(s), took {r.get('got', 0)} change(s)"
              + (f", {r['waiting']} file(s) waiting on others" if r.get("waiting") else "")
              + ("".join(f"\n         ! {x}" for x in r.get("problems", [])) + (f"\n         ! {r['error']}" if r.get("error") else "")))
    if out.get("error"):
        print(f"  ! {out['error']}")
        return 1
    return 0


def cmd_update(a):
    """The newest code from GitHub, put in place; the data is left as it is."""
    from core import update
    _setup(a)
    try:
        if a.rollback:
            update.rollback()
            print("The code from before the last update is back. Open Daybook again to use it.")
            return 0
        info = update.check()
        have = (info["current"] or {}).get("message") or "not installed by update"
        print(f"This copy: {have}\nOn GitHub ({info['repo']}): {info['latest']['message']} ({info['latest']['at'][:10]})")
        if not info["available"]:
            print("Up to date.")
            return 0
        if a.check:
            print("There is newer code: python3 daybook.py update")
            return 0
        update.update(data=SUITE.data)
    except ValueError as e:
        raise _db.Stop(str(e))
    print("Updated. Close Daybook and open it again; each database is backed up and moved on as it opens.")
    return 0


# --- entry -------------------------------------------------------------------

def main(argv=None):
    # The global flags go on a parent parser as well as the top level, so
    # `daybook.py serve --data x` works as naturally as `daybook.py --data x serve`.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--data", default=None, help="the folder with the databases (default: data/ here)")
    common.add_argument("--db", default=None, help="Money's database, for check and import")
    common.add_argument("--backup-dir", default=_suite.env("BACKUPS"),
                        help="where daily copies go; point this at the computer "
                             "when the databases live on a USB stick")
    common.add_argument("--no-backup", action="store_true")

    p = argparse.ArgumentParser(description=__doc__, parents=[common],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd")
    add = lambda name: sub.add_parser(name, parents=[common])

    s = add("serve"); s.set_defaults(fn=cmd_serve)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=int(_suite.env("PORT", 8765)))
    s.add_argument("--open", action="store_true")
    s.add_argument("--allow-host", action="append", default=[], metavar="NAME",
                   help="another name it may be reached by, e.g. your Tailscale name pi.tail1234.ts.net")

    s = add("password"); s.set_defaults(fn=cmd_password)
    s = add("check");  s.set_defaults(fn=cmd_check)
    s = add("backup"); s.set_defaults(fn=cmd_backup)
    s = add("export"); s.set_defaults(fn=cmd_export)
    s.add_argument("--out")
    s = add("install"); s.set_defaults(fn=cmd_install)
    s.add_argument("--service", action="store_true", help="a systemd unit instead of shortcuts (Raspberry Pi)")
    s.add_argument("--allow-host", action="append", default=[], metavar="NAME")
    s = add("sync"); s.set_defaults(fn=cmd_sync)
    s.add_argument("--folder", help="start or join sync through this folder")
    s.add_argument("--github", metavar="OWNER/REPO", help="start or join sync through a GitHub repository")
    s.add_argument("--token", help="for --github: a token that can write to it (or DAYBOOK_GITHUB_TOKEN)")
    s.add_argument("--branch", default="main")
    s.add_argument("--code", help="the sync code, to join from another computer")
    s.add_argument("--leave", action="store_true", help="stop syncing this computer")
    s = add("update"); s.set_defaults(fn=cmd_update)
    s.add_argument("--check", action="store_true", help="only say whether there is newer code")
    s.add_argument("--rollback", action="store_true", help="put back the code from before the last update")
    s = add("import"); s.set_defaults(fn=cmd_import)
    s.add_argument("files", nargs="+")
    s.add_argument("--account", type=int, required=True, help="account id (see Settings)")
    s.add_argument("--bulk", action="store_true")
    s.add_argument("--history", action="store_true", help="do not make it the current statement")
    s.add_argument("-y", "--yes", action="store_true")

    a = p.parse_args(argv)
    if not a.cmd:                                  # bare `python3 daybook.py` serves
        a = p.parse_args((argv or []) + ["serve"])
    try:
        return a.fn(a) or 0
    except _db.Stop as e:
        print(f"\n{e}\n", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
