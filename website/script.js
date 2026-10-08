// ==========================================================================
// SMART KAMAR KOS - SCRIPT JAVASCRIPT VANILLA
// ==========================================================================

// 1. KONFIGURASI API (Menggunakan origin yang sama dengan server.py)
const API_URL = "/api/data";
const POLLING_INTERVAL = 2000; // Polling data setiap 2 detik
const MAX_HISTORY = 40;        // Maksimal 40 riwayat data untuk grafik

// 2. THRESHOLD SISTEM (Sama dengan konstanta di ESP32)
const GAS_THRESHOLD = 1200;       // Nilai ADC MQ-2: Buzzer ON, Fan ON
const LDR_THRESHOLD = 1000;       // Nilai ADC LDR: Gelap -> LED ON
const HUMIDITY_THRESHOLD = 60;    // Kelembapan %: Fan ON

// 3. STATE APLIKASI
let historyData = [];
let isConnected = false;
let lastSuccessfulTime = null;
let activeMetric = "all";
let isDemoMode = false;
let demoStep = 0;

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

// Inisialisasi Tampilan Sistem
elSysApiUrl.textContent = API_URL;
elSysPollRate.textContent = (POLLING_INTERVAL / 1000).toFixed(1) + " detik";

// Jam Digital Header
function updateClock() {
    const now = new Date();
    elClock.textContent = now.toLocaleTimeString("id-ID", { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================================================
// PENGAMBILAN DATA (FETCH API)
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

// Berhasil Menerima Data dari Server
function handleDataSuccess(data) {
    isConnected = true;
    lastSuccessfulTime = new Date();

    const suhu = Number(data.suhu ?? 0);
    const kelembapan = Number(data.kelembapan ?? 0);
    const cahaya = Number(data.cahaya ?? 0);
    const gas = Number(data.gas ?? 0);

    // Status aktuator diambil LANGSUNG dari data ESP32
    const led = String(data.led ?? "OFF").toUpperCase();
    const buzzer = String(data.buzzer ?? "OFF").toUpperCase();
    const kipas = String(data.kipas ?? "OFF").toUpperCase();

    const normalizedData = {
        time: new Date().toLocaleTimeString("id-ID", { hour12: false }),
        suhu,
        kelembapan,
        cahaya,
        gas,
        led,
        buzzer,
        kipas
    };

    // Simpan riwayat untuk grafik (maksimal 40 data)
    historyData.push(normalizedData);
    if (historyData.length > MAX_HISTORY) {
        historyData.shift();
    }

    // Perbarui Tampilan UI
    updateConnectionUI(true);
    updateSensorCards(normalizedData);
    updateActuatorCards(normalizedData);
    updateAlertBanner(normalizedData);
    updateRoomSummary(normalizedData);
    updateSystemInfo(true);
    drawChart();
}

// Gagal Menghubungi Server
function handleDataError(error) {
    isConnected = false;
    updateConnectionUI(false);
    updateSystemInfo(false, error.message);
    updateAlertBannerOnDisconnect();
    // Data terakhir tetap dipertahankan pada halaman, tidak dihapus
}

// ==========================================================================
// PEMBARUAN TAMPILAN ELEMEN
// ==========================================================================
function updateConnectionUI(online) {
    if (isDemoMode) {
        elConnectionPill.className = "status-pill status-demo";
        elConnectionText.textContent = "Mode Simulasi Demo";
        return;
    }

    if (online) {
        elConnectionPill.className = "status-pill status-connected";
        elConnectionText.textContent = "Terhubung";
    } else {
        elConnectionPill.className = "status-pill status-disconnected";
        elConnectionText.textContent = "Server Terputus";
    }
}

function updateSensorCards(data) {
    // 1. Suhu Ruangan
    elValSuhu.textContent = data.suhu;
    if (data.suhu < 24) {
        elStatusSuhu.textContent = "Dingin";
        elStatusSuhu.className = "sensor-status-badge status-ok";
    } else if (data.suhu <= 32) {
        elStatusSuhu.textContent = "Normal";
        elStatusSuhu.className = "sensor-status-badge status-ok";
    } else {
        elStatusSuhu.textContent = "Hangat";
        elStatusSuhu.className = "sensor-status-badge status-warn";
    }
    const percentSuhu = Math.min(100, Math.max(0, (data.suhu / 50) * 100));
    elMeterSuhu.style.width = `${percentSuhu}%`;
    elMeterSuhu.style.backgroundColor = data.suhu > 32 ? "var(--color-warning)" : "var(--accent-blue)";

    // 2. Kelembapan Udara
    elValKelembapan.textContent = data.kelembapan;
    if (data.kelembapan >= HUMIDITY_THRESHOLD) {
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
    elMeterKelembapan.style.backgroundColor = data.kelembapan >= HUMIDITY_THRESHOLD ? "var(--color-warning)" : "var(--accent-cyan)";

    // 3. Intensitas Cahaya (LDR)
    elValCahaya.textContent = data.cahaya;
    if (data.cahaya >= LDR_THRESHOLD) {
        elStatusCahaya.textContent = "Gelap";
        elStatusCahaya.className = "sensor-status-badge status-dark";
    } else {
        elStatusCahaya.textContent = "Terang";
        elStatusCahaya.className = "sensor-status-badge status-ok";
    }
    const percentCahaya = Math.min(100, Math.max(0, (data.cahaya / 4095) * 100));
    elMeterCahaya.style.width = `${percentCahaya}%`;
    elMeterCahaya.style.backgroundColor = data.cahaya >= LDR_THRESHOLD ? "var(--color-purple)" : "var(--color-warning)";

    // 4. Sensor Gas MQ-2 (Nilai ADC)
    elValGas.textContent = data.gas;
    if (data.gas >= GAS_THRESHOLD) {
        elStatusGas.textContent = "Gas Terdeteksi Tinggi";
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
    elMeterGas.style.backgroundColor = data.gas >= GAS_THRESHOLD ? "var(--color-danger)" : (data.gas >= 900 ? "var(--color-warning)" : "var(--color-success)");
}

function updateActuatorCards(data) {
    // LED Lampu Kamar
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

    // Buzzer Alarm
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

    // Exhaust Fan
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

// Logika Alert Berdasarkan Prioritas
function updateAlertBanner(data) {
    elAlertTime.textContent = data.time;

    // Prioritas 1: Gas Tinggi
    if (data.gas >= GAS_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-danger";
        elAlertIcon.textContent = "🚨";
        elAlertTitle.textContent = "Peringatan: Nilai gas tinggi";
        elAlertMessage.textContent = `Nilai MQ-2 mencapai ${data.gas} ADC (ambang batas >= ${GAS_THRESHOLD}). Buzzer dan exhaust fan aktif.`;
        return;
    }

    // Prioritas 2: Kelembapan Tinggi
    if (data.kelembapan >= HUMIDITY_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.textContent = "💧";
        elAlertTitle.textContent = "Peringatan: Kelembapan tinggi";
        elAlertMessage.textContent = `Kelembapan udara kamar mencapai ${data.kelembapan}% (ambang batas >= ${HUMIDITY_THRESHOLD}%). Exhaust fan aktif untuk membantu ventilasi.`;
        return;
    }

    // Prioritas 3: Exhaust Fan Aktif
    if (data.kipas === "ON") {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.textContent = "🌀";
        elAlertTitle.textContent = "Exhaust fan aktif";
        elAlertMessage.textContent = "Exhaust fan sedang aktif membantu sirkulasi udara kamar.";
        return;
    }

    // Prioritas 4: LED Aktif
    if (data.led === "ON") {
        elAlertBanner.className = "alert-banner alert-normal";
        elAlertIcon.textContent = "💡";
        elAlertTitle.textContent = "Lampu otomatis menyala";
        elAlertMessage.textContent = "Ruangan terdeteksi gelap. Lampu otomatis menyala.";
        return;
    }

    // Prioritas 5: Kondisi Normal
    elAlertBanner.className = "alert-banner alert-normal";
    elAlertIcon.textContent = "🛡️";
    elAlertTitle.textContent = "Kondisi Normal";
    elAlertMessage.textContent = "Kondisi sensor kamar saat ini normal.";
}

function updateAlertBannerOnDisconnect() {
    elAlertBanner.className = "alert-banner alert-disconnected";
    elAlertIcon.textContent = "⚠️";
    elAlertTitle.textContent = "Server Terputus";
    const lastTimeStr = lastSuccessfulTime ? lastSuccessfulTime.toLocaleTimeString("id-ID") : "Belum ada";
    elAlertMessage.textContent = `Gagal mengambil data dari ${API_URL}. Menampilkan data terakhir yang tersimpan (${lastTimeStr}).`;
}

// Logika Ringkasan Kondisi Kamar
function updateRoomSummary(data) {
    const details = [];
    let leadSentence = "";

    if (data.gas >= GAS_THRESHOLD) {
        elSummaryBadge.textContent = "Gas Tinggi";
        elSummaryBadge.style.color = "var(--color-danger)";
        leadSentence = "Nilai sensor gas sedang tinggi. Buzzer dan exhaust fan aktif.";
        details.push({ icon: "🚨", text: `Nilai MQ-2: ${data.gas} ADC (ambang batas: ${GAS_THRESHOLD}). Buzzer alarm aktif dan exhaust fan menyala.` });
    } else if (data.kelembapan >= HUMIDITY_THRESHOLD) {
        elSummaryBadge.textContent = "Lembap";
        elSummaryBadge.style.color = "var(--color-warning)";
        leadSentence = "Ruangan sedang lembap. Exhaust fan aktif untuk membantu ventilasi.";
        details.push({ icon: "💧", text: `Kelembapan kamar mencapai ${data.kelembapan}% (ambang batas: ${HUMIDITY_THRESHOLD}%). Exhaust fan menyala.` });
    } else if (data.cahaya >= LDR_THRESHOLD) {
        elSummaryBadge.textContent = "Gelap";
        elSummaryBadge.style.color = "var(--color-purple)";
        leadSentence = "Ruangan sedang gelap. Lampu otomatis menyala.";
        details.push({ icon: "🌙", text: `Nilai LDR: ${data.cahaya} ADC (kondisi gelap). LED menyala otomatis.` });
    } else {
        elSummaryBadge.textContent = "Normal";
        elSummaryBadge.style.color = "var(--color-success)";
        leadSentence = "Kondisi sensor kamar saat ini normal.";
        details.push({ icon: "✅", text: "Nilai gas, kelembapan, dan cahaya berada dalam rentang normal." });
    }

    details.push({ icon: "🌡️", text: `Suhu ruangan terpantau ${data.suhu}°C.` });
    details.push({ icon: "⚙️", text: `Status aktuator: LED ${data.led}, Buzzer ${data.buzzer}, Exhaust Fan ${data.kipas}.` });

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
        elSysServerStatus.textContent = "Mode Simulasi Demo";
        elSysEspStatus.textContent = "Simulasi Sensor Aktif";
        elSysLastUpdate.textContent = new Date().toLocaleTimeString("id-ID");
        return;
    }

    if (success) {
        elSysServerStatus.textContent = "Terhubung (200 OK)";
        elSysEspStatus.textContent = "Data Terkini";
        elSysLastUpdate.textContent = lastSuccessfulTime ? lastSuccessfulTime.toLocaleTimeString("id-ID") : "-";
    } else {
        elSysServerStatus.textContent = `Terputus: ${errText || "Offline"}`;
        elSysEspStatus.textContent = "Menunggu Server";
    }
}

// ==========================================================================
// GRAFIK MONITORING (HTML5 CANVAS VANILLA)
// ==========================================================================
function setupCanvasResolution() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

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

    // Grid Horizontal
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

    let minY = 0;
    let maxY = 100;
    let unitLabel = "%";

    if (activeMetric === "suhu") {
        minY = 15; maxY = 45; unitLabel = "°C";
    } else if (activeMetric === "kelembapan") {
        minY = 20; maxY = 100; unitLabel = "%";
    } else if (activeMetric === "gas") {
        minY = 200; maxY = 2200; unitLabel = "";
    } else if (activeMetric === "cahaya") {
        minY = 0; maxY = 4095; unitLabel = "";
    }

    // Label Y
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "right";
    for (let i = 0; i <= gridLines; i++) {
        const val = maxY - ((maxY - minY) / gridLines) * i;
        const y = padding.top + (chartH / gridLines) * i + 4;
        ctx.fillText(Math.round(val) + unitLabel, padding.left - 8, y);
    }

    // Garis Batas Ambang Putus-putus
    if (activeMetric === "gas") {
        drawThresholdLine(GAS_THRESHOLD, minY, maxY, padding, chartW, chartH, "#ef4444", "Ambang Gas (1200)");
    } else if (activeMetric === "kelembapan") {
        drawThresholdLine(HUMIDITY_THRESHOLD, minY, maxY, padding, chartW, chartH, "#f59e0b", "Ambang Kipas ON (60%)");
    } else if (activeMetric === "cahaya") {
        drawThresholdLine(LDR_THRESHOLD, minY, maxY, padding, chartW, chartH, "#a855f7", "Ambang Gelap (1000)");
    }

    const getX = (index) => padding.left + (index / (historyData.length - 1)) * chartW;
    const getY = (val) => {
        const clamped = Math.max(minY, Math.min(maxY, val));
        return padding.top + chartH - ((clamped - minY) / (maxY - minY)) * chartH;
    };

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

    // Label Waktu X
    if (historyData.length > 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "left";
        ctx.fillText(historyData[0].time, padding.left, height - 10);
        ctx.textAlign = "right";
        ctx.fillText(historyData[historyData.length - 1].time, width - padding.right, height - 10);
    }
}

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

    const lastIdx = values.length - 1;
    ctx.beginPath();
    ctx.arc(getX(lastIdx), getY(values[lastIdx]), 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
}

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
// SIMULASI DEMO (UNTUK PRESENTASI OFFLINE)
// ==========================================================================
function generateDemoData() {
    demoStep++;
    const baseSuhu = 28 + Math.sin(demoStep * 0.2) * 2;
    const baseKelembapan = 52 + Math.sin(demoStep * 0.15) * 12;
    const baseCahaya = 850 + Math.sin(demoStep * 0.1) * 350;
    const baseGas = 950 + (demoStep % 18 > 13 ? 320 : 0) + Math.random() * 40;

    const mockSuhu = Math.round(baseSuhu);
    const mockKelembapan = Math.round(baseKelembapan);
    const mockCahaya = Math.round(baseCahaya);
    const mockGas = Math.round(baseGas);

    // Pada mode demo, simulasikan status aktuator sesuai perilaku ESP32
    handleDataSuccess({
        suhu: mockSuhu,
        kelembapan: mockKelembapan,
        cahaya: mockCahaya,
        gas: mockGas,
        led: mockCahaya >= LDR_THRESHOLD ? "ON" : "OFF",
        buzzer: mockGas >= GAS_THRESHOLD ? "ON" : "OFF",
        kipas: (mockGas >= GAS_THRESHOLD || mockKelembapan >= HUMIDITY_THRESHOLD) ? "ON" : "OFF"
    });
}

// ==========================================================================
// EVENT LISTENERS & INISIALISASI
// ==========================================================================
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeMetric = btn.dataset.metric;
        drawChart();
    });
});

elBtnRefresh.addEventListener("click", () => {
    fetchSensorData();
});

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

window.addEventListener("resize", () => {
    drawChart();
});

// Mulai Polling Data
fetchSensorData();
setInterval(fetchSensorData, POLLING_INTERVAL);
