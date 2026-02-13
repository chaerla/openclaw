#!/usr/bin/env python3
"""
Minimal proxy for Resend inbound email webhooks.
Receives POST (e.g. from ngrok) and forwards body + Svix headers to the
OpenClaw gateway so signature verification still works.

Usage:
  python server.py [port]
  python server.py 8080

Then: ngrok http 8080
Point Resend webhook at the ngrok URL (e.g. https://xxx.ngrok.io/inbound/email).
Set GATEWAY_URL to forward elsewhere (default http://127.0.0.1:3000).
"""

import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://127.0.0.1:3000").rstrip("/")
INBOUND_PATH = "/inbound/email"
TARGET = GATEWAY_URL + INBOUND_PATH
TIMEOUT = 30


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(format % args)

    def do_POST(self):
        if self.path != INBOUND_PATH and self.path != "/":
            self.send_error(404, "Not Found")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        # Forward Svix headers and Content-Type so gateway can verify signature
        forward_headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json"),
            "svix-id": self.headers.get("svix-id", ""),
            "svix-timestamp": self.headers.get("svix-timestamp", ""),
            "svix-signature": self.headers.get("svix-signature", ""),
        }
        req = Request(TARGET, data=body, headers=forward_headers, method="POST")
        try:
            with urlopen(req, timeout=TIMEOUT) as resp:
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() != "transfer-encoding":
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp.read())
        except HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            try:
                self.wfile.write(e.read())
            except Exception:
                pass
        except URLError as e:
            self.send_error(502, f"Gateway unreachable: {e.reason}")
        except Exception as e:
            self.send_error(502, str(e))

    def do_GET(self):
        if self.path == "/" or self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(f"OK proxy -> {TARGET}\n".encode())
            return
        self.send_error(404, "Not Found")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    with HTTPServer(("", port), ProxyHandler) as httpd:
        print(f"Email webhook proxy: POST {INBOUND_PATH} -> {TARGET}")
        print(f"Listening on 0.0.0.0:{port} (e.g. ngrok http {port})")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
