import os
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "0.0.0.0"
PORT = 5000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Menyimpan data sensor dan status aktuator terakhir
sensor_data = {
    "suhu": 0,
    "kelembapan": 0,
    "cahaya": 0,
    "gas": 0,
    "led": "OFF",
    "buzzer": "OFF",
    "kipas": "OFF"
}

class SmartKosServer(BaseHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        global sensor_data

        if self.path == "/data":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8")
                payload = json.loads(body)

                # Update nilai sensor dari ESP32
                for key in ("suhu", "kelembapan", "cahaya", "gas"):
                    if key in payload:
                        sensor_data[key] = payload[key]

                # Ambil status aktuator langsung dari ESP32 jika tersedia
                for actuator in ("led", "buzzer", "kipas"):
                    if actuator in payload:
                        sensor_data[actuator] = str(payload[actuator]).upper()

                print("Data diterima dari ESP32:")
                print(json.dumps(sensor_data))
                print("-" * 40)

                response = b'{"status":"OK"}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response)))
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(response)

            except Exception as e:
                print(f"Error memproses data POST: {e}")
                self.send_response(400)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Bad Request")
        else:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Endpoint Tidak Ditemukan")

    def do_GET(self):
        global sensor_data

        # 1. API data sensor terbaru untuk frontend
        if self.path == "/api/data":
            response = json.dumps(sensor_data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(response)
            return

        # 2. Static File Server untuk Website
        path_map = {
            "/": "index.html",
            "/index.html": "index.html",
            "/style.css": "style.css",
            "/script.js": "script.js"
        }

        clean_path = self.path.split("?")[0]

        if clean_path in path_map:
            filename = path_map[clean_path]
            filepath = os.path.join(BASE_DIR, filename)

            if os.path.exists(filepath):
                if filename.endswith(".html"):
                    ctype = "text/html; charset=utf-8"
                elif filename.endswith(".css"):
                    ctype = "text/css; charset=utf-8"
                elif filename.endswith(".js"):
                    ctype = "application/javascript; charset=utf-8"
                else:
                    ctype = "application/octet-stream"

                with open(filepath, "rb") as f:
                    content = f.read()

                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        self.send_response(404)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"404 Not Found")

if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), SmartKosServer)
    print(f"Server Smart Kamar Kos berjalan di http://localhost:{PORT}")
    print("Menerima data ESP32 pada: POST /data")
    print("Menyajikan API data pada:  GET /api/data")
    print("Menyajikan Website pada:   GET /")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
        server.server_close()