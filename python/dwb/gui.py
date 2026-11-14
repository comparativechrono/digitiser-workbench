"""What the workbench's Digitise tab asks Python.

The tab shows the picture and lets you mark things on it: the plot areas, regions to leave out, ticks and the values
they stand for, the colours to follow. It sends those here, and the functions below pass them to trace-digitiser,
exactly as a program of your own would, and send back what was found as plain values that the page can draw over the
picture: where each line, point, bar, row or cell is, in pixels, and how each panel's axes turn pixels into values.

With every result come the command line and the Python that do the same thing (:func:`command_line`,
:func:`python_code`), so that what was done with the mouse can be done again in the Terminal or a notebook, or on
your own computer.

Every function takes and returns plain JSON-like values, because the page calls them through the web worker that
runs Python.
"""
from __future__ import annotations

import base64
import io
import math
import os
import shlex
import time
import warnings
from typing import Any, Dict, List, Optional, Sequence

KINDS = ("lines", "points", "bars", "rows", "heatmap", "polar")
READERS = {
    "lines": "digitise",
    "points": "digitise_points",
    "bars": "digitise_bars",
    "rows": "digitise_rows",
    "heatmap": "digitise_heatmap",
    "polar": "digitise_polar",
}
# what each reader writes: the table, and its name
TABLES = {"lines": "trace_by_column", "points": "points", "bars": "bars", "rows": "rows", "heatmap": "heatmap",
          "polar": "polar"}

# the options of the figure and its axes, which every reader but polar takes
FIGURE_OPTIONS = ("plot_area", "exclude", "y_min", "y_max", "x_min", "x_max", "y_ref", "x_ref", "y_scale", "x_scale",
                  "y_axis", "ocr", "straighten", "layout_mode", "expected_panels", "expected_rows", "expected_cols")
OPTIONS = {
    "lines": FIGURE_OPTIONS + ("trace_colours", "achromatic"),
    "points": FIGURE_OPTIONS + ("colours", "colour_tolerance", "marker_size", "error_bars"),
    "bars": FIGURE_OPTIONS + ("colours", "colour_tolerance", "baseline", "orientation", "error_bars"),
    "rows": FIGURE_OPTIONS + ("row_values", "row_positions", "rows", "row_range", "row_spacing_value", "direction",
                              "bins", "colour", "colour_tolerance", "dots"),
    "heatmap": FIGURE_OPTIONS + ("colourbar", "colourbar_values", "colormap", "vmin", "vmax", "rows", "cols",
                                 "max_colour_error"),
    "polar": ("centre", "r_ref", "outer_value", "inner_value", "zero", "clockwise", "colours", "colour_tolerance",
              "marker_size", "straighten"),
}
# the readers' defaults: an option at its default is left out of the command line and the code
DEFAULTS = {
    "y_scale": "auto", "x_scale": "auto", "y_axis": "left", "ocr": True, "straighten": "auto", "layout_mode": "auto",
    "achromatic": "auto", "error_bars": {"points": "auto", "bars": True}, "orientation": "vertical",
    "colour_tolerance": {"points": 60.0, "bars": 40.0, "rows": 60.0, "polar": 60.0}, "direction": "auto",
    "inner_value": 0.0, "zero": "east", "clockwise": False, "max_colour_error": 12.0,
}
# how many rows of a table come back to the page (the whole table is in the CSV file)
TABLE_ROWS = 400


# --------------------------------------------------------------------- versions


def versions() -> Dict[str, str]:
    """The versions of the packages in the workbench (without importing them: that takes a few seconds)."""
    from importlib import metadata

    out: Dict[str, str] = {}
    for name in ("trace-digitiser", "numpy", "opencv-python", "pandas", "pillow", "matplotlib", "scipy"):
        try:
            out[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            out[name] = ""
    try:
        from . import __version__

        out["dwb"] = __version__
    except ImportError:
        out["dwb"] = ""
    return out


def warm() -> Dict[str, Any]:
    """Import trace-digitiser (and NumPy, OpenCV, pandas and Matplotlib with it), so that the first figure is quick."""
    t = time.time()
    import trace_digitiser  # noqa: F401
    from trace_digitiser.axis_labels import tesseract_available

    return {"seconds": round(time.time() - t, 2), "ocr": bool(tesseract_available())}


def ocr_version() -> str:
    try:
        import pytesseract

        return str(pytesseract.get_tesseract_version())
    except Exception:  # noqa: BLE001
        return ""


# --------------------------------------------------------------------- pictures


BROWSER_FORMATS = {"PNG", "JPEG", "GIF", "WEBP", "BMP"}


def picture(path: str) -> Dict[str, Any]:
    """What a picture is: its size and format, and - if a web browser cannot show it as it is (a TIFF, say) - the
    picture as trace-digitiser reads it, as a PNG (``png``, base64)."""
    from PIL import Image

    path = os.path.expanduser(path)
    with Image.open(path) as im:
        info: Dict[str, Any] = {
            "path": path,
            "width": int(im.width),
            "height": int(im.height),
            "format": im.format or "",
            "mode": im.mode,
            "frames": int(getattr(im, "n_frames", 1) or 1),
        }
        try:
            orientation = int(im.getexif().get(0x0112, 1) or 1)
        except Exception:  # noqa: BLE001
            orientation = 1
    if orientation in (5, 6, 7, 8):  # turned by a quarter: the browser and trace-digitiser both turn it
        info["width"], info["height"] = info["height"], info["width"]
    info["png"] = None
    if info["format"] not in BROWSER_FORMATS or info["mode"] in ("I;16", "I;16B", "I", "F", "CMYK"):
        from trace_digitiser.io import load_image

        rgb = load_image(path)
        buf = io.BytesIO()
        Image.fromarray(rgb).save(buf, format="PNG")
        info["png"] = base64.b64encode(buf.getvalue()).decode("ascii")
        info["width"], info["height"] = int(rgb.shape[1]), int(rgb.shape[0])
    return info


def _out_path(path: str, tag: str, out: Optional[str]) -> str:
    if out:
        return os.path.expanduser(out)
    base, _ = os.path.splitext(os.path.basename(path))
    folder = os.path.dirname(path)
    # an example (read-only) or a picture in the browser's own places: the copy goes into ~/pictures
    if not folder or folder.startswith("/data/") or not os.access(folder, os.W_OK):
        folder = os.path.expanduser("~/pictures")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{base}-{tag}.png")


def straighten(path: str, degrees: Optional[float] = None, out: Optional[str] = None) -> Dict[str, Any]:
    """Turn a tilted picture upright (by *degrees*, anticlockwise tilt; measured if not given) and save the result as
    a new PNG beside it (or in ~/pictures)."""
    from PIL import Image
    from trace_digitiser.io import load_image
    from trace_digitiser.straighten import estimate_tilt
    from trace_digitiser.straighten import straighten as turn

    path = os.path.expanduser(path)
    rgb = load_image(path)
    if degrees is None:
        degrees = float(estimate_tilt(rgb))
    target = _out_path(path, "straightened", out)
    Image.fromarray(turn(rgb, float(degrees)) if degrees else rgb).save(target)
    return {"path": target, "degrees": round(float(degrees), 3)}


def crop(path: str, box: Sequence[float], out: Optional[str] = None) -> Dict[str, Any]:
    """Save the part of a picture inside *box* (left, top, right, bottom, in pixels) as a new PNG."""
    from PIL import Image
    from trace_digitiser.io import load_image

    path = os.path.expanduser(path)
    rgb = load_image(path)
    h, w = rgb.shape[:2]
    l, t, r, b = (int(round(float(v))) for v in box)
    l, r = max(0, min(l, r)), min(w, max(l, r))
    t, b = max(0, min(t, b)), min(h, max(t, b))
    if r - l < 4 or b - t < 4:
        raise ValueError("the part to keep is too small")
    target = _out_path(path, "cropped", out)
    Image.fromarray(rgb[t:b, l:r]).save(target)
    return {"path": target, "box": [l, t, r, b]}


# --------------------------------------------------------------------- what is in a figure


def describe(path: str, plot_area=None, ocr: bool = True) -> Dict[str, Any]:
    """What trace-digitiser finds in a figure, as it is (not straightened): its plot areas, the tick labels of each
    axis and the scale they give, the colours drawn, a colour bar, polar axes - and how far it is tilted, and what
    kind of figure it might be."""
    from trace_digitiser import describe_figure
    from trace_digitiser.io import load_image
    from trace_digitiser.straighten import estimate_tilt

    path = os.path.expanduser(path)
    t = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        info = describe_figure(path, straighten=False, plot_area=plot_area or None, ocr=ocr)
        try:
            info["tilt_degrees"] = round(float(estimate_tilt(load_image(path))), 3)
        except Exception:  # noqa: BLE001
            info["tilt_degrees"] = 0.0
    info["seconds"] = round(time.time() - t, 2)
    info["suggest"] = "polar" if info.get("polar") else "heatmap" if info.get("colourbar") else None
    return info


def values_at(points: Sequence[Sequence[float]], x_ref=None, y_ref=None, x_scale: str = "linear",
              y_scale: str = "linear") -> List[List[Optional[float]]]:
    """Points in pixels -> values, from two or more (pixel, value) references on each axis (pixels_to_values)."""
    from trace_digitiser import pixels_to_values

    return [list(v) for v in pixels_to_values(points, x_ref=x_ref, y_ref=y_ref, x_scale=x_scale, y_scale=y_scale)]


# --------------------------------------------------------------------- digitising


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _clean(kind: str, options: Dict[str, Any]) -> Dict[str, Any]:
    """The options the page sent, as the reader takes them: only those it has, without empty ones."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    out: Dict[str, Any] = {}
    for k in OPTIONS[kind]:
        v = options.get(k)
        if v is None or v == "" or v == [] or v == {}:
            continue
        if k in ("y_ref", "x_ref") and isinstance(v, dict):
            v = {int(p): [tuple(float(a) for a in q) for q in pts] for p, pts in v.items() if pts}
            if not v:
                continue
        elif k in ("y_ref", "x_ref", "r_ref"):
            v = [tuple(float(a) for a in q) for q in v]
        elif k in ("plot_area", "exclude"):
            boxes = v if v and isinstance(v[0], (list, tuple)) else [v]
            v = [tuple(float(a) for a in b) for b in boxes]
        elif k in ("colourbar",):
            v = tuple(float(a) for a in v)
        elif k in ("centre", "row_range", "colourbar_values"):
            v = tuple(float(a) for a in v)
        elif k in ("trace_colours", "colours"):
            v = [str(c) for c in v]
        elif k in ("row_values", "row_positions"):
            v = [float(a) for a in v]
        elif k == "straighten" and isinstance(v, str) and v not in ("auto", "never"):
            v = float(v)
        out[k] = v
    if kind == "polar" and out.get("straighten") in ("auto", "never"):
        out["straighten"] = False
    if kind == "polar" and out.get("straighten") is False:
        del out["straighten"]  # (the polar reader's default)
    return out


def _cal(c) -> Optional[Dict[str, Any]]:
    """A calibration (a Calibration, or a dict) -> {a, b, log, calibrated, method, confidence, ticks}"""
    if c is None:
        return None
    d = c.to_dict() if hasattr(c, "to_dict") else dict(c)
    st = str(d.get("scale_type", ""))
    return {
        "a": float(d["a"]),
        "b": float(d["b"]),
        "log": "log" in st,
        "calibrated": st != "normalised_0_to_1",
        "method": d.get("method", ""),
        "confidence": d.get("confidence", ""),
        "ticks": [[float(p), float(v)] for p, v in (d.get("inliers") or [])],
    }


def _panel(p) -> Dict[str, Any]:
    if isinstance(p, dict):
        e, pid, y, x = p["edges"], p["panel_id"], p.get("y_calibration"), p.get("x_calibration")
    else:
        e, pid, y, x = p.edges, p.panel_id, p.calibration, p.x_calibration
    return {
        "panel_id": int(pid),
        "plot_area": [round(float(e[k]), 2) for k in ("left", "top", "right", "bottom")],
        "y": _cal(y),
        "x": _cal(x),
    }


def _f(v, nd=2) -> Optional[float]:
    f = _num(v)
    return None if f is None else round(f, nd)


def _hex(c) -> str:
    """'#rrggbb' from '#rrggbb', '[r, g, b]', (r, g, b) or a name"""
    if isinstance(c, str) and c.startswith("#"):
        return c.lower()
    try:
        if isinstance(c, str):
            import re

            nums = [int(v) for v in re.findall(r"\d+", c)[:3]]
        else:
            nums = [int(v) for v in list(c)[:3]]
        if len(nums) == 3:
            return "#{:02x}{:02x}{:02x}".format(*nums)
    except (TypeError, ValueError):
        pass
    return "#ff00ff"


def _shapes(kind: str, result, data) -> Dict[str, Any]:
    """Where what was found is, in pixels, for the page to draw over the picture."""
    import numpy as np

    out: Dict[str, Any] = {"kind": kind}
    if kind == "lines":
        traces = []
        panels = {p.panel_id: p for p in result.panels}
        for (pid, tid), g in data.groupby(["panel_id", "trace_id"], sort=True):
            p = panels.get(pid)
            if p is None or p.calibration is None:
                continue
            ys = p.calibration.value_to_y(g["center_estimate"].to_numpy(float))
            xs = g["x_pixel"].to_numpy(float)
            interp = g["interpolated"].to_numpy(bool) if "interpolated" in g else np.zeros(len(g), bool)
            step = max(1, len(xs) // 3000)
            pts = [[round(float(x), 1), round(float(y), 2), int(i)]
                   for x, y, i in zip(xs[::step], ys[::step], interp[::step]) if np.isfinite(y)]
            traces.append({"panel_id": int(pid), "trace_id": int(tid), "colour": _hex(g["trace_median_rgb"].iloc[0]),
                           "points": pts, "interpolated": round(float(interp.mean()), 3)})
        out["traces"] = traces
    elif kind in ("points", "polar"):
        pts = []
        for i, r in enumerate(data.itertuples(index=False)):
            d = r._asdict()
            # (a polar plot's radius_px is the distance from the centre, not the marker's size)
            item = {"i": i, "x": _f(d.get("x_pixel")), "y": _f(d.get("y_pixel")),
                    "r": None if kind == "polar" else _f(d.get("radius_px"), 1),
                    "colour": d.get("colour") or "#ff00ff", "series": int(d.get("series") or 1),
                    "panel_id": int(d.get("panel_id") or 1)}
            for axis in ("x", "y"):
                lo, hi = d.get(f"{axis}_error_low_pixel"), d.get(f"{axis}_error_high_pixel")
                if _num(lo) is not None and _num(hi) is not None:
                    item[f"{axis}_err"] = [_f(lo), _f(hi)]
            pts.append(item)
        out["points"] = pts
        if kind == "polar":
            out["polar"] = result.provenance.get("polar")
    elif kind == "bars":
        bars = []
        horizontal = result.provenance.get("parameters", {}).get("orientation") == "horizontal"
        for i, r in enumerate(data.itertuples(index=False)):
            d = r._asdict()
            if horizontal:
                item = {"i": i, "top": _f(d.get("top_pixel")), "bottom": _f(d.get("bottom_pixel")),
                        "start": _f(d.get("baseline_pixel")), "end": _f(d.get("end_pixel"))}
                lo, hi = d.get("error_left_pixel"), d.get("error_right_pixel")
            else:
                item = {"i": i, "left": _f(d.get("left_pixel")), "right": _f(d.get("right_pixel")),
                        "start": _f(d.get("baseline_pixel")), "end": _f(d.get("end_pixel"))}
                lo, hi = d.get("error_top_pixel"), d.get("error_bottom_pixel")
            item["colour"] = d.get("colour") or "#ff00ff"
            if _num(lo) is not None and _num(hi) is not None:
                item["err"] = [_f(lo), _f(hi)]
            bars.append(item)
        out["bars"] = bars
        out["horizontal"] = horizontal
    elif kind == "rows":
        found = result.provenance.get("parameters", {}).get("found", {})
        rows = []
        for (pid, row), g in data.groupby(["panel_id", "row"], sort=True):
            info = found.get(pid) or found.get(str(pid)) or {}
            step = 1 if info.get("direction") == "down" else -1
            b = float(g["baseline_pixel"].iloc[0])
            pts = [[round(float(x), 1), None if not np.isfinite(h) else round(b + step * float(h), 2)]
                   for x, h in zip(g["x_pixel"], g["height_px"])]
            item = {"panel_id": int(pid), "row": int(row), "baseline": round(b, 2), "points": pts,
                    "binned": "bin" in g}
            if "row_value" in g:
                item["value"] = _num(g["row_value"].iloc[0])
            if "dot" in g:
                item["dots"] = [round(float(x), 1) for x, d in zip(g["x_pixel"], g["dot"]) if bool(d)]
            rows.append(item)
        out["rows"] = rows
        out["found"] = {str(k): v for k, v in found.items()}
    elif kind == "heatmap":
        cells = []
        n = len(data)
        step = max(1, n // 60000)
        sub = data.iloc[::step] if step > 1 else data
        for r in sub.itertuples(index=False):
            d = r._asdict()
            v = _num(d.get("value"))
            cells.append([_f(d.get("x_pixel"), 1), _f(d.get("y_pixel"), 1), None if v is None else round(v, 4)])
        out["cells"] = cells
        out["thinned"] = step
        cs = result.provenance.get("colour_scale") or {}
        out["colour_scale"] = {k: cs.get(k) for k in ("box", "values", "source", "colormap", "vmin", "vmax")
                               if k in cs}
        try:
            out["cell_size"] = _cell_size(data)
        except Exception:  # noqa: BLE001
            out["cell_size"] = None
    return out


def _cell_size(data) -> Optional[List[float]]:
    """the width and height of a heat map's cells, in pixels: the commonest gaps between their centres"""
    import numpy as np

    sizes = []
    for col in ("x_pixel", "y_pixel"):
        v = np.unique(np.round(data[col].to_numpy(float), 1))
        d = np.diff(v)
        d = d[d > 0.2]
        sizes.append(float(np.median(d)) if d.size else 1.0)
    return sizes


def _table(data) -> Dict[str, Any]:
    import numpy as np

    head = data.head(TABLE_ROWS)
    rows = []
    for r in head.itertuples(index=False):
        out = []
        for v in r:
            if isinstance(v, (bool, np.bool_)):
                out.append(bool(v))
            elif isinstance(v, (int, np.integer)):
                out.append(int(v))
            elif isinstance(v, (float, np.floating)):
                out.append(None if not np.isfinite(v) else float(v))
            else:
                out.append(str(v))
        rows.append(out)
    return {"columns": [str(c) for c in data.columns], "rows": rows, "n": int(len(data))}


def refs_from_ticks(path: str, ticks: Sequence[Dict[str, Any]], options: Optional[Dict[str, Any]] = None
                    ) -> Dict[str, Any]:
    """Ticks marked on the page - ``{"axis": "x" or "y", "px": the tick's column or row, "value": what it stands for,
    "at": [x, y] where it was clicked}`` - as the readers' *x_ref* and *y_ref*: a list of (pixel, value) for a figure
    with one plot area, else a dict of them by panel number. Each tick goes to the plot area beside which it was
    clicked; plot areas stacked on a shared x axis (the same left and right edges) share its ticks, and those side by
    side on a shared y axis share theirs. Returns ``{"x_ref", "y_ref", "notes"}``."""
    from trace_digitiser.io import load_image
    from trace_digitiser.panel_detection import find_plot_panels

    options = options or {}
    rgb = load_image(os.path.expanduser(path))
    boxes = options.get("plot_area") or None
    if boxes is not None:
        boxes = [tuple(float(v) for v in b) for b in (boxes if isinstance(boxes[0], (list, tuple)) else [boxes])]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        panels, _, _ = find_plot_panels(rgb, layout_mode=options.get("layout_mode", "auto"),
                                        expected_rows=options.get("expected_rows"),
                                        expected_cols=options.get("expected_cols"),
                                        expected_panels=options.get("expected_panels"), plot_area=boxes)
    notes: List[str] = []
    found: Dict[str, Dict[int, list]] = {"x": {}, "y": {}}
    for t in ticks or []:
        axis = "x" if t.get("axis") == "x" else "y"
        px, value = _num(t.get("px")), _num(t.get("value"))
        if px is None or value is None:
            continue
        at = t.get("at") or [px, px]
        best = None
        for p in panels:
            e = p["edges"]
            lo, hi = (e["left"], e["right"]) if axis == "x" else (e["top"], e["bottom"])
            if not lo - 3 <= px <= hi + 3:
                continue
            c = float(at[1] if axis == "x" else at[0])
            a, b = (e["top"], e["bottom"]) if axis == "x" else (e["left"], e["right"])
            d = 0.0 if a <= c <= b else min(abs(c - a), abs(c - b))
            if best is None or d < best[0]:
                best = (d, p["panel_id"])
        if best is None:
            notes.append(f"A tick at {px:g} is not beside any plot area, so it was not used.")
            continue
        found[axis].setdefault(best[1], []).append((px, value))
    # shared axes
    for axis, (k1, k2) in (("x", ("left", "right")), ("y", ("top", "bottom"))):
        for p in panels:
            if p["panel_id"] in found[axis]:
                continue
            for q in panels:
                if q["panel_id"] in found[axis] and all(abs(p["edges"][k] - q["edges"][k]) <= 3 for k in (k1, k2)):
                    found[axis][p["panel_id"]] = list(found[axis][q["panel_id"]])
                    break
    out: Dict[str, Any] = {"notes": notes}
    for axis in ("x", "y"):
        refs = {pid: pts for pid, pts in sorted(found[axis].items())}
        for pid in [pid for pid, pts in refs.items() if len(pts) < 2]:
            notes.append(f"Panel {pid} has only one {axis} tick marked: mark two or more for its {axis} axis to be "
                         "set from them.")
            del refs[pid]
        if not refs:
            out[f"{axis}_ref"] = None
        elif len(panels) == 1:
            out[f"{axis}_ref"] = [list(q) for q in next(iter(refs.values()))]
        else:
            out[f"{axis}_ref"] = {str(pid): [list(q) for q in pts] for pid, pts in refs.items()}
    return out


def digitise(kind: str, path: str, options: Optional[Dict[str, Any]] = None, output_dir: Optional[str] = None,
             prefix: Optional[str] = None, overlay: bool = False) -> Dict[str, Any]:
    """Digitise a figure as *kind* ("lines", "points", "bars", "rows", "heatmap" or "polar") with the reader's
    *options* (the page's choices), write its files into *output_dir* and say what was found.

    *options* may hold ``ticks``, ticks marked on the page (see :func:`refs_from_ticks`), in place of *x_ref* and
    *y_ref*.

    Returns ``{"kind", "seconds", "warnings", "panels", "shapes", "table", "files", "command", "python"}``.
    """
    import trace_digitiser as td

    path = os.path.expanduser(path)
    options = dict(options or {})
    notes: List[str] = []
    ticks = options.pop("ticks", None)
    if ticks and kind != "polar":
        refs = refs_from_ticks(path, ticks, options)
        notes = refs["notes"]
        for axis in ("x", "y"):
            if refs[f"{axis}_ref"] and not options.get(f"{axis}_ref"):
                options[f"{axis}_ref"] = refs[f"{axis}_ref"]
    opts = _clean(kind, options)
    out_dir = os.path.expanduser(output_dir) if output_dir else None
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    reader = getattr(td, READERS[kind])
    t = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if kind == "lines":
            result = reader(path, output_dir=out_dir, output_prefix=prefix, write_outputs=bool(out_dir),
                            save_overlay=overlay and bool(out_dir), **opts)
            data = result.trace_data
        else:
            result = reader(path, output_dir=out_dir, output_prefix=prefix, write_outputs=bool(out_dir),
                            save_overlay=overlay and bool(out_dir), **opts)
            data = result.data
    seconds = time.time() - t
    files = []
    for name in ("trace_csv_path", "summary_csv_path", "metadata_csv_path", "csv_path", "provenance_path",
                 "overlay_path", "straightened_path"):
        p = getattr(result, name, None)
        if p:
            files.append(str(p))
    return {
        "kind": kind,
        "path": path,
        "seconds": round(seconds, 2),
        "warnings": notes + list(result.warnings),
        "panels": [_panel(p) for p in result.panels],
        "shapes": _shapes(kind, result, data),
        "table": _table(data),
        "files": files,
        "options": {k: (list(v) if isinstance(v, tuple) else v) for k, v in opts.items()},
        "command": command_line(kind, path, opts, out_dir, overlay),
        "python": python_code(kind, path, opts, out_dir),
    }


# --------------------------------------------------------------------- points taken out or put in by hand


def _value(cal: Optional[Dict[str, Any]], px: float) -> Optional[float]:
    if not cal or not cal.get("calibrated", True):
        return None
    v = float(cal["a"]) * px + float(cal["b"])
    return 10.0 ** v if cal.get("log") else v


def save_edits(kind: str, csv: str, remove: Sequence[int] = (), add: Sequence[Sequence[float]] = (),
               panels: Optional[Sequence[Dict[str, Any]]] = None, polar: Optional[Dict[str, Any]] = None,
               out: Optional[str] = None) -> Dict[str, Any]:
    """A table of points (or of a polar plot's points) with the points marked on the page taken out (*remove*: their
    rows, counting from 0) and those added (*add*: their pixel positions) put in, their values worked out from the
    axes as digitised (*panels*, or *polar*: ``{"centre", "radial_scale": {"a", "b"}, "zero", "clockwise"}``).
    Written beside the table as ``NAME_edited.csv``, with a column ``edited`` ("added" for the points put in)."""
    import pandas as pd

    csv = os.path.expanduser(csv)
    data = pd.read_csv(csv)
    keep = data.drop(index=[int(i) for i in remove if 0 <= int(i) < len(data)]).copy()
    keep["edited"] = ""
    # (a point put in belongs to the commonest series: most figures have one)
    series = int(data["series"].mode().iloc[0]) if "series" in data and len(data) else 1
    colour = data.loc[data["series"] == series, "colour"].iloc[0] if "colour" in data and len(data) else ""
    rows = []
    for x, y in add or []:
        x, y = float(x), float(y)
        row: Dict[str, Any] = {"series": series, "colour": colour, "x_pixel": round(x, 2), "y_pixel": round(y, 2),
                               "edited": "added"}
        if kind == "polar" and polar:
            cx, cy = (float(v) for v in polar["centre"])
            dx, dy = x - cx, cy - y
            dist = math.hypot(dx, dy)
            theta = math.degrees(math.atan2(dy, dx))
            offset = {"east": 0.0, "north": 90.0, "west": 180.0, "south": 270.0}[polar.get("zero", "east")]
            ang = (theta - offset) % 360.0
            if polar.get("clockwise"):
                ang = (-ang) % 360.0
            rs = polar.get("radial_scale") or {}
            row.update(radius_px=round(dist, 2), r_value=float(rs.get("a", 1.0)) * dist + float(rs.get("b", 0.0)),
                       angle_degrees=round(ang, 3), angle_radians=math.radians(ang))
        else:
            for p in panels or []:
                l, t, r, b = p["plot_area"]
                if l - 3 <= x <= r + 3 and t - 3 <= y <= b + 3:
                    row["panel_id"] = p["panel_id"]
                    row["x_value"] = _value(p.get("x"), x)
                    row["y_value"] = _value(p.get("y"), y)
                    row["x_norm_0_to_1"] = (x - l) / max(1e-9, r - l)
                    break
        rows.append(row)
    if rows:
        keep = pd.concat([keep, pd.DataFrame(rows)], ignore_index=True)
    sort = [c for c in (("series", "r_value") if kind == "polar" else ("panel_id", "x_value")) if c in keep]
    if sort:
        keep = keep.sort_values(sort, kind="stable").reset_index(drop=True)
    target = os.path.expanduser(out) if out else csv[:-4] + "_edited.csv"
    keep.to_csv(target, index=False)
    return {"path": target, "rows": int(len(keep)), "removed": len(data) - (len(keep) - len(rows)),
            "added": len(rows)}


# --------------------------------------------------------------------- the same, as a command or as Python


def _is_default(kind: str, k: str, v) -> bool:
    d = DEFAULTS.get(k, None)
    if isinstance(d, dict):
        d = d.get(kind)
    if d is None:
        return False
    if isinstance(d, float):
        return _num(v) == d
    return v == d


def _g(v) -> str:
    """a number as short as it can be written without losing it"""
    f = float(v)
    return str(int(f)) if f.is_integer() and abs(f) < 1e15 else repr(round(f, 6))


def _home(path: str) -> str:
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path == home or path.startswith(home + "/") else path


def command_line(kind: str, path: str, opts: Dict[str, Any], output_dir: Optional[str] = None,
                 overlay: bool = False) -> Dict[str, Any]:
    """The trace-digitiser command that does what *opts* say: ``{"text", "ok", "why"}`` (ok is False, with why, for
    what the command line cannot say - reference points for one panel of several)."""
    q = lambda s: s if s.startswith("~/") and shlex.quote(s[2:]) == s[2:] else shlex.quote(s)  # noqa: E731
    words = ["trace-digitiser"] + ([kind] if kind != "lines" else []) + [q(_home(path))]
    why = ""
    box = lambda b: ",".join(_g(v) for v in b)  # noqa: E731
    for k, v in opts.items():
        if _is_default(kind, k, v):
            continue
        flag = "--" + k.replace("_", "-")
        if k in ("plot_area", "exclude"):
            words += [w for b in v for w in (flag, box(b))]
        elif k in ("y_ref", "x_ref"):
            if isinstance(v, dict):
                if len(v) == 1:
                    v = next(iter(v.values()))
                else:
                    why = "reference points for more than one panel can be given in Python, not on the command line"
                    continue
            words += [w for px, val in v for w in (flag, f"{_g(px)}:{_g(val)}")]
        elif k == "r_ref":
            words += [w for px, val in v for w in ("--r-ref", f"{_g(px)}:{_g(val)}")]
        elif k in ("trace_colours", "colours"):
            fl = "--trace-colour" if k == "trace_colours" else "--colour"
            words += [w for c in v for w in (fl, q(str(c)))]
        elif k in ("colour", "dots"):
            words += ["--colour" if k == "colour" else "--dots", q(str(v))]
        elif k in ("centre", "row_range", "colourbar_values"):
            words += [flag, ",".join(_g(a) for a in v)]
        elif k == "colourbar":
            words += [flag, box(v)]
        elif k in ("row_values", "row_positions"):
            vals = [float(a) for a in v]
            run = len(vals) > 2 and all(b - a == 1 for a, b in zip(vals, vals[1:]))
            words += [flag, f"{_g(vals[0])}:{_g(vals[-1])}" if run else ",".join(_g(a) for a in vals)]
        elif k == "ocr":
            if not v:
                words.append("--no-ocr")
        elif k == "straighten":
            words += [flag, "never" if v is False else str(v)]
        elif k == "clockwise":
            if v:
                words.append("--clockwise")
        elif k == "orientation":
            if v == "horizontal":
                words.append("--horizontal")
        elif k == "error_bars" and kind == "bars":
            if not v:
                words.append("--no-error-bars")
        elif k == "layout_mode":
            words += ["--layout", str(v)]
        elif k in ("expected_panels", "expected_rows", "expected_cols"):
            if kind == "lines":
                words += ["--" + k.split("_", 1)[1], str(v)]
            else:
                why = why or f"{k} can be given in Python, not on the command line of trace-digitiser {kind}"
        elif k == "achromatic":
            words += [flag, str(v)]
        elif isinstance(v, bool):
            if v:
                words.append(flag)
        else:
            words += [flag, _g(v) if _num(v) is not None and not isinstance(v, str) else q(str(v))]
    if output_dir:
        words += ["-o", q(_home(output_dir))]
    if overlay:
        words.append("--overlay")
    return {"text": " ".join(words), "ok": not why, "why": why}


def _py(v) -> str:
    if isinstance(v, bool) or v is None:
        return repr(v)
    if isinstance(v, (int, float)):
        return _g(v)
    if isinstance(v, str):
        return repr(v)
    if isinstance(v, dict):
        return "{" + ", ".join(f"{_py(k)}: {_py(x)}" for k, x in v.items()) + "}"
    if isinstance(v, tuple):
        return "(" + ", ".join(_py(x) for x in v) + ("," if len(v) == 1 else "") + ")"
    if isinstance(v, list):
        if len(v) > 6 and all(isinstance(x, (int, float)) for x in v):
            vals = [float(x) for x in v]
            if all(b - a == 1 for a, b in zip(vals, vals[1:])):
                return f"list(range({_g(vals[0])}, {_g(vals[-1] + 1)}))"
        return "[" + ", ".join(_py(x) for x in v) + "]"
    return repr(v)


def python_code(kind: str, path: str, opts: Dict[str, Any], output_dir: Optional[str] = None) -> str:
    """The Python that does what *opts* say (for a notebook, or a script on your own computer)."""
    fn = READERS[kind]
    lines = ["import trace_digitiser as td", "", f"result = td.{fn}(", f"    {_py(path)},"]
    for k, v in opts.items():
        if _is_default(kind, k, v):
            continue
        lines.append(f"    {k}={_py(v)},")
    if output_dir:
        lines.append(f"    output_dir={_py(output_dir)},")
    lines.append(")")
    table = "result.trace_data" if kind == "lines" else "result.data"
    lines += ["for message in result.warnings:", "    print('CHECK:', message)", table]
    return "\n".join(lines)


# --------------------------------------------------------------------- the examples' known values


def compare(example: str, csv: str, kind: Optional[str] = None) -> Dict[str, Any]:
    """Compare a table digitised from one of the examples (a CSV file) with the values the figure shows."""
    import pandas as pd

    from . import known

    data = pd.read_csv(os.path.expanduser(csv))
    return known.compare(example, data, kind)


def which_example(path: str) -> Optional[str]:
    from . import known

    base = os.path.basename(str(path))
    return known.which_example(base) if str(path).startswith(known.EXAMPLES_DIR) or "figure-" in base else None
