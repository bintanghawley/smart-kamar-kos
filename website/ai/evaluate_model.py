
import os
import csv
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import IsolationForest

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FILE = os.path.join(BASE_DIR, "dataset_normal.csv")

FEATURES = ["suhu", "kelembapan", "cahaya", "gas"]

data = []

with open(DATASET_FILE, "r", newline="", encoding="utf-8") as file:
    reader = csv.DictReader(file)

    for line_number, row in enumerate(reader, start=2):
        try:
            values = [float(row[field]) for field in FEATURES]

            if not np.isfinite(values).all():
                raise ValueError("Nilai bukan angka valid")

            data.append(values)

        except (ValueError, TypeError, KeyError) as error:
            raise ValueError(
                "Data tidak valid pada baris {}: {}".format(
                    line_number, error
                )
            )

X = np.array(data, dtype=float)

if len(X) < 50:
    raise ValueError("Dataset terlalu sedikit untuk evaluasi.")

X_train, X_test = train_test_split(
    X,
    test_size=0.2,
    random_state=42
)

print("=== PERBANDINGAN CONTAMINATION ===")
print("Total sampel:", len(X))
print("Data pelatihan:", len(X_train))
print("Data pengujian:", len(X_test))
print("Fitur:", ", ".join(FEATURES))

for contamination in [0.01, 0.02, 0.05]:
    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=42
    )

    model.fit(X_train)

    train_predictions = model.predict(X_train)
    test_predictions = model.predict(X_test)

    train_anomalies = int(np.sum(train_predictions == -1))
    test_anomalies = int(np.sum(test_predictions == -1))

    print("\nContamination:", contamination)
    print(
        "Pelatihan: {}/{} anomali ({:.1f}%)".format(
            train_anomalies,
            len(X_train),
            train_anomalies / len(X_train) * 100
        )
    )
    print(
        "Pengujian: {}/{} anomali ({:.1f}%)".format(
            test_anomalies,
            len(X_test),
            test_anomalies / len(X_test) * 100
        )
    )

print("\nEvaluasi selesai. ai_model.pkl tidak diubah.")