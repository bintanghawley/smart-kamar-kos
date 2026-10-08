// ==========================================================================
// SMART KAMAR KOS - SCRIPT JAVASCRIPT VANILLA
// ==========================================================================

// 1. KONFIGURASI API (Ubah URL ini jika port/endpoint server berubah)
const API_URL = "http://localhost:5000/api/data";
const POLLING_INTERVAL = 2000; // Frekuensi pengambilan data (2 detik)
const MAX_HISTORY = 40;        // Batas data historis grafik (30 - 50 data)

// 2. THRESHOLD SISTEM (Sesuai spesifikasi ESP32)
const THRESHOLD_GAS = 1200;        // >= 1200: Buzzer ON, Fan ON
const THRESHOLD_KELEMBAPAN = 60;   // >= 60%: Fan ON
const THRESHOLD_CAHAYA_GELAP = 1000; // >= 1000: Gelap -> LED ON

// 3. STATE APLIKASI
let historyData = [];
let isConnected = false;
let lastSuccessfulTime = null;
let activeMetric = "all";
let isDemoMode = false;
let pollingTimer = null;

// Referensi Elemen DOM
const elClock = document.getElementById("header-clock");
const elConnectionPill = document.getElementById("connection-pill");
const elConnectionText = document.getElementById("connection-text");

const elAlertBanner = document.getElementById("alert-banner");
const elAlertIcon = document.getElementById("alert-icon");
const elAlertTitle = document.getElementById("alert-title");
const elAlertMessage = document.getElementById("alert-message");
const elAlertTime = document.getElementById("alert-time");

const elSummaryBadge = document.getElementById("summary-badge");
const elSummaryLead = document.getElementById("summary-lead");
const elSummaryDetails = document.getElementById("summary-details");

const elValSuhu = document.getElementById("val-suhu");
const elStatusSuhu = document.getElementById("status-suhu");
const elMeterSuhu = document.getElementById("meter-suhu");

const elValKelembapan = document.getElementById("val-kelembapan");
const elStatusKelembapan = document.getElementById("status-kelembapan");
const elMeterKelembapan = document.getElementById("meter-kelembapan");

const elValCahaya = document.getElementById("val-cahaya");
const elStatusCahaya = document.getElementById("status-cahaya");
const elMeterCahaya = document.getElementById("meter-cahaya");

const elValGas = document.getElementById("val-gas");
const elStatusGas = document.getElementById("status-gas");
const elMeterGas = document.getElementById("meter-gas");

const elCardLed = document.getElementById("card-actuator-led");
const elStateLed = document.getElementById("state-text-led");
const elPillLed = document.getElementById("pill-led");

const elCardBuzzer = document.getElementById("card-actuator-buzzer");
const elStateBuzzer = document.getElementById("state-text-buzzer");
const elPillBuzzer = document.getElementById("pill-buzzer");

const elCardKipas = document.getElementById("card-actuator-kipas");
const elStateKipas = document.getElementById("state-text-kipas");
const elPillKipas = document.getElementById("pill-kipas");

const elSysServerStatus = document.getElementById("sys-server-status");
const elSysEspStatus = document.getElementById("sys-esp-status");
const elSysLastUpdate = document.getElementById("sys-last-update");
const elSysApiUrl = document.getElementById("sys-api-url");
const elSysPollRate = document.getElementById("sys-poll-rate");
const elBtnRefresh = document.getElementById("btn-refresh");
const elBtnToggleDemo = document.getElementById("btn-toggle-demo");

const canvas = document.getElementById("monitoring-chart");
const ctx = canvas.getContext("2d");
const elChartCount = document.getElementById("chart-data-count");
const tabButtons = document.querySelectorAll(".chart-tab");

// Inisialisasi Tampilan
elSysApiUrl.textContent = API_URL;
elSysPollRate.textContent = (POLLING_INTERVAL / 1000).toFixed(1) + " detik";

// Jam Digital Header
function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour12: false });
    elClock.textContent = timeStr;
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================================================
// LOGIKA FETCH DATA DARI SERVER
// ==========================================================================
async function fetchSensorData() {
    if (isDemoMode) {
        generateDemoData();
        return;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const response = await fetch(API_URL, {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        handleDataSuccess(data);
    } catch (error) {
        handleDataError(error);
    }
}

// Berhasil menerima data
function handleDataSuccess(data) {
    isConnected = true;
    lastSuccessfulTime = new Date();

    // Normalisasi data sensor
    const suhu = Number(data.suhu ?? 0);
    const kelembapan = Number(data.kelembapan ?? 0);
    const cahaya = Number(data.cahaya ?? 0);
    const gas = Number(data.gas ?? 0);

    // Tentukan status output (Gunakan dari JSON jika ada, atau hitung dengan logika ESP32)
    const ledOn = data.led ? data.led.toUpperCase() === "ON" : (cahaya >= THRESHOLD_CAHAYA_GELAP);
    const buzzerOn = data.buzzer ? data.buzzer.toUpperCase() === "ON" : (gas >= THRESHOLD_GAS);
    const kipasOn = data.kipas ? data.kipas.toUpperCase() === "ON" : (gas >= THRESHOLD_GAS || kelembapan >= THRESHOLD_KELEMBAPAN);

    const normalizedData = {
        time: new Date().toLocaleTimeString("id-ID", { hour12: false }),
        suhu,
        kelembapan,
        cahaya,
        gas,
        led: ledOn ? "ON" : "OFF",
        buzzer: buzzerOn ? "ON" : "OFF",
        kipas: kipasOn ? "ON" : "OFF"
    };

    // Tambah ke riwayat grafik
    historyData.push(normalizedData);
    if (historyData.length > MAX_HISTORY) {
        historyData.shift();
    }

    // Perbarui Komponen UI
    updateConnectionUI(true);
    updateSensorCards(normalizedData);
    updateActuatorCards(normalizedData);
    updateAlertBanner(normalizedData);
    updateRoomSummary(normalizedData);
    updateSystemInfo(true);
    drawChart();
}

// Gagal menghubungi server
function handleDataError(error) {
    isConnected = false;
    updateConnectionUI(false);
    updateSystemInfo(false, error.message);
    updateAlertBannerOnDisconnect();
}

// ==========================================================================
// UPDATE ELEMEN UI
// ==========================================================================
function updateConnectionUI(online) {
    if (isDemoMode) {
        elConnectionPill.className = "status-pill status-demo";
        elConnectionText.textContent = "Mode Simulasi Demo";
        return;
    }

    if (online) {
        elConnectionPill.className = "status-pill status-connected";
        elConnectionText.textContent = "Terhubung ke Server";
    } else {
        elConnectionPill.className = "status-pill status-disconnected";
        elConnectionText.textContent = "ESP32 / Server Terputus";
    }
}

function updateSensorCards(data) {
    // 1. Suhu
    elValSuhu.textContent = data.suhu;
    if (data.suhu < 24) {
        elStatusSuhu.textContent = "Dingin";
        elStatusSuhu.className = "sensor-status-badge status-ok";
    } else if (data.suhu <= 32) {
        elStatusSuhu.textContent = "Normal";
        elStatusSuhu.className = "sensor-status-badge status-ok";
    } else {
        elStatusSuhu.textContent = "Panas";
        elStatusSuhu.className = "sensor-status-badge status-warn";
    }
    const percentSuhu = Math.min(100, Math.max(0, (data.suhu / 50) * 100));
    elMeterSuhu.style.width = `${percentSuhu}%`;
    elMeterSuhu.style.backgroundColor = data.suhu > 32 ? "var(--color-warning)" : "var(--accent-blue)";

    // 2. Kelembapan
    elValKelembapan.textContent = data.kelembapan;
    if (data.kelembapan >= THRESHOLD_KELEMBAPAN) {
        elStatusKelembapan.textContent = "Tinggi (Lembap)";
        elStatusKelembapan.className = "sensor-status-badge status-warn";
    } else if (data.kelembapan < 40) {
        elStatusKelembapan.textContent = "Kering";
        elStatusKelembapan.className = "sensor-status-badge status-ok";
    } else {
        elStatusKelembapan.textContent = "Normal";
        elStatusKelembapan.className = "sensor-status-badge status-ok";
    }
    const percentKelembapan = Math.min(100, Math.max(0, data.kelembapan));
    elMeterKelembapan.style.width = `${percentKelembapan}%`;
    elMeterKelembapan.style.backgroundColor = data.kelembapan >= THRESHOLD_KELEMBAPAN ? "var(--color-warning)" : "var(--accent-cyan)";

    // 3. Cahaya (LDR)
    elValCahaya.textContent = data.cahaya;
    if (data.cahaya >= THRESHOLD_CAHAYA_GELAP) {
        elStatusCahaya.textContent = "Gelap";
        elStatusCahaya.className = "sensor-status-badge status-dark";
    } else {
        elStatusCahaya.textContent = "Terang";
        elStatusCahaya.className = "sensor-status-badge status-ok";
    }
    const percentCahaya = Math.min(100, Math.max(0, (data.cahaya / 4095) * 100));
    elMeterCahaya.style.width = `${percentCahaya}%`;
    elMeterCahaya.style.backgroundColor = data.cahaya >= THRESHOLD_CAHAYA_GELAP ? "var(--color-purple)" : "var(--color-warning)";

    // 4. Gas (MQ-2)
    elValGas.textContent = data.gas;
    if (data.gas >= THRESHOLD_GAS) {
        elStatusGas.textContent = "BAHAYA (Gas Tinggi)";
        elStatusGas.className = "sensor-status-badge status-danger";
    } else if (data.gas >= 900) {
        elStatusGas.textContent = "Waspada";
        elStatusGas.className = "sensor-status-badge status-warn";
    } else {
        elStatusGas.textContent = "Normal";
        elStatusGas.className = "sensor-status-badge status-ok";
    }
    const percentGas = Math.min(100, Math.max(0, (data.gas / 2500) * 100));
    elMeterGas.style.width = `${percentGas}%`;
    elMeterGas.style.backgroundColor = data.gas >= THRESHOLD_GAS ? "var(--color-danger)" : (data.gas >= 900 ? "var(--color-warning)" : "var(--color-success)");
}

function updateActuatorCards(data) {
    // LED
    if (data.led === "ON") {
        elCardLed.classList.add("state-led-on");
        elStateLed.textContent = "ON";
        elPillLed.textContent = "MENYALA";
        elPillLed.className = "output-state-pill pill-on";
    } else {
        elCardLed.classList.remove("state-led-on");
        elStateLed.textContent = "OFF";
        elPillLed.textContent = "PADAM";
        elPillLed.className = "output-state-pill pill-off";
    }

    // Buzzer
    if (data.buzzer === "ON") {
        elCardBuzzer.classList.add("state-buzzer-on");
        elStateBuzzer.textContent = "ON";
        elPillBuzzer.textContent = "BERBUNYI";
        elPillBuzzer.className = "output-state-pill pill-danger-on";
    } else {
        elCardBuzzer.classList.remove("state-buzzer-on");
        elStateBuzzer.textContent = "OFF";
        elPillBuzzer.textContent = "HENING";
        elPillBuzzer.className = "output-state-pill pill-off";
    }

    // Kipas
    if (data.kipas === "ON") {
        elCardKipas.classList.add("state-kipas-on");
        elStateKipas.textContent = "ON";
        elPillKipas.textContent = "BERPUTAR";
        elPillKipas.className = "output-state-pill pill-on";
    } else {
        elCardKipas.classList.remove("state-kipas-on");
        elStateKipas.textContent = "OFF";
        elPillKipas.textContent = "MATI";
        elPillKipas.className = "output-state-pill pill-off";
    }
}

// Alert Visual Berdasarkan Prioritas
function updateAlertBanner(data) {
    const timeNow = data.time;
    elAlertTime.textContent = timeNow;

    // Prioritas 1: Gas Melewati Batas Aman
    if (data.gas >= THRESHOLD_GAS) {
        elAlertBanner.className = "alert-banner alert-danger";
        elAlertIcon.textContent = "🚨";
        elAlertTitle.textContent = "PERINGATAN: KONSENTRASI GAS BERBAHAYA!";
        elAlertMessage.textContent = `Nilai gas mencapai ${data.gas} (>= ${THRESHOLD_GAS}). Buzzer alarm berbunyi dan exhaust fan aktif membuang udara.`;
        return;
    }

    // Prioritas 2: Kelembapan Tinggi
    if (data.kelembapan >= THRESHOLD_KELEMBAPAN) {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.textContent = "💧";
        elAlertTitle.textContent = "PERINGATAN: RUANGAN LEMBAP";
        elAlertMessage.textContent = `Kelembapan udara kamar mencapai ${data.kelembapan}% (>= ${THRESHOLD_KELEMBAPAN}%). Exhaust fan aktif untuk menjaga sirkulasi.`;
        return;
    }

    // Prioritas 3: Output Aktif (misal Kipas masih delay timer atau LED menyala)
    if (data.kipas === "ON") {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.textContent = "🌀";
        elAlertTitle.textContent = "EXHAUST FAN AKTIF";
        elAlertMessage.textContent = "Exhaust fan sedang beroperasi membantu pertukaran udara kamar kos.";
        return;
    }

    if (data.led === "ON") {
        elAlertBanner.className = "alert-banner alert-normal";
        elAlertIcon.textContent = "💡";
        elAlertTitle.textContent = "LAMPU OTOMATIS MENYALA";
        elAlertMessage.textContent = "Kondisi kamar gelap. Sensor LDR mengaktifkan LED kamar secara otomatis.";
        return;
    }

    // Kondisi Normal
    elAlertBanner.className = "alert-banner alert-normal";
    elAlertIcon.textContent = "🛡️";
    elAlertTitle.textContent = "SEMUA SISTEM NORMAL";
    elAlertMessage.textContent = "Parameter suhu, kelembapan, udara, dan pencahayaan kamar dalam kondisi baik.";
}

function updateAlertBannerOnDisconnect() {
    elAlertBanner.className = "alert-banner alert-disconnected";
    elAlertIcon.textContent = "⚠️";
    elAlertTitle.textContent = "ESP32 / SERVER TERPUTUS";
    const lastTimeStr = lastSuccessfulTime ? lastSuccessfulTime.toLocaleTimeString("id-ID") : "Belum ada";
    elAlertMessage.textContent = `Gagal mengambil data dari ${API_URL}. Menampilkan data terakhir yang tersimpan (${lastTimeStr}).`;
}

// Kesimpulan Kondisi Kamar Otomatis
function updateRoomSummary(data) {
    const details = [];
    let leadSentence = "";

    if (data.gas >= THRESHOLD_GAS) {
        elSummaryBadge.textContent = "Bahaya Gas";
        elSummaryBadge.style.color = "var(--color-danger)";
        leadSentence = `Nilai gas meningkat tajam (${data.gas}). Alarm buzzer berbunyi dan exhaust fan diaktifkan untuk segera membuang gas dari kamar.`;
        details.push({ icon: "🚨", text: `Konsentrasi gas (${data.gas}) melebihi ambang aman ${THRESHOLD_GAS}. Periksa kompor, asap, atau kebocoran.` });
    } else if (data.kelembapan >= THRESHOLD_KELEMBAPAN) {
        elSummaryBadge.textContent = "Lembap";
        elSummaryBadge.style.color = "var(--color-warning)";
        leadSentence = `Ruangan sedang lembap (${data.kelembapan}%). Exhaust fan aktif secara otomatis untuk membantu ventilasi udara.`;
        details.push({ icon: "💧", text: `Kelembapan udara di atas 60%. Kipas akan tetap menyala hingga udara kembali kering.` });
    } else {
        elSummaryBadge.textContent = "Nyaman";
        elSummaryBadge.style.color = "var(--color-success)";
        leadSentence = "Udara dan lingkungan kamar kos saat ini dalam kondisi normal dan aman.";
        details.push({ icon: "✅", text: "Kadar gas dalam ambang batas aman dan kelembapan stabil." });
    }

    if (data.cahaya >= THRESHOLD_CAHAYA_GELAP) {
        details.push({ icon: "🌙", text: `Kamar dalam kondisi gelap (${data.cahaya}). Lampu LED otomatis menyala.` });
    } else {
        details.push({ icon: "☀️", text: `Pencahayaan kamar cukup terang (${data.cahaya}). Lampu LED dimatikan untuk menghemat energi.` });
    }

    details.push({ icon: "🌡️", text: `Suhu ruangan terpantau ${data.suhu}°C, masih dalam rentang wajar kamar tidur.` });

    elSummaryLead.textContent = leadSentence;
    elSummaryDetails.innerHTML = details.map(item => `
        <div class="summary-item">
            <span class="summary-item-icon">${item.icon}</span>
            <span>${item.text}</span>
        </div>
    `).join("");
}

function updateSystemInfo(success, errText = "") {
    if (isDemoMode) {
        elSysServerStatus.textContent = "Simulasi Demo (Aktif)";
        elSysEspStatus.textContent = "Simulasi Sensor Aktif";
        elSysLastUpdate.textContent = new Date().toLocaleTimeString("id-ID");
        return;
    }

    if (success) {
        elSysServerStatus.textContent = "200 OK (Terhubung)";
        elSysEspStatus.textContent = "Mengirim Data";
        elSysLastUpdate.textContent = lastSuccessfulTime ? lastSuccessfulTime.toLocaleTimeString("id-ID") : "-";
    } else {
        elSysServerStatus.textContent = `Error: ${errText || "Offline"}`;
        elSysEspStatus.textContent = "Terputus / Menunggu";
    }
}

// ==========================================================================
// GRAFIK MONITORING (HTML5 CANVAS VANILLA)
// ==========================================================================
function setupCanvasResolution() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    // Set actual canvas pixels to match display pixel ratio
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    ctx.resetTransform?.();
    ctx.scale(dpr, dpr);
}

function drawChart() {
    setupCanvasResolution();
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    elChartCount.textContent = `Menampilkan ${historyData.length} data riwayat`;

    // Bersihkan canvas
    ctx.clearRect(0, 0, width, height);

    if (historyData.length < 2) {
        ctx.fillStyle = "#64748b";
        ctx.font = "14px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "center";
        ctx.fillText("Mengumpulkan titik data untuk grafik...", width / 2, height / 2);
        return;
    }

    const padding = { top: 20, right: 20, bottom: 30, left: 45 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Gambar Garis Grid Horizontal
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartH / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
    }

    // Tentukan Skala Sumbu Y berdasarkan tab yang dipilih
    let minY = 0;
    let maxY = 100;
    let unitLabel = "%";

    if (activeMetric === "suhu") {
        minY = 15;
        maxY = 45;
        unitLabel = "°C";
    } else if (activeMetric === "kelembapan") {
        minY = 20;
        maxY = 100;
        unitLabel = "%";
    } else if (activeMetric === "gas") {
        minY = 200;
        maxY = 2200;
        unitLabel = "";
    } else if (activeMetric === "cahaya") {
        minY = 0;
        maxY = 4095;
        unitLabel = "";
    } else {
        // Mode "Semua": Menggunakan normalisasi 0 - 100%
        minY = 0;
        maxY = 100;
        unitLabel = "%";
    }

    // Label Nilai Y
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "right";
    for (let i = 0; i <= gridLines; i++) {
        const val = maxY - ((maxY - minY) / gridLines) * i;
        const y = padding.top + (chartH / gridLines) * i + 4;
        ctx.fillText(Math.round(val) + unitLabel, padding.left - 8, y);
    }

    // Garis Ambang Batas (Threshold) jika pada tab spesifik
    if (activeMetric === "gas") {
        drawThresholdLine(THRESHOLD_GAS, minY, maxY, padding, chartW, chartH, "#ef4444", "Batas Bahaya (1200)");
    } else if (activeMetric === "kelembapan") {
        drawThresholdLine(THRESHOLD_KELEMBAPAN, minY, maxY, padding, chartW, chartH, "#f59e0b", "Batas Kipas ON (60%)");
    } else if (activeMetric === "cahaya") {
        drawThresholdLine(THRESHOLD_CAHAYA_GELAP, minY, maxY, padding, chartW, chartH, "#a855f7", "Batas Gelap (1000)");
    }

    // Fungsi Pembantu Koordinat Titik
    const getX = (index) => padding.left + (index / (historyData.length - 1)) * chartW;
    const getY = (val) => {
        const clamped = Math.max(minY, Math.min(maxY, val));
        return padding.top + chartH - ((clamped - minY) / (maxY - minY)) * chartH;
    };

    // Gambar Garis Data
    if (activeMetric === "all" || activeMetric === "suhu") {
        const values = historyData.map(d => activeMetric === "all" ? (d.suhu / 50) * 100 : d.suhu);
        drawLineSeries(values, "#f97316", getX, getY, activeMetric !== "all");
    }

    if (activeMetric === "all" || activeMetric === "kelembapan") {
        const values = historyData.map(d => d.kelembapan);
        drawLineSeries(values, "#38bdf8", getX, getY, activeMetric !== "all");
    }

    if (activeMetric === "all" || activeMetric === "gas") {
        const values = historyData.map(d => activeMetric === "all" ? (d.gas / 2500) * 100 : d.gas);
        drawLineSeries(values, "#ef4444", getX, getY, activeMetric !== "all");
    }

    if (activeMetric === "all" || activeMetric === "cahaya") {
        const values = historyData.map(d => activeMetric === "all" ? (d.cahaya / 4095) * 100 : d.cahaya);
        drawLineSeries(values, "#eab308", getX, getY, activeMetric !== "all");
    }

    // Label Waktu Awal dan Akhir Sumbu X
    if (historyData.length > 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "left";
        ctx.fillText(historyData[0].time, padding.left, height - 10);
        ctx.textAlign = "right";
        ctx.fillText(historyData[historyData.length - 1].time, width - padding.right, height - 10);
    }
}

// Menggambar satu serial garis
function drawLineSeries(values, color, getX, getY, fillArea = false) {
    if (values.length < 2) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(getX(0), getY(values[0]));

    for (let i = 1; i < values.length; i++) {
        ctx.lineTo(getX(i), getY(values[i]));
    }
    ctx.stroke();

    // Fill area gradient jika mode tunggal
    if (fillArea) {
        const rect = canvas.getBoundingClientRect();
        const bottomY = rect.height - 30;
        ctx.lineTo(getX(values.length - 1), bottomY);
        ctx.lineTo(getX(0), bottomY);
        ctx.closePath();
        
        const gradient = ctx.createLinearGradient(0, 0, 0, bottomY);
        gradient.addColorStop(0, color.replace(")", ", 0.25)").replace("rgb", "rgba"));
        gradient.addColorStop(1, "rgba(0, 0, 0, 0.0)");
        ctx.fillStyle = gradient;
        ctx.fill();
    }

    // Titik terkini
    const lastIdx = values.length - 1;
    const lastX = getX(lastIdx);
    const lastY = getY(values[lastIdx]);

    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
}

// Menggambar garis batas threshold putus-putus
function drawThresholdLine(val, minY, maxY, padding, chartW, chartH, color, label) {
    if (val < minY || val > maxY) return;
    const y = padding.top + chartH - ((val - minY) / (maxY - minY)) * chartH;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = "10px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "left";
    ctx.fillText(`-- ${label}`, padding.left + 8, y - 5);
    ctx.restore();
}

// ==========================================================================
// SIMULASI DEMO (UNTUK PRESENTASI JIKA OFFLINE)
// ==========================================================================
let demoStep = 0;
function generateDemoData() {
    demoStep++;
    // Variasi data realistis
    const baseSuhu = 28 + Math.sin(demoStep * 0.2) * 2;
    const baseKelembapan = 52 + Math.sin(demoStep * 0.15) * 12;
    const baseCahaya = 850 + Math.sin(demoStep * 0.1) * 350;
    const baseGas = 950 + (demoStep % 18 > 13 ? 320 : 0) + Math.random() * 40;

    const mock = {
        suhu: Math.round(baseSuhu),
        kelembapan: Math.round(baseKelembapan),
        cahaya: Math.round(baseCahaya),
        gas: Math.round(baseGas)
    };

    handleDataSuccess(mock);
}

// ==========================================================================
// EVENT LISTENERS & INISIALISASI
// ==========================================================================
// Tab kontrol grafik
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeMetric = btn.dataset.metric;
        drawChart();
    });
});

// Tombol Refresh Manual
elBtnRefresh.addEventListener("click", () => {
    fetchSensorData();
});

// Tombol Mode Demo
elBtnToggleDemo.addEventListener("click", () => {
    isDemoMode = !isDemoMode;
    if (isDemoMode) {
        elBtnToggleDemo.textContent = "Matikan Mode Demo";
        elBtnToggleDemo.classList.add("active");
    } else {
        elBtnToggleDemo.textContent = "Mode Demo / Simulasi Data";
        elBtnToggleDemo.classList.remove("active");
    }
    fetchSensorData();
});

// Responsivitas Canvas saat window resize
window.addEventListener("resize", () => {
    drawChart();
});

// Mulai Polling Terjadwal
fetchSensorData();
pollingTimer = setInterval(fetchSensorData, POLLING_INTERVAL);
