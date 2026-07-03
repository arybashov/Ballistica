from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import webbrowser


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = 8000
    server = ThreadingHTTPServer(("localhost", port), Handler)
    url = f"http://localhost:{port}"
    print(f"Serving Ballistica at {url}")
    webbrowser.open(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
