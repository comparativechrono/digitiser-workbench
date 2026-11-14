#!/usr/bin/env python3
"""Pack the Python of the web page into one archive: assets/py/digitiser-tools.zip.

The workbench's Python (Pyodide, in the browser) unpacks it when it starts and puts it on sys.path, so that what is
in it imports as it would after ``pip install``. It holds

- trace-digitiser, from its wheel in python/vendor (the package, without its tests, and its .dist-info, so that
  ``importlib.metadata.version("trace-digitiser")`` gives its version), which python/tools/vendor_wheel.py copies
  there and records in python/vendor/SOURCES.json;
- dwb, the workbench's own glue (the terminal's programs, the Digitise tab's functions, the examples' known values);
- pytesseract, a stand-in for the package of that name that reads text with Tesseract compiled to WebAssembly in the
  page, rather than by running the tesseract program (which a browser cannot do);
- this folder's README.md and LICENSE.

trace-digitiser needs NumPy, OpenCV, pandas, Pillow and Matplotlib: the page loads Pyodide's own builds of those.

assets/py/digitiser-tools.json records what is in the archive and a checksum, which the page adds to the archive's
address so that a browser never keeps an old copy.

Run after changing anything under python/:   python3 python/build_bundle.py
"""
import hashlib
import io
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "py")
ARCHIVE = "digitiser-tools.zip"
OWN = ["dwb", "pytesseract"]
SOURCES = os.path.join(HERE, "vendor", "SOURCES.json")


def version_of(pkg):
    init = os.path.join(HERE, pkg, "__init__.py")
    m = re.search(r'^__version__\s*=\s*["\']([^"\']+)', open(init, encoding="utf-8").read(), re.M)
    return m.group(1) if m else ""


def files_of(pkg):
    base = os.path.join(HERE, pkg)
    for dp, dn, fn in os.walk(base):
        dn[:] = sorted(d for d in dn if d != "__pycache__" and not d.startswith("."))
        for f in sorted(fn):
            if f.endswith((".pyc", ".pyo")) or f.startswith("."):
                continue
            full = os.path.join(dp, f)
            yield full, os.path.relpath(full, HERE).replace(os.sep, "/")


def wheel_entries(record):
    """the package in a wheel of python/vendor, without its tests, with its .dist-info (less RECORD, which would
    list files that are not here): (data, name in the archive)"""
    package = record["package"]
    with zipfile.ZipFile(os.path.join(HERE, "vendor", record["wheel"])) as z:
        for name in sorted(z.namelist()):
            if name.endswith("/"):
                continue
            top = name.split("/")[0]
            if top == package:
                parts = name.split("/")
                if "tests" in parts[1:-1] or parts[-1] == "conftest.py" or name.endswith((".pyc", ".pyo")):
                    continue
                yield z.read(name), name
            elif top.endswith(".dist-info") and not name.endswith("/RECORD"):
                yield z.read(name), name


def write_archive(name, entries):
    """entries: (data, name in the archive) → its record; the same entries always give the same archive"""
    buf = io.BytesIO()
    count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for data, rel in entries:
            # (a fixed date, so that the checksum changes only when what is in the archive does)
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
            count += 1
    data = buf.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    with open(os.path.join(OUT, name), "wb") as fh:
        fh.write(data)
    print("assets/py/{}: {} files, {:.0f} KB, sha256 {}".format(name, count, len(data) / 1024, digest[:12]))
    return {"archive": name, "sha256": digest, "bytes": len(data)}


def main():
    os.makedirs(OUT, exist_ok=True)
    sources = json.load(open(SOURCES, encoding="utf-8"))
    record = sources["trace-digitiser"]
    entries = list(wheel_entries(record))
    for pkg in OWN:
        for full, rel in files_of(pkg):
            with open(full, "rb") as fh:
                entries.append((fh.read(), rel))
    for name in ("README.md", "LICENSE"):
        with open(os.path.join(HERE, name), "rb") as fh:
            entries.append((fh.read(), name))
    manifest = write_archive(ARCHIVE, entries)
    manifest["packages"] = {"trace-digitiser": record["version"], "dwb": version_of("dwb")}
    manifest["trace_digitiser"] = {k: record[k] for k in ("version", "wheel", "sha256", "from") if k in record}
    with open(os.path.join(OUT, "digitiser-tools.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
