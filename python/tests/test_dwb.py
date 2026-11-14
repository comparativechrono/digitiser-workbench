"""The workbench's Python glue (dwb), natively: what the Digitise tab asks of it, the command lines and Python it
writes, and the comparisons with the examples' known values.

Run from the repository's root:  python3 -m pytest python/tests   (needs trace-digitiser and Tesseract)
"""
import json
import os
import shlex
import sys
import warnings

import pandas as pd
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EX = os.path.join(ROOT, "data", "examples", "hearn-whitmore-2026")
os.environ["DWB_EXAMPLES"] = EX


@pytest.fixture(scope="module")
def dwb(tmp_path_factory):
    # dwb from python/, but not the browser's pytesseract that sits beside it
    shadow = tmp_path_factory.mktemp("py")
    os.symlink(os.path.join(ROOT, "python", "dwb"), shadow / "dwb")
    sys.path.insert(0, str(shadow))
    warnings.simplefilter("ignore")
    from dwb import cli, gui, known

    return gui, known, cli


def have_tesseract():
    from trace_digitiser.axis_labels import tesseract_available

    return tesseract_available()


RECIPES = {
    "1b": ("bars", "figure-1b", {}, {"bars": 0.1}),
    "3c": ("points", "figure-3c", {}, {"points": 0.002}),
    "s3": ("points", "figure-s3", {}, {"points": 0.002}),
    "1a-orange": ("lines", "figure-1a", {"trace_colours": ["#ff8c00"], "exclude": [[990, 15, 1296, 58]],
                                        "ticks": [{"axis": "y", "px": 485.5, "value": 6, "at": [1310, 485]},
                                                  {"axis": "y", "px": 34.5, "value": 13, "at": [1310, 35]}]},
                  {"peak-conception month (orange line)": 0.1}),
    "3b": ("polar", "figure-3b", {"colours": ["#1f77b4"], "r_ref": [[5, 1955], [250, 2005]]}, {"angle": 0.5}),
}


@pytest.mark.skipif(not have_tesseract(), reason="needs Tesseract")
@pytest.mark.parametrize("name", list(RECIPES))
def test_recipes_and_their_command_lines(dwb, name, tmp_path):
    gui, known, _ = dwb
    kind, figure, options, limits = RECIPES[name]
    r = gui.digitise(kind, os.path.join(EX, figure + ".png"), options, output_dir=str(tmp_path / "gui"))
    json.dumps(r)  # (all plain values, for the page)
    assert r["table"]["n"] > 0 and r["shapes"]["kind"] == kind
    csv = [f for f in r["files"] if f.endswith(f"_{gui.TABLES[kind]}.csv")][0]
    stats = gui.compare(figure, csv, kind)["stats"]
    for label, most in limits.items():
        assert stats[label]["median_abs"] < most, (label, stats[label])
    # the command line does the same
    assert r["command"]["ok"]
    from trace_digitiser.cli import main

    words = shlex.split(r["command"]["text"].replace(" -o " + gui._home(str(tmp_path / "gui")), ""))
    main(words[1:] + ["-o", str(tmp_path / "cli")])
    a = pd.read_csv(csv)
    b = pd.read_csv(tmp_path / "cli" / os.path.basename(csv))
    pd.testing.assert_frame_equal(a, b)


def test_known_values_compare_perfectly_with_themselves(dwb):
    _, known, _ = dwb
    k = known.known_values("figure-3c")
    data = pd.DataFrame({"series": 1, "y_value": k.window_midpoint_year, "x_value": k.circular_sd,
                         "x_error_low": k.ci_low, "x_error_high": k.ci_high})
    c = known.compare("figure-3c", data, "points")
    assert c["stats"]["points"]["max_abs"] == 0 and c["stats"]["points"]["n"] == len(k)


def test_which_example(dwb):
    _, known, _ = dwb
    assert known.which_example("figure-3c-scanned-straightened_points.csv") == "figure-3c"
    assert known.which_example("figure-1a_automated_digitised_trace_by_column.csv") == "figure-1a"
    assert known.which_example("practice-pages-page2.png") is None


def test_command_line_and_python_text(dwb):
    gui, _, _ = dwb
    opts = gui._clean("rows", {"row_values": list(range(1955, 2014)), "bins": 24, "dots": "black",
                               "plot_area": [[1, 2, 3, 4]], "y_ref": {"1": [[1, 2], [3, 4]], "2": [[1, 2], [3, 4]]}})
    c = gui.command_line("rows", "/data/x.png", opts, "/home/user/results/x")
    assert "--row-values 1955:2013" in c["text"] and "--plot-area 1,2,3,4" in c["text"]
    assert not c["ok"] and "Python" in c["why"]
    code = gui.python_code("rows", "/data/x.png", opts)
    assert "row_values=list(range(1955, 2014))" in code and "y_ref={1: [(1, 2), (3, 4)]" in code
    compile(code, "<code>", "exec")
    # colours are quoted for the shell
    assert "'#ff8c00'" in gui.command_line("lines", "/a.png", {"trace_colours": ["#ff8c00"]})["text"]


def test_programs(dwb, capsys):
    _, _, cli = dwb
    assert cli.run(["compare-known", "--help"]) == 0
    assert "compare-known" in capsys.readouterr().out
    assert cli.run(["no-such-program"]) == 127
