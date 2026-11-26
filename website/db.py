import os
import csv
import io
import json
import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

try:
    import psycopg2
    from psycopg2 import pool
    from psycopg2.extras import RealDictCursor, Json
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

logger = logging.getLogger("smartkos.db")

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DEFAULT_DEVICE_ID = os.environ.get("DEFAULT_DEVICE_ID", "esp32-kamar-01").strip()
TELEMETRY_INTERVAL_SEC = int(os.environ.get("DB_TELEMETRY_INTERVAL_SEC", "15"))
RETENTION_DAYS = int(os.environ.get("DB_RETENTION_DAYS", "30"))

_db_pool = None
_pool_lock = threading.Lock()
_last_telemetry_time = 0
_last_retention_check = 0


def _build_dsn():
    if DATABASE_URL:
        return DATABASE_URL
    user = os.environ.get("POSTGRES_USER", "smartkos")
    password = os.environ.get("POSTGRES_PASSWORD", "")
    host = os.environ.get("POSTGRES_HOST", "db")
    port = os.environ.get("POSTGRES_PORT", "5432")
    dbname = os.environ.get("POSTGRES_DB", "smartkos")
    if password:
        return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"
    return ""


def init_db():
    global _db_pool
    if not HAS_PSYCOPG2:
        logger.warning("psycopg2 belum terpasang; database berjalan dalam mode in-memory")
        return False

    dsn = _build_dsn()
    if not dsn:
        logger.info("DATABASE_URL tidak disetel; menggunakan mode in-memory tanpa PostgreSQL")
        return False

    with _pool_lock:
        if _db_pool is not None:
            return True
        try:
            _db_pool = pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=10,
                dsn=dsn,
                connect_timeout=5
            )
            logger.info("Koneksi PostgreSQL berhasil dibuat")
        except Exception as err:
            logger.warning(f"Gagal menghubungkan ke PostgreSQL: {err}")
            _db_pool = None
            return False

    return _run_migrations()


def _run_migrations():
    migration_sql = """
    CREATE TABLE IF NOT EXISTS devices (
        id VARCHAR(32) PRIMARY KEY,
        room_name VARCHAR(64) NOT NULL DEFAULT 'Kamar Kos 01 (Miniatur)',
        firmware_version VARCHAR(20) NOT NULL DEFAULT 'v1.0-micropython',
        is_online BOOLEAN NOT NULL DEFAULT TRUE,
        last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sensor_telemetry (
        id BIGSERIAL PRIMARY KEY,
        device_id VARCHAR(32) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        suhu NUMERIC(4, 1) NOT NULL,
        kelembapan NUMERIC(4, 1) NOT NULL,
        cahaya INTEGER NOT NULL,
        gas INTEGER NOT NULL,
        led_status VARCHAR(5) NOT NULL DEFAULT 'OFF',
        kipas_status VARCHAR(5) NOT NULL DEFAULT 'OFF',
        buzzer_status VARCHAR(10) NOT NULL DEFAULT 'OFF',
        time_slot VARCHAR(10) NOT NULL DEFAULT 'siang',
        ai_score NUMERIC(5, 2),
        ai_status VARCHAR(20) NOT NULL DEFAULT 'MENUNGGU DATA',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_device_created
        ON sensor_telemetry (device_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS incident_logs (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(32) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        event_type VARCHAR(30) NOT NULL,
        severity VARCHAR(10) NOT NULL DEFAULT 'INFO',
        description TEXT NOT NULL,
        gas_value INTEGER,
        ai_score NUMERIC(5, 2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_device_created
        ON incident_logs (device_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS calibration_sessions (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(32) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        slot_key VARCHAR(10) NOT NULL,
        total_samples SMALLINT NOT NULL DEFAULT 100,
        baseline_stats JSONB,
        model_path VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_calibrations_device_created
        ON calibration_sessions (device_id, created_at DESC);

    INSERT INTO devices (id, room_name, firmware_version, is_online, last_seen_at)
    VALUES ('esp32-kamar-01', 'Kamar Kos 01 (Miniatur)', 'v1.0-micropython', TRUE, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
        is_online = EXCLUDED.is_online,
        last_seen_at = EXCLUDED.last_seen_at;
    """
    try:
        with get_cursor(commit=True) as cur:
            cur.execute(migration_sql)
        logger.info("Migrasi skema PostgreSQL selesai dijalankan")
        return True
    except Exception as err:
        logger.error(f"Gagal menjalankan migrasi skema: {err}")
        return False


@contextmanager
def get_cursor(commit=False):
    global _db_pool
    if _db_pool is None:
        raise RuntimeError("Database pool belum aktif")

    conn = None
    try:
        conn = _db_pool.getconn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        try:
            yield cur
            if commit:
                conn.commit()
        finally:
            cur.close()
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    finally:
        if conn is not None and _db_pool is not None:
            _db_pool.putconn(conn)


def is_db_connected():
    if _db_pool is None:
        return False
    try:
        with get_cursor(commit=False) as cur:
            cur.execute("SELECT 1")
            return True
    except Exception:
        return False


def record_telemetry(payload, ai_payload=None, force=False, device_id=DEFAULT_DEVICE_ID):
    global _last_telemetry_time
    if _db_pool is None:
        return False

    now = time.time()
    if not force and (_last_telemetry_time != 0) and (now - _last_telemetry_time < TELEMETRY_INTERVAL_SEC):
        return False

    ai_payload = ai_payload or {}
    suhu = payload.get("suhu", 0)
    kelembapan = payload.get("kelembapan", 0)
    cahaya = payload.get("cahaya", 0)
    gas = payload.get("gas", 0)
    led = str(payload.get("led", "OFF")).upper()
    kipas = str(payload.get("kipas", "OFF")).upper()
    buzzer = str(payload.get("buzzer", "OFF")).upper()
    time_slot = ai_payload.get("ai_active_slot", "siang")
    ai_score = ai_payload.get("ai_score")
    ai_status = ai_payload.get("ai_status", "MENUNGGU DATA")

    sql = """
    INSERT INTO sensor_telemetry (
        device_id, suhu, kelembapan, cahaya, gas,
        led_status, kipas_status, buzzer_status,
        time_slot, ai_score, ai_status
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);

    UPDATE devices
    SET last_seen_at = CURRENT_TIMESTAMP, is_online = TRUE
    WHERE id = %s;
    """

    try:
        with get_cursor(commit=True) as cur:
            cur.execute(
                sql,
                (
                    device_id, suhu, kelembapan, cahaya, gas,
                    led, kipas, buzzer, time_slot, ai_score, ai_status,
                    device_id
                )
            )
        _last_telemetry_time = now
        _maybe_run_retention()
        return True
    except Exception as err:
        logger.warning(f"Gagal mencatat telemetri ke DB: {err}")
        return False


def record_incident(event_type, severity, description, gas_value=None, ai_score=None, device_id=DEFAULT_DEVICE_ID):
    if _db_pool is None:
        return False

    sql = """
    INSERT INTO incident_logs (
        device_id, event_type, severity, description, gas_value, ai_score
    ) VALUES (%s, %s, %s, %s, %s, %s);
    """
    try:
        with get_cursor(commit=True) as cur:
            cur.execute(sql, (device_id, event_type, severity, description, gas_value, ai_score))
        return True
    except Exception as err:
        logger.warning(f"Gagal mencatat insiden ke DB: {err}")
        return False


def record_calibration_session(slot_key, total_samples, baseline_stats, model_path, status="SUCCESS", device_id=DEFAULT_DEVICE_ID):
    if _db_pool is None:
        return False

    sql = """
    INSERT INTO calibration_sessions (
        device_id, slot_key, total_samples, baseline_stats, model_path, status
    ) VALUES (%s, %s, %s, %s, %s, %s);
    """
    try:
        with get_cursor(commit=True) as cur:
            cur.execute(
                sql,
                (
                    device_id,
                    slot_key,
                    total_samples,
                    Json(baseline_stats) if baseline_stats else None,
                    model_path,
                    status
                )
            )
        return True
    except Exception as err:
        logger.warning(f"Gagal mencatat sesi kalibrasi ke DB: {err}")
        return False


def get_history(limit=100, device_id=DEFAULT_DEVICE_ID):
    if _db_pool is None:
        return []

    limit = max(1, min(int(limit), 1000))
    sql = """
    SELECT
        id,
        suhu,
        kelembapan,
        cahaya,
        gas,
        led_status AS led,
        kipas_status AS kipas,
        buzzer_status AS buzzer,
        time_slot,
        ai_score,
        ai_status,
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
        to_char(created_at, 'HH24:MI:SS') AS timestamp_str
    FROM sensor_telemetry
    WHERE device_id = %s
    ORDER BY created_at DESC
    LIMIT %s;
    """
    try:
        with get_cursor(commit=False) as cur:
            cur.execute(sql, (device_id, limit))
            rows = cur.fetchall()
            return [dict(row) for row in rows]
    except Exception as err:
        logger.warning(f"Gagal mengambil riwayat telemetri: {err}")
        return []


def get_incidents(limit=50, device_id=DEFAULT_DEVICE_ID):
    if _db_pool is None:
        return []

    limit = max(1, min(int(limit), 200))
    sql = """
    SELECT
        id,
        event_type,
        severity,
        description,
        gas_value,
        ai_score,
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
        to_char(created_at, 'HH24:MI:SS') AS timestamp_str
    FROM incident_logs
    WHERE device_id = %s
    ORDER BY created_at DESC
    LIMIT %s;
    """
    try:
        with get_cursor(commit=False) as cur:
            cur.execute(sql, (device_id, limit))
            return [dict(row) for row in cur.fetchall()]
    except Exception as err:
        logger.warning(f"Gagal mengambil riwayat insiden: {err}")
        return []


def get_calibration_history(limit=20, device_id=DEFAULT_DEVICE_ID):
    if _db_pool is None:
        return []

    limit = max(1, min(int(limit), 100))
    sql = """
    SELECT
        id,
        slot_key,
        total_samples,
        baseline_stats,
        model_path,
        status,
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
        to_char(created_at, 'HH24:MI:SS') AS timestamp_str
    FROM calibration_sessions
    WHERE device_id = %s
    ORDER BY created_at DESC
    LIMIT %s;
    """
    try:
        with get_cursor(commit=False) as cur:
            cur.execute(sql, (device_id, limit))
            return [dict(row) for row in cur.fetchall()]
    except Exception as err:
        logger.warning(f"Gagal mengambil riwayat kalibrasi: {err}")
        return []


def export_telemetry_csv(limit=5000, device_id=DEFAULT_DEVICE_ID):
    rows = get_history(limit=limit, device_id=device_id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "timestamp", "suhu", "kelembapan", "cahaya", "gas",
        "led", "kipas", "buzzer", "time_slot", "ai_score", "ai_status"
    ])
    for r in reversed(rows):
        writer.writerow([
            r.get("created_at"),
            r.get("suhu"),
            r.get("kelembapan"),
            r.get("cahaya"),
            r.get("gas"),
            r.get("led"),
            r.get("kipas"),
            r.get("buzzer"),
            r.get("time_slot"),
            r.get("ai_score"),
            r.get("ai_status")
        ])
    return output.getvalue()


def get_stats(device_id=DEFAULT_DEVICE_ID):
    connected = is_db_connected()
    if not connected:
        return {
            "db_connected": False,
            "telemetry_rows": 0,
            "incident_rows": 0,
            "calibration_rows": 0
        }

    sql = """
    SELECT
        (SELECT COUNT(*) FROM sensor_telemetry WHERE device_id = %s) AS telemetry_rows,
        (SELECT COUNT(*) FROM incident_logs WHERE device_id = %s) AS incident_rows,
        (SELECT COUNT(*) FROM calibration_sessions WHERE device_id = %s) AS calibration_rows;
    """
    try:
        with get_cursor(commit=False) as cur:
            cur.execute(sql, (device_id, device_id, device_id))
            row = cur.fetchone()
            return {
                "db_connected": True,
                "telemetry_rows": int(row["telemetry_rows"]),
                "incident_rows": int(row["incident_rows"]),
                "calibration_rows": int(row["calibration_rows"])
            }
    except Exception as err:
        logger.warning(f"Gagal mengambil statistik DB: {err}")
        return {
            "db_connected": False,
            "telemetry_rows": 0,
            "incident_rows": 0,
            "calibration_rows": 0
        }


def _maybe_run_retention():
    global _last_retention_check
    now = time.time()
    # Menjalankan pembersihan data kedaluwarsa paling sering 1 jam sekali
    if _last_retention_check != 0 and now - _last_retention_check < 3600:
        return
    _last_retention_check = now

    def _worker():
        try:
            sql = "DELETE FROM sensor_telemetry WHERE created_at < NOW() - (%s * INTERVAL '1 day');"
            with get_cursor(commit=True) as cur:
                cur.execute(sql, (RETENTION_DAYS,))
            logger.info(f"Pembersihan data retensi {RETENTION_DAYS} hari selesai")
        except Exception as err:
            logger.warning(f"Gagal menjalankan retensi data: {err}")

    threading.Thread(target=_worker, daemon=True).start()


_WEEK_DAY_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
_WEEK_DAY_FULL = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
_MONTHS_ID_LIST = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]


def _format_id_range(start_date, end_date):
    s_month = _MONTHS_ID_LIST[start_date.month - 1]
    e_month = _MONTHS_ID_LIST[end_date.month - 1]
    if start_date.month == end_date.month:
        return f"{start_date.day} - {end_date.day} {e_month}"
    return f"{start_date.day} {s_month} - {end_date.day} {e_month}"


def resolve_iso_week(iso_year=None, iso_week=None, num_weeks=4):
    """Resolve target ISO week bounds and list of recent weeks ending at today's ISO week."""
    today = datetime.now().date()
    curr_year, curr_week, _ = today.isocalendar()

    try:
        target_year = int(iso_year) if iso_year is not None else curr_year
        target_week = int(iso_week) if iso_week is not None else curr_week
        week_start = datetime.fromisocalendar(target_year, target_week, 1).date()
    except (TypeError, ValueError):
        target_year = curr_year
        target_week = curr_week
        week_start = datetime.fromisocalendar(target_year, target_week, 1).date()

    week_end = week_start + timedelta(days=6)
    curr_monday = datetime.fromisocalendar(curr_year, curr_week, 1).date()

    available_weeks = []
    for offset in range(-(num_weeks - 1), 1):
        monday = curr_monday + timedelta(weeks=offset)
        sunday = monday + timedelta(days=6)
        wy, ww, _ = monday.isocalendar()
        available_weeks.append({
            "key": f"{wy}-W{ww:02d}",
            "year": wy,
            "week": ww,
            "label": f"W{ww:02d}",
            "start_date": monday.isoformat(),
            "end_date": sunday.isoformat(),
            "range_label": f"{monday.day} {_MONTHS_ID_LIST[monday.month - 1]} - {sunday.day} {_MONTHS_ID_LIST[sunday.month - 1]} (Week {ww})",
            "is_current": (wy == curr_year and ww == curr_week),
        })

    return {
        "key": f"{target_year}-W{target_week:02d}",
        "year": target_year,
        "week": target_week,
        "label": f"W{target_week:02d}",
        "start_date": week_start,
        "end_date": week_end,
        "range_label": f"{week_start.day} {_MONTHS_ID_LIST[week_start.month - 1]} - {week_end.day} {_MONTHS_ID_LIST[week_end.month - 1]} (Week {target_week})",
        "available_weeks": available_weeks,
    }


def _empty_days_skeleton(week_start):
    days = []
    for idx in range(7):
        day_date = week_start + timedelta(days=idx)
        days.append({
            "date": day_date.isoformat(),
            "day_index": idx,
            "day_short": _WEEK_DAY_SHORT[idx],
            "day_full": _WEEK_DAY_FULL[idx],
            "date_label": f"{day_date.day} {_MONTHS_ID_LIST[day_date.month - 1][:3]}",
            "sample_count": 0,
            "suhu_avg": None,
            "suhu_min": None,
            "suhu_max": None,
            "kelembapan_avg": None,
            "kelembapan_min": None,
            "kelembapan_max": None,
            "gas_avg": None,
            "gas_max": None,
            "cahaya_avg": None,
            "cahaya_max": None,
            "ai_score_avg": None,
            "anomaly_count": 0,
            "gas_danger_count": 0,
            "kipas_pct": 0,
            "led_pct": 0,
        })
    return days


def build_weekly_summary_from_rows(rows, incident_rows=None, iso_year=None, iso_week=None, source="memory"):
    """Aggregate raw telemetry & incident records into a structured 7-day weekly report payload."""
    week_meta = resolve_iso_week(iso_year=iso_year, iso_week=iso_week)
    week_start = week_meta["start_date"]
    week_end = week_meta["end_date"]
    days = _empty_days_skeleton(week_start)
    day_lookup = {d["date"]: d for d in days}

    grouped = {d["date"]: [] for d in days}
    for row in rows or []:
        ts_raw = row.get("created_at")
        if isinstance(ts_raw, datetime):
            dt = ts_raw
        elif isinstance(ts_raw, str):
            try:
                dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            except ValueError:
                continue
        else:
            continue
        if dt.tzinfo is not None:
            dt = dt.astimezone()
        dkey = dt.date().isoformat()
        if dkey in grouped:
            grouped[dkey].append((dt, row))

    slot_buckets = {k: [] for k in ("pagi", "siang", "sore", "malam")}
    all_rows_in_week = []

    for dkey, items in grouped.items():
        if not items:
            continue
        day_obj = day_lookup[dkey]
        suhu_vals = []
        hum_vals = []
        gas_vals = []
        cahaya_vals = []
        ai_vals = []
        kipas_on = 0
        led_on = 0
        anomaly_cnt = 0
        gas_danger_cnt = 0

        for dt, r in items:
            all_rows_in_week.append((dt, r))
            try:
                t = float(r.get("suhu", 0))
                h = float(r.get("kelembapan", 0))
                g = int(round(float(r.get("gas", 0))))
                c = int(round(float(r.get("cahaya", 0))))
            except (TypeError, ValueError):
                continue

            suhu_vals.append(t)
            hum_vals.append(h)
            gas_vals.append(g)
            cahaya_vals.append(c)

            ai_raw = r.get("ai_score")
            if ai_raw is not None:
                try:
                    ai_vals.append(float(ai_raw))
                except (TypeError, ValueError):
                    pass

            if str(r.get("ai_status", "")).upper() == "ANOMALI":
                anomaly_cnt += 1
            if g >= 3500:
                gas_danger_cnt += 1
            if str(r.get("kipas", r.get("kipas_status", "OFF"))).upper() == "ON":
                kipas_on += 1
            if str(r.get("led", r.get("led_status", "OFF"))).upper() == "ON":
                led_on += 1

            slot_key = str(r.get("time_slot") or "").lower()
            if slot_key not in slot_buckets:
                mins = dt.hour * 60 + dt.minute
                if 300 <= mins < 660:
                    slot_key = "pagi"
                elif 660 <= mins < 900:
                    slot_key = "siang"
                elif 900 <= mins < 1110:
                    slot_key = "sore"
                else:
                    slot_key = "malam"
            slot_buckets[slot_key].append({"suhu": t, "kelembapan": h, "ai_score": ai_raw})

        n = len(suhu_vals)
        if n > 0:
            day_obj["sample_count"] = n
            day_obj["suhu_avg"] = round(sum(suhu_vals) / n, 1)
            day_obj["suhu_min"] = round(min(suhu_vals), 1)
            day_obj["suhu_max"] = round(max(suhu_vals), 1)
            day_obj["kelembapan_avg"] = round(sum(hum_vals) / n, 1)
            day_obj["kelembapan_min"] = round(min(hum_vals), 1)
            day_obj["kelembapan_max"] = round(max(hum_vals), 1)
            day_obj["gas_avg"] = int(round(sum(gas_vals) / n))
            day_obj["gas_max"] = max(gas_vals)
            day_obj["cahaya_avg"] = int(round(sum(cahaya_vals) / n))
            day_obj["cahaya_max"] = max(cahaya_vals)
            day_obj["ai_score_avg"] = round(sum(ai_vals) / len(ai_vals), 1) if ai_vals else None
            day_obj["anomaly_count"] = anomaly_cnt
            day_obj["gas_danger_count"] = gas_danger_cnt
            day_obj["kipas_pct"] = int(round((kipas_on / n) * 100))
            day_obj["led_pct"] = int(round((led_on / n) * 100))

    incident_gas_total = 0
    incident_ai_total = 0
    for inc in incident_rows or []:
        ts_raw = inc.get("created_at")
        if isinstance(ts_raw, datetime):
            dt = ts_raw
        elif isinstance(ts_raw, str):
            try:
                dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            except ValueError:
                continue
        else:
            continue
        if dt.tzinfo is not None:
            dt = dt.astimezone()
        dkey = dt.date().isoformat()
        if dkey not in day_lookup:
            continue
        ev_type = str(inc.get("event_type", "")).upper()
        if "GAS" in ev_type:
            day_lookup[dkey]["gas_danger_count"] += 1
            incident_gas_total += 1
        elif "ANOMAL" in ev_type:
            day_lookup[dkey]["anomaly_count"] += 1
            incident_ai_total += 1

    populated_days = [d for d in days if d["sample_count"] > 0]
    total_samples = sum(d["sample_count"] for d in populated_days)

    totals = {
        "total_samples": total_samples,
        "days_with_data": len(populated_days),
        "suhu_avg": round(sum(d["suhu_avg"] for d in populated_days) / len(populated_days), 1) if populated_days else None,
        "suhu_min": min(d["suhu_min"] for d in populated_days) if populated_days else None,
        "suhu_max": max(d["suhu_max"] for d in populated_days) if populated_days else None,
        "kelembapan_avg": round(sum(d["kelembapan_avg"] for d in populated_days) / len(populated_days), 1) if populated_days else None,
        "kelembapan_max": max(d["kelembapan_max"] for d in populated_days) if populated_days else None,
        "gas_avg": int(round(sum(d["gas_avg"] for d in populated_days) / len(populated_days))) if populated_days else None,
        "gas_max": max(d["gas_max"] for d in populated_days) if populated_days else None,
        "cahaya_avg": int(round(sum(d["cahaya_avg"] for d in populated_days) / len(populated_days))) if populated_days else None,
        "cahaya_max": max(d["cahaya_max"] for d in populated_days) if populated_days else None,
        "ai_score_avg": (
            round(sum(d["ai_score_avg"] for d in populated_days if d["ai_score_avg"] is not None) /
                  max(1, sum(1 for d in populated_days if d["ai_score_avg"] is not None)), 1)
            if any(d["ai_score_avg"] is not None for d in populated_days)
            else None
        ),
        "kipas_pct_avg": int(round(sum(d["kipas_pct"] for d in populated_days) / len(populated_days))) if populated_days else 0,
        "led_pct_avg": int(round(sum(d["led_pct"] for d in populated_days) / len(populated_days))) if populated_days else 0,
        "gas_incidents": incident_gas_total if incident_rows is not None else sum(d["gas_danger_count"] for d in days),
        "ai_anomalies": incident_ai_total if incident_rows is not None else sum(d["anomaly_count"] for d in days),
    }

    time_slots = {}
    for skey, entries in slot_buckets.items():
        if entries:
            time_slots[skey] = {
                "sample_count": len(entries),
                "suhu_avg": round(sum(e["suhu"] for e in entries) / len(entries), 1),
                "kelembapan_avg": round(sum(e["kelembapan"] for e in entries) / len(entries), 1),
            }
        else:
            time_slots[skey] = {"sample_count": 0, "suhu_avg": None, "kelembapan_avg": None}

    return {
        "status": "OK",
        "source": source,
        "has_data": total_samples > 0,
        "week": {
            "key": week_meta["key"],
            "year": week_meta["year"],
            "week": week_meta["week"],
            "label": week_meta["label"],
            "start_date": week_start.isoformat(),
            "end_date": week_end.isoformat(),
            "range_label": week_meta["range_label"],
        },
        "available_weeks": week_meta["available_weeks"],
        "totals": totals,
        "days": days,
        "time_slots": time_slots,
    }


def get_weekly_summary(iso_year=None, iso_week=None, device_id=DEFAULT_DEVICE_ID):
    """Query weekly telemetry and incidents from PostgreSQL and aggregate per day and time slot."""
    week_meta = resolve_iso_week(iso_year=iso_year, iso_week=iso_week)
    if _db_pool is None:
        return build_weekly_summary_from_rows([], [], iso_year=week_meta["year"], iso_week=week_meta["week"], source="none")

    start_dt = datetime.combine(week_meta["start_date"], datetime.min.time())
    end_dt = datetime.combine(week_meta["end_date"] + timedelta(days=1), datetime.min.time())

    sql_tel = """
    SELECT
        suhu, kelembapan, cahaya, gas,
        led_status, kipas_status, buzzer_status,
        time_slot, ai_score, ai_status, created_at
    FROM sensor_telemetry
    WHERE device_id = %s AND created_at >= %s AND created_at < %s
    ORDER BY created_at ASC;
    """
    sql_inc = """
    SELECT event_type, severity, gas_value, ai_score, created_at
    FROM incident_logs
    WHERE device_id = %s AND created_at >= %s AND created_at < %s
    ORDER BY created_at ASC;
    """
    try:
        with get_cursor(commit=False) as cur:
            cur.execute(sql_tel, (device_id, start_dt, end_dt))
            tel_rows = [dict(r) for r in cur.fetchall()]
            cur.execute(sql_inc, (device_id, start_dt, end_dt))
            inc_rows = [dict(r) for r in cur.fetchall()]
        return build_weekly_summary_from_rows(
            tel_rows,
            inc_rows,
            iso_year=week_meta["year"],
            iso_week=week_meta["week"],
            source="database"
        )
    except Exception as err:
        logger.warning(f"Gagal mengambil rekap mingguan DB: {err}")
        return build_weekly_summary_from_rows([], [], iso_year=week_meta["year"], iso_week=week_meta["week"], source="none")


def export_weekly_summary_csv(summary_payload):
    """Render a 7-day weekly summary dictionary to CSV text."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Hari", "Tanggal", "Sampel", "Suhu Rata2 (C)", "Suhu Min (C)", "Suhu Maks (C)",
        "Kelembapan Rata2 (%)", "Kelembapan Maks (%)", "Gas Rata2 (ADC)", "Gas Maks (ADC)",
        "Cahaya Rata2 (ADC)", "Skor AI (%)", "Anomali AI", "Bahaya Gas", "Kipas Aktif (%)", "Lampu Aktif (%)"
    ])
    for d in summary_payload.get("days", []):
        writer.writerow([
            d.get("day_full"),
            d.get("date"),
            d.get("sample_count"),
            d.get("suhu_avg") if d.get("suhu_avg") is not None else "",
            d.get("suhu_min") if d.get("suhu_min") is not None else "",
            d.get("suhu_max") if d.get("suhu_max") is not None else "",
            d.get("kelembapan_avg") if d.get("kelembapan_avg") is not None else "",
            d.get("kelembapan_max") if d.get("kelembapan_max") is not None else "",
            d.get("gas_avg") if d.get("gas_avg") is not None else "",
            d.get("gas_max") if d.get("gas_max") is not None else "",
            d.get("cahaya_avg") if d.get("cahaya_avg") is not None else "",
            d.get("ai_score_avg") if d.get("ai_score_avg") is not None else "",
            d.get("anomaly_count"),
            d.get("gas_danger_count"),
            d.get("kipas_pct"),
            d.get("led_pct"),
        ])
    return output.getvalue()

