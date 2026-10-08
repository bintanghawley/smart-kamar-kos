import os
import json
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "0.0.0.0"
PORT = 5000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ESP32_TIMEOUT_SECONDS = 7

sensor_data = {
    "suhu": 0,
    "kelembapan": 0,
    "cahaya": 0,
    "gas": 0,
    "led": "OFF",
    "buzzer": "OFF",
    "kipas": "OFF"
}

last_received_timestamp = 0
last_received_time_str = "Belum ada data"


class SmartKosServer(BaseHTTPRequestHandler):

    def send_json(self, status_code, data):
        response = json.dumps(data).encode("utf-8")

        self.send_response(status_code)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8"
        )
        self.send_header(
            "Content-Length",
            str(len(response))
        )
        self.send_header(
            "Cache-Control",
            "no-store"
        )
        self.end_headers()

        try:
            self.wfile.write(response)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        global sensor_data
        global last_received_timestamp
        global last_received_time_str

        clean_path = self.path.split("?")[0]

        if clean_path != "/data":
            self.send_json(
                404,
                {"error": "Endpoint Tidak Ditemukan"}
            )
            return

        try:
            length = int(
                self.headers.get("Content-Length", 0)
            )

            if length <= 0:
                self.send_json(
                    400,
                    {"error": "Payload Kosong"}
                )
                return

            body = self.rfile.read(length)

            payload = json.loads(
                body.decode("utf-8")
            )

            for key in (
                "suhu",
                "kelembapan",
                "cahaya",
                "gas"
            ):
                if key in payload:
                    sensor_data[key] = payload[key]

            for key in (
                "led",
                "buzzer",
                "kipas"
            ):
                if key in payload:
                    sensor_data[key] = str(
                        payload[key]
                    ).upper()

            last_received_timestamp = time.time()

            last_received_time_str = (
                datetime.now().strftime("%H:%M:%S")
            )

            print(
                f"[{last_received_time_str}] "
                f"Data ESP32: {sensor_data}"
            )

            self.send_json(
                200,
                {"status": "OK"}
            )

        except json.JSONDecodeError:
            self.send_json(
                400,
                {"error": "Format JSON Invalid"}
            )

        except Exception as e:
            print("Error memproses POST:", e)

            self.send_json(
                500,
                {"error": "Internal Server Error"}
            )

    def do_GET(self):
        global sensor_data
        global last_received_timestamp
        global last_received_time_str

        clean_path = self.path.split("?")[0]

        if clean_path == "/api/data":
            if last_received_timestamp > 0:
                esp32_online = (
                    time.time()
                    - last_received_timestamp
                    <= ESP32_TIMEOUT_SECONDS
                )
            else:
                esp32_online = False

            response_payload = dict(sensor_data)

            response_payload["esp32_online"] = (
                esp32_online
            )

            response_payload["last_seen"] = (
                last_received_time_str
            )

            self.send_json(
                200,
                response_payload
            )
            return

        path_map = {
            "/": "index.html",
            "/index.html": "index.html",
            "/style.css": "style.css",
            "/script.js": "script.js"
        }

        if clean_path not in path_map:
            self.send_error(404)
            return

        filename = path_map[clean_path]
        filepath = os.path.join(
            BASE_DIR,
            filename
        )

        if not os.path.exists(filepath):
            self.send_error(404)
            return

        if filename.endswith(".html"):
            content_type = "text/html; charset=utf-8"
        elif filename.endswith(".css"):
            content_type = "text/css; charset=utf-8"
        elif filename.endswith(".js"):
            content_type = (
                "application/javascript; charset=utf-8"
            )
        else:
            content_type = "application/octet-stream"

        try:
            with open(filepath, "rb") as file:
                content = file.read()

            self.send_response(200)
            self.send_header(
                "Content-Type",
                content_type
            )
            self.send_header(
                "Content-Length",
                str(len(content))
            )
            self.send_header(
                "Cache-Control",
                "no-store"
            )
            self.end_headers()

            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

        except Exception as e:
            print("Error membaca file:", e)

            self.send_error(500)


if __name__ == "__main__":
    server = ThreadingHTTPServer(
        (HOST, PORT),
        SmartKosServer
    )

    print(
        f"Server aktif di http://localhost:{PORT}"
    )

    try:
        server.serve_forever()

    except KeyboardInterrupt:
        print("\nServer dihentikan.")

    finally:
        server.server_close()