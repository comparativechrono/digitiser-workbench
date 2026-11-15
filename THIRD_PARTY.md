# Third-party software, data and provenance

The Digitiser workbench's own code, help and examples are under the MIT licence
([LICENSE](LICENSE)). What it includes from elsewhere, and what it loads at run
time, keeps its own licence. Keep each component's notices and licence files
when copying or redistributing its files.

## Included in the site

| Component | Version | Licence | Where | Origin |
|---|---|---|---|---|
| trace-digitiser (Timothy J Hearn) | 2.2.0 | MIT | its wheel in `python/vendor`, packed into `assets/py/digitiser-tools.zip` with its `.dist-info` | the wheel released on [PyPI](https://pypi.org/project/trace-digitiser/2.2.0/), unchanged, from [comparativechrono/trace-digitiser](https://github.com/comparativechrono/trace-digitiser); `python/vendor/SOURCES.json` records where it came from and its SHA-256 |
| dwb, and the stand-in for pytesseract | 1.0.0 | MIT | `python/dwb`, `python/pytesseract`, the same archive | written for the workbench |
| Tesseract, compiled to WebAssembly by tesseract.js-core | Tesseract 5.1.0 (tesseract.js-core 6.1.2) | Apache License 2.0 | `assets/vendor/tesseract/` (with its `LICENSE` and `README.txt`) | the npm package [tesseract.js-core](https://www.npmjs.com/package/tesseract.js-core), unchanged: its LSTM builds, with and without SIMD |
| Tesseract's English model (tessdata_fast) | 4.1.0 | Apache License 2.0 | `assets/vendor/tesseract/eng.traineddata` | [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast), as Ubuntu's package tesseract-ocr-eng 1:4.1.0-2 installs it (its SHA-256 is in the folder's `README.txt`) |
| PDF.js, and the fonts, CMaps, decoders and colour profile it comes with | 6.3.289 | Apache License 2.0; the others as listed in its `README.txt` | `assets/vendor/pdfjs/` | the npm package pdfjs-dist, as copied unchanged into our R workbench (its `README.txt` lists what was left out) |
| CodeMirror | 5.65.18 | MIT | `assets/vendor/codemirror/` (with its `LICENSE`) | [codemirror/codemirror5](https://github.com/codemirror/codemirror5) |
| marked | 18.0.13 | MIT | `assets/vendor/marked/` (with its `LICENSE`) | [markedjs/marked](https://github.com/markedjs/marked) |
| DOMPurify | 3.4.16 | Apache License 2.0 or Mozilla Public License 2.0 | `assets/vendor/dompurify/` (with its `LICENSE`) | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) |
| JSZip | 3.10.1 | MIT or GNU GPL 3 (used under MIT) | `assets/vendor/jszip/` (with its `LICENSE.markdown`) | [Stuk/jszip](https://github.com/Stuk/jszip) |
| The figures of Hearn and Whitmore (2026), and the values they show | – | the authors' own; the birth data contain public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) | `data/examples/hearn-whitmore-2026/` (its `README.md` says what each file is) | made by `build/make_examples.py` from the paper's repository, [comparativechrono/Rephasing-of-Seasonal-Birth-Rates-in-the-United-Kingdom-](https://github.com/comparativechrono/Rephasing-of-Seasonal-Birth-Rates-in-the-United-Kingdom-) (commit `9347cf7`) |

## Loaded at run time

| Component | Licence | From |
|---|---|---|
| Pyodide 0.29.5 (CPython compiled to WebAssembly), with its builds of NumPy, OpenCV, pandas, Pillow, Matplotlib, micropip, and any package a notebook imports | Mozilla Public License 2.0; each package its own | cdn.jsdelivr.net (`pyodideBase` in `assets/js/config.js` can point to a copy of your own) |

Apart from Pyodide, the page loads no code, fonts or style sheets from other
sites, and sends nothing of the user's anywhere – except, when the user sets up
the AI assistant with a key of their own, what they ask it and choose to send
with it, to the service they chose.

The workbench's framework – the page, help, shell, notebook and editor in
`assets/js` and `assets/css` – comes from the Hearn lab's workbenches (the
Pedigree workbench), and its AI assistant (`assets/js/assistant.js`,
`assets/css/ai.css`) from the R workbench.
