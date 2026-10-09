
import os
import json
import time
import math
import joblib
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "0.0.0.0"
PORT = 5000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ESP32_TIMEOUT_SECONDS = 7
AI_MODEL_FILE = os.path.join(BASE_DIR, "ai", "ai_model.pkl")
AI_WINDOW_SIZE = 5
AI_ANOMALY_REQUIRED = 3

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

ai_model = None
ai_features = ["suhu", "kelembapan", "cahaya", "gas"]
ai_predictions = deque(maxlen=AI_WINDOW_SIZE)
ai_status = "MENUNGGU DATA"
ai_raw_status = "MENUNGGU DATA"
ai_score = None
ai_error = None


def load_ai_model():
    global ai_model, ai_features, ai_error, ai_status

    try:
        bundle = joblib.load(AI_MODEL_FILE)
        ai_model = bundle["model"]
        ai_features = bundle["features"]
        ai_error = None
        ai_status = "MENUNGGU DATA"

        print("Model AI berhasil dimuat.")
        print("Fitur AI:", ", ".join(ai_features))

    except Exception as error:
        ai_model = None
        ai_error = str(error)
        ai_status = "TIDAK TERSEDIA"
        print("Model AI gagal dimuat:", error)


def predict_ai(data):
    global ai_status, ai_raw_status, ai_score, ai_error

    if ai_model is None:
        ai_status = "TIDAK TERSEDIA"
        return

    try:
        values = [float(data[field]) for field in ai_features]

        if not all(math.isfinite(value) for value in values):
            raise ValueError("Nilai sensor tidak valid.")

        if data["suhu"] == 0 and data["kelembapan"] == 0:
            ai_status = "MENUNGGU DATA"
            return

        prediction = int(ai_model.predict([values])[0])
        ai_score = float(ai_model.decision_function([values])[0])
        ai_raw_status = "ANOMALI" if prediction == -1 else "NORMAL"

        ai_predictions.append(prediction)
        anomaly_count = sum(
            result == -1 for result in ai_predictions
        )

        if len(ai_predictions) < AI_WINDOW_SIZE:
            ai_status = "MENGANALISIS"
        elif anomaly_count >= AI_ANOMALY_REQUIRED:
            ai_status = "ANOMALI"
        else:
            ai_status = "NORMAL"

        ai_error = None

    except Exception as error:
        ai_status = "TIDAK TERSEDIA"
        ai_error = str(error)
        print("Gagal melakukan prediksi AI:", error)


def get_ai_data():
    return {
        "ai_status": ai_status,
        "ai_raw_status": ai_raw_status,
        "ai_score": ai_score,
        "ai_samples_checked": len(ai_predictions),
        "ai_anomaly_count": sum(
            result == -1 for result in ai_predictions
        ),
        "ai_available": ai_model is not None
    }


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
        self.send_header("Cache-Control", "no-store")
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
            length = int(self.headers.get("Content-Length", 0))

            if length <= 0:
                self.send_json(400, {"error": "Payload Kosong"})
                return

            body = self.rfile.read(length)
            payload = json.loads(body.decode("utf-8"))

            for key in ("suhu", "kelembapan", "cahaya", "gas"):
                if key in payload:
                    sensor_data[key] = payload[key]

            for key in ("led", "buzzer", "kipas"):
                if key in payload:
                    sensor_data[key] = str(payload[key]).upper()

            predict_ai(sensor_data)

            last_received_timestamp = time.time()
            last_received_time_str = datetime.now().strftime("%H:%M:%S")

            print(
                "[{}] Data ESP32 diterima | AI: {} | Skor: {}".format(
                    last_received_time_str,
                    ai_status,
                    "{:.4f}".format(ai_score)
                    if ai_score is not None else "-"
                )
            )

            self.send_json(200, {"status": "OK"})

        except json.JSONDecodeError:
            self.send_json(400, {"error": "Format JSON Invalid"})

        except Exception as error:
            print("Error memproses POST:", error)
            self.send_json(500, {"error": "Internal Server Error"})

    def do_GET(self):
        global sensor_data
        global last_received_timestamp
        global last_received_time_str

        clean_path = self.path.split("?")[0]

        if clean_path == "/api/data":
            if last_received_timestamp > 0:
                esp32_online = (
                    time.time() - last_received_timestamp
                    <= ESP32_TIMEOUT_SECONDS
                )
            else:
                esp32_online = False

            response_payload = dict(sensor_data)
            response_payload["esp32_online"] = esp32_online
            response_payload["last_seen"] = last_received_time_str
            response_payload.update(get_ai_data())

            self.send_json(200, response_payload)
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
        filepath = os.path.join(BASE_DIR, filename)

        if not os.path.exists(filepath):
            self.send_error(404)
            return

        if filename.endswith(".html"):
            content_type = "text/html; charset=utf-8"
        elif filename.endswith(".css"):
            content_type = "text/css; charset=utf-8"
        elif filename.endswith(".js"):
            content_type = "application/javascript; charset=utf-8"
        else:
            content_type = "application/octet-stream"

        try:
            with open(filepath, "rb") as file:
                content = file.read()

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

        except Exception as error:
            print("Error membaca file:", error)
            self.send_error(500)


if __name__ == "__main__":
    load_ai_model()

    server = ThreadingHTTPServer((HOST, PORT), SmartKosServer)
    print("Server aktif pada port {}".format(PORT))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
    finally:
        server.server_close()