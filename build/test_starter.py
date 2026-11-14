#!/usr/bin/env python3
"""Run every code cell of the starter notebooks (data/starter/*.ipynb) here, with the workbench's paths changed to
this repository's: /data/examples → data/examples, ~ → a temporary folder. Needs trace-digitiser (and Tesseract) on
this computer, and python/ on the path for dwb.

Run:  python3 build/test_starter.py
"""
import glob
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def main():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    home = tempfile.mkdtemp(prefix="starter-home-")
    os.environ["HOME"] = home
    os.environ["DWB_EXAMPLES"] = os.path.join(ROOT, "data/examples/hearn-whitmore-2026")
    # dwb from python/ (but not the browser's pytesseract that sits beside it)
    shadow = tempfile.mkdtemp(prefix="starter-py-")
    os.symlink(os.path.join(ROOT, "python", "dwb"), os.path.join(shadow, "dwb"))
    sys.path.insert(0, shadow)
    failed = 0
    for nb in sorted(glob.glob(os.path.join(ROOT, "data/starter/*.ipynb"))):
        cells = json.load(open(nb, encoding="utf-8"))["cells"]
        ns = {"__name__": "__main__"}
        t = time.time()
        for i, c in enumerate(cells):
            if c["cell_type"] != "code":
                continue
            src = "".join(c["source"]).replace("/data/examples", os.path.join(ROOT, "data/examples"))
            try:
                exec(compile(src, f"{os.path.basename(nb)}[{i}]", "exec"), ns)
                plt.close("all")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"FAILED {os.path.basename(nb)} cell {i}: {type(e).__name__}: {e}")
                break
        print(f"{os.path.basename(nb)}: ran in {time.time() - t:.0f} s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
