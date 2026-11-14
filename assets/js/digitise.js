/* =====================================================================
   The Digitise tab: a picture of a graph, and the mouse.

   Open a picture (an example, one of your files, one from your
   computer, one pasted in, or a page of a PDF), and the tab asks
   trace-digitiser what it finds there (dwb.gui.describe): the plot
   areas, what the tick labels say, the colours drawn, a colour bar,
   polar axes. You can correct and add to that by marking the picture:

     Plot area    a box from the y-axis line to the right-hand edge, and
                  from the top to the x-axis line (one for each panel)
     Leave out    boxes around what is not data: legends, labels, insets
     Tick         a tick of an axis, and the value it stands for: two on
                  an axis set its scale (they snap to the ticks found)
     Colour       the colour of the lines, points or bars to read
     Colour bar   (heat maps) the box of the colour bar
     Centre, Ring (polar plots) the centre, and rings with their values
     Edit points  (after a run) take out points that are not points, put
                  in those that were missed

   Then choose what kind of figure it is and Digitise: Python runs the
   reader (dwb.gui.digitise → trace-digitiser), writes its files into
   ~/results/NAME, and what it found is drawn over the picture. With it
   come the command line and the Python that do the same, for the
   Terminal, a notebook or your own computer, and – for the examples –
   a comparison with the values the figure really shows.

   Nothing leaves the browser: the picture is read by Python and
   Tesseract running in this page.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;
  const HOME = () => (MG.app && MG.app.HOME) || '/home/user';
  const EXDIR = '/data/examples/hearn-whitmore-2026';
  const PICTURE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;
  const OPENABLE = /\.(png|jpe?g|gif|webp|bmp|tiff?|pdf)$/i;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = (v, d = 2) => (v == null || !isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);
  const num = (v) => {
    if (v == null || String(v).trim() === '') return null;
    const f = Number(String(v).replace(/[−–]/g, '-').trim());
    return isFinite(f) ? f : null;
  };
  const fmtVal = (v) => {
    if (v == null || !isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3);
    return String(Number(v.toPrecision(a >= 1000 ? 6 : 4)));
  };
  const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const rgbOf = (hx) => [1, 3, 5].map((i) => parseInt(String(hx).slice(i, i + 2), 16));
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const stem = (p) => p.split('/').pop().replace(/\.[^.]+$/, '');

  const KINDS = [
    ['lines', 'Lines', 'chart', 'Lines and curves: a value for each column of pixels of each line'],
    ['points', 'Points', 'scatter', 'Markers – dots, squares, triangles – and their error bars: scatter plots, dot plots, lines with markers'],
    ['bars', 'Bars', 'bars', 'Bar charts, upright or lying down, with their error bars'],
    ['rows', 'Rows', 'rows', 'A stack of rows: actograms, double-plotted records, birthograms'],
    ['heatmap', 'Heat map', 'heatmap', 'A heat map, read with its colour bar'],
    ['polar', 'Polar', 'polar', 'A polar plot: the angle of each point and its distance from the centre']
  ];
  const KIND_NAME = Object.fromEntries(KINDS.map(([k, n]) => [k, n]));
  const TOOLS = {
    pan: ['Move', 'hand', 'Drag to move the picture. The mouse wheel (or a pinch) zooms, wherever the tool.'],
    area: ['Plot area', 'boxsel', 'Drag a box from the y-axis line to the right-hand edge, and from the top to the x-axis line: one for each panel. Its sides snap to the axis lines found.'],
    exclude: ['Leave out', 'ban', 'Drag a box around what is not data – a legend, a label, an inset – so that it is left out.'],
    tick: ['Tick', 'crosshair', 'Click on a tick of an axis (below the x axis, or beside a y axis), then type the value it stands for. Two ticks on an axis set its scale.'],
    colour: ['Colour', 'pipette', 'Click on a line, a point or a bar to pick its colour: only that colour is read.'],
    bar: ['Colour bar', 'heatmap', 'Drag a box around the colour bar of a heat map (just its coloured strip).'],
    centre: ['Centre', 'target', 'Click on the centre of the polar plot.'],
    ring: ['Ring', 'polar', 'Click on a ring of the polar plot (it snaps to the rings found), then type the value it stands for. Two rings set the radial scale.'],
    crop: ['Crop', 'crop', 'Drag a box around the part of the picture to keep: it is saved as a new picture in ~/pictures.'],
    edit: ['Edit points', 'pencil', 'Click a point that was found to take it out (click again to put it back); click where a point was missed to add it. Then Save the edited table.']
  };
  const TOOLS_FOR = {
    lines: ['pan', 'area', 'exclude', 'tick', 'colour', 'crop'],
    points: ['pan', 'area', 'exclude', 'tick', 'colour', 'edit', 'crop'],
    bars: ['pan', 'area', 'exclude', 'tick', 'colour', 'crop'],
    rows: ['pan', 'area', 'exclude', 'tick', 'colour', 'crop'],
    heatmap: ['pan', 'area', 'exclude', 'tick', 'bar', 'crop'],
    polar: ['pan', 'centre', 'ring', 'colour', 'edit', 'crop']
  };
  /* the examples' kinds, so that opening one of them chooses it (the help's walkthroughs say why) */
  const EXAMPLE_KIND = { 'figure-1a': 'lines', 'figure-1b': 'bars', 'figure-2': 'rows', 'figure-3a': 'lines', 'figure-3b': 'polar', 'figure-3c': 'points', 'figure-4': 'heatmap', 'figure-s3': 'points' };
  const exampleOf = (path) => {
    const n = path.split('/').pop().toLowerCase();
    if (!(path.startsWith(EXDIR + '/') || path.startsWith(HOME() + '/'))) return null;
    const m = /^(figure-(?:1a|1b|2|3a|3b|3c|4|s3))(?![a-z0-9])/.exec(n);
    return m ? m[1] : null;
  };
  const EMPTY_MARKS = () => ({ areas: [], exclude: [], ticks: [], colours: [], colourbar: null, centre: null, rings: [] });
  const DEFAULT_OPTS = {
    lines: { achromatic: 'auto' },
    points: { error_bars: 'auto', colour_tolerance: 60, marker_size: '' },
    bars: { orientation: 'vertical', error_bars: true, colour_tolerance: 40, baseline: '' },
    rows: { row_values: '', bins: '', row_spacing_value: '', direction: 'auto', dots: '', colour_tolerance: 60 },
    heatmap: { rows: '', cols: '', colourbar_values: '', colormap: '', vmin: '', vmax: '' },
    polar: { zero: 'east', clockwise: false, outer_value: '', marker_size: '', colour_tolerance: 60 }
  };

  /* ------------------------------------------------------------------
     PDF pages: PDF.js (assets/vendor/pdfjs), loaded the first time
     ------------------------------------------------------------------ */
  const PDFJS = 'assets/vendor/pdfjs/';
  const abs = (p) => new URL(p, location.href).href;
  let pdfLib = null;
  function loadPdf() {
    if (!pdfLib) {
      pdfLib = import(abs(PDFJS + 'pdf.min.mjs')).then((m) => {
        m.GlobalWorkerOptions.workerSrc = abs(PDFJS + 'pdf.worker.min.mjs');
        return m;
      });
      pdfLib.catch(() => (pdfLib = null));
    }
    return pdfLib;
  }
  async function openPdfDoc(bytes) {
    const L = await loadPdf();
    return L.getDocument({
      data: bytes,
      cMapUrl: abs(PDFJS + 'cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: abs(PDFJS + 'standard_fonts/'),
      wasmUrl: abs(PDFJS + 'wasm/'),
      iccUrl: abs(PDFJS + 'iccs/'),
      isEvalSupported: false,
      enableXfa: false,
      verbosity: L.VerbosityLevel.ERRORS
    }).promise;
  }
  async function renderPage(doc, n, dpi) {
    const page = await doc.getPage(n);
    const scale = dpi / 72;
    let vp = page.getViewport({ scale });
    // (a canvas has a limit: a page larger than 8000 pixels a side is drawn at a lower resolution)
    const most = 8000;
    if (vp.width > most || vp.height > most) vp = page.getViewport({ scale: scale * Math.min(most / vp.width, most / vp.height) });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, background: 'white' }).promise;
    return c;
  }

  class DigitiseTab {
    constructor(root, opts = {}) {
      this.root = root;
      this.fs = opts.fs || MG.app.fs;
      this.path = null;
      this.img = null;
      this.W = 0;
      this.H = 0;
      this.view = { scale: 1, ox: 0, oy: 0 };
      this.tool = 'pan';
      this.kind = store.get('dgKind', 'lines');
      this.opts = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_OPTS)), store.get('dgOpts', {}));
      this.axisOpts = { y_axis: 'left', y_scale: 'auto', x_scale: 'auto', y_min: '', y_max: '', x_min: '', x_max: '', ocr: true };
      this.marks = EMPTY_MARKS();
      this.found = null; // what dwb.gui.describe said
      this.result = null; // the last run
      this.removed = new Set();
      this.added = [];
      this.show = { found: true, marks: true, result: true };
      this.busy = false;
      this._build();
      this.ready = Promise.resolve();
      // Python starts as soon as the tab is first shown: it takes a while the first time
      this._startPython();
      bus.on('kernel:status', (m) => m.lang === 'python' && this._pyStatus());
      bus.on('kernel:state', (m) => m.lang === 'python' && this._pyStatus());
      const last = store.get('dgLast', null);
      if (last && this.fs.exists(last)) this.open(last, { quiet: true }).catch(() => {});
      else this._welcome();
    }

    /* ================================================================
       building the tab
       ================================================================ */
    _build() {
      const R = this.root;
      R.innerHTML = '';
      R.classList.add('dg');
      // ---- toolbar
      this.bar = h('div.dg-bar', { role: 'toolbar', 'aria-label': 'Digitise' });
      const openBtn = h('button.tbtn', { type: 'button', title: 'Open a picture of a graph, or a PDF', html: MG.icon('folder') + '<span>Open</span>' });
      openBtn.addEventListener('click', () => this.openDialog());
      this.nameEl = h('span.dg-name', { title: '' }, 'No picture open');
      this.toolBox = h('div.dg-tools', { role: 'radiogroup', 'aria-label': 'Tools' });
      const zoomOut = h('button.icon-btn', { type: 'button', title: 'Zoom out (−)', 'aria-label': 'Zoom out', html: MG.icon('minus') });
      const zoomIn = h('button.icon-btn', { type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', html: MG.icon('plus') });
      this.zoomEl = h('button.tbtn.dg-zoom', { type: 'button', title: 'Fit the picture to the window (0)' }, '100%');
      zoomOut.addEventListener('click', () => this.zoomBy(1 / 1.4));
      zoomIn.addEventListener('click', () => this.zoomBy(1.4));
      this.zoomEl.addEventListener('click', () => this.fit());
      const showBtn = h('button.tbtn', { type: 'button', title: 'What to show over the picture', html: MG.icon('layers') + '<span>Show</span>' });
      showBtn.addEventListener('click', () => this._showMenu(showBtn));
      this.bar.append(openBtn, this.nameEl, h('span.dg-sep'), this.toolBox, h('span.grow'), showBtn, zoomOut, this.zoomEl, zoomIn);
      // ---- the picture
      this.stage = h('div.dg-stage', { tabindex: '0', 'aria-label': 'The picture: use the tools above to mark it' });
      this.cv = h('canvas.dg-canvas');
      this.loupe = h('canvas.dg-loupe', { width: 132, height: 132, 'aria-hidden': 'true' });
      this.loupe.hidden = true;
      this.empty = h('div.dg-empty');
      this.pop = h('div.dg-pop');
      this.pop.hidden = true;
      this.stage.append(this.cv, this.loupe, this.empty, this.pop);
      this.status = h('div.dg-status', { 'aria-live': 'off' }, h('span.dg-where', ''), h('span.grow'), h('span.dg-py', ''));
      const left = h('div.dg-left', this.stage, this.status);
      // ---- the side panel
      this.side = h('div.dg-side');
      this.secPicture = h('section.dg-sec');
      this.secFound = h('section.dg-sec');
      this.secMarks = h('section.dg-sec');
      this.secKind = h('section.dg-sec');
      this.secRun = h('section.dg-sec');
      this.secResult = h('section.dg-sec.dg-result');
      this.side.append(this.secPicture, this.secFound, this.secKind, this.secMarks, this.secRun, this.secResult);
      R.append(this.bar, h('div.dg-main', left, this.side));
      this._renderTools();
      this._renderKind();
      this._renderMarks();
      this._renderRun();
      this._renderPicture();
      this._renderFound();
      this._renderResult();
      this._events();
      this._pyStatus();
      new ResizeObserver(() => this._resize()).observe(this.stage);
    }

    _welcome() {
      this.empty.hidden = false;
      this.empty.innerHTML = `<div class="dg-welcome">${MG.icon('digitise')}<h3>Digitise a graph</h3>
        <p>Open a picture of a graph – a figure from a paper, a scan, a screenshot – or a PDF. Python and Tesseract read it here, in your browser: nothing is uploaded.</p></div>`;
      const box = this.empty.firstChild;
      const row = h('div.dg-welcome-row');
      const ex = h('button.btn.primary', { type: 'button', html: MG.icon('image') + '<span>Open an example</span>' });
      ex.addEventListener('click', () => this.openDialog('examples'));
      const mine = h('button.btn', { type: 'button', html: MG.icon('upload') + '<span>A picture or PDF from my computer…</span>' });
      mine.addEventListener('click', () => this.upload());
      row.append(ex, mine);
      box.append(row, h('p.muted', 'You can also paste a picture (Ctrl+V), or drop a file here. The Help on the left has walkthroughs for every example.'));
    }

    _renderTools() {
      const B = this.toolBox;
      B.innerHTML = '';
      const avail = TOOLS_FOR[this.kind] || TOOLS_FOR.lines;
      if (!avail.includes(this.tool)) this.tool = 'pan';
      for (const t of avail) {
        const [label, icon, title] = TOOLS[t];
        const b = h('button.tbtn.dg-tool', { type: 'button', role: 'radio', 'aria-checked': this.tool === t ? 'true' : 'false', title: label + ': ' + title, 'data-tool': t, html: MG.icon(icon) + `<span>${esc(label)}</span>` });
        if (this.tool === t) b.classList.add('on');
        if (t === 'edit' && !(this.result && this.result.shapes && this.result.shapes.points)) b.disabled = true;
        b.addEventListener('click', () => this.setTool(t));
        B.appendChild(b);
      }
    }
    setTool(t) {
      this.tool = t;
      this._cancelPop();
      this._renderTools();
      this.stage.dataset.tool = t;
      this.loupe.hidden = !['tick', 'colour', 'area', 'exclude', 'bar', 'centre', 'ring', 'edit'].includes(t);
      this._hint(TOOLS[t] ? TOOLS[t][2] : '');
      this.draw();
    }
    _hint(text) {
      const w = this.status.querySelector('.dg-where');
      w.textContent = text || '';
    }

    /* ================================================================
       Python
       ================================================================ */
    _startPython() {
      const K = MG.kernels.get();
      K.ensure()
        .then(() => {
          this._pyStatus();
          // trace-digitiser imported once, in the background, so that the first look is quick
          return K.call('dwb.gui.warm', {});
        })
        .then(() => {
          this.warm = true;
          this._pyStatus();
          if (this.path && !this.found && !this.looking) this.look();
        })
        .catch(() => this._pyStatus());
    }
    _pyStatus() {
      const K = MG.kernels.peek();
      const el = this.status.querySelector('.dg-py');
      let t = '', cls = '';
      if (!K || K.state === 'off' || K.state === 'loading') {
        t = (K && K.statusText) || 'Python is starting…';
        cls = 'wait';
      } else if (K.state === 'failed') {
        t = 'Python couldn’t start: ' + (K.statusText || '') + ' Reload the page to try again.';
        cls = 'bad';
      } else if (this.busyText) {
        t = this.busyText;
        cls = 'wait';
      } else {
        const v = K.versions || {};
        t = `trace-digitiser ${(v.packages || {})['trace-digitiser'] || ''} · Tesseract ${v.tesseract || '–'} · in this browser`;
        cls = 'ok';
      }
      el.textContent = t;
      el.className = 'dg-py ' + cls;
      el.title = 'Python and Tesseract run in this page: no picture or value is sent anywhere.';
    }
    async call(fn, args, busyText) {
      const K = MG.kernels.get();
      this.busyText = busyText || '';
      this._pyStatus();
      try {
        const r = await K.call(fn, args || {});
        if (!r.ok) {
          const e = new Error(r.message || r.error || 'Python failed');
          e.kind = r.kind;
          e.traceback = r.traceback;
          throw e;
        }
        return r.result;
      } finally {
        this.busyText = '';
        this._pyStatus();
      }
    }

    /* ================================================================
       opening pictures
       ================================================================ */
    /** open a picture or a PDF (a path of the page's files) */
    async open(path, opts = {}) {
      const p = this.fs.resolve(path);
      if (!this.fs.exists(p)) throw new Error(`There is no file ${path}`);
      if (/\.pdf$/i.test(p)) return this.openPdf(p);
      if (!PICTURE.test(p)) throw new Error(`${p.split('/').pop()} isn’t a picture (PNG, JPEG, TIFF …) or a PDF.`);
      this._cancelPop();
      let img;
      try {
        img = await this._bitmap(p);
      } catch (e) {
        if (!opts.quiet) toast(esc(e.message || String(e)), 'error');
        throw e;
      }
      if (this.img && this.img.close) this.img.close();
      this.img = img;
      this.W = img.width;
      this.H = img.height;
      this.path = p;
      this._pixels = null;
      this.found = null;
      this.result = null;
      this.removed = new Set();
      this.added = [];
      this.compared = null;
      const saved = store.get('dgMarks', {})[p];
      this.marks = Object.assign(EMPTY_MARKS(), saved || {});
      const ex = exampleOf(p);
      if (ex && !saved && EXAMPLE_KIND[ex]) this.setKind(EXAMPLE_KIND[ex], { quiet: true });
      store.set('dgLast', p);
      this.empty.hidden = true;
      this.nameEl.textContent = p.split('/').pop();
      this.nameEl.title = this.fs.pretty(p);
      this.outDir = '~/results/' + stem(p);
      this._renderAll();
      this.fit();
      if (MG.kernels.peek() && MG.kernels.peek().state === 'ready' && this.warm) this.look();
      return p;
    }
    async _bitmap(p) {
      const blob = await this.fs.toBlob(p);
      try {
        return await createImageBitmap(blob);
      } catch (e) {
        // a picture the browser can't show (a TIFF): Python reads it, and sends it as a PNG
        if (!PICTURE.test(p)) throw e;
        toast('Reading the picture with Python (your browser can’t show this kind)…');
        const info = await this.call('dwb.gui.picture', { path: p }, 'Reading the picture…');
        if (!info.png) throw new Error('This picture couldn’t be read.');
        const bytes = Uint8Array.from(atob(info.png), (c) => c.charCodeAt(0));
        return await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      }
    }
    _renderAll() {
      this._renderTools();
      this._renderPicture();
      this._renderFound();
      this._renderKind();
      this._renderMarks();
      this._renderRun();
      this._renderResult();
      this.draw();
    }

    /** the dialog to choose what to open: the examples, your pictures, from your computer */
    openDialog(which) {
      const m = MG.modal('Open a picture of a graph', '');
      const body = m.box.querySelector('.modal-b');
      m.box.classList.add('dg-open-modal');
      const ex = MG.app.exampleFiles.filter((f) => f.path.startsWith(EXDIR + '/') && PICTURE.test(f.path));
      const grid = h('div.dg-thumbs');
      for (const f of ex) {
        const n = f.path.split('/').pop();
        const b = h('button.dg-thumb', { type: 'button', title: f.path }, h('img', { src: f.url, alt: '', loading: 'lazy' }), h('span', n));
        b.addEventListener('click', () => {
          m.close();
          this.open(f.path).catch(() => {});
        });
        grid.appendChild(b);
      }
      const mine = [];
      for (const [p, e] of this.fs.entries) if (e.kind !== 'dir' && p.startsWith(HOME() + '/') && OPENABLE.test(p) && !/\/\.|_overlay\.png$|\/diagnostics\//.test(p)) mine.push(p);
      mine.sort();
      const list = h('div.dg-mine');
      if (mine.length) {
        for (const p of mine.slice(0, 400)) {
          const b = h('button.dg-file', { type: 'button', html: MG.icon(/\.pdf$/i.test(p) ? 'pdf' : 'image') + `<span>${esc(this.fs.pretty(p))}</span>` });
          b.addEventListener('click', () => {
            m.close();
            this.open(p).catch(() => {});
          });
          list.appendChild(b);
        }
      } else list.appendChild(h('p.muted', 'No pictures or PDFs in your files yet.'));
      const up = h('button.btn', { type: 'button', html: MG.icon('upload') + '<span>From my computer…</span>' });
      up.addEventListener('click', () => {
        m.close();
        this.upload();
      });
      const paste = h('button.btn', { type: 'button', html: MG.icon('paste') + '<span>Paste a picture</span>' });
      paste.addEventListener('click', async () => {
        m.close();
        await this.pasteFromClipboard();
      });
      body.append(
        h('h4', 'The examples: the figures of Hearn and Whitmore (2026)'),
        h('p.muted', 'Every value they show is known, so what you digitise can be checked. The Help has a walkthrough for each.'),
        grid,
        h('h4', 'Your pictures and PDFs'),
        list,
        h('div.prompt-actions', up, paste, h('span.grow'))
      );
      if (which === 'examples') setTimeout(() => grid.querySelector('button') && grid.querySelector('button').focus(), 30);
    }
    async upload() {
      const paths = await MG.app.pickFiles(HOME() + '/pictures', false);
      const p = paths.find((x) => OPENABLE.test(x));
      if (p) await this.open(p);
      else if (paths.length) toast('That isn’t a picture or a PDF.', 'warn');
    }
    async _savePicture(blob, name) {
      const dir = HOME() + '/pictures';
      this.fs.mkdirp(dir);
      let p = dir + '/' + name;
      for (let i = 2; this.fs.exists(p); i++) p = dir + '/' + name.replace(/(\.\w+)$/, `-${i}$1`);
      this.fs.put(p, { kind: 'blob', blob, size: blob.size, mtime: Date.now(), fresh: true });
      return p;
    }
    async pasteFromClipboard() {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await it.getType(type);
            return this.open(await this._savePicture(blob, `pasted-${MG.termSession ? MG.termSession.stamp() : Date.now()}.png`));
          }
        }
        toast('There is no picture on the clipboard. Copy one (a screenshot, say), then try again – or press Ctrl+V on this tab.', 'warn', 7000);
      } catch (e) {
        toast('The browser didn’t let the page read the clipboard. Click on the picture area and press Ctrl+V instead.', 'warn', 7000);
      }
    }

    /** a PDF: choose a page, and how sharply to draw it; the page is saved as a picture in ~/pictures */
    async openPdf(p) {
      let doc;
      try {
        doc = await openPdfDoc(await this.fs.readBytes(p));
      } catch (e) {
        toast('This PDF couldn’t be read: ' + esc(e.message || String(e)), 'error');
        return;
      }
      const m = MG.modal(`${p.split('/').pop()}: which page has the figure?`, '');
      m.box.classList.add('dg-open-modal');
      const body = m.box.querySelector('.modal-b');
      const grid = h('div.dg-thumbs.dg-pages');
      const dpiSel = h('select', { 'aria-label': 'Resolution' }, ...[150, 200, 300, 400, 600].map((d) => h('option', { value: String(d), selected: d === 300 }, `${d} dots per inch`)));
      body.append(
        h('p', `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}. Click the page with the figure: it is drawn as a picture, saved in ~/pictures and opened here. Then crop it to the figure with the Crop tool, or mark its plot area.`),
        h('label.dg-inline', 'Draw it at ', dpiSel, h('small.muted', ' (300 is right for most papers; more for a small figure in a scan)')),
        grid
      );
      const thumbs = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const b = h('button.dg-thumb', { type: 'button' }, h('div.dg-page-ph'), h('span', 'Page ' + n));
        b.addEventListener('click', async () => {
          m.close();
          try {
            toast(`Drawing page ${n}…`);
            const c = await renderPage(doc, n, Number(dpiSel.value));
            const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
            c.width = c.height = 0;
            const saved = await this._savePicture(blob, `${stem(p)}-page${n}.png`);
            toast(`Page ${n} is saved as <b>${esc(this.fs.pretty(saved))}</b>.`, 'ok');
            await this.open(saved);
          } catch (e) {
            toast('The page couldn’t be drawn: ' + esc(e.message || String(e)), 'error');
          }
        });
        grid.appendChild(b);
        thumbs.push([n, b]);
      }
      // the thumbnails, a few at a time
      (async () => {
        for (const [n, b] of thumbs) {
          if (!b.isConnected) break;
          try {
            const c = await renderPage(doc, n, 24);
            const img = h('img', { src: c.toDataURL('image/png'), alt: '' });
            b.firstChild.replaceWith(img);
          } catch (e) {
            break;
          }
        }
      })();
    }

    /* ================================================================
       the view: fit, zoom, draw
       ================================================================ */
    _resize() {
      const r = this.stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.cv.width = Math.max(1, Math.round(r.width * dpr));
      this.cv.height = Math.max(1, Math.round(r.height * dpr));
      this.cv.style.width = r.width + 'px';
      this.cv.style.height = r.height + 'px';
      if (this.img && !this._fitted) this.fit();
      else this.draw();
    }
    fit() {
      if (!this.img) return;
      const r = this.stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const s = Math.min((r.width - 24) / this.W, (r.height - 24) / this.H, 4);
      this.view.scale = s > 0 ? s : 1;
      this.view.ox = (r.width - this.W * this.view.scale) / 2;
      this.view.oy = (r.height - this.H * this.view.scale) / 2;
      this._fitted = true;
      this.draw();
    }
    zoomBy(f, cx, cy) {
      if (!this.img) return;
      const r = this.stage.getBoundingClientRect();
      if (cx == null) {
        cx = r.width / 2;
        cy = r.height / 2;
      }
      const s0 = this.view.scale;
      const s = clamp(s0 * f, 0.05, 40);
      this.view.ox = cx - ((cx - this.view.ox) * s) / s0;
      this.view.oy = cy - ((cy - this.view.oy) * s) / s0;
      this.view.scale = s;
      this.draw();
    }
    /** screen (CSS px in the stage) → picture pixels */
    toImg(x, y) {
      return [(x - this.view.ox) / this.view.scale, (y - this.view.oy) / this.view.scale];
    }
    X(x) {
      return this.view.ox + x * this.view.scale;
    }
    Y(y) {
      return this.view.oy + y * this.view.scale;
    }

    draw() {
      const c = this.cv, ctx = c.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      if (!this.img) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = this.view.scale;
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.X(0), this.Y(0), this.W * s, this.H * s);
      ctx.imageSmoothingEnabled = s < 2;
      ctx.drawImage(this.img, this.X(0), this.Y(0), this.W * s, this.H * s);
      this.zoomEl.textContent = Math.round(s * 100) + '%';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (this.show.found) this._drawFound(ctx);
      if (this.show.result) this._drawResult(ctx);
      if (this.show.marks) this._drawMarks(ctx);
      if (this.drag && this.drag.box) {
        const [x0, y0, x1, y1] = this.drag.box;
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = { area: '#16a34a', exclude: '#dc2626', bar: '#7c3aed', crop: '#0f172a' }[this.drag.tool] || '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(this.X(Math.min(x0, x1)), this.Y(Math.min(y0, y1)), Math.abs(x1 - x0) * s, Math.abs(y1 - y0) * s);
        ctx.setLineDash([]);
      }
    }
    _label(ctx, text, x, y, colour, align) {
      ctx.font = '11px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 6;
      const ax = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(ax, y - 8, w, 15);
      ctx.fillStyle = colour;
      ctx.fillText(text, ax + 3, y + 3);
    }
    _box(ctx, b, colour, dash, width) {
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = colour;
      ctx.lineWidth = width || 1.5;
      ctx.strokeRect(this.X(b[0]), this.Y(b[1]), (b[2] - b[0]) * this.view.scale, (b[3] - b[1]) * this.view.scale);
      ctx.setLineDash([]);
    }
    _drawFound(ctx) {
      const F = this.found;
      if (!F) return;
      for (const p of F.panels || []) {
        this._box(ctx, p.plot_area, 'rgba(37,99,235,0.75)', [4, 4], 1.2);
        const [l, t, r, b] = p.plot_area;
        this._label(ctx, 'panel ' + p.panel_id, this.X(l) + 2, this.Y(t) + 10, '#1d4ed8');
        // what was read beside each axis – green if the scale rests on it, grey if not – written just inside the plot
        // area, beside the tick it belongs to, so that the figure's own labels stay in view (not once there is a
        // result: that shows the ticks its scales rest on)
        const ax = (a, where) => {
          if (!a) return;
          for (const lab of a.labels || []) {
            const ok = (a.ticks || []).some(([px]) => Math.abs(px - lab.position) < 2.5);
            const text = lab.text || '?';
            const colour = ok ? '#15803d' : '#64748b';
            if (where === 'y') this._label(ctx, text, this.X(l) + 4, this.Y(lab.position), colour);
            else if (where === 'y2') this._label(ctx, text, this.X(r) - 4, this.Y(lab.position), colour, 'right');
            else this._label(ctx, text, this.X(lab.position), this.Y(b) - 11, colour, 'center');
          }
        };
        if (this.view.scale > 0.35 && !(this.result && this.show.result)) {
          ax(p.y_axis, 'y');
          ax(p.y2_axis, 'y2');
          ax(p.x_axis, 'x');
        }
      }
      if (F.colourbar) this._box(ctx, F.colourbar.box, 'rgba(124,58,237,0.8)', [4, 4], 1.2);
      if (F.polar) {
        const [cx, cy] = F.polar.centre;
        ctx.strokeStyle = 'rgba(37,99,235,0.7)';
        ctx.setLineDash([4, 4]);
        for (const r of (F.polar.rings || []).concat([F.polar.radius])) {
          ctx.beginPath();
          ctx.arc(this.X(cx), this.Y(cy), r * this.view.scale, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    _drawMarks(ctx) {
      const M = this.marks, s = this.view.scale;
      for (const b of M.areas) this._box(ctx, b, '#16a34a', [], 2);
      for (const b of M.exclude) {
        ctx.fillStyle = 'rgba(220,38,38,0.12)';
        ctx.fillRect(this.X(b[0]), this.Y(b[1]), (b[2] - b[0]) * s, (b[3] - b[1]) * s);
        this._box(ctx, b, '#dc2626', [6, 3], 1.5);
      }
      if (M.colourbar) this._box(ctx, M.colourbar, '#7c3aed', [], 2);
      for (const t of M.ticks) {
        ctx.strokeStyle = '#ea580c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (t.axis === 'x') {
          ctx.moveTo(this.X(t.px), this.Y(t.at[1]) - 9);
          ctx.lineTo(this.X(t.px), this.Y(t.at[1]) + 9);
          ctx.stroke();
          this._label(ctx, fmtVal(t.value), this.X(t.px), this.Y(t.at[1]) + 20, '#c2410c', 'center');
        } else {
          ctx.moveTo(this.X(t.at[0]) - 9, this.Y(t.px));
          ctx.lineTo(this.X(t.at[0]) + 9, this.Y(t.px));
          ctx.stroke();
          this._label(ctx, fmtVal(t.value), this.X(t.at[0]) + 12, this.Y(t.px), '#c2410c');
        }
      }
      if (M.centre) {
        const [x, y] = M.centre;
        ctx.strokeStyle = '#ea580c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.X(x) - 10, this.Y(y));
        ctx.lineTo(this.X(x) + 10, this.Y(y));
        ctx.moveTo(this.X(x), this.Y(y) - 10);
        ctx.lineTo(this.X(x), this.Y(y) + 10);
        ctx.stroke();
      }
      const centre = this._centre();
      if (centre)
        for (const r of M.rings) {
          ctx.strokeStyle = '#ea580c';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(this.X(centre[0]), this.Y(centre[1]), r.r * s, 0, 2 * Math.PI);
          ctx.stroke();
          this._label(ctx, fmtVal(r.value), this.X(centre[0] + r.r * 0.7071), this.Y(centre[1] - r.r * 0.7071), '#c2410c');
        }
    }
    _drawResult(ctx) {
      const R = this.result;
      if (!R) return;
      const s = this.view.scale;
      const S = R.shapes || {};
      // the plot areas, and the ticks each axis's scale rests on
      for (const p of R.panels || []) {
        this._box(ctx, p.plot_area, 'rgba(22,163,74,0.9)', [], 1.2);
        const [l, , , b] = p.plot_area;
        if (s > 0.35) {
          for (const [px, v] of (p.y && p.y.ticks) || []) this._label(ctx, fmtVal(v), this.X(l) + 4, this.Y(px), '#15803d');
          for (const [px, v] of (p.x && p.x.ticks) || []) this._label(ctx, fmtVal(v), this.X(px), this.Y(b) - 10, '#15803d', 'center');
        }
      }
      const halo = (draw, colour, w) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = w + 2.5;
        draw();
        ctx.strokeStyle = colour;
        ctx.lineWidth = w;
        draw();
      };
      if (S.traces)
        for (const t of S.traces) {
          const pts = t.points;
          const path = (interp) => {
            ctx.beginPath();
            let on = false;
            for (let i = 0; i < pts.length; i++) {
              const [x, y, it] = pts[i];
              const want = !!it === interp;
              if (!want) {
                on = false;
                continue;
              }
              if (!on) ctx.moveTo(this.X(x), this.Y(y));
              else ctx.lineTo(this.X(x), this.Y(y));
              on = true;
            }
            ctx.stroke();
          };
          halo(() => path(false), '#d946ef', 1.6);
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = '#d946ef';
          ctx.lineWidth = 1.2;
          path(true);
          ctx.setLineDash([]);
        }
      if (S.points) {
        for (const p of S.points) {
          if (p.x == null || p.y == null) continue;
          const gone = this.removed.has(p.i);
          const r = Math.max(3, (p.r || 3) * s + 2);
          for (const [axis, e] of [['x', p.x_err], ['y', p.y_err]]) {
            if (!e || gone) continue;
            halo(() => {
              ctx.beginPath();
              if (axis === 'x') {
                ctx.moveTo(this.X(e[0]), this.Y(p.y));
                ctx.lineTo(this.X(e[1]), this.Y(p.y));
                for (const v of e) {
                  ctx.moveTo(this.X(v), this.Y(p.y) - 4);
                  ctx.lineTo(this.X(v), this.Y(p.y) + 4);
                }
              } else {
                ctx.moveTo(this.X(p.x), this.Y(e[0]));
                ctx.lineTo(this.X(p.x), this.Y(e[1]));
                for (const v of e) {
                  ctx.moveTo(this.X(p.x) - 4, this.Y(v));
                  ctx.lineTo(this.X(p.x) + 4, this.Y(v));
                }
              }
              ctx.stroke();
            }, '#0891b2', 1.3);
          }
          if (gone) {
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.X(p.x) - r, this.Y(p.y) - r);
            ctx.lineTo(this.X(p.x) + r, this.Y(p.y) + r);
            ctx.moveTo(this.X(p.x) + r, this.Y(p.y) - r);
            ctx.lineTo(this.X(p.x) - r, this.Y(p.y) + r);
            ctx.stroke();
          } else
            halo(() => {
              ctx.beginPath();
              ctx.arc(this.X(p.x), this.Y(p.y), r, 0, 2 * Math.PI);
              ctx.stroke();
            }, '#d946ef', 1.6);
        }
        for (const [x, y] of this.added)
          halo(() => {
            ctx.beginPath();
            ctx.arc(this.X(x), this.Y(y), 6, 0, 2 * Math.PI);
            ctx.moveTo(this.X(x) - 3, this.Y(y));
            ctx.lineTo(this.X(x) + 3, this.Y(y));
            ctx.moveTo(this.X(x), this.Y(y) - 3);
            ctx.lineTo(this.X(x), this.Y(y) + 3);
            ctx.stroke();
          }, '#0891b2', 2);
      }
      if (S.polar && S.polar.centre) {
        const [cx, cy] = S.polar.centre;
        ctx.strokeStyle = 'rgba(22,163,74,0.8)';
        ctx.lineWidth = 1;
        for (const r of (S.polar.rings || []).concat(S.polar.outer_radius ? [S.polar.outer_radius] : [])) {
          ctx.beginPath();
          ctx.arc(this.X(cx), this.Y(cy), r * s, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
      if (S.bars)
        for (const b of S.bars) {
          if (b.start == null || b.end == null) continue;
          halo(() => {
            if (S.horizontal) ctx.strokeRect(this.X(Math.min(b.start, b.end)), this.Y(b.top), Math.abs(b.end - b.start) * s, (b.bottom - b.top) * s);
            else ctx.strokeRect(this.X(b.left), this.Y(Math.min(b.start, b.end)), (b.right - b.left) * s, Math.abs(b.end - b.start) * s);
          }, '#d946ef', 1.6);
          if (b.err) {
            const mid = S.horizontal ? (b.top + b.bottom) / 2 : (b.left + b.right) / 2;
            halo(() => {
              ctx.beginPath();
              if (S.horizontal) {
                ctx.moveTo(this.X(b.err[0]), this.Y(mid));
                ctx.lineTo(this.X(b.err[1]), this.Y(mid));
              } else {
                ctx.moveTo(this.X(mid), this.Y(b.err[0]));
                ctx.lineTo(this.X(mid), this.Y(b.err[1]));
                for (const v of b.err) {
                  ctx.moveTo(this.X(mid) - 5, this.Y(v));
                  ctx.lineTo(this.X(mid) + 5, this.Y(v));
                }
              }
              ctx.stroke();
            }, '#0891b2', 1.4);
          }
        }
      if (S.rows)
        for (const row of S.rows) {
          const pts = row.points.filter((q) => q[1] != null);
          if (!pts.length) continue;
          ctx.strokeStyle = 'rgba(22,163,74,0.8)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(this.X(pts[0][0]), this.Y(row.baseline));
          ctx.lineTo(this.X(pts[pts.length - 1][0]), this.Y(row.baseline));
          ctx.stroke();
          halo(() => {
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(this.X(x), this.Y(y)) : ctx.moveTo(this.X(x), this.Y(y))));
            ctx.stroke();
          }, '#d946ef', row.binned ? 2 : 1.2);
          for (const x of row.dots || []) {
            ctx.strokeStyle = '#0891b2';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.X(x), this.Y(row.baseline), 4, 0, 2 * Math.PI);
            ctx.stroke();
          }
        }
      if (S.cells && s >= 1.5) {
        // the centre of each cell, when there is room to see them
        ctx.fillStyle = 'rgba(217,70,239,0.85)';
        const lo = this.toImg(0, 0), hi = this.toImg(this.cv.clientWidth, this.cv.clientHeight);
        for (const [x, y] of S.cells) {
          if (x < lo[0] || y < lo[1] || x > hi[0] || y > hi[1]) continue;
          ctx.fillRect(this.X(x) - 1, this.Y(y) - 1, 2, 2);
        }
      }
      if (S.colour_scale && S.colour_scale.box) this._box(ctx, S.colour_scale.box, '#7c3aed', [], 1.5);
    }

    /* the loupe: the picture under the cursor, 8 times bigger, with the place a click would mark */
    _drawLoupe(ix, iy, snapped) {
      const L = this.loupe, ctx = L.getContext('2d');
      const n = 16, z = L.width / n;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, L.width, L.height);
      ctx.drawImage(this.img, Math.floor(ix) - n / 2, Math.floor(iy) - n / 2, n, n, 0, 0, L.width, L.height);
      ctx.strokeStyle = 'rgba(15,23,42,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const cx = (ix - (Math.floor(ix) - n / 2)) * z, cy = (iy - (Math.floor(iy) - n / 2)) * z;
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, L.height);
      ctx.moveTo(0, cy);
      ctx.lineTo(L.width, cy);
      ctx.stroke();
      if (snapped) {
        ctx.strokeStyle = '#ea580c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (snapped.axis === 'x') {
          const sx = (snapped.px - (Math.floor(ix) - n / 2)) * z;
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, L.height);
        } else if (snapped.axis === 'y') {
          const sy = (snapped.px - (Math.floor(iy) - n / 2)) * z;
          ctx.moveTo(0, sy);
          ctx.lineTo(L.width, sy);
        }
        ctx.stroke();
      }
    }

    /* the colour of the picture at a pixel (the picture's own pixels, read once) */
    _pixel(x, y) {
      if (!this.img) return null;
      if (!this._pixels) {
        const c = document.createElement('canvas');
        c.width = this.W;
        c.height = this.H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.drawImage(this.img, 0, 0);
        try {
          this._pixels = ctx.getImageData(0, 0, this.W, this.H).data;
        } catch (e) {
          this._pixels = new Uint8ClampedArray(this.W * this.H * 4);
        }
        c.width = c.height = 0;
      }
      x = Math.floor(x);
      y = Math.floor(y);
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return null;
      const i = (y * this.W + x) * 4;
      return [this._pixels[i], this._pixels[i + 1], this._pixels[i + 2]];
    }
    /** the colour drawn near a click: the darkest, most coloured pixel of the 5×5 around it, as that is what was
        drawn there (rather than the paper, or the anti-aliased edge of a line) */
    _pickColour(x, y) {
      let best = null, score = -1;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const c = this._pixel(x + dx, y + dy);
          if (!c) continue;
          const mx = Math.max(...c), mn = Math.min(...c);
          const sc = (mx - mn) * 2 + (255 - mx) - Math.hypot(dx, dy) * 6;
          if (sc > score) {
            score = sc;
            best = c;
          }
        }
      return best;
    }

    /* ================================================================
       the mouse and the keyboard
       ================================================================ */
    _events() {
      const S = this.stage;
      const pos = (e) => {
        const r = S.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      S.addEventListener('pointerdown', (e) => {
        if (!this.img || e.button === 2) return;
        S.focus({ preventScroll: true });
        const [sx, sy] = pos(e);
        const [ix, iy] = this.toImg(sx, sy);
        const panning = this.tool === 'pan' || e.button === 1 || this._space;
        S.setPointerCapture(e.pointerId);
        if (panning) {
          this.drag = { pan: true, sx, sy, ox: this.view.ox, oy: this.view.oy };
          S.classList.add('panning');
          return;
        }
        if (['area', 'exclude', 'bar', 'crop'].includes(this.tool)) {
          const [x, y] = this._snapPoint(ix, iy);
          this.drag = { tool: this.tool, box: [x, y, x, y] };
          return;
        }
        this.drag = { click: true, sx, sy, ix, iy };
      });
      S.addEventListener('pointermove', (e) => {
        if (!this.img) return;
        const [sx, sy] = pos(e);
        const [ix, iy] = this.toImg(sx, sy);
        if (this.drag && this.drag.pan) {
          this.view.ox = this.drag.ox + sx - this.drag.sx;
          this.view.oy = this.drag.oy + sy - this.drag.sy;
          this.draw();
          return;
        }
        if (this.drag && this.drag.box) {
          const [x, y] = this._snapPoint(ix, iy);
          this.drag.box[2] = x;
          this.drag.box[3] = y;
          this.draw();
        }
        this._hover(ix, iy);
      });
      const up = (e) => {
        const d = this.drag;
        this.drag = null;
        S.classList.remove('panning');
        if (!d || !this.img) return;
        if (d.box) {
          const [x0, y0, x1, y1] = d.box;
          const b = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)].map((v) => round(clamp(v, 0, Math.max(this.W, this.H)), 1));
          this.draw();
          if (b[2] - b[0] < 4 || b[3] - b[1] < 4) return;
          this._boxDone(d.tool, b);
          return;
        }
        if (d.click) {
          const [sx, sy] = pos(e);
          if (Math.hypot(sx - d.sx, sy - d.sy) > 6) return;
          this._clickTool(d.ix, d.iy, sx, sy);
        }
      };
      S.addEventListener('pointerup', up);
      S.addEventListener('pointercancel', () => {
        this.drag = null;
        S.classList.remove('panning');
        this.draw();
      });
      S.addEventListener('pointerleave', () => {
        this._hint(TOOLS[this.tool] ? TOOLS[this.tool][2] : '');
      });
      S.addEventListener(
        'wheel',
        (e) => {
          if (!this.img) return;
          e.preventDefault();
          const [sx, sy] = pos(e);
          this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), sx, sy);
        },
        { passive: false }
      );
      S.addEventListener('keydown', (e) => {
        if (e.target !== S) return;
        if (e.key === '+' || e.key === '=') this.zoomBy(1.4);
        else if (e.key === '-') this.zoomBy(1 / 1.4);
        else if (e.key === '0') this.fit();
        else if (e.key === 'Escape') {
          this._cancelPop();
          this.setTool('pan');
        } else if (e.key === ' ') {
          this._space = true;
          e.preventDefault();
        } else return;
      });
      S.addEventListener('keyup', (e) => {
        if (e.key === ' ') this._space = false;
      });
      // paste a picture, drop a file
      this.root.addEventListener('paste', async (e) => {
        if (/input|textarea/i.test((e.target && e.target.tagName) || '')) return;
        const f = Array.from((e.clipboardData && e.clipboardData.files) || []).find((x) => x.type.startsWith('image/'));
        if (!f) return;
        e.preventDefault();
        await this.open(await this._savePicture(f, `pasted-${MG.termSession ? MG.termSession.stamp() : Date.now()}.png`));
      });
      S.addEventListener('dragover', (e) => {
        e.preventDefault();
        S.classList.add('drop');
      });
      S.addEventListener('dragleave', () => S.classList.remove('drop'));
      S.addEventListener('drop', async (e) => {
        e.preventDefault();
        S.classList.remove('drop');
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (!files.length) return;
        const paths = await MG.project.addFiles(this.fs, HOME() + '/pictures', files);
        const p = paths.find((x) => OPENABLE.test(x));
        if (p) await this.open(p);
      });
    }

    /** where the mouse is: its pixel, the value there, the colour */
    _hover(ix, iy) {
      const parts = [`x ${Math.round(ix)}, y ${Math.round(iy)}`];
      const v = this.valueAt(ix, iy);
      if (v) parts.push(v);
      const c = this._pixel(ix, iy);
      if (c) parts.push(hex(...c));
      if (this.result && this.result.shapes && this.result.shapes.cells) {
        const cell = this._nearestCell(ix, iy);
        if (cell) parts.push('cell ' + fmtVal(cell[2]));
      }
      this._hint(parts.join(' · '));
      if (!this.loupe.hidden) this._drawLoupe(ix, iy, this.tool === 'tick' ? this._tickAt(ix, iy) : null);
    }
    _nearestCell(ix, iy) {
      const S = this.result.shapes;
      const [cw, ch] = S.cell_size || [2, 2];
      let best = null, bd = Infinity;
      for (const c of S.cells) {
        const dx = Math.abs(c[0] - ix), dy = Math.abs(c[1] - iy);
        if (dx > cw || dy > ch) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    }

    /** the scales the page knows: the ticks marked, else the last run's, else what describe read */
    _scales(ix, iy) {
      const out = { x: null, y: null, panel: null };
      const fitTicks = (axis) => {
        const ts = this.marks.ticks.filter((t) => t.axis === axis);
        if (ts.length < 2) return null;
        const log = (axis === 'x' ? this.axisOpts.x_scale : this.axisOpts.y_scale) === 'log';
        const xs = ts.map((t) => t.px), ys = ts.map((t) => (log ? Math.log10(t.value) : t.value));
        const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
        let sxx = 0, sxy = 0;
        for (let i = 0; i < n; i++) {
          sxx += (xs[i] - mx) ** 2;
          sxy += (xs[i] - mx) * (ys[i] - my);
        }
        if (!sxx) return null;
        const a = sxy / sxx;
        return { a, b: my - a * mx, log, calibrated: true };
      };
      const inside = (pa) => ix >= pa[0] - 3 && ix <= pa[2] + 3 && iy >= pa[1] - 3 && iy <= pa[3] + 3;
      if (this.result && this.result.panels) {
        const p = this.result.panels.find((q) => inside(q.plot_area));
        if (p) {
          out.panel = p.panel_id;
          out.x = p.x;
          out.y = p.y;
        }
      } else if (this.found) {
        const p = (this.found.panels || []).find((q) => inside(q.plot_area));
        if (p) {
          out.panel = p.panel_id;
          const conv = (a) => (a && a.usable && a.a != null ? { a: a.a, b: a.b, log: a.scale === 'log', calibrated: true } : null);
          out.x = conv(p.x_axis);
          out.y = conv(this.axisOpts.y_axis === 'right' ? p.y2_axis : p.y_axis);
        }
      }
      out.x = fitTicks('x') || out.x;
      out.y = fitTicks('y') || out.y;
      return out;
    }
    valueAt(ix, iy) {
      const polar = this.result && this.result.shapes && this.result.shapes.polar;
      if (polar && polar.centre) {
        const [cx, cy] = polar.centre;
        const dx = ix - cx, dy = cy - iy;
        const d = Math.hypot(dx, dy);
        let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        ang = (ang - { east: 0, north: 90, west: 180, south: 270 }[polar.zero || 'east'] + 720) % 360;
        if (polar.clockwise) ang = (360 - ang) % 360;
        const rs = polar.radial_scale || {};
        return `angle ${fmtVal(ang)}°, r ${fmtVal((rs.a == null ? 1 : rs.a) * d + (rs.b || 0))}`;
      }
      const sc = this._scales(ix, iy);
      const val = (c, px) => (c && c.calibrated !== false ? (c.log ? 10 ** (c.a * px + c.b) : c.a * px + c.b) : null);
      const xv = val(sc.x, ix), yv = val(sc.y, iy);
      if (xv == null && yv == null) return '';
      return `value (${fmtVal(xv)}, ${fmtVal(yv)})` + (sc.panel ? ` in panel ${sc.panel}` : '');
    }

    /* snapping: a box's corner to the axis lines found nearby */
    _snapPoint(ix, iy) {
      const tol = 6 / this.view.scale;
      let x = ix, y = iy;
      const lines = { x: [], y: [] };
      for (const p of (this.found && this.found.panels) || []) {
        lines.x.push(p.plot_area[0], p.plot_area[2]);
        lines.y.push(p.plot_area[1], p.plot_area[3]);
      }
      if (this.found && this.found.colourbar) {
        const b = this.found.colourbar.box;
        lines.x.push(b[0], b[2]);
        lines.y.push(b[1], b[3]);
      }
      if (['area', 'bar'].includes(this.tool)) {
        let bx = null, by = null;
        for (const v of lines.x) if (Math.abs(v - ix) <= tol && (bx == null || Math.abs(v - ix) < Math.abs(bx - ix))) bx = v;
        for (const v of lines.y) if (Math.abs(v - iy) <= tol && (by == null || Math.abs(v - iy) < Math.abs(by - iy))) by = v;
        if (bx != null) x = bx;
        if (by != null) y = by;
      }
      return [round(x, 1), round(y, 1)];
    }
    /** the tick a click near an axis is for: {axis, px, side, guess} – snapped to a tick mark (or label) found */
    _tickAt(ix, iy) {
      // which plot area, and which of its axes, the click is beside
      const areas = this.marks.areas.length ? this.marks.areas : ((this.found && this.found.panels) || []).map((p) => p.plot_area);
      const tol = 10 / this.view.scale;
      let best = null;
      for (const [l, t, r, b] of areas) {
        const nearX = ix >= l - tol && ix <= r + tol && iy >= b - tol;
        const leftY = iy >= t - tol && iy <= b + tol && ix <= l + tol;
        const rightY = iy >= t - tol && iy <= b + tol && ix >= r - tol;
        const cands = [];
        if (nearX) cands.push({ axis: 'x', side: 'bottom', d: Math.abs(iy - b), area: [l, t, r, b] });
        if (leftY) cands.push({ axis: 'y', side: 'left', d: Math.abs(ix - l), area: [l, t, r, b] });
        if (rightY) cands.push({ axis: 'y', side: 'right', d: Math.abs(ix - r), area: [l, t, r, b] });
        for (const c of cands) if (!best || c.d < best.d) best = c;
      }
      if (!best) {
        // no plot area yet: the nearer of the two directions
        best = { axis: 'free', side: '' };
        return { axis: 'x', px: round(ix, 1), side: 'bottom', guess: null, free: true };
      }
      const pos = best.axis === 'x' ? ix : iy;
      // the tick marks and labels found beside that axis
      const marks = [];
      for (const p of (this.found && this.found.panels) || []) {
        const pa = p.plot_area;
        if (Math.abs(pa[0] - best.area[0]) > 4 || Math.abs(pa[2] - best.area[2]) > 4 || Math.abs(pa[1] - best.area[1]) > 4 || Math.abs(pa[3] - best.area[3]) > 4) continue;
        if (best.axis === 'x') {
          for (const v of p.tick_marks.x || []) marks.push({ px: v });
          for (const lab of (p.x_axis && p.x_axis.labels) || []) marks.push({ px: lab.position, label: lab });
        } else if (best.side === 'left') {
          for (const v of p.tick_marks.y || []) marks.push({ px: v });
          for (const lab of (p.y_axis && p.y_axis.labels) || []) marks.push({ px: lab.position, label: lab });
        } else for (const lab of (p.y2_axis && p.y2_axis.labels) || []) marks.push({ px: lab.position, label: lab });
      }
      let snap = null;
      for (const m of marks) if (Math.abs(m.px - pos) <= tol && (!snap || Math.abs(m.px - pos) < Math.abs(snap.px - pos))) snap = m;
      const px = snap ? snap.px : pos;
      // a value read there, to offer
      let guess = null;
      for (const m of marks) if (m.label && Math.abs(m.px - px) <= 3 && m.label.values && m.label.values.length) guess = m.label.values[0];
      return { axis: best.axis, px: round(px, 2), side: best.side, guess, snapped: !!snap };
    }

    _clickTool(ix, iy, sx, sy) {
      const t = this.tool;
      if (t === 'colour') {
        const c = this._pickColour(ix, iy);
        if (!c) return;
        const hx = hex(...c);
        if (Math.max(...c) > 235 && Math.min(...c) > 235) {
          toast('That is the paper (white): click on the line, point or bar itself. Zoom in if it is thin.', 'warn');
          return;
        }
        const same = this.marks.colours.findIndex((x) => dist3(rgbOf(x), c) < 30);
        if (same >= 0) this.marks.colours[same] = hx;
        else this.marks.colours.push(hx);
        this._marksChanged();
        toast(`Colour <span class="dg-chip" style="background:${hx}"></span> <b>${hx}</b> picked.`, 'ok', 1800);
      } else if (t === 'tick') {
        const k = this._tickAt(ix, iy);
        if (k.free) {
          toast('Mark a plot area first (or Look at the figure), so that it is clear which axis a tick is on.', 'warn', 6000);
          return;
        }
        this._ask(sx, sy, `${k.axis === 'x' ? 'x' : k.side === 'right' ? 'right-hand y' : 'y'} value of this tick${k.snapped ? '' : ' (no tick mark found here: zoom in to place it exactly)'}`, k.guess != null ? String(k.guess) : '', (v) => {
          const value = num(v);
          if (value == null) return toast('Type a number, such as 1975 or 0.25.', 'warn');
          if (k.side === 'right' && this.axisOpts.y_axis !== 'right' && this.marks.ticks.some((q) => q.axis === 'y' && q.side === 'left')) toast('There are ticks on both y axes now: the values will be read against one of them only. Take out those of the other.', 'warn', 8000);
          this.marks.ticks = this.marks.ticks.filter((q) => !(q.axis === k.axis && Math.abs(q.px - k.px) < 1.5));
          this.marks.ticks.push({ axis: k.axis, px: k.px, value, side: k.side, at: [round(ix, 1), round(iy, 1)] });
          this._marksChanged();
        });
      } else if (t === 'centre') {
        let c = [round(ix, 2), round(iy, 2)];
        const F = this.found && this.found.polar;
        if (F && Math.hypot(F.centre[0] - ix, F.centre[1] - iy) < 8 / this.view.scale) c = F.centre.slice();
        this.marks.centre = c;
        this._marksChanged();
      } else if (t === 'ring') {
        const centre = this._centre();
        if (!centre) return toast('Click on the centre first (Centre), or Look at the figure to find it.', 'warn');
        let r = Math.hypot(ix - centre[0], iy - centre[1]);
        const rings = ((this.found && this.found.polar && this.found.polar.rings) || []).concat(this.found && this.found.polar ? [this.found.polar.radius] : []);
        let snapped = false;
        for (const q of rings)
          if (Math.abs(q - r) < 8 / this.view.scale) {
            r = q;
            snapped = true;
          }
        this._ask(sx, sy, `The value of this ring${snapped ? '' : ' (no ring found here)'}`, '', (v) => {
          const value = num(v);
          if (value == null) return toast('Type a number, such as 1965.', 'warn');
          this.marks.rings = this.marks.rings.filter((q) => Math.abs(q.r - r) > 1.5);
          this.marks.rings.push({ r: round(r, 2), value });
          this._marksChanged();
        });
      } else if (t === 'edit') this._editAt(ix, iy);
    }
    _centre() {
      if (this.marks.centre) return this.marks.centre;
      if (this.found && this.found.polar) return this.found.polar.centre;
      return null;
    }
    _boxDone(tool, b) {
      if (tool === 'area') this.marks.areas.push(b);
      else if (tool === 'exclude') this.marks.exclude.push(b);
      else if (tool === 'bar') this.marks.colourbar = b;
      else if (tool === 'crop') return this._crop(b);
      this._marksChanged();
    }
    async _crop(b) {
      const ok = await MG.confirmBox('Crop the picture?', `<p>Keep the part inside the box (${b.map((v) => Math.round(v)).join(', ')}), as a new picture in ~/pictures, and open it here? The picture itself is left as it is.</p>`, 'Crop');
      if (!ok) return;
      try {
        const r = await this.call('dwb.gui.crop', { path: this.path, box: b }, 'Cropping…');
        await this.open(r.path);
        toast(`Saved as <b>${esc(this.fs.pretty(r.path))}</b>.`, 'ok');
      } catch (e) {
        toast(esc(e.message), 'error');
      }
    }

    /** a small box for a value, beside the click */
    _ask(sx, sy, label, def, done) {
      this._cancelPop();
      const P = this.pop;
      const input = h('input', { type: 'text', inputmode: 'decimal', value: def, 'aria-label': label, spellcheck: 'false' });
      const ok = h('button.btn.primary.sm', { type: 'submit' }, 'OK');
      const no = h('button.btn.sm', { type: 'button' }, 'Cancel');
      const form = h('form', h('label', label), h('div.dg-pop-row', input, ok, no));
      P.innerHTML = '';
      P.appendChild(form);
      P.hidden = false;
      const r = this.stage.getBoundingClientRect();
      P.style.left = clamp(sx + 12, 4, r.width - 270) + 'px';
      P.style.top = clamp(sy + 12, 4, r.height - 90) + 'px';
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value;
        this._cancelPop();
        done(v);
      });
      no.addEventListener('click', () => this._cancelPop());
      input.addEventListener('keydown', (e) => e.key === 'Escape' && (e.preventDefault(), this._cancelPop()));
      setTimeout(() => {
        input.focus();
        input.select();
      }, 10);
    }
    _cancelPop() {
      this.pop.hidden = true;
      this.pop.innerHTML = '';
    }

    /* ================================================================
       the marks
       ================================================================ */
    _marksChanged() {
      const all = store.get('dgMarks', {});
      if (this.path) {
        all[this.path] = this.marks;
        // (the marks of the 40 pictures opened last are kept)
        const keys = Object.keys(all);
        if (keys.length > 40) delete all[keys[0]];
        store.set('dgMarks', all);
      }
      this._renderMarks();
      this.draw();
    }
    _renderMarks() {
      const S = this.secMarks, M = this.marks;
      S.innerHTML = '';
      S.appendChild(h('h3', 'Your marks'));
      const list = h('ul.dg-marks');
      const row = (icon, text, title, remove, colour) => {
        const x = h('button.icon-btn.sm', { type: 'button', title: 'Take this out', 'aria-label': 'Take out: ' + text, html: MG.icon('x') });
        x.addEventListener('click', () => {
          remove();
          this._marksChanged();
        });
        const li = h('li', { title: title || '' }, h('span.dg-mi', { html: MG.icon(icon) }), colour ? h('span.dg-chip', { style: { background: colour } }) : null, h('span.dg-mt', text), x);
        list.appendChild(li);
      };
      const bx = (b) => b.map((v) => Math.round(v)).join(', ');
      if (this.kind !== 'polar') {
        M.areas.forEach((b, i) => row('boxsel', 'Plot area ' + bx(b), 'Pixels: left, top, right, bottom', () => M.areas.splice(i, 1)));
        M.exclude.forEach((b, i) => row('ban', 'Left out ' + bx(b), 'Pixels: left, top, right, bottom', () => M.exclude.splice(i, 1)));
        M.ticks
          .slice()
          .sort((a, b) => (a.axis + a.side).localeCompare(b.axis + b.side) || a.px - b.px)
          .forEach((t) => row('crosshair', `${t.axis === 'x' ? 'x' : t.side === 'right' ? 'right y' : 'y'} tick at ${round(t.px, 1)} = ${fmtVal(t.value)}`, `The ${t.axis === 'x' ? 'column' : 'row'} of the tick, and its value`, () => (M.ticks = M.ticks.filter((q) => q !== t))));
      }
      if (this.kind === 'heatmap' && M.colourbar) row('heatmap', 'Colour bar ' + bx(M.colourbar), '', () => (M.colourbar = null));
      if (this.kind === 'polar') {
        if (M.centre) row('target', 'Centre ' + M.centre.map((v) => round(v, 1)).join(', '), '', () => (M.centre = null));
        M.rings.forEach((r, i) => row('polar', `Ring at ${round(r.r, 1)} px = ${fmtVal(r.value)}`, '', () => M.rings.splice(i, 1)));
      }
      M.colours.forEach((c, i) => row('pipette', c, 'A colour to read', () => M.colours.splice(i, 1), c));
      if (!list.children.length) S.appendChild(h('p.muted.sm', 'None yet. What trace-digitiser finds by itself is often enough: Digitise, look at the result, and mark only what it got wrong. The tools are above the picture.'));
      else {
        S.appendChild(list);
        const clear = h('button.btn.sm', { type: 'button', html: MG.icon('trash') + '<span>Take them all out</span>' });
        clear.addEventListener('click', () => {
          this.marks = EMPTY_MARKS();
          this._marksChanged();
        });
        S.appendChild(clear);
      }
      const ticks = (axis) => M.ticks.filter((t) => t.axis === axis).length;
      if (this.kind !== 'polar' && (ticks('x') === 1 || ticks('y') === 1)) S.appendChild(h('p.dg-warn', 'One tick on an axis is not enough: mark a second, as far from the first as you can.'));
    }

    /* ================================================================
       the picture, and what was found in it
       ================================================================ */
    _renderPicture() {
      const S = this.secPicture;
      S.innerHTML = '';
      if (!this.path) {
        S.append(h('h3', 'The picture'), h('p.muted.sm', 'Nothing is open yet.'));
        return;
      }
      S.append(h('h3', 'The picture'), h('p.sm', h('b', this.path.split('/').pop()), ` – ${this.W} × ${this.H} pixels`, h('br'), h('span.muted', this.fs.pretty(MG.path.dirname(this.path)))));
      const F = this.found;
      if (F && Math.abs(F.tilt_degrees || 0) >= 0.15) {
        const b = h('button.btn.sm.primary', { type: 'button', html: MG.icon('rotate') + '<span>Straighten it</span>' });
        b.addEventListener('click', () => this.straighten(F.tilt_degrees));
        S.append(h('div.dg-note', h('p', `It is tilted ${Math.abs(F.tilt_degrees).toFixed(2)}° ${F.tilt_degrees > 0 ? 'anticlockwise' : 'clockwise'} (a scan?). Values read from a tilted picture are less accurate: straighten it first, which saves an upright copy in ~/pictures.`), b));
      }
      const ex = exampleOf(this.path);
      if (ex) S.append(h('p.sm.muted', 'One of the examples: its values are known (Help: The examples).'));
    }
    async straighten(deg) {
      try {
        const r = await this.call('dwb.gui.straighten', { path: this.path, degrees: deg }, 'Straightening…');
        await this.open(r.path);
        toast(`Turned upright by ${Math.abs(r.degrees).toFixed(2)}° and saved as <b>${esc(this.fs.pretty(r.path))}</b>.`, 'ok', 6000);
      } catch (e) {
        toast(esc(e.message), 'error');
      }
    }
    /** ask trace-digitiser what it finds in the picture */
    async look() {
      if (!this.path || this.looking) return;
      const p = this.path;
      this.looking = true;
      this._renderFound();
      try {
        const r = await this.call('dwb.gui.describe', { path: p, plot_area: this.marks.areas.length ? this.marks.areas : null, ocr: this.axisOpts.ocr }, 'Looking at the figure (reading its axes)…');
        if (p !== this.path) return;
        this.found = r;
        if (!store.get('dgMarks', {})[p] && !exampleOf(p) && r.suggest) this.setKind(r.suggest, { quiet: true });
      } catch (e) {
        if (p === this.path) this.foundError = e.message || String(e);
      } finally {
        this.looking = false;
        if (p === this.path) {
          this._renderPicture();
          this._renderFound();
          this.draw();
        }
      }
    }
    _renderFound() {
      const S = this.secFound;
      S.innerHTML = '';
      const head = h('h3', 'What trace-digitiser sees');
      S.appendChild(head);
      if (!this.path) return;
      const again = h('button.btn.sm', { type: 'button', title: 'Look again – with your plot areas, if you have marked any', html: MG.icon('eye') + '<span>Look again</span>' });
      again.addEventListener('click', () => this.look());
      if (this.looking) {
        S.appendChild(h('p.sm.muted', h('span.spin', { html: MG.icon('spin') }), ' Looking at the figure: finding its plot areas, reading its axes…'));
        return;
      }
      const F = this.found;
      if (!F) {
        const K = MG.kernels.peek();
        S.appendChild(h('p.sm.muted', this.foundError ? 'It couldn’t look at the figure: ' + this.foundError : K && K.state === 'ready' ? '' : 'Once Python has started, it looks at the figure.'));
        if (K && K.state === 'ready') S.appendChild(again);
        return;
      }
      const L = h('div.dg-found');
      if (!F.panels.length && !F.polar) L.appendChild(h('p.sm', 'No plot area was found: mark one with the Plot area tool.'));
      for (const p of F.panels) {
        const axis = (a, name) => {
          if (!a) return h('li', `${name}: no labels found`);
          const read = (a.labels || []).filter((l) => l.text).map((l) => l.text);
          if (a.scale && a.usable) return h('li', `${name}: ${a.ticks.length} labels agree (${a.ticks.map((t) => fmtVal(t[1])).slice(0, 6).join(', ')}${a.ticks.length > 6 ? ' …' : ''}), ${a.scale}, ${a.confidence} confidence`);
          return h('li', `${name}: ${(a.labels || []).length} labels found` + (read.length ? `, read as ${read.slice(0, 5).join(', ')}${read.length > 5 ? ' …' : ''} – no scale` : ', none could be read'));
        };
        const use = h('button.btn.sm', { type: 'button', title: 'Add this plot area to your marks (to change it, or to read only this panel)', html: MG.icon('boxsel') + '<span>Use</span>' });
        use.addEventListener('click', () => {
          this.marks.areas.push(p.plot_area.slice());
          this._marksChanged();
        });
        const cols = h('span.dg-chips');
        for (const c of p.colours || []) {
          const chip = h('button.dg-chip.btnchip', { type: 'button', style: { background: c.hex }, title: `${c.hex} (${c.pixels} pixels${c.kind === 'achromatic' ? ', black or grey' : ''}) – click to read only this colour` });
          chip.addEventListener('click', () => {
            if (!this.marks.colours.includes(c.hex)) this.marks.colours.push(c.hex);
            this._marksChanged();
          });
          cols.appendChild(chip);
        }
        L.appendChild(
          h('div.dg-fp',
            h('div.dg-fp-h', h('b', `Panel ${p.panel_id}`), h('span.muted', ` ${p.plot_area.map((v) => Math.round(v)).join(', ')}`), h('span.grow'), use),
            h('ul.sm', F.ocr ? [axis(p.y_axis, 'y axis'), p.y2_axis && (p.y2_axis.labels || []).length ? axis(p.y2_axis, 'right-hand y axis') : null, axis(p.x_axis, 'x axis')] : h('li', 'Axis labels not read (OCR off)'), (p.colours || []).length ? h('li', 'Colours: ', cols) : null)
          )
        );
      }
      if (F.colourbar) L.appendChild(h('p.sm', 'A colour bar at ' + F.colourbar.box.map((v) => Math.round(v)).join(', ')));
      if (F.polar) L.appendChild(h('p.sm', `Polar axes: centre ${F.polar.centre.map((v) => Math.round(v)).join(', ')}, ${F.polar.rings.length} rings`));
      S.append(L, h('p.sm.muted', 'Drawn over the picture in blue: what each label was read as (green where the scale rests on it).'), again);
    }

    /* ================================================================
       the kind of figure, and its options
       ================================================================ */
    setKind(k, opts = {}) {
      if (!KIND_NAME[k]) return;
      this.kind = k;
      store.set('dgKind', k);
      this._renderTools();
      this._renderKind();
      this._renderMarks();
      this._renderRun();
      if (!opts.quiet) this.draw();
    }
    _field(label, input, hint) {
      return h('label.dg-field', h('span.dg-fl', label), input, hint ? h('small.muted', hint) : null);
    }
    _input(obj, key, attrs = {}) {
      const el = h('input', Object.assign({ type: 'text', value: obj[key] == null ? '' : String(obj[key]), spellcheck: 'false' }, attrs));
      el.addEventListener('input', () => {
        obj[key] = el.value;
        this._optsChanged();
      });
      return el;
    }
    _select(obj, key, choices) {
      const el = h('select', ...choices.map(([v, t]) => h('option', { value: v, selected: String(obj[key]) === String(v) }, t)));
      el.addEventListener('change', () => {
        obj[key] = el.value === 'true' ? true : el.value === 'false' ? false : el.value;
        this._optsChanged();
      });
      return el;
    }
    _check(obj, key, label) {
      const el = h('input', { type: 'checkbox', checked: !!obj[key] });
      el.addEventListener('change', () => {
        obj[key] = el.checked;
        this._optsChanged();
      });
      return h('label.check.sm', el, ' ' + label);
    }
    _optsChanged() {
      store.set('dgOpts', this.opts);
    }
    _renderKind() {
      const S = this.secKind;
      S.innerHTML = '';
      S.appendChild(h('h3', 'What kind of figure'));
      const seg = h('div.dg-kinds', { role: 'radiogroup', 'aria-label': 'Kind of figure' });
      for (const [k, name, icon, title] of KINDS) {
        const b = h('button.dg-kind' + (k === this.kind ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': k === this.kind ? 'true' : 'false', title, html: MG.icon(icon) + `<span>${esc(name)}</span>` });
        b.addEventListener('click', () => this.setKind(k));
        seg.appendChild(b);
      }
      S.appendChild(seg);
      S.appendChild(h('p.sm.muted', KINDS.find((x) => x[0] === this.kind)[3]));
      const o = this.opts[this.kind];
      const F = h('div.dg-fields');
      const colourNote = () => (this.marks.colours.length ? `Reading ${this.marks.colours.length} colour${this.marks.colours.length > 1 ? 's' : ''} you picked.` : 'Every colour drawn is tried; pick colours (Colour tool) to read only those.');
      if (this.kind === 'lines') {
        F.append(h('p.sm', colourNote()), this._field('Black or grey lines', this._select(o, 'achromatic', [['auto', 'when they look like lines (auto)'], ['always', 'always look for them'], ['never', 'never (black is the axes and text)']])));
      } else if (this.kind === 'points') {
        F.append(h('p.sm', colourNote()), this._field('Error bars', this._select(o, 'error_bars', [['auto', 'find them (auto)'], ['vertical', 'up and down'], ['horizontal', 'across'], ['both', 'both'], ['none', 'none']])), this._field('Marker size', this._input(o, 'marker_size', { inputmode: 'decimal', placeholder: 'found by itself' }), 'Their diameter, in pixels, if they are not found well'), this._field('Colour tolerance', this._input(o, 'colour_tolerance', { inputmode: 'decimal' }), 'How far a pixel’s colour may be from the colour picked (0–441)'));
      } else if (this.kind === 'bars') {
        F.append(h('p.sm', colourNote()), this._field('The bars', this._select(o, 'orientation', [['vertical', 'stand up from the x axis'], ['horizontal', 'lie across from the y axis']])), this._field('Baseline', this._input(o, 'baseline', { inputmode: 'decimal', placeholder: '0, if it is on the axis' }), 'The value the bars start from'), this._check(o, 'error_bars', 'Read their error bars'));
      } else if (this.kind === 'rows') {
        F.append(
          this._field('Row values', this._input(o, 'row_values', { placeholder: 'e.g. 1955:2013' }), 'The y-axis value of each row’s baseline: FIRST:LAST, or a list (1,2,3). Or mark ticks.'),
          this._field('Bins', this._input(o, 'bins', { inputmode: 'numeric', placeholder: 'every pixel column' }), 'Average each row over this many bins: 24 for two years of months, 48 for two days of half hours'),
          this._field('Row spacing value', this._input(o, 'row_spacing_value', { inputmode: 'decimal', placeholder: 'heights as a fraction' }), 'What the gap between two baselines stands for (1.1 if values 0–1 are drawn 1.1 apart)'),
          this._field('Fill', this._select(o, 'direction', [['auto', 'found (auto)'], ['up', 'rises above its baseline'], ['down', 'hangs below its baseline']])),
          this._field('Dots', this._input(o, 'dots', { placeholder: 'e.g. black, or #000000' }), 'Also find dots of this colour, and say which bin each is in'),
          h('p.sm', this.marks.colours.length ? `The fill: the first colour you picked (${this.marks.colours[0]}).` : 'The fill: the commonest colour (pick one with the Colour tool to choose).')
        );
      } else if (this.kind === 'heatmap') {
        F.append(
          h('p.sm', this.marks.colourbar ? 'Using the colour bar you marked.' : 'The colour bar is found by itself (or mark it with the Colour bar tool).'),
          this._field('Colour bar ends', this._input(o, 'colourbar_values', { placeholder: 'read from its labels' }), 'The values at its bottom and top: BOTTOM,TOP (e.g. -1,1)'),
          this._field('Rows', this._input(o, 'rows', { inputmode: 'numeric', placeholder: 'found by itself' }), 'How many cells down the map'),
          this._field('Columns', this._input(o, 'cols', { inputmode: 'numeric', placeholder: 'found by itself' }), 'How many cells across'),
          this._field('Or a colour map', this._input(o, 'colormap', { placeholder: 'e.g. viridis' }), 'Without a colour bar: matplotlib’s colour map, with its smallest and largest values'),
          h('div.dg-two', this._field('vmin', this._input(o, 'vmin', { inputmode: 'decimal' })), this._field('vmax', this._input(o, 'vmax', { inputmode: 'decimal' })))
        );
      } else if (this.kind === 'polar') {
        F.append(
          h('p.sm', colourNote()),
          h('p.sm', this.marks.rings.length >= 2 ? `The radial scale: from the ${this.marks.rings.length} rings you marked.` : 'Mark two rings and their values (Ring tool) for the radial scale, or give the value of the outer circle.'),
          this._field('Outer circle', this._input(o, 'outer_value', { inputmode: 'decimal', placeholder: 'or mark rings' }), 'The value at the outer circle (0 at the centre)'),
          this._field('Angle 0 is', this._select(o, 'zero', [['east', 'to the right (matplotlib’s)'], ['north', 'at the top (a clock)'], ['west', 'to the left'], ['south', 'at the bottom']])),
          this._check(o, 'clockwise', 'Angles grow clockwise'),
          this._field('Marker size', this._input(o, 'marker_size', { inputmode: 'decimal', placeholder: 'found by itself' }))
        );
      }
      S.appendChild(F);
      if (this.kind !== 'polar') {
        const A = this.axisOpts;
        const more = h('details.dg-more', h('summary', 'Axes: scales, limits, which y axis'));
        more.append(
          this._field('Read the values against', this._select(A, 'y_axis', [['left', 'the y axis on the left'], ['right', 'a second y axis on the right']])),
          h('div.dg-two', this._field('y scale', this._select(A, 'y_scale', [['auto', 'auto'], ['linear', 'linear'], ['log', 'log']])), this._field('x scale', this._select(A, 'x_scale', [['auto', 'auto'], ['linear', 'linear'], ['log', 'log']]))),
          h('p.sm.muted', 'Or the values at the edges of the plot area (if the axis ends at its last tick):'),
          h('div.dg-two', this._field('y at the bottom', this._input(A, 'y_min', { inputmode: 'decimal' })), this._field('y at the top', this._input(A, 'y_max', { inputmode: 'decimal' }))),
          h('div.dg-two', this._field('x at the left', this._input(A, 'x_min', { inputmode: 'decimal' })), this._field('x at the right', this._input(A, 'x_max', { inputmode: 'decimal' }))),
          this._check(A, 'ocr', 'Read the tick labels (OCR)')
        );
        S.appendChild(more);
      }
    }

    /** the options for dwb.gui.digitise, from the marks and the fields */
    options() {
      const k = this.kind, o = this.opts[k], M = this.marks, A = this.axisOpts;
      const out = {};
      const n = (v) => num(v);
      if (k !== 'polar') {
        if (M.areas.length) out.plot_area = M.areas;
        if (M.exclude.length) out.exclude = M.exclude;
        if (M.ticks.length) out.ticks = M.ticks.map((t) => ({ axis: t.axis, px: t.px, value: t.value, at: t.at }));
        if (A.y_axis === 'right') out.y_axis = 'right';
        if (A.y_scale !== 'auto') out.y_scale = A.y_scale;
        if (A.x_scale !== 'auto') out.x_scale = A.x_scale;
        if (n(A.y_min) != null && n(A.y_max) != null) Object.assign(out, { y_min: n(A.y_min), y_max: n(A.y_max) });
        if (n(A.x_min) != null && n(A.x_max) != null) Object.assign(out, { x_min: n(A.x_min), x_max: n(A.x_max) });
        if (!A.ocr) out.ocr = false;
        // (the picture as it is shown: a tilted one is not turned by itself, as the marks were made on it as it is)
        if (this.found && Math.abs(this.found.tilt_degrees || 0) >= 0.15) out.straighten = 'never';
      }
      const cols = M.colours.slice();
      if (k === 'lines') {
        if (cols.length) out.trace_colours = cols;
        if (o.achromatic !== 'auto') out.achromatic = o.achromatic;
      } else if (k === 'points') {
        if (cols.length) out.colours = cols;
        if (o.error_bars !== 'auto') out.error_bars = o.error_bars;
        if (n(o.marker_size) != null) out.marker_size = n(o.marker_size);
        if (n(o.colour_tolerance) != null && n(o.colour_tolerance) !== 60) out.colour_tolerance = n(o.colour_tolerance);
      } else if (k === 'bars') {
        if (cols.length) out.colours = cols;
        if (o.orientation === 'horizontal') out.orientation = 'horizontal';
        if (n(o.baseline) != null) out.baseline = n(o.baseline);
        if (!o.error_bars) out.error_bars = false;
        if (n(o.colour_tolerance) != null && n(o.colour_tolerance) !== 40) out.colour_tolerance = n(o.colour_tolerance);
      } else if (k === 'rows') {
        const rv = String(o.row_values || '').trim();
        if (rv) {
          const m = /^(-?[\d.]+)\s*:\s*(-?[\d.]+)(?:\s*:\s*([\d.]+))?$/.exec(rv);
          if (m) {
            const a = Number(m[1]), b = Number(m[2]), st = Number(m[3] || 1);
            const vals = [];
            for (let v = a; st > 0 && (a <= b ? v <= b + 1e-9 : false); v += st) vals.push(round(v, 9));
            out.row_values = vals;
          } else out.row_values = rv.split(/[,;\s]+/).map(Number).filter((v) => isFinite(v));
        }
        if (n(o.bins) != null) out.bins = Math.round(n(o.bins));
        if (n(o.row_spacing_value) != null) out.row_spacing_value = n(o.row_spacing_value);
        if (o.direction !== 'auto') out.direction = o.direction;
        if (String(o.dots || '').trim()) out.dots = String(o.dots).trim();
        if (cols.length) out.colour = cols[0];
      } else if (k === 'heatmap') {
        if (M.colourbar) out.colourbar = M.colourbar;
        const cb = String(o.colourbar_values || '').split(/[,;\s]+/).map(num).filter((v) => v != null);
        if (cb.length === 2) out.colourbar_values = cb;
        if (n(o.rows) != null) out.rows = Math.round(n(o.rows));
        if (n(o.cols) != null) out.cols = Math.round(n(o.cols));
        if (String(o.colormap || '').trim()) {
          out.colormap = String(o.colormap).trim();
          if (n(o.vmin) != null) out.vmin = n(o.vmin);
          if (n(o.vmax) != null) out.vmax = n(o.vmax);
        }
      } else if (k === 'polar') {
        if (M.centre) out.centre = M.centre;
        if (M.rings.length >= 2) out.r_ref = M.rings.map((r) => [r.r, r.value]);
        else if (n(o.outer_value) != null) out.outer_value = n(o.outer_value);
        if (o.zero !== 'east') out.zero = o.zero;
        if (o.clockwise) out.clockwise = true;
        if (cols.length) out.colours = cols;
        if (n(o.marker_size) != null) out.marker_size = n(o.marker_size);
      }
      return out;
    }

    /* ================================================================
       running
       ================================================================ */
    _renderRun() {
      const S = this.secRun;
      S.innerHTML = '';
      const go = h('button.btn.primary.dg-go', { type: 'button', disabled: !this.path || this.busy, html: MG.icon(this.busy ? 'spin' : 'play') + `<span>${this.busy ? 'Digitising…' : 'Digitise as ' + KIND_NAME[this.kind].toLowerCase()}</span>` });
      go.addEventListener('click', () => this.run());
      const out = h('input', { type: 'text', value: this.outDir || '~/results', spellcheck: 'false', 'aria-label': 'Folder for the results' });
      out.addEventListener('change', () => (this.outDir = out.value.trim() || '~/results'));
      this.overlayBox = this.overlayBox == null ? true : this.overlayBox;
      const ov = h('input', { type: 'checkbox', checked: this.overlayBox });
      ov.addEventListener('change', () => (this.overlayBox = ov.checked));
      S.append(h('div.dg-run', go), this._field('Save into', out), h('label.check.sm', ov, ' Save a picture of what was found, drawn over the figure'));
    }
    async run() {
      if (!this.path || this.busy) return;
      const kind = this.kind;
      const opts = this.options();
      this.busy = true;
      this._renderRun();
      const t0 = performance.now();
      let r;
      try {
        r = await this.call('dwb.gui.digitise', { kind, path: this.path, options: opts, output_dir: this.outDir || '~/results/' + stem(this.path), overlay: !!this.overlayBox }, `Digitising as ${KIND_NAME[kind].toLowerCase()}…`);
      } catch (e) {
        this.busy = false;
        this._renderRun();
        this.result = null;
        this.runError = e.message || String(e);
        this._renderResult();
        this.draw();
        return;
      }
      this.busy = false;
      this.runError = null;
      this.result = r;
      this.removed = new Set();
      this.added = [];
      this.compared = null;
      this.edited = null;
      r.wall = (performance.now() - t0) / 1000;
      this._renderRun();
      this._renderTools();
      this._renderResult();
      this.draw();
      bus.emit('digitise:done', { kind, path: this.path, rows: r.table.n, warnings: r.warnings });
      if (exampleOf(this.path)) this.compare();
    }

    _renderResult() {
      const S = this.secResult;
      S.innerHTML = '';
      const askAI = (label) => {
        const b = h('button.btn.sm', { type: 'button', title: 'Ask the AI assistant what this means (it is told the settings and the messages, never shown the picture)', html: MG.icon('sparkle') + `<span>${esc(label)}</span>` });
        b.addEventListener('click', () => bus.emit('dg:ask', {}));
        return b;
      };
      if (this.runError) {
        S.append(h('h3', 'It didn’t work'), h('pre.dg-err', this.runError), h('p.sm', 'Mark what it needs – a plot area, two ticks on each axis, the colours – or try another kind of figure.'), h('div.dg-row', askAI('Ask the AI about this')));
        return;
      }
      const R = this.result;
      if (!R) {
        S.append(h('h3', 'The result'), h('p.sm.muted', 'Digitise, and what was found is drawn over the picture (in pink), with a table of the values here.'));
        return;
      }
      const T = R.table;
      S.appendChild(h('h3', `The result: ${T.n.toLocaleString('en-GB')} row${T.n === 1 ? '' : 's'}`));
      S.appendChild(h('p.sm.muted', `${KIND_NAME[R.kind]} · ${R.seconds.toFixed(1)} s in Python · in pink on the picture`));
      if (R.warnings.length) {
        const ul = h('ul.dg-checks');
        for (const w of R.warnings) ul.appendChild(h('li', w));
        S.append(h('h4', 'Check'), ul, h('div.dg-row', askAI('What do these mean?')));
      }
      // the table
      const tbl = h('div.dg-table');
      const t = h('table');
      t.appendChild(h('tr', ...T.columns.map((c) => h('th', c))));
      for (const row of T.rows.slice(0, 60)) t.appendChild(h('tr', ...row.map((v) => h('td', typeof v === 'number' ? fmtVal(v) : v == null ? '' : String(v)))));
      tbl.appendChild(t);
      S.appendChild(tbl);
      if (T.n > 60) S.appendChild(h('p.sm.muted', `The first 60 of ${T.n.toLocaleString('en-GB')} rows: the whole table is in the CSV file.`));
      // files
      const files = h('ul.dg-files');
      for (const f of R.files) {
        const a = h('button.linkbtn', { type: 'button', title: 'Open in the Files tab' }, this.fs.pretty(f));
        a.addEventListener('click', () => MG.app.openFile(f));
        files.appendChild(h('li', a));
      }
      const csv = R.files.find((f) => /\.csv$/.test(f) && !/_summary_|_panel_metadata/.test(f));
      const dl = h('button.btn.sm', { type: 'button', html: MG.icon('download') + '<span>Download the table</span>' });
      dl.addEventListener('click', async () => MG.downloadBlob(await this.fs.toBlob(csv), csv.split('/').pop()));
      S.append(h('h4', 'Files'), files, h('div.dg-row', dl));
      // edits (points, polar)
      if (R.shapes && R.shapes.points) {
        const n = this.removed.size + this.added.length;
        const save = h('button.btn.sm', { type: 'button', disabled: !n, html: MG.icon('save') + '<span>Save the edited table</span>' });
        save.addEventListener('click', () => this.saveEdits());
        const edit = h('button.btn.sm', { type: 'button', html: MG.icon('pencil') + '<span>Edit points</span>' });
        edit.addEventListener('click', () => this.setTool('edit'));
        S.append(h('h4', 'Points missed, or found where there are none?'), h('p.sm', n ? `${this.removed.size} taken out, ${this.added.length} put in.` : 'Edit them with the Edit points tool, then save the table with your edits.'), h('div.dg-row', edit, save));
        if (this.edited) S.appendChild(h('p.sm', 'Saved as ', h('b', this.fs.pretty(this.edited.path)), '.'));
      }
      // compare with the known values (the examples)
      const ex = exampleOf(this.path);
      if (ex) {
        const cmp = h('button.btn.sm', { type: 'button', html: MG.icon('compare') + '<span>Compare with the known values</span>' });
        cmp.addEventListener('click', () => this.compare());
        S.append(h('h4', 'How close is it?'), h('div.dg-row', cmp));
        if (this.compared) {
          const ul = h('ul.dg-cmp');
          for (const l of this.compared.lines) ul.appendChild(h('li', l));
          S.appendChild(ul);
        }
      }
      // the same, by hand
      const cmd = R.command;
      const box = (title, code, kind) => {
        const pre = h('pre', { 'data-run': kind }, h('code', code));
        const wrap = h('div.dg-code', h('h4', title), pre);
        if (MG.app.decorateCode) setTimeout(() => MG.app.decorateCode(pre), 0);
        return wrap;
      };
      S.appendChild(box('The same in the Terminal', cmd.text, cmd.ok ? 'term' : ''));
      if (!cmd.ok) S.appendChild(h('p.sm.muted', 'This command leaves out some of what you marked: ' + cmd.why + '.'));
      S.appendChild(box('The same in Python (a notebook, or your own computer)', R.python, 'py'));
    }

    /* ================================================================
       editing points
       ================================================================ */
    _editAt(ix, iy) {
      const pts = (this.result && this.result.shapes && this.result.shapes.points) || [];
      const tol = 9 / this.view.scale;
      // a point put in by hand: take it out again
      const ai = this.added.findIndex(([x, y]) => Math.hypot(x - ix, y - iy) <= tol);
      if (ai >= 0) this.added.splice(ai, 1);
      else {
        let best = null, bd = Infinity;
        for (const p of pts) {
          const d = Math.hypot(p.x - ix, p.y - iy);
          if (d <= Math.max(tol, (p.r || 0) + 2) && d < bd) {
            bd = d;
            best = p;
          }
        }
        if (best) {
          if (this.removed.has(best.i)) this.removed.delete(best.i);
          else this.removed.add(best.i);
        } else this.added.push([round(ix, 2), round(iy, 2)]);
      }
      this.edited = null;
      this._renderResult();
      this.draw();
    }
    async saveEdits() {
      const R = this.result;
      const csv = R.files.find((f) => /_(points|polar)\.csv$/.test(f));
      try {
        this.edited = await this.call('dwb.gui.save_edits', { kind: R.kind, csv, remove: Array.from(this.removed), add: this.added, panels: R.panels, polar: R.shapes.polar || null }, 'Saving the edited table…');
        toast(`Saved <b>${esc(this.fs.pretty(this.edited.path))}</b>: ${this.edited.removed} taken out, ${this.edited.added} put in.`, 'ok', 6000);
        this._renderResult();
        if (exampleOf(this.path)) this.compare();
      } catch (e) {
        toast(esc(e.message), 'error');
      }
    }

    /* ================================================================
       the examples: how close is it?
       ================================================================ */
    async compare() {
      const R = this.result;
      if (!R) return;
      const ex = exampleOf(this.path);
      const csv = (this.edited && this.edited.path) || R.files.find((f) => /\.csv$/.test(f) && !/_summary_|_panel_metadata/.test(f));
      try {
        this.compared = await this.call('dwb.gui.compare', { example: ex, csv, kind: R.kind }, 'Comparing with the known values…');
        this._renderResult();
      } catch (e) {
        toast(esc(e.message), 'error');
      }
    }

    /* ================================================================
       odds and ends
       ================================================================ */
    _showMenu(anchor) {
      const t = (k, label) => [this.show[k] ? 'check' : 'x', label, () => {
        this.show[k] = !this.show[k];
        this.draw();
      }];
      MG.popmenu(anchor, [t('found', 'What trace-digitiser sees (blue)'), t('marks', 'Your marks (green, red, orange)'), t('result', 'The result (pink)')]);
    }
    /** fill in marks and options (the help's walkthroughs: "Mark these for me") */
    apply(set) {
      if (set.kind) this.setKind(set.kind, { quiet: true });
      const M = this.marks;
      if (set.marks) Object.assign(M, JSON.parse(JSON.stringify(set.marks)));
      if (set.options) Object.assign(this.opts[this.kind], set.options);
      if (set.axes) Object.assign(this.axisOpts, set.axes);
      this._marksChanged();
      this._renderKind();
      this._renderRun();
    }
    shown(opts) {
      if (opts && opts.resize) return;
      if (!this._fitted) this._resize();
      this.stage.focus({ preventScroll: true });
    }
    /** for the AI assistant: what is on the tab now, without the picture */
    describeForAI() {
      if (!this.path) return '';
      const parts = [`The Digitise tab has ${this.fs.pretty(this.path)} open (${this.W} × ${this.H} pixels), to be read as ${KIND_NAME[this.kind].toLowerCase()}.`];
      const M = this.marks;
      if (M.areas.length) parts.push(`Plot areas marked: ${M.areas.map((b) => '[' + b.map(Math.round).join(', ') + ']').join(', ')}.`);
      if (M.exclude.length) parts.push(`Regions left out: ${M.exclude.length}.`);
      if (M.ticks.length) parts.push(`Ticks marked: ${M.ticks.map((t) => `${t.axis} ${round(t.px, 1)}=${t.value}`).join(', ')}.`);
      if (M.colours.length) parts.push(`Colours picked: ${M.colours.join(', ')}.`);
      const F = this.found;
      if (F) {
        parts.push(`trace-digitiser found ${F.panels.length} plot area(s); tilt ${F.tilt_degrees}°.`);
        for (const p of F.panels) {
          const ax = (a, n) => (a && a.usable ? `${n} ${a.scale} from ${a.ticks.length} labels (${a.confidence})` : `${n} not read`);
          parts.push(`Panel ${p.panel_id} [${p.plot_area.map(Math.round).join(', ')}]: ${ax(p.y_axis, 'y')}, ${ax(p.x_axis, 'x')}; colours ${(p.colours || []).map((c) => c.hex).join(', ')}.`);
        }
      }
      const R = this.result;
      if (R) {
        parts.push(`Last run: ${R.kind}, ${R.table.n} rows, ${R.seconds}s. Its command: ${R.command.text}`);
        if (R.warnings.length) parts.push('Its warnings: ' + R.warnings.join(' | '));
        if (this.compared) parts.push('Compared with the known values: ' + this.compared.lines.join(' | '));
      } else if (this.runError) parts.push('The last run failed: ' + this.runError);
      return parts.join('\n');
    }
  }

  MG.DigitiseTab = DigitiseTab;
})();
