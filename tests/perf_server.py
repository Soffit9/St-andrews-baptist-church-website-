"""Serves the site files and proxies /api/* to Flask, like Caddy does,
so page-load weight can be measured the way a real visitor experiences it."""
import http.server
import socketserver
import urllib.request
import urllib.error

import re as _re
from pathlib import Path as _Path

ROOT = "/home/claude/site"
API = "http://127.0.0.1:5000"

# Send the SAME Content-Security-Policy the live Caddy config sends, so
# pages are tested under the real policy rather than a permissive one.
# Missing this is what let broken admin pages through last time.
_CADDY = _Path(ROOT + "/backend/Caddyfile.example").read_text()
_m = _re.search(r'Content-Security-Policy "([^"]+)"', _CADDY)
CSP = _m.group(1) if _m else None


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _proxy(self, method):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(API + self.path, data=body, method=method)
        for h in ("Content-Type", "Cookie", "If-None-Match"):
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        try:
            with urllib.request.urlopen(req) as r:
                data = r.read()
                self.send_response(r.status)
                for k, v in r.headers.items():
                    if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if data:
                    self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            for k, v in e.headers.items():
                if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if data:
                self.wfile.write(data)
        except Exception as exc:
            self.send_error(502, str(exc))

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):
        return self._proxy("POST")

    def end_headers(self):
        if CSP and not self.path.startswith("/api/"):
            self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", 8112), Handler) as httpd:
    httpd.serve_forever()
