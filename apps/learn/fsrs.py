"""FSRS-6: how likely you are to remember a card now, and when to ask again.

A port of the scheduler in py-fsrs 6.3.2 (open-spaced-repetition, MIT licence),
with its default parameters, one learning step and one relearning step of ten
minutes, and no fuzz. tests/test_learn.py checks it against numbers the
reference library produced.

  stability S   days until the chance of recall falls to 90%
  difficulty D  1 (easy) to 10 (hard)
  R(t, S)       the chance of recall t days after the last review
ponytail: the default parameters; fitting them to your own reviews is a later step.
"""
import math
from datetime import datetime, timedelta

W = (0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
     1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542)
DECAY = -W[20]
FACTOR = 0.9 ** (1 / DECAY) - 1
STEP = timedelta(minutes=10)          # the learning and relearning step
RATINGS = {"again": 1, "hard": 2, "good": 3, "easy": 4}
MAX_DAYS = 36500


def retrievability(stability, days):
    return (1 + FACTOR * max(0, days) / stability) ** DECAY


def interval(stability, retention=0.9):
    days = round(stability / FACTOR * (retention ** (1 / DECAY) - 1))
    return min(max(days, 1), MAX_DAYS)


def _clamp_d(d):
    return min(max(d, 1.0), 10.0)


def _init_s(g):
    return max(W[g - 1], 0.001)


def _init_d(g, clamp=True):
    d = W[4] - math.e ** (W[5] * (g - 1)) + 1
    return _clamp_d(d) if clamp else d


def _next_d(d, g):
    delta = -(W[6] * (g - 3))
    damped = d + (10.0 - d) * delta / 9.0
    return _clamp_d(W[7] * _init_d(4, clamp=False) + (1 - W[7]) * damped)


def _short_term_s(s, g):
    inc = math.e ** (W[17] * (g - 3 + W[18])) * s ** -W[19]
    if g > 1:
        inc = max(inc, 1.0)
    return max(s * inc, 0.001)


def _next_s(d, s, r, g):
    if g == 1:
        long_term = W[11] * d ** -W[12] * ((s + 1) ** W[13] - 1) * math.e ** ((1 - r) * W[14])
        out = min(long_term, s / math.e ** (W[17] * W[18]))
    else:
        out = s * (1 + math.e ** W[8] * (11 - d) * s ** -W[9] * (math.e ** ((1 - r) * W[10]) - 1)
                   * (W[15] if g == 2 else 1) * (W[16] if g == 4 else 1))
    return max(out, 0.001)


def review(card, rating, now=None, retention=0.9):
    """card: {phase, step, stability, difficulty, last_review} (a new card is {} or None).
    Returns the new card, with `due` (a datetime) and `days` (the interval, 0 for a step)."""
    now = now or datetime.now()
    g = RATINGS[rating]
    c = dict(card or {})
    phase = c.get("phase") or "learning"
    s, d = c.get("stability"), c.get("difficulty")
    last = c.get("last_review")
    last = datetime.fromisoformat(last) if isinstance(last, str) else last
    elapsed = (now - last).days if last else None
    if s is None or d is None:                                  # the first answer
        s, d = _init_s(g), _init_d(g)
    elif elapsed is not None and elapsed < 1:                   # again the same day
        s, d = _short_term_s(s, g), _next_d(d, g)
    else:
        s, d = _next_s(d, s, retrievability(s, elapsed or 0), g), _next_d(d, g)
    step = c.get("step") or 0
    if phase in ("learning", "relearning"):
        # one step: Again waits ten minutes, Hard fifteen; Good or Easy graduates to a review in days
        if g == 1:
            phase, due, days = phase, now + STEP, 0
        elif g == 2:
            phase, due, days = phase, now + STEP * 1.5, 0
        else:
            phase, days = "review", interval(s, retention)
            due = now + timedelta(days=days)
    else:                                                       # review
        if g == 1:
            phase, due, days = "relearning", now + STEP, 0
        else:
            days = interval(s, retention)
            due = now + timedelta(days=days)
    return {"phase": phase, "step": 0, "stability": s, "difficulty": d, "last_review": now, "due": due, "days": days}


def from_sm2(interval_days, ease, reps):
    """A card scheduled by the old SM-2 as an FSRS card, once: its interval as the stability,
    its ease as a difficulty (1.3 -> 9, 2.5 -> 5, 3.0 -> 3.3)."""
    if not reps:
        return None
    return {"phase": "review", "stability": max(float(interval_days or 0), 0.5),
            "difficulty": _clamp_d(5 + (2.5 - float(ease or 2.5)) * 10 / 3)}
