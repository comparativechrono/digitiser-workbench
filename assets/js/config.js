/* =====================================================================
   Settings for the Digitiser workbench.
   Edit and re-upload this file; nothing else needs to change.
   ===================================================================== */
window.MG_CONFIG = {
  courseTitle: 'Digitiser workbench',
  courseSubtitle: 'Read the values out of graphs in papers – with trace-digitiser, in your browser, where nothing is uploaded',

  /* The prefix of what the page keeps in the browser (files, notebooks, settings). Every site
     of ours on the same address (comparativechrono.github.io/…) shares one browser storage, so
     each needs its own prefix: change it only if two copies of this workbench on one web site
     must not share their saved work. */
  storePrefix: 'dgwb',
  hostname: 'digitiser',

  /* Python in the browser (Pyodide). To host it with the site instead of the CDN, download the
     Pyodide release and put its folder here, e.g. 'assets/vendor/pyodide/'. */
  pyodideBase: 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/',
  /* Pyodide packages loaded when Python starts: what trace-digitiser needs. Any other Pyodide
     package (SciPy, scikit-image …) loads when a notebook cell imports it. */
  pythonPreload: ['numpy', 'opencv-python', 'pandas', 'pillow', 'matplotlib'],
  pythonBackground: [],

  /* Tesseract compiled to WebAssembly, with its English model: it reads the tick labels of axes, in
     the page. */
  ocrBase: 'assets/vendor/tesseract/',

  /* The AI assistant (AI tab). Each user enters their own API key in the assistant's settings. The key is
     kept in memory (or, if they ask, in this tab's sessionStorage) and sent only to the service they chose.
     Pictures, and what is in data files, are never sent.
     liveProvider is the service offered first ('gemini', 'anthropic' or 'openai'), followed by the model
     used for each service. Models are retired from time to time, so if the assistant reports that a model
     cannot be found, put a current one here (see ai.google.dev/gemini-api/docs/models). */
  liveProvider: 'gemini',
  geminiModel: 'gemini-3.8-flash',
  /* If that model is busy, over its limit or cannot be found, the assistant tries these models in turn. */
  geminiFallbackModels: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  aiWaitSeconds: 60,
  anthropicModel: 'claude-sonnet-5-5',

  /* How much the workbench may keep in this browser before it warns (megabytes). */
  storageWarnMB: 500
};
