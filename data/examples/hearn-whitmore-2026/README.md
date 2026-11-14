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

### figure-1a.png and figure-1a.known.csv

Figure 1a of Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348.

- births: the blue line, against the left-hand axis (number of births per month).
- peak_conception_month: the orange line, against the right-hand axis, whose labels are months: 6 = June, 7 = July, 8 = August, 9 = September, 10 = October, 11 = November, 12 = December, 13 = January (a value of 10.5 lies half way between October and November).
- in_inset: the months the green inset shows (1972 to 1978), against the inset's own axes.
- decimal_year: where each month stands on the x axis, whose ticks are at the 1st of January of 1955, 1960 ... 2015.

### figure-1b.png and figure-1b.known.csv

Figure 1b of Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348.

- percent_difference: the height of each bar (the difference in the average number of births in that month, 1975-2015 against 1955-1974, in per cent).
- The error bars are one bootstrap standard error, the same for every bar. The notebook drew it from 1000 unseeded bootstrap samples, so its exact value is not known; in this picture each error bar reaches about 1.35 above and below its bar.

### figure-2.png and figure-2.known.csv

Figure 2 of Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348.

- One row of the double-plotted birthogram for each year from 1955 (the top row) to 2013, with 24 columns: January to December of that year, then of the next.
- normalised_births: the height of the filled step in that column, from 0 to 1, where 1 is the height of a full row less a tenth (each row takes 1.1 units, its fill at most 1): births in that month scaled so that the year's fewest are 0 and its most are 1, each year separately.
- peak_dot: whether the black dot (the inferred peak-conception month) is drawn in that column.

### figure-3a.png and figure-3a.known.csv

Figure 3a of Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348.

- The two FFT spectra: the upper panel 1955-1974, the lower 1976-2014. Each is a line drawn through these points, from a period of 20 months to 2 (the x axis runs from 1 to 20 months).

### figure-3b.png and figure-3b.known.csv

Figure 3b of Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348.

- One blue dot for each year: its angle is the phase of the cosine fitted to that year's detrended births (phase_radians, as fitted, between -pi and pi; angle_degrees, the same angle as the plot shows it, from 0 at the right, anticlockwise, 0 to 360); its distance from the centre is radius, which counts the years: 1 for 1955 to 60 for 2014. The rings are at radius 1 (labelled 1955), 11 (1965) ... 51 (2005).
- fit_converged: false for a year whose cosine fit runs out of evaluations when the notebook is run again (1992, with any SciPy from 1.11 to 1.18); its phase is the one that, drawn by the notebook's code, gives the figure as published (to within 0.001 radians).

### figure-3c.png and figure-3c.known.csv

Figure 3c of Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348.

- One blue dot for each 10-year window: x is the circular standard deviation of the peak phase (radians), y the window's midpoint year (the axis runs downwards). The grey bars are the 95% bootstrap confidence intervals (ci_low to ci_high), and a red asterisk marks the windows that differ from 1955-1974.

### figure-4.png and figure-4.known.csv

Figure 4 of Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348.

- The six heat maps, one block of 21 rows each (lags of -20 to 0 months), with a column for each 60-month window, named by the month the window ends (1957-12 to 2014-12): the Pearson correlation of the driver with the birth rate, coloured on the colour bar from -1 (dark purple) to 1 (yellow).
- Each heat map stretches its 21 rows over the y axis from -20 to 0, so each row is 20/21 of a month high, and the row for a lag of L is centred at -20 + (L + 20.5) * 20/21; likewise its 685 columns over the x axis, from the first window's end to the last's.

### figure-s3.png and figure-s3.known.csv

Supplementary Figure 3 of Hearn TJ, Whitmore D (2026) An abrupt mid-1970s shift in UK birth seasonality and its implications for chronobiological studies. J Biol Rhythms 41(1):28-41. doi:10.1177/07487304251384348.

- Two panels (1953-1974 and 1976-2014), each with two lines with dots: light (yellow) and temp (blue-green), the correlation of the deseasonalised series with the deseasonalised birth rate at each lag. The dashed blue lines are at plus and minus dashed_line.

