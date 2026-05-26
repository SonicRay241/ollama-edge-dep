import os
from http.server import HTTPServer, BaseHTTPRequestHandler
import socketserver

keys = os.getenv('API_KEYS', '')

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        auth = self.headers.get('Authorization', '')
        token = auth.replace('Bearer ', '').strip() if auth.startswith('Bearer ') else ''
        valid = token in [k.strip() for k in keys.split(',') if k.strip()]
        self.send_response(200 if valid else 401)
        self.end_headers()

socketserver.TCPServer.allow_reuse_address = True
HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()