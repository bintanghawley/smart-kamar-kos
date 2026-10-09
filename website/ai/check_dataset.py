
import csv
import os
from statistics import mean

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FILE = os.path.join(BASE_DIR, "dataset_normal.csv")

FIELDS = ["timestamp", "suhu", "kelembapan", "cahaya", "gas"]

data = []
invalid_rows = []
threshold_rows = []

if not os.path.exists(DATASET_FILE):
    print("Dataset tidak ditemukan:", DATASET_FILE)
    raise SystemExit

with open(DATASET_FILE, "r", newline="", encoding="utf-8") as file:
    reader = csv.DictReader(file)

    if not reader.fieldnames or not all(
        field in reader.fieldnames for field in FIELDS
    ):
        print("Header CSV tidak sesuai.")
        print("Header ditemukan:", reader.fieldnames)
        raise SystemExit

    for line_number, row in enumerate(reader, start=2):
        try:
            timestamp = row["timestamp"].strip()

            if not timestamp:
                raise ValueError("Timestamp kosong")

            suhu = float(row["suhu"])
            kelembapan = float(row["kelembapan"])
            cahaya = float(row["cahaya"])
            gas = float(row["gas"])

            values = [suhu, kelembapan, cahaya, gas]

            if not all(
                value == value and abs(value) != float("inf")
                for value in values
            ):
                raise ValueError("Nilai bukan angka valid")

            if not -40 <= suhu <= 80:
                raise ValueError("Suhu di luar rentang pemeriksaan")

            if not 0 <= kelembapan <= 100:
                raise ValueError("Kelembapan di luar rentang pemeriksaan")

            if not 0 <= cahaya <= 4095:
                raise ValueError("Cahaya di luar rentang ADC")

            if not 0 <= gas <= 4095:
                raise ValueError("Gas di luar rentang ADC")

            if suhu == 0 and kelembapan == 0:
                raise ValueError("Pembacaan DHT mungkin gagal")

            data.append({
                "suhu": suhu,
                "kelembapan": kelembapan,
                "cahaya": cahaya,
                "gas": gas
            })

            if gas >= 1200 or kelembapan >= 60:
                threshold_rows.append(line_number)

        except (ValueError, TypeError, KeyError) as error:
            invalid_rows.append((line_number, str(error)))

print("\n=== HASIL PEMERIKSAAN DATASET ===")
print("Total sampel valid:", len(data))
print("Baris tidak valid:", len(invalid_rows))
print("Baris perlu ditinjau:", len(threshold_rows))

if data:
    for field in ["suhu", "kelembapan", "cahaya", "gas"]:
        values = [row[field] for row in data]

        print(
            "{}: minimum={}, maksimum={}, rata-rata={:.2f}".format(
                field.capitalize(),
                min(values),
                max(values),
                mean(values)
            )
        )

if invalid_rows:
    print("\nBaris tidak valid:")
    for line_number, reason in invalid_rows[:20]:
        print("Baris {}: {}".format(line_number, reason))

if threshold_rows:
    print("\nBaris dengan gas >= 1200 ADC atau kelembapan >= 60%:")
    print("Nomor baris:", threshold_rows[:30])

print("\nPemeriksaan selesai. Dataset asli tidak diubah.")