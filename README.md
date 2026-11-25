# Smart Kamar Kos

> Sistem IoT terpadu untuk memantau kondisi kamar kos, mengendalikan perangkat secara otomatis, visualisasi 3D Digital Twin interaktif, deteksi anomali AI, serta pencatatan telemetri berbasis PostgreSQL dan Docker.

---

## Deskripsi Project

**Smart Kamar Kos** adalah project Internet of Things (IoT) yang dibuat untuk membantu penghuni kamar kos memantau kondisi lingkungan ruangan secara real-time sekaligus melakukan otomatisasi perangkat elektronik.

Pada project ini:
- **ESP32** berfungsi sebagai mikrokontroler utama yang membaca data dari berbagai sensor fisik dan mengendalikan perangkat aktuator secara otomatis.
- Data pembacaan sensor dikirimkan dari ESP32 ke backend server melalui jaringan **Wi-Fi** menggunakan protokol HTTP.
- Komputer atau server menjalankan backend (`server.py`) yang bertugas menerima data telemetri, mengevaluasi anomali sensor menggunakan machine learning (*Isolation Forest*), serta mencatat riwayat ke database **PostgreSQL** (dengan *fallback in-memory* otomatis jika database tidak aktif).
- Pengguna dapat memantau seluruh parameter kamar (suhu, kelembapan, cahaya, dan gas) melalui **dashboard web interaktif** yang dilengkapi **3D Digital Twin Kamar Kos 01** (Three.js) untuk visualisasi ruangan tiga dimensi yang imersif.
- Sistem secara mandiri melakukan otomasi cerdas seperti menyalakan lampu saat gelap, mengaktifkan alarm saat mendeteksi gas, dan menyalakan exhaust fan saat ruangan lembap atau berasap dengan proteksi *delay timer*.
- Mendukung pengoperasian lokal (pengujian di laptop/komputer) maupun deployment cloud berbasis **Docker Compose** dan reverse proxy **Nginx + SSL**.

---

## Fitur Utama

- **3D Digital Twin Kamar Kos 01 (Three.js Offline)**: Visualisasi miniatur kamar kos secara 3 dimensi tanpa ketergantungan koneksi internet eksternal (*self-hosted vendor*). Dilengkapi kontrol orbit 360°, tombol toggle buka/tutup atap, animasi fokus kamera ke sensor saat bahaya, dan label hotspot interaktif 2 layer.
- **Monitoring Suhu Ruangan**: Membaca suhu lingkungan kamar kos secara berkala menggunakan sensor DHT11.
- **Monitoring Kelembapan Udara**: Memantau tingkat kelembapan udara untuk mencegah ruangan terasa pengap.
- **Monitoring Intensitas Cahaya**: Membaca kondisi terang atau gelapnya kamar menggunakan sensor LDR analog.
- **Monitoring Sensor Gas (MQ-2)**: Mendeteksi indikasi gas berbahaya atau asap di sekitar ruangan.
- **Lampu/LED Otomatis**: Menyalakan LED secara otomatis ketika intensitas cahaya ruangan terdeteksi gelap.
- **Alarm Buzzer Keamanan**: Membunyikan buzzer sebagai peringatan bahaya saat konsentrasi gas melewati ambang batas aman, dilengkapi fitur *remote mute* dari dashboard dan *auto-rearm*.
- **Exhaust Fan Otomatis**: Menyalakan kipas pembuang udara secara otomatis jika kadar gas tinggi atau kelembapan udara tinggi.
- **Delay Timer Kipas (10 Detik)**: Kipas tidak langsung mati ketika udara mulai membaik, melainkan tetap berputar selama 10 detik untuk memastikan sirkulasi udara bersih sebelum padam.
- **AI Anomaly Detection & Skor Keselarasan Pola**: Analisis pola sensor miniatur kamar secara cerdas berbasis arsitektur *Baseline Adaptive Envelope + Isolation Forest* dengan skor dinamis 0%–100%.
- **Kalibrasi AI 4 Slot Waktu (Pagi, Siang, Sore, Malam)**: Pengambilan 100 sampel saat sensor stabil sesuai waktu ruangan tanpa mengganggu slot waktu lain.
- **Riwayat Telemetri & Log Insiden (PostgreSQL)**: Pencatatan otomatis riwayat sensor, alert bahaya, dan sesi kalibrasi ke PostgreSQL dengan sistem *graceful in-memory fallback* jika dijalankan tanpa database.
- **Ekspor Riwayat ke CSV**: Fitur pengunduhan data riwayat telemetri langsung dari dashboard untuk analisis data lanjutan.
- **Dashboard Web Modern**: Menampilkan seluruh data metrik sensor, status aktuator, panel AI, dan grafik tren historis HTML5 Canvas.
- **Siap Cloud & Docker Compose**: Dilengkapi `Dockerfile`, `docker-compose.yml`, serta panduan dan skrip setup otomatis VPS Ubuntu dengan Nginx Reverse Proxy dan SSL Let's Encrypt.

---

## Arsitektur Sistem

Alur interaksi sistem digambarkan dalam bagan berikut:

```text
+------------------------------------------+
|                  ESP32                   |
|  - Baca DHT11 (GPIO 18), LDR (GPIO 34),  |
|    dan MQ-2 (GPIO 32)                    |
|  - Logika aktuator mandiri               |
|    (LED GPIO 26, Buzzer 25, Kipas 27)    |
+------------------------------------------+
                     |
                     | Wi-Fi (HTTP POST /data)
                     v
+------------------------------------------+
|                server.py                 |
|  - Python HTTP Server (Port 5000)        |
|  - AI Engine (Isolation Forest)          |
|  - Simpan memori status terkini          |
|  - Logika Remote Mute Buzzer             |
+------------------------------------------+
         |                        |
         | (Opsional/Docker)      | HTTP GET/POST API
         v                        v
+------------------+     +----------------------------------+
|    PostgreSQL    |     |        Dashboard Website         |
|  - Riwayat data  |     |  - HTML5, CSS3, JavaScript murni |
|  - Log insiden   |     |  - 3D Digital Twin (Three.js)    |
|  - Sesi kalibrasi|     |  - Grafik Canvas Real-Time       |
+------------------+     |  - Panel AI & Slot Waktu         |
                         +----------------------------------+
```

---

## Komponen Hardware

| Komponen | Fungsi |
|---|---|
| ESP32 Development Board | Mikrokontroler utama pemroses logika dan modul Wi-Fi |
| Sensor DHT11 | Mengukur suhu (°C) dan kelembapan udara (%) |
| Sensor Gas MQ-2 | Mendeteksi keberadaan gas atau asap (pembacaan analog AO) |
| Sensor LDR (Photoresistor) | Mendeteksi intensitas cahaya ruangan (pembacaan analog AO) |
| Buzzer Module | Menghasilkan bunyi alarm peringatan saat gas berbahaya terdeteksi |
| LED | Indikator penerangan otomatis ketika kamar gelap |
| Relay Module 5V | Sakelar elektronik untuk menyalakan dan mematikan exhaust fan |
| Kipas DC 5V (Exhaust Fan) | Membuang udara pengap atau gas dan menjaga sirkulasi kamar |
| Resistor untuk LED | Pembatas arus listrik pengaman komponen LED |
| Breadboard & Kabel Jumper | Papan dan kabel penghubung rangkaian prototipe |
| Kabel USB | Mengunggah program dan memberikan daya ke ESP32 |

---

## Konfigurasi Pin ESP32

| Komponen | Pin ESP32 | Tipe | Keterangan |
|---|---:|---|---|
| DHT11 DATA | GPIO 18 | Digital I/O | Pin data sensor suhu dan kelembapan |
| MQ-2 AO | GPIO 32 | Analog Input (ADC1) | Atenuasi `ADC.ATTN_11DB` (rentang nilai 0–4095) |
| LDR AO | GPIO 34 | Analog Input (ADC1) | Atenuasi `ADC.ATTN_11DB` (rentang nilai 0–4095) |
| Buzzer I/O | GPIO 25 | Digital Output | Kendali alarm buzzer |
| LED | GPIO 26 | Digital Output | Kendali lampu LED otomatis |
| Relay IN | GPIO 27 | Digital Output | Kendali relay exhaust fan |

---

## Logika Otomatisasi

Sistem bekerja berdasarkan nilai ambang batas (*threshold*) yang telah ditentukan di dalam program:

- **Threshold Gas**: `2000` (nilai ADC)
- **Threshold Cahaya**: `2000` (nilai ADC)
- **Threshold Kelembapan**: `60%`
- **Delay Fan**: `10000 ms` (10 detik)

### 1. Sensor Gas (MQ-2)
- Jika nilai sensor gas $\ge$ 2000:
  - Buzzer aktif (berbunyi nyaring).
  - Exhaust fan langsung aktif berputar untuk membuang gas keluar ruangan.
  - **Mute dari Web**: Pengguna dapat mematikan suara buzzer melalui tombol di dashboard website tanpa menghentikan exhaust fan.
  - **Auto-Rearm**: Ketika gas turun ke normal (< 2000) lalu naik kembali $\ge$ 2000, buzzer otomatis kembali bersuara.
- Jika nilai sensor gas < 2000:
  - Buzzer mati (kembali hening) dan status mute disetel ulang (*auto-reset*).

### 2. Sensor Kelembapan (DHT11)
- Jika kelembapan $\ge$ 60%:
  - Exhaust fan aktif berputar untuk mengurangi kelembapan.
- Jika kelembapan < 60%:
  - Sistem memulai hitung mundur (*delay*) pemadaman kipas selama 10 detik.

### 3. Exhaust Fan (Relay)
$$\text{Kipas ON} \iff (\text{Gas} \ge 2000) \lor (\text{Kelembapan} \ge 60\%)$$
- **Fitur Delay 10 Detik**: Ketika kondisi pemicu kembali normal, kipas tetap menyala selama 10 detik untuk memastikan udara telah tersirkulasi dengan baik. Jika sebelum 10 detik berakhir kondisi pemicu kembali muncul, timer dibatalkan dan kipas terus menyala.

### 4. Sensor Cahaya (LDR)
- Jika nilai LDR $\ge$ 2000:
  - Ruangan dinyatakan **GELAP** $\rightarrow$ LED menyala otomatis.
- Jika nilai LDR < 2000:
  - Ruangan dinyatakan **TERANG** $\rightarrow$ LED dimatikan untuk efisiensi energi.

---

## Struktur Direktori Repository

```text
smart-kamar-kos/
├── .dockerignore                 # File yang diabaikan saat build image Docker
├── .env.example                  # Template variabel lingkungan (database, timezone, token)
├── .gitignore                    # Konfigurasi pengabaian Git (cache, venv, database)
├── Dockerfile                    # Image Docker backend Python 3.11-slim
├── docker-compose.yml            # Orkestrasi container PostgreSQL 16 & Server SmartKos
├── requirements.txt              # Dependensi pustaka Python backend
├── README.md                     # Dokumentasi utama project
│
├── deploy/                       # Berkas operasional deployment cloud VPS
│   ├── PANDUAN_DEPLOY_VPS.md     # Panduan langkah demi langkah deploy VPS Ubuntu
│   ├── nginx-skk.kradev.my.id.conf # Konfigurasi VirtualHost Nginx Reverse Proxy
│   └── setup_vps.sh              # Skrip shell otomasi instalasi & konfigurasi VPS
│
├── esp32/                        # Firmware mikrokontroler
│   └── main.py                   # Program MicroPython pada board ESP32
│
└── website/                      # Backend HTTP server dan antarmuka web
    ├── index.html                # Struktur halaman dashboard & 3D canvas
    ├── style.css                 # Penataan gaya modern, tema gelap, & animasi CSS
    ├── script.js                 # Logika polling data, grafik Canvas, & kontrol UI
    ├── room3d.js                 # Engine 3D Digital Twin Three.js (geometri & kamera)
    ├── server.py                 # Backend HTTP server, logika AI, & penyedia REST API
    ├── db.py                     # Modul koneksi PostgreSQL & pencatatan telemetri
    │
    ├── ai/                       # Model machine learning dan dataset kalibrasi
    │   ├── ai_model_default.pkl  # Model AI baseline default kamar kos
    │   ├── ai_model_siang.pkl    # Model AI kalibrasi khusus slot siang
    │   └── dataset_siang.csv     # Dataset sampel sensor slot siang
    │
    └── vendor/                   # Pustaka frontend pihak ketiga (tersimpan lokal)
        └── three/
            ├── three.module.js   # Three.js core library (ES Module)
            ├── OrbitControls.js  # Kontrol interaksi rotasi, pan, & zoom 3D
            └── CSS2DRenderer.js  # Renderer label HTML 2D pada ruang koordinat 3D
```

---

## Daftar Endpoint REST API

Backend `server.py` menyediakan antarmuka API HTTP berikut:

| Method | Endpoint | Pengirim | Fungsi |
|---|---|---|---|
| **POST** | `/data` | ESP32 | Menerima payload telemetri sensor terbaru dari ESP32 |
| **GET** | `/api/data` | Web Dashboard | Mengambil data sensor, status perangkat, dan status AI terkini |
| **POST** | `/api/buzzer/mute` | Web Dashboard | Membisukan bunyi alarm buzzer secara manual |
| **POST** | `/api/buzzer/unmute` | Web Dashboard | Mengaktifkan kembali bunyi alarm buzzer |
| **POST** | `/api/buzzer/toggle` | Web Dashboard | Beralih status mute/unmute buzzer |
| **POST** | `/api/calibration/start` | Web Dashboard | Memulai sesi kalibrasi AI untuk slot waktu tertentu |
| **POST** | `/api/calibration/cancel` | Web Dashboard | Membatalkan sesi kalibrasi AI yang sedang berlangsung |
| **POST** | `/api/calibration/reset` | Web Dashboard | Mereset model kalibrasi AI slot tertentu atau seluruhnya |
| **GET** | `/api/calibration` | Web Dashboard | Mengambil informasi status kalibrasi seluruh 4 slot waktu |
| **GET** | `/api/history` | Web Dashboard | Mengambil riwayat telemetri tersimpan dari database |
| **GET** | `/api/incidents` | Web Dashboard | Mengambil riwayat catatan insiden bahaya dan alert sistem |
| **GET** | `/api/calibration/history` | Web Dashboard | Mengambil log riwayat sesi kalibrasi AI yang pernah dilakukan |
| **GET** | `/api/export/csv` | Browser | Mengunduh file dataset telemetri sensor dalam format CSV |
| **GET** | `/api/health` | Docker / Monitoring | Healthcheck status layanan, keterhubungan database, dan ESP32 |

---

## Panduan Menjalankan Project

### Metode 1: Menjalankan Secara Lokal (Komputer / Laptop)

#### Langkah 1: Pasang Dependensi Python
Buka terminal pada direktori utama project:
```bash
pip install -r requirements.txt
```
*(Catatan: Jika `psycopg2` belum terpasang atau PostgreSQL tidak aktif, server otomatis berjalan dalam mode in-memory tanpa error).*

#### Langkah 2: Jalankan Server Backend
```bash
cd website
python server.py
```
Server akan aktif di port `5000`:
```text
Server aktif pada port 5000
```

#### Langkah 3: Buka Dashboard Website
Buka browser (Google Chrome, Microsoft Edge, atau Mozilla Firefox) dan buka:
```text
http://localhost:5000
```

---

### Metode 2: Menjalankan Menggunakan Docker Compose

Jika Anda ingin menjalankan backend bersama database PostgreSQL secara terisolasi menggunakan Docker:

1. Salin file environment:
   ```bash
   cp .env.example .env
   ```
2. Jalankan container dengan Docker Compose:
   ```bash
   docker compose up -d
   ```
3. Periksa status container:
   ```bash
   docker compose ps
   ```
4. Buka dashboard di browser melalui `http://localhost:5000`.

---

### Metode 3: Deployment ke Cloud VPS

Jika Anda ingin men-deploy sistem ke server VPS Ubuntu dengan domain/subdomain publik dan reverse proxy Nginx + HTTPS SSL, ikuti panduan lengkap pada berkas:
📄 [deploy/PANDUAN_DEPLOY_VPS.md](file:///c:/Users/raffi/OneDrive/Desktop/smart-kamar-kos/deploy/PANDUAN_DEPLOY_VPS.md)

---

### Konfigurasi dan Pengunggahan Firmware ESP32

1. Hubungkan board ESP32 ke laptop/komputer via kabel USB.
2. Buka aplikasi **Thonny IDE** dengan interpreter **MicroPython (ESP32)**.
3. Buka file [esp32/main.py](file:///c:/Users/raffi/OneDrive/Desktop/smart-kamar-kos/esp32/main.py).
4. Sesuaikan konstanta Wi-Fi dan URL server tujuan:
   - **Untuk pengujian lokal di rumah/sekolah (satu Wi-Fi dengan laptop):**
     ```python
     WIFI_SSID = "NAMA_WIFI_ANDA"
     WIFI_PASSWORD = "PASSWORD_WIFI_ANDA"
     SERVER_URL = "http://192.168.1.50:5000/data"  # Ganti dengan IP lokal laptop Anda (cek via 'ipconfig')
     ```
   - **Untuk deployment cloud (VPS publik):**
     ```python
     WIFI_SSID = "NAMA_WIFI_ANDA"
     WIFI_PASSWORD = "PASSWORD_WIFI_ANDA"
     SERVER_URL = "http://skk.kradev.my.id/data"
     ```
5. Simpan file ke board ESP32 (`/main.py`), lalu klik tombol **Run** (F5) pada Thonny IDE.
6. Pantau shell Thonny; ESP32 akan mencetak status koneksi Wi-Fi dan pengiriman payload data secara berkala.

---

## Troubleshooting

- **Website menampilkan status "ESP32 / Server Terputus":**
  - Pastikan program `server.py` atau container Docker masih berjalan aktif.
  - Periksa apakah ESP32 dan laptop berada pada jaringan Wi-Fi/Hotspot yang sama saat pengujian lokal.
  - Pastikan firewall Windows mengizinkan lalu lintas masuk (*inbound*) pada port `5000`.
- **Buzzer langsung berbunyi saat ESP32 pertama kali dinyalakan:**
  - Sensor MQ-2 membutuhkan waktu pemanasan awal (*pre-heating*) selama 1–3 menit saat pertama kali dialiri arus listrik agar pembacaan analognya stabil.
- **Kipas tidak langsung mati saat gas/kelembapan turun:**
  - Hal ini normal karena sistem menerapkan fitur keamanan *delay timer* 10 detik sebelum mematikan relay kipas.
- **Tampilan 3D tidak muncul di browser:**
  - Pastikan browser mendukung WebGL (aktif secara default pada browser modern seperti Chrome, Edge, Safari, dan Firefox).

---

## Lisensi & Kontributor

Project **Smart Kamar Kos** dikembangkan sebagai sarana pembelajaran komprehensif Internet of Things (IoT), pemodelan 3D Digital Twin, serta rekayasa perangkat lunak modern yang menggabungkan perangkat keras mikrokontroler, backend server, dan aplikasi antarmuka web.
