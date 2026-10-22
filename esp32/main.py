from machine import Pin, ADC
import dht
import time
import network
import usocket
import ujson

WIFI_SSID = "NAMA_WIFI"
WIFI_PASSWORD = "PASSWORD_WIFI"
SERVER_URL = "http://IP_KOMPUTER:5000/data"

GAS_THRESHOLD = 2000
LDR_THRESHOLD = 2000
HUMIDITY_THRESHOLD = 60
FAN_OFF_DELAY = 10000

DHT_INTERVAL = 2500
POST_INTERVAL = 2000
WIFI_RETRY_INTERVAL = 10000
SERVER_RETRY_INTERVAL = 10000

dht_sensor = dht.DHT11(Pin(18))

gas = ADC(Pin(32))
gas.atten(ADC.ATTN_11DB)

ldr = ADC(Pin(34))
ldr.atten(ADC.ATTN_11DB)

buzzer = Pin(25, Pin.OUT)
led = Pin(26, Pin.OUT)
relay = Pin(27, Pin.OUT)

buzzer.value(1)
led.value(0)
relay.value(0)

suhu = 0
kelembapan = 0

buzzer_muted = False
fan_running = False
fan_off_timer = None
wifi_logged = False
server_logged = False

last_dht = time.ticks_ms() - DHT_INTERVAL
last_post = time.ticks_ms()
last_wifi_retry = time.ticks_ms()
last_server_retry = time.ticks_ms()

wlan = network.WLAN(network.STA_IF)
wlan.active(True)


def parse_url(url):
    clean = url.replace("http://", "", 1)
    parts = clean.split("/", 1)
    host_port = parts[0].split(":", 1)

    host = host_port[0]
    port = int(host_port[1]) if len(host_port) > 1 else 80
    path = "/" + parts[1] if len(parts) > 1 else "/"

    return host, port, path


SERVER_HOST, SERVER_PORT, SERVER_PATH = parse_url(SERVER_URL)
SERVER_ADDR = None


def connect_wifi():
    if wlan.isconnected():
        return True

    try:
        if not wlan.active():
            wlan.active(True)

        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
    except Exception as e:
        print("Permintaan koneksi Wi-Fi gagal:", e)

    start = time.ticks_ms()

    while not wlan.isconnected():
        if time.ticks_diff(time.ticks_ms(), start) >= 5000:
            print("Wi-Fi belum tersambung; akan dicoba kembali")
            return False

        time.sleep(0.2)

    print("Wi-Fi terhubung:", wlan.ifconfig()[0])
    return True


def resolve_server():
    global SERVER_ADDR

    try:
        result = usocket.getaddrinfo(
            SERVER_HOST,
            SERVER_PORT,
            0,
            usocket.SOCK_STREAM
        )

        SERVER_ADDR = result[0][-1]
        print("Alamat server:", SERVER_ADDR)
        return True

    except Exception as e:
        SERVER_ADDR = None
        print("Gagal mencari alamat server:", e)
        return False


def terapkan_status_mute(response):
    global buzzer_muted

    response_lower = response.lower()

    if b"x-buzzer-mute: 1" in response_lower:
        buzzer_muted = True

    elif b"x-buzzer-mute: 0" in response_lower:
        buzzer_muted = False

    elif b'"buzzer_mute": true' in response_lower or (
        b'"buzzer_mute":true' in response_lower
    ):
        buzzer_muted = True

    elif b'"buzzer_mute": false' in response_lower or (
        b'"buzzer_mute":false' in response_lower
    ):
        buzzer_muted = False


def kirim_data(payload):
    global server_logged, SERVER_ADDR

    if SERVER_ADDR is None:
        return False

    s = None

    try:
        body = ujson.dumps(payload).encode()

        request = (
            "POST {} HTTP/1.0\r\n".format(SERVER_PATH)
            + "Host: {}\r\n".format(SERVER_HOST)
            + "Content-Type: application/json\r\n"
            + "Content-Length: {}\r\n".format(len(body))
            + "Connection: close\r\n"
            + "\r\n"
        ).encode() + body

        s = usocket.socket()
        s.settimeout(2)
        s.connect(SERVER_ADDR)
        s.write(request)

        response = b""

        while len(response) < 1024:
            try:
                chunk = s.recv(256)
            except Exception:
                break

            if not chunk:
                break

            response += chunk
            header_end = response.find(b"\r\n\r\n")

            if header_end >= 0:
                headers = response[:header_end].lower()
                response_body = response[header_end + 4:].lower()

                if (
                    b"x-buzzer-mute:" in headers
                    or b'"buzzer_mute"' in response_body
                ):
                    break

        if (
            response.startswith(b"HTTP/1.0 200")
            or response.startswith(b"HTTP/1.1 200")
        ):
            terapkan_status_mute(response)

            if not server_logged:
                print("Data berhasil diterima server")
                server_logged = True

            return True

        print("Respons server tidak sesuai:", response[:150])
        server_logged = False
        return False

    except Exception as e:
        print("Gagal mengirim data:", e)
        server_logged = False
        return False

    finally:
        if s is not None:
            try:
                s.close()
            except Exception:
                pass


print("===== SMART KAMAR KOS =====")
print("Mode: daya USB eksternal")
print("Threshold gas:", GAS_THRESHOLD, "ADC")
print("Threshold cahaya:", LDR_THRESHOLD, "ADC")
print("Threshold kelembapan:", HUMIDITY_THRESHOLD, "%")

connect_wifi()

while True:
    sekarang = time.ticks_ms()

    if time.ticks_diff(sekarang, last_dht) >= DHT_INTERVAL:
        last_dht = sekarang

        try:
            dht_sensor.measure()
            suhu = dht_sensor.temperature()
            kelembapan = dht_sensor.humidity()
        except Exception as e:
            print("Pembacaan DHT11 gagal:", e)

    nilai_gas = gas.read()
    nilai_ldr = ldr.read()

    gas_warning = nilai_gas >= GAS_THRESHOLD
    udara_lembap = kelembapan >= HUMIDITY_THRESHOLD
    kondisi_fan = gas_warning or udara_lembap

    if not gas_warning:
        buzzer_muted = False
        buzzer.value(1)
    elif buzzer_muted:
        buzzer.value(1)
    else:
        buzzer.value(0)

    if nilai_ldr >= LDR_THRESHOLD:
        led.value(1)
    else:
        led.value(0)

    if kondisi_fan:
        relay.value(1)
        fan_running = True
        fan_off_timer = None

    elif fan_running:
        if fan_off_timer is None:
            fan_off_timer = sekarang

        elif time.ticks_diff(
            sekarang, fan_off_timer
        ) >= FAN_OFF_DELAY:
            relay.value(0)
            fan_running = False
            fan_off_timer = None

    else:
        relay.value(0)

    if time.ticks_diff(sekarang, last_post) >= POST_INTERVAL:
        last_post = sekarang

        if not wlan.isconnected():
            wifi_logged = False
            server_logged = False

            if time.ticks_diff(
                sekarang, last_wifi_retry
            ) >= WIFI_RETRY_INTERVAL:
                last_wifi_retry = sekarang
                connect_wifi()

        else:
            if not wifi_logged:
                print("Wi-Fi terhubung:", wlan.ifconfig()[0])
                wifi_logged = True

            if SERVER_ADDR is None and time.ticks_diff(
                sekarang, last_server_retry
            ) >= SERVER_RETRY_INTERVAL:
                last_server_retry = sekarang
                resolve_server()

            if SERVER_ADDR is not None:
                status_buzzer = (
                    "MUTED"
                    if gas_warning and buzzer_muted
                    else ("ON" if buzzer.value() == 0 else "OFF")
                )

                payload = {
                    "suhu": suhu,
                    "kelembapan": kelembapan,
                    "cahaya": nilai_ldr,
                    "gas": nilai_gas,
                    "led": "ON" if led.value() == 1 else "OFF",
                    "buzzer": status_buzzer,
                    "kipas": "ON" if relay.value() == 1 else "OFF",
                    "buzzer_muted": buzzer_muted
                }

                kirim_data(payload)

    time.sleep(0.05)
