#!/usr/bin/env bash
set -euo pipefail

# Skrip otomatisasi konfigurasi awal VPS Ubuntu/Debian untuk Smart Kamar Kos
# Target Server: 103.119.237.30 (SSH Port: 20220)

echo "=== [1/4] Memeriksa dan Membuat Swap Space 2 GB ==="
CURRENT_SWAP=$(free -m | awk '/^Swap:/ {print $2}')
if [ "$CURRENT_SWAP" -lt 1024 ]; then
    echo "Swap saat ini (${CURRENT_SWAP} MB) kurang dari 1 GB. Menyiapkan /swapfile 2 GB..."
    if [ -f /swapfile ]; then
        swapoff /swapfile 2>/dev/null || true
        rm -f /swapfile
    fi
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    echo "Swap 2 GB berhasil diaktifkan."
else
    echo "Swap space sudah memadai: ${CURRENT_SWAP} MB."
fi

echo "=== [2/4] Memasang Paket Kebutuhan & Docker ==="
apt-get update -y
apt-get install -y curl ufw git ca-certificates tzdata

# Set timezone VPS ke WIB
timedatectl set-timezone Asia/Jakarta || true

if ! command -v docker &> /dev/null; then
    echo "Memasang Docker engine..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm -f get-docker.sh
fi

systemctl enable --now docker

echo "=== [3/4] Konfigurasi Firewall UFW Secara Aman ==="
# PENTING: Buka port SSH non-standar terlebih dahulu agar koneksi SSH tidak terputus
ufw allow 20220/tcp comment 'SSH Port Custom'
ufw allow 80/tcp comment 'HTTP Dashboard Web'
ufw allow 5000/tcp comment 'HTTP API ESP32'

# Port 5432 (PostgreSQL) sengaja TIDAK dibuka ke publik demi keamanan database
ufw --force enable
ufw status verbose

echo "=== [4/4] Verifikasi Instalasi ==="
docker --version
docker compose version

echo ""
echo "=========================================================="
echo " Konfigurasi sistem VPS berhasil diselesaikan!"
echo " Port 20220 (SSH), 80 (Web), dan 5000 (ESP32) aktif."
echo " Port 5432 PostgreSQL tetap aman tertutup dari internet."
echo "=========================================================="
