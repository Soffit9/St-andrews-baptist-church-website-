"""Serves the site with the exact CSP header from the Caddyfile, so the
policy can be checked in a real browser before it reaches the live site."""
import http.server
import re
import socketserver
from pathlib import Path

CADDY = Path("/home/claude/site/backend/Caddyfile.example").read_text()
m = re.search(r'Content-Security-Policy "([^"]+)"', CADDY)
CSP = m.group(1)
print("CSP under test:\n  " + CSP + "\n")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory="/home/claude/site", **kw)

    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8111), Handler) as httpd:
    httpd.serve_forever()
