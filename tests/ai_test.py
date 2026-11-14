"""The AI assistant, with a stand-in for an AI service on localhost: what is it sent?

    python3 tests/ai_test.py

Serves the site, and an OpenAI-style /v1/chat/completions on another port that answers every request with a short
reply and keeps what it was sent. In headless Chrome: digitise Figure 3c in the Digitise tab, set the assistant up
with the stand-in, ask a question in the chat and one about the run (dg:ask), and give the agent a task whose step is
a trace-digitiser command. Then check what the service was sent: the Digitise tab's settings and messages – and no
picture (no PNG or JPEG data, base64 or otherwise), no values read from it, and nothing of the files' contents.
Needs Playwright and Chrome (as tests/browser_test.py).
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SENT = []
STEP = 0


class Site(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                          **{".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm"})

    def log_message(self, *a):
        pass


class Stub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        global STEP
        body = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0)).decode("utf-8", "replace")
        SENT.append(body)
        msgs = json.loads(body).get("messages", [])
        system = next((m["content"] for m in msgs if m["role"] == "system"), "")
        if "You are an AI agent" in system:
            STEP += 1
            reply = ("I will digitise the figure.\n\n```bash\ntrace-digitiser points "
                     "/data/examples/hearn-whitmore-2026/figure-3c.png -o out\n```" if STEP == 1 else
                     "Done: 51 points were found, in out/figure-3c_points.csv.")
        else:
            reply = "The messages mean that the axis runs downwards, which is right for this figure."
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        for i in range(0, len(reply), 20):
            chunk = {"choices": [{"delta": {"content": reply[i:i + 20]}}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")


def serve(handler):
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    site = serve(functools.partial(Site, directory=ROOT))
    stub = serve(Stub)
    stub_url = f"http://127.0.0.1:{stub.server_address[1]}/v1"
    with sync_playwright() as p:
        chrome = os.environ.get("CHROME", "/usr/bin/google-chrome")
        b = p.chromium.launch(executable_path=chrome if os.path.exists(chrome) else None, args=["--no-sandbox"])
        pg = b.new_context(viewport={"width": 1400, "height": 900}).new_page()
        pg.on("pageerror", lambda e: print("PAGEERROR:", e, flush=True))
        pg.on("console", lambda m: m.type == "error" and print("console.error:", m.text[:300], flush=True))
        pg.goto(f"http://127.0.0.1:{site.server_address[1]}/index.html")
        pg.wait_for_function("window.MG && MG.app && MG.app.isReady && MG.app.isReady()", timeout=60000)
        pg.evaluate("""async (url) => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const waitFor = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(200); } throw new Error('timed out'); };
          await waitFor(() => MG.app.digitise, 20000);
          const K = MG.kernels.get();
          await waitFor(() => K.state === 'ready', 400000);
          await waitFor(() => MG.app.digitise.warm, 120000);
          const D = MG.app.digitise;
          await D.open('/data/examples/hearn-whitmore-2026/figure-3c.png');
          await waitFor(() => D.found, 60000);
          await D.run();
          await MG.app.showWorkbench('assistant');
          const A = await waitFor(() => MG.app.ai, 10000);
          A.settings = Object.assign({}, A.settings, { provider: 'openai', baseURL: url, openaiModel: 'stub' });
          A.renderMode(); A.refreshIntro(); A.renderCtx();
          MG.app.prevBench = 'digitise';
          await A.send('Why does my figure have a CHECK message?');
          await waitFor(() => !A.busy, 30000);
          MG.bus.emit('dg:ask', {});
          await sleep(300);
          await waitFor(() => !A.busy, 30000);
          A.showTab('agent');
          await A.send('Digitise figure-3c of the examples as points');
          await waitFor(() => !A.busy, 120000);
        }""", stub_url)
        b.close()
    site.shutdown()
    stub.shutdown()
    problems = []
    print(f"the service was sent {len(SENT)} requests")
    for i, body in enumerate(SENT):
        text = " ".join(m["content"] for m in json.loads(body)["messages"])
        for bad, why in (("iVBOR", "PNG data"), ("/9j/", "JPEG data"), ("data:image", "a picture"),
                         ("0.22826", "a known value"), ("panel_id,series,colour", "a CSV file's header")):
            if bad in body:
                problems.append(f"request {i}: {why} ({bad})")
        print(f"request {i}: {len(body)} characters; the Digitise tab's settings: {'The Digitise tab (the picture itself is not sent)' in text}; "
              f"the run's command: {'trace-digitiser points' in text}")
    if not SENT:
        problems.append("nothing was sent")
    for p_ in problems:
        print("PROBLEM:", p_)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
