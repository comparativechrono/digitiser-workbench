Tesseract 5.1.0, compiled to WebAssembly – reads the tick labels of axes, in the page (see assets/js/py-worker.js:
the workbench's Python asks it through python/pytesseract, a stand-in for the pytesseract package).

From the npm package tesseract.js-core 6.1.2 (https://www.npmjs.com/package/tesseract.js-core, built by the
tesseract.js project from https://github.com/naptha/tesseract.js-core, which compiles Tesseract
https://github.com/tesseract-ocr/tesseract with Emscripten). The files are unchanged.

  tesseract-core-simd-lstm.js, .wasm   Tesseract with its LSTM engine only, for browsers with WebAssembly SIMD
                                       (every current browser)
  tesseract-core-lstm.js, .wasm        the same without SIMD, for older browsers
  LICENSE                              Apache License 2.0 (tesseract.js-core, and Tesseract itself)

  eng.traineddata                      Tesseract's English model, from tessdata_fast 4.1.0
                                       (https://github.com/tesseract-ocr/tessdata_fast, Apache License 2.0), as
                                       Ubuntu's package tesseract-ocr-eng 1:4.1.0-2 installs it; 4,113,088 bytes,
                                       SHA-256 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2.
                                       The same model as the tesseract program uses on most computers, so that the
                                       labels read here are those trace-digitiser reads there.

Left out: the builds with Tesseract's older engine (tesseract-core.wasm, tesseract-core-simd.wasm), which
trace-digitiser does not use, and the copies of each build with the WebAssembly inside the JavaScript (*.wasm.js).
