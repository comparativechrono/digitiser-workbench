# Digitiser workbench

Read the values out of graphs in papers – lines, points with their error bars,
bars, actograms and other stacked rows, heat maps and polar plots – with
[trace-digitiser](https://github.com/comparativechrono/trace-digitiser), in a
web page where **nothing is uploaded**: Python ([Pyodide](https://pyodide.org))
and Tesseract (compiled to WebAssembly) run in the browser, so a figure of an
old paper can be digitised without sending it to a server or an AI model.

**Open it: <https://comparativechrono.github.io/digitiser-workbench/>**

It has the tabs of our other workbenches, with a help pane of walkthroughs on
the left:

- **Digitise** – the picture, with tools to mark plot areas, regions to leave
  out, ticks and their values, colours, a colour bar, a polar plot's centre and
  rings; what trace-digitiser finds in it, drawn over it; the result, with the
  command line and the Python that do the same. Pictures can be opened from
  your computer, pasted, or drawn from a page of a PDF.
- **Files**, **Notebook** (Python notebooks, with trace-digitiser),
  **Terminal** (`trace-digitiser` and `compare-known` as commands).
- **AI** – an assistant that uses your own key (Google Gemini has a free tier),
  and is never sent a picture.

The examples are the figures of our own paper, Hearn TJ, Whitmore D (2026),
*J Biol Rhythms* 41(1): 28–41,
[doi:10.1177/07487304251384348](https://doi.org/10.1177/07487304251384348), with
the values each figure shows, so that every digitisation can be checked:
`data/examples/hearn-whitmore-2026/README.md`.

## Running it

It is a static site: GitHub Pages serves it as it is (Settings → Pages →
Deploy from a branch → `main`, `/ (root)`). On your own computer:

    python3 serve.py      # then open http://localhost:8000/

(A page opened as a file, `file://…`, cannot start the web worker that runs
Python.)

## Building

| What | How |
|---|---|
| `index.html` | `python3 build/make_page.py`, from `build/template.html` and the help pages in `build/help/` |
| `assets/py/digitiser-tools.zip` | `python3 python/build_bundle.py`: trace-digitiser's wheel (`python/vendor`, put there by `python/tools/vendor_wheel.py`), `python/dwb` and `python/pytesseract` |
| `data/starter/*.ipynb` | `python3 build/make_starter.py`; `build/test_starter.py` runs every cell |
| `data/examples/hearn-whitmore-2026/` | `build/make_examples.py PAPER_REPOSITORY --check` (needs the packages the paper used) and `build/make_pdf_example.py` |

`THIRD_PARTY.md` lists what the site includes from elsewhere. The code is under
the MIT licence (`LICENSE`).
