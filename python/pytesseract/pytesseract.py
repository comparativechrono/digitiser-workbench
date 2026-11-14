"""The functions of pytesseract, answered by Tesseract in WebAssembly (see __init__)."""
from __future__ import annotations

import io
import shlex

tesseract_cmd = "tesseract"


class Output:
    BYTES = "bytes"
    DATAFRAME = "data.frame"
    DICT = "dict"
    STRING = "string"


class TesseractError(RuntimeError):
    def __init__(self, status=1, message="Tesseract failed"):
        self.status = status
        self.message = message
        self.args = (status, message)


class TesseractNotFoundError(EnvironmentError):
    def __init__(self, message=None):
        super().__init__(message or "Tesseract (WebAssembly) is not loaded in this page yet.")


class _Version:
    def __init__(self, text):
        self.text = text

    def __str__(self):
        return self.text

    __repr__ = __str__


def _engine():
    try:
        import js  # Pyodide: the worker's global scope
    except ImportError as e:  # not in a browser
        raise TesseractNotFoundError("This pytesseract only works in the workbench (the browser).") from e
    ready = getattr(js, "wb_ocr_ready", None)
    if ready is None or not ready():
        raise TesseractNotFoundError()
    return js


def _png(image) -> bytes:
    """A picture (PIL image, NumPy array, path or bytes) as PNG bytes."""
    from PIL import Image

    if isinstance(image, (bytes, bytearray)):
        img = Image.open(io.BytesIO(image))
    elif isinstance(image, str):
        img = Image.open(image)
    elif isinstance(image, Image.Image):
        img = image
    else:  # a NumPy array
        import numpy as np

        arr = np.asarray(image)
        if arr.dtype != np.uint8:
            arr = arr.astype(np.uint8)
        img = Image.fromarray(arr)
    if img.mode not in ("L", "RGB", "RGBA", "1"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _options(config: str, lang):
    """--psm N, --oem N, -c name=value, --dpi N (as the tesseract program takes them) → (psm, variables)"""
    psm = 3
    variables = {}
    words = shlex.split(config or "")
    i = 0
    while i < len(words):
        w = words[i]
        if w == "--psm" and i + 1 < len(words):
            psm = int(words[i + 1])
            i += 2
            continue
        if w == "--oem" and i + 1 < len(words):
            i += 2  # only the LSTM engine is here
            continue
        if w == "--dpi" and i + 1 < len(words):
            variables["user_defined_dpi"] = words[i + 1]
            i += 2
            continue
        if w == "-c" and i + 1 < len(words) and "=" in words[i + 1]:
            k, v = words[i + 1].split("=", 1)
            variables[k] = v
            i += 2
            continue
        if w.startswith("-c") and "=" in w[2:]:
            k, v = w[2:].split("=", 1)
            variables[k] = v
        i += 1
    if lang not in (None, "", "eng"):
        raise TesseractError(1, f"Only English (eng) is available in the browser, not {lang!r}.")
    return psm, variables


def _run(image, lang, config, kind):
    import json

    js = _engine()
    psm, variables = _options(config, lang)
    from pyodide.ffi import to_js

    return str(js.wb_ocr(to_js(_png(image)), psm, json.dumps(variables), kind))


def image_to_string(image, lang=None, config="", nice=0, output_type=Output.STRING, timeout=0):
    text = _run(image, lang, config, "text")
    if output_type == Output.DICT:
        return {"text": text}
    if output_type == Output.BYTES:
        return text.encode("utf-8")
    return text


_TSV_KEYS = ("level", "page_num", "block_num", "par_num", "line_num", "word_num", "left", "top", "width", "height", "conf", "text")


def image_to_data(image, lang=None, config="", nice=0, output_type=Output.STRING, timeout=0, pandas_config=None):
    body = _run(image, lang, config, "tsv")
    rows = [line.split("\t") for line in body.splitlines() if line.strip()]
    tsv = "\t".join(_TSV_KEYS) + "\n" + "\n".join("\t".join(r) for r in rows) + ("\n" if rows else "")
    if output_type == Output.STRING:
        return tsv
    if output_type == Output.BYTES:
        return tsv.encode("utf-8")
    out = {k: [] for k in _TSV_KEYS}
    for r in rows:
        r = (r + [""] * len(_TSV_KEYS))[: len(_TSV_KEYS)]
        for k, v in zip(_TSV_KEYS, r):
            if k == "text":
                out[k].append(v)
            elif k == "conf":
                try:
                    out[k].append(float(v))
                except ValueError:
                    out[k].append(-1.0)
            else:
                try:
                    out[k].append(int(v))
                except ValueError:
                    out[k].append(0)
    if output_type == Output.DATAFRAME:
        import pandas as pd

        return pd.DataFrame(out)
    return out


def image_to_boxes(*a, **k):
    raise TesseractError(1, "image_to_boxes is not available in the browser; use image_to_data.")


def image_to_osd(*a, **k):
    raise TesseractError(1, "image_to_osd is not available in the browser.")


def get_tesseract_version():
    js = _engine()
    return _Version(str(js.wb_ocr_version()))


def get_languages(config=""):
    return ["eng"]
