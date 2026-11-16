"""Reading a line's narrow peaks at their tips.

trace-digitiser's line reader gives, for each pixel column, the middle of what is drawn there
(``center_estimate``) and its top and bottom (``upper_envelope``, ``lower_envelope``). Where a peak of the line is a
pixel or two wide - a spike in a spectrum - the column that holds it holds the whole spike, from the floor up to its
tip, and its middle is about half way up. :func:`peaks_at_tips` takes such a column at its tip instead: the top of
what is drawn there, less half the line's thickness (and the bottom, plus half, for a trough). It is the workbench's
"Peaks: at their tips" option for lines, applied to the reader's table after reading.
"""
from __future__ import annotations


def peaks_at_tips(result, tall: float = 2.5, window: int = 3):
    """``result.trace_data`` with each narrow peak (and trough) of a line read at its tip.

    A column is taken at its tip when what is drawn in it is more than *tall* times as tall as the line is thick (the
    tenth percentile of the columns' heights), its top is as high as the columns beside it (within a pixel), and it
    rises above the line's level round it (the median of the middles of the *window* columns each side) more than
    twice as far as it falls below it. Its value is then the top less half the line's thickness; a trough, the bottom
    plus half. Every other column keeps its middle. The column ``tip`` says which were taken at a tip.
    """
    import numpy as np

    data = result.trace_data.copy()
    data["tip"] = False
    if not len(data) or "upper_envelope" not in data:
        return data
    cals = {p.panel_id: p.calibration for p in result.panels}
    for (pid, _), g in data.groupby(["panel_id", "trace_id"], sort=False):
        cal = cals.get(pid)
        if cal is None or not cal.is_calibrated:
            continue
        g = g.sort_values("x_pixel")
        # in pixel rows, which grow downwards: what is drawn in a column runs from row `top` to row `bottom`
        r1 = cal.value_to_y(g["upper_envelope"].to_numpy(float))
        r2 = cal.value_to_y(g["lower_envelope"].to_numpy(float))
        top, bottom = np.minimum(r1, r2), np.maximum(r1, r2)
        mid = cal.value_to_y(g["center_estimate"].to_numpy(float))
        seen = ~g["interpolated"].to_numpy(bool) if "interpolated" in g else np.ones(len(g), bool)
        seen &= np.isfinite(top) & np.isfinite(bottom) & np.isfinite(mid)
        if seen.sum() < 2 * window + 1:
            continue
        height = bottom - top
        thick = max(1.0, float(np.percentile(height[seen], 10)))
        n = len(g)
        new = mid.copy()
        tip = np.zeros(n, bool)
        for k in np.nonzero(seen & (height > tall * thick))[0]:
            around = [i for i in range(max(0, k - window), min(n, k + window + 1)) if i != k and seen[i]]
            if len(around) < 2:
                continue
            level = float(np.median(mid[around]))
            near = [i for i in (k - 1, k + 1) if 0 <= i < n and seen[i]]
            rise, fall = level - top[k], bottom[k] - level
            if rise > 2 * fall and all(top[k] <= top[i] + 1 for i in near):
                new[k], tip[k] = top[k] + thick / 2, True
            elif fall > 2 * rise and all(bottom[k] >= bottom[i] - 1 for i in near):
                new[k], tip[k] = bottom[k] - thick / 2, True
        idx = g.index[tip]
        data.loc[idx, "center_estimate"] = cal.y_to_value(new[tip])
        data.loc[idx, "tip"] = True
    return data
