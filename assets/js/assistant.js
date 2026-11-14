/* =====================================================================
   The AI assistant of the Digitiser workbench (adapted from the R
   workbench's).

   Chat  – a real AI model, set up as a tutor for people who are learning
           to digitise graphs with trace-digitiser and Python, answers
           questions about the Digitise tab, trace-digitiser's options and
           messages, Python code, error messages and what to do with the
           values once they are digitised. With each question it gets – if
           the user leaves the boxes ticked – what the user is working on:
           the Digitise tab's settings and marks and the last run's
           messages (NEVER the picture itself, nor the values read from it),
           the open notebook's code, the last terminal commands and the
           names of the user's files – never what is in the data files.
           Code in its answers goes into a notebook, the terminal or a file
           with one click. Errors come here with a click: "Ask the AI
           assistant about this error" under a failed command (term:ask),
           "Ask AI" on a notebook cell (nb:ask), a run of the Digitise tab
           that failed or warned (dg:ask), and "Explain my last error" when
           the tab the user came from shows one.
   Agent – the same model as an agent: it carries out a task by running
           commands in the Terminal (trace-digitiser, python), one step at
           a time, in a folder of its own (~/ai-agent/run-N). It may read any
           file but write only there: what a step changes outside it is
           undone. Every command and its output is shown, and the run is
           kept as a Markdown record in its folder (agent-record.md). It
           never sees a picture: what trace-digitiser prints about one, it
           sees.
   The model is the user's: Google Gemini (free tier), Anthropic or an
   OpenAI-compatible service, called from the browser with a key that the
   user enters. The key is kept in memory – or, if the user asks, in this
   tab's sessionStorage until the tab is closed – never in localStorage and
   never in a file. Without a key: how to get one, a prompt to copy into
   another AI tool, and offline help for common error messages.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;
  const CFG = MG.config || {};
  const KEY_NAME = (CFG.storePrefix || 'dgwb') + '-ai-key'; // (sessionStorage, and only when the user asks)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const HOME = () => (MG.app && MG.app.HOME) || '/home/user';
  const pretty = (p) => (MG.app && MG.app.fs ? MG.app.fs.pretty(p) : p);
  const TAB_NAMES = { digitise: 'Digitise', notebook: 'Notebook', terminal: 'Terminal', editor: 'Files', assistant: 'AI assistant' };
  const tabName = (k) => (MG.app && MG.app.tabName && MG.app.tabName[k]) || TAB_NAMES[k] || k;
  const stamp = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };
  const quote = (t) => String(t || '').trim().split('\n').map((l) => '> ' + l).join('\n');
  /** a fenced code block that the text cannot break out of (a fence longer than any run of backticks in it) */
  const fence = (text, lang) => {
    const t = String(text == null ? '' : text).replace(/\s+$/, '');
    const run = Math.max(2, ...(t.match(/`+/g) || []).map((x) => x.length));
    const f = '`'.repeat(run + 1);
    return `${f}${lang || ''}\n${t}\n${f}`;
  };
  /** wait for something that a tab makes when it is first shown */
  async function waitFor(get, ms = 8000) {
    for (let t = 0; t < ms && !get(); t += 50) await sleep(50);
    return get();
  }
  const ask = (title, html, ok) =>
    MG.confirmBox
      ? MG.confirmBox(title, html, ok)
      : new Promise((resolve) => {
          let done = false;
          const end = (v) => {
            if (done) return;
            done = true;
            m.close();
            resolve(v);
          };
          const m = MG.modal(title, html + `<div class="prompt-actions"><button class="btn" data-x="no" type="button">Cancel</button><button class="btn primary" data-x="yes" type="button">${esc(ok || 'OK')}</button></div>`, { onClose: () => end(false) });
          m.box.querySelector('[data-x="no"]').addEventListener('click', () => end(false));
          m.box.querySelector('[data-x="yes"]').addEventListener('click', () => end(true));
        });

  /* ------------------------------------------------------------------
     answers: Markdown → HTML (marked), cleaned (DOMPurify). A model's answer can contain anything, so no
     scripts, forms, styles or pictures get through (a picture would be fetched at once, from any address).
     Code blocks become boxes with buttons (codeBox).
     ------------------------------------------------------------------ */
  const CLEAN = { FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'script', 'img', 'picture', 'video', 'audio', 'source', 'object', 'embed', 'svg', 'math', 'link', 'meta', 'base'], FORBID_ATTR: ['style', 'srcset'] };
  const clean = (html) => (window.DOMPurify ? window.DOMPurify.sanitize(html, CLEAN) : '<p>' + esc(html) + '</p>');
  /** a code fence's file name: ```r scripts/plot.R  (or title="plot.R") */
  function fenceFile(words) {
    return (
      words
        .map((x) => x.replace(/^(title|file|filename|path)=/i, '').replace(/^["']|["']$/g, ''))
        .find((x) => /^[\w.~/+-]+$/.test(x) && (/\.\w{1,8}$/.test(x) || x.includes('/')) && !/^\d/.test(x)) || null
    );
  }
  /** Markdown → [{html} | {code, lang, file, chunk}] */
  function mdBlocks(md) {
    const src = String(md || '');
    const M = window.marked;
    if (!M || !M.lexer || !M.parser) return [{ html: '<p>' + esc(src).replace(/\n/g, '<br>') + '</p>' }];
    let toks;
    try {
      toks = M.lexer(src, { gfm: true });
    } catch (e) {
      return [{ html: '<pre>' + esc(src) + '</pre>' }];
    }
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      run.links = toks.links || {};
      let html;
      try {
        html = M.parser(run, { gfm: true });
      } catch (e) {
        html = '<p>' + esc(run.map((t) => t.raw || '').join('')) + '</p>';
      }
      out.push({ html: clean(html) });
      run = [];
    };
    for (const t of toks) {
      if (t.type === 'code') {
        flush();
        const raw = String(t.lang || '').trim();
        // (the fence of an R Markdown chunk: ```{r}, ```{r label, echo = FALSE})
        const chunk = /^\{\s*([A-Za-z]+)/.exec(raw);
        const info = raw.split(/\s+/).filter(Boolean);
        out.push({ code: t.text, lang: chunk ? chunk[1].toLowerCase() : (info[0] || '').toLowerCase(), file: chunk ? null : fenceFile(info.slice(1)), chunk: !!chunk });
      } else run.push(t);
    }
    flush();
    return out;
  }

  /* the languages of code blocks */
  const PY = /^(python|py|python3|ipython|ipython3|pycon|jupyter)$/;
  const RL = /^(r|rscript|splus|s|rconsole|webr)$/;
  const RMD = /^(rmd|rmarkdown|qmd|quarto)$/;
  const SH = /^(bash|sh|shell|console|zsh|shell-session|sh-session|shellscript|terminal|cmd|command)$/;
  const PLAIN = /^(text|txt|plaintext|output|log|stdout|stderr|none|rout|out)$/;
  const EXT = { r: '.R', rscript: '.R', rmd: '.Rmd', rmarkdown: '.Rmd', qmd: '.qmd', quarto: '.qmd', bash: '.sh', sh: '.sh', shell: '.sh', python: '.py', py: '.py', yaml: '.yaml', yml: '.yaml', json: '.json', csv: '.csv', tsv: '.tsv', markdown: '.md', md: '.md', html: '.html', css: '.css', sql: '.sql', javascript: '.js', js: '.js', toml: '.toml', ini: '.ini', xml: '.xml', awk: '.awk', sed: '.sed', tex: '.tex', latex: '.tex' };
  /** commands typed after a prompt ("$ head data.csv") – the rest of such a block is what they printed */
  function shellCode(code) {
    const lines = String(code).replace(/\r/g, '').split('\n');
    const prompted = lines.filter((l) => /^\s*\$\s/.test(l));
    return prompted.length ? prompted.map((l) => l.replace(/^\s*\$\s+/, '')).join('\n') : code;
  }
  /** R code as it is typed: a console transcript ("> x <- 1", "+ …" for the lines that go on, then what R printed) is
      reduced to its commands */
  function rCode(code) {
    const lines = String(code).replace(/\r/g, '').split('\n');
    const first = lines.find((l) => l.trim()) || '';
    if (!/^> /.test(first)) return code;
    const out = [];
    let cmd = false;
    for (const l of lines) {
      if (/^> /.test(l) || l === '>') {
        out.push(l.slice(2));
        cmd = true;
      } else if (cmd && (/^\+ /.test(l) || l === '+')) out.push(l.slice(2));
      else cmd = false;
    }
    return out.join('\n').replace(/\n+$/, '');
  }
  /** the commands of a block, one by one (lines that belong together – a loop, a here-document – are one) */
  function shellCommands(code) {
    const SL = MG.shellLang;
    const cmds = [];
    let acc = null;
    for (const line of String(code).replace(/\r/g, '').replace(/\n+$/, '').split('\n')) {
      if (acc == null && (!line.trim() || /^\s*#/.test(line))) continue;
      acc = acc == null ? line : acc + '\n' + line;
      let more = false;
      try {
        more = !!(SL && SL.incomplete && SL.incomplete(acc));
      } catch (e) {
        more = false;
      }
      if (!more) {
        cmds.push(acc);
        acc = null;
      }
    }
    if (acc != null) cmds.push(acc);
    return cmds;
  }
  const knownCommand = (n) => !!((MG.shellTools && MG.shellTools[n]) || (MG.shellBuiltins && MG.shellBuiltins[n]) || (MG.shellLang && MG.shellLang.isShellWord && MG.shellLang.isShellWord(n)));
  /** an unlabelled code block that is terminal commands: its first word is a command of the terminal */
  function looksShell(code) {
    const first = String(code).split('\n').find((l) => l.trim() && !/^\s*#/.test(l)) || '';
    const w = first.trim().replace(/^\$\s+/, '').split(/\s+/)[0] || '';
    return knownCommand(w) && !/^(library|print|function|for|if|while|repeat|source|help|data|set)$/.test(w) && !/^\S+\s*(<-|=)/.test(first.trim());
  }
  /** an unlabelled code block that is R */
  const looksR = (code) => /<-|\|>|%>%|\blibrary\s*\(|\bfunction\s*\(|\bc\s*\(|\b(read\.csv|data\.frame|ggplot|summary|mean|print|plot|head|str|View)\s*\(|\w\$\w/.test(String(code));
  /* code that deletes, moves or overwrites files: asked about before it runs */
  const RISKY = /(^|[\s;&|(`])(rm|rmdir|mv|shred|truncate)(\s|$)|\s-delete\b|>\s*\/home|>\s*~\//m;
  const RISKY_PY = /\b(os\.(remove|unlink|rmdir|removedirs|rename|replace)|shutil\.(rmtree|move)|\.unlink|\.rmdir)\s*\(/;
  /** an unlabelled code block that is Python */
  const looksPy = (code) => /^\s*(import |from \S+ import |def |class |print\(|for .+:\s*$|with .+:\s*$)|\btd\.\w+\(|\bpd\.\w+\(|\bnp\.\w+\(|\bplt\.\w+\(/m.test(String(code));

  /* ------------------------------------------------------------------
     what the model is told about the workbench
     ------------------------------------------------------------------ */
  const EXDIR = '/data/examples/hearn-whitmore-2026';
  function versions() {
    const K = MG.kernels && MG.kernels.peek && MG.kernels.peek();
    const V = (K && K.versions) || {};
    const P = Object.assign({}, (window.WB_BUNDLE && window.WB_BUNDLE.packages) || {}, V.packages || {});
    return { python: V.python || '3.13', pyodide: V.pyodide || ((CFG.pyodideBase || '').match(/v(\d+\.\d+(\.\d+)?)/) || [])[1] || '0.29', td: P['trace-digitiser'] || '2.1', tesseract: V.tesseract || '5.1', packages: P };
  }
  /** the programs of the terminal */
  function programs() {
    return [
      'trace-digitiser FIGURE.png [options] (lines, the default), trace-digitiser points|bars|rows|heatmap|polar FIGURE.png [options], trace-digitiser describe FIGURE.png (what it finds, as JSON); every run writes a CSV file and a provenance JSON file (-o FOLDER; --overlay also writes a picture of what was found)',
      'compare-known TABLE.csv (compares a table digitised from one of the examples with the values the figure really shows)',
      'python (python script.py, python -c "…", python -m json.tool FILE.json), pip install NAME (pure-Python packages, and Pyodide\'s)',
      'digitise FILE (opens a picture or a PDF in the Digitise tab)',
      "text tools after the GNU ones (cat head tail wc grep sort uniq cut tr tee paste diff seq sed less column), the shell's own ls cd pwd mkdir cp mv rm touch find tree du stat file chmod xargs env printf, open FILE, nano FILE, download FILE, unzip, zip, tar, curl and wget (to servers that allow it)"
    ].join('; ');
  }
  /** the environment: for the chat, the prompt for another AI tool and the agent */
  function envLines() {
    const v = versions();
    return [
      `- trace-digitiser ${v.td} (https://github.com/comparativechrono/trace-digitiser; pip install trace-digitiser), running in Python ${v.python} in the browser (Pyodide ${v.pyodide}), with NumPy, OpenCV, pandas, Pillow and Matplotlib. Its tick-label OCR is Tesseract ${v.tesseract} compiled to WebAssembly, in the page. Nothing is uploaded anywhere: pictures stay in the browser.`,
      "- trace-digitiser's Python: import trace_digitiser as td; td.digitise(path, …) reads lines (result.trace_data: one row per pixel column per trace, with x_value, center_estimate (the value), upper_envelope, lower_envelope, panel_id, trace_id); td.digitise_points, td.digitise_bars, td.digitise_rows, td.digitise_heatmap, td.digitise_polar (result.data); each result has .warnings (read them), .panels, .provenance, and writes CSV files unless write_outputs=False (output_dir=…). td.describe_figure(path) says what is found (plot areas, tick labels read, colours), td.pixels_to_values(points, x_ref=…, y_ref=…) turns pixel positions into values.",
      "- Options of every reader but polar (the same on the command line, with dashes): plot_area=(left, top, right, bottom) or a list of them (pixels; --plot-area L,T,R,B), exclude= boxes to leave out (legends, insets), y_ref=[(row, value), …] and x_ref=[(column, value), …] (two or more ticks each; a dict by panel number for several panels; --y-ref ROW:VALUE), y_min/y_max and x_min/x_max (the values at the edges of the plot area), y_scale/x_scale ('auto', 'linear', 'log'), y_axis='right' (a second y axis), ocr=False, straighten ('auto', 'never' or degrees). Lines: trace_colours=['#rrggbb', …] (--trace-colour), achromatic ('auto', 'always', 'never'). Points: colours=, marker_size=, error_bars ('auto', 'vertical', 'horizontal', 'both', 'none'), colour_tolerance=. Bars: colours=, baseline=, orientation ('vertical', 'horizontal'), error_bars=True/False. Rows: row_values=[…] (--row-values 1955:2013), row_positions=, bins=, row_spacing_value=, direction ('auto', 'up', 'down'), colour=, dots=. Heat maps: colourbar=box, colourbar_values=(bottom, top), colormap='viridis' with vmin/vmax, rows=, cols=. Polar: centre=(x, y), r_ref=[(radius_px, value), …] or outer_value=, zero ('east', 'north' …), clockwise=, colours=, marker_size=.",
      `- The examples: the figures of Hearn and Whitmore (2026), J Biol Rhythms 41(1):28-41, in ${EXDIR}: figure-1a.png (three lines, two y axes – the right one labelled with month names – and an inset), figure-1b.png (bars with error bars; figure-1b-scanned.jpg is it scanned, tilted 1.2°), figure-2.png (a birthogram: 59 rows of months, double-plotted, with dots), figure-3a.png (two stacked panels of lines sharing an x axis), figure-3b.png (a polar plot), figure-3c.png (points with horizontal confidence intervals, a downward y axis; figure-3c-scanned.jpg), figure-4.png (six heat maps sharing a colour bar), figure-s3.png (two panels of points). Beside each, FIGURE.known.csv holds the values it really shows, and compare-known checks a digitised table against them. ${EXDIR}/README.md says what each column is.`,
      `- Files: the user's files are in ~ (= ${HOME()}), kept in the browser and shared by all the tabs: pictures in ~/pictures (pages of PDFs are saved there too), results in ~/results/NAME (the Digitise tab writes there), notebooks in ~/notebooks. In Python, expand ~ yourself: os.path.expanduser('~/results') – Path('~/…') does not.`,
      "- The Digitise tab: the picture, with tools to mark plot areas, regions to leave out, ticks of the axes and their values, colours, a colour bar, a polar plot's centre and rings, and points to take out or add; a choice of the kind of figure and its options; Digitise runs the reader and draws what was found over the picture, with the CHECK messages, a table, the files, and the command line and the Python that do the same.",
      "- The notebooks are Python (Jupyter-style, .ipynb): !trace-digitiser … and %pip install work in them; plots (Matplotlib) show under the cell. Packages Pyodide has (scipy, scikit-image, statsmodels …) load when a cell imports them; others: %pip install NAME (pure-Python ones).",
      '- What does not exist here: R; a real Linux (no apt, sudo, git, gcc, background jobs); the tesseract program (its Python interface, pytesseract, works); PDF tools (open a PDF in the Digitise tab, which draws a page as a picture).',
      `- Terminal: a bash-like shell simulated in the page (pipes, redirection, variables, $( ), loops, functions, here-documents). Its programs: ${programs()}.`
    ];
  }

  /* ------------------------------------------------------------------
     offline help (no model connected): what common error messages mean
     Each rule: [pattern, text or (match, all text, the command) => text]. Up to two rules answer.
     ------------------------------------------------------------------ */
  const inline = (s) => '`' + s + '`'; // (inline code in the help's Markdown)
  const PY_HELP = [
    [/No module named '?trace[-_ ]?digitiser'?/i, `The package is called ${inline('trace_digitiser')} in Python, with an underscore: ${inline('import trace_digitiser as td')}. (On the command line it is ${inline('trace-digitiser')}, with a hyphen.) On your own computer, install it first with ${inline('pip install trace-digitiser')}.`],
    [/No module named '([\w.]+)'/, (m) => `Python can't find the package **${m[1]}**. If Pyodide has it (scipy, scikit-image, statsmodels …), importing it in a notebook cell loads it; otherwise try ${inline('%pip install ' + m[1].split('.')[0])} in a notebook, or ${inline('pip install ' + m[1].split('.')[0])} in the terminal – only packages that are pure Python, or built for Pyodide, can be installed in the browser.`],
    [/name '(\w+)' is not defined/, (m) => (m[1] === 'td' ? `${inline('td')} is trace-digitiser imported under a short name: run ${inline('import trace_digitiser as td')} first (after a restart Python forgets everything).` : `Python doesn't know the name ${inline(m[1])}. Check the spelling (names are case-sensitive), and run the cell that creates it first – after a restart, Python forgets everything.`)],
    [/FileNotFoundError|No such file or directory|Image not found/, `Python looked for the file in the wrong place, or the name isn't quite right. A path starting with ${inline('~')} has to be expanded in Python: ${inline("os.path.expanduser('~/pictures/figure.png')")}. The examples are in ${inline(EXDIR)}. A notebook runs in its own folder (usually ~/notebooks), so a relative path starts there.`],
    [/Cannot read .* as an image|cannot identify image file/, `That file isn't a picture trace-digitiser can read (PNG, JPEG, TIFF, BMP …). A figure in a PDF: open the PDF in the Digitise tab, which draws the page you choose as a PNG in ~/pictures.`],
    [/was given as one list of points but the figure has (\d+) panels/, (m) => `The figure has ${m[1]} plot areas, so the reference points must say which panel they belong to: a dict by panel number, for example ${inline('y_ref={1: [(159, 0), (23, 300)], 2: [(400, 0), (264, 300)]}')}. Or mark the ticks in the Digitise tab, which sorts them out by itself.`],
    [/needs at least two|at least two \(pixel, value\)|must be given at least twice/, `An axis needs two reference points (ticks with their values) or more, as far apart as you can: one is not enough to set its scale.`],
    [/give both (\w)_min and \w_max|must be given together/, (m) => `Give the values at both edges of the plot area, or neither: ${inline(m[1] + '_min')} and ${inline(m[1] + '_max')} together.`],
    [/not calibrated/, `trace-digitiser couldn't read a scale from that axis's tick labels, so the values there are given from 0 to 1 across the plot area. Give the axis yourself: two ticks and their values (the Digitise tab's Tick tool, or ${inline('x_ref')}/${inline('y_ref')}), or the values at the edges of the plot area (${inline('x_min')}/${inline('x_max')}, ${inline('y_min')}/${inline('y_max')}).`],
    [/read as running downwards/, `The y axis's labels get bigger downwards. That is right for an axis that really runs downwards (years down a forest plot, depth); if the axis has negative numbers whose minus signs weren't read, give ${inline('y_min')} and ${inline('y_max')} (or two ticks) instead.`],
    [/[Cc]onfidence in it is (medium|low)|with (medium|low) confidence/, `trace-digitiser read the axis's labels, but isn't sure of the scale: check the values it lists against the figure (the Digitise tab writes them over the plot, in green). If they are wrong, mark two ticks and their values, or give the axis's limits.`],
    [/tilted .* degrees/, `The picture is tilted (a scan, or a photo). trace-digitiser straightens it when nothing gives pixel positions; otherwise straighten it first (the Digitise tab's Straighten button saves an upright copy), then mark it on the upright copy.`],
    [/no trace was found|No points were found|no fill was found/, `Nothing of the kind was found in that plot area. Pick the colour of what you want to read (the Digitise tab's Colour tool, or ${inline('trace_colours=[…]')} / ${inline('colours=[…]')}), check the plot area, and for points give ${inline('marker_size')} if they are small or overlap.`],
    [/KeyError: '(\w+)'/, (m) => `${inline(m[1])} isn't a column (or key) of that table. ${inline('df.columns')} lists the columns: trace-digitiser's line tables have ${inline('x_value')} and ${inline('center_estimate')}, the other readers' ${inline('x_value')} and ${inline('y_value')} (and ${inline('value')} for bars, heat maps and rows).`],
    [/TypeError: .*unexpected keyword argument '(\w+)'/, (m) => `That function has no argument ${inline(m[1])}. ${inline('help(td.digitise_points)')} (or the reader you use) lists its arguments; AI tools often invent ones that sound right.`],
    [/IndentationError|unexpected indent|expected an indented block/, `The lines that belong to an ${inline('if')}, ${inline('for')}, ${inline('def')} or ${inline('with')} must be indented under it, by the same amount (4 spaces).`],
    [/SyntaxError/, `Python couldn't read the line: look for a missing bracket, quote or colon near the place the message points to (sometimes on the line before). Curly quotes copied from a document don't work: type plain ' or ".`],
    [/MemoryError|out of memory|Cannot enlarge memory/i, 'Python ran out of memory in the browser. Try a smaller picture (crop it to the figure), or fewer pixel columns (digitise one plot area at a time).']
  ];
  const NOT_HERE = /^(R|Rscript|curl_cffi|git|sudo|apt|apt-get|conda|mamba|brew|java|node|npm|make|gcc|tesseract|pdftoppm|convert|magick)$/;
  /** a command line that is Python code (typed into the terminal): an import, an assignment with a call, print(…) */
  function looksPyLine(line) {
    const l = String(line || '').trim();
    if (!l || /\$\(|`/.test(l)) return false;
    const first = l.split(/\s+/)[0];
    if (!first.includes('(') && knownCommand(first)) return false;
    return /^(import |from \S+ import )/.test(l) || /^\w+\s*=\s*\w[\w.]*\(/.test(l) || /^print\(/.test(l) || /^td\./.test(l);
  }
  const PY_IN_TERMINAL = `That is Python code, but the terminal understands bash commands. Type Python into a notebook cell (the Notebook tab), or run it from here with ${inline(`python -c "…"`)}, or write it into a file and run ${inline('python FILE.py')}. trace-digitiser itself is a command here: ${inline('trace-digitiser FIGURE.png')}.`;
  const SHELL_HELP = [
    [
      /command not found/,
      (m, all, line) => {
        if (looksPyLine(line)) return null;
        const w = ((/(\S+): command not found/.exec(all) || [])[1] || '').replace(/^bash:\s*/, '');
        return NOT_HERE.test(w)
          ? `${inline(w)} is not available in this workbench. Its terminal runs in your browser and has trace-digitiser, compare-known, python and pip, the text tools and the shell's built-in commands, which ${inline('help')} lists.`
          : `The terminal has no program with that name. Check the spelling. ${inline('help')} lists the programs: ${inline('trace-digitiser')} (with ${inline('points')}, ${inline('bars')}, ${inline('rows')}, ${inline('heatmap')}, ${inline('polar')} or ${inline('describe')} after it), ${inline('compare-known')}, ${inline('python')}, the text tools (${inline('head')}, ${inline('wc')}, ${inline('grep')} …) and the shell's built-in commands.`;
      }
    ],
    [/error: argument|error: unrecognized arguments|invalid choice/, `trace-digitiser didn't accept an option. ${inline('trace-digitiser --help')} lists the options for lines, and ${inline('trace-digitiser points --help')} (or bars, rows, heatmap, polar) those of the other readers. Pixel boxes are written ${inline('LEFT,TOP,RIGHT,BOTTOM')} and reference points ${inline('PIXEL:VALUE')}.`],
    [/No such file or directory|cannot open|[Cc]ould not open|not found: /, `A file or folder in the command isn't where the command looked for it. Check which folder you are in (${inline('pwd')}) and what is in it (${inline('ls')}). The examples are in ${inline(EXDIR)}; your pictures in ${inline('~/pictures')}.`],
    [/Permission denied|Read-only file system/, `That place can't be written to: the examples in ${inline('/data/examples')} are read-only. Write into your home folder, for example ${inline('-o ~/results/NAME')}.`],
    [/unrecognized option|unrecognised option|invalid option|unknown option|illegal option|unknown argument/i, `The program doesn't have that option (at least, not in this version). Check which options it really has with ${inline('PROGRAM --help')}. AI tools often invent options that sound right.`],
    [/syntax error|unexpected token|unexpected EOF|unexpected end of file/i, `The shell couldn't read the command. Look for an unmatched quote or bracket. A colour such as ${inline('#1f77b4')} must be quoted (${inline("'#1f77b4'")}): an unquoted ${inline('#')} starts a comment.`],
    [/Is a directory/, `The command expected a file but was given a folder. Give the path of a file inside it.`],
    [/stopped by force|Stop requested/i, 'The command was stopped before it finished, so any files it was writing may be missing or incomplete. Run it again.']
  ];
  /** what an error message usually means – Markdown, or null. lang: 'python' (Python's and trace-digitiser's
      messages), 'shell' (a command in the terminal: its own messages and Python's), or anything else for both.
      line: the command */
  function offlineHelp(text, lang, line) {
    // (Python typed into the terminal: whatever bash said about it, that is the answer)
    if (lang === 'shell' && looksPyLine(line)) return PY_IN_TERMINAL;
    const rules = lang === 'python' ? PY_HELP : lang === 'shell' ? SHELL_HELP.concat(PY_HELP) : PY_HELP.concat(SHELL_HELP);
    const hits = [];
    for (const [re, say] of rules) {
      const m = re.exec(String(text || ''));
      if (!m) continue;
      let t = null;
      try {
        t = typeof say === 'function' ? say(m, String(text), line || '') : say;
      } catch (e) {
        t = null;
      }
      if (t && !hits.includes(t)) hits.push(t);
      if (hits.length >= 2) break;
    }
    return hits.length ? hits.join('\n\n') : null;
  }

  /* ------------------------------------------------------------------
     the services and their models
     ------------------------------------------------------------------ */
  const LIVE_DEFAULTS = {
    provider: CFG.liveProvider || 'gemini',
    model: CFG.anthropicModel || 'claude-sonnet-5-5',
    geminiModel: CFG.geminiModel || 'gemini-3.8-flash',
    baseURL: 'https://api.openai.com/v1',
    openaiModel: ''
  };
  /* the model of each service; an empty model in the saved settings means the site's default
     from config.js, so a model changed there (e.g. when one is retired) reaches every user
     who has not chosen a model of their own */
  const geminiModelOf = (s) => (s.geminiModel || LIVE_DEFAULTS.geminiModel).trim().replace(/^models\//, '');
  const anthropicModelOf = (s) => (s.model || LIVE_DEFAULTS.model).trim();
  const modelOf = (s) => (s.provider === 'gemini' ? geminiModelOf(s) : s.provider === 'anthropic' ? anthropicModelOf(s) : s.openaiModel || 'model');
  /** Gemini and Anthropic always need a key; an OpenAI-compatible server (e.g. a local one) may not */
  const needsKey = (s) => s.provider !== 'openai';
  /* A Gemini model can be busy (HTTP 503 "high demand"), give no answer at all, or be over one
     of its limits (429) – on the free tier each model has limits of its own, per minute and per
     day. Then the next model of this list is asked; the answer says which one replied.
     The page remembers what a model said, and does not ask it again before that can have
     changed: a busy model after two minutes (then four, eight … if it is busy again), a silent
     one after one minute, a model over a limit when the service says the limit is over (a limit
     per day: not before tomorrow), a model that was not found not at all. That saves time –
     "busy" can take twenty seconds to arrive – and requests, of which the free tier allows few.
     The memory belongs to one key – another key is another project, with limits of its own –
     and lasts until the page is loaded again. */
  const FALLBACK_DEFAULT = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const FALLBACKS = (Array.isArray(CFG.geminiFallbackModels) ? CFG.geminiFallbackModels : FALLBACK_DEFAULT).map((m) => String(m).trim().replace(/^models\//, '')).filter(Boolean);
  const BUSY = [500, 502, 503, 504, 529];
  const BUSY_REST = 120, SILENT_REST = 60; // seconds
  const RETRY = 20; // seconds after which it is worth asking busy or silent models again
  /* how long a Gemini model may say nothing – before its answer begins, or in the middle of it – until the request is given up */
  const WAIT = () => (+CFG.aiWaitSeconds > 0 ? Math.max(1, +CFG.aiWaitSeconds) : 60);
  const REST = new Map(); // model → { model, why: 'busy' | 'noanswer' | 'limit' | 'notfound', at, until (ms), daily, limit, n, status, text }
  let restKey = null;
  const resting = (model) => {
    const r = REST.get(model);
    return r && r.until > Date.now() ? r : null;
  };
  const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  /** what kept a model from answering: in a word or two (under an answer, in the bar) … */
  const skipWord = (x) => (x.why === 'notfound' ? 'not found' : x.why === 'limit' ? (x.daily ? 'over its limit for today' : 'over its limit') : x.why === 'noanswer' ? 'gave no answer' : x.why === 'broke' ? 'broke off' : 'busy');
  /** … and as part of a sentence – with the numbers that the service gave, unless short */
  const told = (x, short) =>
    x.why === 'notfound'
      ? 'was not found'
      : x.why === 'limit'
        ? x.daily
          ? (short || x.limit == null ? 'is over its limit for today' : `is over its daily limit of ${x.limit} requests`) + (short || !isFinite(x.until) ? '' : ` and can be used again after ${hhmm(x.until)}`)
          : 'is over its limit per minute'
        : x.why === 'noanswer'
          ? 'gave no answer'
          : 'is busy';
  /** the error when no Gemini model answered: what each one said. .status: 429 (limits), 503 (busy), 404, or not set
      (no answer came); .retryIn: after how many seconds asking again can help – 0 when it cannot today */
  function noAnswer(all, connection) {
    const some = (f) => all.some(f);
    const waits = all.filter((x) => x.why === 'limit' && !x.daily).map((x) => Math.min(90, Math.max(1, Math.ceil((x.until - Date.now()) / 1000))));
    if (some((x) => x.why === 'busy' || x.why === 'noanswer')) waits.push(RETRY);
    const retryIn = waits.length ? Math.min(...waits) : 0;
    // one model only (no fallback models): its own words
    if (all.length === 1) return Object.assign(new Error(all[0].text), { status: all[0].status, network: all[0].why === 'noanswer', retryIn });
    let status, lead;
    // (a model that answered within the last two minutes, if only with "busy" or "over its limit": the service can be reached)
    const heard = some((x) => x.status && Date.now() - x.at < 120000);
    if (connection || (some((x) => x.why === 'noanswer') && !some((x) => x.why === 'busy'))) lead = heard ? 'The Gemini API can be reached, but no answer came back. Try again in a moment.' : 'The Gemini API could not be reached (no answer came back). Check your internet connection and try again.';
    else if (some((x) => x.why === 'busy')) (status = 503), (lead = 'HTTP 503. Google’s servers are busy (“high demand”). This is a problem on Google’s side, not with your key. Wait a minute and try again.');
    else if (waits.length) (status = 429), (lead = 'HTTP 429. Too many requests. The free tier only allows a few requests per minute, so wait a minute and try again.');
    else if (some((x) => x.why === 'limit')) (status = 429), (lead = 'HTTP 429. There are no requests left for today, because every model that this page tries is over its limit for this key. On the free tier, each model allows a certain number of requests per day, counted per project. You can carry on when the service accepts requests again, or use a key from another person or project.');
    else (status = 404), (lead = 'HTTP 404. None of the models could be found. Check the model name in the AI settings (⚙).');
    return Object.assign(new Error(`${lead} (${all.map((x) => x.model + ' ' + told(x)).join('; ')}.)`), { status, network: !status, retryIn });
  }
  const stopped = () => new DOMException('Stopped', 'AbortError');

  /* ------------------------------------------------------------------
     the agent: what it may run, and where
     ------------------------------------------------------------------ */
  const AGENT_MAX = Math.max(5, +CFG.agentMaxSteps || 20); // steps per task
  const AGENT_OUT = 3000; // characters of each step's output that the model sees
  // a step of the agent that has not ended after this many seconds is stopped (config.js: agentCommandSeconds)
  const AGENT_SECONDS = Math.max(5, +CFG.agentCommandSeconds || 150);
  /* What the agent may not run: cd (each step starts in its folder, where programs put the files they make), exec,
     and R's console on its own (it waits for a person to type). Commands that act on the user's screen refuse the
     agent themselves (open, nano, download, clear: see shell-extra.js). Everything else of the terminal is the
     agent's to use. */
  const AGENT_DENY = new Set(['cd', 'pushd', 'popd', 'exec']);
  const AGENT_ALLOW = { has: (n) => !AGENT_DENY.has(n) };
  /** Does the text start R's console – R on its own, waiting for a person to type? R -e, R -f, R CMD BATCH, and R that
      reads its commands from a file, a here-document or a pipe do not wait. */
  function startsRConsole(text) {
    const SL = MG.shellLang;
    let list;
    try {
      list = SL.parse(text);
    } catch (e) {
      return false;
    }
    let found = false;
    const walkList = (l) =>
      l &&
      Array.isArray(l.items) &&
      l.items.forEach((a) => [a.first].concat((a.rest || []).map((r) => r && r.pipe)).forEach((pp) => pp && (pp.cmds || []).forEach((c, i) => walkCmd(c, i > 0))));
    const walkCmd = (c, piped) => {
      if (!c || typeof c !== 'object') return;
      if (c.type === 'simple') {
        const w = c.words || [];
        let k = 0;
        while (k < w.length && /^(command|env|time|nice|nohup)$/.test(w[k])) k++;
        if (w[k] !== 'R') return;
        const batch = w.slice(k + 1).some((x) => /^(-e|-f|--file(=.*)?|CMD|--version|--help|-h)$/.test(x));
        const input = piped || (c.redirs || []).some((r) => /^<(<<?)?$/.test(r.op || ''));
        if (!batch && !input) found = true;
        return;
      }
      // (compound commands – if, for, while, { }, ( ): the commands in them)
      for (const v of Object.values(c)) {
        if (Array.isArray(v)) v.forEach((x) => x && Array.isArray(x.items) && walkList(x));
        else if (v && typeof v === 'object' && Array.isArray(v.items)) walkList(v);
      }
    };
    walkList(list);
    return found;
  }
  /** why the agent may not run this text ('' if it may): a command in it that the agent has not got. The names are
      those that the shell itself reads in the text – also inside $( ), loops and pipes. Nothing of such a text is
      run. */
  function agentRefusal(text) {
    let names;
    try {
      names = MG.shellLang.commandNames(text);
    } catch (e) {
      return ''; // (not readable as shell: nothing of it runs, and the terminal says why)
    }
    const bad = names.filter((c) => AGENT_DENY.has(c)).filter((c, i, a) => a.indexOf(c) === i);
    if (bad.some((c) => /^(cd|pushd|popd)$/.test(c))) return 'cd is not available: every step starts in your folder. Use paths instead – relative to your folder, or ~/….';
    if (bad.length) return `${bad.map((b) => '`' + b + '`').join(', ')} ${bad.length > 1 ? 'are' : 'is'} not available to you.`;
    return '';
  }
  const SHELL_FENCE = ['', 'bash', 'sh', 'shell', 'console', 'zsh', 'shell-session', 'shellscript', 'terminal', 'cmd', 'command'];
  /** The command in an agent's reply: its first shell code block, as it was written ('' = empty block, null = none).
      A model sometimes begins its command on the line of the fence itself (```trace-digitiser fig.png), also after the name
      of a shell (```bash trace-digitiser fig.png) – a known command followed by more words; one word alone is the name of a
      language (```r, ```awk). And sometimes the whole command stands between two fences on one line. */
  function agentStep(reply) {
    const re = /```([^\n`]*)(?:\n([\s\S]*?)```|```)/g;
    let m;
    while ((m = re.exec(reply))) {
      const info = m[1].trim(), words = info.split(/\s+/).filter(Boolean);
      const shell = SHELL_FENCE.includes((words[0] || '').toLowerCase());
      let first = '';
      if (m[2] === undefined) {
        // (one line between two fences: a command if it begins with one – after the name of a shell, or not)
        if (shell && words.length > 1 && knownCommand(words[1])) first = info.slice(words[0].length).trim();
        else if (words.length && knownCommand(words[0])) first = info;
        else continue;
        return { cmd: first, before: withoutCode(reply.slice(0, m.index)), after: withoutCode(reply.slice(re.lastIndex)) };
      }
      if (shell) {
        if (words.length > 1 && knownCommand(words[1])) first = info.slice(words[0].length).trim();
      } else if (words.length > 1 && knownCommand(words[0])) first = info;
      else continue;
      const body = m[2]
        .replace(/\r/g, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\$\s+/, ''))
        .join('\n')
        .trim();
      // (before, after: what the reply says in front of the block of its command, and behind it)
      return { cmd: first ? first + (body ? '\n' + body : '') : body, before: withoutCode(reply.slice(0, m.index)), after: withoutCode(reply.slice(re.lastIndex)) };
    }
    return { cmd: null, before: '', after: '' };
  }
  /* A model sometimes goes on writing after the block of its command – its report, with what the command "showed",
     before the command has run. The reply is a step all the same; but what stands behind the block, when it is more
     than a remark, is not shown as the description of the step: the card says so, and the agent is told. */
  const AGENT_AHEAD = 120; // characters behind the block from which this holds
  const AGENT_AHEAD_TOLD = 'What you wrote after the code block was written before the command had run; it was not shown to the user. Send your report when you have read the output – without a code block.';
  // (what the agent is told, once in a task, when a reply has a code block that is no command)
  const AGENT_REMIND = 'Nothing was run: your reply had a code block, but not a ```bash block with a command. If you meant to run a command – Python code too goes into a script that python runs (written with a here-document), or into python -c – send it again in a ```bash block. If that was your report, send it again without any code block.';
  /** the commands of a block, one by one (a loop or an if … fi is one command) */
  function agentParts(cmd) {
    try {
      const parts = MG.shellLang.statements(cmd, { extglob: MG.shellLang.extglobOn(MG.app.term.shell._top()) });
      return parts.length ? parts : [cmd];
    } catch (e) {
      return [cmd];
    }
  }
  const withoutCode = (reply) => reply.replace(/```[\s\S]*?(```|$)/g, '').trim();
  // (for the tests)
  MG.agentRules = { deny: AGENT_DENY, refusal: agentRefusal, step: agentStep, command: (r) => agentStep(r).cmd, parts: agentParts, seconds: AGENT_SECONDS, max: AGENT_MAX, startsRConsole };
  const insideDir = (k, root) => k === root || k.startsWith(root + '/');
  // the agent's own folder, and /tmp, where the programs keep temporary files
  const agentMay = (k, root) => insideDir(k, root) || insideDir(k, '/tmp');
  /** every file entry outside the agent's folder, to put back what a command changed there */
  function outsideSnapshot(fs, root) {
    const m = new Map();
    for (const [k, v] of fs.entries) if (!agentMay(k, root)) m.set(k, v);
    return m;
  }
  /* A file that a program of the terminal wrote has its bytes in the programs' memory only. Two copies are taken
     before a step of the agent runs:
     - of the files outside the agent's folder, MG.wasm keeps one in that memory (keep) and writes it back after the
       step, where the step changed or removed the file (putBack);
     - of all such files – in the user's folders and in the agent's – the page holds one itself (holdBytes). If the
       programs have to be stopped by force (a command that does not end: the time limit, or Stop pressed twice),
       their memory is gone, and with it every file that a program wrote. Those that were there before the step are
       then written again from the page's copies: a forced stop costs the work of that step, and nothing else. */
  const AGENT_HOLD = 300 * 1024 * 1024; // bytes that the page holds at most (more than that: lost in a forced stop, and named)
  async function holdBytes(fs, held) {
    // (copies of files that are not there any more are let go)
    const live = new Set(fs.entries.values());
    for (const e of Array.from(held.keys())) if (!live.has(e)) held.delete(e);
    let total = 0;
    for (const b of held.values()) total += b.length;
    for (const [k, v] of Array.from(fs.entries)) {
      if (v.kind !== 'aioli' || held.has(v) || insideDir(k, '/tmp')) continue;
      if (total + (v.size || 0) > AGENT_HOLD) continue;
      try {
        const bytes = await fs.readBytes(k);
        held.set(v, bytes);
        total += bytes.length;
      } catch (e) {
        console.error(e);
      }
    }
  }
  /** After a step: what it changed outside the agent's folder is put back; after a forced stop of the programs, the
      files that programs had written before the step are written again.
      snap: the entries outside the folder before the step; keep: paths the user changed meanwhile (theirs);
      since, gen: when the step started, and MG.wasm.gen then; held: see holdBytes; before: every program-written
      file before the step (path → entry).
      → { changed: paths outside that were put back or removed again, lost: paths whose bytes could not be had, killed } */
  async function undoOutside(fs, root, snap, keep, since, gen, held, before) {
    const W = MG.wasm, changed = [], lost = [], back = [];
    const killed = !!W && W.gen !== gen;
    // 1. what the step made outside the folder goes
    for (const k of Array.from(fs.entries.keys())) {
      if (!agentMay(k, root) && !snap.has(k) && !keep.has(k)) {
        fs.entries.delete(k);
        changed.push(k);
      }
    }
    // 2. files that the step copied or moved, and that stay, get bytes of their own first
    if (W && W.ready && W.settle && !killed) {
      try {
        await W.settle(fs);
      } catch (e) {
        console.error(e);
      }
    }
    // 3. what was there before is put back
    for (const [k, v] of snap) {
      if (keep.has(k)) continue;
      const now = fs.entries.get(k);
      if (v.kind === 'aioli' && killed) {
        // (whatever is there now is not the user's file: it goes, and the file comes back below)
        if (now) {
          fs.entries.delete(k);
          changed.push(k);
        }
        continue;
      }
      if (now === v) continue;
      fs.entries.set(k, v);
      changed.push(k);
      if (v.kind !== 'aioli' || !W || !W.putBack) continue;
      let ok = false;
      try {
        ok = await W.putBack(k, v, since);
      } catch (e) {
        console.error(e);
      }
      if (!ok) {
        fs.entries.delete(k);
        back.push([k, v]);
      }
    }
    // 4. After a forced stop: the files that programs had written before the step. Outside the folder: all of them.
    //    Inside it: those that were still there, unchanged, when the programs were stopped – a file that the step
    //    itself had removed or written anew stays gone.
    if (killed && before) {
      const atStop = W.lostEntries || new Map();
      for (const [k, v] of before) {
        if (keep.has(k) || fs.entries.has(k)) continue;
        if (agentMay(k, root) && atStop.get(k) !== v) continue;
        back.push([k, v]);
      }
    }
    for (const [k, v] of back) {
      const bytes = held ? held.get(v) : null;
      let ok = false;
      if (bytes && W && W.writeBytes) {
        try {
          fs.mkdirp(MG.path.dirname(k));
          await W.writeBytes(fs, k, bytes);
          fs.touch(k, v.mtime); // (the file keeps the time it had: make and R's file.mtime() compare the times of files)
          ok = true;
        } catch (e) {
          console.error(e);
        }
      }
      if (!ok) lost.push(k);
    }
    changed.concat(lost).forEach((k) => fs._changed(k, !fs.entries.has(k) ? 'remove' : fs.entries.get(k).kind === 'dir' ? 'mkdir' : 'write'));
    return { changed, lost, killed };
  }
  /** a pause that the Stop button can cut short */
  const pause = (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      const stop = () => {
        clearTimeout(t);
        reject(new DOMException('Stopped', 'AbortError'));
      };
      if (signal && signal.aborted) stop();
      else if (signal) signal.addEventListener('abort', stop, { once: true });
    });

  /* ------------------------------------------------------------------
     the panel
     ------------------------------------------------------------------ */
  const CHAT_HELLO =
    'Ask me about digitising: the Digitise tab, trace-digitiser\'s options and its CHECK messages, an error, Python code, or what to do with the values once you have them. With each question I also receive the things you tick below the message box – the Digitise tab\'s settings and marks and the last run\'s messages, the notebook\'s code, your last terminal commands and the names of your files. **I never see your pictures**, nor the values read from them, nor what is in your files. You can send code from my answers to a notebook or the terminal with one click.\n\n**Check what I give you.** Run it, look at the result and make sure you understand it. AI models make mistakes, and they sound just as sure of themselves when they do.';
  const AGENT_HELLO =
    'Give me a complete task, for example *“Digitise /data/examples/hearn-whitmore-2026/figure-3c.png as points, compare the result with the known values, and plot the circular SD against the year”*. I will carry it out in the Terminal, one command at a time, working in my own folder (`~/ai-agent/run-…`), with `trace-digitiser`, `compare-known` and Python scripts. You can see every command and its output, and **Stop** ends the task.\n\nI can read your files, but any changes I make outside my folder are undone. I never see a picture – only what the programs print about it. Further tasks carry on in the same folder until you press **New**. Each run is saved as a record in its folder (`agent-record.md`), so check my results there rather than relying on my report alone.';
  const CHAT_STARTERS = [
    'What do the CHECK messages of my last run mean, and what should I do about them?',
    'How do I digitise a figure that has two y axes?',
    'How do I take a figure out of a PDF and digitise it?',
    'I have the values of a line in a CSV file now: how do I plot it and resample it to one value a month in Python?'
  ];
  const AGENT_TASKS = [
    'Digitise /data/examples/hearn-whitmore-2026/figure-3c.png as points, compare the table with the known values, and plot the circular SD against the year with its confidence intervals',
    'Digitise the bars of /data/examples/hearn-whitmore-2026/figure-1b.png and of the scanned copy figure-1b-scanned.jpg, and say how much the two differ',
    'Read Figure 2 of the examples (the birthogram) with 24 bins and its dots, and report the month with the highest value in each year',
    'Write a Python script that digitises every example figure of the right kind and writes a summary table of how close each is to the known values'
  ];
  /* the ticks under the box: what goes with a question */
  const CTX = [
    ['dg', 'the Digitise tab’s settings', 'The name and size of the picture open in the Digitise tab (never the picture itself), the kind of figure, your marks (plot areas, ticks and their values, colours), what trace-digitiser read from the axes, and the last run’s command line, CHECK messages and comparison with the known values (not the values read)', () => MG.app.digitise],
    ['nb', 'the notebook’s code', 'The code cells of the notebook that is open in the Notebook tab, but not their outputs or your data', () => MG.app.nbApp],
    ['term', 'my terminal commands', 'Your most recent commands in the Terminal and the end of what they printed. This can include values from your tables.', () => MG.app.term],
    ['files', 'my file names', 'The names and sizes of the files in your home folder, but not what is in them', () => true]
  ];
  const PLACE = { digitise: 'the Digitise tab', notebook: 'a notebook', terminal: 'the terminal' };
  /** an error that was asked about (a failed terminal command: by the command) */
  const errKey = (where, code, error) => (where === 'terminal' ? `terminal\n${String(code || '').trim()}` : `${where}\n${String(code || '').trim()}\n${String(error || '').trim()}`);
  /** the lines around the cursor, when a document is too long to send whole */
  function around(text, line, n, mark = '#') {
    if (text.length <= n) return text;
    const L = text.split('\n');
    line = Math.max(0, Math.min(L.length - 1, line || 0));
    let a = line, b = line + 1, size = (L[line] || '').length;
    while ((a > 0 || b < L.length) && size < n) {
      if (a > 0) size += L[--a].length + 1;
      if (b < L.length && size < n) size += L[b++].length + 1;
    }
    const pre = mark ? mark + ' ' : '';
    return (a > 0 ? `${pre}… (lines 1–${a} are left out)\n` : '') + L.slice(a, b).join('\n') + (b < L.length ? `\n${pre}… (lines ${b + 1}–${L.length} are left out)` : '');
  }

  class Assistant {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts || {};
      this.threads = {};
      this.msgs = { chat: [], agent: [] };
      this.busy = false;
      this.tab = 'chat';
      this.settings = Object.assign({}, LIVE_DEFAULTS, store.get('ai:settings', {}));
      delete this.settings.key; // (a key is never kept with the settings)
      this.ctxOpts = Object.assign({ dg: true, nb: true, term: true, files: true }, store.get('ai:context', {}));
      try {
        this.key = window.sessionStorage.getItem(KEY_NAME) || '';
      } catch (e) {
        this.key = '';
      }
      this.agentCtx = null; // the agent's folder and record while the conversation goes on (New starts another)
      this._step = null; // while a step of the agent runs: what the user changes meanwhile (see _onFsChange)
      this.asked = new Set(); // the errors asked about already (the "Explain my last error" chip)
      this._build();
      this.welcome('chat');
      this.welcome('agent');
      if (MG.app && MG.app.fs) MG.app.fs.onChange((p, what) => this._onFsChange(p, what));
      bus.on('py:files', (d) => this._onPyFiles(d));
    }
    /** the notebook tab, once it is built */
    get nb() {
      return this.opts.notebook || (MG.app && MG.app.nbApp) || null;
    }
    connected() {
      return !!this.key || !needsKey(this.settings);
    }
    /** the tab the user came to the assistant from (null: none yet) */
    cameFrom() {
      const cur = MG.app && MG.app.currentBench;
      const t = cur && cur !== 'assistant' ? cur : MG.app && MG.app.prevBench;
      return t && t !== 'assistant' ? t : null;
    }
    lastBench() {
      return this.cameFrom() || 'digitise';
    }

    _build() {
      const R = this.root;
      R.classList.add('ai');
      const tabs = h('div.ai-tabs', { role: 'tablist', 'aria-label': 'Chat or agent' });
      this.tabBtns = {};
      [
        ['chat', 'Chat', 'sparkle', 'Ask about digitising, trace-digitiser and Python. Code in the answers can be sent to a notebook or the terminal.'],
        ['agent', 'Agent', 'robot', 'Give the agent a task. It runs commands in the terminal (trace-digitiser, python), working in its own folder.']
      ].forEach(([k, label, ic, tip]) => {
        const b = h('button.ai-tab', { type: 'button', role: 'tab', title: tip, html: MG.icon(ic) + '<span>' + label + '</span>' });
        b.addEventListener('click', () => this.showTab(k));
        tabs.appendChild(b);
        this.tabBtns[k] = b;
      });
      this.modeEl = h('button.ai-mode', { type: 'button', title: 'The AI model in use. Click to change it or to add a key.' });
      this.modeEl.addEventListener('click', () => this.settingsDialog());
      const newBtn = h('button.tbtn', { type: 'button', title: 'Start a new conversation (on the Agent tab, the next task will then work in a new folder)', html: MG.icon('reset') + '<span>New</span>' });
      newBtn.addEventListener('click', () => this.newConversation());
      const moreBtn = h('button.tbtn', { type: 'button', title: 'More', 'aria-label': 'More', html: MG.icon('dots') });
      moreBtn.addEventListener('click', () => this.moreMenu(moreBtn));
      const setBtn = h('button.tbtn', { type: 'button', title: 'AI settings: choose the service and model, and enter your key', 'aria-label': 'AI settings', html: MG.icon('gear') });
      setBtn.addEventListener('click', () => this.settingsDialog());
      const body = h('div.ai-threads');
      ['chat', 'agent'].forEach((k) => {
        const t = h('div.ai-thread', { role: 'log', 'aria-live': 'polite', dataset: { tab: k } });
        this.threads[k] = t;
        body.appendChild(t);
      });
      this.sugg = h('div.ai-sugg');
      this.ctxRow = h('div.ai-ctx');
      this.input = h('textarea.ai-input', { rows: 2, 'aria-label': 'Message to the AI assistant' });
      this.sendBtn = h('button.btn.primary.ai-send', { type: 'button', title: 'Send (Enter; Shift+Enter for a new line)', html: MG.icon('send') + '<span>Send</span>' });
      this.sendBtn.addEventListener('click', () => (this._abort ? this.stopNow() : this.send()));
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          if (!this._abort) this.send();
        }
      });
      this.input.addEventListener('input', () => this._grow());
      R.append(h('div.ai-bar', tabs, this.modeEl, h('span.grow'), newBtn, moreBtn, setBtn), body, h('div.ai-foot', this.sugg, h('div.ai-inrow', this.input, this.sendBtn), this.ctxRow));
      this.renderMode();
      this.showTab('chat', true);
    }
    /** the box grows with what is typed (up to a point) */
    _grow() {
      const I = this.input;
      I.style.height = 'auto';
      if (I.value) I.style.height = Math.min(I.scrollHeight + 2, 160) + 'px';
      else I.style.height = '';
    }
    /** each time the tab is shown (page.js): the ticks and suggestions follow what is open now */
    shown() {
      this.renderSuggestions();
      this.renderCtx();
      if (!window.matchMedia('(max-width: 900px)').matches && !this.busy) setTimeout(() => this.input.focus({ preventScroll: true }), 30);
    }
    /** a prompt from the instructions (data-prompt): into the box, to be read, changed and sent */
    offerPrompt(text, opts = {}) {
      let tab = opts.tab;
      if (!tab) {
        const b = Array.from(document.querySelectorAll('[data-prompt]')).find((x) => x.dataset.prompt === text);
        tab = b && b.dataset.tab;
      }
      this.showTab(tab === 'agent' ? 'agent' : 'chat');
      this.input.value = String(text || '');
      this._grow();
      this.input.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }
    showTab(k, quiet) {
      this.tab = k;
      Object.entries(this.tabBtns).forEach(([n, b]) => {
        b.classList.toggle('on', n === k);
        b.setAttribute('aria-selected', String(n === k));
      });
      Object.entries(this.threads).forEach(([n, t]) => (t.hidden = n !== k));
      this.root.classList.toggle('agent', k === 'agent');
      this.input.placeholder = k === 'agent' ? 'Give the agent a task, e.g. “Digitise figure-3c.png of the examples as points and compare it with the known values”' : 'Ask about digitising, trace-digitiser, an error, Python…';
      this.renderSuggestions();
      this.renderCtx();
      if (!quiet) bus.emit('ai:tab', { tab: k });
    }
    renderMode() {
      const on = this.connected();
      this.modeEl.classList.toggle('live', on);
      this.modeEl.innerHTML = on ? `<span class="kdot ok"></span> ${esc(modelOf(this.settings))}` : '<span class="kdot"></span> Not connected';
    }
    showStatus() {
      this.renderMode();
    }
    welcome(tab) {
      if (!this.connected()) return this.setupCard(tab);
      return this.addBubble('assistant', tab === 'agent' ? AGENT_HELLO : CHAT_HELLO, { intro: true, tab });
    }
    /** the buttons under a message when no model is connected */
    setupActs(prompt) {
      const go = h('button.btn.small.primary', { type: 'button', html: MG.icon('key') + '<span>Connect a model</span>' });
      go.addEventListener('click', () => this.settingsDialog());
      const cp = h('button.btn.small', { type: 'button', title: 'Copy a prompt with your question and its context, to paste into an AI tool that you are allowed to use', html: MG.icon('copy') + '<span>Copy a prompt for another AI tool</span>' });
      cp.addEventListener('click', () => this.copyPrompt(prompt && prompt.question, prompt && prompt.extra));
      return h('div.ai-setup-acts', go, cp);
    }
    setupCard(tab) {
      const b = this.addBubble(
        'assistant',
        [
          '**Connect an AI model to use the assistant.** You need a key for an AI service, because the workbench doesn’t come with one.',
          '',
          '- **Google Gemini** has a free tier. You can create a key with a Google account at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (you must be 18 or over). On the free tier, Google may use what you send to improve its products.',
          '- You can also use a key for **Anthropic (Claude)** or for an **OpenAI-compatible** service, either your own or one you have been given.',
          '',
          'The key stays in this browser tab. It is never saved in a file, and it is only sent to the service you choose.',
          '',
          'The assistant never sees your pictures: only what you tick below the message box, which you can read first (⋯ → Copy a prompt).',
          '',
          tab === 'agent' ? '' : 'Without a key, you can still get short offline help with common messages. Paste an error message or a CHECK message into the box, or use one of the “Ask the AI” buttons that appear under errors.'
        ].join('\n'),
        { intro: true, tab }
      );
      b.classList.add('ai-setup');
      b.appendChild(this.setupActs());
      return b;
    }
    /** after the settings changed: the cards that ask for a key go, or come */
    refreshIntro() {
      ['chat', 'agent'].forEach((tab) => {
        const t = this.threads[tab];
        const on = this.connected();
        t.querySelectorAll('.ai-msg.ai-setup').forEach((x) => on && x.remove());
        if (on && !t.querySelector('.ai-msg.intro')) {
          if (!this.msgs[tab].length && !t.querySelector('.ai-msg')) t.innerHTML = '';
          this.welcome(tab);
        } else if (!on && !t.querySelector('.ai-setup')) this.setupCard(tab);
      });
    }

    /* ---------------- suggestions: the last error, and questions to start with ---------------- */
    /** an error in the tab the user came from, not asked about yet → {where, label, key, go} or null */
    recentError() {
      const where = this.cameFrom();
      const A = MG.app || {};
      let e = null;
      try {
        if (where === 'digitise' && A.digitise && (A.digitise.runError || (A.digitise.result && A.digitise.result.warnings.length))) {
          const D = A.digitise;
          const msg = D.runError || D.result.warnings[0];
          e = { where, x: { code: D.result ? D.result.command.text : D.kind, error: msg, warning: !D.runError }, msg, go: () => this.askAboutRun({}) };
        } else if (where === 'notebook' && this.nb && this.nb.view) {
          const v = this.nb.view, c = v.current;
          if (c && !v.foreign && (c.outputs || []).some((o) => o.type === 'error') && typeof v.cellInfo === 'function') {
            const info = v.cellInfo(c);
            e = { where, x: { code: info.code, error: info.error ? info.error.evalue : '' }, msg: info.error ? `${info.error.ename}: ${info.error.evalue}` : 'error', go: () => this.askAboutCell({ kind: 'fix', cell: info }) };
          }
        } else if (where === 'terminal' && A.term) {
          const last = (A.term.transcript || [])[(A.term.transcript || []).length - 1];
          if (last && last.code && last.code !== 130 && String(last.stderr || '').trim())
            e = { where, x: { code: last.line, error: last.stderr }, msg: last.stderr.trim().split('\n')[0], go: () => this.askAboutError({ line: last.line, output: (last.stdout || '') + (last.stderr || ''), error: last.stderr, cwd: last.cwd }) };
        }
      } catch (err) {
        console.error(err);
        e = null;
      }
      if (!e) return null;
      e.key = errKey(e.where, e.x.code, e.x.error);
      return this.asked.has(e.key) ? null : e;
    }
    renderSuggestions() {
      const S = this.sugg;
      S.innerHTML = '';
      if (this.tab === 'chat' && !this.busy) {
        const e = this.recentError();
        if (e) {
          const lines = String(e.msg || '').trim().split('\n');
          // (the message itself: after "Error in f(x) :", or the line after "Warning message:")
          const first = (e.x.warning ? lines.find((l, i) => i > 0 && l.trim()) || lines[0] : lines[0]).replace(/^(Error|Warning)( in .*?)?\s*:\s*/, '').replace(/^In .*? :\s*/, '');
          const what = e.x.warning ? 'the warning' : 'my last error';
          const label = `Explain ${what} (${tabName(e.where)})${first ? ': ' + (first.length > 60 ? first.slice(0, 57) + '…' : first) : ''}`;
          const b = h('button.chip.ai-errchip' + (e.x.warning ? '.warn' : ''), { type: 'button', title: `Ask about the ${e.x.warning ? 'warning' : 'error'} from the last command in the ${tabName(e.where)} tab`, html: MG.icon('sparkle') + '<span>' + esc(label) + '</span>' });
          b.addEventListener('click', () => {
            this.asked.add(e.key);
            e.go();
          });
          S.appendChild(b);
        }
      }
      if (this.msgs[this.tab].length) return; // (questions to start with: only before the first)
      const list = this.tab === 'agent' ? AGENT_TASKS : CHAT_STARTERS;
      S.appendChild(h('span.muted.small', this.tab === 'agent' ? 'Try a task:' : 'Try:'));
      list.forEach((p) => {
        const b = h('button.chip', { type: 'button', title: 'Put this into the message box. You can change it before you press Enter.' }, p);
        b.addEventListener('click', () => {
          this.input.value = p;
          this._grow();
          this.input.focus();
        });
        S.appendChild(b);
      });
    }
    renderCtx() {
      const R = this.ctxRow;
      R.innerHTML = '';
      if (this.tab === 'agent') {
        const c = this.agentCtx;
        const fs = MG.app.fs;
        R.appendChild(
          h('span', {
            html:
              c && fs.isDir(c.run)
                ? `The next task will carry on in <code>${esc(pretty(c.run))}</code>. Press <b>New</b> to start in a new folder.`
                : 'The agent will work in a new folder, <code>~/ai-agent/run-…</code>. Everything it reads and everything its commands print is sent to the AI service.'
          })
        );
        return;
      }
      R.appendChild(h('span', 'With your question, send:'));
      for (const [k, label, tip, open] of CTX) {
        // (only what is there to send: the tabs that have been opened)
        let there = false;
        try {
          there = !!open();
        } catch (e) {
          there = false;
        }
        if (!there) continue;
        const i = h('input', { type: 'checkbox', dataset: { ctx: k } });
        i.checked = !!this.ctxOpts[k];
        i.addEventListener('change', () => {
          this.ctxOpts[k] = i.checked;
          store.set('ai:context', this.ctxOpts);
        });
        R.appendChild(h('label', { title: tip }, i, ' ' + label));
      }
    }
    newConversation() {
      if (this.busy) return toast('The assistant is still busy. Press Stop first.', 'warn');
      const tab = this.tab;
      this.msgs[tab] = [];
      this.threads[tab].innerHTML = '';
      if (tab === 'agent') this.agentCtx = null;
      this.welcome(tab);
      this.renderSuggestions();
      this.renderCtx();
    }
    moreMenu(anchor) {
      MG.popmenu(
        anchor,
        [
          ['copy', 'Copy a prompt for another AI tool', () => this.copyPrompt()],
          ['download', 'Download this conversation (Markdown)', () => this.downloadConversation()],
          this.agentCtx && MG.app.fs.isDir(this.agentCtx.run) ? ['folder', 'Show the agent’s folder in Files', () => MG.app.revealFile(this.agentCtx.run)] : null,
          ['gear', 'AI settings', () => this.settingsDialog()]
        ].filter(Boolean)
      );
    }
    downloadConversation() {
      const tab = this.tab;
      const list = this.msgs[tab];
      if (!list.length) return toast('There is nothing to save yet.', 'warn');
      const lines = [`# AI assistant – ${tab === 'agent' ? 'agent tasks' : 'chat'}`, '', `${CFG.courseTitle || 'Digitiser workbench'} · ${new Date().toLocaleString('en-GB')} · ${modelOf(this.settings)}`, ''];
      if (tab === 'agent' && this.agentCtx) lines.push(`The agent's commands and their output are in \`${pretty(this.agentCtx.run)}/agent-record.md\`.`, '');
      for (const m of list) lines.push(m.role === 'user' ? '## You' : '## AI', '', m.content, '');
      MG.downloadText(lines.join('\n'), `ai-${tab}-${stamp()}.md`, 'text/markdown');
    }

    /* ---------------- messages ---------------- */
    addBubble(role, md, meta = {}) {
      const tab = meta.tab || this.tab;
      const b = h('div.ai-msg.' + role + (meta.intro ? '.intro' : ''));
      const body = h('div.ai-body');
      if (meta.origin) body.dataset.origin = meta.origin;
      if (role === 'user') body.textContent = md;
      else this.fill(body, md);
      b.appendChild(body);
      if (meta.badge) b.appendChild(h('div.ai-badge', { html: meta.badge }));
      this.threads[tab].appendChild(b);
      this.scroll(tab, true);
      return b;
    }
    /** to the end of the conversation – while an answer streams in, only if the user has not scrolled up to read */
    scroll(tab, force) {
      const t = this.threads[tab || this.tab];
      if (force || this.atEnd(tab)) t.scrollTop = t.scrollHeight;
    }
    /** is the conversation scrolled to (near) its end? (asked before an answer grows: then it follows the answer) */
    atEnd(tab) {
      const t = this.threads[tab || this.tab];
      return t.scrollHeight - t.scrollTop - t.clientHeight < 140;
    }
    fill(body, md) {
      body.innerHTML = '';
      const origin = body.dataset.origin || this.lastBench();
      for (const blk of mdBlocks(md)) {
        if (blk.html != null) body.insertAdjacentHTML('beforeend', blk.html);
        else body.appendChild(this.codeBox(blk, origin));
      }
      body.querySelectorAll('a[href]').forEach((a) => {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      });
      body.querySelectorAll('table').forEach((t) => {
        t.classList.add('ai-table');
        if (!t.parentElement.classList.contains('ai-tablewrap')) {
          const w = h('div.ai-tablewrap');
          t.replaceWith(w);
          w.appendChild(t);
        }
      });
    }
    /** an answer that streams in: drawn at most once a frame */
    painter(body, tab) {
      let pending = null, raf = 0;
      return (text) => {
        pending = text;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (pending == null) return;
          const follow = this.atEnd(tab);
          this.fill(body, pending + ' ▍');
          if (follow) this.scroll(tab, true);
        });
      };
    }
    /** what a code block is: 'r' | 'rmd' | 'bash' | 'python' | null (to save or copy) */
    kindOf(blk) {
      const lang = blk.lang || '';
      if (PY.test(lang)) return 'python';
      if (RL.test(lang)) return 'r';
      if (RMD.test(lang) || (/^(markdown|md)$/.test(lang) && /^\s*`{3,}\s*\{r/m.test(blk.code))) return 'rmd';
      if (SH.test(lang)) return 'bash';
      if (!lang && looksShell(blk.code)) return 'bash';
      if (!lang && looksPy(blk.code)) return 'python';
      if (!lang && looksR(blk.code)) return 'r';
      return null;
    }
    /** a code block of an answer, with buttons that put it to use – the first where the user came from */
    codeBox(blk, origin) {
      const lang = blk.lang || '';
      const kind = this.kindOf(blk);
      const code = kind === 'bash' ? shellCode(blk.code) : blk.code;
      const pre = h('pre.ai-code', h('code', blk.code));
      const label = blk.file || { r: 'R', rmd: 'R Markdown', bash: 'terminal', python: 'Python' }[kind] || lang;
      const head = label ? h('div.ai-code-head', label, (kind === 'r' || kind === 'rmd') && !blk.file ? h('span.ai-code-note', ' · R does not run in this workbench') : null) : null;
      const acts = h('div.ai-code-acts');
      const btn = (icon, text, fn, primary, tip, cls) => {
        const b = h('button.btn.small' + (primary ? '.primary' : '') + (cls || ''), { type: 'button', title: tip || '', html: (icon ? MG.icon(icon) : '') + '<span>' + esc(text) + '</span>' });
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await fn();
          } catch (e) {
            console.error(e);
            toast(esc(e.message || String(e)), 'error');
          } finally {
            b.disabled = false;
          }
        });
        return b;
      };
      const more = []; // the other ways, in the ⋯ menu
      if (blk.file) acts.appendChild(btn('save', 'Save as ' + blk.file, () => this.saveAs(blk.file, code), true, 'Save this as a file in your home folder and open it'));
      if (kind === 'python') {
        acts.appendChild(btn('notebook', 'Add to notebook', () => this.toNotebook(code, false), !blk.file, 'Add this code to the open notebook as a new cell'));
        more.push(['play', 'Add it to the notebook and run it', () => this.toNotebook(code, true)], ['terminal', 'Save it as a script and run it with python', () => this.runAsScript(blk, code)]);
        if (!blk.file) more.push(['save', 'Save it as a file…', () => this.saveAsAsk(blk, code)]);
      } else if (kind === 'bash') {
        const cmds = shellCommands(code);
        if (cmds.length) {
          acts.appendChild(btn('terminal', cmds.length > 1 ? `Run in the terminal (${cmds.length} commands)` : 'Run in the terminal', () => this.toTerminal(code, true), !blk.file, 'Run these commands in the Terminal tab'));
          if (cmds.length === 1 && !cmds[0].includes('\n')) acts.appendChild(btn('keyboard', 'Type in the terminal', () => this.toTerminal(cmds[0], false), false, 'Type the command at the prompt without running it, so that you can check it before you press Enter'));
        }
        if (!blk.file) acts.appendChild(btn('save', 'Save as…', () => this.saveAsAsk(blk, code), false, 'Save this as a file in your home folder (you can then run it as a script with bash FILE)'));
      } else if (!blk.file && !PLAIN.test(lang)) {
        acts.appendChild(btn('save', 'Save as…', () => this.saveAsAsk(blk), false, 'Save this as a file in your home folder'));
      }
      acts.appendChild(btn('copy', 'Copy', async () => ((await MG.copyText(blk.code)) ? toast('Copied.') : toast('Could not copy.', 'error')), false, 'Copy the code', '.ai-copy'));
      if (more.length) {
        const m = h('button.btn.small.ai-more', { type: 'button', title: 'More ways to use this code', 'aria-label': 'More ways to use this code', html: MG.icon('dots') });
        m.addEventListener('click', () =>
          MG.popmenu(
            m,
            more.map(([ic, text, fn]) => [ic, text, () => Promise.resolve().then(fn).catch((e) => (console.error(e), toast(esc(e.message || String(e)), 'error')))])
          )
        );
        acts.appendChild(m);
      }
      return h('div.ai-codebox' + (kind ? '.k-' + kind : ''), head, pre, acts);
    }

    /* ---------------- code into the workbench ---------------- */
    async _riskyPy(code, what) {
      if (!RISKY_PY.test(code)) return true;
      return ask('Run this code?', `<p>This code deletes, moves or renames files, so check the file names first. A deleted file cannot be recovered.</p><pre class="ai-code">${esc(code)}</pre>`, what || 'Run it');
    }
    /** Python code into a notebook, run or not */
    async toNotebook(code, run) {
      if (run && !(await this._riskyPy(code))) return;
      if (!MG.app.toNotebook) throw new Error('The notebook is not available.');
      await MG.app.toNotebook(code, 'python', run);
      bus.emit('ai:insert', { target: 'notebook', lang: 'python', run: !!run });
    }
    /** Python code saved as a script (its file name, or one asked for) and run with python in the terminal */
    async runAsScript(blk, code) {
      if (!(await this._riskyPy(code))) return;
      let file = blk.file;
      if (!file) {
        file = await MG.promptText('Save as a script', 'A file name or a path for the script. It is saved in your home folder (~), then run with python in the Terminal.', 'ai-' + stamp().slice(11) + '.py', 'Save and run');
        if (!file || !file.trim()) return;
        file = file.trim();
      }
      const path = this.resolvePath(file);
      MG.app.fs.mkdirp(MG.path.dirname(path));
      MG.app.fs.writeText(path, String(code).replace(/\s+$/, '') + '\n');
      await this.toTerminal(`python ${pretty(path)}`, true);
    }
    /** commands into the terminal: typed at the prompt, or run one after the other (until one fails) */
    async toTerminal(code, run) {
      if (MG.app.term && MG.app.term.locked) return toast('The agent is using the terminal. Wait until it has finished, or press Stop.', 'warn');
      if (run && RISKY.test(code) && !(await ask('Run these commands?', `<p>These commands delete, move or overwrite files, so check the file names first. Anything that is deleted cannot be recovered.</p><pre class="ai-code">${esc(code)}</pre>`, 'Run them'))) return;
      await MG.app.showWorkbench('terminal');
      const T = await waitFor(() => MG.app.term);
      if (!T) throw new Error('The terminal could not start.');
      const cmds = shellCommands(code);
      if (!run) {
        await T.type(cmds[0] || code, false);
        bus.emit('ai:insert', { target: 'terminal', run: false });
        return;
      }
      for (let i = 0; i < 100 && T.busy; i++) await sleep(100);
      if (T.busy) return toast('The terminal is still busy. Wait for the command that is running to finish.', 'warn');
      for (let i = 0; i < cmds.length; i++) {
        const st = await (cmds.length === 1 ? T.type(cmds[i], true) : T.exec(cmds[i]));
        const left = cmds.length - i - 1;
        if (st && left) {
          toast(`A command failed (exit status ${st}), so the ${left === 1 ? 'command after it was' : left + ' commands after it were'} not run.`, 'warn', 6000);
          break;
        }
      }
      bus.emit('ai:insert', { target: 'terminal', run: true });
    }
    resolvePath(file) {
      const rel = file.replace(/^\.\//, '');
      return rel.startsWith('/') ? rel : rel.startsWith('~/') ? HOME() + rel.slice(1) : HOME() + '/' + rel;
    }
    async saveAs(file, code) {
      const fs = MG.app.fs;
      const path = this.resolvePath(file);
      const e = fs.get(path);
      if (e && (e.readonly || e.protected)) return toast(esc(pretty(path)) + ' is read-only, so save it under a different name.', 'error');
      if (e && e.kind === 'dir') return toast(esc(pretty(path)) + ' is a folder. Choose a different name for the file.', 'error');
      if (e) {
        const old = await fs.readText(path);
        if (old.trim() !== code.trim() && !(await ask('Replace the file?', `<p><b>${esc(pretty(path))}</b> already exists. Do you want to replace its contents with the assistant’s version?</p>`, 'Replace'))) return;
      }
      fs.mkdirp(MG.path.dirname(path));
      fs.writeText(path, code.replace(/\s+$/, '') + '\n', /\.(sh|bash|py)$/i.test(path) && /^#!/.test(code) ? { mode: 'x' } : undefined);
      await MG.app.editFile(path, { line: 1 });
      toast(`Saved <b>${esc(pretty(path))}</b>.`, 'ok', 3000);
      bus.emit('ai:insert', { target: 'file', path });
    }
    async saveAsAsk(blk, code) {
      const ext = EXT[blk.lang] || (this.kindOf(blk) === 'python' ? '.py' : this.kindOf(blk) === 'bash' ? '.sh' : this.kindOf(blk) === 'r' ? '.R' : '.txt');
      const def = 'ai-' + stamp().slice(11) + ext;
      const name = await MG.promptText('Save as', 'Enter a file name or a path. The file is saved in your home folder (~).', def, 'Save');
      if (name && name.trim()) await this.saveAs(name.trim(), code != null ? code : blk.code);
    }

    /* ---------------- sending ---------------- */
    async send(text) {
      const q = (text != null ? text : this.input.value).trim();
      if (!q) return;
      if (this.busy) {
        toast('The assistant is still busy. Wait for it to finish, or press Stop.', 'warn');
        return;
      }
      const tab = this.tab;
      if (!this.connected()) {
        // (an error message in the box: what it usually means – offline)
        const help = tab === 'chat' ? offlineHelp(q, 'any') : null;
        if (!help) return this.noModel();
        if (text == null) {
          this.input.value = '';
          this._grow();
        }
        this.addBubble('user', q);
        this.offlineReply(`What that message usually means:\n\n${help}`, { question: q });
        return;
      }
      if (text == null) {
        this.input.value = '';
        this._grow();
      }
      this.addBubble('user', q, { tab });
      this.msgs[tab].push({ role: 'user', content: q });
      this.renderSuggestions();
      bus.emit('ai:ask', { tab, source: text == null ? 'typed' : 'button' });
      if (tab === 'agent') return this.liveAgent(q);
      return this.live(q);
    }
    noModel() {
      toast('Connect an AI model first, in the AI settings (⚙).', 'warn', 4000);
      const card = this.threads[this.tab].querySelector('.ai-setup');
      if (!card) return this.setupCard(this.tab);
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1400);
    }
    /** an answer of the offline help, with the ways to a real one */
    offlineReply(md, prompt) {
      const b = this.addBubble('assistant', md + '\n\n*Offline help – no AI model is connected.*', { badge: 'offline help', tab: 'chat' });
      b.classList.add('offline');
      b.appendChild(this.setupActs(prompt));
      bus.emit('ai:offline', {});
      return b;
    }
    /** Stop. While the agent runs a command in the terminal, the first press lets the program that is running finish
        and skips the rest; a second press stops that program by force (what programs had written is then lost). */
    stopNow() {
      if (this._abort) this._abort.abort();
      const T = MG.app.term;
      if (this._agentLive && T && T.busy) T.stop();
    }

    /* ---------------- asked from the terminal, a notebook or another tab ---------------- */
    _toChat() {
      if (MG.app && MG.app.currentBench !== 'assistant' && MG.app.showWorkbench) MG.app.showWorkbench('assistant');
      if (this.tab !== 'chat') this.showTab('chat');
    }
    /** term:ask – a command in the terminal failed: {line, output, error, cwd} */
    async askAboutError(d) {
      d = d || {};
      this._toChat();
      if (this.busy) return toast('The assistant is still answering. Try again in a moment.', 'warn');
      const err = (d.error || d.output || '').trim();
      const short = err.split('\n').slice(-12).join('\n');
      const q = `My command failed:\n$ ${d.line}\n${short}`;
      this.asked.add(errKey('terminal', d.line));
      this.addBubble('user', q);
      if (!this.connected()) {
        const help = offlineHelp(d.line + '\n' + (d.output || '') + '\n' + (d.error || ''), 'shell', d.line);
        this.offlineReply(help ? `What that message usually means:\n\n${help}` : 'Read the **last lines** of the message first, because they usually name the problem. Then check the file names and the folder you are in (`pwd`, `ls`).', { question: 'Why did this command fail, and how do I fix it?', extra: { error: d } });
        return;
      }
      this.msgs.chat.push({ role: 'user', content: q });
      this.renderSuggestions();
      return this.live(q, { error: d, where: 'terminal' });
    }
    /** nb:ask – "Ask AI" on a notebook cell: {kind: 'explain' | 'improve' | 'fix', cell: {code, error, output, path …}} */
    async askAboutCell(d) {
      d = d || {};
      this._toChat();
      if (this.busy) return toast('The assistant is still answering. Try again in a moment.', 'warn');
      const c = d.cell || {};
      const what = d.kind === 'fix' ? 'Explain this error and how to fix it.' : d.kind === 'improve' ? 'How could this code be improved or extended?' : 'Explain what this code does.';
      const src = String(c.code || '');
      const shortCode = src.length > 600 ? src.slice(0, 600) + '\n…' : src;
      const q = `${what}\n\n${shortCode}${d.kind === 'fix' && c.error ? `\n\n${c.error.ename}: ${c.error.evalue}` : ''}`;
      if (c.error) this.asked.add(errKey('notebook', src, c.error.evalue));
      this.addBubble('user', q);
      if (!this.connected()) {
        let reply;
        const e = c.error;
        if (d.kind === 'fix' && e) {
          const help = offlineHelp(`${e.ename}: ${e.evalue}\n${e.traceback || ''}`, 'python');
          reply = `**${e.ename}**${e.evalue ? ': ' + e.evalue : ''}\n\n${help || 'Read the last line of the message first, because it names the problem. The line it points to is where Python noticed it, but the mistake itself may be just above it.'}`;
        } else reply = 'Explaining or improving code needs an AI model. Connect one (Google Gemini has a free tier), or copy a prompt containing this cell into an AI tool that you are allowed to use.';
        this.offlineReply(reply, { question: what, extra: { cell: c } });
        return;
      }
      this.msgs.chat.push({ role: 'user', content: q });
      this.renderSuggestions();
      return this.live(q, { cell: c, where: 'notebook' });
    }
    /** dg:ask – the Digitise tab's last run failed, or warned: the question is about it */
    async askAboutRun(d) {
      d = d || {};
      const D = MG.app && MG.app.digitise;
      if (!D) return;
      this._toChat();
      if (this.busy) return toast('The assistant is still answering. Try again in a moment.', 'warn');
      const R = D.result;
      const msgs = D.runError ? [D.runError] : R ? R.warnings : [];
      const q = D.runError
        ? `Digitising failed in the Digitise tab:\n\n${D.runError}\n\nWhat does it mean, and what should I do?`
        : `My last run in the Digitise tab gave ${msgs.length === 1 ? 'this message' : 'these messages'}:\n\n${msgs.map((m) => '- ' + m).join('\n')}\n\nWhat do they mean, and do I need to do anything about them?`;
      this.asked.add(errKey('digitise', R ? R.command.text : D.kind, msgs[0] || ''));
      this.addBubble('user', q);
      if (!this.connected()) {
        const help = offlineHelp(msgs.join('\n'), 'python');
        this.offlineReply(help || 'Look at what was found, drawn in pink over the picture: the CHECK messages say what trace-digitiser was unsure of. Mark what it needs – a plot area, two ticks on an axis, a colour – and digitise again.', { question: 'What do these messages mean?', extra: { where: 'digitise' } });
        return;
      }
      this.msgs.chat.push({ role: 'user', content: q });
      this.renderSuggestions();
      return this.live(q, { where: 'digitise' });
    }

    /* ---------------- the chat ---------------- */
    systemPrompt() {
      return [
        'You are the AI assistant of the Digitiser workbench: a website where people – researchers, students – learn to read the values out of graphs in papers (digitising) with trace-digitiser, a Python package, and use them. Everything runs in their web browser; nothing is installed, and no picture is uploaded anywhere. You never see their pictures: only descriptions of them (sizes, what trace-digitiser found, its messages).',
        '',
        'The ways of working here (the tabs of the workbench):',
        '- Digitise: the picture of a graph, with tools to mark it (plot areas, regions to leave out, ticks and their values, colours, a colour bar, a polar plot\'s centre and rings, points to take out or add), a choice of the kind of figure and its options, and Digitise, which runs trace-digitiser and draws what it found over the picture, with its CHECK messages, a table, the files written, and the command line and the Python that do the same.',
        '- Notebook: Jupyter-style Python notebooks (.ipynb), with trace-digitiser, pandas, NumPy and Matplotlib.',
        '- Terminal: a bash-like shell with trace-digitiser, compare-known and python.',
        '- Files: a file browser and editor. AI assistant: you.',
        '',
        'The environment:',
        ...envLines(),
        '',
        'How to answer:',
        '- Be brief, clear and friendly; write in British English unless the user writes in another language. Explain what an option or a line of code does, and why: they are learning.',
        "- To fix a digitisation, prefer telling them what to mark or set in the Digitise tab (a plot area, two ticks and their values, a colour, a region to leave out, the kind of figure) – and give the trace-digitiser command or Python that does the same when it helps. Use only options that exist (see above).",
        '- For a CHECK message or an error: say in plain words what it means, point to the cause, and say how to fix it and how to check the result (the pink overlay; for the examples, the comparison with the known values).',
        '- Put Python in ```python blocks and terminal commands in ```bash blocks: each block gets buttons that add it to a notebook or run it in the terminal. To offer a file, put its path after the language: ```python scripts/plot_points.py',
        "- Never invent functions, arguments, options or results. If you are not sure, say so, and say how to check (help(td.digitise_points), trace-digitiser points --help).",
        '- Do not claim to have seen the picture, run code or seen results that the user has not shown you.',
        '- Digitising a figure to analyse its values is generally fine; reproducing a copyrighted figure is another matter: if asked, suggest citing the source and asking the publisher.'
      ].join('\n');
    }
    /** what the model gets with a question, besides the conversation: what is ticked, of the tabs that are open */
    async contextFor(extra = {}) {
      const parts = [];
      const fs = MG.app.fs;
      const A = MG.app || {};
      const came = extra.where || this.cameFrom();
      const big = (tab) => came === tab;
      parts.push(extra.where ? `(The user asks about something in the ${tabName(extra.where)} tab.)` : came ? `(The user came to the AI tab from the ${tabName(came)} tab.)` : '(The user has not used another tab of the workbench yet.)');
      try {
        if (extra.error) {
          const e = extra.error;
          parts.push(`The command that failed in the terminal, run in ${pretty(e.cwd || fs.cwd)}: \`${e.line}\`. The end of what it printed:\n${fence(String(e.output || '').slice(-3000), 'text')}`);
        }
        if (extra.cell) {
          const c = extra.cell;
          parts.push(`The user asks about this cell of the Python notebook ${pretty(c.path || '')}:\n${fence(c.code, 'python')}`);
          if (c.error) parts.push(`It raised:\n${fence(String(c.error.traceback || c.error.ename + ': ' + c.error.evalue).slice(-2500), 'text')}`);
          else if (c.output) parts.push(`What it printed (the beginning):\n${fence(String(c.output).slice(0, 1200), 'text')}`);
        }
        // the Digitise tab: what is marked and set, and the last run – never the picture, nor the values read
        if ((this.ctxOpts.dg || extra.where === 'digitise') && A.digitise && A.digitise.describeForAI) {
          const t = A.digitise.describeForAI();
          if (t) parts.push('The Digitise tab (the picture itself is not sent):\n' + fence(t, 'text'));
        }
        // the notebook
        const v = this.nb && this.nb.view;
        if (this.ctxOpts.nb && v && typeof v.codeContext === 'function') {
          const code = v.codeContext(big('notebook') ? 4000 : 2000);
          if (code) parts.push(`The notebook open in the Notebook tab: ${pretty(v.path)} (${v.foreign ? `a ${v.langName || v.lang} notebook – its code cannot run here` : `Python; its code runs in ${pretty(MG.path.dirname(v.path))}`}). Its code cells:\n${fence(code, v.foreign ? v.lang : 'python')}`);
        }
        // the terminal
        if (this.ctxOpts.term && A.term && !extra.error) {
          const recent = (A.term.transcript || []).slice(big('terminal') ? -3 : -2);
          if (recent.length) parts.push('The last commands in the Terminal tab, and the end of what they printed:\n' + fence(recent.map((e) => `${pretty(e.cwd)}$ ${e.line}${e.code ? `   (exit status ${e.code})` : ''}\n${String((e.stdout || '') + (e.stderr || '')).slice(-600).replace(/\s+$/, '')}`).join('\n'), 'text'));
        }
        if (this.ctxOpts.files) {
          const list = this.fileList(60);
          if (list) parts.push(`The user's files (names and sizes only):\n${list}`);
        }
      } catch (e) {
        console.error(e);
      }
      // (the name the person gave the workbench stays in the browser: "user" where it names the user – ls -l, whoami …)
      return MG.user.mask(parts.join('\n\n')) + '\n\n';
    }
    /** the user's files: names and sizes, two folders deep */
    fileList(max = 60) {
      const fs = MG.app.fs, out = [];
      let more = 0;
      const walk = (dir, depth) => {
        for (const c of fs.list(dir)) {
          if (c.name.startsWith('.') || (c.entry && c.entry.hidden)) continue;
          const isDir = c.entry.kind === 'dir';
          if (out.length >= max) {
            more++;
            continue;
          }
          out.push(`${'  '.repeat(depth + 1)}${c.name}${isDir ? '/' : ` (${MG.humanSize(fs.size(c.entry))}B)`}`);
          if (isDir && depth < 1) walk(c.path, depth + 1);
        }
      };
      try {
        walk(HOME(), 0);
      } catch (e) {
        return '';
      }
      return out.length ? `~/\n${out.join('\n')}${more ? `\n  … and ${more} more` : ''}` : '';
    }
    async live(q, extra) {
      extra = extra || {};
      this.busy = true;
      this._abort = new AbortController();
      this.sendBtn.innerHTML = MG.icon('stop') + '<span>Stop</span>';
      this.renderSuggestions();
      const b = this.addBubble('assistant', '', { tab: 'chat', origin: extra.where || this.lastBench() });
      const body = b.querySelector('.ai-body');
      body.innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>';
      const hist = this.msgs.chat.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      while (hist.length && hist[0].role !== 'user') hist.shift();
      if (hist.length) hist[hist.length - 1] = { role: 'user', content: (await this.contextFor(extra)) + 'Question: ' + hist[hist.length - 1].content };
      let text = '';
      const paint = this.painter(body, 'chat');
      const t0 = performance.now();
      try {
        const res = await this.streamLive(
          hist,
          (delta) => {
            text += delta;
            paint(text);
          },
          this._abort.signal,
          {
            onReset: () => {
              text = '';
              paint('');
            }
          },
          (note) => {
            if (!text) body.innerHTML = `<div class="muted small" style="margin-bottom:0.35em">${esc(note)}</div><span class="ai-typing"><i></i><i></i><i></i></span>`;
          }
        );
        // a reply with nothing in it is not kept as a turn of the conversation: it is reported, and the question can be asked again
        if (!text.trim()) throw Object.assign(new Error(`${res.model} sent an empty reply. Please ask again, as a second try usually gets an answer.`), { empty: true });
        paint(null);
        const follow = this.atEnd('chat');
        this.fill(body, text);
        const via = res.skipped.length ? ` (${res.skipped.map((x) => x.model + ' ' + skipWord(x)).join(', ')})` : '';
        b.appendChild(h('div.ai-badge', { html: `${esc(res.model + via)} · ${((performance.now() - t0) / 1000).toFixed(1)} s` }));
        if (follow) this.scroll('chat', true);
        this.msgs.chat.push({ role: 'assistant', content: text });
        bus.emit('ai:answer', { model: res.model });
      } catch (e) {
        paint(null);
        if (e.name === 'AbortError') {
          this.fill(body, (text || '') + '\n\n*(stopped)*');
          if (text) this.msgs.chat.push({ role: 'assistant', content: text });
        } else {
          this.fill(body, (e.empty ? '' : '**The AI service returned an error.**\n\n') + e.message);
          b.classList.add('err');
        }
      } finally {
        this.busy = false;
        this._abort = null;
        this.sendBtn.innerHTML = MG.icon('send') + '<span>Send</span>';
        this.scroll('chat');
        this.renderSuggestions();
      }
    }

    /* ---------------- the agent ---------------- */
    agentPrompt(run) {
      return [
        "You are an AI agent in the Digitiser workbench, a website where people learn to read the values out of graphs in papers with trace-digitiser; everything runs in the user's web browser. You carry out the user's task by running shell commands, one step at a time, in its terminal. You never see pictures: only what the programs print about them.",
        '',
        'How to work:',
        '- In each reply, say in one or two short sentences what you will do next and why, then give ONE step in a ```bash code block – a command, or a few that belong together, one per line – and stop. You then get the exit status and the output. If a command of the block fails, the ones after it are not run.',
        "- Digitise with the command line: trace-digitiser FIGURE.png -o out (lines), trace-digitiser points|bars|rows|heatmap|polar FIGURE.png [options] -o out; read its CHECK lines. trace-digitiser describe FIGURE.png prints what it finds (plot areas, tick labels read, colours) as JSON – use it to choose options. compare-known out/TABLE.csv checks a table digitised from one of the examples.",
        "- Python goes into a script, written with a here-document and run with python – for example:\n  cat > plot.py << 'EOF'\n  import pandas as pd, matplotlib.pyplot as plt\n  d = pd.read_csv('out/figure-3c_points.csv')\n  plt.errorbar(d.y_value, d.x_value, yerr=[d.x_value - d.x_error_low, d.x_error_high - d.x_value], fmt='o')\n  plt.savefig('plot.png', dpi=120)\n  EOF\n  python plot.py\n  python -c '…' is for a line or two. Each python run is a new Python: write results to files.",
        '- Base each next step on the output you got. If a command fails, read the error and change your approach. Check what you make (head, wc -l, cat, ls -l) before you report it.',
        '- Do not ask the user questions – nobody can answer during the task. Make sensible choices, say which, and carry on.',
        `- You can take at most ${AGENT_MAX} steps for a task.`,
        '- When the task is done, or cannot be done, reply WITHOUT a code block: what you did (in short), the files you made (with their paths) and what the results show. Report only what the outputs showed – never invent results, numbers or files.',
        '',
        'Your environment:',
        `- Your folder is ${pretty(run)} (= ${run}). Every step starts there, and cd is not available: use paths. Write files only inside your folder – changes anywhere else are undone after each step. You may read files anywhere: the user's files in ~ and the examples in ${EXDIR}. agent-record.md in your folder is the record of your work: leave it alone.`,
        ...envLines(),
        `- Each step's output is shortened to its last ${AGENT_OUT} characters. A step that has not ended after ${AGENT_SECONDS} seconds is stopped.`,
        "- Commands that act on the user's screen (open, nano, download, clear, digitise) are not available to you."
      ].join('\n');
    }
    /** one turn of the agent: the model's reply (free-tier limits: wait and ask again, up to 3 times) */
    async agentAsk(hist, run, signal, note, onText) {
      for (let waited = 0; ; waited++) {
        let text = '';
        try {
          const res = await this.streamLive(
            hist,
            (d) => {
              text += d;
              onText(text);
            },
            signal,
            {
              settings: this.settings,
              key: this.key,
              system: this.agentPrompt(run),
              onReset: () => {
                text = '';
                onText('');
              }
            },
            note
          );
          return { text, model: res.model };
        } catch (e) {
          // no model answered. Waiting helps when a limit per minute is reached, the servers are busy or the connection
          // gave no answer (the error says after how many seconds: retryIn) – up to three times for one reply. It does
          // not help when every model is over its limit for today, or the key is not accepted: the task ends at once.
          const wait = e.name !== 'AbortError' && e.retryIn > 0 ? Math.round(Math.min(90, Math.max(5, e.retryIn))) : 0;
          if (wait && waited >= 3) e.message += (e.status === 429 ? ' The page waited and tried again three times, but the limit has still been reached. Perhaps many people are using the same key at once.' : e.status ? ' The page waited and tried again three times, but the service is still busy.' : ' The page waited and tried again three times, but there was still no answer.') + ' Please try again later' + (e.status ? ', or use a key from another person or project (limits are counted per project, not per key).' : '.');
          if (!wait || waited >= 3) throw e;
          for (let t = wait; t > 0; t--) {
            note(`${e.status === 429 ? 'The service only allows a few requests per minute' : e.status ? 'The service is busy' : 'No answer came from the service'} – waiting ${t} s before asking again (press Stop to end the task)…`);
            await pause(1000, signal);
          }
          note('');
        }
      }
    }
    agentCard(title) {
      const card = h('div.ai-msg.assistant.ag');
      const head = h('div.ag-head', { html: MG.icon('robot') + '<b>' + esc(title) + '</b>' });
      const steps = h('ol.ag-steps');
      card.append(head, steps);
      this.threads.agent.appendChild(card);
      this.scroll('agent', true);
      return { card, steps };
    }
    /** run a command in the terminal (as the agent) and capture what it printed */
    async termRun(cmd, opts) {
      const T = MG.app.term;
      for (let i = 0; i < 600 && T.busy; i++) await sleep(100);
      const before = T.outEl.children.length;
      const code = await T.exec(cmd, opts);
      const els = Array.from(T.outEl.children).slice(before + 1);
      const text = els.filter((x) => !x.classList.contains('ask')).map((x) => x.textContent + (x.classList.contains('note') ? '\n' : '')).join('');
      // (what goes to the AI service: the agent runs as "user" – and where the person's name still names the user in
      // what it printed, a log of the person's with the output of whoami or ls -l in it, "user" takes its place)
      return { code, text: opts && opts.agent ? MG.user.mask(text) : text };
    }
    /** While a step of the agent runs, a change to a file that its command did not reach – a notebook saved, a file
        edited in Files, a mark in the Digitise tab – is the user's: it is not undone after the step. (The terminal
        notes every path that the agent's command works out: T.touched.) */
    _onFsChange(path, what) {
      const s = this._step;
      if (!s || insideDir(path, s.run)) return;
      const T = MG.app.term;
      const touched = T && T.touched;
      if (touched && touched.has(path)) return;
      if (touched && what === 'mkdir') for (const t of touched) if (t.startsWith(path + '/')) return;
      s.saved.add(path);
    }
    /** What the Python of the agent's command (python, trace-digitiser) wrote or removed comes back into the page's
        files after the run, not through the terminal – so it is not among T.touched. It is the agent's doing all the
        same: what it changed outside the agent's folder is undone (with the folders it made for it). */
    _onPyFiles(d) {
      const s = this._step;
      const T = MG.app.term;
      if (!s || !d || !(T && T.agentCmd)) return;
      for (const p of [].concat(d.files || [], d.removed || [])) {
        s.saved.delete(p);
        for (const k of Array.from(s.saved)) if (p.startsWith(k + '/')) s.saved.delete(k);
      }
    }
    /** the record of the agent's work in a folder, as a Markdown file: the tasks, each step's commands and output, and
        the reports. (Not a notebook: the steps are shell commands.) */
    saveRecord(ctx) {
      const fs = MG.app.fs;
      if (!fs.isDir(ctx.run)) return null;
      const path = ctx.run + '/agent-record.md';
      const where = pretty(ctx.run);
      const out = [
        `# AI agent – ${where}`,
        '',
        `This file records the tasks given to the AI agent in the ${CFG.courseTitle || 'Digitiser workbench'}, the steps it ran in the terminal, and their output as the agent saw it (shortened). Every step ran in \`${where}\`, the folder that contains this file. **Check the results yourself**, because an agent can be wrong and its report can claim more than the output shows.`,
        '',
        `To run a step again, type \`cd ${where}\` in the Terminal, followed by the step's commands.`
      ];
      ctx.tasks.forEach((t, i) => {
        out.push('', `## Task ${i + 1}`, '', quote(t.task), '', `*${new Date(t.t).toLocaleString('en-GB')} · ${t.models.join(', ') || modelOf(this.settings)} · ${t.steps.length} step${t.steps.length === 1 ? '' : 's'}*`);
        t.steps.forEach((s, k) => {
          out.push('', `### Step ${k + 1}`, '');
          if (s.say) out.push(quote(s.say), '');
          out.push(fence(s.cmd, 'bash'), '');
          if (s.refused) {
            out.push(`*Not run – ${s.refused}*`);
            return;
          }
          const o = s.out.length > 20000 ? s.out.slice(0, 8000) + '\n… (shortened) …\n' + s.out.slice(-8000) : s.out;
          out.push(`Exit status ${s.code}${o.trim() ? ':' : ', no output.'}`);
          if (o.trim()) out.push('', fence(o, 'text'));
          if (s.note) out.push('', `*${s.note}*`);
        });
        out.push('', "### The agent's report", '', t.report || '*(' + (t.outcome || 'no report') + ')*');
      });
      try {
        fs.writeText(path, out.join('\n') + '\n');
      } catch (e) {
        console.error(e);
        return null;
      }
      return path;
    }
    async liveAgent(task) {
      const fs = MG.app.fs;
      if (!MG.app.term && MG.app.showWorkbench) {
        // (the terminal is made the first time it is shown; the assistant stays in front)
        await MG.app.showWorkbench('terminal', { noOpen: true });
        await waitFor(() => MG.app.term, 4000);
        await MG.app.showWorkbench('assistant', { noOpen: true });
      }
      const T = MG.app.term;
      if (!T) {
        this.addBubble('assistant', 'The terminal isn’t ready yet. Please try again in a moment.', { tab: 'agent' });
        return;
      }
      this.busy = true;
      this._abort = new AbortController();
      const signal = this._abort.signal;
      this.sendBtn.innerHTML = MG.icon('stop') + '<span>Stop</span>';
      // the folder: the conversation's, or a new one
      let ctx = this.agentCtx;
      if (!ctx || !fs.isDir(ctx.run)) {
        let n = 1;
        while (fs.exists(HOME() + '/ai-agent/run-' + n)) n++;
        ctx = this.agentCtx = { n, run: HOME() + '/ai-agent/run-' + n, tasks: [] };
        fs.mkdirp(ctx.run);
      }
      const run = ctx.run;
      const earlier = ctx.tasks.slice();
      const rec = { task, steps: [], report: '', outcome: '', t: Date.now(), models: [] };
      ctx.tasks.push(rec);
      this.renderCtx();
      const back = fs.cwd;
      const { card, steps } = this.agentCard(`Agent · working in ${pretty(run)}`);
      const noteEl = h('div.muted.small.ag-note');
      card.appendChild(noteEl);
      const note = (t) => {
        noteEl.textContent = t || '';
        this.scroll('agent');
      };
      const t0 = performance.now();
      // (a task after others in the same folder: what they were, what was run, and what was found)
      const intro = earlier.length
        ? 'Earlier tasks in this folder – you did them, and their files are still there:\n' +
          earlier
            .map((t, i) => `${i + 1}. Task: ${t.task}\n   Commands: ${t.steps.filter((s) => s.cmd && !s.refused).map((s) => s.cmd.split('\n')[0]).slice(-12).join(' ; ').slice(0, 1500) || '(none)'}\n   Your report: ${(t.report || '(none)').slice(0, 1500)}`)
            .join('\n') +
          '\n\nThe new task:\n'
        : '';
      const hist = [{ role: 'user', content: intro + task }];
      let cmds = 0, final = '', outcome = 'done';
      // The agent works in a new shell – the user's variables, functions and options are not its own, and it leaves
      // none behind – and nobody else can type into the terminal meanwhile.
      for (let i = 0; i < 600 && T.busy; i++) await sleep(100);
      const shellState = T.shell.saveState ? T.shell.saveState() : null;
      if (T.shell.freshState) T.shell.freshState();
      const held = new Map(); // the page's copies of program-written files, for a forced stop: see holdBytes
      if (T.lock) T.lock('The AI agent is using the terminal. You can stop it in the AI assistant tab.');
      this._agentLive = true;
      MG.app.agentBusy = true;
      let reminded = false;
      try {
        await this.termRun('cd ' + run, { agent: true });
        for (;;) {
          const li = h('li.ag-step.run', h('span.ag-ic', { html: '<span class="spinner small"></span>' }), h('span.ag-say.muted', 'thinking…'));
          steps.appendChild(li);
          this.scroll('agent');
          const say = li.querySelector('.ag-say');
          const { text, model } = await this.agentAsk(hist, run, signal, note, (t) => {
            say.textContent = withoutCode(t) || 'thinking…';
            this.scroll('agent');
          });
          note('');
          if (!rec.models.includes(model)) rec.models.push(model);
          const step = agentStep(text), cmd = step.cmd;
          // A reply with a code block that is no command (```text, ```r …). The rule the agent was given is that a
          // report has no code block: once in a task it is told that nothing was run, and asked which it meant.
          if (cmd == null && /```/.test(text) && !reminded && cmds < AGENT_MAX) {
            reminded = true;
            li.remove();
            hist.push({ role: 'assistant', content: text }, { role: 'user', content: AGENT_REMIND });
            continue;
          }
          if (cmd == null || cmds >= AGENT_MAX) {
            // no command: this is the agent's report
            li.remove();
            final = cmd == null ? text : withoutCode(text) + `\n\n*(Stopped after reaching the limit of ${AGENT_MAX} steps.)*`;
            break;
          }
          // (the description of the step: what stands in front of its block – see AGENT_AHEAD)
          const ahead = step.before && step.after.length > AGENT_AHEAD;
          const said = ahead ? step.before : withoutCode(text);
          say.textContent = said;
          say.classList.remove('muted');
          cmds++;
          const srec = { say: said, cmd: cmd || '', code: null, out: '', refused: '', note: '' };
          rec.steps.push(srec);
          const refused = cmd ? agentRefusal(cmd) : 'the code block was empty: give one command.';
          let result;
          li.appendChild(h('div.ag-cmdrow', h('code.ag-cmd', cmd || '(empty)')));
          if (refused) {
            li.classList.add('bad');
            li.querySelector('.ag-ic').textContent = '⛔';
            li.appendChild(h('small.muted', 'not run: ' + refused));
            srec.refused = refused;
            result = 'Not run: ' + refused;
          } else {
            // run it in the terminal; what it changes outside the agent's folder is put back
            const W = MG.wasm;
            const snap = outsideSnapshot(fs, run);
            if (W && W.keep) {
              try {
                await W.keep(Array.from(snap));
              } catch (e) {
                console.error(e); // without the copies, only files that the command leaves alone can be put back
              }
            }
            const before = new Map();
            for (const [p, e] of fs.entries) if (e.kind === 'aioli' && !insideDir(p, '/tmp')) before.set(p, e);
            try {
              await holdBytes(fs, held);
            } catch (e) {
              console.error(e);
            }
            const since = Date.now(), gen = W ? W.gen : 0;
            const saved = new Set(); // what the user changes meanwhile: theirs
            this._step = { run, saved };
            // a command that has not ended after AGENT_SECONDS is stopped by force. (The Stop button: see stopNow.)
            let timedOut = false, again = null;
            const timer = setTimeout(() => {
              timedOut = true;
              T.stop();
              T.stop(true);
              // (a program that was only just being started is not "running" yet at that moment: again, until the command has ended)
              again = setInterval(() => T.stop(true), 500);
            }, AGENT_SECONDS * 1000);
            const r = { code: 0, text: '' };
            const notRun = [];
            let ended = null;
            try {
              // the commands of the block, one after the other: what follows a command that failed is not run
              const parts = agentParts(cmd);
              for (let k = 0; k < parts.length; k++) {
                T.shell.endedBy = null;
                T.shell.exitTyped = false;
                // (while a command of the agent runs, a shell that knows of it refuses what the agent has not got)
                T.shell._agentOnly = AGENT_ALLOW;
                let one;
                try {
                  one = await this.termRun(parts[k], { agent: true });
                } finally {
                  T.shell._agentOnly = null;
                }
                r.text += one.text;
                r.code = one.code;
                // (exit, or the agent's own set -e / set -u, ended the command where a script would have ended: so does the block)
                ended = T.shell.exitTyped ? 'exit' : T.shell.endedBy || null;
                T.shell.exitTyped = false;
                if (one.code !== 0 || ended || timedOut || signal.aborted) {
                  notRun.push(...parts.slice(k + 1));
                  break;
                }
              }
            } finally {
              clearTimeout(timer);
              clearInterval(again);
              this._step = null;
            }
            // (files that a forced stop of the programs removed are not the user's doing)
            if (W && W.gen !== gen && W.lostEntries) for (const k of W.lostEntries.keys()) saved.delete(k);
            const u = await undoOutside(fs, run, snap, saved, since, gen, held, before);
            const undone = u.changed, killed = u.killed;
            // (after a forced stop: the program-written files of this folder that are not there any more – the step's own)
            const gone = killed ? Array.from(before.keys()).filter((p) => insideDir(p, run) && !fs.entries.has(p)).map((p) => p.slice(run.length + 1)) : [];
            const lostOut = u.lost.filter((p) => !insideDir(p, run));
            if (fs.cwd !== run && fs.isDir(run)) await this.termRun('cd ' + run, { agent: true });
            li.classList.toggle('bad', r.code !== 0 || undone.length > 0 || timedOut);
            li.querySelector('.ag-ic').innerHTML = r.code === 0 && !undone.length && !timedOut ? '✓' : '✗';
            const lines = r.text.replace(/\s+$/, '').split('\n');
            const excerpt = (lines.length > 14 ? ['…'].concat(lines.slice(-14)) : lines).join('\n');
            li.appendChild(h('details.ag-out', h('summary', `output (exit status ${r.code})`), h('pre', excerpt || '(no output)')));
            const notes = [];
            if (undone.length) notes.push('Changes outside the agent’s folder were undone: ' + undone.slice(0, 4).map((k) => pretty(k)).join(', ') + (undone.length > 4 ? ' …' : ''));
            if (timedOut) notes.push(`The page stopped this step because it ran for more than ${AGENT_SECONDS} seconds.`);
            if (killed) notes.push('The programs had to be stopped by force and then restarted. Anything they wrote during this step has been lost, but the files they had written before it are back as they were.' + (lostOut.length ? ' These files in your folders were too large for the page to keep a copy of, and have been lost: ' + lostOut.slice(0, 4).map((k) => pretty(k)).join(', ') + (lostOut.length > 4 ? ` and ${lostOut.length - 4} more` : '') + '.' : ''));
            notes.forEach((t) => li.appendChild(h('small.muted', t)));
            srec.code = r.code;
            srec.out = r.text;
            srec.note = notes.join(' ');
            const out = r.text.trim();
            result =
              `Exit status ${r.code}.` +
              (timedOut ? ` The command was stopped: it ran for more than ${AGENT_SECONDS} seconds.` : '') +
              (killed ? ' The programs had to be stopped by force: what programs wrote in this step is gone; the files from earlier steps are as they were.' + (gone.length ? ` Not there any more: ${gone.slice(0, 6).join(', ')}.` : '') : '') +
              (notRun.length ? ` Not run, because the command before ${r.code !== 0 ? 'failed' : ended === 'exit' ? 'was exit' : 'ended the block'}: ${notRun.join(' ; ').slice(0, 300)}.` : '') +
              (undone.length ? ` Your changes outside your folder were undone: ${undone.slice(0, 6).map((k) => pretty(k)).join(', ')}.` : '') +
              '\nOutput' +
              (out.length > AGENT_OUT ? ' (last ' + AGENT_OUT + ' characters)' : '') +
              ':\n```text\n' +
              (out.slice(-AGENT_OUT) || '(no output)') +
              '\n```';
          }
          li.classList.remove('run');
          if (ahead) {
            li.appendChild(h('small.muted', 'The model wrote more after this step, before the step had run. That text is not shown here, because a report can only be written once the result is known.'));
            result += '\n\n' + AGENT_AHEAD_TOLD;
          }
          if (cmds >= AGENT_MAX) result += `\n\nYou have used all ${AGENT_MAX} steps. Reply now without a code block: what you did, which files you made and what the results show.`;
          hist.push({ role: 'assistant', content: text }, { role: 'user', content: result });
          if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        }
      } catch (e) {
        outcome = e.name === 'AbortError' ? 'stopped' : 'error';
        steps.querySelectorAll('li.run').forEach((li) => {
          li.classList.remove('run');
          li.querySelector('.ag-ic').textContent = '–';
          if (/thinking/.test(li.textContent)) li.remove();
        });
        final = outcome === 'stopped' ? '*(Stopped.)*' : '**The AI service returned an error.**\n\n' + e.message;
        if (outcome === 'error') card.classList.add('err');
      } finally {
        this._step = null;
        note('');
        if (fs.cwd !== back && fs.isDir(back)) await this.termRun('cd ' + back, { agent: true });
        this._agentLive = false;
        MG.app.agentBusy = false;
        if (T.unlock) T.unlock();
        if (shellState && T.shell.restoreState) T.shell.restoreState(shellState);
        held.clear();
        if (MG.wasm && MG.wasm.dropKept) MG.wasm.dropKept().catch(() => {});
        if (T._renderPrompt) T._renderPrompt();
        rec.report = outcome === 'done' ? final : '';
        rec.outcome = outcome === 'done' ? 'done' : outcome === 'stopped' ? 'stopped by the user' : 'the AI service returned an error';
        card.querySelector('.ag-head b').textContent = (outcome === 'done' ? 'Agent · finished' : outcome === 'stopped' ? 'Agent · stopped' : 'Agent · error') + ` · ${pretty(run)}`;
        const body = h('div.ai-body', { dataset: { origin: 'terminal' } });
        card.appendChild(body);
        this.fill(body, final || '(no reply)');
        const recPath = this.saveRecord(ctx);
        if (recPath) card.appendChild(this.recordRow(recPath, run));
        const secs = Math.round((performance.now() - t0) / 1000);
        card.appendChild(h('div.ai-badge', `agent · ${rec.models.join(', ') || modelOf(this.settings)} · ${cmds} step${cmds === 1 ? '' : 's'} · ${secs >= 60 ? Math.floor(secs / 60) + ' min ' : ''}${secs % 60} s`));
        this.msgs.agent.push({ role: 'assistant', content: final || '(no reply)' });
        this.busy = false;
        this._abort = null;
        this.sendBtn.innerHTML = MG.icon('send') + '<span>Send</span>';
        this.scroll('agent');
        this.renderCtx();
        bus.emit('agent:live', { ok: outcome === 'done', run: ctx.n, commands: cmds, folder: pretty(run) });
      }
    }
    /** under an agent's card: its record and its folder */
    recordRow(path, run) {
      const fs = MG.app.fs;
      const b = (icon, text, fn, tip) => {
        const x = h('button.btn.small', { type: 'button', title: tip, html: MG.icon(icon) + '<span>' + esc(text) + '</span>' });
        x.addEventListener('click', () => Promise.resolve(fn()).catch((e) => toast(esc(e.message || String(e)), 'error')));
        return x;
      };
      return h(
        'div.ag-file',
        h('span.ag-fname', { html: MG.icon('file') + ' ' + esc(pretty(path)) }),
        h('span.grow'),
        b('eye', 'Open the record', () => MG.app.editFile(path, { line: 1 }), 'Open the record of the tasks, commands and output (a Markdown file) in the Files tab'),
        b('download', '.md', async () => MG.downloadText(await fs.readText(path), `agent-run-${MG.path.basename(run).replace(/^run-/, '')}.md`, 'text/markdown'), 'Download the record'),
        b('folder', 'Folder', () => MG.app.revealFile(run), 'Show the agent’s folder in Files')
      );
    }

    /* ---------------- talking to the service ---------------- */
    /* Stream an answer.
       Gemini: the chosen model is asked first, then the fallback models in their order – but not a model that the
       page knows to be busy, silent or over a limit (the memory above). A model that is busy (HTTP 5xx), over a
       limit (429), not found (404) or gives no answer (the connection fails, or nothing comes for a minute) is
       noted, and the next one is asked. An answer that breaks off part-way is taken back (cfg.onReset) and the
       question goes to the next model. When no model is left that is not at rest, the two that have rested longest
       of those that were only busy or silent get another chance. Two models in a row that give no answer end the
       request: that is the connection, not the models.
       Other services: one model; if it is busy, a second try after a short pause.
       → { model, skipped }: the model that answered, and what kept others from it.
       When nothing answers, the error says what each model said. Its .status is 429 (limits), 503 (busy) or not set
       (no answer came); .retryIn is the number of seconds after which asking again can help. */
    async streamLive(messages, onDelta, signal, cfg, onNote) {
      const s = (cfg && cfg.settings) || this.settings;
      const key = cfg && cfg.key != null ? cfg.key : this.key;
      const system = (cfg && cfg.system) || this.systemPrompt();
      const note = onNote || (() => {});
      const reset = cfg && cfg.onReset;
      // turns must alternate between user and assistant: join neighbours of the same role
      messages = messages.reduce((out, m) => {
        const last = out[out.length - 1];
        if (last && last.role === m.role) last.content += '\n\n' + m.content;
        else out.push({ role: m.role, content: m.content });
        return out;
      }, []);
      if (s.provider !== 'gemini') {
        const model = modelOf(s);
        for (let attempt = 1; ; attempt++) {
          let started = false;
          try {
            await this.streamOnce(s, key, model, messages, (d) => {
              started = true;
              onDelta(d);
            }, signal, system);
            return { model, skipped: [] };
          } catch (e) {
            if (e.name !== 'AbortError' && !started && BUSY.includes(e.status) && attempt === 1) {
              note(`${model} is busy – trying again…`);
              await pause(1500 + Math.random() * 1500, signal);
              continue;
            }
            if (e.status === 429 && !started) e.retryIn = Math.round(Math.min(90, Math.max(5, e.retryAfter || 30)));
            throw e;
          }
        }
      }
      const chosen = geminiModelOf(s);
      const chain = [chosen].concat(FALLBACKS.filter((m, i, a) => a.indexOf(m) === i && m !== chosen));
      if (restKey !== key) {
        // another key is another project, with limits of its own
        REST.clear();
        restKey = key;
      }
      try {
        if (navigator.onLine === false) throw Object.assign(new Error('This browser is offline. Connect to the internet and try again.'), { network: true, retryIn: RETRY });
        const said = new Map(); // what each model said: in this request, or when it was last asked and is still at rest
        chain.forEach((m) => resting(m) && said.set(m, REST.get(m)));
        const failed = [];
        let queue = chain.filter((m) => !said.has(m));
        let again = false, silent = 0;
        for (;;) {
          if (!queue.length && !again) {
            again = true;
            queue = chain.filter((m) => said.has(m) && !failed.includes(said.get(m)) && (said.get(m).why === 'busy' || said.get(m).why === 'noanswer')).sort((a, b) => said.get(a).until - said.get(b).until).slice(0, 2);
          }
          if (!queue.length) break;
          const model = queue.shift();
          const before = failed[failed.length - 1];
          if (before) note(`${before.model} ${before.broke ? 'broke off' : told(before, true)} – asking ${model} instead…`);
          let started = false;
          try {
            await this.streamOnce(s, key, model, messages, (d) => {
              started = true;
              onDelta(d);
            }, signal, system);
            REST.delete(model);
            const first = model !== chosen && said.get(chosen);
            return { model, skipped: (first && !failed.includes(first) ? [first] : []).concat(failed).map((x) => ({ model: x.model, why: x.broke ? 'broke' : x.why, daily: x.daily })) };
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            const why = e.network ? 'noanswer' : e.status === 404 ? 'notfound' : e.status === 429 ? 'limit' : BUSY.includes(e.status) ? 'busy' : '';
            // an error of another kind (the key, the request itself) – or an answer that broke off and cannot be taken back
            if (!why || (started && !reset)) throw e;
            if (started) reset();
            const was = REST.get(model);
            const x = { model, why, broke: started, status: e.status, text: e.message, at: Date.now(), until: Infinity };
            if (why === 'limit') {
              const wait = e.retryAfter > 0 ? Math.min(86400, e.retryAfter) : e.daily ? 3600 : 60;
              x.daily = !!e.daily || wait > 900;
              x.limit = e.limit;
              x.until = Date.now() + (wait + 1) * 1000;
            } else if (why === 'busy') {
              // busy again soon after its rest: the rest is twice as long (2, 4, 8, at most 15 minutes)
              x.n = was && was.why === 'busy' && Date.now() - was.until < 600000 ? was.n + 1 : 1;
              x.until = Date.now() + Math.min(900, BUSY_REST * 2 ** (x.n - 1)) * 1000;
            } else if (why === 'noanswer') x.until = Date.now() + SILENT_REST * 1000;
            REST.set(model, x);
            said.set(model, x);
            failed.push(x);
            silent = why === 'noanswer' ? silent + 1 : 0;
            if (silent >= 2) break;
          }
        }
        throw noAnswer(chain.map((m) => said.get(m)).filter(Boolean), silent >= 2);
      } finally {
        this.showStatus();
      }
    }
    /** one request; the answer is passed to onDelta as it arrives.
        An error that the service reports carries .status – and for "too many requests" (429) .retryAfter (seconds)
        and, when the service names a limit per day, .daily and .limit. An answer that does not come – the connection
        fails or breaks off, or (Gemini) nothing arrives for a minute (aiWaitSeconds) – carries .network. */
    async streamOnce(s, key, model, messages, onDelta, signal, system) {
      const gem = s.provider === 'gemini';
      const base = (s.baseURL || '').replace(/\/+$/, '');
      if (signal && signal.aborted) throw stopped();
      // the request ends when the user presses Stop – or when the service has said nothing for too long
      const ac = new AbortController();
      const onStop = () => ac.abort();
      if (signal) signal.addEventListener('abort', onStop, { once: true });
      const quiet = gem ? WAIT() * 1000 : 0;
      let timer = null, silent = false, bytes = 0;
      const arm = () => {
        clearTimeout(timer);
        if (quiet)
          timer = setTimeout(() => {
            silent = true;
            ac.abort();
          }, quiet);
      };
      /* why the answer did not come: the user's Stop, the service's silence, or the connection */
      const lost = (e) => {
        if (signal && signal.aborted) return stopped();
        if (silent) return Object.assign(new Error(`${model} ${bytes ? 'stopped in the middle of its reply and then sent nothing' : 'gave no answer'} for ${Math.round(quiet / 1000)} seconds.`), { network: true, silent: true });
        if (e.name === 'AbortError') return e;
        const where = gem ? 'the Gemini API' : s.provider === 'anthropic' ? 'the Anthropic API' : base;
        return Object.assign(new Error(bytes ? `The connection to ${where} broke off in the middle of the reply (${e.message}).` : `Could not reach ${where} (${e.message}). ${s.provider === 'openai' ? 'Check the address. The service must also allow requests from web pages (CORS).' : 'Check your internet connection.'}`), { network: true });
      };
      /* an error that the service reports: as the status of its answer, or (Gemini) inside an answer that had begun */
      const refused = (status, j, statusText, retryHeader) => {
        const err = (j && j.error) || null;
        const det = err && Array.isArray(err.details) ? err.details.filter(Boolean) : [];
        const detail = j ? (err && (err.message || err.type)) || JSON.stringify(j).slice(0, 300) : statusText || '';
        const reason = err ? det.map((d) => d.reason).filter(Boolean)[0] || err.status || '' : '';
        const ri = det.find((d) => /RetryInfo$/.test(d['@type'] || ''));
        const retryAfter = (ri && parseFloat(ri.retryDelay)) || parseFloat(retryHeader) || 0;
        // a limit per day is named in the answer: quotaId "GenerateRequestsPerDayPerProjectPerModel-FreeTier", with its value
        const qf = det.find((d) => /QuotaFailure$/.test(d['@type'] || ''));
        const day = ((qf && qf.violations) || []).find((v) => v && /PerDay/i.test(v.quotaId || ''));
        const limit = day && /^\d+$/.test(String(day.quotaValue)) ? +day.quotaValue : undefined;
        const badKey = status === 401 || status === 403 || reason === 'API_KEY_INVALID';
        const why = badKey
          ? 'The API key was not accepted.'
          : status === 404
            ? `The model name (${model}) may be wrong, or the model may have been retired. Check the name in the AI settings (⚙).`
            : status === 429
              ? gem
                ? day
                  ? `${model} is over its limit for today${limit != null ? ` (${limit} requests a day)` : ''}. On the free tier, each model allows a certain number of requests per day, counted per project. You can carry on when the service accepts requests again, use a key from another person or project, or choose a different model in the AI settings (⚙).`
                  : 'Too many requests. The free tier only allows a few requests per minute and per day, so wait a minute and try again.'
                : 'Too many requests, or there is no credit left. Try again in a minute.'
              : BUSY.includes(status)
                ? gem
                  ? `Google’s servers are busy for ${model} (“high demand”). This is a problem on Google’s side, not with your key. Wait a minute and try again, or choose a different model in the AI settings (⚙).`
                  : 'The service is busy or had a temporary problem. Try again in a minute.'
                : '';
        return Object.assign(new Error(`HTTP ${status}. ${why} ${detail}`.trim()), { status, retryAfter, daily: !!day, limit });
      };
      try {
        arm();
        let r;
        if (s.provider === 'anthropic') {
          r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
            body: JSON.stringify({ model, max_tokens: 8000, system, messages, stream: true }),
            signal: ac.signal
          }).catch((e) => {
            throw lost(e);
          });
        } else if (gem) {
          // Google's Gemini API (generateContent, streamed as server-sent events); the whole conversation is sent each time
          r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }),
            signal: ac.signal
          }).catch((e) => {
            throw lost(e);
          });
        } else {
          r = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: Object.assign({ 'content-type': 'application/json' }, key ? { authorization: 'Bearer ' + key } : {}),
            body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }].concat(messages) }),
            signal: ac.signal
          }).catch((e) => {
            throw lost(e);
          });
        }
        arm();
        if (!r.ok) {
          let j = null;
          try {
            j = await r.json();
          } catch (e) {
            if (signal && signal.aborted) throw stopped();
          }
          throw refused(r.status, j, r.statusText, r.headers.get('retry-after'));
        }
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read().catch((e) => {
            throw lost(e);
          });
          if (done) break;
          arm();
          bytes += value.length;
          buf += dec.decode(value, { stream: true });
          let k;
          while ((k = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, k).trim();
            buf = buf.slice(k + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let j;
            try {
              j = JSON.parse(data);
            } catch (e) {
              continue;
            }
            if (s.provider === 'anthropic') {
              if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') onDelta(j.delta.text);
              else if (j.type === 'error') throw Object.assign(new Error((j.error && j.error.message) || 'stream error'), { status: j.error && j.error.type === 'overloaded_error' ? 529 : undefined });
            } else if (gem) {
              if (j.error) {
                // an error in an answer that began with "200 OK": the same kinds as the errors that come instead of an answer
                const code = +j.error.code || { UNAVAILABLE: 503, RESOURCE_EXHAUSTED: 429, INTERNAL: 500, DEADLINE_EXCEEDED: 504, NOT_FOUND: 404 }[j.error.status];
                throw code ? refused(code, j) : new Error(j.error.message || 'stream error');
              }
              if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error('Gemini did not answer (' + j.promptFeedback.blockReason + ').');
              const cand = (j.candidates && j.candidates[0]) || {};
              ((cand.content && cand.content.parts) || []).forEach((p) => {
                if (p.text && !p.thought) onDelta(p.text);
              });
              // A reply that the service cut off as a "malformed function call": the model had begun its ```bash block,
              // and the service took the fence for the call of a tool named bash. What it took away is in finishMessage
              // ("Malformed function call: call:bash ```", the commands, "```") – the block goes back into the reply.
              if (cand.finishReason === 'MALFORMED_FUNCTION_CALL' && typeof cand.finishMessage === 'string') {
                const m = /call:\s*(?:bash|sh|shell)\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(cand.finishMessage);
                if (m && m[1].trim()) onDelta('\n\n```bash\n' + m[1] + '\n```\n');
              }
            } else {
              const dd = j.choices && j.choices[0] && j.choices[0].delta;
              if (dd && dd.content) onDelta(dd.content);
            }
          }
        }
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onStop);
        ac.abort(); // (nothing is left to end when the answer came whole)
      }
    }

    /* ---------------- a prompt for another AI tool ---------------- */
    async buildPrompt(question, extra) {
      const q = question || this.input.value.trim() || '[write your question here]';
      const ctx = await this.contextFor(extra || {});
      return [
        'I am digitising graphs (reading the values out of pictures of graphs in papers) with trace-digitiser, a Python package, in the Digitiser workbench: a website where Python runs in the web browser (Pyodide), with a point-and-click Digitise tab, Jupyter-style Python notebooks and a bash-like terminal.',
        ...envLines(),
        '',
        ctx.trim(),
        '',
        'My question: ' + q,
        '',
        'Please answer briefly, explain the code and options you give so that I can learn from them, and use only functions, arguments and options that really exist.'
      ].join('\n');
    }
    async copyPrompt(question, extra) {
      const text = await this.buildPrompt(question, extra);
      const ok = await MG.copyText(text);
      const m = MG.modal(
        'A prompt for another AI tool',
        `<p class="small">${ok ? '<b>Copied to the clipboard.</b> ' : ''}Paste it into an AI tool that you are allowed to use, and check what it gives you. The prompt describes the workbench and contains your question and whatever is ticked below the assistant's message box (the Digitise tab's settings, your code, your last commands and your file names), but not your pictures or your data. Read it before you paste it.</p><textarea class="prompt-text" readonly aria-label="Prompt">${esc(text)}</textarea><div class="prompt-actions"><button class="btn" data-x="copy" type="button">${MG.icon('copy')}<span>Copy</span></button><button class="btn primary" data-x="ok" type="button">Done</button></div>`
      );
      m.box.querySelector('[data-x="copy"]').addEventListener('click', async () => toast((await MG.copyText(text)) ? 'Prompt copied.' : 'Could not copy the prompt. Select the text and copy it yourself.', null, 2500));
      m.box.querySelector('[data-x="ok"]').addEventListener('click', () => m.close());
      bus.emit('ai:copyprompt', {});
    }

    /* ---------------- settings ---------------- */
    settingsDialog() {
      const s = this.settings;
      let remembered = false;
      try {
        remembered = !!window.sessionStorage.getItem(KEY_NAME);
      } catch (e) {
        remembered = false;
      }
      const html = `
<div class="ai-set">
  <p class="muted small">The assistant uses an AI service of your choice, with your own key (or one you have been given). Your messages, together with whatever you tick below the message box, go straight from your browser to that service.</p>
  <label>Service <select data-k="provider"><option value="gemini" ${s.provider === 'gemini' ? 'selected' : ''}>Google Gemini (free tier available)</option><option value="anthropic" ${s.provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option><option value="openai" ${s.provider === 'openai' ? 'selected' : ''}>OpenAI-compatible service</option></select></label>
  <label data-show="gemini">Model <input data-k="geminiModel" value="${esc(geminiModelOf(s))}" spellcheck="false"></label>
  <p data-show="gemini" class="muted small">You can create a free key with a Google account at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> (you must be 18 or over). On the free tier, Google may use what you send to improve its products, and human reviewers may read it. Each model only allows a few requests per minute and a limited number per day. When a model is busy or over its limit, the page asks another one, and each answer shows which model replied.</p>
  <label data-show="anthropic">Model <input data-k="model" value="${esc(anthropicModelOf(s))}" spellcheck="false"></label>
  <p data-show="anthropic" class="muted small">Create a key in the Claude Console at <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a> (this is a paid service).</p>
  <label data-show="openai">Base URL <input data-k="baseURL" value="${esc(s.baseURL)}" spellcheck="false"></label>
  <label data-show="openai">Model <input data-k="openaiModel" value="${esc(s.openaiModel)}" placeholder="the model name your service uses" spellcheck="false"></label>
  <p data-show="openai" class="muted small">Any service with an OpenAI-style <code>/chat/completions</code> API that allows requests from web pages (CORS), such as a university service or one running on your own computer. It may or may not need a key.</p>
  <label>API key <input data-k="key" type="password" value="${esc(this.key)}" autocomplete="off" spellcheck="false" placeholder="paste the key here"></label>
  <label class="ai-cb"><input type="checkbox" data-k="remember" ${remembered ? 'checked' : ''}> Remember the key until I close this browser tab (otherwise it is forgotten when the page is reloaded)</label>
  <p class="muted small">The key is only kept in this browser tab. It is never saved in a file or in the browser's long-term storage. <b>Never paste personal or patient data into an AI tool.</b></p>
  <div class="prompt-actions"><span class="ai-test-out muted small" aria-live="polite"></span><button class="btn" data-x="forget" type="button">Forget the key</button><button class="btn" data-x="test" type="button">Test</button><button class="btn primary" data-x="save" type="button">Save</button></div>
</div>`;
      const m = MG.modal('AI settings', html);
      const B = m.box;
      const val = (k) => B.querySelector(`[data-k="${k}"]`);
      const sync = () => {
        const p = val('provider').value;
        B.querySelectorAll('[data-show]').forEach((el) => (el.hidden = el.dataset.show !== p));
      };
      val('provider').addEventListener('change', sync);
      sync();
      // a model left at the site's default is saved as '' (= follow config.js)
      const own = (k, dflt) => {
        const v = val(k).value.trim().replace(/^models\//, '');
        return v && v !== dflt ? v : '';
      };
      const read = () => ({
        settings: { provider: val('provider').value, model: own('model', LIVE_DEFAULTS.model), geminiModel: own('geminiModel', LIVE_DEFAULTS.geminiModel), baseURL: val('baseURL').value.trim(), openaiModel: val('openaiModel').value.trim() },
        key: val('key').value.trim()
      });
      B.querySelector('[data-x="test"]').addEventListener('click', async () => {
        const out = B.querySelector('.ai-test-out');
        const r = read();
        if (!r.key && needsKey(r.settings)) {
          out.textContent = 'Paste a key first.';
          return;
        }
        out.textContent = 'Testing…';
        let got = '';
        try {
          const res = await this.streamLive([{ role: 'user', content: 'Reply with the single word: ready' }], (d) => (got += d), undefined, Object.assign(r, { onReset: () => (got = '') }), (note) => (out.textContent = note));
          out.textContent = '✓ Connected: “' + got.trim().slice(0, 40) + '”' + (res.skipped.length ? ` – from ${res.model} (${res.skipped.map((x) => x.model + ' ' + skipWord(x)).join(', ')})` : '');
        } catch (e) {
          out.textContent = '✗ ' + e.message;
        }
      });
      B.querySelector('[data-x="forget"]').addEventListener('click', () => {
        val('key').value = '';
        val('remember').checked = false;
        this.key = '';
        try {
          window.sessionStorage.removeItem(KEY_NAME);
        } catch (e) {
          /* storage may be blocked */
        }
        this.renderMode();
        this.refreshIntro();
        B.querySelector('.ai-test-out').textContent = 'The key has been forgotten.';
      });
      B.querySelector('[data-x="save"]').addEventListener('click', () => {
        const r = read();
        this.settings = r.settings;
        this.key = r.key;
        // (the settings – service and models – are kept; the key never with them)
        store.set('ai:settings', this.settings);
        try {
          if (val('remember').checked && this.key) window.sessionStorage.setItem(KEY_NAME, this.key);
          else window.sessionStorage.removeItem(KEY_NAME);
        } catch (e) {
          /* storage may be blocked */
        }
        this.renderMode();
        this.refreshIntro();
        this.renderCtx();
        m.close();
        if (!this.connected()) toast('Settings saved. Add a key to use the assistant.', 'warn');
        else toast(`The assistant will now use ${esc(modelOf(this.settings))}.`, 'ok', 2500);
        bus.emit('ai:settings', { provider: this.settings.provider });
      });
    }
  }

  /* Questions that other tabs send (an error, a cell, a run): to the assistant – which is made, with its tab, if it is
     not there yet. term:ask {line, output, error, cwd} (terminal.js), nb:ask {kind, cell} (notebook.js), dg:ask {} (the
     Digitise tab's last run). */
  function relay(method) {
    return (d) => {
      const go = (A) => A && typeof A[method] === 'function' && A[method](d || {});
      if (MG.app && MG.app.ai) return go(MG.app.ai);
      if (!MG.app || !MG.app.showWorkbench) return;
      Promise.resolve(MG.app.showWorkbench('assistant'))
        .then(() => waitFor(() => MG.app.ai, 4000))
        .then(go)
        .catch((e) => console.error(e));
    };
  }
  bus.on('term:ask', relay('askAboutError'));
  bus.on('nb:ask', relay('askAboutCell'));
  bus.on('dg:ask', relay('askAboutRun'));

  MG.Assistant = Assistant;
  MG.aiModelMemory = REST;
  MG.aiUtil = { mdBlocks, shellCommands, shellCode, rCode, looksR, looksPy, looksShell, offlineHelp, envLines, programs };
})();
