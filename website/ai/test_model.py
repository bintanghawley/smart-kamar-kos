
import os
import json
import time
import math
import joblib
from datetime import datetime
from urllib.request import Request, urlopen

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_FILE = os.path.join(BASE_DIR, "ai_model.pkl")
API_URL = "http://127.0.0.1:5000/api/data"
INTERVAL = 5

if not os.path.exists(MODEL_FILE):
    raise FileNotFoundError("Model tidak ditemukan: " + MODEL_FILE)

bundle = joblib.load(MODEL_FILE)
model = bundle["model"]
features = bundle["features"]

print("SMART KAMAR KOS - UJI AI REALTIME")
print("Model:", MODEL_FILE)
print("Fitur:", ", ".join(features))
print("Interval pengujian:", INTERVAL, "detik")
print("Tekan Ctrl+C untuk berhenti.")
print("--------------------------------")

sample_count = 0

try:
    while True:
        try:
            request = Request(
                API_URL,
                headers={"Cache-Control": "no-cache"},
                method="GET"
            )

            with urlopen(request, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))

            if not data.get("esp32_online", False):
                print("ESP32 offline, prediksi dilewati.")
            else:
                values = [float(data[field]) for field in features]

                if not all(math.isfinite(value) for value in values):
                    print("Nilai sensor tidak valid, prediksi dilewati.")

                elif data["suhu"] == 0 and data["kelembapan"] == 0:
                    print("Pembacaan DHT11 tidak valid, prediksi dilewati.")

                else:
                    prediction = model.predict([values])[0]
                    score = float(model.decision_function([values])[0])

                    status = "NORMAL" if prediction == 1 else "ANOMALI"
                    sample_count += 1

                    print(
                        "[{}] {} | Suhu: {} C | Kelembapan: {}% "
                        "| Cahaya: {} | Gas: {} ADC | Skor: {:.4f}".format(
                            datetime.now().strftime("%H:%M:%S"),
                            status,
                            data["suhu"],
                            data["kelembapan"],
                            data["cahaya"],
                            data["gas"],
                            score
                        )
                    )

        except (KeyError, TypeError, ValueError) as error:
            print("Data sensor bermasalah:", error)

        except Exception as error:
            print("Gagal menguji model:", error)

        time.sleep(INTERVAL)

except KeyboardInterrupt:
    print("\nPengujian dihentikan.")
    print("Jumlah prediksi berhasil:", sample_count)