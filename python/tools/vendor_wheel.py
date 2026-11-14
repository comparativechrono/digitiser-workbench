#!/usr/bin/env python3
"""Put a wheel of trace-digitiser into python/vendor, for python/build_bundle.py.

    python3 python/tools/vendor_wheel.py trace_digitiser-2.1.0-py3-none-any.whl [--from URL]

Any other wheel of trace-digitiser in python/vendor is removed. What was copied - the wheel's name, its version, its
SHA-256 and where it came from (a PyPI release, or the commit of the repository it was built from) - is recorded in
python/vendor/SOURCES.json, which build_bundle.py reads, and which the help's table of versions shows.

To build a wheel from a copy of the repository:   pip wheel --no-deps -w dist /path/to/trace-digitiser
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(os.path.dirname(HERE), "vendor")
SOURCES = os.path.join(VENDOR, "SOURCES.json")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("wheel")
    ap.add_argument("--from", dest="source", default="https://pypi.org/project/trace-digitiser/",
                    help="where the wheel comes from (a release, or a commit)")
    a = ap.parse_args(argv)
    name = os.path.basename(a.wheel)
    m = re.match(r"trace_digitiser-([^-]+)-py3-none-any\.whl$", name)
    if not m:
        raise SystemExit(f"{name}: not a wheel of trace-digitiser (trace_digitiser-VERSION-py3-none-any.whl)")
    with zipfile.ZipFile(a.wheel) as z:
        if not any(n.startswith("trace_digitiser/") for n in z.namelist()):
            raise SystemExit(f"{name}: has no trace_digitiser package")
    os.makedirs(VENDOR, exist_ok=True)
    for old in os.listdir(VENDOR):
        if old.startswith("trace_digitiser-") and old.endswith(".whl") and old != name:
            os.remove(os.path.join(VENDOR, old))
    target = os.path.join(VENDOR, name)
    if os.path.abspath(a.wheel) != os.path.abspath(target):
        shutil.copyfile(a.wheel, target)
    sources = json.load(open(SOURCES, encoding="utf-8")) if os.path.exists(SOURCES) else {}
    sources["trace-digitiser"] = {
        "package": "trace_digitiser",
        "version": m.group(1),
        "wheel": name,
        "sha256": hashlib.sha256(open(target, "rb").read()).hexdigest(),
        "from": a.source,
    }
    with open(SOURCES, "w", encoding="utf-8") as fh:
        json.dump(sources, fh, indent=2)
        fh.write("\n")
    print(f"python/vendor/{name} (trace-digitiser {m.group(1)}, from {a.source})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
