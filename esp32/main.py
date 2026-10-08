from machine import Pin, ADC
import dht
import time
import network
import usocket
import ujson

WIFI_SSID = "NAMA_WIFI"
WIFI_PASSWORD = "PASSWORD_WIFI"
SERVER_URL = "http://IP_KOMPUTER:5000/data"

GAS_THRESHOLD = 1200
LDR_THRESHOLD = 1000
HUMIDITY_THRESHOLD = 60
FAN_OFF_DELAY = 10000

DHT_INTERVAL = 2500
POST_INTERVAL = 2000
WIFI_RETRY_INTERVAL = 10000

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
fan_running = False
fan_off_timer = None
wifi_logged = False

last_dht = time.ticks_ms() - DHT_INTERVAL
last_post = time.ticks_ms()
last_wifi_retry = time.ticks_ms()

wlan = network.WLAN(network.STA_IF)
wlan.active(True)

def connect_wifi():
    global wifi_logged
    try:
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
    except Exception:
        pass
    start = time.ticks_ms()
    while not wlan.isconnected() and time.ticks_diff(time.ticks_ms(), start) < 1000:
        time.sleep(0.1)
    if wlan.isconnected():
        print("Wi-Fi connected:", wlan.ifconfig()[0])
        wifi_logged = True
    else:
        print("Wi-Fi pending...")

connect_wifi()

def parse_url(url):
    clean = url.replace("http://", "")
    parts = clean.split("/", 1)
    host_port = parts[0].split(":")
    host = host_port[0]
    port = int(host_port[1]) if len(host_port) > 1 else 5000
    path = "/" + parts[1] if len(parts) > 1 else "/data"
    return host, port, path

SERVER_HOST, SERVER_PORT, SERVER_PATH = parse_url(SERVER_URL)

def kirim_data(payload):
    s = None
    try:
        body = ujson.dumps(payload)
        addr = usocket.getaddrinfo(SERVER_HOST, SERVER_PORT)[0][-1]
        s = usocket.socket()
        s.settimeout(1.5)
        s.connect(addr)
        req = (
            f"POST {SERVER_PATH} HTTP/1.1\r\n"
            f"Host: {SERVER_HOST}:{SERVER_PORT}\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: close\r\n\r\n"
            f"{body}"
        )
        s.send(req.encode())
        return True
    except Exception as e:
        print("Gagal kirim data:", e)
        return False
    finally:
        if s:
            s.close()

while True:
    sekarang = time.ticks_ms()

    if time.ticks_diff(sekarang, last_dht) >= DHT_INTERVAL:
        last_dht = sekarang
        try:
            dht_sensor.measure()
            suhu = dht_sensor.temperature()
            kelembapan = dht_sensor.humidity()
        except Exception:
            pass

    nilai_gas = gas.read()
    nilai_ldr = ldr.read()

    gas_warning = nilai_gas >= GAS_THRESHOLD
    udara_lembap = kelembapan >= HUMIDITY_THRESHOLD
    kondisi_fan = gas_warning or udara_lembap

    if gas_warning:
        buzzer.value(0)
    else:
        buzzer.value(1)

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
        elif time.ticks_diff(sekarang, fan_off_timer) >= FAN_OFF_DELAY:
            relay.value(0)
            fan_running = False
            fan_off_timer = None
    else:
        relay.value(0)

    if time.ticks_diff(sekarang, last_post) >= POST_INTERVAL:
        last_post = sekarang

        if not wlan.isconnected():
            wifi_logged = False
            if time.ticks_diff(sekarang, last_wifi_retry) >= WIFI_RETRY_INTERVAL:
                last_wifi_retry = sekarang
                try:
                    wlan.connect(WIFI_SSID, WIFI_PASSWORD)
                except Exception:
                    pass
        else:
            if not wifi_logged:
                print("Wi-Fi connected:", wlan.ifconfig()[0])
                wifi_logged = True

            payload = {
                "suhu": suhu,
                "kelembapan": kelembapan,
                "cahaya": nilai_ldr,
                "gas": nilai_gas,
                "led": "ON" if led.value() == 1 else "OFF",
                "buzzer": "ON" if buzzer.value() == 0 else "OFF",
                "kipas": "ON" if relay.value() == 1 else "OFF"
            }
            kirim_data(payload)

    time.sleep(0.05)