const API_URL = "/api/data";
const POLLING_INTERVAL = 2000;
const MAX_HISTORY = 40;

const GAS_THRESHOLD = 1200;
const LDR_THRESHOLD = 1800;
const HUMIDITY_THRESHOLD = 60;

const CHART_COLORS = {
    suhu: "#F35BAA",
    kelembapan: "#17C9B4",
    gas: "#FF613F",
    cahaya: "#FFD72F",
    grid: "rgba(255, 255, 255, 0.06)",
    axis: "#9C9691",
    danger: "#FF4D5E",
    warning: "#FFB020"
};

let historyData = [];
let isServerConnected = false;
let isEsp32Online = false;
let lastSeenTime = "-";
let activeMetric = "all";

const ICON_SVG =
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICONS = {
    bot: `<svg viewBox="0 0 24 24" ${ICON_SVG}><rect x="7" y="7" width="10" height="10"></rect><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor"></rect><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>`,
    flask: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M9 3h6"></path><path d="M10 3v5.2L5.6 16a3 3 0 0 0 2.6 4.5h7.6a3 3 0 0 0 2.6-4.5L14 8.2V3"></path><path d="M7.8 15h8.4"></path></svg>`,
    gear: `<svg viewBox="0 0 24 24" ${ICON_SVG}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.2a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.3a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"></path></svg>`,
    check: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M4 12.5 9.5 18 20 6.5"></path></svg>`,
    search: `<svg viewBox="0 0 24 24" ${ICON_SVG}><circle cx="11" cy="11" r="6.5"></circle><path d="m21 21-4.4-4.4"></path></svg>`,
    shield: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M12 3l7 2.8V10c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V5.8z"></path></svg>`,
    alert: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M12 4 2.7 20h18.6z"></path><path d="M12 9.5V14"></path><path d="M12 17h.01"></path></svg>`,
    temp: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M14 4a2 2 0 1 0-4 0v9.5a4.5 4.5 0 1 0 4 0z"></path><path d="M12 9v4.2"></path></svg>`,
    drop: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M12 2.5s6.5 6.6 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.1 12 2.5 12 2.5z"></path></svg>`,
    stream: `<svg viewBox="0 0 24 24" ${ICON_SVG}><circle cx="12" cy="18" r="1.6"></circle><path d="M8 14.5a5.7 5.7 0 0 1 8 0"></path><path d="M5 11a9.7 9.7 0 0 1 14 0"></path><path d="M2 7.5a13.7 13.7 0 0 1 20 0"></path></svg>`,
    siren: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M7.9 2.5h8.2L21.5 7.9v8.2L16.1 21.5H7.9L2.5 16.1V7.9z"></path><path d="M12 8v4.5"></path><path d="M12 16h.01"></path></svg>`,
    wind: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M2 8.5h12.2a2.4 2.4 0 1 0-2.3-3"></path><path d="M2 12.5h14.5a2.4 2.4 0 1 1-2.3 3"></path><path d="M2 16.5h8.2a2.4 2.4 0 1 1-2.3 3"></path></svg>`,
    bulb: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M9 18h6M10 21h4"></path><path d="M12 2.5a6 6 0 0 0-3.4 10.9c.7.5 1.1 1.3 1.1 2.1h4.6c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 2.5z"></path></svg>`,
    moon: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M20 14.5A8.7 8.7 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"></path></svg>`
};

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

const elStatusSuhu = document.getElementById("status-suhu");
const elMeterSuhu = document.getElementById("meter-suhu");

const elStatusKelembapan = document.getElementById("status-kelembapan");
const elMeterKelembapan = document.getElementById("meter-kelembapan");

const elStatusCahaya = document.getElementById("status-cahaya");
const elMeterCahaya = document.getElementById("meter-cahaya");

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

const elStatSuhu = document.getElementById("stat-suhu");
const elStatSuhuBadge = document.getElementById("stat-suhu-badge");
const elStatKelembapan = document.getElementById("stat-kelembapan");
const elStatKelembapanBadge = document.getElementById("stat-kelembapan-badge");
const elStatCahaya = document.getElementById("stat-cahaya");
const elStatCahayaBadge = document.getElementById("stat-cahaya-badge");
const elStatGas = document.getElementById("stat-gas");
const elStatGasBadge = document.getElementById("stat-gas-badge");

const elSidebar = document.getElementById("sidebar");
const elSidebarOverlay = document.getElementById("sidebar-overlay");
const elMenuToggle = document.getElementById("menu-toggle");
const elSidebarDevice = document.getElementById("sidebar-device");
const elSidebarDeviceText = document.getElementById("sidebar-device-text");
const elSidebarLastSeen = document.getElementById("sidebar-last-seen");
const elHeroStatus = document.getElementById("hero-status");
const elHeroStatusText = document.getElementById("hero-status-text");
const elPageTitle = document.getElementById("page-title");
const elBreadcrumbCurrent = document.getElementById("breadcrumb-current");
const navItems = document.querySelectorAll(".nav-item[data-nav]");
const pageSections = document.querySelectorAll(".page-section[id]");

const elHistoryTbody = document.getElementById("history-tbody");
const elHistoryEmpty = document.getElementById("history-empty");
const elHistoryCount = document.getElementById("history-count");

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
const elAiAnomalyCount = document.getElementById("ai-anomaly-count");
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

const elBannerRoomDesc = document.getElementById("banner-room-desc");
const elBannerSafetyDesc = document.getElementById("banner-safety-desc");
const elTileSuhu = document.getElementById("tile-suhu");
const elTileKelembapan = document.getElementById("tile-kelembapan");
const elTileGas = document.getElementById("tile-gas");
const elTileCahaya = document.getElementById("tile-cahaya");
const categoryTiles = document.querySelectorAll(".category-tile[data-metric]");

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
    updateStatCards(normalizedData);
    updateBanners(normalizedData);
    updateCategoryTiles(normalizedData);
    updateSensorCards(normalizedData);
    updateActuatorCards(normalizedData);
    updateAlertBanner(normalizedData);
    updateRoomSummary(normalizedData);
    updateSystemInfo(true);
    updateAIUI(data);
    updateCalibrationUI(data);
    renderHistoryTable();
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
    const busy = Boolean(data.calibration_busy) || status === "KALIBRASI" || data.calibration_status === "KALIBRASI BERLANGSUNG" || data.calibration_status === "MELATIH MODEL" || data.calibration_status === "COLLECTING" || data.calibration_status === "TRAINING";
    const available = Boolean(data.ai_available);

    let title = "AI belum tersedia";
    let description = data.ai_error || "Model AI belum dimuat.";
    let symbol = "bot";
    let badgeClass = "ai-state-neutral";

    if (busy) {
        title = (data.calibration_status === "MELATIH MODEL" || data.calibration_status === "TRAINING") ? "Melatih model AI" : "Kalibrasi sedang berjalan";
        description = data.calibration_message || "Sampel normal sedang dikumpulkan.";
        symbol = "flask";
        badgeClass = "ai-state-calibration";
    } else if (!available || status === "TIDAK TERSEDIA") {
        title = "AI tidak tersedia";
        description = data.ai_error || "Periksa model atau lakukan kalibrasi.";
        symbol = "gear";
        badgeClass = "ai-state-neutral";
    } else if (status === "NORMAL") {
        title = "Pola sensor sesuai baseline";
        description = "Pola sensor saat ini masih sesuai dengan pola normal yang dipelajari AI.";
        symbol = "check";
        badgeClass = "ai-state-normal";
    } else if (status === "ANOMALI") {
        title = "Pola berbeda terdeteksi";
        description = "Pola sensor berbeda dari pola normal yang dipelajari. Ini bukan bukti pasti adanya bahaya; periksa nilai sensor dan kondisi ruangan.";
        symbol = "search";
        badgeClass = "ai-state-anomaly";
    } else if (status === "MENGANALISIS" || status === "MENUNGGU DATA") {
        title = status === "MENGANALISIS" ? "Mengumpulkan pola awal" : "AI menunggu data";
        description = status === "MENGANALISIS"
            ? "AI menunggu beberapa prediksi agar status lebih stabil."
            : "Model sudah tersedia dan menunggu pembacaan sensor.";
        symbol = "bot";
        badgeClass = "ai-state-neutral";
    } else {
        title = "AI sedang memeriksa data";
        description = data.calibration_message || "Menunggu data sensor berikutnya.";
        symbol = "bot";
        badgeClass = "ai-state-neutral";
    }

    setStatusPill(elAiStatusBadge, busy ? "KALIBRASI" : status, badgeClass);
    elAiStatusSymbol.innerHTML = ICONS[symbol] || ICONS.bot;
    elAiStatusTitle.textContent = title;
    elAiStatusDescription.textContent = description;

    if (data.ai_score === null || data.ai_score === undefined || !Number.isFinite(Number(data.ai_score))) {
        elAiScoreValue.textContent = "—";
    } else {
        elAiScoreValue.textContent = Number(data.ai_score).toFixed(4);
    }

    if (elAiAnomalyCount) {
        const anomalies = Number(data.ai_anomaly_count);
        const checked = Number(data.ai_samples_checked);

        if (Number.isFinite(anomalies) && Number.isFinite(checked) && checked > 0) {
            elAiAnomalyCount.textContent = `${anomalies} / ${checked}`;
        } else {
            elAiAnomalyCount.textContent = "—";
        }
    }

    elAiTrainingSamples.textContent = data.ai_training_samples ?? "—";
    elAiModelDate.textContent = formatModelDate(data.ai_model_trained_at);
}

function updateCalibrationUI(data) {
    if (!elCalibrationStatusBadge) return;

    const status = String(data.calibration_status || "BELUM DIKALIBRASI").toUpperCase();
    const samples = Math.max(0, Number(data.calibration_samples ?? 0));
    const target = Math.max(1, Number(data.calibration_target ?? 100));
    const skipped = Math.max(0, Number(data.calibration_skipped ?? 0));
    const percent = Math.min(100, (samples / target) * 100);
    const busy = Boolean(data.calibration_busy) || status === "KALIBRASI BERLANGSUNG" || status === "MELATIH MODEL" || status === "COLLECTING" || status === "TRAINING";

    const statusLabels = {
        "BELUM DIKALIBRASI": "BELUM DIKALIBRASI",
        "KALIBRASI BERLANGSUNG": "KALIBRASI BERLANGSUNG",
        "MELATIH MODEL": "MELATIH MODEL",
        "KALIBRASI BERHASIL": "KALIBRASI BERHASIL",
        "KALIBRASI DIBATALKAN": "KALIBRASI DIBATALKAN",
        "KALIBRASI GAGAL": "KALIBRASI GAGAL",
        IDLE: "BELUM DIKALIBRASI",
        COLLECTING: "KALIBRASI BERLANGSUNG",
        TRAINING: "MELATIH MODEL",
        COMPLETED: "KALIBRASI BERHASIL",
        CANCELLED: "KALIBRASI DIBATALKAN",
        FAILED: "KALIBRASI GAGAL",
        UNKNOWN: "SERVER TERPUTUS"
    };

    let pillClass = "ai-state-neutral";
    if (status === "KALIBRASI BERLANGSUNG" || status === "COLLECTING" || status === "MELATIH MODEL" || status === "TRAINING") {
        pillClass = "ai-state-calibration";
    } else if (status === "KALIBRASI BERHASIL" || status === "COMPLETED") {
        pillClass = "ai-state-normal";
    } else if (status === "KALIBRASI GAGAL" || status === "FAILED") {
        pillClass = "ai-state-failed";
    } else if (status === "KALIBRASI DIBATALKAN" || status === "CANCELLED" || status === "BELUM DIKALIBRASI" || status === "IDLE") {
        pillClass = "ai-state-neutral";
    }

    setStatusPill(elCalibrationStatusBadge, statusLabels[status] || status, pillClass);
    elCalibrationMessage.textContent = calibrationActionNotice || data.calibration_message || "Model yang tersimpan akan digunakan sampai kalibrasi baru berhasil.";
    elCalibrationCount.textContent = `${samples} / ${target}`;
    elCalibrationProgressFill.style.width = `${percent}%`;
    elCalibrationProgressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
    elCalibrationSkipped.textContent = String(skipped);
    elCalibrationFinished.textContent = formatModelDate(data.calibration_finished_at);

    const canCancel = (status === "KALIBRASI BERLANGSUNG" || status === "COLLECTING") && !calibrationActionInProgress;
    elBtnCalibrationStart.disabled = calibrationActionInProgress || busy || !isServerConnected || !isEsp32Online;
    elBtnCalibrationCancel.disabled = !canCancel;

    if (calibrationActionInProgress) {
        elBtnCalibrationStart.textContent = "Memproses...";
    } else if (status === "KALIBRASI BERLANGSUNG" || status === "COLLECTING") {
        elBtnCalibrationStart.textContent = "Kalibrasi Berjalan";
    } else if (status === "MELATIH MODEL" || status === "TRAINING") {
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
    let pillClass;
    let pillLabel;
    let deviceClass;
    let deviceLabel;
    let heroClass;
    let heroLabel;

    if (!isServerConnected) {
        pillClass = "status-pill status-disconnected";
        pillLabel = "Server Terputus";
        deviceClass = "device-chip status-disconnected";
        deviceLabel = "Server Terputus";
        heroClass = "hero-status status-disconnected";
        heroLabel = "Server tidak dapat dihubungi";
    } else if (isEsp32Online) {
        pillClass = "status-pill status-connected";
        pillLabel = "ESP32 Online";
        deviceClass = "device-chip status-connected";
        deviceLabel = "ESP32 Online";
        heroClass = "hero-status status-connected";
        heroLabel = "Menerima data real-time";
    } else {
        pillClass = "status-pill status-warning";
        pillLabel = "ESP32 Offline";
        deviceClass = "device-chip status-warning";
        deviceLabel = "ESP32 Offline";
        heroClass = "hero-status status-warning";
        heroLabel = "Menunggu data ESP32";
    }

    elConnectionPill.className = pillClass;
    elConnectionText.textContent = pillLabel;

    if (elSidebarDevice) {
        elSidebarDevice.className = deviceClass;
        elSidebarDeviceText.textContent = deviceLabel;
        elSidebarLastSeen.textContent = lastSeenTime || "-";
    }

    if (elHeroStatus) {
        elHeroStatus.className = heroClass;
        elHeroStatusText.textContent = heroLabel;
    }
}

function setBadge(element, label, variant) {
    if (!element) return;
    element.textContent = label;
    element.className = `sensor-status-badge ${variant}`;
}

function updateBanners(data) {
    if (elBannerRoomDesc) {
        if (!isServerConnected) {
            elBannerRoomDesc.textContent = "Server tidak dapat dihubungi. Menampilkan data terakhir yang tersimpan.";
        } else if (!isEsp32Online) {
            elBannerRoomDesc.textContent = `ESP32 offline. Data terakhir: ${data.suhu}°C · ${data.kelembapan}% RH · LDR ${data.cahaya} ADC.`;
        } else {
            elBannerRoomDesc.textContent = `Now ${data.suhu}°C · ${data.kelembapan}% RH · light ${data.cahaya} ADC.`;
        }
    }

    if (elBannerSafetyDesc) {
        if (!isServerConnected) {
            elBannerSafetyDesc.textContent = "Status keamanan tidak tersedia saat server terputus.";
        } else if (data.gas >= GAS_THRESHOLD) {
            elBannerSafetyDesc.textContent = `Gas tinggi (${data.gas} ADC). Buzzer & exhaust fan aktif otomatis.`;
        } else if (data.kipas === "ON") {
            elBannerSafetyDesc.textContent = `Ventilasi aktif. Gas aman di ${data.gas} ADC.`;
        } else {
            elBannerSafetyDesc.textContent = `Gas aman (${data.gas} ADC). Ventilasi siaga otomatis.`;
        }
    }
}

function updateCategoryTiles(data) {
    if (elTileSuhu) elTileSuhu.textContent = data.suhu;
    if (elTileKelembapan) elTileKelembapan.textContent = data.kelembapan;
    if (elTileGas) elTileGas.textContent = data.gas;
    if (elTileCahaya) elTileCahaya.textContent = data.cahaya;
}

function updateStatCards(data) {
    if (!elStatSuhu) return;

    elStatSuhu.textContent = data.suhu;
    if (data.suhu < 24) {
        setBadge(elStatSuhuBadge, "Dingin", "status-ok");
    } else if (data.suhu <= 32) {
        setBadge(elStatSuhuBadge, "Normal", "status-ok");
    } else {
        setBadge(elStatSuhuBadge, "Hangat", "status-warn");
    }

    elStatKelembapan.textContent = data.kelembapan;
    if (data.kelembapan >= HUMIDITY_THRESHOLD) {
        setBadge(elStatKelembapanBadge, "Lembap", "status-warn");
    } else if (data.kelembapan < 40) {
        setBadge(elStatKelembapanBadge, "Kering", "status-ok");
    } else {
        setBadge(elStatKelembapanBadge, "Normal", "status-ok");
    }

    elStatCahaya.textContent = data.cahaya;
    if (data.cahaya >= LDR_THRESHOLD) {
        setBadge(elStatCahayaBadge, "Gelap", "status-dark");
    } else {
        setBadge(elStatCahayaBadge, "Terang", "status-ok");
    }

    elStatGas.textContent = data.gas;
    if (data.gas >= GAS_THRESHOLD) {
        setBadge(elStatGasBadge, "Gas Tinggi", "status-danger");
    } else if (data.gas >= 900) {
        setBadge(elStatGasBadge, "Waspada", "status-warn");
    } else {
        setBadge(elStatGasBadge, "Normal", "status-ok");
    }
}

function renderHistoryTable() {
    if (!elHistoryTbody) return;

    elHistoryCount.textContent = `${historyData.length} baris`;

    if (historyData.length === 0) {
        elHistoryTbody.innerHTML = "";
        elHistoryEmpty.classList.add("show");
        return;
    }

    elHistoryEmpty.classList.remove("show");

    const rows = historyData.slice().reverse();
    elHistoryTbody.innerHTML = rows.map(item => {
        const fanOn = item.kipas === "ON";
        const fanLabel = fanOn ? "MENYALA" : "MATI";
        const fanClass = fanOn ? "pill-on" : "pill-off";
        return `
            <tr>
                <td class="cell-time">${item.time}</td>
                <td>${item.suhu}</td>
                <td>${item.kelembapan}</td>
                <td>${item.cahaya}</td>
                <td>${item.gas}</td>
                <td><span class="output-state-pill ${fanClass}">${fanLabel}</span></td>
            </tr>
        `;
    }).join("");
}

function updateSensorCards(data) {
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
    elMeterSuhu.style.backgroundColor = data.suhu > 32 ? "#681717" : "#241f1c";

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
    elMeterKelembapan.style.backgroundColor = data.kelembapan >= HUMIDITY_THRESHOLD ? "#573110" : "#0B4A44";

    if (data.cahaya >= LDR_THRESHOLD) {
        elStatusCahaya.textContent = "Gelap";
        elStatusCahaya.className = "sensor-status-badge status-dark";
    } else {
        elStatusCahaya.textContent = "Terang";
        elStatusCahaya.className = "sensor-status-badge status-ok";
    }
    const percentCahaya = Math.min(100, Math.max(0, (data.cahaya / 4095) * 100));
    elMeterCahaya.style.width = `${percentCahaya}%`;
    elMeterCahaya.style.backgroundColor = data.cahaya >= LDR_THRESHOLD ? "#16324F" : "#241f1c";

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
    elMeterGas.style.backgroundColor = data.gas >= GAS_THRESHOLD ? "#681717" : (data.gas >= 900 ? "#573110" : "#0E3B20");
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
        elAlertIcon.innerHTML = ICONS.stream;
        elAlertTitle.textContent = "ESP32 Sedang Offline";
        elAlertMessage.textContent = `Server tidak menerima data terbaru dari ESP32. Menampilkan data terakhir yang tersimpan (${data.lastSeen}).`;
        return;
    }

    if (data.gas >= GAS_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-danger";
        elAlertIcon.innerHTML = ICONS.siren;
        elAlertTitle.textContent = "Peringatan: Nilai gas tinggi";
        elAlertMessage.textContent = `Nilai MQ-2 mencapai ${data.gas} ADC (ambang batas >= ${GAS_THRESHOLD}). Buzzer dan exhaust fan aktif.`;
        return;
    }

    if (data.kelembapan >= HUMIDITY_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.innerHTML = ICONS.drop;
        elAlertTitle.textContent = "Ruangan sedang lembap. Exhaust fan aktif.";
        elAlertMessage.textContent = `Kelembapan udara kamar mencapai ${data.kelembapan}% (ambang batas >= ${HUMIDITY_THRESHOLD}%). Exhaust fan aktif untuk membantu ventilasi.`;
        return;
    }

    if (data.kipas === "ON") {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.innerHTML = ICONS.wind;
        elAlertTitle.textContent = "Exhaust fan aktif";
        elAlertMessage.textContent = "Exhaust fan sedang aktif membantu sirkulasi udara kamar.";
        return;
    }

    if (data.led === "ON" || data.cahaya >= LDR_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-normal";
        elAlertIcon.innerHTML = ICONS.bulb;
        elAlertTitle.textContent = "Ruangan sedang gelap. LED otomatis menyala.";
        elAlertMessage.textContent = "Sensor LDR mendeteksi intensitas cahaya rendah. Lampu LED kamar menyala otomatis.";
        return;
    }

    elAlertBanner.className = "alert-banner alert-normal";
    elAlertIcon.innerHTML = ICONS.shield;
    elAlertTitle.textContent = "Kondisi Normal";
    elAlertMessage.textContent = "Kondisi sensor kamar saat ini normal.";
}

function updateAlertBannerOnDisconnect() {
    elAlertBanner.className = "alert-banner alert-disconnected";
    elAlertIcon.innerHTML = ICONS.alert;
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
        details.push({ icon: ICONS.stream, text: `Koneksi ESP32: Offline. Terakhir tercatat pada ${data.lastSeen}.` });
        details.push({ icon: ICONS.temp, text: `Suhu tercatat terakhir: ${data.suhu}°C.` });
        details.push({ icon: ICONS.drop, text: `Kelembapan tercatat terakhir: ${data.kelembapan}%.` });
        details.push({ icon: ICONS.gear, text: `Status aktuator terakhir: LED ${data.led}, Buzzer ${data.buzzer}, Fan ${data.kipas}.` });
    } else {
        if (data.gas >= GAS_THRESHOLD) {
            elSummaryBadge.textContent = "Gas Tinggi";
            elSummaryBadge.style.color = "var(--color-danger)";
            leadSentence = "Nilai sensor gas sedang tinggi. Buzzer dan exhaust fan aktif.";
            details.push({ icon: ICONS.siren, text: `Nilai MQ-2: ${data.gas} ADC (ambang batas: ${GAS_THRESHOLD}). Buzzer alarm aktif dan exhaust fan menyala.` });
        } else if (data.kelembapan >= HUMIDITY_THRESHOLD) {
            elSummaryBadge.textContent = "Lembap";
            elSummaryBadge.style.color = "var(--color-warning)";
            leadSentence = "Ruangan sedang lembap. Exhaust fan aktif untuk membantu ventilasi.";
            details.push({ icon: ICONS.drop, text: `Kelembapan kamar mencapai ${data.kelembapan}% (ambang batas: ${HUMIDITY_THRESHOLD}%). Exhaust fan menyala.` });
        } else if (data.cahaya >= LDR_THRESHOLD) {
            elSummaryBadge.textContent = "Gelap";
            elSummaryBadge.style.color = "var(--color-purple)";
            leadSentence = "Ruangan sedang gelap. Lampu otomatis menyala.";
            details.push({ icon: ICONS.moon, text: `Nilai LDR: ${data.cahaya} ADC (kondisi gelap). LED menyala otomatis.` });
        } else {
            elSummaryBadge.textContent = "Normal";
            elSummaryBadge.style.color = "var(--color-success)";
            leadSentence = "Kondisi sensor kamar saat ini normal.";
            details.push({ icon: ICONS.check, text: "Nilai gas, kelembapan, dan cahaya berada dalam rentang normal." });
        }

        details.push({ icon: ICONS.temp, text: `Suhu ruangan terpantau ${data.suhu}°C.` });
        details.push({ icon: ICONS.gear, text: `Status aktuator aktual: LED ${data.led}, Buzzer ${data.buzzer}, Exhaust Fan ${data.kipas}.` });
        details.push({ icon: ICONS.stream, text: `Koneksi ESP32: Online (Update: ${lastSeenTime}).` });
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
        ctx.fillStyle = CHART_COLORS.axis;
        ctx.font = "600 14px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "center";
        ctx.fillText("Mengumpulkan titik data riwayat...", width / 2, height / 2);
        return;
    }

    const padding = { top: 20, right: 20, bottom: 30, left: 45 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    ctx.strokeStyle = CHART_COLORS.grid;
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

    ctx.fillStyle = CHART_COLORS.axis;
    ctx.font = "600 11px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "right";
    for (let i = 0; i <= gridLines; i++) {
        const val = maxY - ((maxY - minY) / gridLines) * i;
        const y = padding.top + (chartH / gridLines) * i + 4;
        ctx.fillText(Math.round(val) + unitLabel, padding.left - 8, y);
    }

    if (activeMetric === "gas") {
        drawThresholdLine(GAS_THRESHOLD, minY, maxY, padding, chartW, chartH, CHART_COLORS.gas, "Ambang Gas (1200)");
    } else if (activeMetric === "kelembapan") {
        drawThresholdLine(HUMIDITY_THRESHOLD, minY, maxY, padding, chartW, chartH, CHART_COLORS.warning, "Ambang Kipas ON (60%)");
    } else if (activeMetric === "cahaya") {
        drawThresholdLine(LDR_THRESHOLD, minY, maxY, padding, chartW, chartH, CHART_COLORS.cahaya, "Ambang Gelap (1800)");
    }

    const getX = (index) => padding.left + (index / (historyData.length - 1)) * chartW;
    const getY = (val) => {
        const clamped = Math.max(minY, Math.min(maxY, val));
        return padding.top + chartH - ((clamped - minY) / (maxY - minY)) * chartH;
    };

    if (activeMetric === "all" || activeMetric === "suhu") {
        const values = historyData.map(d => activeMetric === "all" ? (d.suhu / 50) * 100 : d.suhu);
        drawLineSeries(values, CHART_COLORS.suhu, getX, getY, activeMetric !== "all");
    }

    if (activeMetric === "all" || activeMetric === "kelembapan") {
        const values = historyData.map(d => d.kelembapan);
        drawLineSeries(values, CHART_COLORS.kelembapan, getX, getY, activeMetric !== "all");
    }

    if (activeMetric === "all" || activeMetric === "gas") {
        const values = historyData.map(d => activeMetric === "all" ? (d.gas / 2500) * 100 : d.gas);
        drawLineSeries(values, CHART_COLORS.gas, getX, getY, activeMetric !== "all");
    }

    if (activeMetric === "all" || activeMetric === "cahaya") {
        const values = historyData.map(d => activeMetric === "all" ? (d.cahaya / 4095) * 100 : d.cahaya);
        drawLineSeries(values, CHART_COLORS.cahaya, getX, getY, activeMetric !== "all");
    }

    if (historyData.length > 0) {
        ctx.fillStyle = CHART_COLORS.axis;
        ctx.font = "600 11px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "left";
        ctx.fillText(historyData[0].time, padding.left, height - 10);
        ctx.textAlign = "right";
        ctx.fillText(historyData[historyData.length - 1].time, width - padding.right, height - 10);
    }
}

function hexToRgba(hex, alpha) {
    const clean = String(hex).replace("#", "");
    if (clean.length !== 6) return hex;
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
        gradient.addColorStop(0, hexToRgba(color, 0.22));
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

function setActiveMetric(metric, scroll = false) {
    activeMetric = metric || "all";
    tabButtons.forEach(b => {
        b.classList.toggle("active", b.dataset.metric === activeMetric);
    });
    drawChart();

    if (scroll) {
        const chartSection = document.querySelector(".chart-section");
        if (chartSection) {
            chartSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }
}

tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        setActiveMetric(btn.dataset.metric, false);
    });
});

categoryTiles.forEach(tile => {
    tile.addEventListener("click", () => {
        setActiveMetric(tile.dataset.metric, true);
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

/* ==================== NAVIGASI SIDEBAR ==================== */
const SECTION_LABELS = {
    dashboard: "Overview",
    monitoring: "Monitoring",
    ai: "AI Analysis",
    riwayat: "Sensor History",
    perangkat: "Device Control"
};

function setActiveNav(id) {
    navItems.forEach(item => {
        item.classList.toggle("is-active", item.dataset.nav === id);
    });

    const label = SECTION_LABELS[id] || "Dashboard";
    if (elPageTitle) elPageTitle.textContent = label;
    if (elBreadcrumbCurrent) elBreadcrumbCurrent.textContent = label;
}

function closeSidebar() {
    if (!elSidebar) return;
    elSidebar.classList.remove("open");
    document.body.classList.remove("nav-open");
}

if (elMenuToggle) {
    elMenuToggle.addEventListener("click", () => {
        elSidebar.classList.toggle("open");
        document.body.classList.toggle("nav-open");
    });
}

if (elSidebarOverlay) {
    elSidebarOverlay.addEventListener("click", closeSidebar);
}

navItems.forEach(item => {
    item.addEventListener("click", (event) => {
        const id = item.dataset.nav;
        const target = document.getElementById(id);

        if (!target) return;

        event.preventDefault();
        setActiveNav(id);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        closeSidebar();
    });
});

if ("IntersectionObserver" in window && pageSections.length) {
    const navObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                setActiveNav(entry.target.id);
            }
        });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });

    pageSections.forEach(section => navObserver.observe(section));
}

renderHistoryTable();
fetchSensorData();
setInterval(fetchSensorData, POLLING_INTERVAL);
