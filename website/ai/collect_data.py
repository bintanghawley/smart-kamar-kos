
import os
import csv
import json
import time
import math
from datetime import datetime
from urllib.request import urlopen, Request

API_URL = "http://127.0.0.1:5000/api/data"
INTERVAL = 10

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FILE = os.path.join(BASE_DIR, "dataset_normal.csv")

FIELDS = ["timestamp", "suhu", "kelembapan", "cahaya", "gas"]
SENSOR_FIELDS = ["suhu", "kelembapan", "cahaya", "gas"]


def get_data():
    request = Request(
        API_URL,
        headers={"Cache-Control": "no-cache"},
        method="GET"
    )

    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def valid_data(data):
    for field in SENSOR_FIELDS:
        value = data.get(field)

        if not isinstance(value, (int, float)):
            return False

        if not math.isfinite(value):
            return False

    if data["suhu"] < -40 or data["suhu"] > 80:
        return False

    if data["kelembapan"] < 0 or data["kelembapan"] > 100:
        return False

    if not 0 <= data["cahaya"] <= 4095:
        return False

    if not 0 <= data["gas"] <= 4095:
        return False

    if data["suhu"] == 0 and data["kelembapan"] == 0:
        return False

    return True


def prepare_dataset():
    if not os.path.exists(DATASET_FILE) or os.path.getsize(DATASET_FILE) == 0:
        with open(DATASET_FILE, "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(FIELDS)


def save_data(data):
    with open(DATASET_FILE, "a", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)

        writer.writerow([
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            data["suhu"],
            data["kelembapan"],
            data["cahaya"],
            data["gas"]
        ])


def main():
    prepare_dataset()

    sample_count = 0
    start_time = time.time()

    print("SMART KAMAR KOS - DATA COLLECTOR")
    print("Sumber:", API_URL)
    print("Dataset:", DATASET_FILE)
    print("Interval:", INTERVAL, "detik")
    print("Tekan Ctrl+C untuk berhenti.")
    print("--------------------------------")

    try:
        while True:
            try:
                data = get_data()

                if not data.get("esp32_online", False):
                    print("ESP32 offline, data tidak disimpan.")

                elif not valid_data(data):
                    print("Data sensor tidak valid, sampel dilewati.")

                else:
                    save_data(data)
                    sample_count += 1

                    elapsed = int(time.time() - start_time)
                    minutes = elapsed // 60
                    seconds = elapsed % 60

                    print(
                        "Sampel:", sample_count,
                        "| Suhu:", data["suhu"],
                        "| Kelembapan:", data["kelembapan"],
                        "| Cahaya:", data["cahaya"],
                        "| Gas:", data["gas"],
                        "| Waktu:", "{}m {}d".format(minutes, seconds)
                    )

            except Exception as e:
                print("Gagal mengambil data:", e)

            time.sleep(INTERVAL)

    except KeyboardInterrupt:
        print("\nPengumpulan data dihentikan.")
        print("Sampel terkumpul pada sesi ini:", sample_count)
        print("File dataset:", DATASET_FILE)


if __name__ == "__main__":
    main()