
import os
import csv
import joblib
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FILE = os.path.join(BASE_DIR, "dataset_normal.csv")
MODEL_FILE = os.path.join(BASE_DIR, "ai_model.pkl")

OLD_SAMPLE_COUNT = 300

with open(DATASET_FILE, "r", newline="", encoding="utf-8") as file:
    reader = csv.DictReader(file)
    bundle = joblib.load(MODEL_FILE)
    features = bundle["features"]

    data = []

    for row in reader:
        data.append([float(row[field]) for field in features])

X = np.array(data, dtype=float)

if len(X) < 2:
    raise ValueError("Dataset tidak cukup untuk diperiksa.")

if not np.isfinite(X).all():
    raise ValueError("Dataset memiliki nilai yang tidak valid.")

model = bundle["model"]
predictions = model.predict(X)
scores = model.decision_function(X)

def report(title, start, end):
    group = predictions[start:end]
    group_scores = scores[start:end]

    if len(group) == 0:
        return

    normal = int(np.sum(group == 1))
    anomaly = int(np.sum(group == -1))

    print("\n" + title)
    print("Jumlah sampel:", len(group))
    print("NORMAL:", normal)
    print("ANOMALI:", anomaly)
    print("Persentase ANOMALI: {:.1f}%".format(
        anomaly / len(group) * 100
    ))
    print("Skor minimum: {:.4f}".format(group_scores.min()))
    print("Skor maksimum: {:.4f}".format(group_scores.max()))

print("=== DIAGNOSTIK DATASET DAN MODEL ===")
print("Total sampel:", len(X))
print("Fitur:", ", ".join(features))

split = min(OLD_SAMPLE_COUNT, len(X))

report("Sesi awal (300 sampel pertama)", 0, split)
report("Sesi tambahan", split, len(X))
report("Seluruh dataset", 0, len(X))

print("\nPemeriksaan selesai. Model dan dataset tidak diubah.")