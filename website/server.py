
import os

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import csv
import json
import time
import math
import shutil
import decimal
import threading
import joblib
import numpy as np

from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from sklearn.ensemble import IsolationForest

try:
    from website import db
except ImportError:
    import db

HOST = "0.0.0.0"
PORT = 5000
DEVICE_TOKEN = os.environ.get("DEVICE_TOKEN", "").strip()

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
GAS_THRESHOLD = 3500
LDR_THRESHOLD = 2000
HUMIDITY_THRESHOLD = 60
FAN_OFF_DELAY = 10000
FAN_MANUAL_SNOOZE_SECONDS = 1800
FAN_HUMIDITY_CLEAR_THRESHOLD = HUMIDITY_THRESHOLD - 2
LED_OFF_SNOOZE_SECONDS = 8 * 3600
LED_ON_SNOOZE_SECONDS = 2 * 3600
LED_BRIGHT_CLEAR_THRESHOLD = LDR_THRESHOLD - 200

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

# Konfigurasi Notifikasi WhatsApp (Fonnte)
FONNTE_TOKEN = os.environ.get("FONNTE_TOKEN", "inH5BdbMuMuj23XLyevE").strip()
FONNTE_TARGET = os.environ.get("FONNTE_TARGET", "081230220688").strip()
_last_wa_alert_time = 0
WA_ALERT_COOLDOWN_SEC = 180  # Cooldown 3 menit antar notifikasi untuk mencegah spam


def format_human_anomaly_reason(trigger_raw, snapshot):
    t_lower = (trigger_raw or "").lower()

    if "cahaya" in t_lower:
        if "+" in t_lower or "gelap" in t_lower:
            return "Kamar jauh lebih gelap dari biasanya."
        return "Kamar jauh lebih terang dari biasanya."
    if "suhu" in t_lower:
        if "+" in t_lower or "panas" in t_lower:
            return "Suhu kamar lebih panas dari biasanya."
        return "Suhu kamar lebih dingin dari biasanya."
    if "kelembapan" in t_lower:
        if "+" in t_lower or "lembap" in t_lower:
            return "Udara kamar terasa lebih lembap."
        return "Udara kamar terasa lebih kering."
    if "gas" in t_lower:
        return "Indikasi asap/gas meningkat di kamar."
    return "Pola kondisi kamar tidak seperti biasa."


def send_whatsapp_alert(title, detail, sensor_snapshot=None, force=False, emoji="⚠️"):
    global _last_wa_alert_time
    if not FONNTE_TOKEN or not FONNTE_TARGET:
        return

    now = time.time()
    if not force and now - _last_wa_alert_time < WA_ALERT_COOLDOWN_SEC:
        return
    _last_wa_alert_time = now

    def _worker():
        try:
            import urllib.request
            import urllib.parse

            now_dt = datetime.now()
            bulan_id = (
                "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
                "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
            )
            waktu_str = f"{now_dt.strftime('%H:%M')} WIB • {now_dt.day} {bulan_id[now_dt.month - 1]}"

            snap = sensor_snapshot or {}
            try:
                suhu = float(snap.get("suhu", 0))
            except (ValueError, TypeError):
                suhu = 0.0
            try:
                kelembapan = float(snap.get("kelembapan", 0))
            except (ValueError, TypeError):
                kelembapan = 0.0
            try:
                gas = int(snap.get("gas", 0))
            except (ValueError, TypeError):
                gas = 0
            try:
                cahaya = int(snap.get("cahaya", 0))
            except (ValueError, TypeError):
                cahaya = 0

            kipas = snap.get("kipas", "OFF")
            led = snap.get("led", "OFF")
            buzzer = snap.get("buzzer", "OFF")

            if suhu >= 33:
                status_suhu = "Panas"
            elif suhu >= 26:
                status_suhu = "Normal"
            else:
                status_suhu = "Sejuk"

            if kelembapan >= 60:
                status_lembap = "Lembap"
            elif kelembapan >= 40:
                status_lembap = "Normal"
            else:
                status_lembap = "Kering"

            if gas >= GAS_THRESHOLD:
                status_gas = "Tinggi (Bahaya!)"
            elif gas >= 2200:
                status_gas = "Sedang (Waspada)"
            else:
                status_gas = "Rendah (Aman)"

            if cahaya >= LDR_THRESHOLD:
                status_cahaya = "Gelap"
            elif cahaya >= 1200:
                status_cahaya = "Redup"
            else:
                status_cahaya = "Terang"

            aktif_list = []
            if kipas == "ON":
                aktif_list.append("Kipas")
            if led == "ON":
                aktif_list.append("Lampu")
            if buzzer == "ON":
                aktif_list.append("Alarm")
            aktif_str = ", ".join(aktif_list) if aktif_list else "Semua Mati"

            suhu_str = f"{suhu:.0f}°C" if suhu == int(suhu) else f"{suhu:.1f}°C"

            msg_lines = [
                f"{emoji} *{title}*",
                f"{detail}",
                "",
                f"🌡️ Suhu: *{suhu_str}* ({status_suhu})",
                f"💧 Lembap: *{kelembapan:.0f}%* ({status_lembap})",
                f"💨 Gas: *{status_gas}*",
                f"💡 Cahaya: *{status_cahaya}*",
                f"⚡ Aktif: *{aktif_str}*",
                "",
                f"🕒 {waktu_str}",
                "🌐 https://skk.kradev.my.id"
            ]
            pesan_text = "\n".join(msg_lines)

            post_data = urllib.parse.urlencode({
                "target": FONNTE_TARGET,
                "message": pesan_text,
                "preview": "false"
            }).encode("utf-8")

            req = urllib.request.Request(
                "https://api.fonnte.com/send",
                data=post_data,
                headers={
                    "Authorization": FONNTE_TOKEN,
                    "User-Agent": "SmartKamarKos-IoT/1.0"
                }
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                pass
        except Exception as err:
            print("Gagal mengirim notifikasi WhatsApp Fonnte:", err)

    threading.Thread(target=_worker, daemon=True).start()


state_lock = threading.RLock()
model_lock = threading.RLock()

buzzer_muted = False
fan_manual_off_until = 0.0
fan_wait_humid_clear = False
led_manual_until = 0.0
led_wait_dark_clear = False

manual_overrides = {
    "led": None,
    "kipas": None,
    "buzzer": None
}

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


def _clear_fan_manual_override_locked():
    """Clear manual Exhaust Fan override along with its snooze and cycle-wait state."""
    global fan_manual_off_until, fan_wait_humid_clear
    manual_overrides["kipas"] = None
    fan_manual_off_until = 0.0
    fan_wait_humid_clear = False


def _clear_led_manual_override_locked():
    """Clear manual Lamp override along with its snooze and light-cycle wait state."""
    global led_manual_until, led_wait_dark_clear
    manual_overrides["led"] = None
    led_manual_until = 0.0
    led_wait_dark_clear = False


def _get_snooze_remaining_locked(device_override, until_ts):
    if not device_override or until_ts <= 0:
        return 0
    return max(0, int(round(until_ts - time.time())))


def _get_fan_snooze_remaining_locked():
    """Return remaining manual OFF snooze seconds for Exhaust Fan (0 if inactive)."""
    if manual_overrides.get("kipas") != "OFF":
        return 0
    return _get_snooze_remaining_locked("OFF", fan_manual_off_until)


def _get_led_snooze_remaining_locked():
    """Return remaining manual snooze seconds for Lamp (0 if inactive)."""
    return _get_snooze_remaining_locked(manual_overrides.get("led"), led_manual_until)


def _release_expired_snoozes_locked():
    """Clear any expired timed manual snoozes; returns True if any override was released."""
    now_ts = time.time()
    released = False
    if manual_overrides.get("kipas") == "OFF" and fan_manual_off_until > 0 and now_ts >= fan_manual_off_until:
        _clear_fan_manual_override_locked()
        released = True
    if manual_overrides.get("led") in ("ON", "OFF") and led_manual_until > 0 and now_ts >= led_manual_until:
        _clear_led_manual_override_locked()
        released = True
    return released


def _evaluate_auto_actuators_locked(payload=None):
    """Evaluate server-side automatic rules for kipas, led, and buzzer while respecting manual overrides."""
    global buzzer_muted, fan_wait_humid_clear

    payload = payload or {}
    current_gas = sensor_data.get("gas", 0)
    current_humid = sensor_data.get("kelembapan", 0)
    current_ldr = sensor_data.get("cahaya", 0)

    gas_danger = isinstance(current_gas, (int, float)) and current_gas >= GAS_THRESHOLD
    humid_high = isinstance(current_humid, (int, float)) and current_humid >= HUMIDITY_THRESHOLD
    ldr_dark = isinstance(current_ldr, (int, float)) and current_ldr >= LDR_THRESHOLD

    _release_expired_snoozes_locked()

    # Auto-release manual Exhaust Fan OFF on gas danger, snooze expiry, or a fresh humid cycle
    if manual_overrides.get("kipas") == "OFF":
        if gas_danger:
            _clear_fan_manual_override_locked()
        elif fan_wait_humid_clear:
            if isinstance(current_humid, (int, float)) and current_humid < FAN_HUMIDITY_CLEAR_THRESHOLD:
                fan_wait_humid_clear = False
        elif humid_high:
            _clear_fan_manual_override_locked()

    # Auto-release manual Lamp ON/OFF on snooze expiry or when lighting enters the next day/night phase
    if manual_overrides.get("led") in ("ON", "OFF"):
        if led_wait_dark_clear:
            if isinstance(current_ldr, (int, float)) and current_ldr < LED_BRIGHT_CLEAR_THRESHOLD:
                _clear_led_manual_override_locked()
        elif ldr_dark:
            _clear_led_manual_override_locked()

    if manual_overrides.get("kipas") in ("ON", "OFF"):
        sensor_data["kipas"] = manual_overrides["kipas"]
    else:
        payload_fan_on = str(payload.get("kipas", "OFF")).upper() == "ON"
        sensor_data["kipas"] = "ON" if (gas_danger or humid_high or payload_fan_on) else "OFF"

    if manual_overrides.get("led") in ("ON", "OFF"):
        sensor_data["led"] = manual_overrides["led"]
    else:
        payload_led_on = str(payload.get("led", "OFF")).upper() == "ON"
        sensor_data["led"] = "ON" if (ldr_dark or payload_led_on) else "OFF"

    if manual_overrides.get("buzzer") == "ON":
        sensor_data["buzzer"] = "ON"
    elif manual_overrides.get("buzzer") == "OFF":
        sensor_data["buzzer"] = "MUTED" if gas_danger else "OFF"
    elif gas_danger:
        sensor_data["buzzer"] = "MUTED" if buzzer_muted else "ON"
    else:
        sensor_data["buzzer"] = "OFF"


def set_manual_device_state(device, state=None):
    """Set or toggle manual override state ('ON', 'OFF', or 'AUTO') for an actuator or 'all'."""
    global buzzer_muted, fan_manual_off_until, fan_wait_humid_clear, led_manual_until, led_wait_dark_clear

    device_key = str(device or "").strip().lower()
    if device_key not in ("led", "kipas", "buzzer", "all"):
        return 400, {"status": "ERROR", "message": "Perangkat tidak valid (led, kipas, buzzer, all)."}

    with state_lock:
        if device_key == "all":
            target_state = str(state or "AUTO").strip().upper()
            if target_state != "AUTO":
                return 400, {"status": "ERROR", "message": "Perangkat 'all' hanya mendukung status AUTO."}
            _clear_led_manual_override_locked()
            _clear_fan_manual_override_locked()
            manual_overrides["buzzer"] = None
            buzzer_muted = False
            sensor_data["buzzer_muted"] = False
            _evaluate_auto_actuators_locked()
            overrides_copy = {k: (v if v is not None else "AUTO") for k, v in manual_overrides.items()}
            return 200, {
                "status": "OK",
                "device": "all",
                "mode": "AUTO",
                "manual_overrides": overrides_copy,
                "kipas_snooze_remaining_sec": 0,
                "led_snooze_remaining_sec": 0
            }

        current_val = str(sensor_data.get(device_key, "OFF")).upper()
        if state is None:
            target_state = "OFF" if current_val == "ON" else "ON"
        else:
            target_state = str(state).strip().upper()

        if target_state not in ("ON", "OFF", "AUTO"):
            return 400, {"status": "ERROR", "message": "Status harus ON, OFF, atau AUTO."}

        if target_state == "AUTO":
            if device_key == "kipas":
                _clear_fan_manual_override_locked()
            elif device_key == "led":
                _clear_led_manual_override_locked()
            else:
                manual_overrides[device_key] = None
            if device_key == "buzzer":
                buzzer_muted = False
                sensor_data["buzzer_muted"] = False
            _evaluate_auto_actuators_locked()
        else:
            manual_overrides[device_key] = target_state
            if device_key == "kipas":
                if target_state == "OFF":
                    current_humid = sensor_data.get("kelembapan", 0)
                    fan_manual_off_until = time.time() + FAN_MANUAL_SNOOZE_SECONDS
                    fan_wait_humid_clear = (
                        isinstance(current_humid, (int, float))
                        and current_humid >= HUMIDITY_THRESHOLD
                    )
                    _evaluate_auto_actuators_locked()
                else:
                    _clear_fan_manual_override_locked()
                    manual_overrides["kipas"] = "ON"
                    sensor_data["kipas"] = "ON"
            elif device_key == "led":
                current_ldr = sensor_data.get("cahaya", 0)
                snooze_dur = LED_OFF_SNOOZE_SECONDS if target_state == "OFF" else LED_ON_SNOOZE_SECONDS
                led_manual_until = time.time() + snooze_dur
                led_wait_dark_clear = (
                    isinstance(current_ldr, (int, float))
                    and current_ldr >= LDR_THRESHOLD
                )
                sensor_data["led"] = target_state
            elif device_key == "buzzer":
                if target_state == "OFF":
                    buzzer_muted = True
                    sensor_data["buzzer_muted"] = True
                    current_gas = sensor_data.get("gas", 0)
                    sensor_data["buzzer"] = (
                        "MUTED" if isinstance(current_gas, (int, float)) and current_gas >= GAS_THRESHOLD else "OFF"
                    )
                else:
                    buzzer_muted = False
                    sensor_data["buzzer_muted"] = False
                    sensor_data["buzzer"] = "ON"

        overrides_copy = {k: (v if v is not None else "AUTO") for k, v in manual_overrides.items()}
        applied_val = sensor_data[device_key]
        fan_snooze_rem = _get_fan_snooze_remaining_locked()
        led_snooze_rem = _get_led_snooze_remaining_locked()

    try:
        db.record_incident(
            "MANUAL_CONTROL",
            "INFO",
            f"Kendali manual {device_key.upper()} diubah menjadi {target_state}.",
            gas_value=sensor_data.get("gas"),
            ai_score=ai_score
        )
    except Exception:
        pass

    return 200, {
        "status": "OK",
        "device": device_key,
        "state": applied_val,
        "mode": target_state,
        "manual_overrides": overrides_copy,
        "kipas_snooze_remaining_sec": fan_snooze_rem,
        "led_snooze_remaining_sec": led_snooze_rem
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

event_lock = threading.Lock()
prev_gas_danger = False
prev_actuators = {"led": "OFF", "kipas": "OFF", "buzzer": "OFF"}
prev_ai_status = "MENUNGGU DATA"
memory_telemetry_history = deque(maxlen=5000)
memory_incident_history = deque(maxlen=500)
_last_memory_telemetry_ts = 0.0

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
        busy = calibration_state["status"] in (
            STATUS_KALIBRASI_BERLANGSUNG, STATUS_MELATIH_MODEL
        )
        target_slot = (calibration_state.get("target_slot") if busy else curr_slot) or curr_slot
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

        # Kunci kalibrasi ke slot waktu saat ini (tidak boleh mengambil data slot waktu lain)
        curr_slot = get_current_time_slot_key()
        if requested_slot and requested_slot != curr_slot:
            curr_label = TIME_SLOTS[curr_slot]["label"]
            req_label = TIME_SLOTS.get(requested_slot, {}).get("label", str(requested_slot).capitalize())
            return 409, {
                "status": "ERROR",
                "message": f"Tidak bisa mengambil data {req_label} karena waktu sekarang {curr_label}."
            }
        target_slot = curr_slot
        target_meta = TIME_SLOTS[target_slot]

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

    db.record_incident(
        "CALIBRATION_START",
        "INFO",
        f"Sesi kalibrasi slot {target_meta['label']} ({target_meta['range_label']}) dimulai."
    )
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

    db.record_incident(
        "CALIBRATION_CANCELLED",
        "INFO",
        f"Kalibrasi slot {target_label} dibatalkan."
    )
    db.record_calibration_session(
        target_slot,
        len(calibration_samples),
        {},
        None,
        status="CANCELLED"
    )

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

        db.record_calibration_session(
            target_slot,
            len(samples),
            baseline,
            target_model_file,
            status="SUCCESS"
        )
        db.record_incident(
            "CALIBRATION_SUCCESS",
            "INFO",
            f"Model AI slot {target_meta['label']} berhasil dilatih ({len(samples)} sampel)."
        )

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

        db.record_calibration_session(
            target_slot,
            len(samples) if samples else 0,
            {},
            None,
            status="FAILED"
        )
        db.record_incident(
            "CALIBRATION_FAILED",
            "WARNING",
            f"Kalibrasi slot {target_meta['label']} gagal: {error}."
        )

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
        def default_serializer(obj):
            if isinstance(obj, decimal.Decimal):
                return float(obj)
            if hasattr(obj, "isoformat"):
                return obj.isoformat()
            return str(obj)

        response = json.dumps(data, default=default_serializer).encode("utf-8")

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

        if self.command != "HEAD":
            try:
                self.wfile.write(response)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Device-Token")
        self.end_headers()

    def do_POST(self):
        global sensor_data
        global buzzer_muted
        global last_received_timestamp
        global last_received_time_str
        global ai_status
        global ai_raw_status

        clean_path = self.path.split("?")[0]

        if clean_path in ("/api/device/control", "/api/device/toggle"):
            req_data = {}
            try:
                length = int(self.headers.get("Content-Length", 0))
                if length > 0:
                    body = self.rfile.read(length)
                    parsed = json.loads(body.decode("utf-8"))
                    if isinstance(parsed, dict):
                        req_data = parsed
            except Exception:
                pass

            device_param = req_data.get("device")
            state_param = req_data.get("state")

            if "?" in self.path:
                for param in self.path.split("?", 1)[1].split("&"):
                    if param.startswith("device=") and not device_param:
                        device_param = param.split("=", 1)[1].strip()
                    elif param.startswith("state=") and not state_param:
                        state_param = param.split("=", 1)[1].strip()

            status_code, resp = set_manual_device_state(device_param, state_param)
            self.send_json(status_code, resp)
            return

        if clean_path == "/api/buzzer/mute":
            with state_lock:
                buzzer_muted = True
                manual_overrides["buzzer"] = "OFF"
                sensor_data["buzzer_muted"] = True
                if sensor_data.get("gas", 0) >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "MUTED"
                else:
                    sensor_data["buzzer"] = "OFF"
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
                manual_overrides["buzzer"] = None
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

        if DEVICE_TOKEN:
            token = self.headers.get("X-Device-Token", "").strip()
            if token != DEVICE_TOKEN:
                self.send_json(401, {"error": "Token perangkat tidak valid"})
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
                    if manual_overrides.get("buzzer") == "OFF":
                        manual_overrides["buzzer"] = None

                for key in ("suhu", "kelembapan", "cahaya", "gas"):
                    if key in payload:
                        sensor_data[key] = payload[key]

                for key in ("led", "kipas"):
                    if key in payload:
                        sensor_data[key] = str(payload[key]).upper()

                _evaluate_auto_actuators_locked(payload)
                sensor_data["buzzer_muted"] = buzzer_muted

                last_received_timestamp = time.time()
                last_received_time_str = (
                    datetime.now().strftime("%H:%M:%S")
                )

                current_data = dict(sensor_data)
                current_mute = buzzer_muted
                current_overrides = {
                    k: (v if v is not None else "AUTO")
                    for k, v in manual_overrides.items()
                }
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

            def _ov_hdr(val):
                if val == "ON":
                    return "1"
                if val == "OFF":
                    return "0"
                return "A"

            self.send_json(
                200,
                {
                    "status": "OK",
                    "buzzer_mute": current_mute,
                    "manual_led": current_overrides["led"],
                    "manual_kipas": current_overrides["kipas"],
                    "manual_buzzer": current_overrides["buzzer"]
                },
                extra_headers={
                    "X-Buzzer-Mute": "1" if current_mute else "0",
                    "X-Manual-Led": _ov_hdr(current_overrides["led"]),
                    "X-Manual-Kipas": _ov_hdr(current_overrides["kipas"]),
                    "X-Manual-Buzzer": _ov_hdr(current_overrides["buzzer"])
                }
            )

            try:
                ai_pay = get_ai_payload()
                force_db_save = False

                current_gas_val = current_data.get("gas", 0)
                current_fan = current_data.get("kipas", "OFF")
                current_led = current_data.get("led", "OFF")
                current_buzz = current_data.get("buzzer", "OFF")
                is_gas_danger = isinstance(current_gas_val, (int, float)) and current_gas_val >= GAS_THRESHOLD

                with event_lock:
                    global prev_gas_danger, prev_actuators, prev_ai_status

                    if is_gas_danger and not prev_gas_danger:
                        db.record_incident(
                            "GAS_DANGER",
                            "DANGER",
                            f"Gas melebihi ambang batas ({current_gas_val} ADC). Buzzer dan kipas aktif.",
                            gas_value=current_gas_val,
                            ai_score=current_ai_score
                        )
                        force_db_save = True
                        send_whatsapp_alert(
                            "Bahaya Kebocoran Gas!",
                            "Kadar gas tinggi, kipas & alarm aktif.",
                            sensor_snapshot=current_data,
                            emoji="🚨"
                        )
                    prev_gas_danger = is_gas_danger

                    if current_fan != prev_actuators.get("kipas"):
                        db.record_incident(
                            "FAN_ON" if current_fan == "ON" else "FAN_OFF",
                            "INFO",
                            f"Exhaust fan {'aktif berputar' if current_fan == 'ON' else 'berhenti'}.",
                            gas_value=current_gas_val,
                            ai_score=current_ai_score
                        )
                        prev_actuators["kipas"] = current_fan
                        force_db_save = True

                    if current_led != prev_actuators.get("led"):
                        db.record_incident(
                            "LED_ON" if current_led == "ON" else "LED_OFF",
                            "INFO",
                            f"Lampu LED otomatis {'menyala' if current_led == 'ON' else 'padam'}.",
                            gas_value=current_gas_val,
                            ai_score=current_ai_score
                        )
                        prev_actuators["led"] = current_led

                    if current_buzz != prev_actuators.get("buzzer"):
                        if current_buzz == "MUTED":
                            db.record_incident(
                                "BUZZER_MUTED",
                                "WARNING",
                                "Suara buzzer dimatikan oleh pengguna.",
                                gas_value=current_gas_val,
                                ai_score=current_ai_score
                            )
                        elif current_buzz == "ON":
                            db.record_incident(
                                "BUZZER_ON",
                                "DANGER",
                                "Alarm buzzer berbunyi aktif.",
                                gas_value=current_gas_val,
                                ai_score=current_ai_score
                            )
                        prev_actuators["buzzer"] = current_buzz

                    if current_ai_status == "ANOMALI" and prev_ai_status != "ANOMALI":
                        db.record_incident(
                            "AI_ANOMALY",
                            "WARNING",
                            f"Pola sensor abnormal: {ai_pay.get('ai_trigger_desc')}",
                            gas_value=current_gas_val,
                            ai_score=current_ai_score
                        )
                        force_db_save = True
                        send_whatsapp_alert(
                            "Anomali Kamar Terdeteksi",
                            format_human_anomaly_reason(ai_pay.get("ai_trigger_desc"), current_data),
                            sensor_snapshot=current_data,
                            emoji="⚠️"
                        )
                    prev_ai_status = current_ai_status

                db.record_telemetry(current_data, ai_pay, force=force_db_save)

                global _last_memory_telemetry_ts
                now_mem_ts = time.time()
                if force_db_save or (now_mem_ts - _last_memory_telemetry_ts >= 15):
                    _last_memory_telemetry_ts = now_mem_ts
                    memory_telemetry_history.append({
                        "suhu": current_data.get("suhu", 0),
                        "kelembapan": current_data.get("kelembapan", 0),
                        "cahaya": current_data.get("cahaya", 0),
                        "gas": current_data.get("gas", 0),
                        "led": current_led,
                        "kipas": current_fan,
                        "buzzer": current_buzz,
                        "time_slot": ai_pay.get("ai_active_slot", "siang"),
                        "ai_score": ai_pay.get("ai_score"),
                        "ai_status": ai_pay.get("ai_status", "NORMAL"),
                        "created_at": datetime.now().isoformat(),
                    })
                if is_gas_danger:
                    memory_incident_history.append({
                        "event_type": "GAS_DANGER",
                        "created_at": datetime.now().isoformat(),
                    })
                elif current_ai_status == "ANOMALI":
                    memory_incident_history.append({
                        "event_type": "AI_ANOMALY",
                        "created_at": datetime.now().isoformat(),
                    })
            except Exception as db_err:
                print("Peringatan, logging DB dilewati:", db_err)

        except json.JSONDecodeError:
            self.send_json(400, {"error": "Format JSON Invalid"})

        except Exception as error:
            print("Error memproses POST:", error)
            self.send_json(500, {"error": "Internal Server Error"})

    def do_GET(self):
        global sensor_data
        global buzzer_muted

        clean_path = self.path.split("?")[0]

        if clean_path in ("/api/device/control", "/api/device/toggle"):
            req_data = {}
            try:
                length = int(self.headers.get("Content-Length", 0))
                if length > 0:
                    body = self.rfile.read(length)
                    parsed = json.loads(body.decode("utf-8"))
                    if isinstance(parsed, dict):
                        req_data = parsed
            except Exception:
                pass

            device_param = req_data.get("device")
            state_param = req_data.get("state")

            if "?" in self.path:
                for param in self.path.split("?", 1)[1].split("&"):
                    if param.startswith("device=") and not device_param:
                        device_param = param.split("=", 1)[1].strip()
                    elif param.startswith("state=") and not state_param:
                        state_param = param.split("=", 1)[1].strip()

            status_code, resp = set_manual_device_state(device_param, state_param)
            self.send_json(status_code, resp)
            return

        if clean_path == "/api/buzzer/mute":
            with state_lock:
                buzzer_muted = True
                manual_overrides["buzzer"] = "OFF"
                sensor_data["buzzer_muted"] = True
                if sensor_data.get("gas", 0) >= GAS_THRESHOLD:
                    sensor_data["buzzer"] = "MUTED"
                else:
                    sensor_data["buzzer"] = "OFF"
            self.send_json(200, {
                "status": "OK",
                "message": "Buzzer berhasil dimatikan.",
                "buzzer_muted": True
            })
            return

        if clean_path == "/api/buzzer/unmute":
            with state_lock:
                buzzer_muted = False
                manual_overrides["buzzer"] = None
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
                if _release_expired_snoozes_locked():
                    _evaluate_auto_actuators_locked()

                online = (
                    last_received_timestamp > 0
                    and time.time() - last_received_timestamp
                    <= ESP32_TIMEOUT_SECONDS
                )

                response = dict(sensor_data)
                response["esp32_online"] = online
                response["is_stale"] = not online
                response["has_live_data"] = online
                response["last_seen"] = last_received_time_str
                response["buzzer_muted"] = buzzer_muted
                response["manual_overrides"] = {
                    k: (v if v is not None else "AUTO")
                    for k, v in manual_overrides.items()
                }
                response["kipas_snooze_remaining_sec"] = _get_fan_snooze_remaining_locked()
                response["led_snooze_remaining_sec"] = _get_led_snooze_remaining_locked()
                response["gas_threshold"] = GAS_THRESHOLD
                response["ldr_threshold"] = LDR_THRESHOLD
                response["humidity_threshold"] = HUMIDITY_THRESHOLD

            ai_payload = get_ai_payload()
            if not online:
                ai_payload["ai_status"] = "STANDBY"
                ai_payload["ai_score"] = None
                ai_payload["ai_score_percent"] = "--"
                ai_payload["ai_anomaly_count"] = 0
                ai_payload["ai_trigger_desc"] = "Menunggu data sensor ESP32."
                ai_payload["ai_status_desc"] = "Model AI siap memproses segera setelah perangkat ESP32 terhubung dan mengirimkan data."

            response.update(ai_payload)
            response.update(get_calibration_payload())

            self.send_json(200, response)
            return

        if clean_path == "/api/history":
            limit = 100
            if "?" in self.path:
                for param in self.path.split("?", 1)[1].split("&"):
                    if param.startswith("limit="):
                        try:
                            limit = int(param.split("=")[1])
                        except ValueError:
                            pass
            history = db.get_history(limit=limit)
            self.send_json(200, {"status": "OK", "count": len(history), "data": history})
            return

        if clean_path == "/api/incidents":
            limit = 50
            if "?" in self.path:
                for param in self.path.split("?", 1)[1].split("&"):
                    if param.startswith("limit="):
                        try:
                            limit = int(param.split("=")[1])
                        except ValueError:
                            pass
            incidents = db.get_incidents(limit=limit)
            self.send_json(200, {"status": "OK", "count": len(incidents), "data": incidents})
            return

        if clean_path == "/api/calibration/history":
            limit = 20
            if "?" in self.path:
                for param in self.path.split("?", 1)[1].split("&"):
                    if param.startswith("limit="):
                        try:
                            limit = int(param.split("=")[1])
                        except ValueError:
                            pass
            calibrations = db.get_calibration_history(limit=limit)
            self.send_json(200, {"status": "OK", "count": len(calibrations), "data": calibrations})
            return

        def _parse_week_params():
            iso_year = None
            iso_week = None
            if "?" in self.path:
                for param in self.path.split("?", 1)[1].split("&"):
                    if param.startswith("year="):
                        try:
                            iso_year = int(param.split("=", 1)[1])
                        except ValueError:
                            pass
                    elif param.startswith("week="):
                        try:
                            iso_week = int(param.split("=", 1)[1])
                        except ValueError:
                            pass
            return iso_year, iso_week

        def _get_weekly_payload():
            iso_year, iso_week = _parse_week_params()
            if db.is_db_connected():
                summary = db.get_weekly_summary(iso_year=iso_year, iso_week=iso_week)
                if summary.get("has_data"):
                    return summary
            with event_lock:
                mem_rows = list(memory_telemetry_history)
                mem_inc = list(memory_incident_history)
            if mem_rows:
                mem_summary = db.build_weekly_summary_from_rows(
                    mem_rows, mem_inc, iso_year=iso_year, iso_week=iso_week, source="memory"
                )
                if mem_summary.get("has_data"):
                    return mem_summary
            return db.build_weekly_summary_from_rows([], [], iso_year=iso_year, iso_week=iso_week, source="empty")

        if clean_path == "/api/summary/weekly":
            self.send_json(200, _get_weekly_payload())
            return

        if clean_path == "/api/export/weekly-csv":
            summary = _get_weekly_payload()
            csv_content = db.export_weekly_summary_csv(summary)
            csv_bytes = csv_content.encode("utf-8")
            wk_label = summary.get("week", {}).get("label", "weekly")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(csv_bytes)))
            self.send_header("Content-Disposition", f"attachment; filename=rekap_mingguan_{wk_label}.csv")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(csv_bytes)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        if clean_path == "/api/export/csv":
            limit = 5000
            if "?" in self.path:
                for param in self.path.split("?", 1)[1].split("&"):
                    if param.startswith("limit="):
                        try:
                            limit = int(param.split("=")[1])
                        except ValueError:
                            pass
            csv_content = db.export_telemetry_csv(limit=limit)
            csv_bytes = csv_content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(csv_bytes)))
            self.send_header("Content-Disposition", "attachment; filename=sensor_telemetry.csv")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(csv_bytes)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        if clean_path == "/api/test/whatsapp":
            send_whatsapp_alert(
                "Uji Coba Notifikasi Kamar",
                "Sistem pengingat WhatsApp berjalan normal.",
                sensor_snapshot=sensor_data,
                force=True,
                emoji="🔔"
            )
            self.send_json(200, {
                "status": "OK",
                "message": "Pesan uji coba WhatsApp berhasil dikirim ke nomor target.",
                "target": FONNTE_TARGET
            })
            return

        if clean_path == "/api/health":
            stats = db.get_stats()
            with state_lock:
                online = (
                    last_received_timestamp > 0
                    and time.time() - last_received_timestamp
                    <= ESP32_TIMEOUT_SECONDS
                )
            self.send_json(200, {
                "status": "OK",
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "timezone": os.environ.get("TZ", "Asia/Jakarta"),
                "db_connected": stats.get("db_connected", False),
                "telemetry_rows": stats.get("telemetry_rows", 0),
                "incident_rows": stats.get("incident_rows", 0),
                "calibration_rows": stats.get("calibration_rows", 0),
                "esp32_online": online
            })
            return

        path_map = {
            "/": "index.html",
            "/index.html": "index.html",
            "/style.css": "style.css",
            "/script.js": "script.js"
        }

        rel_path = path_map.get(clean_path, clean_path.lstrip("/"))
        filepath = os.path.abspath(os.path.join(BASE_DIR, rel_path))

        # Keamanan: pastikan file berada di dalam BASE_DIR dan bertipe file reguler
        if not filepath.startswith(BASE_DIR) or not os.path.isfile(filepath):
            self.send_error(404)
            return

        lower_path = filepath.lower()
        if lower_path.endswith(".html"):
            content_type = "text/html; charset=utf-8"
        elif lower_path.endswith(".css"):
            content_type = "text/css; charset=utf-8"
        elif lower_path.endswith(".js") or lower_path.endswith(".mjs"):
            content_type = "application/javascript; charset=utf-8"
        elif lower_path.endswith(".json"):
            content_type = "application/json; charset=utf-8"
        elif lower_path.endswith(".svg"):
            content_type = "image/svg+xml"
        elif lower_path.endswith(".png"):
            content_type = "image/png"
        elif lower_path.endswith(".ico"):
            content_type = "image/x-icon"
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
            if clean_path == "/sw.js":
                self.send_header("Service-Worker-Allowed", "/")
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
    db.init_db()

    server = ThreadingHTTPServer((HOST, PORT), SmartKosServer)
    print("Server aktif pada port {}".format(PORT))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
    finally:
        server.server_close()