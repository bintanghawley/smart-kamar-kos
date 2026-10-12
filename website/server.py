
import os
import csv
import json
import time
import math
import shutil
import threading
import joblib
import numpy as np

from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from sklearn.ensemble import IsolationForest

HOST = "0.0.0.0"
PORT = 5000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AI_DIR = os.path.join(BASE_DIR, "ai")

DEFAULT_MODEL_FILE = os.path.join(AI_DIR, "ai_model_default.pkl")
PENDING_MODEL_FILE = os.path.join(AI_DIR, "ai_model_pending.pkl")
PENDING_DATASET_FILE = os.path.join(
    AI_DIR, "dataset_calibration_pending.csv"
)

# 4 Slot Waktu Kalibrasi Kamar Kos
TIME_SLOTS = {
    "pagi": {
        "key": "pagi",
        "label": "Pagi",
        "range_label": "05:00 - 11:00",
        "icon": "sunrise",
        "start_minute": 5 * 60,
        "end_minute": 11 * 60
    },
    "siang": {
        "key": "siang",
        "label": "Siang",
        "range_label": "11:00 - 15:00",
        "icon": "sun",
        "start_minute": 11 * 60,
        "end_minute": 15 * 60
    },
    "sore": {
        "key": "sore",
        "label": "Sore",
        "range_label": "15:00 - 18:30",
        "icon": "sunset",
        "start_minute": 15 * 60,
        "end_minute": 18 * 60 + 30
    },
    "malam": {
        "key": "malam",
        "label": "Malam",
        "range_label": "18:30 - 05:00",
        "icon": "moon",
        "start_minute": 18 * 60 + 30,
        "end_minute": 5 * 60
    }
}


def get_current_time_slot_key(dt=None):
    if dt is None:
        dt = datetime.now()
    minute = dt.hour * 60 + dt.minute
    if 300 <= minute < 660:
        return "pagi"
    elif 660 <= minute < 900:
        return "siang"
    elif 900 <= minute < 1110:
        return "sore"
    else:
        return "malam"


def get_slot_model_file(slot_key):
    return os.path.join(AI_DIR, f"ai_model_{slot_key}.pkl")


def get_slot_dataset_file(slot_key):
    return os.path.join(AI_DIR, f"dataset_{slot_key}.csv")


ESP32_TIMEOUT_SECONDS = 7
CALIBRATION_TARGET = 100
CALIBRATION_INTERVAL_SECONDS = 2
CALIBRATION_CONTAMINATION = 0.01
GAS_THRESHOLD = 2000
LDR_THRESHOLD = 2000
HUMIDITY_THRESHOLD = 60
FAN_OFF_DELAY = 10000

STATUS_BELUM_DIKALIBRASI = "BELUM DIKALIBRASI"
STATUS_KALIBRASI_BERLANGSUNG = "KALIBRASI BERLANGSUNG"
STATUS_MELATIH_MODEL = "MELATIH MODEL"
STATUS_KALIBRASI_BERHASIL = "KALIBRASI BERHASIL"
STATUS_KALIBRASI_DIBATALKAN = "KALIBRASI DIBATALKAN"
STATUS_KALIBRASI_GAGAL = "KALIBRASI GAGAL"

AI_FEATURES = ["suhu", "kelembapan", "cahaya", "gas"]
AI_WINDOW_SIZE = 5
AI_ANOMALY_REQUIRED = 3

# Batas toleransi fluktuasi normal untuk prototipe miniatur kamar
DEFAULT_SENSOR_MARGINS = {
    "suhu": 2.5,        # +/- 2.5 °C batas wajar fluktuasi miniatur
    "kelembapan": 8.0,  # +/- 8.0 % batas wajar fluktuasi miniatur
    "cahaya": 250.0,    # +/- 250 ADC batas wajar fluktuasi cahaya
    "gas": 250.0        # +/- 250 ADC batas wajar fluktuasi gas
}

DEFAULT_BASELINE = {
    "suhu": {"mean": 30.0, "std": 1.0, "margin": 3.0, "min": 27.0, "max": 33.0},
    "kelembapan": {"mean": 50.0, "std": 2.0, "margin": 10.0, "min": 40.0, "max": 60.0},
    "cahaya": {"mean": 1000.0, "std": 50.0, "margin": 350.0, "min": 650.0, "max": 1350.0},
    "gas": {"mean": 600.0, "std": 50.0, "margin": 350.0, "min": 250.0, "max": 950.0}
}

state_lock = threading.RLock()
model_lock = threading.RLock()

buzzer_muted = False

sensor_data = {
    "suhu": 0,
    "kelembapan": 0,
    "cahaya": 0,
    "gas": 0,
    "led": "OFF",
    "buzzer": "OFF",
    "kipas": "OFF",
    "buzzer_muted": False
}

last_received_timestamp = 0
last_received_time_str = "Belum ada data"

# Multi-slot models dictionary
slot_models = {
    "pagi": None,
    "siang": None,
    "sore": None,
    "malam": None
}
slot_info = {
    "pagi": None,
    "siang": None,
    "sore": None,
    "malam": None
}
default_model = None
default_model_info = None

ai_predictions = deque(maxlen=AI_WINDOW_SIZE)
ai_status = "TIDAK TERSEDIA"
ai_raw_status = "MENUNGGU DATA"
ai_score = None
ai_error = None
active_model_source = "DEFAULT"
active_evaluated_slot = None
ai_trigger_desc = "Menunggu data sensor..."
ai_status_desc = "Menunggu pembacaan sensor."

calibration_samples = []
last_calibration_sample_time = 0

calibration_state = {
    "status": STATUS_BELUM_DIKALIBRASI,
    "active": False,
    "samples_collected": 0,
    "target_samples": CALIBRATION_TARGET,
    "skipped_samples": 0,
    "target_slot": None,
    "target_slot_label": None,
    "target_slot_range": None,
    "message": "Kalibrasi belum dimulai.",
    "started_at": None,
    "finished_at": None,
    "last_calibrated_slot": None
}


def load_all_ai_models():
    global default_model
    global default_model_info
    global slot_models
    global slot_info
    global ai_status
    global ai_error

    # 1. Muat default model jika ada
    if os.path.exists(DEFAULT_MODEL_FILE):
        try:
            bundle = joblib.load(DEFAULT_MODEL_FILE)
            if isinstance(bundle, dict) and "model" in bundle:
                with model_lock:
                    default_model = bundle["model"]
                    default_model_info = bundle
                print("Model default/fallback AI berhasil dimuat.")
        except Exception as err:
            print("Peringatan, model default gagal dimuat:", err)

    if default_model_info and "baseline" not in default_model_info:
        default_model_info["baseline"] = DEFAULT_BASELINE

    # 2. Muat model masing-masing slot waktu (pagi, siang, sore, malam)
    loaded_slots = []
    with model_lock:
        for s_key in TIME_SLOTS:
            s_path = get_slot_model_file(s_key)
            if os.path.exists(s_path):
                try:
                    s_bundle = joblib.load(s_path)
                    if isinstance(s_bundle, dict) and "model" in s_bundle:
                        if "baseline" not in s_bundle:
                            b_base = {}
                            for f in AI_FEATURES:
                                min_v = s_bundle.get("training_data_min", {}).get(f, DEFAULT_BASELINE[f]["mean"])
                                max_v = s_bundle.get("training_data_max", {}).get(f, DEFAULT_BASELINE[f]["mean"])
                                mid_v = (min_v + max_v) / 2.0
                                b_base[f] = {
                                    "mean": round(mid_v, 2),
                                    "std": round((max_v - min_v) / 4.0, 2),
                                    "margin": round(max(DEFAULT_SENSOR_MARGINS[f], (max_v - min_v) * 1.5), 2)
                                }
                            s_bundle["baseline"] = b_base

                        slot_models[s_key] = s_bundle["model"]
                        slot_info[s_key] = s_bundle
                        loaded_slots.append(s_key)
                except Exception as s_err:
                    print(f"Gagal memuat model slot {s_key}:", s_err)
            else:
                slot_models[s_key] = None
                slot_info[s_key] = None

    print(
        "Model slot terkalibrasi aktif: "
        + (", ".join(loaded_slots) if loaded_slots else "Belum ada")
    )

    curr_slot = get_current_time_slot_key()
    has_model = (
        slot_models.get(curr_slot) is not None
        or default_model is not None
    )

    with state_lock:
        if has_model:
            ai_status = "MENUNGGU DATA"
            ai_error = None
        else:
            ai_status = "TIDAK TERSEDIA"
            ai_error = "Model AI belum tersedia."

        # Update initial calibration state message
        if loaded_slots:
            calibration_state["status"] = STATUS_KALIBRASI_BERHASIL
            calibration_state["message"] = (
                f"Model slot {', '.join(loaded_slots)} siap digunakan."
            )
        else:
            calibration_state["status"] = STATUS_BELUM_DIKALIBRASI
            calibration_state["message"] = (
                "Model default aktif. Kalibrasi per slot waktu dapat dilakukan."
            )


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
    curr_slot = get_current_time_slot_key()
    curr_meta = TIME_SLOTS[curr_slot]

    with state_lock:
        target_slot = calibration_state.get("target_slot") or curr_slot
        target_meta = TIME_SLOTS.get(target_slot, curr_meta)

        return {
            "calibration_status": calibration_state["status"],
            "calibration_active": calibration_state["active"],
            "calibration_busy": calibration_state["status"] in (
                STATUS_KALIBRASI_BERLANGSUNG, STATUS_MELATIH_MODEL
            ),
            "calibration_samples": calibration_state["samples_collected"],
            "calibration_target": calibration_state["target_samples"],
            "calibration_skipped": calibration_state["skipped_samples"],
            "calibration_message": calibration_state["message"],
            "calibration_started_at": calibration_state["started_at"],
            "calibration_finished_at": calibration_state["finished_at"],
            "calibration_target_slot": target_slot,
            "calibration_target_slot_label": target_meta["label"],
            "calibration_target_slot_range": target_meta["range_label"],
            "calibration_target_slot_icon": target_meta["icon"],
            "calibration_last_slot": calibration_state.get("last_calibrated_slot")
        }


def get_ai_payload():
    curr_slot = get_current_time_slot_key()
    curr_meta = TIME_SLOTS[curr_slot]

    with model_lock:
        is_slot_calibrated = slot_models.get(curr_slot) is not None
        active_bundle = (
            slot_info.get(curr_slot)
            if is_slot_calibrated
            else default_model_info
        ) or {}
        available = (
            slot_models.get(curr_slot) is not None
            or default_model is not None
        )
        model_source = (
            "KALIBRASI RUANGAN" if is_slot_calibrated
            else "DEFAULT (MODEL UMUM)"
        )

        slots_status = {}
        for s_key, s_data in TIME_SLOTS.items():
            s_calibrated = slot_models.get(s_key) is not None
            s_bundle = slot_info.get(s_key) if s_calibrated else None
            slots_status[s_key] = {
                "key": s_key,
                "label": s_data["label"],
                "range": s_data["range_label"],
                "icon": s_data["icon"],
                "is_calibrated": s_calibrated,
                "is_active_now": (s_key == curr_slot),
                "samples": (
                    s_bundle.get("training_samples", CALIBRATION_TARGET)
                    if s_bundle else None
                ),
                "trained_at": (
                    s_bundle.get("trained_at")
                    if s_bundle else None
                )
            }

    with state_lock:
        score_val = ai_score if ai_score is not None else None
        return {
            "ai_status": ai_status,
            "ai_raw_status": ai_raw_status,
            "ai_score": score_val,
            "ai_score_percent": f"{score_val:.1f}%" if score_val is not None else "—",
            "ai_trigger_desc": ai_trigger_desc,
            "ai_status_desc": ai_status_desc,
            "ai_samples_checked": len(ai_predictions),
            "ai_anomaly_count": sum(
                result == -1 for result in ai_predictions
            ),
            "ai_available": available,
            "ai_error": ai_error,
            "ai_training_samples": active_bundle.get("training_samples"),
            "ai_model_trained_at": active_bundle.get("trained_at"),
            "ai_contamination": active_bundle.get("contamination"),
            "ai_active_slot": curr_slot,
            "ai_active_slot_label": curr_meta["label"],
            "ai_active_slot_range": curr_meta["range_label"],
            "ai_active_slot_icon": curr_meta["icon"],
            "ai_model_source": model_source,
            "ai_is_slot_calibrated": is_slot_calibrated,
            "ai_slots": slots_status
        }


def start_calibration(requested_slot=None):
    global last_calibration_sample_time
    global ai_status
    global ai_raw_status
    global ai_score

    with state_lock:
        if calibration_state["status"] in (
            STATUS_KALIBRASI_BERLANGSUNG, STATUS_MELATIH_MODEL
        ):
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

        # Tentukan target slot waktu
        if requested_slot in TIME_SLOTS:
            target_slot = requested_slot
        else:
            target_slot = get_current_time_slot_key()

        target_meta = TIME_SLOTS[target_slot]

        try:
            os.makedirs(AI_DIR, exist_ok=True)

            for pending_file in (PENDING_DATASET_FILE, PENDING_MODEL_FILE):
                if os.path.exists(pending_file):
                    try:
                        os.remove(pending_file)
                    except OSError:
                        pass

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
            "status": STATUS_KALIBRASI_BERLANGSUNG,
            "active": True,
            "samples_collected": 0,
            "target_samples": CALIBRATION_TARGET,
            "skipped_samples": 0,
            "target_slot": target_slot,
            "target_slot_label": target_meta["label"],
            "target_slot_range": target_meta["range_label"],
            "message": (
                f"Mengumpulkan data normal untuk slot {target_meta['label']} "
                f"({target_meta['range_label']})."
            ),
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "finished_at": None
        })

        ai_predictions.clear()
        ai_status = "KALIBRASI"
        ai_raw_status = "KALIBRASI"
        ai_score = None

    print(f"Kalibrasi slot '{target_meta['label']}' dimulai.")
    return 200, {
        "status": "OK",
        "message": f"Kalibrasi slot {target_meta['label']} dimulai.",
        "target_slot": target_slot
    }


def cancel_calibration():
    global ai_status
    global ai_raw_status
    global ai_score

    with state_lock:
        if calibration_state["status"] == STATUS_MELATIH_MODEL:
            return 409, {
                "status": "ERROR",
                "message": (
                    "Model sedang dilatih. Tunggu proses ini selesai."
                )
            }

        if calibration_state["status"] != STATUS_KALIBRASI_BERLANGSUNG:
            return 409, {
                "status": "ERROR",
                "message": "Tidak ada kalibrasi aktif yang dapat dibatalkan."
            }

        target_slot = calibration_state.get("target_slot") or get_current_time_slot_key()
        target_label = TIME_SLOTS.get(target_slot, {}).get("label", "Aktif")

        calibration_state.update({
            "status": STATUS_KALIBRASI_DIBATALKAN,
            "active": False,
            "message": (
                f"Kalibrasi slot {target_label} dibatalkan. "
                "Model sebelumnya tetap digunakan."
            ),
            "finished_at": datetime.now().isoformat(timespec="seconds")
        })

        calibration_samples.clear()

        for pending_file in (PENDING_DATASET_FILE, PENDING_MODEL_FILE):
            if os.path.exists(pending_file):
                try:
                    os.remove(pending_file)
                except OSError as error:
                    print("Peringatan, file sementara belum terhapus:", error)

        ai_predictions.clear()
        curr_slot = get_current_time_slot_key()
        has_model = (
            slot_models.get(curr_slot) is not None
            or default_model is not None
        )
        ai_status = "MENUNGGU DATA" if has_model else "TIDAK TERSEDIA"
        ai_raw_status = "MENUNGGU DATA"
        ai_score = None

    print("Kalibrasi dibatalkan.")
    return 200, {
        "status": "OK",
        "message": "Kalibrasi dibatalkan."
    }


def reset_calibration(slot_key=None):
    global ai_status, ai_raw_status, ai_score, ai_error

    with state_lock:
        if calibration_state["status"] in (
            STATUS_KALIBRASI_BERLANGSUNG, STATUS_MELATIH_MODEL
        ):
            return 409, {
                "status": "ERROR",
                "message": "Tidak dapat mereset saat kalibrasi sedang berjalan."
            }

    with model_lock:
        if slot_key == "all":
            # Reset semua slot
            for s_k in TIME_SLOTS:
                s_model_file = get_slot_model_file(s_k)
                s_data_file = get_slot_dataset_file(s_k)
                for fpath in (s_model_file, s_data_file):
                    if os.path.exists(fpath):
                        try:
                            os.remove(fpath)
                        except OSError:
                            pass
                slot_models[s_k] = None
                slot_info[s_k] = None
            msg = "Semua dataset dan model kalibrasi slot telah direset ke default."
        elif slot_key in TIME_SLOTS:
            s_model_file = get_slot_model_file(slot_key)
            s_data_file = get_slot_dataset_file(slot_key)
            for fpath in (s_model_file, s_data_file):
                if os.path.exists(fpath):
                    try:
                        os.remove(fpath)
                    except OSError:
                        pass
            slot_models[slot_key] = None
            slot_info[slot_key] = None
            lbl = TIME_SLOTS[slot_key]["label"]
            msg = f"Dataset dan model kalibrasi slot {lbl} telah direset ke default."
        else:
            return 400, {
                "status": "ERROR",
                "message": "Parameter slot tidak valid (pilih: pagi, siang, sore, malam, all)."
            }

    with state_lock:
        ai_predictions.clear()
        calibration_state.update({
            "status": STATUS_BELUM_DIKALIBRASI,
            "message": msg
        })

    print(msg)
    return 200, {"status": "OK", "message": msg}


def collect_calibration_sample(data):
    global last_calibration_sample_time

    if calibration_state["status"] != STATUS_KALIBRASI_BERLANGSUNG:
        return None, None

    now = time.monotonic()

    if (
        last_calibration_sample_time != 0
        and now - last_calibration_sample_time
        < CALIBRATION_INTERVAL_SECONDS
    ):
        return None, None

    last_calibration_sample_time = now

    values, error = validate_calibration_data(data)

    if error:
        calibration_state["skipped_samples"] += 1
        calibration_state["message"] = error
        return None, None

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
            "status": STATUS_KALIBRASI_GAGAL,
            "active": False,
            "message": "Gagal menyimpan sampel: " + str(error)
        })
        print("Gagal menyimpan sampel kalibrasi:", error)
        return None, None

    calibration_samples.append(record)

    target_slot = calibration_state.get("target_slot") or get_current_time_slot_key()
    target_meta = TIME_SLOTS.get(target_slot, TIME_SLOTS["siang"])

    calibration_state["samples_collected"] = len(calibration_samples)
    calibration_state["message"] = (
        f"Mengumpulkan data normal slot {target_meta['label']} "
        f"({len(calibration_samples)}/{CALIBRATION_TARGET})."
    )

    if len(calibration_samples) >= CALIBRATION_TARGET:
        calibration_state.update({
            "status": STATUS_MELATIH_MODEL,
            "active": False,
            "message": f"Sampel lengkap (100). Melatih model slot {target_meta['label']}..."
        })
        return list(calibration_samples), target_slot

    return None, None


def evaluate_against_baseline(values, baseline):
    ratios = {}
    diffs = {}
    for f in AI_FEATURES:
        val = float(values[f])
        base = baseline.get(f) if baseline else None
        if not base:
            base = DEFAULT_BASELINE.get(f, {"mean": val, "margin": 100.0})

        diff = val - float(base.get("mean", val))
        diffs[f] = diff

        # Khusus sensor gas MQ-2:
        # Jika nilai gas lebih rendah dari saat kalibrasi, udara lebih bersih (aman/normal).
        # Hanya jika gas naik melebihi baseline kalibrasi, kita hitung rasio deviasi.
        if f == "gas" and diff < 0:
            ratios[f] = 0.0
        else:
            eff_margin = max(float(base.get("margin", 100.0)), 1.0)
            ratios[f] = abs(diff) / eff_margin

    if not ratios:
        return (
            True,
            100.0,
            "Pola sensor stabil dan selaras dengan patokan kalibrasi.",
            "Sensor berada dalam rentang normal."
        )

    max_f = max(ratios, key=ratios.get)
    max_r = ratios[max_f]
    avg_r = sum(ratios.values()) / len(ratios)
    dev = 0.7 * max_r + 0.3 * avg_r

    f_labels = {
        "suhu": "Suhu",
        "kelembapan": "Kelembapan",
        "cahaya": "Cahaya",
        "gas": "Gas"
    }
    units = {
        "suhu": "°C",
        "kelembapan": "%",
        "cahaya": " ADC",
        "gas": " ADC"
    }

    if dev <= 1.0:
        score_pct = max(70.0, 100.0 - (dev * 30.0))
        is_normal = True
        status_desc = "Pola sensor stabil dan selaras dengan patokan kalibrasi miniatur."
        trigger_desc = "Sensor berada dalam rentang kalibrasi normal."
    else:
        score_pct = max(5.0, 70.0 - ((dev - 1.0) * 35.0))
        is_normal = False
        sign = "+" if diffs[max_f] > 0 else ""
        diff_str = f"{sign}{diffs[max_f]:.1f}{units[max_f]}"
        status_desc = f"{f_labels[max_f]} terdeteksi berubah ({diff_str} dari patokan)."
        trigger_desc = f"Penyimpangan utama: {f_labels[max_f]} ({diff_str})"

    return is_normal, round(score_pct, 1), status_desc, trigger_desc


def train_calibration_model(samples, target_slot=None):
    global slot_models
    global slot_info
    global ai_status
    global ai_raw_status
    global ai_score
    global ai_error
    global ai_trigger_desc
    global ai_status_desc

    if not target_slot or target_slot not in TIME_SLOTS:
        target_slot = get_current_time_slot_key()

    target_meta = TIME_SLOTS[target_slot]
    target_dataset_file = get_slot_dataset_file(target_slot)
    target_model_file = get_slot_model_file(target_slot)

    model_replaced = False

    try:
        if len(samples) < CALIBRATION_TARGET:
            raise ValueError("Jumlah sampel kalibrasi belum mencukupi.")

        if not os.path.exists(PENDING_DATASET_FILE):
            raise FileNotFoundError("File dataset sementara tidak ditemukan.")

        with open(PENDING_DATASET_FILE, "r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            file_rows = list(reader)
            if len(file_rows) != CALIBRATION_TARGET:
                raise ValueError(
                    f"Jumlah baris file ({len(file_rows)}) tidak sesuai target ({CALIBRATION_TARGET})."
                )

        # 1. Ekstraksi baseline statistik prototipe miniatur kamar
        baseline = {}
        for feature in AI_FEATURES:
            vals = [float(sample[feature]) for sample in samples]
            m = float(np.mean(vals))
            s = float(np.std(vals))
            margin = float(max(DEFAULT_SENSOR_MARGINS[feature], 2.5 * s))
            baseline[feature] = {
                "mean": round(m, 2),
                "std": round(s, 2),
                "min": round(float(min(vals)), 2),
                "max": round(float(max(vals)), 2),
                "margin": round(margin, 2)
            }

        # 2. Augmentasi data sintetis normal agar model memiliki densitas kontinu
        augmented_X = []
        for sample in samples:
            augmented_X.append([float(sample[feature]) for feature in AI_FEATURES])

        for _ in range(2):
            for sample in samples:
                row = []
                for feature in AI_FEATURES:
                    val = float(sample[feature])
                    jitter = float(np.random.normal(0, baseline[feature]["margin"] * 0.2))
                    row.append(val + jitter)
                augmented_X.append(row)

        model = IsolationForest(
            n_estimators=100,
            contamination=CALIBRATION_CONTAMINATION,
            random_state=42
        )
        model.fit(augmented_X)

        trained_at = datetime.now().isoformat(timespec="seconds")

        bundle = {
            "model": model,
            "baseline": baseline,
            "features": AI_FEATURES[:],
            "contamination": CALIBRATION_CONTAMINATION,
            "trained_at": trained_at,
            "training_samples": len(samples),
            "slot": target_slot,
            "slot_label": target_meta["label"],
            "slot_range": target_meta["range_label"],
            "training_data_min": {
                feature: baseline[feature]["min"]
                for feature in AI_FEATURES
            },
            "training_data_max": {
                feature: baseline[feature]["max"]
                for feature in AI_FEATURES
            },
            "calibration_mode": "adaptive_prototype"
        }

        joblib.dump(bundle, PENDING_MODEL_FILE)

        if (
            not os.path.exists(PENDING_MODEL_FILE)
            or os.path.getsize(PENDING_MODEL_FILE) == 0
        ):
            raise IOError("File kandidat model tidak berhasil dibuat.")

        test_bundle = joblib.load(PENDING_MODEL_FILE)
        if not isinstance(test_bundle, dict) or "model" not in test_bundle:
            raise ValueError("Verifikasi integritas model kandidat gagal.")

        # Simpan dataset slot spesifik
        shutil.copy2(PENDING_DATASET_FILE, target_dataset_file)

        # Aktifkan model baru untuk slot ini
        os.replace(PENDING_MODEL_FILE, target_model_file)
        model_replaced = True

        with model_lock:
            slot_models[target_slot] = model
            slot_info[target_slot] = bundle

        with state_lock:
            ai_predictions.clear()
            ai_status = "MENUNGGU DATA"
            ai_raw_status = "MENUNGGU DATA"
            ai_score = 100.0
            ai_error = None
            ai_trigger_desc = "Kalibrasi berhasil. Menunggu pembacaan sensor aktif."
            ai_status_desc = "Pola sensor stabil dan selaras dengan patokan kalibrasi miniatur."

            calibration_state.update({
                "status": STATUS_KALIBRASI_BERHASIL,
                "active": False,
                "samples_collected": len(samples),
                "message": (
                    f"Kalibrasi berhasil. Model slot {target_meta['label']} "
                    f"({target_meta['range_label']}) sudah disimpan dan aktif."
                ),
                "finished_at": trained_at,
                "last_calibrated_slot": target_slot
            })

        try:
            if os.path.exists(PENDING_DATASET_FILE):
                os.remove(PENDING_DATASET_FILE)
        except OSError:
            pass

        print(f"Kalibrasi slot '{target_meta['label']}' BERHASIL.")
        print("Sampel pelatihan:", len(samples))
        print("Baseline miniatur:", baseline)
        print("Model tersimpan:", target_model_file)
        print("Dataset tersimpan:", target_dataset_file)

    except Exception as error:
        if not model_replaced and os.path.exists(PENDING_MODEL_FILE):
            try:
                os.remove(PENDING_MODEL_FILE)
            except OSError:
                pass

        with state_lock:
            calibration_state.update({
                "status": STATUS_KALIBRASI_GAGAL,
                "active": False,
                "message": (
                    f"Kalibrasi slot {target_meta['label']} gagal: {error}. "
                    "Model sebelumnya dipertahankan."
                ),
                "finished_at": datetime.now().isoformat(timespec="seconds")
            })

            curr_slot = get_current_time_slot_key()
            has_model = (
                slot_models.get(curr_slot) is not None
                or default_model is not None
            )
            ai_status = "MENUNGGU DATA" if has_model else "TIDAK TERSEDIA"
            ai_error = str(error)

        print(f"Kalibrasi slot '{target_meta['label']}' gagal:", error)
        print("Model sebelumnya tetap digunakan.")


def predict_ai(data):
    global ai_status
    global ai_raw_status
    global ai_score
    global ai_error
    global ai_trigger_desc
    global ai_status_desc
    global active_model_source
    global active_evaluated_slot

    with state_lock:
        if calibration_state["status"] in (
            STATUS_KALIBRASI_BERLANGSUNG, STATUS_MELATIH_MODEL
        ):
            ai_status = "KALIBRASI"
            ai_raw_status = "KALIBRASI"
            return

    curr_slot = get_current_time_slot_key()
    active_evaluated_slot = curr_slot

    with model_lock:
        if slot_models.get(curr_slot) is not None:
            active_bundle = slot_info[curr_slot]
            features = active_bundle.get("features", AI_FEATURES[:])
            active_model_source = "KALIBRASI RUANGAN"
        elif default_model is not None:
            active_bundle = default_model_info or {}
            features = active_bundle.get("features", AI_FEATURES[:])
            active_model_source = "DEFAULT (MODEL UMUM)"
        else:
            active_bundle = None
            features = AI_FEATURES[:]
            active_model_source = "TIDAK TERSEDIA"

    if active_bundle is None:
        with state_lock:
            ai_status = "TIDAK TERSEDIA"
        return

    values, error = validate_sensor_data(data)
    if error:
        return

    try:
        baseline = active_bundle.get("baseline")
        if not baseline:
            baseline = {}
            for f in AI_FEATURES:
                min_v = active_bundle.get("training_data_min", {}).get(f, values[f])
                max_v = active_bundle.get("training_data_max", {}).get(f, values[f])
                mid_v = (min_v + max_v) / 2.0
                baseline[f] = {
                    "mean": mid_v,
                    "std": (max_v - min_v) / 4.0,
                    "margin": max(DEFAULT_SENSOR_MARGINS[f], (max_v - min_v) * 1.5)
                }

        is_normal, score_pct, status_desc, trigger_desc = evaluate_against_baseline(
            values, baseline
        )
        prediction = 1 if is_normal else -1

        with state_lock:
            if calibration_state["status"] in (
                STATUS_KALIBRASI_BERLANGSUNG, STATUS_MELATIH_MODEL
            ):
                ai_status = "KALIBRASI"
                ai_raw_status = "KALIBRASI"
                return

            ai_predictions.append(prediction)
            ai_raw_status = "ANOMALI" if prediction == -1 else "NORMAL"
            ai_score = score_pct
            ai_trigger_desc = trigger_desc
            ai_status_desc = status_desc

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
    def send_json(self, status_code, data, extra_headers=None):
        response = json.dumps(data).encode("utf-8")

        self.send_response(status_code)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8"
        )
        self.send_header("Content-Length", str(len(response)))
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for header_key, header_value in extra_headers.items():
                self.send_header(header_key, header_value)
        self.end_headers()

        try:
            self.wfile.write(response)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        global sensor_data
        global buzzer_muted
        global last_received_timestamp
        global last_received_time_str
        global ai_status
        global ai_raw_status

        clean_path = self.path.split("?")[0]

        if clean_path == "/api/buzzer/mute":
            with state_lock:
                buzzer_muted = True
                sensor_data["buzzer_muted"] = True
                if sensor_data.get("gas", 0) >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "MUTED"
            print(
                "[{}] Buzzer dimatikan manual via dashboard.".format(
                    datetime.now().strftime("%H:%M:%S")
                )
            )
            self.send_json(200, {
                "status": "OK",
                "message": "Buzzer berhasil dimatikan.",
                "buzzer_muted": True
            })
            return

        if clean_path == "/api/buzzer/unmute":
            with state_lock:
                buzzer_muted = False
                sensor_data["buzzer_muted"] = False
                if sensor_data.get("gas", 0) >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "ON"
            print(
                "[{}] Buzzer diaktifkan kembali manual via dashboard.".format(
                    datetime.now().strftime("%H:%M:%S")
                )
            )
            self.send_json(200, {
                "status": "OK",
                "message": "Buzzer diaktifkan kembali.",
                "buzzer_muted": False
            })
            return

        if clean_path == "/api/buzzer/toggle":
            with state_lock:
                buzzer_muted = not buzzer_muted
                sensor_data["buzzer_muted"] = buzzer_muted
                if sensor_data.get("gas", 0) >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "MUTED" if buzzer_muted else "ON"
                current_state = buzzer_muted
            self.send_json(200, {
                "status": "OK",
                "buzzer_muted": current_state
            })
            return

        if clean_path == "/api/calibration/start":
            # Periksa apakah ada slot yang diminta di query parameter atau body
            requested_slot = None
            if "?" in self.path:
                query_part = self.path.split("?", 1)[1]
                for param in query_part.split("&"):
                    if param.startswith("slot="):
                        requested_slot = param.split("=")[1].strip().lower()

            try:
                length = int(self.headers.get("Content-Length", 0))
                if length > 0 and requested_slot is None:
                    body = self.rfile.read(length)
                    req_data = json.loads(body.decode("utf-8"))
                    if isinstance(req_data, dict) and "slot" in req_data:
                        requested_slot = str(req_data["slot"]).strip().lower()
            except Exception:
                pass

            status_code, response = start_calibration(requested_slot)
            self.send_json(status_code, response)
            return

        if clean_path == "/api/calibration/cancel":
            status_code, response = cancel_calibration()
            self.send_json(status_code, response)
            return

        if clean_path == "/api/calibration/reset":
            slot_to_reset = "all"
            if "?" in self.path:
                query_part = self.path.split("?", 1)[1]
                for param in query_part.split("&"):
                    if param.startswith("slot="):
                        slot_to_reset = param.split("=")[1].strip().lower()

            try:
                length = int(self.headers.get("Content-Length", 0))
                if length > 0 and slot_to_reset == "all":
                    body = self.rfile.read(length)
                    req_data = json.loads(body.decode("utf-8"))
                    if isinstance(req_data, dict) and "slot" in req_data:
                        slot_to_reset = str(req_data["slot"]).strip().lower()
            except Exception:
                pass

            status_code, response = reset_calibration(slot_to_reset)
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
                gas_val = payload.get("gas", 0)
                if isinstance(gas_val, (int, float)) and gas_val < GAS_THRESHOLD:
                    buzzer_muted = False

                for key in ("suhu", "kelembapan", "cahaya", "gas"):
                    if key in payload:
                        sensor_data[key] = payload[key]

                for key in ("led", "kipas"):
                    if key in payload:
                        sensor_data[key] = str(payload[key]).upper()

                current_gas = sensor_data.get("gas", 0)
                if isinstance(current_gas, (int, float)) and current_gas >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "MUTED" if buzzer_muted else "ON"
                else:
                    sensor_data["buzzer"] = "OFF"

                sensor_data["buzzer_muted"] = buzzer_muted

                last_received_timestamp = time.time()
                last_received_time_str = (
                    datetime.now().strftime("%H:%M:%S")
                )

                current_data = dict(sensor_data)
                current_mute = buzzer_muted
                samples_to_train = None
                slot_to_train = None

                if calibration_state["status"] == STATUS_KALIBRASI_BERLANGSUNG:
                    samples_to_train, slot_to_train = collect_calibration_sample(
                        current_data
                    )

                busy = calibration_state["status"] in (
                    STATUS_KALIBRASI_BERLANGSUNG, STATUS_MELATIH_MODEL
                )

                if busy:
                    ai_status = "KALIBRASI"
                    ai_raw_status = "KALIBRASI"

            if not busy:
                predict_ai(current_data)

            if samples_to_train is not None:
                threading.Thread(
                    target=train_calibration_model,
                    args=(samples_to_train, slot_to_train),
                    daemon=True
                ).start()

            with state_lock:
                current_ai_status = ai_status
                current_ai_score = ai_score

            print(
                "[{}] Data ESP32 diterima | AI: {} | Skor: {} | Mute: {}".format(
                    last_received_time_str,
                    current_ai_status,
                    "{:.4f}".format(current_ai_score)
                    if current_ai_score is not None else "-",
                    "YA" if current_mute else "TIDAK"
                )
            )

            self.send_json(
                200,
                {"status": "OK", "buzzer_mute": current_mute},
                extra_headers={"X-Buzzer-Mute": "1" if current_mute else "0"}
            )

        except json.JSONDecodeError:
            self.send_json(400, {"error": "Format JSON Invalid"})

        except Exception as error:
            print("Error memproses POST:", error)
            self.send_json(500, {"error": "Internal Server Error"})

    def do_GET(self):
        global sensor_data
        global buzzer_muted

        clean_path = self.path.split("?")[0]

        if clean_path == "/api/buzzer/mute":
            with state_lock:
                buzzer_muted = True
                sensor_data["buzzer_muted"] = True
                if sensor_data.get("gas", 0) >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "MUTED"
            self.send_json(200, {
                "status": "OK",
                "message": "Buzzer berhasil dimatikan.",
                "buzzer_muted": True
            })
            return

        if clean_path == "/api/buzzer/unmute":
            with state_lock:
                buzzer_muted = False
                sensor_data["buzzer_muted"] = False
                if sensor_data.get("gas", 0) >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "ON"
            self.send_json(200, {
                "status": "OK",
                "message": "Buzzer diaktifkan kembali.",
                "buzzer_muted": False
            })
            return

        if clean_path == "/api/buzzer/toggle":
            with state_lock:
                buzzer_muted = not buzzer_muted
                sensor_data["buzzer_muted"] = buzzer_muted
                if sensor_data.get("gas", 0) >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "MUTED" if buzzer_muted else "ON"
                current_state = buzzer_muted
            self.send_json(200, {
                "status": "OK",
                "buzzer_muted": current_state
            })
            return

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
                response["buzzer_muted"] = buzzer_muted
                response["gas_threshold"] = GAS_THRESHOLD
                response["ldr_threshold"] = LDR_THRESHOLD

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
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
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

    # Bersihkan file sementara yang tertinggal jika server terhenti di tengah kalibrasi
    for pending_path in (PENDING_DATASET_FILE, PENDING_MODEL_FILE):
        if os.path.exists(pending_path):
            try:
                os.remove(pending_path)
                print("Membersihkan file sementara:", os.path.basename(pending_path))
            except OSError:
                pass

    load_all_ai_models()

    server = ThreadingHTTPServer((HOST, PORT), SmartKosServer)
    print("Server aktif pada port {}".format(PORT))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
    finally:
        server.server_close()