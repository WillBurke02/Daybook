"""Your level: a stage from 1 to 9, estimated from the answers you give.

Daybook's own scale, with the UK qualification level (RQF) alongside so a stage
means something outside Learn. Stage 1 starts below GCSE on purpose.

The model is the usual one-parameter one, with a floor for guessing:
    P(right) = g + (1 - g) / (1 + e^(-1.7 (theta - b)))
    theta  your skill, in stages     b  the card's stage
    g      1/options for multiple choice, 0 for a typed answer
Your *level* is where you get about 8 in 10 right: theta - 0.8.

theta is worked out on a grid of stages (0 to 10 in 0.05s): a prior, then one term
per counted answer, older answers weighing less (a half-life of 60 days), so the
estimate follows you as you improve. The range is one standard deviation.
ponytail: a grid, not an optimiser; a few thousand answers take milliseconds.
"""
import math
from datetime import date

SLOPE = 1.7
EIGHTY = math.log(4) / SLOPE            # theta - level: where P(right) = 0.8
HALF_LIFE = 60                          # days
GRID = [i * 0.05 for i in range(201)]

STAGES = [   # stage, name, what it is roughly, the RQF level alongside
    (1, "First steps", "whole numbers, simple sums and reading a scale", "Entry 1–2"),
    (2, "Basics", "times tables, fractions, decimals and units", "Entry 3"),
    (3, "Foundation", "percentages, simple formulas and graphs", "Level 1 (GCSE grades 1–3)"),
    (4, "Secure", "rearranging formulas, standard form, Ohm's law", "Level 2 (GCSE grades 4–9)"),
    (5, "Advanced", "calculus, waves, PLC programming", "Level 3 (A level)"),
    (6, "Higher", "control loops, drives, circuit analysis", "Level 4 (HNC)"),
    (7, "Diploma", "tuning, design and fault finding", "Level 5 (HND)"),
    (8, "Graduate", "system design from first principles", "Level 6 (degree)"),
    (9, "Master", "specialist and research depth", "Level 7 (master's)"),
]


def stage_of(level):
    """The stage a level falls in, as (number, name, about, rqf)."""
    n = min(max(int(math.floor(level + 1e-9)), 1), 9)
    return STAGES[n - 1]


def p_right(theta, b, g=0.0):
    return g + (1 - g) / (1 + math.exp(-SLOPE * (theta - b)))


def estimate(answers, prior=4.0, prior_sd=2.0, today=None):
    """answers: [(stage b, guess floor g, right 0/1, day 'YYYY-MM-DD', weight)].
    Returns (theta, sd): the posterior mean and standard deviation on the grid."""
    today = today or date.today()
    logp = [-(t - prior) ** 2 / (2 * prior_sd ** 2) for t in GRID]
    for b, g, right, day, weight in answers:
        age = (today - date.fromisoformat(day)).days if day else 0
        w = weight * 0.5 ** (max(age, 0) / HALF_LIFE)
        for i, t in enumerate(GRID):
            p = min(max(p_right(t, b, g), 1e-6), 1 - 1e-6)
            logp[i] += w * math.log(p if right else 1 - p)
    top = max(logp)
    post = [math.exp(x - top) for x in logp]
    total = sum(post)
    mean = sum(t * p for t, p in zip(GRID, post)) / total
    var = sum((t - mean) ** 2 * p for t, p in zip(GRID, post)) / total
    return mean, math.sqrt(var)


def level(theta):
    """The level you get about 8 in 10 right at."""
    return theta - EIGHTY


def describe(theta, sd):
    lv = level(theta)
    n, name, about, rqf = stage_of(lv)
    return {"level": round(lv, 1), "low": round(lv - sd, 1), "high": round(lv + sd, 1), "sd": round(sd, 2),
            "stage": n, "name": name, "about": about, "rqf": rqf}
