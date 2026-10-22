# Working on Daybook

- Every change gets a new version: bump `APP_VERSION` in `core/db.py` (4.0.1 → 4.0.2) and add a
  `## <version> — <date>` heading at the top of `CHANGELOG.md` saying what changed, in plain words.
  `tests/test_suite.py` checks the two match; Help → What's new shows the changelog in the app.
- Text on screen is labels, figures, dates and buttons (SPEC §1). No sentences explaining the screen,
  no comments on the data, no reassurance or disclaimers, nothing about the design itself ("new",
  "one tap"). This holds for wireframes and mock-ups too. Will has asked for it more than once.
