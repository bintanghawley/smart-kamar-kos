from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "0.0.0.0"
PORT = 5000

class Server(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length).decode()

        print("Data dari ESP32:")
        print(data)
        print()

        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"OK")

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"SMART KAMAR KOS SERVER")

server = HTTPServer((HOST, PORT), Server)

print("Server berjalan di port", PORT)
server.serve_forever()