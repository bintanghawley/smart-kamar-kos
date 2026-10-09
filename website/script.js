const API_URL = "/api/data";
const POLLING_INTERVAL = 2000;
const MAX_HISTORY = 40;

const GAS_THRESHOLD = 1200;
const LDR_THRESHOLD = 1000;
const HUMIDITY_THRESHOLD = 60;

let historyData = [];
let isServerConnected = false;
let isEsp32Online = false;
let lastSeenTime = "-";
let activeMetric = "all";

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

const elAiStatusBadge = document.getElementById("ai-status-badge");
const elAiStatusSymbol = document.getElementById("ai-status-symbol");
const elAiStatusTitle = document.getElementById("ai-status-title");
const elAiStatusDescription = document.getElementById("ai-status-description");
const elAiScoreValue = document.getElementById("ai-score-value");
const elAiTrainingSamples = document.getElementById("ai-training-samples");
const elAiModelDate = document.getElementById("ai-model-date");

const elCalibrationStatusBadge = document.getElementById("calibration-status-badge");
const elCalibrationMessage = document.getElementById("calibration-message");
const elCalibrationCount = document.getElementById("calibration-count");
const elCalibrationProgressTrack = document.getElementById("calibration-progress-track");
const elCalibrationProgressFill = document.getElementById("calibration-progress-fill");
const elCalibrationSkipped = document.getElementById("calibration-skipped");
const elCalibrationFinished = document.getElementById("calibration-finished");
const elBtnCalibrationStart = document.getElementById("btn-calibration-start");
const elBtnCalibrationCancel = document.getElementById("btn-calibration-cancel");
let calibrationActionInProgress = false;
let calibrationActionNotice = "";

const canvas = document.getElementById("monitoring-chart");
const ctx = canvas.getContext("2d");
const elChartCount = document.getElementById("chart-data-count");
const tabButtons = document.querySelectorAll(".chart-tab");

elSysApiUrl.textContent = API_URL;
elSysPollRate.textContent = (POLLING_INTERVAL / 1000).toFixed(1) + " detik";

function updateClock() {
    const now = new Date();
    elClock.textContent = now.toLocaleTimeString("id-ID", { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

async function fetchSensorData() {
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

function handleDataSuccess(data) {
    isServerConnected = true;
    isEsp32Online = Boolean(data.esp32_online);
    lastSeenTime = data.last_seen || "-";

    const suhu = Number(data.suhu ?? 0);
    const kelembapan = Number(data.kelembapan ?? 0);
    const cahaya = Number(data.cahaya ?? 0);
    const gas = Number(data.gas ?? 0);

    const led = String(data.led ?? "OFF").toUpperCase();
    const buzzer = String(data.buzzer ?? "OFF").toUpperCase();
    const kipas = String(data.kipas ?? "OFF").toUpperCase();

    const normalizedData = {
        time: lastSeenTime !== "-" && lastSeenTime !== "Belum ada data" ? lastSeenTime : new Date().toLocaleTimeString("id-ID", { hour12: false }),
        suhu,
        kelembapan,
        cahaya,
        gas,
        led,
        buzzer,
        kipas,
        esp32Online: isEsp32Online,
        lastSeen: lastSeenTime
    };

    if (isEsp32Online) {
        historyData.push(normalizedData);
        if (historyData.length > MAX_HISTORY) {
            historyData.shift();
        }
    }

    updateConnectionUI();
    updateSensorCards(normalizedData);
    updateActuatorCards(normalizedData);
    updateAlertBanner(normalizedData);
    updateRoomSummary(normalizedData);
    updateSystemInfo(true);
    updateAIUI(data);
    updateCalibrationUI(data);
    drawChart();
}

function handleDataError(error) {
    isServerConnected = false;
    isEsp32Online = false;

    updateConnectionUI();
    updateSystemInfo(false, error.message);
    updateAIUI({ ai_available: false, ai_status: "TIDAK TERSEDIA", ai_error: "Server tidak dapat dihubungi." });
    updateCalibrationUI({
        calibration_status: "UNKNOWN",
        calibration_active: false,
        calibration_busy: false,
        calibration_samples: 0,
        calibration_target: 100,
        calibration_skipped: 0,
        calibration_message: "Tidak dapat mengambil status kalibrasi karena server tidak terhubung."
    });
    updateAlertBannerOnDisconnect();
}

function setStatusPill(element, label, stateClass) {
    if (!element) return;
    element.textContent = label;
    element.className = `ai-status-pill ${stateClass}`;
}

function formatModelDate(value) {
    if (!value) return "Belum tersedia";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
}

function updateAIUI(data) {
    if (!elAiStatusBadge) return;

    const status = String(data.ai_status || "TIDAK TERSEDIA").toUpperCase();
    const busy = Boolean(data.calibration_busy) || status === "KALIBRASI";
    const available = Boolean(data.ai_available);

    let title = "AI belum tersedia";
    let description = data.ai_error || "Model AI belum dimuat.";
    let symbol = "🤖";
    let badgeClass = "ai-state-neutral";

    if (busy) {
        title = data.calibration_status === "TRAINING" ? "Melatih model AI" : "Kalibrasi sedang berjalan";
        description = data.calibration_message || "Sampel normal sedang dikumpulkan.";
        symbol = "🧪";
        badgeClass = "ai-state-calibration";
    } else if (!available || status === "TIDAK TERSEDIA") {
        title = "AI tidak tersedia";
        description = data.ai_error || "Periksa model atau lakukan kalibrasi.";
        symbol = "⚙️";
        badgeClass = "ai-state-neutral";
    } else if (status === "NORMAL") {
        title = "Pola sensor sesuai baseline";
        description = "Pola sensor saat ini masih sesuai dengan pola normal yang dipelajari AI.";
        symbol = "✅";
        badgeClass = "ai-state-normal";
    } else if (status === "ANOMALI") {
        title = "Pola berbeda terdeteksi";
        description = "Pola sensor berbeda dari pola normal yang dipelajari. Ini bukan bukti pasti adanya bahaya; periksa nilai sensor dan kondisi ruangan.";
        symbol = "🔎";
        badgeClass = "ai-state-anomaly";
    } else if (status === "MENGANALISIS" || status === "MENUNGGU DATA") {
        title = status === "MENGANALISIS" ? "Mengumpulkan pola awal" : "AI menunggu data";
        description = status === "MENGANALISIS"
            ? "AI menunggu beberapa prediksi agar status lebih stabil."
            : "Model sudah tersedia dan menunggu pembacaan sensor.";
        symbol = "🤖";
        badgeClass = "ai-state-neutral";
    } else {
        title = "AI sedang memeriksa data";
        description = data.calibration_message || "Menunggu data sensor berikutnya.";
        symbol = "🤖";
        badgeClass = "ai-state-neutral";
    }

    setStatusPill(elAiStatusBadge, busy ? "KALIBRASI" : status, badgeClass);
    elAiStatusSymbol.textContent = symbol;
    elAiStatusTitle.textContent = title;
    elAiStatusDescription.textContent = description;

    if (data.ai_score === null || data.ai_score === undefined || !Number.isFinite(Number(data.ai_score))) {
        elAiScoreValue.textContent = "—";
    } else {
        elAiScoreValue.textContent = Number(data.ai_score).toFixed(4);
    }

    elAiTrainingSamples.textContent = data.ai_training_samples ?? "—";
    elAiModelDate.textContent = formatModelDate(data.ai_model_trained_at);
}

function updateCalibrationUI(data) {
    if (!elCalibrationStatusBadge) return;

    const status = String(data.calibration_status || "IDLE").toUpperCase();
    const samples = Math.max(0, Number(data.calibration_samples ?? 0));
    const target = Math.max(1, Number(data.calibration_target ?? 100));
    const skipped = Math.max(0, Number(data.calibration_skipped ?? 0));
    const percent = Math.min(100, (samples / target) * 100);
    const busy = Boolean(data.calibration_busy) || status === "COLLECTING" || status === "TRAINING";

    const statusLabels = {
        IDLE: "BELUM DIMULAI",
        COLLECTING: "MENGUMPULKAN",
        TRAINING: "MELATIH MODEL",
        COMPLETED: "SELESAI",
        CANCELLED: "DIBATALKAN",
        FAILED: "GAGAL",
        UNKNOWN: "SERVER OFFLINE"
    };

    let pillClass = "ai-state-neutral";
    if (status === "COLLECTING" || status === "TRAINING") pillClass = "ai-state-calibration";
    if (status === "COMPLETED") pillClass = "ai-state-normal";
    if (status === "FAILED") pillClass = "ai-state-failed";

    setStatusPill(elCalibrationStatusBadge, statusLabels[status] || status, pillClass);
    elCalibrationMessage.textContent = calibrationActionNotice || data.calibration_message || "Model yang tersimpan akan digunakan sampai kalibrasi baru berhasil.";
    elCalibrationCount.textContent = `${samples} / ${target}`;
    elCalibrationProgressFill.style.width = `${percent}%`;
    elCalibrationProgressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
    elCalibrationSkipped.textContent = String(skipped);
    elCalibrationFinished.textContent = formatModelDate(data.calibration_finished_at);

    elBtnCalibrationStart.disabled = calibrationActionInProgress || busy || !isServerConnected || !isEsp32Online;
    elBtnCalibrationCancel.disabled = calibrationActionInProgress || status !== "COLLECTING";

    if (calibrationActionInProgress) {
        elBtnCalibrationStart.textContent = "Memproses...";
    } else if (status === "COLLECTING") {
        elBtnCalibrationStart.textContent = "Kalibrasi Berjalan";
    } else if (status === "TRAINING") {
        elBtnCalibrationStart.textContent = "Melatih Model...";
    } else {
        elBtnCalibrationStart.textContent = "Mulai Kalibrasi";
    }
}

async function sendCalibrationAction(endpoint, actionName) {
    if (calibrationActionInProgress) return;

    calibrationActionInProgress = true;
    calibrationActionNotice = "";
    elBtnCalibrationStart.disabled = true;
    elBtnCalibrationCancel.disabled = true;
    elCalibrationMessage.textContent = `${actionName} sedang diproses...`;

    let actionError = "";

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: "{}"
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `HTTP ${response.status}`);
        }
    } catch (error) {
        actionError = `${actionName} gagal: ${error.message}`;
        calibrationActionNotice = actionError;
    } finally {
        calibrationActionInProgress = false;
        await fetchSensorData();

        if (actionError) {
            elCalibrationMessage.textContent = actionError;
        }
    }
}

function updateConnectionUI() {
    if (!isServerConnected) {
        elConnectionPill.className = "status-pill status-disconnected";
        elConnectionText.textContent = "Server Terputus";
    } else if (isEsp32Online) {
        elConnectionPill.className = "status-pill status-connected";
        elConnectionText.textContent = "ESP32 Online";
    } else {
        elConnectionPill.className = "status-pill status-warning";
        elConnectionText.textContent = "ESP32 Offline";
    }
}

function updateSensorCards(data) {
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

function updateAlertBanner(data) {
    elAlertTime.textContent = data.time;

    if (!isEsp32Online) {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.textContent = "📡";
        elAlertTitle.textContent = "ESP32 Sedang Offline";
        elAlertMessage.textContent = `Server tidak menerima data terbaru dari ESP32. Menampilkan data terakhir yang tersimpan (${data.lastSeen}).`;
        return;
    }

    if (data.gas >= GAS_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-danger";
        elAlertIcon.textContent = "🚨";
        elAlertTitle.textContent = "Peringatan: Nilai gas tinggi";
        elAlertMessage.textContent = `Nilai MQ-2 mencapai ${data.gas} ADC (ambang batas >= ${GAS_THRESHOLD}). Buzzer dan exhaust fan aktif.`;
        return;
    }

    if (data.kelembapan >= HUMIDITY_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.textContent = "💧";
        elAlertTitle.textContent = "Ruangan sedang lembap. Exhaust fan aktif.";
        elAlertMessage.textContent = `Kelembapan udara kamar mencapai ${data.kelembapan}% (ambang batas >= ${HUMIDITY_THRESHOLD}%). Exhaust fan aktif untuk membantu ventilasi.`;
        return;
    }

    if (data.kipas === "ON") {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.textContent = "🌀";
        elAlertTitle.textContent = "Exhaust fan aktif";
        elAlertMessage.textContent = "Exhaust fan sedang aktif membantu sirkulasi udara kamar.";
        return;
    }

    if (data.led === "ON" || data.cahaya >= LDR_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-normal";
        elAlertIcon.textContent = "💡";
        elAlertTitle.textContent = "Ruangan sedang gelap. LED otomatis menyala.";
        elAlertMessage.textContent = "Sensor LDR mendeteksi intensitas cahaya rendah. Lampu LED kamar menyala otomatis.";
        return;
    }

    elAlertBanner.className = "alert-banner alert-normal";
    elAlertIcon.textContent = "🛡️";
    elAlertTitle.textContent = "Kondisi Normal";
    elAlertMessage.textContent = "Kondisi sensor kamar saat ini normal.";
}

function updateAlertBannerOnDisconnect() {
    elAlertBanner.className = "alert-banner alert-disconnected";
    elAlertIcon.textContent = "⚠️";
    elAlertTitle.textContent = "Server Terputus";
    elAlertMessage.textContent = `Gagal mengambil data dari ${API_URL}. Menampilkan data terakhir yang tersimpan (${lastSeenTime}).`;
}

function updateRoomSummary(data) {
    const details = [];
    let leadSentence = "";

    if (!isEsp32Online) {
        elSummaryBadge.textContent = "Offline";
        elSummaryBadge.style.color = "var(--color-warning)";
        leadSentence = "ESP32 sedang offline. Data yang ditampilkan adalah data terakhir yang diterima.";
        details.push({ icon: "📡", text: `Koneksi ESP32: Offline. Terakhir tercatat pada ${data.lastSeen}.` });
        details.push({ icon: "🌡️", text: `Suhu tercatat terakhir: ${data.suhu}°C.` });
        details.push({ icon: "💧", text: `Kelembapan tercatat terakhir: ${data.kelembapan}%.` });
        details.push({ icon: "⚙️", text: `Status aktuator terakhir: LED ${data.led}, Buzzer ${data.buzzer}, Fan ${data.kipas}.` });
    } else {
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
        details.push({ icon: "⚙️", text: `Status aktuator aktual: LED ${data.led}, Buzzer ${data.buzzer}, Exhaust Fan ${data.kipas}.` });
        details.push({ icon: "📡", text: `Koneksi ESP32: Online (Update: ${lastSeenTime}).` });
    }

    elSummaryLead.textContent = leadSentence;
    elSummaryDetails.innerHTML = details.map(item => `
        <div class="summary-item">
            <span class="summary-item-icon">${item.icon}</span>
            <span>${item.text}</span>
        </div>
    `).join("");
}

function updateSystemInfo(success, errText = "") {
    if (success) {
        elSysServerStatus.textContent = "Terhubung (200 OK)";
        elSysEspStatus.textContent = isEsp32Online ? "Online (Menerima Data)" : "Offline (Menunggu Data)";
        elSysLastUpdate.textContent = lastSeenTime;
    } else {
        elSysServerStatus.textContent = `Terputus: ${errText || "Offline"}`;
        elSysEspStatus.textContent = "Menunggu Server";
    }
}

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
        ctx.fillText("Mengumpulkan titik data riwayat...", width / 2, height / 2);
        return;
    }

    const padding = { top: 20, right: 20, bottom: 30, left: 45 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

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

    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "right";
    for (let i = 0; i <= gridLines; i++) {
        const val = maxY - ((maxY - minY) / gridLines) * i;
        const y = padding.top + (chartH / gridLines) * i + 4;
        ctx.fillText(Math.round(val) + unitLabel, padding.left - 8, y);
    }

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

tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeMetric = btn.dataset.metric;
        drawChart();
    });
});

elBtnCalibrationStart.addEventListener("click", () => {
    const confirmed = window.confirm(
        "Pastikan ESP32 sudah menyala dan sensor telah diberi waktu untuk stabil. " +
        "Pastikan ruangan dalam kondisi normal dan aman. Mulai kalibrasi 100 sampel?"
    );

    if (confirmed) {
        sendCalibrationAction("/api/calibration/start", "Mulai kalibrasi");
    }
});

elBtnCalibrationCancel.addEventListener("click", () => {
    const confirmed = window.confirm(
        "Batalkan pengumpulan sampel? Model lama akan tetap digunakan."
    );

    if (confirmed) {
        sendCalibrationAction("/api/calibration/cancel", "Pembatalan kalibrasi");
    }
});

elBtnRefresh.addEventListener("click", () => {
    fetchSensorData();
});

window.addEventListener("resize", () => {
    drawChart();
});

fetchSensorData();
setInterval(fetchSensorData, POLLING_INTERVAL);
