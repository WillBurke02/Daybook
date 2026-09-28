#!/bin/sh
# Starts Daybook in its own window. macOS and Linux, and from a USB stick.
# On your own computer run once instead:  python3 daybook.py install
# Databases live in data/ beside this file; backups go to the computer.
cd "$(dirname "$0")" || exit 1
export DAYBOOK_BACKUPS="${DAYBOOK_BACKUPS:-$HOME/daybook-backups}"
if [ -x "./python/bin/python3" ]; then exec ./python/bin/python3 Daybook.pyw "$@"; fi
if command -v python3 >/dev/null 2>&1; then exec python3 Daybook.pyw "$@"; fi
echo "Python 3 was not found. Install it from https://www.python.org/downloads/"
read -r _; exit 1
