from machine import Pin, ADC
import dht
import time
import network
import gc

# ==============================================================================
# KONFIGURASI WI-FI & SERVER KOMPUTER
# ==============================================================================
# Ganti dengan SSID dan Password Wi-Fi lokal Anda di ESP32 sebelum pengujian
WIFI_SSID = "NAMA_WIFI"
WIFI_PASSWORD = "PASSWORD_WIFI"

# Ganti IP_KOMPUTER dengan alamat IP lokal komputer yang menjalankan server.py
SERVER_URL = "http://IP_KOMPUTER:5000/data"

# ==============================================================================
# KONFIGURASI THRESHOLD SISTEM
# ==============================================================================
GAS_THRESHOLD = 1200        # Nilai ADC MQ-2: Pemicu alarm buzzer & kipas
LDR_THRESHOLD = 1000        # Nilai ADC LDR: Nilai >= 1000 dianggap GELAP -> LED ON
HUMIDITY_THRESHOLD = 60     # Kelembapan %: Pemicu exhaust fan
FAN_OFF_DELAY = 10000       # Jeda delay mati kipas (10 detik / 10.000 ms)

DHT_INTERVAL = 2500         # Interval pembacaan sensor DHT11 (2.5 detik)
POST_INTERVAL = 2000        # Interval pengiriman data ke server (2.0 detik)
WIFI_RETRY_INTERVAL = 10000 # Jeda percobaan reconnect Wi-Fi jika terputus (10 detik)

# ==============================================================================
# INISIALISASI PIN PERANGKAT KERAS
# ==============================================================================
# Sensor DHT11 (Suhu & Kelembapan)
dht_sensor = dht.DHT11(Pin(18))

# Sensor Gas MQ-2 (Analog Input)
gas = ADC(Pin(32))
gas.atten(ADC.ATTN_11DB)

# Sensor Cahaya LDR (Analog Input)
ldr = ADC(Pin(34))
ldr.atten(ADC.ATTN_11DB)

# Aktuator Output
buzzer = Pin(25, Pin.OUT)
led = Pin(26, Pin.OUT)
relay = Pin(27, Pin.OUT)

# Inisialisasi kondisi awal aktuator
# Catatan: Modul buzzer aktif LOW (0 = berbunyi, 1 = hening)
buzzer.value(1)
led.value(0)
relay.value(0)

# Variabel pembacaan sensor
suhu = 0
kelembapan = 0
nilai_gas = 0
nilai_ldr = 0

# State kontrol kipas & delay non-blocking
fan_running = False
fan_off_timer = None

# Timer pembacaan & transmisi
last_dht = time.ticks_ms() - DHT_INTERVAL
last_post = time.ticks_ms()
last_wifi_retry = time.ticks_ms()

# ==============================================================================
# INISIALISASI KONEKSI WI-FI (NON-BLOCKING)
# ==============================================================================
wlan = network.WLAN(network.STA_IF)
wlan.active(True)

def connect_wifi_initial():
    print("Menghubungkan ke Wi-Fi:", WIFI_SSID)
    try:
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
    except Exception as e:
        print("Kesalahan aktivasi Wi-Fi:", e)

    start = time.ticks_ms()
    while not wlan.isconnected() and time.ticks_diff(time.ticks_ms(), start) < 6000:
        time.sleep(0.5)

    if wlan.isconnected():
        print("Wi-Fi Terhubung! IP ESP32:", wlan.ifconfig()[0])
    else:
        print("Wi-Fi belum terhubung saat start. Otomatisasi lokal tetap berjalan.")

connect_wifi_initial()

# ==============================================================================
# FUNGSI PENGIRIMAN DATA HTTP POST
# ==============================================================================
def kirim_ke_server(payload):
    try:
        import ujson
        body = ujson.dumps(payload)

        # 1. Coba gunakan library urequests jika terinstal
        try:
            import urequests
            res = urequests.post(
                SERVER_URL,
                data=body,
                headers={"Content-Type": "application/json"}
            )
            res.close()
            return True
        except ImportError:
            # 2. Fallback menggunakan socket standar bawaan MicroPython
            import usocket
            url = SERVER_URL.replace("http://", "")
            parts = url.split("/", 1)
            host_port = parts[0].split(":")
            host = host_port[0]
            port = int(host_port[1]) if len(host_port) > 1 else 5000
            path = "/" + parts[1] if len(parts) > 1 else "/data"

            addr = usocket.getaddrinfo(host, port)[0][-1]
            s = usocket.socket()
            s.settimeout(2.0)
            s.connect(addr)
            req = (
                f"POST {path} HTTP/1.1\r\n"
                f"Host: {host}:{port}\r\n"
                "Content-Type: application/json\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Connection: close\r\n\r\n"
                f"{body}"
            )
            s.send(req.encode())
            s.close()
            return True
    except Exception as e:
        print("Gagal mengirim data ke server:", e)
        return False
    finally:
        gc.collect()

# ==============================================================================
# LOOP UTAMA SISTEM
# ==============================================================================
print("Sistem Smart Kamar Kos ESP32 Berjalan...")

while True:
    sekarang = time.ticks_ms()

    # 1. Pembacaan DHT11 secara berkala (2.5 detik) tanpa blocking loop utama
    if time.ticks_diff(sekarang, last_dht) >= DHT_INTERVAL:
        last_dht = sekarang
        try:
            dht_sensor.measure()
            suhu = dht_sensor.temperature()
            kelembapan = dht_sensor.humidity()
        except Exception:
            pass

    # 2. Pembacaan Sensor Analog (MQ-2 & LDR)
    nilai_gas = gas.read()
    nilai_ldr = ldr.read()

    # 3. Evaluasi Kondisi Pemicu
    gas_warning = nilai_gas >= GAS_THRESHOLD
    udara_lembap = kelembapan >= HUMIDITY_THRESHOLD
    kondisi_fan = gas_warning or udara_lembap

    # 4. Otomatisasi Buzzer (Aktif jika gas >= 1200)
    if gas_warning:
        buzzer.value(0)  # Buzzer ON
    else:
        buzzer.value(1)  # Buzzer OFF

    # 5. Otomatisasi Lampu LED (Aktif jika ruangan gelap / LDR >= 1000)
    if nilai_ldr >= LDR_THRESHOLD:
        led.value(1)     # LED ON
    else:
        led.value(0)     # LED OFF

    # 6. Otomatisasi Exhaust Fan dengan Delay Non-Blocking 10 Detik
    if kondisi_fan:
        relay.value(1)
        fan_running = True
        fan_off_timer = None  # Batalkan timer mati jika kondisi kembali tinggi
    elif fan_running:
        if fan_off_timer is None:
            # Mulai hitung mundur 10 detik saat kondisi fisik kembali normal
            fan_off_timer = sekarang
        elif time.ticks_diff(sekarang, fan_off_timer) >= FAN_OFF_DELAY:
            # Setelah 10 detik normal terpenuhi, matikan kipas
            relay.value(0)
            fan_running = False
            fan_off_timer = None
    else:
        relay.value(0)

    # 7. Pengiriman Data HTTP & Logging Konsol (Setiap 2.0 Detik)
    if time.ticks_diff(sekarang, last_post) >= POST_INTERVAL:
        last_post = sekarang

        # Baca status fisik aktual aktuator
        status_led = "ON" if led.value() == 1 else "OFF"
        status_buzzer = "ON" if gas_warning else "OFF"
        status_kipas = "ON" if fan_running else "OFF"

        payload = {
            "suhu": suhu,
            "kelembapan": kelembapan,
            "cahaya": nilai_ldr,
            "gas": nilai_gas,
            "led": status_led,
            "buzzer": status_buzzer,
            "kipas": status_kipas
        }

        # Log Serial Monitor untuk pemantauan lokal di Thonny
        print(
            "TEMP:", suhu,
            "| HUM:", kelembapan,
            "| LIGHT:", nilai_ldr,
            "| GAS:", nilai_gas,
            "| LED:", status_led,
            "| BUZZ:", status_buzzer,
            "| FAN:", status_kipas
        )

        # Manajemen Reconnect Wi-Fi jika terputus
        if not wlan.isconnected():
            if time.ticks_diff(sekarang, last_wifi_retry) >= WIFI_RETRY_INTERVAL:
                last_wifi_retry = sekarang
                print("Wi-Fi terputus, mencoba menghubungkan kembali...")
                try:
                    wlan.connect(WIFI_SSID, WIFI_PASSWORD)
                except Exception:
                    pass
        else:
            # Kirim data ke komputer jika Wi-Fi terhubung
            kirim_ke_server(payload)

    # Jeda kecil loop agar CPU ESP32 efisien tanpa mengurangi responsivitas
    time.sleep(0.05)