"""Local dev server with caching disabled, so edits show up on a normal reload.
Usage: python3 serve.py   then open http://localhost:8000"""
import functools, http.server, os

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

root = os.path.dirname(os.path.abspath(__file__))
print('Serving http://localhost:8000  (Ctrl+C to stop)')
http.server.ThreadingHTTPServer(('127.0.0.1', 8000), functools.partial(NoCache, directory=root)).serve_forever()
