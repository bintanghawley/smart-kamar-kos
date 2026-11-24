# Panduan Deployment Smart Kamar Kos ke VPS (103.119.237.30)

Panduan ini berisi langkah operasional langkah demi langkah untuk men-deploy aplikasi **Smart Kamar Kos** ke VPS Ubuntu menggunakan Docker & PostgreSQL.

---

## Informasi Server VPS
* **IP VPS:** `103.119.237.30`
* **Port SSH:** `20220` (Bukan port standar 22!)
* **User:** `root`
* **Port Layanan:**
  * Port `80`: Dashboard Web (Akses Browser: `http://103.119.237.30`)
  * Port `5000`: Ingest Data ESP32 (`http://103.119.237.30:5000/data`)
  * Port `5432`: PostgreSQL (Hanya internal Docker / localhost)

---

## Langkah 1: Login ke Server VPS

Gunakan terminal atau PowerShell di komputer lokal:

```bash
ssh -p 20220 root@103.119.237.30
```

---

## Langkah 2: Jalankan Skrip Konfigurasi Awal Sistem

Setelah masuk ke terminal VPS, unduh atau siapkan skrip `setup_vps.sh`:

```bash
# Update sistem dasar dan clone repositori
apt-get update && apt-get install -y git curl

# Clone repositori branch Dev-Cloud
git clone -b Dev-Cloud https://github.com/NamaRepo/smart-kamar-kos.git /root/smart-kamar-kos
cd /root/smart-kamar-kos

# Berikan izin eksekusi dan jalankan setup VPS
chmod +x deploy/setup_vps.sh
./deploy/setup_vps.sh
```

*(Jika mentransfer file langsung dari laptop tanpa git clone, gunakan `rsync` dari laptop):*
```bash
# Jalankan perintah ini dari komputer laptop:
rsync -avz -e "ssh -p 20220" --exclude '.git' --exclude '__pycache__' --exclude '*.docx' ./ root@103.119.237.30:/root/smart-kamar-kos/
```

---

## Langkah 3: Konfigurasi Environment (`.env`)

Salin file contoh `.env.example` menjadi `.env` di direktori proyek VPS:

```bash
cd /root/smart-kamar-kos
cp .env.example .env
nano .env
```

Sesuaikan password database dan parameter:
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
Simpan file dengan menekan `Ctrl + O`, lalu `Enter`, dan keluar dengan `Ctrl + X`.

---

## Langkah 4: Build dan Jalankan Aplikasi dengan Docker Compose

Eksekusi perintah berikut untuk membangun image dan menyalakan kontainer:

```bash
docker compose up -d --build
```

Periksa status kontainer:
```bash
docker compose ps
```
Pastikan `smartkos-postgres` dan `smartkos-app` berstatus `Up (healthy)`.

Melihat log live aplikasi:
```bash
docker compose logs -f app
```

---

## Langkah 5: Verifikasi Hasil Deployment

### 1. Cek Endpoint Healthcheck
Jalankan di terminal VPS:
```bash
curl -s http://127.0.0.1:5000/api/health | jq .
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

### 2. Uji Kirim Data Sensor (Simulasi ESP32)
Kirim paket data uji melalui curl:
```bash
curl -X POST http://127.0.0.1:5000/data \
  -H "Content-Type: application/json" \
  -d '{"suhu":29.5,"kelembapan":55,"cahaya":1200,"gas":450,"led":"OFF","buzzer":"OFF","kipas":"OFF","buzzer_muted":false}'
```
Respon harus berupa: `{"status": "OK", "buzzer_mute": false}`.

Kirim data bahaya gas untuk menguji event logging:
```bash
curl -X POST http://127.0.0.1:5000/data \
  -H "Content-Type: application/json" \
  -d '{"suhu":31.0,"kelembapan":70,"cahaya":1200,"gas":2300,"led":"OFF","buzzer":"ON","kipas":"ON","buzzer_muted":false}'
```

### 3. Cek Isi Tabel Database PostgreSQL
Masuk ke kontainer PostgreSQL dan periksa isi tabel:
```bash
docker compose exec db psql -U smartkos -d smartkos -c "SELECT * FROM devices;"
docker compose exec db psql -U smartkos -d smartkos -c "SELECT id, suhu, gas, ai_status, created_at FROM sensor_telemetry ORDER BY created_at DESC LIMIT 5;"
docker compose exec db psql -U smartkos -d smartkos -c "SELECT id, event_type, severity, description FROM incident_logs ORDER BY created_at DESC LIMIT 5;"
```

### 4. Buka Dashboard di Browser Laptop / HP
Buka alamat berikut di browser:
* **`http://103.119.237.30`** (Port 80 default)
* Pastikan:
  * Tampilan 3D Digital Twin ruangan kamar kos ter-render dengan sempurna.
  * Navigasi sidebar, 4 kartu sensor, Buka/Tutup Atap, dan Auto-Fokus bekerja 100%.
  * Data tren sensor historis muncul otomatis dari PostgreSQL.

---

## Operasi Pemeliharaan & Troubleshooting

### Restart Layanan
```bash
docker compose restart
```

### Rebuild setelah Update Kode
```bash
git pull origin Dev-Cloud
docker compose up -d --build
```

### Backup Database Cepat
```bash
docker compose exec db pg_dump -U smartkos smartkos > /root/backup_smartkos_$(date +%Y%m%d_%H%M%S).sql
```

### Menghentikan Layanan
```bash
docker compose down
```
*(Data PostgreSQL tetap aman tersimpan di volume Docker `pgdata`)*
