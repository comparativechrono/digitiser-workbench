#!/usr/bin/env python3
"""Make the workbench's examples from Hearn & Whitmore (2026), and the values each figure shows.

    python3 build/make_examples.py PAPER_REPOSITORY

PAPER_REPOSITORY is a checkout of
https://github.com/comparativechrono/Rephasing-of-Seasonal-Birth-Rates-in-the-United-Kingdom-
which holds the paper's data and the notebooks that drew its figures.

For each figure this writes, into data/examples/hearn-whitmore-2026/:

* the figure, exactly as the notebook in the repository drew it (the picture saved in the notebook);
* FIGURE.known.csv: the values the figure shows, worked out by running the notebook's own code on the
  repository's data (with the drawing switched off), so that what you digitise can be checked against them.

It also copies the data (data/births.csv, data/environmental.csv), writes "scanned" versions of two figures
(printed-and-scanned look: turned slightly, blurred, JPEG), and checks each known-values file against its figure
by drawing the figure again from those values and comparing the two pictures (--check).

Needs NumPy, pandas, SciPy, statsmodels and matplotlib (the notebooks' own packages).
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
OUT = SITE / "data" / "examples" / "hearn-whitmore-2026"

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]

# figure -> (notebook, index of the code cell, index of the picture among that cell's outputs)
PICTURES = {
    "figure-1a": ("Figures/Figure_1.ipynb", 2, 0),
    "figure-1b": ("Figures/Figure_1.ipynb", 4, 0),
    "figure-2": ("Figures/FIGURE_2_REVISED.ipynb", 1, 0),
    "figure-3a": ("Figures/FIGURE_3_REVISED.ipynb", 2, 0),
    "figure-3b": ("Figures/FIGURE_3_REVISED.ipynb", 4, 0),
    "figure-3c": ("Figures/FIGURE_3_REVISED.ipynb", 6, 0),
    "figure-4": ("Figures/FIGURE_4_REVISED.ipynb", 1, 0),
    "figure-s3": ("Supplemental_material/SI_figure_3.ipynb", 1, 0),
}


def cells(repo: Path, notebook: str):
    nb = json.loads((repo / notebook).read_text(encoding="utf-8"))
    return nb["cells"]


def picture(repo: Path, notebook: str, cell: int, which: int) -> bytes:
    c = cells(repo, notebook)[cell]
    found = [o["data"]["image/png"] for o in c.get("outputs", []) if "image/png" in o.get("data", {})]
    raw = found[which]
    return base64.b64decode("".join(raw) if isinstance(raw, list) else raw)


def run_cells(repo: Path, notebook: str, which: list[int], ns: dict | None = None, fresh: bool = True,
              rc: dict | None = None, phases: dict | None = None) -> dict:
    """Run some code cells of a notebook in one namespace, with the data read from the repository and nothing drawn
    on screen. Returns the namespace (the notebook's variables)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import pandas as pd

    # each notebook starts in a fresh Python, with matplotlib's settings as they come (rc: any it changes first)
    if fresh:
        matplotlib.rcdefaults()
        matplotlib.rcParams.update(rc or {})

    data_dir = repo / "time-series"
    real_read_csv = pd.read_csv

    def read_csv(path, *a, **k):
        p = str(path)
        if p.startswith("http"):
            p = p.rsplit("/time-series/", 1)[-1]
        p = os.path.basename(p) if not (data_dir / p).exists() else p
        return real_read_csv(data_dir / p, *a, **k)

    ns = ns if ns is not None else {}
    import scipy.optimize as so

    real_curve_fit = so.curve_fit

    def curve_fit(f, xdata, ydata, p0=None, sigma=None, absolute_sigma=False, check_finite=None, bounds=(-np.inf, np.inf),
                  method=None, jac=None, *, full_output=False, nan_policy=None, **kw):
        """scipy's curve_fit, except that a fit that runs out of evaluations gives its last parameters (and is noted)
        rather than stopping the notebook. On the computer that drew the figures every year's fit converged; here
        1992's does not, with any SciPy from 1.11 to 1.18, although the angle it reaches is the one in the figure."""
        key = (ns.get("year"), tuple(np.round(np.asarray(ydata, dtype=float), 6)))
        if key in FITS:
            popt, ok = FITS[key]
        else:
            try:
                popt, ok = real_curve_fit(f, xdata, ydata, p0=p0, bounds=bounds, **kw)[0], True
            except RuntimeError:
                res = so.least_squares(lambda p: f(np.asarray(xdata), *p) - np.asarray(ydata, dtype=float),
                                       np.asarray(p0, float), bounds=bounds, method="trf", max_nfev=kw.get("maxfev"))
                popt, ok = res.x, False
            FITS[key] = (popt, ok)
        if not ok:
            ns["_unconverged_years"] = ns.get("_unconverged_years", []) + [ns.get("year")]
            if phases and ns.get("year") in phases:
                popt = np.array(popt, dtype=float)
                popt[2] = phases[ns.get("year")]
        return np.array(popt, dtype=float), np.full((len(p0), len(p0)), np.nan)

    so.curve_fit = curve_fit
    pd.read_csv = read_csv
    shown = ns.setdefault("_shown_by_cell", {})
    current = {"cell": None}
    real_show = plt.show

    def show(*a, **k):
        """as Jupyter's inline backend shows a figure: saved as a PNG (100 dots per inch, cropped to what is drawn),
        then closed"""
        fig = plt.gcf()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=100, bbox_inches="tight", facecolor=fig.get_facecolor())
        shown.setdefault(current["cell"], []).append(buf.getvalue())
        plt.close("all")

    plt.show = show
    real_savefig = plt.savefig
    plt.savefig = lambda *a, **k: None  # (the notebooks save files of their own: not here)
    try:
        for i in which:
            current["cell"] = i
            src = "".join(cells(repo, notebook)[i]["source"])
            src = "\n".join(line for line in src.splitlines() if not line.lstrip().startswith(("!", "%")))
            exec(compile(src, f"{notebook}[{i}]", "exec"), ns)
    finally:
        so.curve_fit = real_curve_fit
        pd.read_csv = real_read_csv
        plt.show = real_show
        plt.savefig = real_savefig
    return ns


def write_csv(path: Path, header: list[str], rows):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(",".join(header) + "\n")
        for r in rows:
            f.write(",".join(fmt(v) for v in r) + "\n")


def fmt(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    if isinstance(v, (bool, np.bool_)):
        return "true" if v else "false"
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        return f"{float(v):.10g}"
    s = str(v)
    return '"' + s.replace('"', '""') + '"' if ("," in s or '"' in s) else s


def decimal_year(ts) -> float:
    """1955-01-01 -> 1955.0; the 1st of July 1955 -> 1955.496 (matplotlib's dates are days, so ticks at the 1st
    of January of 1955, 1960 … stand at these values to within a day)."""
    import pandas as pd

    ts = pd.Timestamp(ts)
    start = pd.Timestamp(year=ts.year, month=1, day=1)
    end = pd.Timestamp(year=ts.year + 1, month=1, day=1)
    return ts.year + (ts - start) / (end - start)


SOURCE = ("Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for "
          "chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348")


FITS: dict = {}  # (year, data) -> (parameters, converged): each year's cosine fit, done once
RENDERED: dict = {}  # figure -> the picture drawn again here by the notebook's code (for --check)


def keep(name: str, ns: dict, cell: int, which: int = 0):
    got = ns.get("_shown_by_cell", {}).get(cell) or []
    if which < len(got):
        RENDERED[name] = got[which]


def differing(a_png: bytes, b_png: bytes) -> int:
    from PIL import Image

    a = np.asarray(Image.open(io.BytesIO(a_png)).convert("RGB")).astype(int)
    b = np.asarray(Image.open(io.BytesIO(b_png)).convert("RGB")).astype(int)
    if a.shape != b.shape:
        return 10 ** 9
    return int((np.abs(a - b).max(axis=2) > 32).sum())


def phase_from_picture(repo: Path, year: int, known: dict) -> float:
    """The phase of a year whose fit does not converge here, read from Figure 3b itself: the phase that, drawn by the
    notebook's own code, gives the picture in the notebook (a search, coarse then fine)."""
    original = (OUT / "figure-3b.png").read_bytes()

    def cost(ph):
        ns = run_cells(repo, "Figures/FIGURE_3_REVISED.ipynb", [4], phases={**known, year: ph})
        return differing(original, ns["_shown_by_cell"][4][0])

    ns = run_cells(repo, "Figures/FIGURE_3_REVISED.ipynb", [4], phases=known)
    start = float(ns["phase_differences"][list(ns["years"]).index(year)])
    best = min((cost(start + d), start + d) for d in np.arange(-0.6, 0.61, 0.03))
    for step in (0.005, 0.0005):
        best = min((cost(best[1] + d), best[1] + d) for d in np.arange(-6 * step, 6.5 * step, step))
    print(f"{year}: the fit stops at a phase of {start:.4f}; the figure shows {best[1]:.4f} "
          f"({best[0]} pixels differ)", file=sys.stderr)
    return round(float(best[1]), 4)


def known_values(repo: Path, check: bool) -> dict:
    """figure -> (header, rows, note)"""
    import pandas as pd

    out = {}

    # ------------------------------------------------------------------ Figure 1a and 1b
    ns = run_cells(repo, "Figures/Figure_1.ipynb", [2])
    keep("figure-1a", ns, 2)
    d = ns["data"]
    rows = []
    for _, r in d.iterrows():
        rows.append([r["Date"].strftime("%Y-%m-%d"), round(decimal_year(r["Date"]), 5), int(r["Births"]),
                     float(r["PeakConceptionMonth"]), 1972 <= r["Year"] <= 1978])
    out["figure-1a"] = (
        ["date", "decimal_year", "births", "peak_conception_month", "in_inset"], rows,
        f"Figure 1a of {SOURCE}\n"
        "births: the blue line, against the left-hand axis (number of births per month).\n"
        "peak_conception_month: the orange line, against the right-hand axis, whose labels are months: "
        "6 = June, 7 = July, 8 = August, 9 = September, 10 = October, 11 = November, 12 = December, 13 = January "
        "(a value of 10.5 lies half way between October and November).\n"
        "in_inset: the months the green inset shows (1972 to 1978), against the inset's own axes.\n"
        "decimal_year: where each month stands on the x axis, whose ticks are at the 1st of January of 1955, "
        "1960 ... 2015.")
    ns = run_cells(repo, "Figures/Figure_1.ipynb", [4])
    keep("figure-1b", ns, 4)
    pdiff = ns["percentage_difference"]
    rows = [[m, MONTHS[m - 1][:3], round(float(pdiff.loc[m]), 4)] for m in range(1, 13)]
    out["figure-1b"] = (
        ["month", "label", "percent_difference"], rows,
        f"Figure 1b of {SOURCE}\n"
        "percent_difference: the height of each bar (the difference in the average number of births in that month, "
        "1975-2015 against 1955-1974, in per cent).\n"
        "The error bars are one bootstrap standard error, the same for every bar. The notebook drew it from 1000 "
        "unseeded bootstrap samples, so its exact value is not known; in this picture each error bar reaches about 1.35 above and below its bar.")

    # ------------------------------------------------------------------ Figure 2 (the birthogram)
    ns = run_cells(repo, "Figures/FIGURE_2_REVISED.ipynb", [1])
    keep("figure-2", ns, 1)
    pivot, peak_flag, valid_years = ns["pivot"], ns["peak_flag"], ns["valid_years"]
    rows = []
    for i, year in enumerate(valid_years):
        s_n = pivot.loc[year].values.astype(float)
        s_n1 = pivot.loc[year + 1].values.astype(float)
        n_norm = (s_n - s_n.min()) / (s_n.max() - s_n.min())
        n1_norm = (s_n1 - s_n1.min()) / (s_n1.max() - s_n1.min())
        values = np.concatenate([n_norm, n1_norm])
        dots = {int(peak_flag.loc[year]) - 1, int(peak_flag.loc[year + 1]) - 1 + 12}
        for col in range(24):
            rows.append([year, i, col, MONTHS[col % 12], year if col < 12 else year + 1, round(float(values[col]), 5),
                         col in dots])
    out["figure-2"] = (
        ["row_year", "row", "column", "month", "calendar_year", "normalised_births", "peak_dot"], rows,
        f"Figure 2 of {SOURCE}\n"
        "One row of the double-plotted birthogram for each year from 1955 (the top row) to 2013, with 24 columns: "
        "January to December of that year, then of the next.\n"
        "normalised_births: the height of the filled step in that column, from 0 to 1, where 1 is the height of a "
        "full row less a tenth (each row takes 1.1 units, its fill at most 1): births in that month scaled so that "
        "the year's fewest are 0 and its most are 1, each year separately.\n"
        "peak_dot: whether the black dot (the inferred peak-conception month) is drawn in that column.")

    # ------------------------------------------------------------------ Figure 3a, 3b, 3c
    ns = run_cells(repo, "Figures/FIGURE_3_REVISED.ipynb", [2, 4, 6])
    phases = {}
    for year in sorted({int(y) for y in ns.get("_unconverged_years", []) if y is not None}):
        phases[year] = phase_from_picture(repo, year, phases)
    if phases:
        ns = run_cells(repo, "Figures/FIGURE_3_REVISED.ipynb", [2, 4, 6], phases=phases)
        ns["_measured_phases"] = phases
    keep("figure-3a", ns, 2)
    keep("figure-3b", ns, 4)
    keep("figure-3c", ns, 6)
    rows = []
    for label, per, amp, sel in (("1955-1974", ns["period1"], ns["amp1"], ns["sel1"]),
                                 ("1976-2014", ns["period2"], ns["amp2"], ns["sel2"])):
        order = np.argsort(per[sel])
        for p_, a_ in zip(per[sel][order], amp[sel][order]):
            rows.append([label, round(float(p_), 5), round(float(a_), 6)])
    out["figure-3a"] = (
        ["panel", "period_months", "amplitude"], rows,
        f"Figure 3a of {SOURCE}\n"
        "The two FFT spectra: the upper panel 1955-1974, the lower 1976-2014. Each is a line drawn through these "
        "points, from a period of 20 months to 2 (the x axis runs from 1 to 20 months).")
    phases = np.asarray(ns["phase_differences"], dtype=float)
    years = np.asarray(ns["years"])
    rows = []
    loose = {int(y) for y in ns.get("_unconverged_years", []) if y is not None}
    for i, (y, ph) in enumerate(zip(years, phases)):
        rows.append([int(y), i + 1, round(float(ph), 6), round(float(np.degrees(ph)) % 360.0, 4), int(y) not in loose])
    out["figure-3b"] = (
        ["year", "radius", "phase_radians", "angle_degrees", "fit_converged"], rows,
        f"Figure 3b of {SOURCE}\n"
        "One blue dot for each year: its angle is the phase of the cosine fitted to that year's detrended births "
        "(phase_radians, as fitted, between -pi and pi; angle_degrees, the same angle as the plot shows it, from 0 "
        "at the right, anticlockwise, 0 to 360); its distance from the centre is radius, which counts the years: "
        "1 for 1955 to 60 for 2014. The rings are at radius 1 (labelled 1955), 11 (1965) ... 51 (2005).\n"
        "fit_converged: false for a year whose cosine fit runs out of evaluations when the notebook is run again "
        "(1992, with any SciPy from 1.11 to 1.18); its phase is the one that, drawn by the notebook's code, gives "
        "the figure as published (to within 0.001 radians).")
    mid, sds, lo, hi, sig = (np.asarray(ns[k]) for k in ("mid_years", "sds", "ci_los", "ci_his", "sig_mask"))
    rows = [[int(m), round(float(s), 6), round(float(s - a), 6), round(float(s + b), 6), bool(g)]
            for m, s, a, b, g in zip(mid, sds, lo, hi, sig)]
    out["figure-3c"] = (
        ["window_midpoint_year", "circular_sd", "ci_low", "ci_high", "asterisk"], rows,
        f"Figure 3c of {SOURCE}\n"
        "One blue dot for each 10-year window: x is the circular standard deviation of the peak phase (radians), y "
        "the window's midpoint year (the axis runs downwards). The grey bars are the 95% bootstrap confidence "
        "intervals (ci_low to ci_high), and a red asterisk marks the windows that differ from 1955-1974.")

    # ------------------------------------------------------------------ Figure 4 (heat maps)
    # (the notebook's code sets no font size, but the figure in the paper was drawn with 14-point text and bold titles,
    # as the notebook's own picture shows: the heat maps themselves are the same either way)
    ns = run_cells(repo, "Figures/FIGURE_4_REVISED.ipynb", [1], rc={"font.size": 14, "axes.titleweight": "bold"})
    keep("figure-4", ns, 1)
    dates, lags = ns["dates"], ns["lags"]
    header = ["panel", "lag_months"] + [d.strftime("%Y-%m") for d in dates]
    rows = []
    for kind, mats in (("Raw", ns["raw_matrices"]), ("Deseasoned", ns["des_matrices"])):
        for var in ns["env_vars"]:
            m = mats[var]
            for j, lag in enumerate(lags):
                rows.append([f"{kind} CCF: {var.capitalize()} vs BR", int(lag)] + [round(float(v), 4) for v in m[j]])
    out["figure-4"] = (
        header, rows,
        f"Figure 4 of {SOURCE}\n"
        "The six heat maps, one block of 21 rows each (lags of -20 to 0 months), with a column for each 60-month "
        "window, named by the month the window ends (1957-12 to 2014-12): the Pearson correlation of the driver "
        "with the birth rate, coloured on the colour bar from -1 (dark purple) to 1 (yellow).\n"
        "Each heat map stretches its 21 rows over the y axis from -20 to 0, so each row is 20/21 of a month high, and "
        "the row for a lag of L is centred at -20 + (L + 20.5) * 20/21; likewise its 685 columns over the x axis, "
        "from the first window's end to the last's.")

    # ------------------------------------------------------------------ Supplementary Figure 3
    ns = run_cells(repo, "Supplemental_material/SI_figure_3.ipynb", [1])
    keep("figure-s3", ns, 1)
    rows = []
    for period, df in (("1953-1974", ns["data_pre"]), ("1976-2014", ns["data_post"])):
        thr = 2 / np.sqrt(len(df))
        for var in ("light_resid", "temp_resid"):
            vals = ns["compute_ccf_resid"](df, var, "BR_resid", ns["lags"])
            for lag, v in zip(ns["lags"], vals):
                rows.append([period, var.split("_")[0], int(lag), round(float(v), 6), round(float(thr), 6)])
    out["figure-s3"] = (
        ["panel", "series", "lag_months", "correlation", "dashed_line"], rows,
        f"Supplementary Figure 3 of {SOURCE}\n"
        "Two panels (1953-1974 and 1976-2014), each with two lines with dots: light (yellow) and temp (blue-green), "
        "the correlation of the deseasonalised series with the deseasonalised birth rate at each lag. The dashed "
        "blue lines are at plus and minus dashed_line.")
    return out


def compare_pictures(name: str, original: bytes, again: bytes, out_dir: Path) -> str:
    """How far the figure drawn again from the known values is from the figure in the paper's notebook."""
    from PIL import Image

    a = np.asarray(Image.open(io.BytesIO(original)).convert("RGB")).astype(int)
    b = np.asarray(Image.open(io.BytesIO(again)).convert("RGB")).astype(int)
    if a.shape != b.shape:
        h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
        note = f" (sizes differ: {a.shape[1]}x{a.shape[0]} and {b.shape[1]}x{b.shape[0]})"
        a, b = a[:h, :w], b[:h, :w]
    else:
        note = ""
    d = np.abs(a - b).max(axis=2)
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(255 - 3 * d, 0, 255).astype(np.uint8)).save(out_dir / f"{name}.diff.png")
    if note and name == "figure-4":
        # the text is laid out a few pixels differently: compare the heat maps themselves, frame by frame
        def frames(img):
            dark = img.sum(axis=2) < 150
            rows = np.where(dark[:, : img.shape[1] // 3].sum(axis=1) > img.shape[1] // 5)[0]
            cols = np.where(dark[: img.shape[0] // 2, :].sum(axis=0) > img.shape[0] // 6)[0]
            return rows, cols
        A = np.asarray(Image.open(io.BytesIO(original)).convert("RGB")).astype(int)
        B = np.asarray(Image.open(io.BytesIO(again)).convert("RGB")).astype(int)
        (ra, ca), (rb, cb) = frames(A), frames(B)
        worst = 0.0
        for i in (0, 2):
            for j in (0, 2, 4):
                pa = A[ra[i] + 3: ra[i + 1] - 2, ca[j] + 3: ca[j + 1] - 2]
                pb = B[rb[i] + 3: rb[i] + 3 + pa.shape[0], cb[j] + 3: cb[j] + 3 + pa.shape[1]]
                worst = max(worst, float(np.abs(pa - pb).mean()))
        note += f"; the six heat maps themselves differ by {worst:.2f}/255 on average at most"
    Image.open(io.BytesIO(again)).save(out_dir / f"{name}.again.png")
    return f"{name}: {np.mean(d > 32) * 100:.3f}% of pixels differ by more than 32/255; largest {d.max()}{note}"


def scanned(png: bytes, angle: float, seed: int, quality: int = 70) -> bytes:
    """The look of a figure printed and scanned: turned a little, a little blurred, faint noise, JPEG."""
    from PIL import Image, ImageFilter

    rng = np.random.default_rng(seed)
    img = Image.open(io.BytesIO(png)).convert("RGB")
    img = img.resize((int(img.width * 1.25), int(img.height * 1.25)), Image.LANCZOS)
    img = img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=(250, 249, 245))
    img = img.filter(ImageFilter.GaussianBlur(0.7))
    a = np.asarray(img).astype(np.float32)
    a = a * np.array([0.98, 0.97, 0.94]) + 4 + rng.normal(0, 3.0, a.shape)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("repo", help="a checkout of the paper's repository")
    ap.add_argument("--check", action="store_true", help="also check each known-values file against its figure")
    a = ap.parse_args()
    repo = Path(a.repo)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "data").mkdir(exist_ok=True)

    for name, (nb, cell, which) in PICTURES.items():
        (OUT / f"{name}.png").write_bytes(picture(repo, nb, cell, which))

    # the data, with a header row (the repository's data.csv has none)
    lines = (repo / "time-series" / "data.csv").read_text(encoding="utf-8-sig").splitlines()
    (OUT / "data" / "births.csv").write_text("year,month,births,peak_conception_month\n" + "\n".join(lines) + "\n",
                                             encoding="utf-8")
    env = (repo / "time-series" / "environmental.csv").read_text(encoding="utf-8-sig")
    (OUT / "data" / "environmental.csv").write_text(env.replace("\r\n", "\n"), encoding="utf-8")

    notes = []
    for name, (header, rows, note) in known_values(repo, a.check).items():
        write_csv(OUT / f"{name}.known.csv", header, rows)
        first, *rest = note.strip().splitlines()
        notes.append(f"### {name}.png and {name}.known.csv\n\n{first}.\n\n" + "\n".join(f"- {line}" for line in rest) + "\n")
    readme = (HERE / "examples-readme.md").read_text(encoding="utf-8")
    (OUT / "README.md").write_text(readme.replace("<!--FIGURES-->", "\n".join(notes)), encoding="utf-8")

    if a.check:
        for name in PICTURES:
            if name in RENDERED:
                print(compare_pictures(name, (OUT / f"{name}.png").read_bytes(), RENDERED[name], SITE / "build" / "check"))
            else:
                print(f"{name}: not drawn again")

    # two figures as if from an old printed journal
    (OUT / "figure-1b-scanned.jpg").write_bytes(scanned((OUT / "figure-1b.png").read_bytes(), 1.2, 1))
    (OUT / "figure-3c-scanned.jpg").write_bytes(scanned((OUT / "figure-3c.png").read_bytes(), -0.8, 2))

    for p in sorted(OUT.rglob("*")):
        if p.is_file():
            print(f"{p.relative_to(SITE)}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
