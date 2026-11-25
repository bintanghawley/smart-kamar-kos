# Panduan Deployment Smart Kamar Kos ke VPS (skk.kradev.my.id)

Panduan ini berisi langkah operasional untuk men-deploy sistem **Smart Kamar Kos** ke VPS Ubuntu menggunakan **Docker**, **PostgreSQL**, dan **Nginx Reverse Proxy + SSL Let's Encrypt** untuk subdomain **`skk.kradev.my.id`**.

---

## Informasi Arsitektur Server
* **Domain / Subdomain:** `skk.kradev.my.id`
* **IP VPS:** `103.119.237.30`
* **Port SSH:** `20220` (Bukan port standar 22)
* **User:** `root`
* **Alokasi Port & Protokol:**
  * **Port `80` & `443`:** Nginx Reverse Proxy (HTTPS dengan SSL Let's Encrypt untuk dashboard web `https://skk.kradev.my.id`).
  * **Port `5000`:** Ingest Data ESP32 (`http://skk.kradev.my.id:5000/data`) menggunakan HTTP polos agar hemat RAM dan kompatibel dengan MicroPython `usocket`.
  * **Port `5432`:** PostgreSQL Database (Hanya terikat ke localhost `127.0.0.1` dan internal Docker, tidak bisa diakses dari publik).

---

## Langkah 1: Pastikan DNS Record Subdomain Aktif

Pastikan pada DNS manager domain `kradev.my.id` (misal Cloudflare atau DNS Registrar) terdapat record berikut:

| Tipe | Nama Host / Subdomain | Target / IP Value | Proxy Status |
|---|---|---|---|
| **A** | `skk` (atau `skk.kradev.my.id`) | `103.119.237.30` | DNS Only (Grey Cloud jika Cloudflare) |

---

## Langkah 2: Login ke Server VPS

Buka terminal atau PowerShell di komputer Anda:

```bash
ssh -p 20220 root@103.119.237.30
```

---

## Langkah 3: Setup Sistem VPS & Clone Repositori

```bash
# Update dasar dan pasang git curl
apt-get update && apt-get install -y git curl

# Clone repositori branch Dev-Cloud ke folder /root/smart-kamar-kos
git clone -b Dev-Cloud <URL_REPO_GITHUB_ANDA> /root/smart-kamar-kos
cd /root/smart-kamar-kos

# Berikan izin eksekusi dan jalankan skrip setup VPS
chmod +x deploy/setup_vps.sh
./deploy/setup_vps.sh
```

*(Atau jika menggunakan transfer file langsung dari laptop via `rsync`):*
```bash
# Jalankan dari terminal laptop:
rsync -avz -e "ssh -p 20220" --exclude '.git' --exclude '__pycache__' --exclude '*.docx' ./ root@103.119.237.30:/root/smart-kamar-kos/
```

Skrip `setup_vps.sh` secara otomatis:
1. Menyiapkan **Swap 2 GB**.
2. Memasang Docker, Docker Compose, Nginx, dan Certbot.
3. Mengonfigurasi firewall UFW aman (**membuka port 20220 SSH**, 80 HTTP, 443 HTTPS, dan 5000 ESP32).
4. Memasang konfigurasi Nginx untuk `skk.kradev.my.id`.

---

## Langkah 4: Konfigurasi Environment (`.env`)

Salin template variabel lingkungan:

```bash
cd /root/smart-kamar-kos/deploy
cp .env.example .env
nano .env
```

Atur password database yang aman:
```dotenv
POSTGRES_USER=smartkos
POSTGRES_PASSWORD=GantiPasswordKuatIni_UKL2026!
POSTGRES_DB=smartkos
DATABASE_URL=postgresql://smartkos:GantiPasswordKuatIni_UKL2026!@db:5432/smartkos

TZ=Asia/Jakarta
DB_TELEMETRY_INTERVAL_SEC=15
DB_RETENTION_DAYS=30

DEVICE_TOKEN=
DEFAULT_DEVICE_ID=esp32-kamar-01
```
Simpan dengan `Ctrl + O`, `Enter`, lalu keluar dengan `Ctrl + X`.

---

## Langkah 5: Pasang SSL Let's Encrypt (HTTPS Otomatis)

Jalankan perintah Certbot untuk mengamankan subdomain `skk.kradev.my.id`:

```bash
certbot --nginx -d skk.kradev.my.id
```

* Masukkan email untuk pemberitahuan sertifikat.
* Setujui persyaratan (*Agree to terms*).
* Pilih opsi redirect HTTP ke HTTPS jika diminta.

Uji coba reload Nginx:
```bash
nginx -t && systemctl reload nginx
```

---

## Langkah 6: Jalankan Kontainer Docker

Jalankan database PostgreSQL dan backend Python:

```bash
cd /root/smart-kamar-kos/deploy
docker compose up -d --build
```

Periksa status kontainer:
```bash
docker compose ps
```
Pastikan `smartkos-postgres` dan `smartkos-app` berjalan normal (`Up (healthy)`).

Melihat log aplikasi secara langsung:
```bash
docker compose logs -f app
```

---

## Langkah 7: Verifikasi Menyeluruh

### 1. Verifikasi Endpoint Healthcheck (HTTPS)
Uji dari terminal VPS atau laptop:
```bash
curl -I https://skk.kradev.my.id/api/health
curl -s https://skk.kradev.my.id/api/health | jq .
```
Respon normal:
```json
{
  "status": "OK",
  "timezone": "Asia/Jakarta",
  "db_connected": true,
  "telemetry_rows": 0,
  "incident_rows": 0,
  "calibration_rows": 0,
  "esp32_online": false
}
```

### 2. Uji Kirim Data Sensor ESP32 (Port 5000 Plain HTTP)
Simulasikan paket data sensor normal:
```bash
curl -X POST http://skk.kradev.my.id:5000/data \
  -H "Content-Type: application/json" \
  -d '{"suhu":29.5,"kelembapan":55,"cahaya":1200,"gas":450,"led":"OFF","buzzer":"OFF","kipas":"OFF","buzzer_muted":false}'
```
Respon: `{"status": "OK", "buzzer_mute": false}` dan header `X-Buzzer-Mute: 0`.

Simulasikan kondisi gas berbahaya:
```bash
curl -X POST http://skk.kradev.my.id:5000/data \
  -H "Content-Type: application/json" \
  -d '{"suhu":31.0,"kelembapan":70,"cahaya":1200,"gas":2300,"led":"OFF","buzzer":"ON","kipas":"ON","buzzer_muted":false}'
```

### 3. Cek Database PostgreSQL
Periksa baris data yang masuk:
```bash
docker compose exec db psql -U smartkos -d smartkos -c "SELECT id, suhu, gas, ai_status, created_at FROM sensor_telemetry ORDER BY created_at DESC LIMIT 5;"
docker compose exec db psql -U smartkos -d smartkos -c "SELECT id, event_type, severity, description FROM incident_logs ORDER BY created_at DESC LIMIT 5;"
```

### 4. Buka Dashboard Web
Buka di browser:
* **`https://skk.kradev.my.id`**
* Seluruh visual 3D Digital Twin, navigasi, 4 kartu sensor, Buka/Tutup Atap, dan Auto-Fokus berjalan di atas koneksi HTTPS yang aman dan terenkripsi.

---

## Pemeliharaan & Operasional

### Pembaruan Kode
```bash
cd /root/smart-kamar-kos
git pull origin main
cd deploy
docker compose up -d --build
```

### Backup Database
```bash
cd /root/smart-kamar-kos/deploy
docker compose exec db pg_dump -U smartkos smartkos > /root/backup_smartkos_$(date +%Y%m%d_%H%M%S).sql
```

### Restart Layanan
```bash
cd /root/smart-kamar-kos/deploy
docker compose restart
systemctl reload nginx
```
