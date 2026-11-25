import os
import csv
import io
import json
import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone

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
