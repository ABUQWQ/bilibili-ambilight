"""Tiny loopback sink for the Bilibili ambient-light probe extension.

The probe extension runs chrome.tabs.captureVisibleTab() and posts the
resulting PNGs plus a DOM report here, so the agent can read the files
straight out of the workspace instead of asking the user to attach anything.

POST /upload?name=scroll-00.png   body = raw bytes
GET  /ping                        -> ok

Files are written to _tools/probe-captures/.
"""

import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = r"C:\Users\hh121\Desktop\aipro\yt32"
OUT = os.path.join(ROOT, "_tools", "probe-captures")
PORT = int(os.environ.get("PROBE_PORT", "8799"))
SAFE = re.compile(r"[^A-Za-z0-9._-]+")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/ping":
            body = b"ok"
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/upload":
            self.send_response(404)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        name = SAFE.sub("_", (parse_qs(parsed.query).get("name") or ["upload.bin"])[0])
        length = int(self.headers.get("Content-Length") or 0)
        payload = self.rfile.read(length) if length else b""

        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, name)
        with open(path, "wb") as handle:
            handle.write(payload)

        print(f"[probe] {name} {len(payload)} bytes", flush=True)
        body = f"{name} {len(payload)}".encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(f"[probe] listening on http://127.0.0.1:{PORT}, writing to {OUT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
