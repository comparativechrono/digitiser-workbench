"""Compare what was digitised from one of the workbench's examples with the values the figure really shows.

The examples are the figures of Hearn and Whitmore (2026) (``/data/examples/hearn-whitmore-2026``), and beside
each is ``FIGURE.known.csv``: the values the figure was drawn from. :func:`compare` lines up a digitised table with
them, figure by figure, and says how far apart they are; from the command line::

    compare-known ~/results/figure-3c/figure-3c_points.csv
"""
from __future__ import annotations

import argparse
import math
import os
import re
import sys
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

EXAMPLES_DIR = os.environ.get("DWB_EXAMPLES", "/data/examples/hearn-whitmore-2026")
FIGURES = ("figure-1a", "figure-1b", "figure-2", "figure-3a", "figure-3b", "figure-3c", "figure-4", "figure-s3")


def which_example(name: str) -> Optional[str]:
    """The example a file comes from, by its name: figure-3c-scanned_points.csv -> figure-3c."""
    base = os.path.basename(str(name)).lower()
    if base.startswith("hearn-whitmore-2026-"):
        base = base[len("hearn-whitmore-2026-"):]
    for f in sorted(FIGURES, key=len, reverse=True):
        if base.startswith(f):
            return f
    return None


def known_values(example: str, directory: str = EXAMPLES_DIR) -> pd.DataFrame:
    return pd.read_csv(os.path.join(directory, f"{example}.known.csv"))


def _colour(text) -> tuple:
    t = str(text).strip()
    if t.startswith("#") and len(t) == 7:
        return tuple(int(t[i: i + 2], 16) for i in (1, 3, 5))
    nums = re.findall(r"\d+", t)
    return tuple(int(v) for v in nums[:3]) if len(nums) >= 3 else (0, 0, 0)


def _near(colour, target, tol=70.0) -> bool:
    return math.dist(_colour(colour), target) <= tol


def _stats(err: np.ndarray, scale: float) -> Dict[str, float]:
    err = np.asarray(err, dtype=float)
    err = err[np.isfinite(err)]
    if err.size == 0:
        return {"n": 0}
    a = np.abs(err)
    return {
        "n": int(err.size),
        "median_abs": float(np.median(a)),
        "p95_abs": float(np.percentile(a, 95)),
        "max_abs": float(a.max()),
        "mean": float(err.mean()),
        "median_abs_pct": float(100 * np.median(a) / scale) if scale else float("nan"),
        "rmse_pct": float(100 * np.sqrt(np.mean(err ** 2)) / scale) if scale else float("nan"),
    }


def _fmt(v: float) -> str:
    if v is None or not np.isfinite(v):
        return "-"
    return f"{v:.3g}" if abs(v) < 1000 else f"{v:,.0f}"


def _line(label: str, s: Dict[str, float], unit: str = "") -> str:
    if not s.get("n"):
        return f"{label}: nothing to compare"
    return (f"{label}: {s['n']} compared; typical error {_fmt(s['median_abs'])}{unit} "
            f"({s['median_abs_pct']:.2f}% of the axis), worst {_fmt(s['max_abs'])}{unit}")


def _trace_y(data: pd.DataFrame) -> pd.Series:
    return data["center_estimate"] if "center_estimate" in data else data["y_value"]


def _compare_lines(data, known, xcol, ycol, axis_range, label, x_lo=None, x_hi=None):
    k = known.sort_values(xcol)
    if "x_value" not in data or data["x_value"].isna().all():
        return None
    x = data["x_value"].to_numpy(float)
    y = _trace_y(data).to_numpy(float)
    lo = k[xcol].min() if x_lo is None else x_lo
    hi = k[xcol].max() if x_hi is None else x_hi
    m = (x >= lo) & (x <= hi) & np.isfinite(y)
    want = np.interp(x[m], k[xcol].to_numpy(float), k[ycol].to_numpy(float))
    s = _stats(y[m] - want, axis_range)
    pairs = list(zip(x[m][:: max(1, m.sum() // 400)].round(4), want[:: max(1, m.sum() // 400)].round(5),
                     y[m][:: max(1, m.sum() // 400)].round(5)))
    return s, pairs, label


def compare(example: str, data: pd.DataFrame, kind: Optional[str] = None,
            directory: str = EXAMPLES_DIR) -> Dict[str, Any]:
    """Line up *data* (a digitised table: ``result.trace_data``, or ``result.data`` of the other readers) with the
    known values of *example* and say how far apart they are.

    Returns ``{"example", "kind", "lines": [sentences], "stats": {...}, "pairs": [[x, known, digitised] ...]}``.
    """
    known = known_values(example, directory)
    out: Dict[str, Any] = {"example": example, "kind": kind, "lines": [], "stats": {}, "pairs": []}
    lines: List[str] = out["lines"]
    if data is None or len(data) == 0:
        lines.append("Nothing was digitised to compare.")
        return out
    if kind is None:
        kind = ("lines" if "center_estimate" in data else "bars" if "baseline" in data else "rows" if "fraction" in data
                else "heatmap" if "colour_error" in data else "polar" if "angle_degrees" in data else "points")
        out["kind"] = kind

    if example == "figure-1a" and kind == "lines":
        for trace_id, g in data.groupby(["panel_id", "trace_id"]):
            c = g["trace_median_rgb"].iloc[0] if "trace_median_rgb" in g else ""
            values = _trace_y(g).to_numpy(float)
            typical = float(np.nanmedian(values)) if np.isfinite(values).any() else float("nan")
            if _near(c, (70, 130, 180)):
                r = _compare_lines(g, known, "decimal_year", "births", 35000, "births (blue line)")
            elif _near(c, (255, 140, 0), 90):
                if not 4 <= typical <= 15:
                    lines.append("The orange line was read against the left-hand axis (births), but it is drawn "
                                 "against the right-hand one, whose labels are months (June = 6 ... January = 13): "
                                 "digitise it on its own, with two ticks of that axis and their values.")
                    continue
                r = _compare_lines(g, known, "decimal_year", "peak_conception_month", 7.5,
                                   "peak-conception month (orange line)")
            elif _near(c, (34, 139, 34), 90):
                inset = known[known.in_inset.astype(str).str.lower() == "true"]
                xs = g["x_value"].to_numpy(float) if "x_value" in g else np.array([np.nan])
                if not np.isfinite(xs).any() or np.nanmin(xs) < 1965:
                    lines.append("The green line is drawn against the inset's own axes (1972-1979): digitise it with "
                                 "the inset as the plot area, and its ticks for the x axis.")
                    continue
                r = _compare_lines(g, inset, "decimal_year", "births", 25000, "births 1972-1978 (green inset)")
            else:
                continue
            if r:
                s, pairs, label = r
                out["stats"][label] = s
                out["pairs"].extend(pairs)
                lines.append(_line(label, s))
            else:
                lines.append("A line was found, but its x axis is not calibrated, so it cannot be compared.")
        if not lines:
            lines.append("No trace of the figure's colours (blue, orange, green) with a calibrated x axis was found.")
        if any("blue" in k for k in out["stats"]):
            lines.append("The births line is dense: each pixel column holds more than a month, so the digitised "
                         "centre is the middle of what is drawn there, not the month's value; expect a few per cent.")

    elif example == "figure-1b" and kind == "bars":
        d = data.sort_values("x_pixel").reset_index(drop=True)
        if len(d) != 12:
            lines.append(f"{len(d)} bars were found; the figure has 12.")
        n = min(12, len(d))
        err = d["value"].to_numpy(float)[:n] - known["percent_difference"].to_numpy(float)[:n]
        s = _stats(err, 25.0)
        out["stats"]["bars"] = s
        out["pairs"] = [[int(m), float(k), float(v)] for m, k, v in
                        zip(known["month"][:n], known["percent_difference"][:n], d["value"][:n])]
        lines.append(_line("bar heights", s, " %"))
        if "error_low" in d:
            half = 0.5 * (d["error_high"] - d["error_low"])
            lines.append(f"error bars: half-length {half.median():.3g} (one bootstrap standard error, drawn the same "
                         "for every bar; the notebook's bootstrap was not seeded, so the figure is the only record of it)")

    elif example == "figure-2" and kind == "rows":
        d = data.copy()
        if "row_value" in d and d["row_value"].notna().all():
            d["row_year"] = np.round(d["row_value"]).astype(int)
        else:
            d["row_year"] = 1955 + d["row"].astype(int) - 1
        if "bin" in d:
            d["column"] = d["bin"].astype(int) - 1
        else:
            d["column"] = np.clip(np.floor(d["x_norm_0_to_1"] * 24), 0, 23).astype(int)
        if "value" not in d:
            d["value"] = d["fraction"] * 1.1
        agg = {"value": "median"}
        if "dot" in d:
            agg["dot"] = "max"
        d = d.groupby(["row_year", "column"], as_index=False).agg(agg)
        m = d.merge(known, on=["row_year", "column"])
        s = _stats(m["value"] - m["normalised_births"], 1.0)
        out["stats"]["rows"] = s
        out["pairs"] = m[["row_year", "normalised_births", "value"]].head(600).round(4).values.tolist()
        lines.append(_line(f"{m['row_year'].nunique()} rows x {m['column'].nunique()} months", s))
        if m["row_year"].nunique() < 59:
            lines.append(f"{59 - m['row_year'].nunique()} of the 59 years were not found.")
        if "dot" in m:
            agree = int((m["dot"].astype(bool) == m["peak_dot"].astype(str).str.lower().eq("true")).sum())
            lines.append(f"dots: {agree} of {len(m)} months agree on whether a dot is drawn there")

    elif example == "figure-3a" and kind == "lines":
        for pid, g in data.groupby("panel_id"):
            era = "1955-1974" if pid == data["panel_id"].min() else "1976-2014"
            k = known[known.panel == era]
            r = _compare_lines(g, k, "period_months", "amplitude", 0.25, f"panel {pid} ({era})", 2.0, 20.0)
            if r:
                s, pairs, label = r
                out["stats"][label] = s
                out["pairs"].extend(pairs)
                lines.append(_line(label, s))
            else:
                lines.append(f"panel {pid}: its x axis is not calibrated, so it cannot be compared")

    elif example == "figure-3b" and kind == "polar":
        if "r_value" not in data:
            lines.append("No points to compare.")
        elif data["r_value"].max() <= 1.5:
            lines.append("The distances from the centre are fractions of the outer circle's radius: give two rings "
                         "and the years they are labelled with (1955 is the innermost ring, 2005 the outermost "
                         "labelled one) to compare them with the years.")
        else:
            got = data.copy()
            k = known.copy()
            # each known point -> the nearest digitised one, on the plot (radius in years, angle in degrees)
            used = set()
            errs_a, errs_r, pairs = [], [], []
            for row in k.itertuples():
                best, bi = None, None
                for i, g in enumerate(got.itertuples()):
                    da = (g.angle_degrees - row.angle_degrees + 180) % 360 - 180
                    dr = g.r_value - row.year
                    dist = math.hypot(dr * 2.0, da / 3.0)
                    if best is None or dist < best:
                        best, bi = dist, i
                if bi is not None and best < 2.0 and bi not in used:
                    used.add(bi)
                    g = got.iloc[bi]
                    errs_a.append((g.angle_degrees - row.angle_degrees + 180) % 360 - 180)
                    errs_r.append(g.r_value - row.year)
                    pairs.append([int(row.year), float(row.angle_degrees), float(g.angle_degrees)])
            sa, sr = _stats(np.array(errs_a), 360.0), _stats(np.array(errs_r), 60.0)
            out["stats"] = {"angle": sa, "radius": sr}
            out["pairs"] = pairs
            lines.append(f"{len(pairs)} of {len(k)} years found; {len(got) - len(pairs)} other points found "
                         "(where markers overlap)")
            lines.append(_line("angles", sa, " degrees"))

    elif example == "figure-3c" and kind == "points":
        s1 = data[data["series"] == data["series"].min()].copy()
        s1["year"] = np.round(s1["y_value"]).astype(int)
        m = s1.merge(known, left_on="year", right_on="window_midpoint_year")
        s = _stats(m["x_value"] - m["circular_sd"], 0.75)
        out["stats"]["points"] = s
        out["pairs"] = m[["year", "circular_sd", "x_value"]].round(5).values.tolist()
        lines.append(f"{len(m)} of {len(known)} windows found")
        lines.append(_line("circular SD", s, " rad"))
        if "x_error_low" in m:
            ok = m.dropna(subset=["x_error_low"])
            lo = _stats(ok["x_error_low"] - ok["ci_low"], 0.75)
            hi = _stats(ok["x_error_high"] - ok["ci_high"], 0.75)
            out["stats"]["ci_low"], out["stats"]["ci_high"] = lo, hi
            lines.append(_line("confidence intervals, lower ends", lo, " rad"))
            lines.append(_line("confidence intervals, upper ends", hi, " rad"))

    elif example == "figure-s3" and kind in ("points", "lines"):
        if kind == "points":
            d = data.copy()
            d["lag"] = np.round(d["x_value"]).astype(int)
            panels = sorted(d["panel_id"].unique())
            d["panel"] = d["panel_id"].map({panels[0]: "1953-1974", panels[-1]: "1976-2014"})
            d["series_name"] = [("light" if _near(c, (225, 175, 4), 80) else "temp") for c in d["colour"]]
            m = d.merge(known, left_on=["panel", "series_name", "lag"], right_on=["panel", "series", "lag_months"])
            s = _stats(m["y_value"] - m["correlation"], 0.35)
            out["stats"]["points"] = s
            out["pairs"] = m[["lag", "correlation", "y_value"]].round(5).values.tolist()
            lines.append(f"{len(m)} of {len(known)} points found")
            lines.append(_line("correlations", s))
        else:
            for (pid, tid), g in data.groupby(["panel_id", "trace_id"]):
                c = g["trace_median_rgb"].iloc[0]
                series = "light" if _near(c, (225, 175, 4), 80) else "temp" if _near(c, (56, 152, 178), 80) else None
                if series is None:
                    continue
                era = "1953-1974" if pid == data["panel_id"].min() else "1976-2014"
                k = known[(known.panel == era) & (known.series == series)]
                r = _compare_lines(g, k, "lag_months", "correlation", 0.35, f"panel {pid} {series}")
                if r:
                    s, pairs, label = r
                    out["stats"][label] = s
                    out["pairs"].extend(pairs)
                    lines.append(_line(label, s))

    elif example == "figure-4" and kind == "heatmap":
        names = list(dict.fromkeys(known["panel"]))
        mats = {n: known[known.panel == n].sort_values("lag_months").iloc[:, 2:].to_numpy(float) for n in names}
        errs = []
        pids = sorted(data["panel_id"].unique())
        for i, pid in enumerate(pids[:6]):
            m = mats[names[i]]
            nrow, ncol = m.shape
            sub = data[(data.panel_id == pid)].dropna(subset=["value"])
            ncell = int(data[data.panel_id == pid]["col"].max())
            per = []
            for c in sub.itertuples():
                lag = c.y_value if np.isfinite(c.y_value) else -20 + (nrow - c.row)
                j = int(round(lag)) + 20
                if not 0 <= j < nrow:
                    continue
                a = int(np.floor((c.col - 1) / ncell * ncol))
                b = max(a + 1, int(np.ceil(c.col / ncell * ncol)))
                per.append(c.value - np.nanmean(m[j, a:b]))
            s = _stats(np.array(per), 2.0)
            out["stats"][names[i]] = s
            lines.append(_line(names[i], s))
            errs.extend(per)
        out["stats"]["all"] = _stats(np.array(errs), 2.0)
    else:
        lines.append(f"There is no comparison of {kind} with {example}: the example is read as "
                     + {"figure-1a": "lines", "figure-1b": "bars", "figure-2": "rows", "figure-3a": "lines",
                        "figure-3b": "polar", "figure-3c": "points", "figure-4": "a heat map",
                        "figure-s3": "points or lines"}.get(example, "?") + ".")
    return out


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="compare-known", description="Compare a table digitised from one of the "
                                 "examples (Hearn and Whitmore 2026) with the values the figure shows.")
    ap.add_argument("csv", help="what was digitised: a _trace_by_column.csv, _points.csv, _bars.csv ... file")
    ap.add_argument("--example", choices=FIGURES, help="which example (found from the file's name if not given)")
    ap.add_argument("--kind", choices=["lines", "points", "bars", "rows", "heatmap", "polar"])
    a = ap.parse_args(argv)
    example = a.example or which_example(a.csv)
    if example is None:
        print(f"compare-known: {a.csv} is not named after one of the examples ({', '.join(FIGURES)}): "
              "give --example", file=sys.stderr)
        return 2
    data = pd.read_csv(os.path.expanduser(a.csv))
    kind = a.kind
    if kind is None:
        name = os.path.basename(a.csv)
        for k in ("points", "bars", "rows", "heatmap", "polar"):
            if f"_{k}." in name:
                kind = k
        if kind is None and "trace_by_column" in name:
            kind = "lines"
    r = compare(example, data, kind)
    print(f"{example} ({r['kind']}):")
    for line in r["lines"]:
        print("  " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
