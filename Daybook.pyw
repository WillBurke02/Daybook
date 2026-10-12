#!/usr/bin/env python3
"""Daybook as an app. Double-click this file.

It starts the server and opens Daybook in a window of its own: Edge (else Chrome)
in app mode, so no tabs and no address bar, with Daybook's own icon on the
taskbar. Closing it stops the server. `python daybook.py install` adds it to the
Start menu and desktop, and gives each app its own shortcut, window and icon:

    Daybook.pyw                    Home
    Daybook.pyw log                straight into Log (hours, spending, learn, money alike)
    Daybook.pyw log --url https://pi.tail1234.ts.net     the Pi's Daybook: start nothing here

    DAYBOOK_DATA     the folder with the databases (default: data/ next to this file)
    DAYBOOK_BACKUPS  where the daily copies go (the computer's disk, when data is on a stick)
    DAYBOOK_PORT     default 8765; keep it fixed, the window's settings belong to it
    DAYBOOK_URL      another machine's Daybook, e.g. https://pi.tail1234.ts.net: open that, start nothing here
    DAYBOOK_BROWSER  a Chromium-type browser to use instead of Edge or Chrome
"""
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from core.suite import env   # noqa: E402

ARGS = sys.argv[1:]
PORT = int(env("PORT") or 8765)
REMOTE = (ARGS[ARGS.index("--url") + 1] if "--url" in ARGS[:-1] else env("URL") or "").rstrip("/")
URL = REMOTE or f"http://127.0.0.1:{PORT}"
DOOR = next((a for a in ARGS if a.isalpha()), "")         # the app this window opens on; none is Home
# a window's title ends "· <its app> · Daybook": which door that is, for its taskbar group and icon
TITLES = {"Hours and pay": "hours", "Spending": "spending", "Money": "money", "Log": "log", "Learn": "learn"}
DATA = os.path.join(os.environ.get("LOCALAPPDATA") or (
    os.path.expanduser("~/Library/Application Support") if sys.platform == "darwin"
    else os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")), "Daybook")
PROFILE = os.path.join(DATA, "window")      # the window's own browser profile, off the USB stick
ICONS = os.path.join(HERE, "web", "assets", "icons")
ICON = os.path.join(ICONS, "daybook.ico")


def say(msg):
    """pythonw has no console, so anything worth saying goes in a box as well as the log."""
    print(msg)
    try:
        import tkinter
        import tkinter.messagebox
        r = tkinter.Tk(); r.withdraw()
        tkinter.messagebox.showinfo("Daybook", msg); r.destroy()
    except Exception:
        pass


def running():
    """Is Daybook already being served here? Then just open the window again."""
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(URL + "/login", timeout=2) as r:
            return r.headers.get("Server", "").startswith("daybook/")
    except (OSError, urllib.error.URLError):
        return False


def browser():
    if env("BROWSER"):
        return env("BROWSER")
    if sys.platform == "win32":
        e = os.environ.get
        found = [os.path.join(root, tail) for tail in (r"Microsoft\Edge\Application\msedge.exe",
                                                       r"Google\Chrome\Application\chrome.exe")
                 for root in (e("ProgramFiles(x86)"), e("ProgramFiles"), e("LOCALAPPDATA")) if root]
    elif sys.platform == "darwin":
        found = [f"/Applications/{a}.app/Contents/MacOS/{a}" for a in ("Microsoft Edge", "Google Chrome", "Chromium")]
    else:
        found = [shutil.which(n) or "" for n in ("microsoft-edge", "google-chrome", "google-chrome-stable",
                                                 "chromium", "chromium-browser")]
    return next((p for p in found if p and os.path.isfile(p)), None)


def launch():
    """The app window, or None when there is no Edge or Chrome to make one."""
    exe = browser()
    size = "560,760" if DOOR == "log" else "1440,920"     # Log is a box and a list: a small window to write in
    return exe and subprocess.Popen([exe, f"--app={URL}/{DOOR + '/' if DOOR else ''}", f"--user-data-dir={PROFILE}",
                                     "--no-first-run", "--no-default-browser-check", f"--window-size={size}"])


def window():
    """Open the window; return once every window of it has closed."""
    p = launch()
    if not p:
        return fallback()
    p.wait()
    # If that profile was already open, the browser hands the window over and exits
    # at once; the profile's lock says when the last window has really gone.
    while in_use():
        time.sleep(2)


def in_use():
    lock = os.path.join(PROFILE, "lockfile")          # Windows: held open while the browser runs
    if os.path.exists(lock):
        try:
            os.remove(lock)
            return False
        except OSError:
            return True
    if os.name == "nt":
        return False                                   # never os.kill(pid, 0) on Windows: it ends the process
    try:                                              # macOS, Linux: a link to "host-pid"
        os.kill(int(os.readlink(os.path.join(PROFILE, "SingletonLock")).rsplit("-", 1)[1]), 0)
        return True
    except (OSError, ValueError, IndexError):
        return False


def pin_as_us():
    """Windows shows and pins a window as whatever its app id, relaunch command and
    icon say. Edge leaves those blank for --app windows, so the taskbar showed plain
    Edge and a pin started Edge. Every Daybook window gets ours instead."""
    import ctypes
    import uuid
    from ctypes import wintypes as w
    user32, shell32 = ctypes.windll.user32, ctypes.windll.shell32
    ctypes.windll.ole32.CoInitialize(None)

    class GUID(ctypes.Structure):
        _fields_ = [("raw", ctypes.c_ubyte * 16)]

    class PKEY(ctypes.Structure):
        _fields_ = [("fmtid", GUID), ("pid", w.DWORD)]

    class PROPVARIANT(ctypes.Structure):        # just enough of it for a string
        _fields_ = [("vt", w.USHORT), ("r1", w.USHORT), ("r2", w.USHORT), ("r3", w.USHORT),
                    ("val", ctypes.c_void_p), ("pad", ctypes.c_void_p)]

    guid = lambda s: GUID.from_buffer_copy(uuid.UUID(s).bytes_le)
    IID_IPropertyStore = guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")
    AUM = "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    exe = f'"{pyw if os.path.exists(pyw) else sys.executable}" "{os.path.abspath(__file__)}"'

    def values(door):
        """Each app its own taskbar group, pin and icon: a pinned Log opens Log."""
        ico = os.path.join(ICONS, f"{door}.ico")
        name = next((t for t, d in TITLES.items() if d == door), "")
        return [(5, f"Daybook.{door.title() or 'App'}"),                         # the id: windows and pin group under it
                (2, " ".join(filter(None, [exe, door, f"--url {REMOTE}" if REMOTE else ""]))),
                (3, (ico if door and os.path.isfile(ico) else ICON) + ",0"),
                (4, f"{name} · Daybook" if name else "Daybook")]                 # the pin's name
    shell32.SHGetPropertyStoreForWindow.argtypes = [w.HWND, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
    shell32.SHGetPropertyStoreForWindow.restype = ctypes.HRESULT
    user32.LoadImageW.restype = w.HANDLE
    user32.LoadImageW.argtypes = [w.HINSTANCE, w.LPCWSTR, w.UINT, ctypes.c_int, ctypes.c_int, w.UINT]
    user32.SendMessageW.restype = w.LPARAM
    user32.SendMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    def icons(door):                                                               # IMAGE_ICON, LR_LOADFROMFILE
        ico = os.path.join(ICONS, f"{door}.ico")
        ico = ico if door and os.path.isfile(ico) else ICON
        return user32.LoadImageW(None, ico, 1, 48, 48, 0x10), user32.LoadImageW(None, ico, 1, 16, 16, 0x10)

    def method(obj, i, *args):
        vtbl = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        return ctypes.WINFUNCTYPE(ctypes.HRESULT, ctypes.c_void_p, *args)(vtbl[i])

    def tag(hwnd, door):
        store = ctypes.c_void_p()
        shell32.SHGetPropertyStoreForWindow(hwnd, ctypes.byref(IID_IPropertyStore), ctypes.byref(store))
        try:
            set_value = method(store, 6, ctypes.POINTER(PKEY), ctypes.POINTER(PROPVARIANT))
            for pid, text in values(door):
                buf = ctypes.create_unicode_buffer(text)
                pv = PROPVARIANT(vt=31, val=ctypes.cast(buf, ctypes.c_void_p))   # VT_LPWSTR; the store copies it
                set_value(store, ctypes.byref(PKEY(guid(AUM), pid)), ctypes.byref(pv))
            method(store, 7)(store)                                                # Commit
        finally:
            ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(
                ctypes.cast(store, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents[2])(store)   # Release

    def ours():
        found = []

        def each(h, _):
            title, cls = ctypes.create_unicode_buffer(256), ctypes.create_unicode_buffer(64)
            user32.GetWindowTextW(h, title, 256); user32.GetClassNameW(h, cls, 64)
            if cls.value.startswith("Chrome_WidgetWin") and title.value.endswith("Daybook"):
                parts = title.value.split(" · ")     # an app window's title is the page's; a tab's ends "Microsoft Edge"
                found.append((h, TITLES.get(parts[-2], "") if len(parts) > 2 else ""))
            return True
        user32.EnumWindows(ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)(each), 0)
        return found

    done, loaded = {}, {}
    while True:                                    # ponytail: a 1 s poll; new windows get tagged within a second
        for h, door in ours():
            # the browser gives the window the page's favicon, small and blurry on the taskbar: its app's instead
            big, small = loaded.setdefault(door, icons(door))
            if big and user32.SendMessageW(h, 0x7F, 1, 0) != big:                  # WM_GETICON, ICON_BIG
                user32.SendMessageW(h, 0x80, 1, big); user32.SendMessageW(h, 0x80, 0, small)   # WM_SETICON
            if done.get(h) != door:                # new, or moved to another app's tab inside the window
                try:
                    tag(h, door)
                except OSError as e:
                    print(f"could not tag window {h}: {e}")
                done[h] = door
        time.sleep(1)


def fallback():
    """No Edge or Chrome: an ordinary tab, and a small window whose closing stops the server."""
    import webbrowser
    webbrowser.open(f"{URL}/{DOOR + '/' if DOOR else ''}")
    try:
        import tkinter
    except ImportError:
        threading.Event().wait()             # ponytail: no tkinter either, so it runs until you log off
    r = tkinter.Tk(); r.title("Daybook")
    tkinter.Label(r, text=f"Daybook is running at {URL}\nClose this window to stop it.", padx=24, pady=16).pack()
    tkinter.Button(r, text="Open Daybook", command=lambda: webbrowser.open(URL + "/")).pack(pady=(0, 16))
    r.mainloop()


def main():
    os.makedirs(DATA, exist_ok=True)
    if sys.stdout is None:                   # pythonw: keep a log instead of losing it
        sys.stdout = sys.stderr = open(os.path.join(DATA, "daybook.log"), "a", buffering=1)
    if sys.platform == "win32":
        threading.Thread(target=pin_as_us, daemon=True).start()
    if REMOTE:                               # another machine's Daybook (the Pi): just the window
        return window()
    if running():                            # already open here: one more window on the same server
        if not launch():
            import webbrowser
            webbrowser.open(URL + "/")
        time.sleep(3)                        # long enough for the new window to be given our icon
        return
    from core import db as _db, server, suite, sync
    try:
        suite.setup()
        suite.open_all()                     # checks, backs up and migrates every database, as `serve` does
        srv = server.serve("127.0.0.1", PORT)
    except _db.Stop as e:
        return say(str(e))
    except OSError as e:
        return say(f"Daybook could not start on port {PORT}: {e}.\n"
                   "Another program is using it. Set DAYBOOK_PORT to a different number.")
    except Exception as e:                   # anything else: say what, rather than vanish without a window
        return say(f"Daybook could not start: {e!r}")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    sync.start()
    print(f"{time.strftime('%Y-%m-%d %H:%M')} serving {suite.SUITE.data} at {URL}")
    try:
        window()
    finally:
        srv.shutdown()
        sync.run()                           # the last minute's changes go out before it stops


if __name__ == "__main__":
    main()
