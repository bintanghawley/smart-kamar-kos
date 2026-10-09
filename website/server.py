
import os
import csv
import json
import time
import math
import shutil
import threading
import joblib

from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from sklearn.ensemble import IsolationForest

HOST = "0.0.0.0"
PORT = 5000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AI_DIR = os.path.join(BASE_DIR, "ai")

MODEL_FILE = os.path.join(AI_DIR, "ai_model.pkl")
BACKUP_MODEL_FILE = os.path.join(AI_DIR, "ai_model_backup.pkl")
PENDING_MODEL_FILE = os.path.join(AI_DIR, "ai_model_pending.pkl")

PENDING_DATASET_FILE = os.path.join(
    AI_DIR, "dataset_calibration_pending.csv"
)
CALIBRATION_DATASET_FILE = os.path.join(
    AI_DIR, "dataset_calibration.csv"
)

ESP32_TIMEOUT_SECONDS = 7
CALIBRATION_TARGET = 100
CALIBRATION_INTERVAL_SECONDS = 10
CALIBRATION_CONTAMINATION = 0.02
GAS_THRESHOLD = 1200

AI_FEATURES = ["suhu", "kelembapan", "cahaya", "gas"]
AI_WINDOW_SIZE = 5
AI_ANOMALY_REQUIRED = 3

state_lock = threading.RLock()
model_lock = threading.RLock()

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
ai_features = AI_FEATURES[:]
ai_model_info = {}
ai_predictions = deque(maxlen=AI_WINDOW_SIZE)
ai_status = "TIDAK TERSEDIA"
ai_raw_status = "MENUNGGU DATA"
ai_score = None
ai_error = None

calibration_samples = []
last_calibration_sample_time = 0

calibration_state = {
    "status": "IDLE",
    "active": False,
    "samples_collected": 0,
    "target_samples": CALIBRATION_TARGET,
    "skipped_samples": 0,
    "message": "Kalibrasi belum dimulai.",
    "started_at": None,
    "finished_at": None
}


def load_ai_model():
    global ai_model
    global ai_features
    global ai_model_info
    global ai_status
    global ai_error

    if not os.path.exists(MODEL_FILE):
        ai_model = None
        ai_status = "TIDAK TERSEDIA"
        ai_error = "Model AI belum tersedia."
        print("Model AI belum tersedia. Kalibrasi diperlukan.")
        return

    try:
        bundle = joblib.load(MODEL_FILE)

        if not isinstance(bundle, dict) or "model" not in bundle:
            raise ValueError("Format file model tidak sesuai.")

        with model_lock:
            ai_model = bundle["model"]
            ai_features = bundle.get("features", AI_FEATURES[:])
            ai_model_info = bundle

        ai_status = "MENUNGGU DATA"
        ai_error = None

        if bundle.get("calibration_mode") == "manual":
            calibration_state.update({
                "status": "COMPLETED",
                "active": False,
                "samples_collected": bundle.get(
                    "training_samples", CALIBRATION_TARGET
                ),
                "target_samples": CALIBRATION_TARGET,
                "message": "Model hasil kalibrasi tersimpan dan siap digunakan.",
                "finished_at": bundle.get("trained_at")
            })
        else:
            calibration_state["message"] = (
                "Model awal tersedia. Kalibrasi ruangan dapat dilakukan."
            )

        print("Model AI berhasil dimuat.")
        print("Fitur AI:", ", ".join(ai_features))

    except Exception as error:
        ai_model = None
        ai_status = "TIDAK TERSEDIA"
        ai_error = str(error)
        print("Model AI gagal dimuat:", error)


def validate_sensor_data(data):
    try:
        values = {
            feature: float(data[feature])
            for feature in AI_FEATURES
        }
    except (KeyError, TypeError, ValueError):
        return None, "Data sensor tidak lengkap."

    if not all(math.isfinite(value) for value in values.values()):
        return None, "Data sensor bukan angka valid."

    if not -40 <= values["suhu"] <= 80:
        return None, "Pembacaan suhu tidak valid."

    if not 0 <= values["kelembapan"] <= 100:
        return None, "Pembacaan kelembapan tidak valid."

    if not 0 <= values["cahaya"] <= 4095:
        return None, "Pembacaan LDR tidak valid."

    if not 0 <= values["gas"] <= 4095:
        return None, "Pembacaan gas tidak valid."

    if values["suhu"] == 0 and values["kelembapan"] == 0:
        return None, "Pembacaan DHT11 tidak valid."

    return values, None


def validate_calibration_data(data):
    values, error = validate_sensor_data(data)

    if error:
        return None, error

    if (
        values["gas"] >= GAS_THRESHOLD
        or str(data.get("buzzer", "OFF")).upper() == "ON"
    ):
        return None, (
            "Sampel dilewati karena peringatan gas aktif. "
            "Pastikan kondisi ruangan normal dan aman."
        )

    return values, None


def get_calibration_payload():
    with state_lock:
        return {
            "calibration_status": calibration_state["status"],
            "calibration_active": calibration_state["active"],
            "calibration_busy": calibration_state["status"] in (
                "COLLECTING", "TRAINING"
            ),
            "calibration_samples": calibration_state["samples_collected"],
            "calibration_target": calibration_state["target_samples"],
            "calibration_skipped": calibration_state["skipped_samples"],
            "calibration_message": calibration_state["message"],
            "calibration_started_at": calibration_state["started_at"],
            "calibration_finished_at": calibration_state["finished_at"]
        }


def get_ai_payload():
    with model_lock:
        available = ai_model is not None
        info = dict(ai_model_info)

    with state_lock:
        return {
            "ai_status": ai_status,
            "ai_raw_status": ai_raw_status,
            "ai_score": ai_score,
            "ai_samples_checked": len(ai_predictions),
            "ai_anomaly_count": sum(
                result == -1 for result in ai_predictions
            ),
            "ai_available": available,
            "ai_error": ai_error,
            "ai_training_samples": info.get("training_samples"),
            "ai_model_trained_at": info.get("trained_at"),
            "ai_contamination": info.get("contamination")
        }


def start_calibration():
    global last_calibration_sample_time
    global ai_status
    global ai_raw_status
    global ai_score

    with state_lock:
        if calibration_state["status"] in ("COLLECTING", "TRAINING"):
            return 409, {
                "status": "ERROR",
                "message": "Kalibrasi sedang berjalan."
            }

        online = (
            last_received_timestamp > 0
            and time.time() - last_received_timestamp
            <= ESP32_TIMEOUT_SECONDS
        )

        if not online:
            return 409, {
                "status": "ERROR",
                "message": "ESP32 offline. Periksa koneksi terlebih dahulu."
            }

        values, error = validate_calibration_data(sensor_data)

        if error:
            return 409, {
                "status": "ERROR",
                "message": error
            }

        try:
            os.makedirs(AI_DIR, exist_ok=True)

            with open(
                PENDING_DATASET_FILE,
                "w",
                newline="",
                encoding="utf-8"
            ) as file:
                writer = csv.writer(file)
                writer.writerow(
                    ["timestamp"] + AI_FEATURES
                )

        except Exception as error:
            return 500, {
                "status": "ERROR",
                "message": "Gagal menyiapkan dataset: " + str(error)
            }

        calibration_samples.clear()
        last_calibration_sample_time = 0

        calibration_state.update({
            "status": "COLLECTING",
            "active": True,
            "samples_collected": 0,
            "target_samples": CALIBRATION_TARGET,
            "skipped_samples": 0,
            "message": "Mengumpulkan data normal.",
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "finished_at": None
        })

        ai_predictions.clear()
        ai_status = "KALIBRASI"
        ai_raw_status = "KALIBRASI"
        ai_score = None

    print("Kalibrasi dimulai.")
    return 200, {
        "status": "OK",
        "message": "Kalibrasi dimulai."
    }


def cancel_calibration():
    global ai_status
    global ai_raw_status
    global ai_score

    with state_lock:
        if calibration_state["status"] == "TRAINING":
            return 409, {
                "status": "ERROR",
                "message": (
                    "Model sedang dilatih. Tunggu proses ini selesai."
                )
            }

        if calibration_state["status"] != "COLLECTING":
            return 409, {
                "status": "ERROR",
                "message": "Tidak ada kalibrasi aktif."
            }

        calibration_state.update({
            "status": "CANCELLED",
            "active": False,
            "message": (
                "Kalibrasi dibatalkan. Model sebelumnya tetap digunakan."
            ),
            "finished_at": datetime.now().isoformat(timespec="seconds")
        })

        calibration_samples.clear()

        try:
            if os.path.exists(PENDING_DATASET_FILE):
                os.remove(PENDING_DATASET_FILE)
        except OSError as error:
            print("Peringatan, file sementara belum terhapus:", error)

        ai_predictions.clear()
        ai_status = (
            "MENUNGGU DATA" if ai_model is not None
            else "TIDAK TERSEDIA"
        )
        ai_raw_status = "MENUNGGU DATA"
        ai_score = None

    print("Kalibrasi dibatalkan.")
    return 200, {
        "status": "OK",
        "message": "Kalibrasi dibatalkan."
    }


def collect_calibration_sample(data):
    global last_calibration_sample_time

    if calibration_state["status"] != "COLLECTING":
        return None

    now = time.monotonic()

    if (
        last_calibration_sample_time != 0
        and now - last_calibration_sample_time
        < CALIBRATION_INTERVAL_SECONDS
    ):
        return None

    last_calibration_sample_time = now

    values, error = validate_calibration_data(data)

    if error:
        calibration_state["skipped_samples"] += 1
        calibration_state["message"] = error
        return None

    record = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        **values
    }

    try:
        with open(
            PENDING_DATASET_FILE,
            "a",
            newline="",
            encoding="utf-8"
        ) as file:
            writer = csv.writer(file)
            writer.writerow(
                [record["timestamp"]]
                + [record[feature] for feature in AI_FEATURES]
            )

    except Exception as error:
        calibration_state.update({
            "status": "FAILED",
            "active": False,
            "message": "Gagal menyimpan sampel: " + str(error)
        })
        print("Gagal menyimpan sampel kalibrasi:", error)
        return None

    calibration_samples.append(record)

    calibration_state["samples_collected"] = len(calibration_samples)
    calibration_state["message"] = "Mengumpulkan data normal."

    if len(calibration_samples) >= CALIBRATION_TARGET:
        calibration_state.update({
            "status": "TRAINING",
            "active": False,
            "message": "Sampel lengkap. Melatih model AI."
        })
        return list(calibration_samples)

    return None


def train_calibration_model(samples):
    global ai_model
    global ai_features
    global ai_model_info
    global ai_status
    global ai_raw_status
    global ai_score
    global ai_error

    model_replaced = False

    try:
        if len(samples) < CALIBRATION_TARGET:
            raise ValueError("Jumlah sampel kalibrasi belum mencukupi.")

        X = [
            [float(sample[feature]) for feature in AI_FEATURES]
            for sample in samples
        ]

        unique_samples = {
            tuple(values) for values in X
        }

        if len(unique_samples) < 10:
            raise ValueError(
                "Variasi data terlalu sedikit. "
                "Periksa posisi sensor dan ulangi kalibrasi."
            )

        model = IsolationForest(
            n_estimators=200,
            contamination=CALIBRATION_CONTAMINATION,
            random_state=42
        )

        model.fit(X)

        values_by_feature = {
            feature: [row[index] for row in X]
            for index, feature in enumerate(AI_FEATURES)
        }

        trained_at = datetime.now().isoformat(timespec="seconds")

        bundle = {
            "model": model,
            "features": AI_FEATURES[:],
            "contamination": CALIBRATION_CONTAMINATION,
            "trained_at": trained_at,
            "training_samples": len(X),
            "training_data_min": {
                feature: min(values)
                for feature, values in values_by_feature.items()
            },
            "training_data_max": {
                feature: max(values)
                for feature, values in values_by_feature.items()
            },
            "calibration_mode": "manual"
        }

        joblib.dump(bundle, PENDING_MODEL_FILE)

        shutil.copy2(
            PENDING_DATASET_FILE,
            CALIBRATION_DATASET_FILE
        )

        if os.path.exists(MODEL_FILE):
            shutil.copy2(MODEL_FILE, BACKUP_MODEL_FILE)

        os.replace(PENDING_MODEL_FILE, MODEL_FILE)
        model_replaced = True

        with model_lock:
            ai_model = model
            ai_features = AI_FEATURES[:]
            ai_model_info = bundle

        with state_lock:
            ai_predictions.clear()
            ai_status = "MENUNGGU DATA"
            ai_raw_status = "MENUNGGU DATA"
            ai_score = None
            ai_error = None

            calibration_state.update({
                "status": "COMPLETED",
                "active": False,
                "samples_collected": len(samples),
                "message": "Kalibrasi berhasil. Model baru sudah disimpan.",
                "finished_at": trained_at
            })

        try:
            if os.path.exists(PENDING_DATASET_FILE):
                os.remove(PENDING_DATASET_FILE)
        except OSError:
            pass

        print("Kalibrasi berhasil.")
        print("Sampel pelatihan:", len(samples))
        print("Model baru tersimpan:", MODEL_FILE)

        if os.path.exists(BACKUP_MODEL_FILE):
            print("Cadangan model tersedia:", BACKUP_MODEL_FILE)

    except Exception as error:
        if not model_replaced and os.path.exists(PENDING_MODEL_FILE):
            try:
                os.remove(PENDING_MODEL_FILE)
            except OSError:
                pass

        with state_lock:
            calibration_state.update({
                "status": "FAILED",
                "active": False,
                "message": (
                    "Kalibrasi gagal. Model sebelumnya dipertahankan."
                ),
                "finished_at": datetime.now().isoformat(timespec="seconds")
            })

            ai_status = (
                "MENUNGGU DATA" if ai_model is not None
                else "TIDAK TERSEDIA"
            )
            ai_error = str(error)

        print("Kalibrasi gagal:", error)
        print("Model sebelumnya tetap digunakan.")


def predict_ai(data):
    global ai_status
    global ai_raw_status
    global ai_score
    global ai_error

    with state_lock:
        if calibration_state["status"] in ("COLLECTING", "TRAINING"):
            ai_status = "KALIBRASI"
            ai_raw_status = "KALIBRASI"
            return

    with model_lock:
        model = ai_model
        features = ai_features[:]

    if model is None:
        with state_lock:
            ai_status = "TIDAK TERSEDIA"
        return

    values, error = validate_sensor_data(data)

    if error:
        return

    try:
        row = [[values[feature] for feature in features]]
        prediction = int(model.predict(row)[0])
        score = float(model.decision_function(row)[0])

        with state_lock:
            if calibration_state["status"] in (
                "COLLECTING", "TRAINING"
            ):
                ai_status = "KALIBRASI"
                ai_raw_status = "KALIBRASI"
                return

            ai_predictions.append(prediction)
            ai_raw_status = (
                "ANOMALI" if prediction == -1 else "NORMAL"
            )
            ai_score = score

            if len(ai_predictions) < AI_WINDOW_SIZE:
                ai_status = "MENGANALISIS"
            else:
                anomaly_count = sum(
                    result == -1 for result in ai_predictions
                )

                if anomaly_count >= AI_ANOMALY_REQUIRED:
                    ai_status = "ANOMALI"
                else:
                    ai_status = "NORMAL"

            ai_error = None

    except Exception as error:
        with state_lock:
            ai_status = "TIDAK TERSEDIA"
            ai_error = str(error)

        print("Gagal melakukan prediksi AI:", error)


class SmartKosServer(BaseHTTPRequestHandler):
    def send_json(self, status_code, data):
        response = json.dumps(data).encode("utf-8")

        self.send_response(status_code)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8"
        )
        self.send_header("Content-Length", str(len(response)))
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
        global ai_status
        global ai_raw_status

        clean_path = self.path.split("?")[0]

        if clean_path == "/api/calibration/start":
            status_code, response = start_calibration()
            self.send_json(status_code, response)
            return

        if clean_path == "/api/calibration/cancel":
            status_code, response = cancel_calibration()
            self.send_json(status_code, response)
            return

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

            if not isinstance(payload, dict):
                self.send_json(
                    400,
                    {"error": "Format payload harus berupa objek JSON"}
                )
                return

            with state_lock:
                for key in ("suhu", "kelembapan", "cahaya", "gas"):
                    if key in payload:
                        sensor_data[key] = payload[key]

                for key in ("led", "buzzer", "kipas"):
                    if key in payload:
                        sensor_data[key] = str(payload[key]).upper()

                last_received_timestamp = time.time()
                last_received_time_str = (
                    datetime.now().strftime("%H:%M:%S")
                )

                current_data = dict(sensor_data)
                samples_to_train = None

                if calibration_state["status"] == "COLLECTING":
                    samples_to_train = collect_calibration_sample(
                        current_data
                    )

                busy = calibration_state["status"] in (
                    "COLLECTING", "TRAINING"
                )

                if busy:
                    ai_status = "KALIBRASI"
                    ai_raw_status = "KALIBRASI"

            if not busy:
                predict_ai(current_data)

            if samples_to_train is not None:
                threading.Thread(
                    target=train_calibration_model,
                    args=(samples_to_train,),
                    daemon=True
                ).start()

            with state_lock:
                current_ai_status = ai_status
                current_ai_score = ai_score

            print(
                "[{}] Data ESP32 diterima | AI: {} | Skor: {}".format(
                    last_received_time_str,
                    current_ai_status,
                    "{:.4f}".format(current_ai_score)
                    if current_ai_score is not None else "-"
                )
            )

            self.send_json(200, {"status": "OK"})

        except json.JSONDecodeError:
            self.send_json(400, {"error": "Format JSON Invalid"})

        except Exception as error:
            print("Error memproses POST:", error)
            self.send_json(500, {"error": "Internal Server Error"})

    def do_GET(self):
        clean_path = self.path.split("?")[0]

        if clean_path == "/api/calibration":
            response = get_calibration_payload()
            response.update(get_ai_payload())
            self.send_json(200, response)
            return

        if clean_path == "/api/data":
            with state_lock:
                online = (
                    last_received_timestamp > 0
                    and time.time() - last_received_timestamp
                    <= ESP32_TIMEOUT_SECONDS
                )

                response = dict(sensor_data)
                response["esp32_online"] = online
                response["last_seen"] = last_received_time_str

            response.update(get_ai_payload())
            response.update(get_calibration_payload())

            self.send_json(200, response)
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
    os.makedirs(AI_DIR, exist_ok=True)
    load_ai_model()

    server = ThreadingHTTPServer((HOST, PORT), SmartKosServer)
    print("Server aktif pada port {}".format(PORT))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
    finally:
        server.server_close()