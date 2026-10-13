# Working on Daybook

- Every change gets a new version: bump `APP_VERSION` in `core/db.py` (4.0.1 → 4.0.2) and add a
  `## <version> — <date>` heading at the top of `CHANGELOG.md` saying what changed, in plain words.
  `tests/test_suite.py` checks the two match; Help → What's new shows the changelog in the app.
