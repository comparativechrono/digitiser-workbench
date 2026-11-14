"""pytesseract for the browser: the same functions, with Tesseract compiled to WebAssembly.

On a computer, pytesseract runs the ``tesseract`` program. A web page cannot run
programs, so in the workbench Tesseract itself (tesseract.js-core, Tesseract 5
compiled to WebAssembly, with the same English model as Tesseract's own
``tessdata_fast``) runs inside the browser, beside Python, and these functions
call it directly. Nothing leaves the computer.
"""
from .pytesseract import (  # noqa: F401
    Output,
    TesseractError,
    TesseractNotFoundError,
    get_languages,
    get_tesseract_version,
    image_to_boxes,
    image_to_data,
    image_to_osd,
    image_to_string,
)

__version__ = "0.3.13+browser"
