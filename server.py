#!/usr/bin/env python3
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


BASE_DIR = Path(__file__).resolve().parent
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/config.js": "config.js",
    "/config.example.js": "config.example.js",
    "/app.js": "app.js",
    "/styles.css": "styles.css",
    "/manifest.webmanifest": "manifest.webmanifest",
    "/sw.js": "sw.js",
    "/icons/icon.svg": "icons/icon.svg",
    "/icons/icon-maskable.svg": "icons/icon-maskable.svg",
}


class JorddStaticHandler(BaseHTTPRequestHandler):
    server_version = "JorddStatic/1.0"

    def do_GET(self) -> None:
        self.serve(urlsplit(self.path).path)

    def do_HEAD(self) -> None:
        self.serve(urlsplit(self.path).path, head_only=True)

    def serve(self, path: str, head_only: bool = False) -> None:
        file_name = STATIC_FILES.get(path, "index.html")
        file_path = (BASE_DIR / file_name).resolve()
        if not file_path.exists() or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if BASE_DIR.resolve() not in file_path.parents and file_path != BASE_DIR.resolve():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        data = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if file_path.name in {
            "index.html",
            "config.js",
            "config.example.js",
            "app.js",
            "styles.css",
            "manifest.webmanifest",
            "sw.js",
        }:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()

        if not head_only:
            self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    port = int(os.environ.get("PORT", "8090"))
    server = ThreadingHTTPServer(("0.0.0.0", port), JorddStaticHandler)
    print(f"Jordd static dev server kjører på http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
