await waitFor(() => MG.app.digitise, 20000, 'the Digitise tab');
const K = MG.kernels.get();
await waitFor(() => K.state === 'ready' || K.state === 'failed', 400000, 'Python');
await waitFor(() => MG.app.digitise.warm, 120000, 'warm');
const D = MG.app.digitise;
window.D = D;
const EX = '/data/examples/hearn-whitmore-2026/';
window.go = async (pic, set, name) => {
  await D.open(EX + pic);
  await waitFor(() => D.found, 120000, 'describe ' + pic);
  if (set) D.apply(set);
  const t = performance.now();
  await D.run();
  if (D.runError) { log(name, 'ERROR', D.runError); return; }
  await waitFor(() => D.compared, 60000, 'compare ' + pic);
  log(name, `${((performance.now() - t) / 1000).toFixed(1)}s`, D.result.table.n, 'rows;', D.compared.lines.join(' | '));
  log('   $', D.result.command.text, D.result.command.ok ? '' : '(' + D.result.command.why + ')');
};
await window.go('figure-1a.png', { kind: 'lines', marks: { colours: ['#4682b4'], exclude: [[120, 15, 262, 58]], areas: [], ticks: [] } }, '1a blue');
await window.go('figure-1a.png', { kind: 'lines', marks: { colours: ['#ff8c00'], exclude: [[990, 15, 1296, 58]], areas: [], ticks: [{ axis: 'y', px: 485.5, value: 6, side: 'right', at: [1310, 485] }, { axis: 'y', px: 34.5, value: 13, side: 'right', at: [1310, 35] }] } }, '1a orange');
await window.go('figure-1a.png', { kind: 'lines', marks: { colours: ['#228b22'], areas: [[543, 20, 876, 159]], exclude: [], ticks: [{ axis: 'x', px: 558, value: 1972, side: 'bottom', at: [558, 165] }, { axis: 'x', px: 865, value: 1979, side: 'bottom', at: [865, 165] }, { axis: 'y', px: 62, value: 60000, side: 'left', at: [540, 62] }, { axis: 'y', px: 118, value: 50000, side: 'left', at: [540, 118] }] } }, '1a green');
//--SHOT 1a-green
await window.go('figure-1b.png', { kind: 'bars', marks: { areas: [], exclude: [], ticks: [], colours: [] } }, '1b');
await window.go('figure-2.png', { kind: 'rows', marks: { areas: [], exclude: [], ticks: [], colours: [] }, options: { row_values: '1955:2013', bins: '24', dots: 'black', row_spacing_value: '1.1' } }, '2');
//--SHOT 2
await window.go('figure-3a.png', { kind: 'lines', marks: { areas: [], exclude: [], ticks: [], colours: [] } }, '3a');
await window.go('figure-3b.png', { kind: 'polar', marks: { colours: ['#1f77b4'], rings: [{ r: 5, value: 1955 }, { r: 250, value: 2005 }], centre: null } }, '3b');
//--SHOT 3b
await window.go('figure-4.png', { kind: 'heatmap', marks: { areas: [], exclude: [], ticks: [], colours: [], colourbar: null }, options: { rows: '21' } }, '4');
//--SHOT 4
await window.go('figure-s3.png', { kind: 'points', marks: { areas: [], exclude: [], ticks: [], colours: [] } }, 's3');
return 'ok';
