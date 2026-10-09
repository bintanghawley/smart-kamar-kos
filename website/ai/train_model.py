
import os
import csv
import joblib
import numpy as np
from datetime import datetime
from sklearn.ensemble import IsolationForest

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FILE = os.path.join(BASE_DIR, "dataset_normal.csv")
MODEL_FILE = os.path.join(BASE_DIR, "ai_model.pkl")

FEATURES = ["suhu", "kelembapan", "cahaya", "gas"]
CONTAMINATION = 0.02

if not os.path.exists(DATASET_FILE):
    raise FileNotFoundError(
        "Dataset tidak ditemukan: " + DATASET_FILE
    )

data = []

with open(DATASET_FILE, "r", newline="", encoding="utf-8") as file:
    reader = csv.DictReader(file)

    if not reader.fieldnames or not all(
        feature in reader.fieldnames for feature in FEATURES
    ):
        raise ValueError("Header dataset tidak sesuai.")

    for line_number, row in enumerate(reader, start=2):
        try:
            values = [float(row[feature]) for feature in FEATURES]

            if not np.isfinite(values).all():
                raise ValueError("Nilai sensor tidak valid.")

            data.append(values)

        except (ValueError, TypeError, KeyError) as error:
            raise ValueError(
                "Data tidak valid pada baris {}: {}".format(
                    line_number, error
                )
            )

if len(data) < 20:
    raise ValueError("Dataset terlalu sedikit untuk pelatihan.")

X = np.array(data, dtype=float)

model = IsolationForest(
    n_estimators=200,
    contamination=CONTAMINATION,
    random_state=42
)

print("Memulai pelatihan Isolation Forest...")
print("Jumlah sampel:", len(X))
print("Jumlah fitur:", len(FEATURES))
print("Contamination:", CONTAMINATION)

model.fit(X)

predictions = model.predict(X)
normal_count = int(np.sum(predictions == 1))
anomaly_count = int(np.sum(predictions == -1))

bundle = {
    "model": model,
    "features": FEATURES,
    "contamination": CONTAMINATION,
    "trained_at": datetime.now().isoformat(timespec="seconds"),
    "training_samples": len(X),
    "training_data_min": {
        feature: float(X[:, index].min())
        for index, feature in enumerate(FEATURES)
    },
    "training_data_max": {
        feature: float(X[:, index].max())
        for index, feature in enumerate(FEATURES)
    }
}

joblib.dump(bundle, MODEL_FILE)

print("\n=== HASIL PELATIHAN ===")
print("Status: BERHASIL")
print("Sampel pelatihan:", len(X))
print("Normal pada data pelatihan:", normal_count)
print("Anomali pada data pelatihan:", anomaly_count)
print("Model tersimpan:", MODEL_FILE)
print("\nSelanjutnya, uji model dengan data realtime.")