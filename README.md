# Smart Kamar Kos

> Sistem IoT untuk memantau kondisi kamar kos dan mengendalikan perangkat secara otomatis menggunakan ESP32 dan dashboard berbasis web.

---

## Deskripsi Project

**Smart Kamar Kos** adalah project Internet of Things (IoT) yang dibuat untuk membantu penghuni kamar kos memantau kondisi lingkungan ruangan secara real-time sekaligus melakukan otomatisasi perangkat elektronik.

Pada project ini:
- **ESP32** berfungsi sebagai mikrokontroler utama yang membaca data dari berbagai sensor dan mengendalikan perangkat aktuator secara otomatis.
- Data pembacaan sensor dikirimkan dari ESP32 ke komputer melalui jaringan **Wi-Fi** menggunakan protokol HTTP.
- Komputer menjalankan program backend sederhana (`server.py`) yang bertugas menerima data dari ESP32 dan menyediakan antarmuka API.
- Pengguna dapat memantau seluruh parameter kamar (suhu, kelembapan, cahaya, dan gas) melalui **dashboard website** yang responsif dan interaktif.
- Sistem secara mandiri melakukan otomasi seperti menyalakan lampu saat gelap, mengaktifkan alarm saat mendeteksi gas, dan menyalakan exhaust fan saat ruangan lembap atau berasap.

---

## Fitur

- **Monitoring Suhu Ruangan**: Membaca suhu lingkungan kamar kos secara berkala menggunakan sensor DHT11.
- **Monitoring Kelembapan Udara**: Memantau tingkat kelembapan udara untuk mencegah ruangan terasa pengap.
- **Monitoring Intensitas Cahaya**: Membaca kondisi terang atau gelapnya kamar menggunakan sensor LDR.
- **Monitoring Sensor Gas (MQ-2)**: Mendeteksi indikasi gas atau asap di sekitar kamar.
- **Lampu/LED Otomatis**: Menyalakan LED secara otomatis ketika intensitas cahaya ruangan terdeteksi gelap.
- **Alarm Buzzer Keamanan**: Membunyikan buzzer sebagai peringatan bahaya saat konsentrasi gas melewati ambang batas aman.
- **Exhaust Fan Otomatis**: Menyalakan kipas pembuang udara secara otomatis jika kadar gas tinggi atau kelembapan udara tinggi.
- **Delay Timer Kipas (10 Detik)**: Kipas tidak langsung mati ketika udara mulai membaik, melainkan tetap berputar selama 10 detik untuk memastikan sirkulasi udara bersih sebelum padam.
- **Dashboard Web Modern**: Menampilkan seluruh data metrik sensor dan status aktuator dalam kartu monitoring yang jelas.
- **Grafik Tren Sensor Real-Time**: Visualisasi data historis sensor menggunakan HTML5 Canvas dengan pilihan tab sensor (Suhu, Kelembapan, Gas, Cahaya).
- **Indikator Status Koneksi**: Menampilkan status keterhubungan sistem antara dashboard, server, dan ESP32.
- **Mode Demo / Simulasi**: Fitur bawaan pada website untuk mensimulasikan pergerakan data sensor saat perangkat keras sedang offline (sangat berguna untuk presentasi di kelas).

---

## Arsitektur Sistem

Alur interaksi sistem digambarkan dalam bagan berikut:

```text
+-----------------------+
|         ESP32         |
|  - Baca DHT11, LDR,   |
|    dan MQ-2           |
|  - Logika aktuator    |
|    (LED, Buzzer, Fan) |
+-----------------------+
            |
            | Wi-Fi (HTTP POST /data)
            v
+-----------------------+
|       server.py       |
|  - Python HTTP Server |
|  - Simpan data sensor |
|  - Sediakan API data  |
+-----------------------+
            |
            | HTTP GET /api/data
            v
+-----------------------+
|   Dashboard Website   |
|  - HTML, CSS, JS      |
|  - Kartu & Grafik     |
|  - Alert peringatan   |
+-----------------------+
```

Peran komponen sistem:
1. **ESP32**: Membaca data fisik dari sensor lingkungan, mengeksekusi logika aktuator, dan mengirimkan payload data ke komputer melalui koneksi Wi-Fi.
2. **server.py**: Menerima request data dari ESP32, menyimpan status sensor terakhir di memori, dan melayani endpoint data untuk website.
3. **Dashboard Website**: Melakukan polling berkala ke server untuk menampilkan visual data sensor, status terkini aktuator, notifikasi bahaya, dan kesimpulan otomatis kondisi kamar.

---

## Komponen yang Digunakan

### Hardware

| Komponen | Fungsi |
|---|---|
| ESP32 Development Board | Mikrokontroler utama pemroses logika dan modul Wi-Fi |
| Sensor DHT11 | Mengukur suhu (°C) dan kelembapan udara (%) |
| Sensor Gas MQ-2 | Mendeteksi keberadaan gas atau asap (pembacaan analog) |
| Sensor LDR (Photoresistor) | Mendeteksi intensitas cahaya ruangan (pembacaan analog) |
| Buzzer Module | Menghasilkan bunyi alarm peringatan saat gas berbahaya terdeteksi |
| LED | Indikator penerangan otomatis ketika kamar gelap |
| Relay Module 5V | Sakelar elektronik untuk menyalakan dan mematikan exhaust fan |
| Kipas DC 5V (Exhaust Fan) | Membuang udara pengap atau gas dan menjaga sirkulasi kamar |
| Resistor untuk LED | Pembatas arus listrik pengaman komponen LED |
| Breadboard | Papan penghubung rangkaian prototipe |
| Kabel Jumper | Menghubungkan pin mikrokontroler dengan modul sensor/aktuator |
| Kabel USB | Mengunggah program dan memberikan daya ke ESP32 |

---

## Konfigurasi Pin ESP32

Konfigurasi pin yang digunakan pada mikrokontroler ESP32:

| Komponen | Pin ESP32 | Keterangan |
|---|---:|---|
| DHT11 DATA | GPIO 18 | Pin data sensor suhu dan kelembapan |
| MQ-2 AO | GPIO 32 | Pin analog input pembacaan nilai gas |
| LDR AO | GPIO 34 | Pin analog input pembacaan nilai cahaya |
| Buzzer I/O | GPIO 25 | Pin output kendali alarm buzzer |
| LED | GPIO 26 | Pin output kendali lampu LED otomatis |
| Relay IN | GPIO 27 | Pin output kendali relay kipas exhaust |

> **Catatan Pin Analog**:
> Pin **AO** (Analog Output) pada modul MQ-2 dan LDR dihubungkan ke pin ADC ESP32 (GPIO 32 dan GPIO 34 dengan atenuasi `ADC.ATTN_11DB`) untuk mendapatkan rentang pembacaan nilai analog 0–4095. Pin digital (DO) pada kedua sensor tidak digunakan dalam sistem ini.

---

## Logika Otomatisasi

Sistem bekerja berdasarkan nilai ambang batas (*threshold*) yang telah ditentukan di dalam program:

- **Threshold Gas**: `1200` (nilai ADC)
- **Threshold Cahaya**: `1800` (nilai ADC)
- **Threshold Kelembapan**: `60%`

### 1. Sensor Gas (MQ-2)
- Jika nilai sensor gas **$\ge$ 1200**:
  - Buzzer aktif (berbunyi nyaring).
  - Exhaust fan langsung aktif berputar untuk membuang gas keluar ruangan.
- Jika nilai sensor gas **< 1200**:
  - Buzzer mati (kembali hening).

### 2. Sensor Kelembapan (DHT11)
- Jika kelembapan **$\ge$ 60%**:
  - Exhaust fan aktif berputar untuk mengurangi kelembapan dan mencegah jamur di dalam kamar.
- Jika kelembapan **< 60%**:
  - Sistem tidak langsung mematikan kipas, melainkan memulai hitung mundur (*delay*) pemadaman kipas.

### 3. Exhaust Fan (Relay)
Exhaust fan memiliki dua kondisi pemicu:
$$\text{Kipas ON} \iff (\text{Gas} \ge 1200) \lor (\text{Kelembapan} \ge 60\%)$$

- **Fitur Delay 10 Detik**: Ketika gas sudah normal dan kelembapan sudah di bawah 60%, kipas tetap menyala selama **10 detik (10.000 ms)**. Setelah durasi 10 detik terpenuhi tanpa ada kenaikan gas/kelembapan, barulah kipas dimatikan.
- Jika sebelum 10 detik berakhir nilai gas kembali $\ge$ 1200 atau kelembapan kembali $\ge$ 60%, timer pemadaman dibatalkan dan kipas terus menyala.

### 4. Sensor Cahaya (LDR)
- Jika nilai LDR **$\ge$ 1800**:
  - Ruangan dinyatakan **GELAP**.
  - LED menyala secara otomatis untuk memberikan penerangan.
- Jika nilai LDR **< 1800**:
  - Ruangan dinyatakan **TERANG**.
  - LED dimatikan untuk menghemat energi.

---

## Teknologi yang Digunakan

| Teknologi | Penggunaan |
|---|---|
| **MicroPython** | Bahasa pemrograman pada board ESP32 |
| **Python 3** (`http.server`) | Backend server lokal di komputer |
| **HTML5** | Struktur tampilan antarmuka dashboard |
| **CSS3** | Penataan gaya modern, tema gelap, dan animasi perangkat |
| **JavaScript (Vanilla)** | Logika interaktif, pengambilan data, dan render grafik Canvas |
| **HTTP / JSON** | Protokol dan format pertukaran data antar perangkat |

---

## Struktur Repository

```text
smart-kamar-kos/
├── esp32/
│   └── main.py       # Program utama MicroPython pada ESP32
│
└── website/
    ├── index.html    # Struktur halaman dashboard monitoring
    ├── style.css     # Styling tampilan antarmuka (CSS modern)
    ├── script.js     # Logika pengambilan data dan grafik Canvas
    └── server.py     # Server lokal perantara data ESP32 dan website
```

### Penjelasan File
- `esp32/main.py`: Program utama yang berjalan di mikrokontroler ESP32. Bertanggung jawab membaca sensor DHT11, MQ-2, LDR, memproses logika kendali output, mengontrol pin LED, buzzer, dan relay, serta mengirim data melalui Wi-Fi.
- `website/server.py`: Server HTTP lokal berbasis pustaka standar Python (`http.server`). Berfungsi menerima payload data sensor dari ESP32 dan menyediakan data tersebut ke website.
- `website/index.html`: File halaman antarmuka dashboard monitoring yang menampilkan kartu status sensor, indikator output aktuator, riwayat grafik, dan panel status koneksi.
- `website/style.css`: File CSS murni yang memberikan tampilan antarmuka modern dengan skema warna gelap, kartu informasi responsif, serta animasi putaran kipas dan kedipan alarm.
- `website/script.js`: Skrip JavaScript murni yang melakukan polling data ke server secara berkala, memperbarui elemen kartu di layar, membuat narasi kesimpulan kondisi kamar otomatis, dan menggambar grafik pada HTML5 Canvas.

---

## Alur Data

1. Sensor DHT11, MQ-2, dan LDR membaca kondisi fisik lingkungan kamar kos.
2. ESP32 membaca data sensor setiap siklus program dan memproses logika otomatisasi perangkat.
3. ESP32 langsung mengendalikan pin fisik LED, buzzer, dan relay sesuai kondisi yang terdeteksi.
4. ESP32 mengirim data sensor dalam format JSON ke komputer melalui jaringan Wi-Fi menggunakan metode HTTP POST ke endpoint `/data`.
5. `server.py` yang berjalan di komputer menerima data tersebut dan menyimpannya di memori server.
6. Browser membuka dashboard website, kemudian `script.js` mengambil data sensor terbaru secara berkala (*polling*) menggunakan metode HTTP GET ke endpoint `/api/data`.
7. Dashboard website memperbarui angka metrik, status perangkat, grafik tren sensor, dan status notifikasi secara real-time.

---

## Format Data

Contoh struktur data JSON yang dikirimkan oleh ESP32 ke server:

```json
{
  "suhu": 29,
  "kelembapan": 46,
  "cahaya": 895,
  "gas": 980
}
```

Dashboard website juga dapat menerima dan memproses data yang menyertakan status aktuator secara langsung:

```json
{
  "suhu": 29,
  "kelembapan": 46,
  "cahaya": 895,
  "gas": 980,
  "led": "OFF",
  "buzzer": "OFF",
  "kipas": "OFF"
}
```

---

## API Endpoint

Backend `server.py` menyediakan dua endpoint utama:

| Method | Endpoint | Pengirim | Penerima | Fungsi |
|---|---|---|---|---|
| **POST** | `/data` | ESP32 | `server.py` | Menerima pengiriman data sensor terbaru dari ESP32 |
| **GET** | `/api/data` | Dashboard Web | `server.py` | Mengirim data sensor dan status perangkat terbaru ke browser |

---

## Cara Menjalankan

### 1. Menyiapkan dan Menjalankan ESP32
1. Hubungkan board ESP32 ke komputer menggunakan kabel USB.
2. Buka aplikasi **Thonny IDE** (atau tools MicroPython lainnya).
3. Buka file `esp32/main.py`.
4. Sesuaikan konfigurasi koneksi Wi-Fi dan alamat IP komputer yang menjalankan server:
   ```python
   WIFI_SSID = "NAMA_WIFI"
   WIFI_PASSWORD = "PASSWORD_WIFI"
   SERVER_URL = "http://IP_KOMPUTER:5000/data"
   ```
5. Simpan dan jalankan program pada ESP32.

### 2. Menjalankan Server di Komputer
1. Buka Terminal atau Command Prompt pada komputer.
2. Masuk ke direktori `website`:
   ```bash
   cd website
   ```
3. Jalankan file `server.py`:
   ```bash
   python server.py
   ```
4. Server akan aktif dan menampilkan log:
   ```text
   Server berjalan di port 5000
   ```

### 3. Membuka Dashboard Website
1. Buka aplikasi browser modern (Google Chrome, Mozilla Firefox, atau Microsoft Edge).
2. Kunjungi alamat:
   ```text
   http://localhost:5000
   ```
3. Dashboard akan mulai memantau dan menampilkan data kondisi kamar secara berkala.

---

## Koneksi ESP32 ke Server

- ESP32 dan komputer harus terhubung ke **jaringan Wi-Fi lokal atau hotspot yang sama**.
- Karena ESP32 berkomunikasi menggunakan alamat IP komputer, pastikan untuk mengetahui alamat IP lokal komputer Anda terlebih dahulu (gunakan perintah `ipconfig` pada terminal Windows).
- Alamat target pada ESP32 harus diarahkan ke IP komputer tersebut dengan port `5000`, misalnya `http://192.168.1.15:5000/data`.
- Jika alamat IP komputer berubah karena DHCP Wi-Fi, sesuaikan kembali alamat target pada program ESP32.

---

## Kebutuhan Sistem

- **Hardware**:
  - Modul mikrokontroler ESP32
  - Sensor DHT11, MQ-2, dan LDR
  - Modul Buzzer, LED, Modul Relay 5V, dan Kipas DC 5V
  - Breadboard, kabel jumper, resistor penahan, dan kabel USB
- **Software**:
  - Firmware MicroPython terpasang pada ESP32
  - Thonny IDE untuk mengunggah program ke ESP32
  - Python versi 3.x terinstal di komputer/laptop
  - Web browser modern

---

## Catatan Nilai Threshold

Nilai ambang batas yang digunakan dalam kode program:
```python
GAS_THRESHOLD = 1200
LDR_THRESHOLD = 1800
HUMIDITY_THRESHOLD = 60
FAN_OFF_DELAY = 10000  # 10 detik
```

- Nilai ambang batas di atas ditentukan untuk keperluan purwarupa dan simulasi project sekolah.
- Pada penerapan nyata, nilai dapat disesuaikan dengan karakteristik ruangan dan intensitas cahaya kamar masing-masing.
- **Penting mengenai Sensor MQ-2**: Nilai `1200` pada MQ-2 merupakan nilai mentah pembacaan ADC (rentang 0–4095), **bukan nilai konsentrasi ppm**, karena modul sensor ini belum melalui kalibrasi laboratorium gas spesifik.

---

## Troubleshooting

- **Website menampilkan status "ESP32 / Server Terputus":**
  - Pastikan terminal yang menjalankan `python server.py` masih aktif dan tidak ditutup.
  - Periksa apakah URL endpoint pada baris atas `script.js` sudah sesuai (`http://localhost:5000/api/data`).
- **ESP32 tidak dapat mengirim data ke server:**
  - Pastikan ESP32 dan laptop/komputer terhubung ke Wi-Fi yang sama.
  - Periksa alamat IP komputer dengan perintah `ipconfig` dan pastikan firewall Windows mengizinkan lalu lintas masuk pada port 5000.
- **Buzzer langsung berbunyi saat perangkat baru dinyalakan:**
  - Sensor gas MQ-2 membutuhkan waktu pemanasan awal (*pre-heating*) selama beberapa menit saat pertama kali diberi tegangan listrik agar nilai hambatannya stabil.
- **Kipas tidak langsung mati ketika udara sudah normal:**
  - Hal ini normal karena sistem menerapkan fitur delay keamanan 10 detik sebelum relay kipas benar-benar dimatikan.

---

## Status Project

- [x] Pembacaan sensor suhu dan kelembapan (DHT11)
- [x] Pembacaan sensor intensitas cahaya (LDR)
- [x] Pembacaan sensor gas (MQ-2)
- [x] Otomatisasi lampu LED saat ruangan gelap
- [x] Otomatisasi alarm buzzer saat terdeteksi gas
- [x] Otomatisasi exhaust fan dengan logika kombinasi dan delay 10 detik
- [x] Pengiriman data dari ESP32 ke server lokal
- [x] Dashboard monitoring berbasis website (HTML, CSS, JS vanilla)
- [x] Grafik tren data sensor real-time dengan HTML5 Canvas
- [x] Mode simulasi demo untuk presentasi offline

---

## Tujuan Pembelajaran

Project ini dirancang sebagai media pembelajaran terapan untuk siswa dalam menguasai:
1. Konsep dasar sistem Internet of Things (IoT) dari perangkat fisik hingga tampilan antarmuka.
2. Pemrograman mikrokontroler modern menggunakan bahasa MicroPython.
3. Teknik interfacing pembacaan sensor analog (ADC) dan sensor digital.
4. Pengendalian beban aktuator menggunakan modul relay, indikator LED, dan buzzer.
5. Konsep jaringan komputer lokal, komunikasi nirkabel Wi-Fi, dan protokol HTTP/JSON.
6. Pengembangan antarmuka web interaktif tanpa ketergantungan framework (*vanilla web stack*).
7. Integrasi menyeluruh antara perangkat keras (*hardware*) dan perangkat lunak (*software*).

---

## Penutup

**Smart Kamar Kos** adalah project pembelajaran IoT terpadu yang memadukan mikrokontroler ESP32, sensor lingkungan, aktuator otomatis, server lokal Python, dan antarmuka web monitoring. Melalui sistem ini, kondisi kamar kos dapat dipantau dengan mudah dan perangkat penting dapat bekerja secara otomatis untuk menciptakan ruangan yang lebih aman dan nyaman.
