/* =====================================================================
   What the workbench's terminal has beyond the shared shell (shell.js,
   shell-lang.js, shell-extra.js) and its text tools (shell-text.js):

     trace-digitiser        digitise a figure (Python, run as
                            python -m dwb trace-digitiser …)
     compare-known          compare what was digitised from one of the
                            examples with the values the figure shows
     python, pip            Python (Pyodide) – the notebooks' Python; pip
                            installs packages for this visit (micropip)
     digitise FILE          open a picture (or a PDF) in the Digitise tab
     curl, wget             downloads from web services that allow it
     unzip, zip, tar        archives
     export-session         this session's commands as a notebook
     help, man              what is here, and how to use it
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const B = MG.shellBuiltins;
  const { userErr } = MG.shellUtil;
  const enc = new TextEncoder();
  const unsavedNote = (ctx) => MG.unsavedNote && MG.unsavedNote(ctx);

  /** the bytes that are piped into a command */
  async function stdinBytes(ctx) {
    const s = ctx.stdin;
    if (s == null) {
      const rest = MG.shellUtil.inherited ? MG.shellUtil.inherited(ctx) : null;
      return rest == null ? new Uint8Array(0) : enc.encode(rest);
    }
    if (MG.FileRef && s instanceof MG.FileRef) return await MG.wasm.readBytes(s.apath);
    return typeof s === 'string' ? enc.encode(s) : s instanceof Uint8Array ? s : enc.encode(String(s));
  }

  /* ------------------------------------------------------------------ Python, pip */
  const pyVersion = () => (MG.py && MG.py.versions && MG.py.versions.python) || '3.13';
  async function runPython(ctx) {
    const a = ctx.args;
    if (a[0] === '--version' || a[0] === '-V') {
      if (!(MG.py && MG.py.versions)) ctx.io.note('(Python has not started yet; this is the version it will be.)');
      ctx.out(`Python ${pyVersion()}\n`);
      return 0;
    }
    if (a[0] === '--help' || a[0] === '-h') {
      ctx.out('usage: python [option] ... [-c cmd | -m mod | file] [arg] ...\n  -c cmd : a program passed in as a string\n  -m mod : run a module as a script (python -m json.tool FILE.json prints JSON tidily)\n  file   : a program read from a script file\n  -V     : print the Python version number and exit (also --version)\ntrace-digitiser is installed:  import trace_digitiser as td\nFor Python line by line use the Notebook tab.\n');
      return 0;
    }
    if (a[0] === '-m' && (a[1] === 'pip' || a[1] === 'venv')) {
      if (a[1] === 'pip') return B.pip(Object.assign({}, ctx, { args: a.slice(2) }));
      ctx.err('python -m venv: a virtual environment is not needed here, and cannot be made in the browser. Install the packages a script needs with  pip install NAME  – they last until the page is reloaded.\n');
      return 1;
    }
    if (!MG.py) throw userErr('python: Python is not available on this page');
    if (a.length) unsavedNote(ctx);
    return MG.py.term('python', a, ctx);
  }
  B.python = runPython;
  B.python3 = runPython;
  B.pip = async (ctx) => {
    const [sub] = ctx.args;
    if (sub === '--version' || sub === '-V') {
      ctx.out(`pip (micropip, Pyodide) for Python ${pyVersion()}\n`);
      return 0;
    }
    if (sub === 'uninstall') {
      ctx.err('pip uninstall: not needed here – what pip installs lasts until the page is reloaded (or Python restarted).\n');
      return 1;
    }
    if (!MG.py) throw userErr('pip: Python is not available on this page');
    return MG.py.term('pip', ctx.args, ctx);
  };
  B.pip3 = B.pip;

  /* ------------------------------------------------------------------ trace-digitiser and compare-known */
  /* Each is a Python program. They run in the notebooks' Python, which has trace-digitiser:
     python -m dwb NAME ARGUMENTS (python/dwb/cli.py). What each is for, and examples, for help and man: */
  const EX = '/data/examples/hearn-whitmore-2026';
  const PROGRAMS = {
    'trace-digitiser': [
      'read the values out of a picture of a graph: lines (the default), points, bars, rows, heatmap, polar; describe says what it finds',
      `trace-digitiser ${EX}/figure-3a.png -o ~/results/figure-3a --overlay\ntrace-digitiser points ${EX}/figure-3c.png -o ~/results/figure-3c --overlay\ntrace-digitiser bars ${EX}/figure-1b.png -o ~/results/figure-1b\ntrace-digitiser rows ${EX}/figure-2.png --row-values 1955:2013 --bins 24 --dots black --row-spacing-value 1.1 -o ~/results/figure-2\ntrace-digitiser heatmap ${EX}/figure-4.png --rows 21 -o ~/results/figure-4\ntrace-digitiser polar ${EX}/figure-3b.png --colour '#1f77b4' --r-ref 5:1955 --r-ref 250:2005 -o ~/results/figure-3b\ntrace-digitiser describe ${EX}/figure-1a.png | head -40`
    ],
    'compare-known': [
      'compare a table digitised from one of the examples (Hearn and Whitmore 2026) with the values the figure shows',
      `trace-digitiser points ${EX}/figure-3c.png -o ~/results/figure-3c\ncompare-known ~/results/figure-3c/figure-3c_points.csv`
    ]
  };
  MG.wbPrograms = PROGRAMS;
  function wbProgram(name) {
    return async (ctx) => {
      if (!MG.py) throw userErr(`${name}: Python is not available on this page`);
      if (ctx.args.length) unsavedNote(ctx);
      return MG.py.term('python', ['-m', 'dwb', name].concat(ctx.args), Object.assign({}, ctx, { progName: name }));
    };
  }
  for (const name of Object.keys(PROGRAMS)) B[name] = wbProgram(name);

  /* digitise FILE: a picture (or a PDF) → the Digitise tab */
  B.digitise = async (ctx) => {
    const f = ctx.args.filter((a) => !a.startsWith('-'))[0];
    if (!f || ctx.args.includes('--help')) {
      ctx.out(OWN_MAN.digitise + '\n');
      return f || ctx.args.includes('--help') ? 0 : 1;
    }
    const abs = ctx.fs.resolve(f);
    if (!ctx.fs.exists(abs)) throw userErr(`digitise: ${f}: No such file or directory`);
    if (ctx.fs.isDir(abs)) throw userErr(`digitise: ${f}: Is a directory`);
    if (!MG.app || !MG.app.digitiseOpen) throw userErr('digitise: the Digitise tab is not available');
    await MG.app.digitiseOpen(abs);
    ctx.io.note(`${f} is open in the Digitise tab.`);
    return 0;
  };
  B.digitize = B.digitise;

  /* ------------------------------------------------------------------ curl, wget: the web, through the browser */
  const CORS_NOTE = 'A web page can only download from servers that allow it (CORS). Those that do include raw.githubusercontent.com and Zenodo. Download other files – a paper’s PDF, say – with your browser, then add them with “Add files from my computer…” in My files.';
  function webErr(ctx, prog, url, e) {
    const msg = String((e && e.message) || e);
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
      ctx.err(`${prog}: (7) could not get ${url}: the server did not answer, or does not allow downloads from a web page\n`);
      ctx.io.note(CORS_NOTE);
    } else ctx.err(`${prog}: ${msg}\n`);
  }
  async function fetchFor(ctx, url, init) {
    const ctrl = new AbortController();
    const timer = setInterval(() => {
      if (ctx.term && ctx.term.cancelled) ctrl.abort();
    }, 200);
    try {
      return await fetch(url, Object.assign({}, init, { signal: ctrl.signal, credentials: 'omit', redirect: 'follow' }));
    } finally {
      clearInterval(timer);
    }
  }
  const nameOfUrl = (url) => {
    try {
      const u = new URL(url);
      return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '') || 'index.html';
    } catch (e) {
      return 'download';
    }
  };
  async function saveBytes(ctx, path, bytes) {
    const abs = ctx.fs.resolve(path);
    const text = MG.looksText(abs, bytes);
    if (text != null) ctx.fs.writeText(abs, text);
    else ctx.fs.put(abs, { kind: 'blob', blob: new Blob([bytes]), size: bytes.length, fresh: true });
    MG.bus.emit('vfs:created', { path: abs, program: ctx.name });
    return abs;
  }
  B.curl = async (ctx) => {
    const a = ctx.args.slice();
    let out = null, remoteName = false, silent = false, showErr = false, fail = false, head = false, method = null, data = null, writeOut = null, include = false;
    const headers = {};
    const urls = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const val = () => {
        if (i + 1 >= a.length) throw userErr(`curl: option ${x}: requires parameter`);
        return a[++i];
      };
      if (x === '-o' || x === '--output') out = val();
      else if (x === '-O' || x === '--remote-name') remoteName = true;
      else if (x === '-s' || x === '--silent') silent = true;
      else if (x === '-S' || x === '--show-error') showErr = true;
      else if (x === '-f' || x === '--fail') fail = true;
      else if (x === '-L' || x === '--location' || x === '--compressed' || x === '-k' || x === '--insecure' || x === '-g' || x === '--globoff') continue;
      else if (x === '-I' || x === '--head') head = true;
      else if (x === '-i' || x === '--include') include = true;
      else if (x === '-X' || x === '--request') method = val().toUpperCase();
      else if (x === '-H' || x === '--header') {
        const hv = val(), k = hv.indexOf(':');
        if (k > 0) headers[hv.slice(0, k).trim()] = hv.slice(k + 1).trim();
      } else if (x === '-d' || x === '--data' || x === '--data-raw' || x === '--data-binary' || x === '--data-ascii') {
        let d = val();
        if (d.startsWith('@')) d = d === '@-' ? (ctx.stdin == null ? '' : typeof ctx.stdin === 'string' ? ctx.stdin : new TextDecoder().decode(await stdinBytes(ctx))) : await ctx.fs.readText(d.slice(1));
        data = data == null ? d : data + '&' + d;
      } else if (x === '-w' || x === '--write-out') writeOut = val();
      else if (x === '-A' || x === '--user-agent' || x === '-e' || x === '--referer' || x === '--retry' || x === '-m' || x === '--max-time' || x === '--connect-timeout') val();
      else if (/^-[sSfLkOI]+$/.test(x)) {
        for (const c of x.slice(1)) {
          if (c === 's') silent = true;
          else if (c === 'S') showErr = true;
          else if (c === 'f') fail = true;
          else if (c === 'O') remoteName = true;
          else if (c === 'I') head = true;
        }
      } else if (x === '--help' || x === '-h') {
        ctx.out(OWN_MAN.curl + '\n');
        return 0;
      } else if (x === '--version' || x === '-V') {
        ctx.out('curl (the workbench\'s: downloads through the web browser)\n');
        return 0;
      } else if (x.startsWith('-')) throw userErr(`curl: option ${x}: is not available here (see  man curl)`);
      else urls.push(x);
    }
    if (!urls.length) throw userErr('curl: no URL specified!\ncurl: try \'curl --help\' or \'man curl\' for more information');
    let code = 0;
    for (const url0 of urls) {
      const url = /^[a-z]+:\/\//i.test(url0) ? url0 : 'https://' + url0;
      if (!/^https?:/i.test(url)) throw userErr(`curl: (1) Protocol "${url.split(':')[0]}" not supported`);
      const m = method || (head ? 'HEAD' : data != null ? 'POST' : 'GET');
      const init = { method: m, headers: Object.assign({}, headers) };
      if (data != null && m !== 'GET' && m !== 'HEAD') {
        init.body = data;
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      let r;
      try {
        r = await fetchFor(ctx, url, init);
      } catch (e) {
        if (!silent || showErr) webErr(ctx, 'curl', url, e);
        else if (silent) ctx.io.note(CORS_NOTE);
        code = 7;
        continue;
      }
      if (fail && !r.ok) {
        if (!silent || showErr) ctx.err(`curl: (22) The requested URL returned error: ${r.status}\n`);
        code = 22;
        continue;
      }
      const hdrText = () => `HTTP/${'1.1'} ${r.status} ${r.statusText || ''}\n` + Array.from(r.headers.entries()).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n';
      if (head) {
        ctx.out(hdrText());
        continue;
      }
      const bytes = new Uint8Array(await r.arrayBuffer());
      const dest = out || (remoteName ? nameOfUrl(r.url || url) : null);
      if (dest) {
        if (dest === '-') ctx.out(MG.looksText('x', bytes) != null ? new TextDecoder().decode(bytes) : bytes);
        else {
          await saveBytes(ctx, dest, bytes);
          if (!silent) ctx.err(`  % Total: ${MG.humanSize(bytes.length)}B received → ${dest}\n`);
        }
      } else {
        if (include) ctx.out(hdrText());
        const t = MG.looksText('x', bytes);
        if (t != null) ctx.out(t);
        else if (ctx.isPipedOut || ctx.redirectTarget) ctx.out(bytes);
        else ctx.io.note(`Binary output (${MG.humanSize(bytes.length)}B): save it with  -o FILE  or  > FILE`);
      }
      if (writeOut) ctx.out(writeOut.replace(/%\{http_code\}/g, String(r.status)).replace(/%\{size_download\}/g, String(bytes.length)).replace(/%\{url_effective\}/g, r.url || url).replace(/\\n/g, '\n'));
      MG.bus.emit('web:download', { url, status: r.status, bytes: bytes.length, file: dest || null });
    }
    return code;
  };
  B.wget = async (ctx) => {
    const a = ctx.args.slice();
    let out = null, quiet = false, prefix = null, noClobber = false;
    const urls = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-O' || x === '--output-document') out = a[++i];
      else if (/^-O./.test(x)) out = x.slice(2);
      else if (/^--output-document=/.test(x)) out = x.split('=').slice(1).join('=');
      else if (x === '-q' || x === '--quiet' || x === '-nv' || x === '--no-verbose') quiet = true;
      else if (x === '-P' || x === '--directory-prefix') prefix = a[++i];
      else if (x === '-nc' || x === '--no-clobber') noClobber = true;
      else if (x === '-c' || x === '--continue' || x === '--no-check-certificate' || x === '-N') continue;
      else if (x === '--help' || x === '-h') {
        ctx.out(OWN_MAN.wget + '\n');
        return 0;
      } else if (x.startsWith('-')) throw userErr(`wget: option ${x} is not available here (see  man wget)`);
      else urls.push(x);
    }
    if (!urls.length) throw userErr('wget: missing URL\nUsage: wget [OPTION]... [URL]...');
    let code = 0;
    for (const url0 of urls) {
      const url = /^[a-z]+:\/\//i.test(url0) ? url0 : 'https://' + url0;
      if (!quiet) ctx.err(`--${new Date().toISOString().slice(0, 19).replace('T', ' ')}--  ${url}\n`);
      let r;
      try {
        r = await fetchFor(ctx, url, {});
      } catch (e) {
        webErr(ctx, 'wget', url, e);
        code = 4;
        continue;
      }
      if (!r.ok) {
        ctx.err(`ERROR ${r.status}: ${r.statusText || 'error'}.\n`);
        code = 8;
        continue;
      }
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (out === '-') {
        const t = MG.looksText('x', bytes);
        ctx.out(t != null ? t : bytes);
        continue;
      }
      let dest = out || nameOfUrl(r.url || url);
      if (prefix && !out) dest = prefix.replace(/\/+$/, '') + '/' + dest;
      if (noClobber && ctx.fs.exists(dest)) {
        ctx.err(`File '${dest}' already there; not retrieving.\n`);
        continue;
      }
      if (!out && ctx.fs.exists(dest)) {
        let k = 1;
        while (ctx.fs.exists(`${dest}.${k}`)) k++;
        dest = `${dest}.${k}`;
      }
      await saveBytes(ctx, dest, bytes);
      if (!quiet) ctx.err(`Length: ${bytes.length} (${MG.humanSize(bytes.length)}B)\nSaving to: '${dest}'\n\n'${dest}' saved [${bytes.length}]\n`);
      MG.bus.emit('web:download', { url, status: r.status, bytes: bytes.length, file: dest });
    }
    return code;
  };

  /* ------------------------------------------------------------------ unzip, zip, tar */
  const loadZip = async () => {
    if (!window.JSZip) await MG.loadScript('assets/vendor/jszip/jszip.min.js');
    return window.JSZip;
  };
  B.unzip = async (ctx) => {
    const a = ctx.args.slice();
    let dir = null, list = false, quiet = false;
    const files = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-d') dir = a[++i];
      else if (x === '-l') list = true;
      else if (x === '-q' || x === '-qq') quiet = true;
      else if (x === '-o' || x === '-n' || x === '-u') continue;
      else if (x === '--help' || x === '-h') {
        ctx.out(OWN_MAN.unzip + '\n');
        return 0;
      } else if (x.startsWith('-')) throw userErr(`unzip: option ${x} is not available here (see  man unzip)`);
      else files.push(x);
    }
    if (!files.length) throw userErr('usage: unzip [-l] [-q] FILE.zip [-d FOLDER]');
    const JSZip = await loadZip();
    const zipPath = files[0];
    if (!ctx.fs.exists(zipPath)) throw userErr(`unzip:  cannot find or open ${zipPath}, ${zipPath}.zip or ${zipPath}.ZIP.`);
    let zip;
    try {
      zip = await JSZip.loadAsync(await ctx.fs.readBytes(zipPath));
    } catch (e) {
      throw userErr(`unzip: ${zipPath} is not a zip archive (or it is damaged): ${e.message}`);
    }
    const names = Object.keys(zip.files).filter((n) => !/(^|\/)__MACOSX\//.test(n));
    if (list) {
      let total = 0;
      const rows = names.map((n) => {
        const z = zip.files[n];
        const size = (z._data && z._data.uncompressedSize) || 0;
        total += size;
        const d = z.date || new Date();
        return `${String(size).padStart(9)}  ${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}   ${n}`;
      });
      ctx.out(`Archive:  ${zipPath}\n  Length      Date    Time    Name\n---------  ---------- -----   ----\n${rows.join('\n')}\n---------                     -------\n${String(total).padStart(9)}                     ${names.length} files\n`);
      return 0;
    }
    if (!quiet) ctx.out(`Archive:  ${zipPath}\n`);
    const base = ctx.fs.resolve(dir || '.');
    let n = 0;
    for (const name of names) {
      const z = zip.files[name];
      const dest = ctx.fs.resolve(base + '/' + name.replace(/\/+$/, ''));
      if (!dest.startsWith(base + '/') && dest !== base) continue; // no ../ out of the folder
      if (z.dir) {
        ctx.fs.mkdirp(dest);
        if (!quiet) ctx.out(`   creating: ${ctx.fs.pretty(dest)}/\n`);
        continue;
      }
      const bytes = await z.async('uint8array');
      const text = MG.looksText(name, bytes);
      const when = z.date ? z.date.getTime() : Date.now();
      if (text != null) ctx.fs.put(dest, { kind: 'text', text, mtime: when, fresh: true });
      else ctx.fs.put(dest, { kind: 'blob', blob: new Blob([bytes]), size: bytes.length, mtime: when, fresh: true });
      if (!quiet) ctx.out(`  inflating: ${dir ? MG.path.basename(base) + '/' : ''}${name}\n`);
      n++;
    }
    MG.bus.emit('files:unzipped', { folder: base, n });
    return 0;
  };
  B.zip = async (ctx) => {
    const a = ctx.args.slice();
    let recursive = false, quiet = false;
    const rest = [];
    for (const x of a) {
      if (/^-[rq9]+$/.test(x)) {
        if (x.includes('r')) recursive = true;
        if (x.includes('q')) quiet = true;
      } else if (x === '--help' || x === '-h') {
        ctx.out(OWN_MAN.zip + '\n');
        return 0;
      } else if (x.startsWith('-')) throw userErr(`zip: option ${x} is not available here (see  man zip)`);
      else rest.push(x);
    }
    const [out, ...items] = rest;
    if (!out || !items.length) throw userErr('usage: zip [-r] ARCHIVE.zip FILE|FOLDER …');
    const JSZip = await loadZip();
    const zip = new JSZip();
    let n = 0;
    const addFile = async (abs, name) => {
      const e = ctx.fs.get(abs);
      zip.file(name, await ctx.fs.readBytes(abs), { date: new Date(e.mtime || Date.now()) });
      n++;
      if (!quiet) ctx.out(`  adding: ${name}\n`);
    };
    for (const it of items) {
      const abs = ctx.fs.resolve(it);
      const e = ctx.fs.get(abs);
      if (!e) {
        ctx.err(`zip warning: name not matched: ${it}\n`);
        continue;
      }
      if (e.kind === 'dir') {
        // (zip stores names without a leading /, as the real one does)
        if (!recursive) {
          ctx.out(`  adding: ${it.replace(/\/+$/, '').replace(/^\/+/, '')}/ (stored 0%)\n`);
          zip.folder(it.replace(/\/+$/, '').replace(/^\/+/, ''));
          continue;
        }
        const pre = it.replace(/\/+$/, '').replace(/^\/+/, '');
        for (const [p, x] of Array.from(ctx.fs.entries)) {
          if (!p.startsWith(abs + '/')) continue;
          const name = pre + p.slice(abs.length);
          if (x.kind === 'dir') zip.folder(name);
          else if (x.kind !== 'virtual') await addFile(p, name);
        }
      } else await addFile(abs, it.replace(/^\/+/, ''));
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const dest = /\.zip$/i.test(out) ? out : out + '.zip';
    ctx.fs.put(dest, { kind: 'blob', blob, size: blob.size, fresh: true });
    if (!n && !quiet) ctx.err('zip error: Nothing to do!\n');
    return n ? 0 : 12;
  };

  /* tar: read and write ustar archives (with gzip through the browser's own (de)compression) */
  async function gunzipBytes(bytes) {
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  async function gzipBytes(bytes) {
    const cs = new CompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(buf);
  }
  function tarEntries(buf) {
    const out = [];
    const dec = new TextDecoder();
    const str = (o, n) => dec.decode(buf.subarray(o, o + n)).replace(/\0.*$/s, '');
    let off = 0, longName = null;
    while (off + 512 <= buf.length) {
      if (buf.subarray(off, off + 512).every((b) => b === 0)) break;
      let name = str(off, 100);
      const size = parseInt(str(off + 124, 12).trim() || '0', 8) || 0;
      const mtime = parseInt(str(off + 136, 12).trim() || '0', 8) * 1000;
      const mode = parseInt(str(off + 100, 8).trim() || '644', 8);
      const type = String.fromCharCode(buf[off + 156] || 48);
      // (the owner and the group, by name – the ustar fields; an old archive without them: by number)
      const owner = str(off + 265, 32) || String(parseInt(str(off + 108, 8).trim() || '0', 8) || 0);
      const group = str(off + 297, 32) || String(parseInt(str(off + 116, 8).trim() || '0', 8) || 0);
      const prefix = str(off + 345, 155);
      if (prefix && dec.decode(buf.subarray(off + 257, off + 262)) === 'ustar') name = prefix + '/' + name;
      const data = buf.subarray(off + 512, off + 512 + size);
      off += 512 + Math.ceil(size / 512) * 512;
      if (type === 'L') {
        longName = dec.decode(data).replace(/\0.*$/s, '');
        continue;
      }
      if (type === 'x' || type === 'g') {
        const m = /\d+ path=([^\n]*)\n/.exec(dec.decode(data));
        if (m) longName = m[1];
        continue;
      }
      if (longName) {
        name = longName;
        longName = null;
      }
      out.push({ name, type: type === '5' ? 'dir' : type === '0' || type === '\0' || type === '7' ? 'file' : 'other', data, mtime, mode, owner, group });
    }
    return out;
  }
  function tarBuild(files) {
    const enc = new TextEncoder();
    const parts = [];
    const field = (h, off, len, s) => h.set(enc.encode(s).subarray(0, len), off);
    for (const f of files) {
      let name = f.name;
      const hdr = new Uint8Array(512);
      if (enc.encode(name).length > 99) {
        const lh = new Uint8Array(512), body = enc.encode(name + '\0');
        field(lh, 0, 100, '././@LongLink');
        field(lh, 100, 8, '0000644\0');
        field(lh, 124, 12, body.length.toString(8).padStart(11, '0') + '\0');
        field(lh, 136, 12, '00000000000\0');
        lh[156] = 'L'.charCodeAt(0);
        field(lh, 257, 6, 'ustar ');
        field(lh, 263, 2, ' \0');
        let sum = 0;
        for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : lh[i];
        field(lh, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
        parts.push(lh, body, new Uint8Array((512 - (body.length % 512)) % 512));
        name = name.slice(0, 99);
      }
      field(hdr, 0, 100, name);
      field(hdr, 100, 8, (f.dir ? '0000755' : f.mode === 'x' ? '0000755' : '0000644') + '\0');
      field(hdr, 108, 8, '0001750\0');
      field(hdr, 116, 8, '0001750\0');
      field(hdr, 124, 12, (f.dir ? 0 : f.data.length).toString(8).padStart(11, '0') + '\0');
      field(hdr, 136, 12, Math.floor((f.mtime || Date.now()) / 1000).toString(8).padStart(11, '0') + '\0');
      hdr[156] = (f.dir ? '5' : '0').charCodeAt(0);
      field(hdr, 257, 6, 'ustar ');
      field(hdr, 263, 2, ' \0');
      field(hdr, 265, 32, MG.user.login());
      field(hdr, 297, 32, MG.user.login());
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : hdr[i];
      field(hdr, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
      parts.push(hdr);
      if (!f.dir) {
        parts.push(f.data);
        parts.push(new Uint8Array((512 - (f.data.length % 512)) % 512));
      }
    }
    parts.push(new Uint8Array(1024));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
  B.tar = async (ctx) => {
    const a = ctx.args.slice();
    let mode = null, gz = false, file = null, verbose = false, dir = null;
    const items = [];
    const flags = (str) => {
      for (const c of str) {
        if ('xct'.includes(c)) mode = c;
        else if (c === 'z') gz = true;
        else if (c === 'v') verbose = true;
        else if (c === 'f') file = '__next__';
        else if (c === 'j' || c === 'J') throw userErr('tar: bzip2 and xz archives (j, J) are not available here – only .tar and .tar.gz');
        else throw userErr(`tar: option -${c} is not available here (see  man tar)`);
      }
    };
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (i === 0 && /^[xctzvf]+$/.test(x)) flags(x);
      else if (/^-[xctzvfjJ]+$/.test(x)) flags(x.slice(1));
      else if (x === '-C' || x === '--directory') dir = a[++i];
      else if (x === '--help') {
        ctx.out(OWN_MAN.tar + '\n');
        return 0;
      } else if (x.startsWith('--')) {
        if (x === '--gzip') gz = true;
        else if (x === '--extract') mode = 'x';
        else if (x === '--create') mode = 'c';
        else if (x === '--list') mode = 't';
        else if (/^--file=/.test(x)) file = x.slice(7);
        else throw userErr(`tar: option ${x} is not available here (see  man tar)`);
      } else if (file === '__next__') file = x;
      else items.push(x);
      if (file === '__next__' && i + 1 < a.length && !/^-/.test(a[i + 1])) file = a[++i];
    }
    if (!mode) throw userErr('tar: You must specify one of the \'-ctx\' options\nTry \'tar --help\' or \'man tar\' for more information.');
    if (!file || file === '__next__') throw userErr('tar: give the archive with f (tar -xzf FILE.tar.gz); reading from the keyboard is not available');
    if (mode === 'c') {
      const files = [];
      // (-C DIR: the names that follow are read in DIR – the archive itself is written where tar was started)
      const from = dir ? ctx.fs.resolve(dir) : null;
      if (from && !ctx.fs.isDir(from)) throw userErr(`tar: ${dir}: Cannot open: No such file or directory`);
      let failed = false, toldSlash = false;
      for (const it of items) {
        const abs = from && !it.startsWith('/') ? ctx.fs.resolve(from + '/' + it) : ctx.fs.resolve(it);
        const e = ctx.fs.get(abs);
        if (!e) {
          ctx.err(`tar: ${it}: Cannot stat: No such file or directory\n`);
          failed = true;
          continue;
        }
        let pre = it.replace(/\/+$/, '');
        if (pre.startsWith('/')) {
          if (!toldSlash) ctx.err("tar: Removing leading `/' from member names\n");
          toldSlash = true;
          pre = pre.replace(/^\/+/, '');
        }
        if (e.kind === 'dir') {
          files.push({ name: pre + '/', dir: true, mtime: e.mtime });
          for (const [p, x] of Array.from(ctx.fs.entries)) {
            if (!p.startsWith(abs + '/')) continue;
            const name = pre + p.slice(abs.length);
            if (x.kind === 'dir') files.push({ name: name + '/', dir: true, mtime: x.mtime });
            else if (x.kind !== 'virtual') files.push({ name, data: await ctx.fs.readBytes(p), mtime: x.mtime, mode: x.mode });
            if (verbose) ctx.out(name + (x.kind === 'dir' ? '/' : '') + '\n');
          }
        } else {
          files.push({ name: pre, data: await ctx.fs.readBytes(abs), mtime: e.mtime, mode: e.mode });
          if (verbose) ctx.out(pre + '\n');
        }
      }
      let bytes = tarBuild(files);
      if (gz || /\.(tgz|tar\.gz)$/i.test(file)) bytes = await gzipBytes(bytes);
      ctx.fs.put(file, { kind: 'blob', blob: new Blob([bytes]), size: bytes.length, fresh: true });
      if (failed) {
        ctx.err('tar: Exiting with failure status due to previous errors\n');
        return 2;
      }
      return 0;
    }
    if (!ctx.fs.exists(file)) throw userErr(`tar: ${file}: Cannot open: No such file or directory`);
    let bytes = await ctx.fs.readBytes(file);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzipBytes(bytes);
    const entries = tarEntries(bytes);
    if (mode === 't') {
      // (as GNU tar: owner/group and the size take at least 18 characters together – and as many as the widest so far)
      let ugsw = 18;
      const ugs = (e) => {
        const ug = `${e.owner}/${e.group}`, size = String(e.data.length), pad = ug.length + size.length;
        if (pad > ugsw) ugsw = pad;
        return ug + ' ' + size.padStart(ugsw - pad + size.length);
      };
      ctx.out(entries.map((e) => (verbose ? `${e.type === 'dir' ? 'd' : '-'}rw-r--r-- ${ugs(e)} ${new Date(e.mtime).toISOString().slice(0, 16).replace('T', ' ')} ` : '') + e.name).join('\n') + (entries.length ? '\n' : ''));
      return 0;
    }
    const base = ctx.fs.resolve(dir || '.');
    for (const e of entries) {
      const dest = ctx.fs.resolve(base + '/' + e.name.replace(/\/+$/, ''));
      if (!dest.startsWith(base + '/') && dest !== base) continue;
      if (e.type === 'dir') ctx.fs.mkdirp(dest);
      else if (e.type === 'file') {
        const data = e.data.slice();
        const text = MG.looksText(e.name, data);
        const extra = { mtime: e.mtime || Date.now(), mode: e.mode & 0o111 ? 'x' : undefined, fresh: true };
        if (text != null) ctx.fs.put(dest, Object.assign({ kind: 'text', text }, extra));
        else ctx.fs.put(dest, Object.assign({ kind: 'blob', blob: new Blob([data]), size: data.length }, extra));
      }
      if (verbose) ctx.out(e.name + '\n');
    }
    return 0;
  };


  /* ------------------------------------------------------------------ the session as a notebook or a script */
  const HOME = () => (MG.app && MG.app.HOME) || '/home/user';
  const tilde = (p) => (p === HOME() ? '~' : p.startsWith(HOME() + '/') ? '~' + p.slice(HOME().length) : p);
  const qpath = (p) => (/^[\w~/.\-+]+$/.test(p) ? p : "'" + p.replace(/'/g, "'\\''") + "'");
  MG.termSession = {
    entries(T) {
      return ((T || MG.app.term).transcript || []).filter((e) => e.line.trim() && !/^\s*(export-session|clear|history)\b/.test(e.line));
    },
    toIpynb(T, title) {
      const list = this.entries(T);
      const when = list.length ? new Date(list[0].t) : new Date();
      const cells = [
        {
          type: 'markdown',
          source: `# ${title || 'Terminal session'}\n\nCommands run in the terminal of the Digitiser workbench on ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, in the order they were run, with what they printed.\n\nEach cell starts with \`%%bash\`: it runs in the workbench's Notebook tab, and in Jupyter on a computer where trace-digitiser is installed (\`pip install trace-digitiser\`). \`~\` is the home folder; files from \`/data/examples\` come with the workbench.`
        }
      ];
      for (const e of list) {
        const outputs = [];
        if (e.stdout) outputs.push({ type: 'stream', name: 'stdout', text: e.stdout });
        if (e.stderr) outputs.push({ type: 'stream', name: 'stderr', text: e.stderr });
        cells.push({ type: 'code', source: `%%bash\ncd ${qpath(tilde(e.cwd))}\n${e.line}`, outputs, meta: e.code ? { workbench: { exit_status: e.code } } : {} });
      }
      return MG.nbformat.make('python', cells, { workbench: { kind: 'terminal-session' } });
    },
    toSh(T) {
      const list = this.entries(T);
      let cwd = null;
      const lines = ['#!/usr/bin/env bash', `# Commands from the terminal of the Digitiser workbench (${new Date().toLocaleString('en-GB')}).`, '# Run with:  bash THIS_FILE   (each command ran in the folder named by the cd line before it)', ''];
      for (const e of list) {
        if (e.cwd !== cwd) {
          lines.push(`cd ${qpath(tilde(e.cwd))}`);
          cwd = e.cwd;
        }
        lines.push(e.line + (e.code ? `    # exit status ${e.code}` : ''));
        if (/^\s*cd(\s|$)/.test(e.line)) cwd = null;
      }
      return lines.join('\n') + '\n';
    },
    stamp() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    },
    async saveNotebook(T, path, open) {
      const fs = MG.app.fs;
      const nb = this.toIpynb(T);
      fs.writeText(path, JSON.stringify(nb, null, 1));
      if (open) {
        await MG.app.showWorkbench('notebook');
        await MG.app.nbApp.open(path);
      }
      return path;
    },
    menu(anchor, T) {
      const n = this.entries(T).length;
      if (!n) {
        MG.toast('Nothing to save yet. Run some commands first.', 'warn');
        return;
      }
      const name = `terminal-session-${this.stamp()}`;
      MG.popmenu(anchor, [
        ['notebook', `Open as a notebook here (${n} command${n === 1 ? '' : 's'})`, async () => {
          const p = `${HOME()}/notebooks/${name}.ipynb`;
          MG.app.fs.mkdirp(`${HOME()}/notebooks`);
          await this.saveNotebook(T, p, true);
          MG.toast(`Saved as <b>${MG.esc(MG.app.fs.pretty(p))}</b>.`, 'ok');
        }],
        ['download', 'Download as a Jupyter notebook (.ipynb)', () => MG.downloadText(JSON.stringify(this.toIpynb(T), null, 1), name + '.ipynb', 'application/x-ipynb+json')],
        ['code', 'Download as a shell script (.sh)', () => MG.downloadText(this.toSh(T), name + '.sh', 'text/x-shellscript')],
        ['trash', 'Start a new session record (forget these commands)', () => {
          (T || MG.app.term).transcript = [];
          MG.toast('The session record is empty now. Commands you run from now on will be recorded.');
        }]
      ]);
    }
  };
  B['export-session'] = async (ctx) => {
    if (MG.shellUtil.forPerson && MG.shellUtil.forPerson(ctx)) return 1;
    const T = MG.app.term;
    const a = ctx.args;
    if (a[0] === '--clear') {
      T.transcript = [];
      ctx.out('The session record is empty now.\n');
      return 0;
    }
    if (!a.length || a[0] === '--help') {
      ctx.out(OWN_MAN['export-session'] + '\n');
      return a.length ? 0 : 1;
    }
    const f = a[0];
    if (/\.ipynb$/i.test(f)) {
      const p = ctx.fs.resolve(f);
      ctx.fs.writeText(p, JSON.stringify(MG.termSession.toIpynb(T), null, 1));
      ctx.out(`Saved ${MG.termSession.entries(T).length} commands to ${f}  (open it in the Notebook tab:  open ${f})\n`);
    } else {
      ctx.fs.writeText(f, MG.termSession.toSh(T), { mode: 'x' });
      ctx.out(`Saved ${MG.termSession.entries(T).length} commands to ${f}\n`);
    }
    return 0;
  };

  /* ------------------------------------------------------------------ man pages of the workbench's own commands */
  const OWN_MAN = {
    python: 'python – Python (Pyodide) in your browser: the same Python as the notebooks, with trace-digitiser installed.\n\n  python script.py [ARGUMENTS]\n  python -c "import trace_digitiser as td; print(td.__version__)"\n  python -m json.tool FILE.json                      print a JSON file tidily\n  python -m trace_digitiser.cli points FIGURE.png    (the same as  trace-digitiser points FIGURE.png)\n  python --version\n\nOther packages: pip install NAME (pure-Python ones, and those Pyodide has built – scipy, scikit-image …).\nFor Python line by line use the Notebook tab.',
    pip: 'pip – installs Python packages for this visit of the page (micropip): pure-Python packages from PyPI, and those Pyodide has built.\n\n  pip install NAME …\n  pip list\n  pip show NAME\n\ntrace-digitiser is installed already (help gives its version), with NumPy, OpenCV, pandas, Pillow and Matplotlib.',
    digitise: 'digitise – open a picture, or a PDF, in the Digitise tab, to look at it, mark its plot areas, axes and colours, and digitise it with the mouse.\n\n  digitise /data/examples/hearn-whitmore-2026/figure-1a.png\n  digitise ~/papers/smith-1987.pdf          choose a page, and the part of it with the figure\n\nWhat you do there can be done here too: each run in the Digitise tab shows the trace-digitiser command that does the same.',
    curl: 'curl – download from the web (through the browser). Only servers that allow web pages to read them (CORS) can be reached, such as raw.githubusercontent.com and Zenodo.\n\n  curl -L -o ~/data/data.csv https://raw.githubusercontent.com/comparativechrono/Rephasing-of-Seasonal-Birth-Rates-in-the-United-Kingdom-/main/data.csv\n\nOptions: -o FILE, -O, -s, -S, -f, -L, -H HEADER, -X METHOD, -d DATA, --data-binary @FILE, -I, -w \'%{http_code}\', --compressed (ignored).',
    wget: 'wget – download from the web (through the browser); the same reach as curl.\n\n  wget -P ~/data https://raw.githubusercontent.com/comparativechrono/Rephasing-of-Seasonal-Birth-Rates-in-the-United-Kingdom-/main/data.csv\n\nOptions: -O FILE (- for the screen), -q, -P FOLDER, -nc.',
    unzip: 'unzip – unpack a .zip archive.\n\n  unzip data.zip                 into the folder you are in\n  unzip data.zip -d data         into a folder\n  unzip -l data.zip              list what is in it\n  unzip -o data.zip              overwrite without asking (the default here)',
    zip: 'zip – make a .zip archive.\n\n  zip -r results.zip results/\n  zip notes.zip a.txt b.txt\n\n(To save a folder on your computer as a .zip in one step:  download FOLDER)',
    tar: 'tar – .tar and .tar.gz archives.\n\n  tar -xzf data.tar.gz            unpack (x) a gzipped (z) archive file (f)\n  tar -tzf data.tar.gz            list (t) what is in it\n  tar -xf data.tar -C folder      unpack into a folder\n  tar -czf results.tar.gz results/   make (c) one',
    'export-session': 'export-session – save the commands of this terminal session, with their output.\n\n  export-session session.ipynb    a Jupyter notebook: one %%bash cell per command (it opens in the Notebook tab, and in Jupyter)\n  export-session session.sh       a shell script of the commands\n  export-session --clear          forget the commands so far\n\nThe "Save session" button above the terminal does the same.'
  };
  /* man for trace-digitiser and compare-known: what it is for, examples, and its own --help (from Python, so it is
     always that of the version that runs here) */
  const man0 = B.man;
  B.man = async (ctx) => {
    const name = ctx.args.filter((a) => !a.startsWith('-'))[0];
    const key = { python3: 'python', pip3: 'pip' }[name] || name;
    if (OWN_MAN[key]) {
      ctx.out(OWN_MAN[key] + '\n');
      return 0;
    }
    if (PROGRAMS[key]) {
      const [what, example] = PROGRAMS[key];
      ctx.out(`${key} – ${what}\n\nExamples:\n${example.split('\n').map((l) => '  ' + l).join('\n')}\n\n`);
      return B[key](Object.assign({}, ctx, { args: ['--help'] }));
    }
    return man0(ctx);
  };

  /* ------------------------------------------------------------------ programs that are not here */
  if (MG.shellUtil.ABSENT)
    MG.shellUtil.ABSENT.splice(
      0,
      MG.shellUtil.ABSENT.length,
      [/^(engauge|engauge-digitizer|webplotdigitizer|plotdigitizer|g3data|datathief|digitizeit|graphclick)$/, 'isn’t installed in this terminal, but trace-digitiser does the same job here:  trace-digitiser FIGURE.png  (and points, bars, rows, heatmap or polar after it). To do it with the mouse, open the figure in the Digitise tab:  digitise FIGURE.png'],
      [/^(tesseract)$/, 'can’t run as a program in a web page. Tesseract is here all the same, compiled to WebAssembly: trace-digitiser uses it to read axis labels, and Python can too –  python -c "import pytesseract; print(pytesseract.get_tesseract_version())"'],
      [/^(pdftoppm|pdfimages|pdftocairo|pdftotext|mutool|gs|ghostscript|qpdf|convert|magick|identify|mogrify|inkscape)$/, 'isn’t installed in this terminal. To take a figure out of a PDF, open the PDF in the Digitise tab ( digitise PAPER.pdf ): it draws the page you choose as a picture in ~/pictures. For pictures, Python has Pillow (from PIL import Image) and OpenCV (import cv2).'],
      [/^(awk|gawk|mawk|nawk|perl|ruby|node|java|julia|R|Rscript|jq)$/, 'isn’t installed in this terminal. For tables (CSV files), Python has pandas:  python -c "import pandas as pd; print(pd.read_csv(\'FILE.csv\').describe())"  – or use the Notebook tab. For JSON, python -m json.tool FILE prints a file neatly.'],
      [/^(ipython|ipython3|jupyter)$/, 'isn’t a command here. Use the Notebook tab to run Python a line at a time.'],
      [/^(conda|mamba|micromamba|virtualenv|pipenv|poetry|pyenv|uv)$/, 'isn’t needed here, so the workbench doesn’t include it. trace-digitiser is already installed, and you can add other Python packages with  pip install NAME  (they last until you reload the page).'],
      [/^(apt|apt-get|yum|dnf|brew|docker|singularity|apptainer|git|make|module|cmake|gcc|cc|g\+\+|snakemake|nextflow)$/, 'isn’t available in this terminal, because programs can’t be installed or compiled in a web page. You can still add Python packages with  pip install NAME.'],
      [/^(ssh|scp|rsync|ping|ftp|sftp|nc|telnet)$/, 'isn’t available, because a web page can’t open network connections of its own. To download from servers that allow it, use curl or wget (see  man curl).'],
      [/^(top|htop|ps|kill|free|lscpu|df|mount|su|chown|screen|tmux|nohup|watch|crontab|pkill|pgrep|uptime|stty|getconf|lsblk|dmesg|who|w|last|service|systemctl|chgrp|mknod)$/, 'isn’t available in this terminal, which runs in a web page rather than on a whole computer.'],
      [/^(split|truncate|csplit|numfmt|cksum|sum|dd|tsort|fmt|pr|join|comm|fold|shuf|md5sum|cmp)$/, 'isn’t one of this terminal’s commands. Type  help  to see what’s here.'],
      [/^(gzip|gunzip|zcat|bgzip|bzip2|bunzip2|xz|unxz|7z|pigz|rar|unrar)$/, 'isn’t installed in this terminal. For archives, use zip, unzip and tar (tar -xzf and tar -czf for .tar.gz).'],
      [/^(iconv|recode|dos2unix|unix2dos)$/, "isn’t installed in this terminal. To remove the carriage returns from a Windows file, use  sed -i 's/\\r$//' FILE   or   tr -d '\\r' < FILE > NEWFILE"],
      [/^(mkfifo|flock)$/, 'isn’t available in this terminal. Commands here run one after another, so there are no named pipes and nothing to lock.'],
      [/^ln$/, 'isn’t available in this terminal, which has no links. Copy the file instead:  cp FILE NEWNAME'],
      [/^(alias|unalias)$/, 'isn’t available in this terminal. Write a function instead:  ll() { ls -l "$@"; }'],
      [/^(cal|ncal|banner|figlet|cowsay|fortune|yes)$/, 'isn’t installed in this terminal. Type  help  to see what’s here.']
    );

  /* ------------------------------------------------------------------ help */
  B.help = (ctx) => {
    // (the versions are known once Python has started; until then, those of the archive the page loads)
    const started = (MG.py && MG.py.versions && MG.py.versions.packages) || {};
    const v = Object.assign({}, (window.WB_BUNDLE && window.WB_BUNDLE.packages) || {}, started);
    const ver = (n) => (n === 'trace-digitiser' && v[n] ? ' ' + v[n] : '');
    const width = Math.max(17, ...Object.keys(PROGRAMS).map((n) => (n + ver(n)).length + 2));
    const row = (name, text) => '  ' + name.padEnd(width) + text;
    ctx.out(
      [
        'Commands in this terminal – every one runs here, in your browser.  (man NAME: examples; NAME --help: options)',
        '',
        'Digitising (Python; on your own computer:  pip install trace-digitiser):',
        ...Object.entries(PROGRAMS).map(([n, [what]]) => row(n + ver(n), what)),
        row('digitise FILE', 'open a picture or a PDF in the Digitise tab, to digitise it with the mouse'),
        '',
        'Python:',
        row('python', 'python script.py, python -c "…", python -m json.tool FILE.json (the notebooks\' Python)'),
        row('pip', 'pip install NAME, pip list'),
        '',
        'Text (written for this terminal after the GNU programs – NAME --help says which options they have):',
        '  cat head tail wc grep sort uniq cut tr tee paste diff seq sed date   less nl tac rev column',
        '',
        'Files, archives and the web:',
        '  ls cd pwd mkdir cp mv rm rmdir touch tree find du stat file chmod basename dirname realpath',
        '  unzip, zip, tar (-xzf, -czf)   curl, wget (servers that allow it: raw.githubusercontent.com, Zenodo …)',
        '  open FILE   show a file in its tab       nano FILE   edit it in Files       download FILE|FOLDER   save to your computer',
        "  export-session FILE.ipynb   this session's commands as a notebook (or FILE.sh as a script)",
        '',
        'The shell is bash: | && || ; > >> < 2> 2>&1, quotes, $VAR, $( ), $(( )), globs, if/for/while/case, functions,',
        '  [[ ]], here-documents, <( ), xargs, printf, read. Scripts: bash script.sh. Not there: background jobs (&), sudo, apt.',
        'Keys: ↑/↓ earlier commands · Tab completes · Ctrl+C stops · Ctrl+L clears.  Full guide: the Help pane (Terminal).',
        ''
      ].join('\n')
    );
  };
})();
