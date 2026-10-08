from machine import Pin, ADC
import dht
import time

dht_sensor = dht.DHT11(Pin(18))

gas = ADC(Pin(32))
gas.atten(ADC.ATTN_11DB)

ldr = ADC(Pin(34))
ldr.atten(ADC.ATTN_11DB)

buzzer = Pin(25, Pin.OUT)
led = Pin(26, Pin.OUT)
relay = Pin(27, Pin.OUT)

GAS_THRESHOLD = 1200
LDR_THRESHOLD = 1000
HUMIDITY_THRESHOLD = 60
FAN_OFF_DELAY = 10000

buzzer.value(1)
led.value(0)
relay.value(0)

suhu = 0
kelembapan = 0
nilai_gas = 0
nilai_ldr = 0

fan_running = False
fan_off_timer = None

last_dht = time.ticks_ms() - 2500
last_print = time.ticks_ms()

while True:
    sekarang = time.ticks_ms()

    if time.ticks_diff(sekarang, last_dht) >= 2500:
        last_dht = sekarang

        try:
            dht_sensor.measure()
            suhu = dht_sensor.temperature()
            kelembapan = dht_sensor.humidity()
        except:
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

    if time.ticks_diff(sekarang, last_print) >= 2000:
        status_gas = "WARNING" if gas_warning else "NORMAL"
        status_cahaya = "GELAP" if nilai_ldr >= LDR_THRESHOLD else "TERANG"
        status_kipas = "ON" if fan_running else "OFF"

        print(
            "TEMP:", suhu,
            "| HUM:", kelembapan,
            "| LIGHT:", nilai_ldr,
            "| GAS:", nilai_gas,
            "|", status_gas,
            "|", status_cahaya,
            "| FAN:", status_kipas
        )

        last_print = sekarang

    time.sleep(0.1)