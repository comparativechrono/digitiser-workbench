// the help: its pages, and their buttons
await waitFor(() => MG.app.digitise, 20000, 'the Digitise tab');
const K = MG.kernels.get();
await waitFor(() => K.state === 'ready', 400000, 'Python');
await waitFor(() => MG.app.digitise.warm, 120000, 'warm');
MG.app.showHelp('h-home');
await sleep(300);
log('pages', document.querySelectorAll('.help-page').length, 'links to nowhere', Array.from(document.querySelectorAll('.help-page a[href^="#h-"]')).filter((a) => !document.getElementById(a.getAttribute('href').slice(1))).length);
//--SHOT help-home
MG.app.showHelp('h-walk-1a');
await sleep(300);
const b = Array.from(document.querySelectorAll('#h-walk-1a button.do')).find((x) => x.dataset.dgSet && x.dataset.dgSet.includes('ff8c00'));
b.click();
const D = MG.app.digitise;
await waitFor(() => D.result && D.result.command.text.includes('--y-ref 485.5:6'), 120000, 'the orange run');
await waitFor(() => D.compared, 60000, 'compare');
log('1a orange from the help', D.compared.lines);
//--SHOT help-1a
const D = MG.app.digitise;
MG.app.showHelp('h-walk-3c');
await sleep(300);
Array.from(document.querySelectorAll('#h-walk-3c button.do')).find((x) => x.dataset.dgRun != null).click();
await waitFor(() => D.path.endsWith('figure-3c.png') && D.result && D.result.path.endsWith('figure-3c.png'), 120000, '3c run');
await waitFor(() => D.compared, 60000, 'compare');
log('3c from the help', D.compared.lines[0]);
// a code box of the help: run in the terminal
MG.app.showHelp('h-terminal');
await sleep(300);
const runBtn = document.querySelector('#h-terminal .code-box .code-btn');
log('code box button', runBtn && runBtn.textContent);
runBtn.click();
await waitFor(() => MG.app.term && MG.app.term.transcript && MG.app.term.transcript.some((e) => /compare-known/.test(e.line)), 120000, 'terminal commands');
const T = MG.app.term;
await waitFor(() => !T.busy, 60000, 'terminal idle');
log('terminal ran', T.transcript.map((e) => e.line + ' → ' + e.code).join(' | '));
//--SHOT help-terminal
return 'ok';
