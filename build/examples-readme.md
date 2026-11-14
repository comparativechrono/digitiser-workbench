# The examples: Hearn and Whitmore (2026)

The figures here are from our own paper,

> Hearn TJ, Whitmore D (2026). An abrupt mid-1970s shift in UK birth seasonality and its implications for
> chronobiological studies. *Journal of Biological Rhythms* 41(1): 28–41.
> [doi:10.1177/07487304251384348](https://doi.org/10.1177/07487304251384348)

and every value they show is known. The data and the notebooks that drew the figures are in the paper's repository,
[comparativechrono/Rephasing-of-Seasonal-Birth-Rates-in-the-United-Kingdom-](https://github.com/comparativechrono/Rephasing-of-Seasonal-Birth-Rates-in-the-United-Kingdom-)
(commit `9347cf7`). Each `FIGURE.png` is the picture saved in that notebook, and each `FIGURE.known.csv` holds the
values the figure shows, worked out by running the notebook's own code on the repository's data
(`build/make_examples.py` in the workbench's repository does this). Drawn again from those values, every figure
gives the same picture, pixel for pixel, except for the error bars of Figure 1b, whose bootstrap was not seeded, and
the text of Figure 4, which was laid out with a larger font than the notebook sets (its heat maps are the same).

So whatever you digitise from these figures can be checked against the right answer.

| File | What it is |
|---|---|
| `figure-1a.png` | Monthly births, 1955–2014 (blue, left axis), the inferred peak-conception month (orange, right axis, labelled with months) and an inset of 1972–1978 (green) |
| `figure-1b.png` | Bars with error bars: the percentage difference in average monthly births, 1975–2015 against 1955–1974 |
| `figure-1b-scanned.jpg` | Figure 1b as if printed and scanned: turned by 1.2°, blurred, saved as a JPEG |
| `figure-2.png` | A double-plotted “birthogram”: a row for each year, filled steps for its months, and dots |
| `figure-3a.png` | Two panels, one above the other, with a spectrum in each; only the lower one has x-axis labels |
| `figure-3b.png` | A polar plot: a dot for each year at the angle of its peak, further out each year |
| `figure-3c.png` | A forest plot: dots joined by a line, grey horizontal confidence intervals, red asterisks, dashed gridlines |
| `figure-3c-scanned.jpg` | Figure 3c as if printed and scanned: turned by 0.8° the other way |
| `practice-pages.pdf` | Two pages laid out as a scanned paper would be, with Figures 1b and 3c on them (the second page askew), to practise taking a figure out of a PDF (`build/make_pdf_example.py` makes it) |
| `figure-4.png` | Six heat maps sharing one colour bar |
| `figure-s3.png` | Supplementary Figure 3: two panels side by side, two lines with dots in each, dashed lines and a legend outside |
| `data/births.csv` | The monthly births in England and Wales, 1955–2014, and the peak-conception month (the repository's `data.csv`, with a header row) |
| `data/environmental.csv` | The monthly birth rate, light, photoperiod and temperature, 1953–2014 (the repository's `environmental.csv`) |

The birth data are the Office for National Statistics' figures for England and Wales and contain public sector
information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/);
the paper says where the environmental series come from.

## What each figure shows

<!--FIGURES-->
