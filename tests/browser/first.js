await waitFor(() => MG.app.digitise, 20000, 'the Digitise tab');
const K = MG.kernels.get();
const t0 = performance.now();
await waitFor(() => K.state === 'ready' || K.state === 'failed', 400000, 'Python');
log('python', K.state, ((performance.now() - t0) / 1000).toFixed(1) + ' s');
await waitFor(() => MG.app.digitise.warm, 120000, 'warm');
const D = MG.app.digitise;
window.D = D;
await D.open('/data/examples/hearn-whitmore-2026/figure-3c.png');
await waitFor(() => D.found, 120000, 'describe');
log('found', D.found.panels.map((p) => [p.plot_area, p.y_axis && p.y_axis.scale, p.x_axis && p.x_axis.scale, p.colours.map((c) => c.hex)]), 'in', D.found.seconds);
//--SHOT 3c-found
await D.run();
log('result', D.result && D.result.table.n, D.result && D.result.seconds, D.result && D.result.warnings, D.runError);
await waitFor(() => D.compared, 60000, 'compare');
log('compare', D.compared.lines);
//--SHOT 3c-result
log('command', D.result.command.text);
return 'ok';
