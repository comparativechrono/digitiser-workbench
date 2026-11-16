# The Digitiser workbench's Python

What the workbench's Python (Pyodide, which runs in your web browser) unpacks when it starts, from
`assets/py/digitiser-tools.zip`:

- **trace-digitiser**, which reads the values out of a picture of a graph: lines, points, bars, stacked rows,
  heat maps and polar plots. Install it on your own computer with `pip install trace-digitiser`; its source is at
  <https://github.com/comparativechrono/trace-digitiser>.
- **dwb**, the workbench's own glue: `dwb.cli` runs the terminal's programs (`trace-digitiser`, `compare-known`),
  `dwb.gui` has what the Digitise tab calls, `dwb.lines` reads a line's narrow peaks at their tips (the tab's
  *Peaks* option), and `dwb.known` compares what was digitised from one of the examples (the figures of Hearn and
  Whitmore 2026) with the values those figures show.
- **pytesseract**, a stand-in for the package of that name: it reads text with Tesseract compiled to WebAssembly,
  in the page, rather than by running the `tesseract` program, which a web page cannot do. On your own computer use
  the real pytesseract and Tesseract.

Nothing here sends a picture, or anything else, anywhere: it all runs in the browser.

`python3 python/build_bundle.py` builds the archive; `python3 python/tools/vendor_wheel.py WHEEL` replaces the copy
of trace-digitiser it is built from.
