/* =====================================================================
   The Digitiser workbench's set-up: the file system (your files, kept in
   the browser, and the read-only examples), the terminal, the notebooks,
   and the other tabs – each built the first time it is shown.
   Also: opening a file in the right tab (a picture or a PDF in Digitise),
   the buttons the Files tab shows for pictures and digitised tables
   (MG.app.fileActions), and the ▶ buttons of the help pages.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, toast, store } = MG;
  const CFG = MG.config;
  MG.app = MG.app || {};
  MG.page = MG.page || {};
  MG.actions = MG.actions || {};

  const HOME = '/home/user';
  MG.app.HOME = HOME;
  MG.app.PROJECT = HOME;
  const abs = (u) => new URL(u, location.href).href;
  const EX_TIME = Date.parse('2026-11-14T09:00:00Z');
  const EXDIR = '/data/examples/hearn-whitmore-2026';

  /* the example data: the list is written into the page by build/make_page.py (window.WB_EXAMPLES) */
  const EXAMPLES = (window.WB_EXAMPLES || []).map((f) => ({ path: '/data/examples/' + f.p, url: abs('data/examples/' + f.p), size: f.s, mtime: EX_TIME }));
  MG.app.exampleFiles = EXAMPLES;
  /* the notebooks a new user finds in ~/notebooks (data/starter/*.ipynb) */
  const STARTERS = window.WB_STARTERS || [];
  /* the folders of a new user's home */
  const FOLDERS = ['pictures', 'results', 'notebooks'];

  /** a notebook to start from (data/starter) → ~/notebooks; false if it couldn't be fetched */
  async function addStarter(fs, rel) {
    const stop = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = stop && setTimeout(() => stop.abort(), 15000);
    try {
      const r = await fetch(abs('data/starter/' + rel.split('/').pop()), stop ? { signal: stop.signal } : {});
      if (!r.ok) return false;
      const text = await r.text();
      fs.mkdirp(MG.path.dirname(HOME + '/' + rel));
      fs.writeText(HOME + '/' + rel, text);
      return true;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function setupFs() {
    const fs = new MG.VFS(HOME);
    fs.mkdirp('/data/examples');
    for (const f of EXAMPLES) {
      fs.mkdirp(MG.path.dirname(f.path));
      fs.put(f.path, { kind: 'url', url: f.url, size: f.size, protected: true, readonly: true, mtime: f.mtime });
    }
    for (const [p, e] of fs.entries) if (e.kind === 'dir' && (p === '/data' || p.startsWith('/data/'))) e.protected = true;
    await MG.project.restore(fs, [HOME]);
    fs.cwd = HOME;
    MG.project.watch(fs);
    // the first visit: folders, and notebooks to start from (one given before is never put back, in case it was
    // deleted on purpose)
    const first = !store.get('seeded', false);
    const given = store.get('starters', []);
    if (first) FOLDERS.forEach((d) => fs.mkdirp(HOME + '/' + d));
    for (const s of STARTERS) {
      if (given.includes(s.p)) continue;
      if (!fs.exists(HOME + '/' + s.p) && !(await addStarter(fs, s.p))) continue;
      given.push(s.p);
    }
    store.set('starters', given);
    store.set('seeded', true);
    return fs;
  }

  MG.page.firstBench = 'digitise';
  MG.page.init = async function () {
    const fs = (MG.app.fs = await setupFs());
    MG.app.term = new MG.TerminalUI(document.getElementById('termRoot'), {
      fs,
      hostname: CFG.hostname || 'digitiser',
      env: {},
      welcome:
        `A Linux terminal (bash) in your browser, with trace-digitiser, which reads the values out of pictures of graphs, and Python. Your files are in ~ (${HOME}); the example figures, which can’t be changed, are in ${EXDIR}. Type  help  to see what’s here, or  man trace-digitiser  for examples.` +
        (MG.user.name() === MG.user.DEFAULT ? ' To see your name in place of user, click “user” at the top of the page.' : '')
    });
    MG.app.nbApp = new MG.NotebookApp(document.getElementById('nbRoot'), { fs, dir: HOME + '/notebooks' });
    MG.project.persist();
  };

  /* ------------------------------------------------------------------
     the tabs that are built when first shown
     ------------------------------------------------------------------ */
  let nbOpened = false;
  async function openFirstNotebook() {
    if (nbOpened) return;
    nbOpened = true;
    const fs = MG.app.fs, app = MG.app.nbApp;
    const last = store.get('nbOpen', null);
    const welcome = HOME + '/notebooks/01-digitise-in-python.ipynb';
    const start = (last && fs.exists(last) && last) || (fs.exists(welcome) && welcome) || (app.list()[0] || {}).path;
    if (start) await app.open(start);
    else await app.newNotebook('python');
  }
  MG.page.lazy = {
    digitise: (pane) => {
      MG.app.digitise = new MG.DigitiseTab(pane.querySelector('#dgRoot'), { fs: MG.app.fs });
      return MG.app.digitise.ready;
    },
    terminal: () => {},
    notebook: () => openFirstNotebook(),
    editor: (pane) => {
      MG.app.editor = new MG.Editor(pane.querySelector('#edRoot'), { fs: MG.app.fs });
    },
    assistant: (pane) => {
      if (MG.Assistant) MG.app.ai = new MG.Assistant(pane.querySelector('#aiRoot'), {});
    }
  };
  /* each time a tab is shown */
  MG.page.shown = {
    digitise: (pane, opts) => MG.app.digitise && MG.app.digitise.shown(opts),
    notebook: () => MG.app.nbApp && MG.app.nbApp.shown(),
    terminal: (pane, opts) => {
      if (MG.app.term && !(opts && opts.resize) && !window.matchMedia('(max-width: 900px)').matches) MG.app.term.focus();
    },
    editor: () => MG.app.editor && MG.app.editor.shown && MG.app.editor.shown(),
    assistant: (pane, opts) => MG.app.ai && MG.app.ai.shown && MG.app.ai.shown(opts)
  };

  async function waitFor(get, ms = 4000) {
    for (let t = 0; t < ms && !get(); t += 50) await new Promise((r) => setTimeout(r, 50));
    return get();
  }
  MG.app.waitFor = waitFor;

  /* ------------------------------------------------------------------
     kinds of file, and what can be done with each
     ------------------------------------------------------------------ */
  const PICTURE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;
  /** the example a digitised table comes from (figure-3c_points.csv → figure-3c), or null */
  const exampleOfTable = (path) => {
    const m = /(?:^|\/)(figure-(?:1a|1b|2|3a|3b|3c|4|s3))(?![a-z0-9])[^/]*_(trace_by_column|points|bars|rows|heatmap|polar)(?:_edited)?\.csv$/i.exec(path.replace(/_automated_digitised_trace_by_column/, '_trace_by_column'));
    return m ? m[1].toLowerCase() : null;
  };
  MG.app.exampleOfTable = exampleOfTable;
  /** the buttons the Files tab shows for a file: [icon, label, title, fn] */
  MG.app.fileActions = (path) => {
    const out = [];
    if (PICTURE.test(path)) out.push(['digitise', 'Digitise', 'Open this picture in the Digitise tab', () => MG.app.digitiseOpen(path)]);
    else if (/\.pdf$/i.test(path)) out.push(['digitise', 'Digitise a page', 'Choose a page of this PDF, and digitise its figure in the Digitise tab', () => MG.app.digitiseOpen(path)]);
    else if (/\.csv$/i.test(path) && exampleOfTable(path)) out.push(['compare', 'Compare with the known values', 'Compare this table with the values the example figure shows (compare-known, in the Terminal)', () => MG.app.runInTerminal(`compare-known ${MG.app.fs.pretty(path)}`)]);
    return out;
  };

  /* ------------------------------------------------------------------
     opening files: the right tab for each kind
     ------------------------------------------------------------------ */
  /** edit or look at a file in the Files tab */
  MG.app.editFile = async (path, opts = {}) => {
    await MG.app.showWorkbench('editor');
    const ed = await waitFor(() => MG.app.editor);
    if (ed) await ed.openFile(path, opts);
  };
  /** open a file where it belongs: a notebook in Notebook, the rest in Files */
  MG.app.openFile = async (path, opts = {}) => {
    const p = MG.app.fs.resolve(path);
    if (!opts.edit && /\.ipynb$/i.test(p)) {
      await MG.app.showWorkbench('notebook');
      return MG.app.nbApp.open(p);
    }
    return MG.app.editFile(p, opts);
  };
  /** show a folder or file in the Files tab */
  MG.app.revealFile = async (path) => {
    await MG.app.showWorkbench('editor');
    const ed = await waitFor(() => MG.app.editor);
    if (ed && ed.reveal) ed.reveal(MG.app.fs.resolve(path));
  };
  /** a picture or a PDF → the Digitise tab */
  MG.app.digitiseOpen = async (path) => {
    await MG.app.showWorkbench('digitise');
    const D = await waitFor(() => MG.app.digitise, 8000);
    if (!D) throw new Error('The Digitise tab couldn’t start.');
    return D.open(MG.app.fs.resolve(path.replace(/^~(?=\/|$)/, HOME)));
  };

  /* Files edited in the Files tab are saved with Save / Ctrl+S: before the page is left or reloaded with unsaved edits,
     the browser asks (it shows its own message). */
  window.addEventListener('beforeunload', (e) => {
    const ed = MG.app.editor;
    if (ed && ed.dirtyPaths && ed.dirtyPaths().length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ------------------------------------------------------------------
     ▶ buttons of the help pages
     data-digitise="/data/examples/…/figure-3c.png"   open a picture (or PDF) in Digitise
     data-dg-set='{"kind": …, "marks": {…}, "options": {…}}'  fill in marks and options (data-digitise first, if
                                                              both are on one button)
     data-dg-run                                      and digitise
     data-example="figure-1a.png"                     copy an example into ~/pictures
     data-new-nb / data-open-nb                       a new notebook / open a notebook
     ------------------------------------------------------------------ */
  MG.actions.digitise = async (path, btn) => {
    await MG.app.digitiseOpen(path);
    const D = MG.app.digitise;
    if (btn && btn.dataset.dgSet) D.apply(JSON.parse(btn.dataset.dgSet));
    if (btn && btn.dataset.dgRun != null) await D.run();
  };
  MG.actions.dgSet = async (json, btn) => {
    if (btn && btn.dataset.digitise != null) return; // (done by data-digitise, after opening)
    await MG.app.showWorkbench('digitise');
    const D = await waitFor(() => MG.app.digitise, 8000);
    if (!D) return;
    D.apply(JSON.parse(json));
    if (btn && btn.dataset.dgRun != null) await D.run();
  };
  MG.actions.dgRun = async (v, btn) => {
    if (btn && (btn.dataset.digitise != null || btn.dataset.dgSet != null)) return;
    await MG.app.showWorkbench('digitise');
    const D = await waitFor(() => MG.app.digitise, 8000);
    if (D) await D.run();
  };
  MG.actions.example = async (rel) => {
    const fs = MG.app.fs;
    const src = EXDIR + '/' + rel.replace(/^\/+/, '');
    if (!fs.exists(src)) throw new Error('There is no example ' + rel);
    const dest = HOME + '/pictures/' + rel.split('/').pop();
    fs.copy(src, dest);
    toast(`Copied to <b>${esc(fs.pretty(dest))}</b>. This copy is yours to change.`, 'ok');
  };
  MG.actions.edit = async (path) => MG.app.editFile(path.replace(/^~(?=\/|$)/, HOME));
  MG.actions.newNb = async () => {
    await MG.app.showWorkbench('notebook');
    await MG.app.nbApp.newNotebook('python');
  };
  MG.actions.openNb = async (path) => {
    await MG.app.showWorkbench('notebook');
    const p = path.startsWith('~/') ? HOME + path.slice(1) : path;
    // (a notebook to start from that isn't there, deleted or never given: a fresh copy)
    const starter = STARTERS.find((s) => HOME + '/' + s.p === p);
    if (!MG.app.fs.exists(p) && starter) await addStarter(MG.app.fs, starter.p);
    if (!MG.app.fs.exists(p)) throw new Error(`There is no notebook ${path} (was it renamed or deleted?)`);
    await MG.app.nbApp.open(p);
  };

  /* Start afresh: forget the open notebook and the Digitise tab's picture and marks first */
  MG.page.beforeReset = async () => {
    for (const k of ['nbOpen', 'seeded', 'starters', 'termHistory', 'dgLast', 'dgMarks', 'dgOpts', 'dgKind']) store.remove(k);
  };
  void h;
})();
