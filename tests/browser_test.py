"""Open the workbench in headless Chrome and exercise it.

    python3 tests/browser_test.py tests/browser/examples.js [TIMEOUT_S] [SCREENSHOT_PREFIX]

Serves the site on localhost, opens index.html, waits for the page, then runs the script in the page – in parts: a
line  //--SHOT name  ends a part, and the page is photographed there (SCREENSHOT_PREFIX-name.png). Each part is the
body of an async function, with  log(...), sleep(ms)  and  waitFor(fn, ms, what)  to hand; it prints what the script
logs, the console's errors and warnings, the page's errors, and the hosts the page contacted (which should be
localhost and cdn.jsdelivr.net, for Pyodide, only). Needs Playwright (pip install playwright) and Chrome or Chromium
(CHROME=/path/to/chrome).
"""
import functools
import os
import http.server
import json
import socketserver
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
script = open(sys.argv[1]).read()
timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 600
prefix = sys.argv[3] if len(sys.argv) > 3 else "/tmp/wb"


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                          **{".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm"})

    def log_message(self, *a):
        pass


handler = functools.partial(Quiet, directory=ROOT)
socketserver.ThreadingTCPServer.allow_reuse_address = True
httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
httpd.daemon_threads = True
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
with sync_playwright() as p:
    chrome = os.environ.get("CHROME", "/usr/bin/google-chrome")
    b = p.chromium.launch(executable_path=chrome if os.path.exists(chrome) else None, args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1500, "height": 950})
    pg = ctx.new_page()
    hosts = set()

    def on_request(req):
        hosts.add(req.url.split("/")[2])

    pg.on("request", on_request)
    pg.on("console", lambda m: print(m.text[4:] if m.text.startswith("LOG ") else f"console.{m.type}: {m.text[:600]}", flush=True) if m.type in ("error", "warning") or m.text.startswith("LOG") else None)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e, flush=True))
    pg.goto(f"http://127.0.0.1:{port}/index.html")
    pg.wait_for_function("window.MG && MG.app && MG.app.isReady && MG.app.isReady()", timeout=60000)
    t0 = time.time()
    # the script in parts: a line  //--SHOT name  ends a part, and the page is photographed there
    import re
    parts = re.split(r"^//--SHOT\s+(\S+)\s*$", script, flags=re.M)
    head = ("async (args) => { const log = (...a) => console.log('LOG ' + a.map((x) => typeof x === 'string' ? x : "
            "JSON.stringify(x)).join(' ')); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); "
            "const waitFor = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); "
            "if (v) return v; await sleep(250); } throw new Error('timed out waiting for ' + what); };\n")
    try:
        for i in range(0, len(parts), 2):
            r = pg.evaluate(head + parts[i] + "\n}", {"timeout": timeout})
            if r is not None:
                print("RESULT:", json.dumps(r)[:4000])
            if i + 1 < len(parts):
                pg.screenshot(path=f"{prefix}-{parts[i + 1]}.png")
                print("shot", parts[i + 1], flush=True)
    except Exception as e:  # noqa: BLE001
        print("SCRIPT FAILED:", str(e)[:3000])
        pg.screenshot(path=f"{prefix}-failed.png")
    print(f"took {time.time() - t0:.1f} s; hosts contacted: {sorted(hosts)}")
    b.close()
httpd.shutdown()
