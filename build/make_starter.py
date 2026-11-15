#!/usr/bin/env python3
"""Write the notebooks a new user finds in ~/notebooks (data/starter/*.ipynb):

- 01-digitise-in-python.ipynb: trace-digitiser in Python, on the examples - lines, points, what it finds in a
  figure, ticks clicked by hand - with each result checked against the values the figure shows;
- 02-how-close-is-it.ipynb: every example digitised as the help's walkthroughs do it, and a table of how close each
  comes to the known values;
- 03-using-the-values.ipynb: what digitised values are for - Figure 1b worked out again from the line of Figure 1a,
  and the shift of the peak month of births read from the birthogram of Figure 2.

Every code cell is run by build/test_starter.py (with the paths changed to this repository's), so they stay correct.
Someone who visited the workbench before a notebook was added is given it on their next visit (page-wb.js).

Run:  python3 build/make_starter.py   (then python3 build/make_page.py)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "data", "starter")

FIRST = [
    ("md", """# Digitising in Python

This notebook uses **trace-digitiser** directly, as you would on your own computer (`pip install trace-digitiser`).
It is the same package that the **Digitise** tab and the **Terminal** run. Run the cells in order from the top: click
a cell and press **Shift+Enter**. Python is already running in your browser if you have opened the Digitise tab;
otherwise the first cell starts it.

The examples are the figures of Hearn and Whitmore (2026), in `/data/examples/hearn-whitmore-2026`. Beside each
figure is `FIGURE.known.csv`, the values it was drawn from, so every result here can be checked. Nothing you do
here leaves the browser."""),
    ("code", """import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import trace_digitiser as td

EX = "/data/examples/hearn-whitmore-2026"
OUT = os.path.expanduser("~/results/notebook")   # (Python does not expand ~ by itself)
os.makedirs(OUT, exist_ok=True)
print("trace-digitiser", td.__version__)"""),
    ("md", """## Lines: Figure 3a

`td.digitise` reads the lines of a figure. Figure 3a has two panels, one above the other, and only the lower one
has numbers on its x axis: trace-digitiser finds both panels, reads the axes it can, and gives the upper panel the
lower one's x scale. **Read `result.warnings`** every time: they say what it was unsure of."""),
    ("code", """result = td.digitise(f"{EX}/figure-3a.png", output_dir=OUT)
for message in result.warnings:
    print("CHECK:", message)
lines = result.trace_data
lines.head()"""),
    ("md", """`trace_data` has a row for each column of pixels of each line: `x_value` (in the units of the x axis),
`center_estimate` (the middle of the line in that column, in the units of the y axis), `upper_envelope` and
`lower_envelope` (its top and bottom edges), and `interpolated` (True where nothing of the line was in that column).
Here are the two lines, drawn again from those values:"""),
    ("code", """fig, axes = plt.subplots(2, 1, figsize=(7, 5), sharex=True)
for ax, (panel, g) in zip(axes, lines.groupby("panel_id")):
    ax.plot(g["x_value"], g["center_estimate"])
    ax.set_ylabel("amplitude")
    ax.set_title(f"panel {panel}", fontsize=10)
axes[-1].set_xlabel("period (months)")
plt.show()"""),
    ("md", """How close is it? The known values are the points the lines were drawn through; between them the line is
straight, so the values in between are found by interpolating."""),
    ("code", """known = pd.read_csv(f"{EX}/figure-3a.known.csv")
for (panel, g), era in zip(lines.groupby("panel_id"), ["1955-1974", "1976-2014"]):
    k = known[known.panel == era].sort_values("period_months")
    inside = g[(g.x_value >= 2) & (g.x_value <= 20)]
    want = np.interp(inside.x_value, k.period_months, k.amplitude)
    err = (inside.center_estimate - want).abs()
    print(f"panel {panel} ({era}): typical error {err.median():.5f}, the y axis spans 0.25")"""),
    ("md", """## Points and their error bars: Figure 3c

`td.digitise_points` finds markers - of any shape - and their error bars. In Figure 3c each dot is a ten-year
window: its x is the circular standard deviation of the peak phase of births, its y the window's middle year, on an
axis that runs downwards, and the grey bars are 95% confidence intervals."""),
    ("code", """points = td.digitise_points(f"{EX}/figure-3c.png", output_dir=OUT)
for message in points.warnings:
    print("CHECK:", message)
p = points.data[["y_value", "x_value", "x_error_low", "x_error_high"]].rename(
    columns={"y_value": "year", "x_value": "circular_sd", "x_error_low": "ci_low", "x_error_high": "ci_high"})
p.head()"""),
    ("code", """known = pd.read_csv(f"{EX}/figure-3c.known.csv")
p["year"] = p["year"].round().astype(int)
both = p.merge(known, left_on="year", right_on="window_midpoint_year", suffixes=("", "_known"))
print(len(both), "of", len(known), "windows found")
print("typical error of the circular SD:", (both.circular_sd - both.circular_sd_known).abs().median().round(5))
print("typical error of the interval ends:", (both.ci_low - both.ci_low_known).abs().median().round(5),
      (both.ci_high - both.ci_high_known).abs().median().round(5))"""),
    ("md", """## What trace-digitiser sees

`td.describe_figure` says what the automatic steps find, without digitising anything: the plot areas, the tick
labels beside each axis and what was read from them, the scale they give, and the colours drawn. The Digitise tab
shows the same over the picture. It is the place to start when a figure is not read as you expected."""),
    ("code", """info = td.describe_figure(f"{EX}/figure-1a.png")
for p in info["panels"]:
    print("panel", p["panel_id"], "at", p["plot_area"])
    for axis in ("y_axis", "y2_axis", "x_axis"):
        a = p.get(axis)
        if a:
            read = [lab["text"] for lab in a["labels"]]
            print(f"  {axis}: read {read}; scale: {a.get('scale')} ({a.get('confidence')})")
    print("  colours:", [c["hex"] for c in p["colours"]])"""),
    ("md", """The right-hand axis of Figure 1a is labelled with months - *June* to *January* - which are not numbers, so
no scale can be read from them. Tell trace-digitiser what two of its ticks stand for instead (`y_ref`: the row of
the tick and its value; June = 6, January = 13), and which colour to read (the orange line):"""),
    ("code", """orange = td.digitise(f"{EX}/figure-1a.png", trace_colours=["#ff8c00"], exclude=[(990, 15, 1296, 58)],
                     y_ref=[(485.5, 6), (34.5, 13)], output_dir=OUT, output_prefix="figure-1a-orange")
o = orange.trace_data
known = pd.read_csv(f"{EX}/figure-1a.known.csv")
want = np.interp(o.x_value, known.decimal_year, known.peak_conception_month)
print("typical error:", (o.center_estimate - want).abs().median().round(3), "months")"""),
    ("md", """## Points picked by hand

`td.pixels_to_values` turns positions in the picture (pixels, from the top-left corner) into values, from two or more
ticks of each axis and the values they stand for. It is what to use for a point that nothing else can find."""),
    ("code", """# two ticks of each axis of Figure 3c: x 0.1 at column 154 and 0.7 at column 533; y 1960 at row 42 and 2010 at row 683
# (the Digitise tab's status bar shows the pixel under the mouse)
td.pixels_to_values([(330, 210)], x_ref=[(154, 0.1), (533, 0.7)], y_ref=[(42, 1960), (683, 2010)])"""),
    ("md", """## On your own computer

```
pip install trace-digitiser
```

and install Tesseract, which reads the tick labels (Ubuntu: `sudo apt install tesseract-ocr`; macOS:
`brew install tesseract`; Windows: the installer from the University of Mannheim). Then the code above works as it
is, with the paths of your own pictures. The help's *On your own computer* says more."""),
]

SECOND = [
    ("md", """# How close is it?

Every example digitised as the help's walkthroughs do it - with the same marks and options - and compared with the
values the figure really shows (`dwb.known`, the workbench's comparison; `compare-known` in the Terminal). This takes
a minute or so: Figure 2 has 59 rows of labels to read."""),
    ("code", """import os, time, warnings
import pandas as pd
import trace_digitiser as td
from dwb import known

EX = "/data/examples/hearn-whitmore-2026"
RECIPES = [
    ("figure-1a", "lines", dict(trace_colours=["#4682b4"], exclude=[(120, 15, 262, 58)])),
    ("figure-1a", "lines", dict(trace_colours=["#ff8c00"], exclude=[(990, 15, 1296, 58)], y_ref=[(485.5, 6), (34.5, 13)])),
    ("figure-1a", "lines", dict(trace_colours=["#228b22"], plot_area=(543, 20, 876, 159),
                                x_ref=[(558, 1972), (865, 1979)], y_ref=[(62, 60000), (118, 50000)])),
    ("figure-1b", "bars", dict()),
    ("figure-2", "rows", dict(row_values=list(range(1955, 2014)), bins=24, dots="black", row_spacing_value=1.1)),
    ("figure-3a", "lines", dict()),
    ("figure-3b", "polar", dict(colours=["#1f77b4"], r_ref=[(5, 1955), (250, 2005)])),
    ("figure-3c", "points", dict()),
    ("figure-4", "heatmap", dict(rows=21)),
    ("figure-s3", "points", dict()),
]
READER = {"lines": td.digitise, "points": td.digitise_points, "bars": td.digitise_bars, "rows": td.digitise_rows,
          "heatmap": td.digitise_heatmap, "polar": td.digitise_polar}"""),
    ("code", """rows = []
for figure, kind, options in RECIPES:
    t = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = READER[kind](f"{EX}/{figure}.png", write_outputs=False, **options)
    data = result.trace_data if kind == "lines" else result.data
    c = known.compare(figure, data, kind)
    for label, s in c["stats"].items():
        if s.get("n"):
            rows.append({"figure": figure, "kind": kind, "what": label, "compared": s["n"],
                         "typical error": round(s["median_abs"], 5), "% of the axis": round(s["median_abs_pct"], 2),
                         "seconds": round(time.time() - t, 1)})
summary = pd.DataFrame(rows)
summary"""),
    ("md", """*Typical error* is the median of the absolute differences, in the units of the axis, and *% of the axis* the
same as a percentage of the axis's span. Most are a small fraction of a pixel. The exceptions say something about
the figures:

- **Figure 1a, births**: the line is dense - each column of pixels holds more than a month - so the middle of what is
  drawn in a column is not any one month's value.
- **Figure 2**: each row's fill is a few pixels high, so a pixel is a large part of it.
- **Figure 3b, angles**: only the points found are compared; where markers overlap, some years are missed and other
  points are found. The walkthrough shows how to put that right by hand (*Edit points*).
- **Figure 4**: each column of pixels is nearly two of the heat map's columns, which are averaged here."""),
]

THIRD = [
    ("md", """# Using digitised values

Digitising is a means: the values are for something. Two examples with the paper's figures, each checked against
what the paper's own data give."""),
    ("md", """## Figure 1b, worked out again from the line of Figure 1a

Figure 1a draws the number of births in each month from 1955 to 2014; Figure 1b shows, for each month of the year,
how much fewer births there were from 1975 on than before. So Figure 1b can be worked out from Figure 1a - from
its *picture*. Read the blue line, take its value in the middle of each month, and compare the two eras."""),
    ("code", """import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import trace_digitiser as td

EX = "/data/examples/hearn-whitmore-2026"
line = td.digitise(f"{EX}/figure-1a.png", trace_colours=["#4682b4"], exclude=[(120, 15, 262, 58)],
                   write_outputs=False)
d = line.trace_data
months = pd.read_csv(f"{EX}/figure-1a.known.csv", parse_dates=["date"])   # (only its dates are used here)
months["births_read"] = np.interp(months.decimal_year, d.x_value, d.mean_estimate)
months["month"] = months.date.dt.month
before = months[months.date.dt.year <= 1974].groupby("month").births_read.mean()
after = months[months.date.dt.year >= 1975].groupby("month").births_read.mean()
read = 100 * (after - before) / before
paper = pd.read_csv(f"{EX}/figure-1b.known.csv")
table = pd.DataFrame({"month": paper.label, "from the picture of 1a": read.round(1).values,
                      "Figure 1b": paper.percent_difference.round(1).values})
table"""),
    ("code", """x = np.arange(12)
plt.figure(figsize=(7, 3.5))
plt.bar(x - 0.2, table["Figure 1b"], width=0.4, label="Figure 1b (the data)")
plt.bar(x + 0.2, table["from the picture of 1a"], width=0.4, label="worked out from the picture of Figure 1a")
plt.xticks(x, table.month)
plt.ylabel("% difference, 1975- against 1955-1974")
plt.legend(fontsize=8)
plt.show()
print("largest difference:", (table["Figure 1b"] - table["from the picture of 1a"]).abs().max().round(2), "points")"""),
    ("md", """Within a point or two everywhere: the shape of the result - fewest births lost in the autumn, most in the
spring - comes out of the picture alone."""),
    ("md", """## The peak of the birthogram, year by year

Figure 2 shows each year as a row: its months' births scaled from 0 (the year's fewest) to 1 (its most). Read with
24 bins - two years of months, as it is drawn - the first twelve bins of each row are its own year. The month with
the most births each year moves in the mid-1970s, which is what the paper is about."""),
    ("code", """rows = td.digitise_rows(f"{EX}/figure-2.png", row_values=list(range(1955, 2014)), bins=24,
                       row_spacing_value=1.1, write_outputs=False).data
own = rows[rows.bin <= 12].copy()
peak = own.loc[own.groupby("row_value").value.idxmax(), ["row_value", "bin"]].astype(int)
peak.columns = ["year", "peak month"]
known = pd.read_csv(f"{EX}/figure-2.known.csv")
k = known[known.column < 12]
known_peak = k.loc[k.groupby("row_year").normalised_births.idxmax(), ["row_year", "column"]]
peak["peak month (data)"] = known_peak.column.values + 1
print("the same peak month in", (peak["peak month"] == peak["peak month (data)"]).sum(), "of", len(peak), "years")
plt.figure(figsize=(7, 3))
plt.plot(peak.year, peak["peak month"], "o-", label="read from the picture")
plt.plot(peak.year, peak["peak month (data)"], "x", label="the data")
plt.yticks(range(1, 13))
plt.ylabel("month with most births")
plt.legend(fontsize=8)
plt.show()"""),
]

NOTEBOOKS = {"01-digitise-in-python.ipynb": FIRST, "02-how-close-is-it.ipynb": SECOND, "03-using-the-values.ipynb": THIRD}


def write(name, cell_list):
    cells = []
    for kind, src in cell_list:
        lines = src.split("\n")
        source = [l + "\n" for l in lines[:-1]] + [lines[-1]]
        if kind == "md":
            cells.append({"cell_type": "markdown", "id": "c%02d" % len(cells), "metadata": {}, "source": source})
        else:
            cells.append({"cell_type": "code", "id": "c%02d" % len(cells), "metadata": {}, "source": source,
                          "execution_count": None, "outputs": []})
    nb = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"name": "python3", "display_name": "Python 3 (ipykernel)", "language": "python"},
            "language_info": {"name": "python", "file_extension": ".py", "mimetype": "text/x-python"},
            "workbench": {"made_with": "Digitiser workbench (in the browser)"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8") as fh:
        json.dump(nb, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("data/starter/{}: {} cells".format(name, len(cells)))


def main():
    for name, cell_list in NOTEBOOKS.items():
        write(name, cell_list)


if __name__ == "__main__":
    main()
