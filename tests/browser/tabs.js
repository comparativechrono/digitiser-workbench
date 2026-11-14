await waitFor(() => MG.app.digitise, 20000, 'the Digitise tab');
const K = MG.kernels.get();
await waitFor(() => K.state === 'ready', 400000, 'Python');
await waitFor(() => MG.app.digitise.warm, 120000, 'warm');
// ---- the notebook: the first starter notebook, every cell
await MG.app.showWorkbench('notebook');
const app = await waitFor(() => MG.app.nbApp && MG.app.nbApp.view, 30000, 'notebook view');
log('notebook open:', app.path);
const v = MG.app.nbApp.view;
log('cells', v.cells ? v.cells.length : '?', Object.keys(v).slice(0, 30).join(','));
//--SHOT nb-open
// ---- the terminal
await MG.app.showWorkbench('terminal');
const T = await waitFor(() => MG.app.term, 10000, 'terminal');
const st = await T.exec("trace-digitiser points /data/examples/hearn-whitmore-2026/figure-3c.png -o ~/results/t3 && compare-known ~/results/t3/figure-3c_points.csv");
log('terminal exit status', st);
const tr = T.transcript[T.transcript.length - 1];
log('terminal out', (tr.stdout || '').slice(-600), 'err', (tr.stderr || '').slice(-300));
const st2 = await T.exec("help | head -8");
log('help', (T.transcript[T.transcript.length - 1].stdout || '').slice(0, 500));
//--SHOT terminal
// ---- the AI tab, with no key
await MG.app.showWorkbench('assistant');
const A = await waitFor(() => MG.app.ai, 10000, 'assistant');
log('ai', document.querySelector('#aiRoot').innerText.slice(0, 400));
//--SHOT ai
// ---- a PDF: page 2 at 300 dpi, then straighten, then digitise
await MG.app.digitiseOpen('/data/examples/hearn-whitmore-2026/practice-pages.pdf');
await waitFor(() => document.querySelectorAll('.dg-pages .dg-thumb').length === 2, 30000, 'pages');
await sleep(1500);
//--SHOT pdf-pages
document.querySelectorAll('.dg-pages .dg-thumb')[1].click();
const D = MG.app.digitise;
await waitFor(() => D.path && D.path.includes('practice-pages-page2'), 60000, 'page 2 opened');
await waitFor(() => D.found, 60000, 'describe page 2');
log('page 2', D.W, D.H, 'tilt', D.found.tilt_degrees, 'panels', D.found.panels.map((p) => p.plot_area));
await D.straighten(D.found.tilt_degrees);
await waitFor(() => D.found && D.path.includes('straightened'), 60000, 'straightened');
log('straightened', D.path, D.W, D.H, 'tilt now', D.found.tilt_degrees, 'panels', D.found.panels.map((p) => p.plot_area));
const big = D.found.panels.sort((a, b) => (b.plot_area[2] - b.plot_area[0]) * (b.plot_area[3] - b.plot_area[1]) - (a.plot_area[2] - a.plot_area[0]) * (a.plot_area[3] - a.plot_area[1]))[0];
D.setKind('points');
await D.run();
log('pdf points', D.runError || D.result.table.n, D.result && D.result.warnings);
//--SHOT pdf-result
return 'ok';
