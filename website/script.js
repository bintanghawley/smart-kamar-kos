const API_URL = "/api/data";
const POLLING_INTERVAL = 2000;
const MAX_HISTORY = 40;

const GAS_THRESHOLD = 2000;
const LDR_THRESHOLD = 2000;
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
let is3DInitialized = false;

// Mode Simulasi
let isSimulationMode = false;
let simulationScenario = "normal";
let simulationInterval = null;

const ICON_SVG =
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICONS = {
    bot: `<svg viewBox="0 0 24 24" ${ICON_SVG}><rect x="7" y="7" width="10" height="10"></rect><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor"></rect><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>`,
    flask: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M9 3h6"></path><path d="M10 3v5.2L5.6 16a3 3 0 0 0 2.6 4.5h7.6a3 3 0 0 0 2.6-4.5L14 8.2V3"></path><path d="M7.8 15h8.4"></path></svg>`,
    gear: `<svg viewBox="0 0 24 24" ${ICON_SVG}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.2a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.3a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"></path></svg>`,
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
    moon: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M20 14.5A8.7 8.7 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"></path></svg>`,
    sunrise: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M12 2v4M4.93 10.93l2.83-2.83M19.07 10.93l-2.83-2.83M2 18h20M7 18a5 5 0 0 1 10 0"></path></svg>`,
    sun: `<svg viewBox="0 0 24 24" ${ICON_SVG}><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>`,
    sunset: `<svg viewBox="0 0 24 24" ${ICON_SVG}><path d="M17 18a5 5 0 0 0-10 0M12 9v7M9 13l3 3 3-3M2 18h20M4.93 7.93l1.41 1.41M19.07 7.93l-1.41 1.41"></path></svg>`,
    target: `<svg viewBox="0 0 24 24" ${ICON_SVG}><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`
};

const elClock = document.getElementById("header-clock");
const elConnectionPill = document.getElementById("connection-pill");
const elConnectionText = document.getElementById("connection-text");

const elHumanVerdictTitle = document.getElementById("human-verdict-title");
const elHumanVerdictSub = document.getElementById("human-verdict-sub");
const elHumanVerdictDot = document.getElementById("human-verdict-dot");
const elStageActuatorTag = document.getElementById("stage-actuator-tag");
const elOfflineHelperBanner = document.getElementById("offline-helper-banner");
const elBtnActivateSim = document.getElementById("btn-activate-sim");
const elBtnToggleDemo = document.getElementById("btn-toggle-demo");
const elBtnDemoText = document.getElementById("btn-demo-text");
const elSimulationBar = document.getElementById("simulation-bar");

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
const elFootSuhu = document.getElementById("foot-suhu");

const elStatusKelembapan = document.getElementById("status-kelembapan");
const elMeterKelembapan = document.getElementById("meter-kelembapan");
const elFootKelembapan = document.getElementById("foot-kelembapan");

const elStatusCahaya = document.getElementById("status-cahaya");
const elMeterCahaya = document.getElementById("meter-cahaya");
const elFootCahaya = document.getElementById("foot-cahaya");

const elStatusGas = document.getElementById("status-gas");
const elMeterGas = document.getElementById("meter-gas");
const elFootGas = document.getElementById("foot-gas");

const elCardLed = document.getElementById("card-actuator-led");
const elStateLed = document.getElementById("state-text-led");
const elPillLed = document.getElementById("pill-led");
const elHumanStatusLed = document.getElementById("human-status-led");

const elCardBuzzer = document.getElementById("card-actuator-buzzer");
const elStateBuzzer = document.getElementById("state-text-buzzer");
const elPillBuzzer = document.getElementById("pill-buzzer");
const elHumanStatusBuzzer = document.getElementById("human-status-buzzer");
const elBtnBuzzerMute = document.getElementById("btn-buzzer-mute");
const elBtnBuzzerMuteText = document.getElementById("btn-buzzer-mute-text");
let isBuzzerMuting = false;

const ICONS_BUZZER_BTN = {
    mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
    unmute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
    idle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`
};

const elCardKipas = document.getElementById("card-actuator-kipas");
const elStateKipas = document.getElementById("state-text-kipas");
const elPillKipas = document.getElementById("pill-kipas");
const elHumanStatusKipas = document.getElementById("human-status-kipas");

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
const elAiScoreValue = document.getElementById("ai-score-value");
const elAiAnomalyCount = document.getElementById("ai-anomaly-count");
const elAiTrainingSamples = document.getElementById("ai-training-samples");
const elAiModelDate = document.getElementById("ai-model-date");
const elAiDonutProgress = document.getElementById("ai-donut-progress");
const elAiHumanTitle = document.getElementById("ai-human-title");
const elAiHumanSub = document.getElementById("ai-human-sub");
const elAiSlotNamePill = document.getElementById("ai-slot-name-pill");
const elAiSlotSourcePill = document.getElementById("ai-slot-source-pill");

const elCalibrationStatusBadge = document.getElementById("calibration-status-badge");
const elCalibrationMessage = document.getElementById("calibration-message");
const elCalibrationCount = document.getElementById("calibration-count");
const elCalibrationProgressTrack = document.getElementById("calibration-progress-track");
const elCalibrationProgressFill = document.getElementById("calibration-progress-fill");
const elCalibrationSkipped = document.getElementById("calibration-skipped");
const elCalibrationFinished = document.getElementById("calibration-finished");
const elCalibrationTargetName = document.getElementById("calibration-target-name");
const elCalibrationTargetNote = document.getElementById("calibration-target-note");
const elBtnCalibrationStart = document.getElementById("btn-calibration-start");
const elBtnCalibrationCancel = document.getElementById("btn-calibration-cancel");
const elBtnCalibrationReset = document.getElementById("btn-calibration-reset");
let calibrationActionInProgress = false;
let calibrationActionNotice = "";

const SLOT_METAS = {
    pagi: { label: "Pagi", range: "05:00 - 11:00" },
    siang: { label: "Siang", range: "11:00 - 15:00" },
    sore: { label: "Sore", range: "15:00 - 18:30" },
    malam: { label: "Malam", range: "18:30 - 05:00" }
};
let currentTargetSlotKey = "siang";
let currentTargetSlotLabel = "Siang";
let manualSelectedSlotKey = null;
let latestServerData = null;

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

// 3D Initialization Hook
function init3DStage() {
    const container = document.getElementById("room-3d-container");
    if (!container || is3DInitialized) return;

    if (window.Room3D && typeof window.Room3D.init === "function") {
        is3DInitialized = window.Room3D.init(container);
        if (latestServerData && is3DInitialized) {
            window.Room3D.updateData(latestServerData);
        }
    }
}

// Check Room3D module readiness
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init3DStage, 100));
} else {
    setTimeout(init3DStage, 100);
}

async function fetchSensorData() {
    if (isSimulationMode) return;

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
    latestServerData = data;
    isServerConnected = true;
    isEsp32Online = Boolean(data.esp32_online);
    lastSeenTime = data.last_seen || "-";
    const isOfflineLive = !data.esp32_online && !isSimulationMode;

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
        buzzer_muted: Boolean(data.buzzer_muted),
        esp32_online: isEsp32Online,
        lastSeen: lastSeenTime
    };

    if (isEsp32Online) {
        historyData.push(normalizedData);
        if (historyData.length > MAX_HISTORY) {
            historyData.shift();
        }
    }

    if (window.Room3D && typeof window.Room3D.updateData === "function") {
        window.Room3D.updateData(normalizedData);
    }

    updateConnectionUI();
    updateHumanVerdicts(normalizedData, data);
    updateStatCards(normalizedData, isOfflineLive);
    updateActuatorCards(normalizedData, isOfflineLive);
    updateAlertBanner(normalizedData);
    updateRoomSummary(normalizedData);
    updateSystemInfo(true);
    updateAIUI(data, isOfflineLive);
    updateCalibrationUI(data);
    renderHistoryTable();
    drawChart();
}

function handleDataError(error) {
    isServerConnected = false;
    isEsp32Online = false;

    updateConnectionUI();
    updateHumanVerdictsOnOffline();
    updateSystemInfo(false, error.message);
    updateStatCards({ suhu: 0, kelembapan: 0, cahaya: 0, gas: 0 }, true);
    updateActuatorCards({ led: "OFF", buzzer: "OFF", kipas: "OFF" }, true);
    updateAIUI({ ai_available: false, ai_status: "TIDAK TERSEDIA", ai_error: "Server tidak dapat dihubungi." }, true);
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

function updateHumanVerdicts(norm, raw) {
    if (!elHumanVerdictTitle) return;

    const isGasDanger = norm.gas >= GAS_THRESHOLD;
    const isHumid = norm.kelembapan >= HUMIDITY_THRESHOLD;
    const isAnomaly = String(raw.ai_status || "").toUpperCase() === "ANOMALI";
    const online = norm.esp32_online || isSimulationMode;

    if (!online) {
        elHumanVerdictTitle.textContent = "Perangkat Belum Terhubung · Coba Mode Simulasi";
        elHumanVerdictSub.textContent = "ESP32 belum terdeteksi. Aktifkan simulasi untuk mencoba visualisasi 3D.";
        elHumanVerdictDot.className = "verdict-dot status-offline";
        if (elOfflineHelperBanner) elOfflineHelperBanner.style.display = "flex";
    } else if (isGasDanger) {
        elHumanVerdictTitle.textContent = "Waspada! Asap / Gas Terdeteksi · Kipas & Alarm Aktif";
        elHumanVerdictSub.textContent = `Nilai MQ-2 mencapai ${norm.gas} ADC. Exhaust fan dan alarm otomatis merespons.`;
        elHumanVerdictDot.className = "verdict-dot status-danger";
        if (elOfflineHelperBanner) elOfflineHelperBanner.style.display = "none";
    } else if (isHumid) {
        elHumanVerdictTitle.textContent = "Udara Terasa Lembap · Kipas Menyejukkan";
        elHumanVerdictSub.textContent = `Kelembapan kamar ${norm.kelembapan}%. Exhaust fan otomatis menyedot udara.`;
        elHumanVerdictDot.className = "verdict-dot status-warn";
        if (elOfflineHelperBanner) elOfflineHelperBanner.style.display = "none";
    } else if (isAnomaly) {
        elHumanVerdictTitle.textContent = "Pola Kamar Tidak Biasa · Perlu Pemeriksaan";
        elHumanVerdictSub.textContent = "AI mendeteksi kombinasi sensor menyimpang dari patokan normal slot aktif.";
        elHumanVerdictDot.className = "verdict-dot status-warn";
        if (elOfflineHelperBanner) elOfflineHelperBanner.style.display = "none";
    } else {
        elHumanVerdictTitle.textContent = "Kamar Kos 01 Nyaman & Aman";
        elHumanVerdictSub.textContent = "Suhu, kelembapan, pencahayaan, dan sirkulasi udara terpantau stabil.";
        elHumanVerdictDot.className = "verdict-dot";
        if (elOfflineHelperBanner) elOfflineHelperBanner.style.display = "none";
    }

    if (elStageActuatorTag) {
        const fanStr = norm.kipas === "ON" ? "Kipas Menyedot Udara" : "Kipas Siaga";
        const ledStr = norm.led === "ON" ? "Lampu Menyala Hangat" : "Lampu Padam (Hemat)";
        elStageActuatorTag.textContent = `Aktuator: ${fanStr} • ${ledStr}`;
    }
}

function updateHumanVerdictsOnOffline() {
    if (!elHumanVerdictTitle) return;
    elHumanVerdictTitle.textContent = "Perangkat Belum Terhubung : Aktifkan Mode Simulasi";
    elHumanVerdictSub.textContent = "Server lokal atau ESP32 belum terhubung. Klik tombol 'Mode Simulasi' untuk menguji 3D.";
    elHumanVerdictDot.className = "verdict-dot status-offline";
    if (elOfflineHelperBanner && !isSimulationMode) {
        elOfflineHelperBanner.style.display = "flex";
    }
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

function updateAIUI(data, isOffline = false) {
    if (!elAiStatusBadge) return;

    if (isOffline) {
        setStatusPill(elAiStatusBadge, "STANDBY", "ai-state-neutral");
        if (elAiHumanTitle) elAiHumanTitle.textContent = "AI Siaga (Menunggu Sensor ESP32)";
        if (elAiHumanSub) elAiHumanSub.textContent = "Model AI siap menganalisis segera setelah perangkat ESP32 terhubung secara real-time.";
        if (elAiScoreValue) elAiScoreValue.textContent = "--%";
        if (elAiDonutProgress) {
            const circ = 2 * Math.PI * 40;
            elAiDonutProgress.style.strokeDashoffset = String(circ);
            elAiDonutProgress.style.stroke = "rgba(255, 255, 255, 0.15)";
        }
        if (elAiSlotNamePill) {
            const slotLabel = data.ai_active_slot_label || "Siang";
            const slotRange = data.ai_active_slot_range || "11:00 - 15:00";
            elAiSlotNamePill.textContent = `Slot ${slotLabel} (${slotRange})`;
        }
        if (elAiSlotSourcePill) {
            const isCalibrated = Boolean(data.ai_is_slot_calibrated);
            elAiSlotSourcePill.textContent = data.ai_model_source || (isCalibrated ? "Kalibrasi Ruangan" : "Model Default");
        }
        if (elAiAnomalyCount) elAiAnomalyCount.textContent = "0 / 5";
        if (elAiTrainingSamples) elAiTrainingSamples.textContent = data.ai_training_samples ?? "100";
        if (elAiModelDate) elAiModelDate.textContent = formatModelDate(data.ai_model_trained_at);
        return;
    }

    const status = String(data.ai_status || "TIDAK TERSEDIA").toUpperCase();
    const busy = Boolean(data.calibration_busy) || status === "KALIBRASI" || data.calibration_status === "KALIBRASI BERLANGSUNG" || data.calibration_status === "MELATIH MODEL";
    const available = Boolean(data.ai_available);

    let title = "Pola Kamar Sedang Dianalisis";
    let description = data.ai_status_desc || "Mengamati kestabilan sensor kamar kos.";
    let badgeClass = "ai-state-neutral";

    if (busy) {
        title = "Kalibrasi Kamar Berlangsung";
        description = data.calibration_message || "Sedang merekam sampel kondisi normal kamar.";
        badgeClass = "ai-state-calibration";
    } else if (!available || status === "TIDAK TERSEDIA") {
        title = "AI Menunggu Data";
        description = data.ai_error || "Model AI siap memproses setelah sensor terhubung.";
        badgeClass = "ai-state-neutral";
    } else if (status === "NORMAL") {
        const slotLabel = data.ai_active_slot_label || "Siang";
        title = `Pola Kamar Normal untuk ${slotLabel}`;
        description = data.ai_status_desc || "Pola suhu, kelembapan, cahaya, dan gas selaras dengan patokan kamar.";
        badgeClass = "ai-state-normal";
    } else if (status === "ANOMALI") {
        const slotLabel = data.ai_active_slot_label || "Saat Ini";
        title = `Pola Tidak Biasa pada ${slotLabel}`;
        description = data.ai_status_desc || "Terdapat perbedaan signifikan dibanding kebiasaan normal kamar kos.";
        badgeClass = "ai-state-anomaly";
    }

    setStatusPill(elAiStatusBadge, busy ? "KALIBRASI" : status, badgeClass);
    if (elAiHumanTitle) elAiHumanTitle.textContent = title;
    if (elAiHumanSub) elAiHumanSub.textContent = description;

    // AI Donut SVG Progress Score (Solar Status Style)
    const scoreVal = (data.ai_score !== null && data.ai_score !== undefined && Number.isFinite(Number(data.ai_score)))
        ? Number(data.ai_score)
        : null;

    if (elAiScoreValue) {
        elAiScoreValue.textContent = scoreVal !== null ? `${scoreVal.toFixed(0)}%` : "--";
    }

    if (elAiDonutProgress) {
        const circ = 2 * Math.PI * 40; // ~251.327
        if (scoreVal !== null) {
            const clamped = Math.min(100, Math.max(0, scoreVal));
            const offset = circ * (1 - clamped / 100);
            elAiDonutProgress.style.strokeDashoffset = String(offset);
            elAiDonutProgress.style.stroke = clamped >= 75 ? "var(--color-success)" : (clamped >= 55 ? "var(--yellow)" : "var(--color-danger)");
        } else {
            elAiDonutProgress.style.strokeDashoffset = String(circ * 0.9);
            elAiDonutProgress.style.stroke = "rgba(255, 255, 255, 0.15)";
        }
    }

    if (elAiSlotNamePill) {
        const slotLabel = data.ai_active_slot_label || "Siang";
        const slotRange = data.ai_active_slot_range || "11:00 - 15:00";
        elAiSlotNamePill.textContent = `Slot ${slotLabel} (${slotRange})`;
    }

    if (elAiSlotSourcePill) {
        const isCalibrated = Boolean(data.ai_is_slot_calibrated);
        elAiSlotSourcePill.textContent = data.ai_model_source || (isCalibrated ? "Kalibrasi Ruangan" : "Model Default");
    }

    if (elAiAnomalyCount) {
        const anomalies = Number(data.ai_anomaly_count);
        const checked = Number(data.ai_samples_checked);
        if (Number.isFinite(anomalies) && Number.isFinite(checked) && checked > 0) {
            elAiAnomalyCount.textContent = `${anomalies} / ${checked}`;
        } else {
            elAiAnomalyCount.textContent = "0 / 5";
        }
    }

    if (elAiTrainingSamples) elAiTrainingSamples.textContent = data.ai_training_samples ?? "100";
    if (elAiModelDate) elAiModelDate.textContent = formatModelDate(data.ai_model_trained_at);
}

function updateCalibrationUI(data) {
    if (!elCalibrationStatusBadge) return;

    const status = String(data.calibration_status || "BELUM DIKALIBRASI").toUpperCase();
    const samples = Math.max(0, Number(data.calibration_samples ?? 0));
    const target = Math.max(1, Number(data.calibration_target ?? 100));
    const skipped = Math.max(0, Number(data.calibration_skipped ?? 0));
    const percent = Math.min(100, (samples / target) * 100);
    const busy = Boolean(data.calibration_busy) || status === "KALIBRASI BERLANGSUNG" || status === "MELATIH MODEL";

    let pillClass = "ai-state-neutral";
    if (status === "KALIBRASI BERLANGSUNG" || status === "MELATIH MODEL") {
        pillClass = "ai-state-calibration";
    } else if (status === "KALIBRASI BERHASIL") {
        pillClass = "ai-state-normal";
    } else if (status === "KALIBRASI GAGAL") {
        pillClass = "ai-state-failed";
    }

    setStatusPill(elCalibrationStatusBadge, status, pillClass);
    if (elCalibrationMessage) {
        elCalibrationMessage.textContent = calibrationActionNotice || data.calibration_message || "Model tersimpan akan dijadikan acuan normal.";
    }
    if (elCalibrationCount) elCalibrationCount.textContent = `${samples} / ${target}`;
    if (elCalibrationProgressFill) elCalibrationProgressFill.style.width = `${percent}%`;
    if (elCalibrationProgressTrack) elCalibrationProgressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));

    const serverActiveSlotKey = data.calibration_target_slot || data.ai_active_slot || "siang";
    const serverActiveSlotLabel = data.calibration_target_slot_label || data.ai_active_slot_label || "Siang";

    if (busy) {
        manualSelectedSlotKey = null;
    }

    if (manualSelectedSlotKey && SLOT_METAS[manualSelectedSlotKey]) {
        currentTargetSlotKey = manualSelectedSlotKey;
        currentTargetSlotLabel = SLOT_METAS[manualSelectedSlotKey].label;
    } else {
        currentTargetSlotKey = serverActiveSlotKey;
        currentTargetSlotLabel = serverActiveSlotLabel;
    }

    if (elCalibrationTargetName) {
        const meta = SLOT_METAS[currentTargetSlotKey] || { range: "" };
        const range = meta.range || data.calibration_target_slot_range || "";
        const tag = manualSelectedSlotKey ? " [Manual]" : " [Waktu Nyata]";
        elCalibrationTargetName.textContent = `Target: Slot ${currentTargetSlotLabel} (${range})${tag}`;
    }

    // Mini 4 Slots Card Render
    if (data.ai_slots) {
        const slotsObj = data.ai_slots;
        ["pagi", "siang", "sore", "malam"].forEach(slotKey => {
            const cardEl = document.getElementById(`slot-card-${slotKey}`);
            const pillEl = document.getElementById(`slot-pill-${slotKey}`);
            const metaEl = document.getElementById(`slot-meta-${slotKey}`);
            const slotData = slotsObj[slotKey];

            if (cardEl && slotData) {
                cardEl.classList.toggle("is-active-slot", slotData.is_active_now);
                cardEl.classList.toggle("is-selected-target", slotKey === currentTargetSlotKey);
            }

            if (pillEl && slotData) {
                if (slotData.is_calibrated) {
                    pillEl.className = "time-slot-pill pill-calibrated";
                    pillEl.textContent = "TERKALIBRASI";
                } else {
                    pillEl.className = "time-slot-pill pill-default";
                    pillEl.textContent = "DEFAULT";
                }
            }

            if (metaEl && slotData) {
                if (slotData.is_calibrated) {
                    metaEl.textContent = `${slotData.samples || 100} sampel kalibrasi`;
                } else {
                    metaEl.textContent = "Model bawaan umum";
                }
            }
        });
    }

    const canCancel = (status === "KALIBRASI BERLANGSUNG") && !calibrationActionInProgress;
    elBtnCalibrationStart.disabled = calibrationActionInProgress || busy || (!isServerConnected && !isSimulationMode) || (!isEsp32Online && !isSimulationMode);
    elBtnCalibrationCancel.disabled = !canCancel;

    if (elBtnCalibrationReset) {
        elBtnCalibrationReset.disabled = calibrationActionInProgress || busy || (!isServerConnected && !isSimulationMode);
        elBtnCalibrationReset.textContent = `Reset Slot ${currentTargetSlotLabel}`;
    }

    if (calibrationActionInProgress) {
        elBtnCalibrationStart.textContent = "Memproses...";
    } else if (status === "KALIBRASI BERLANGSUNG") {
        elBtnCalibrationStart.textContent = "Kalibrasi Berjalan";
    } else if (status === "MELATIH MODEL") {
        elBtnCalibrationStart.textContent = "Melatih Model...";
    } else {
        elBtnCalibrationStart.textContent = `Mulai Kalibrasi (${currentTargetSlotLabel})`;
    }
}

async function sendCalibrationAction(endpoint, actionName) {
    if (calibrationActionInProgress) return;

    if (isSimulationMode) {
        alert("Kalibrasi model nyata memerlukan koneksi fisik ke server & ESP32.");
        return;
    }

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
    let pillClass, pillLabel, deviceClass, deviceLabel;

    if (isSimulationMode) {
        pillClass = "status-pill status-connected";
        pillLabel = "Mode Simulasi Aktif";
        deviceClass = "device-chip status-connected";
        deviceLabel = "Simulasi Demo";
    } else if (!isServerConnected) {
        pillClass = "status-pill status-disconnected";
        pillLabel = "Server Terputus";
        deviceClass = "device-chip status-disconnected";
        deviceLabel = "Server Terputus";
    } else if (isEsp32Online) {
        pillClass = "status-pill status-connected";
        pillLabel = "ESP32 Online";
        deviceClass = "device-chip status-connected";
        deviceLabel = "ESP32 Online";
    } else {
        pillClass = "status-pill status-warning";
        pillLabel = "ESP32 Offline";
        deviceClass = "device-chip status-warning";
        deviceLabel = "ESP32 Offline";
    }

    elConnectionPill.className = pillClass;
    elConnectionText.textContent = pillLabel;

    if (elSidebarDevice) {
        elSidebarDevice.className = deviceClass;
        elSidebarDeviceText.textContent = deviceLabel;
        elSidebarLastSeen.textContent = lastSeenTime || "-";
    }
}

function setBadge(element, label, variant) {
    if (!element) return;
    element.textContent = label;
    element.className = `sensor-status-badge ${variant}`;
}

function updateStatCards(data, isOffline = false) {
    if (!elStatSuhu) return;

    if (isOffline) {
        elStatSuhu.textContent = "--";
        setBadge(elStatSuhuBadge, "Offline", "status-offline");
        if (elFootSuhu) elFootSuhu.textContent = "Menunggu koneksi ESP32";
        elMeterSuhu.style.width = "0%";

        elStatKelembapan.textContent = "--";
        setBadge(elStatKelembapanBadge, "Offline", "status-offline");
        if (elFootKelembapan) elFootKelembapan.textContent = "Menunggu koneksi ESP32";
        elMeterKelembapan.style.width = "0%";

        elStatGas.textContent = "--";
        setBadge(elStatGasBadge, "Offline", "status-offline");
        if (elFootGas) elFootGas.textContent = "Sensor MQ-2 belum terhubung";
        elMeterGas.style.width = "0%";

        elStatCahaya.textContent = "--";
        setBadge(elStatCahayaBadge, "Offline", "status-offline");
        if (elFootCahaya) elFootCahaya.textContent = "Sensor LDR belum terhubung";
        elMeterCahaya.style.width = "0%";
        return;
    }

    // Suhu
    elStatSuhu.textContent = data.suhu;
    if (data.suhu < 24) {
        setBadge(elStatSuhuBadge, "Sejuk", "status-ok");
        if (elFootSuhu) elFootSuhu.textContent = "Suhu sejuk dan sejuk untuk beristirahat";
    } else if (data.suhu <= 30) {
        setBadge(elStatSuhuBadge, "Nyaman", "status-ok");
        if (elFootSuhu) elFootSuhu.textContent = "Suhu optimal dan nyaman untuk beraktivitas";
    } else {
        setBadge(elStatSuhuBadge, "Terasa Gerah", "status-warn");
        if (elFootSuhu) elFootSuhu.textContent = "Suhu ruangan hangat dan terasa gerah";
    }
    const percentSuhu = Math.min(100, Math.max(0, (data.suhu / 45) * 100));
    elMeterSuhu.style.width = `${percentSuhu}%`;

    // Kelembapan
    elStatKelembapan.textContent = data.kelembapan;
    if (data.kelembapan >= HUMIDITY_THRESHOLD) {
        setBadge(elStatKelembapanBadge, "Lembap · Kipas Aktif", "status-warn");
        if (elFootKelembapan) elFootKelembapan.textContent = "Udara lembap, exhaust fan otomatis menyedot udara";
    } else if (data.kelembapan < 45) {
        setBadge(elStatKelembapanBadge, "Udara Kering", "status-ok");
        if (elFootKelembapan) elFootKelembapan.textContent = "Kelembapan rendah, ventilasi siaga";
    } else {
        setBadge(elStatKelembapanBadge, "Udara Segar", "status-ok");
        if (elFootKelembapan) elFootKelembapan.textContent = "Rentang kelembapan udara ideal kamar";
    }
    const percentKelembapan = Math.min(100, Math.max(0, data.kelembapan));
    elMeterKelembapan.style.width = `${percentKelembapan}%`;

    // Gas MQ-2
    let gasText = "Bersih";
    let gasBadge = "Bersih";
    let gasBadgeClass = "status-ok";
    if (data.gas >= GAS_THRESHOLD) {
        gasText = "Bahaya Asap";
        gasBadge = "Bahaya Asap";
        gasBadgeClass = "status-danger";
        if (elFootGas) elFootGas.textContent = `Sensor MQ-2: ${data.gas} ADC • Alarm dan kipas aktif!`;
    } else if (data.gas >= 1200) {
        gasText = "Agak Pengap";
        gasBadge = "Agak Pengap";
        gasBadgeClass = "status-warn";
        if (elFootGas) elFootGas.textContent = `Sensor MQ-2: ${data.gas} ADC • Udara agak pengap`;
    } else {
        gasText = "Bersih";
        gasBadge = "Udara Bersih";
        gasBadgeClass = "status-ok";
        if (elFootGas) elFootGas.textContent = `Sensor MQ-2: ${data.gas} ADC • Kondisi udara aman`;
    }
    elStatGas.textContent = gasText;
    setBadge(elStatGasBadge, gasBadge, gasBadgeClass);
    const percentGas = Math.min(100, Math.max(0, (data.gas / 2600) * 100));
    elMeterGas.style.width = `${percentGas}%`;

    // Cahaya LDR
    let cahayaText = "Terang";
    let cahayaBadge = "Terang";
    let cahayaBadgeClass = "status-ok";
    if (data.cahaya >= LDR_THRESHOLD) {
        cahayaText = "Gelap";
        cahayaBadge = "Gelap";
        cahayaBadgeClass = "status-dark";
        if (elFootCahaya) elFootCahaya.textContent = `Sensor LDR: ${data.cahaya} ADC • Lampu otomatis menyala`;
    } else if (data.cahaya >= 1200) {
        cahayaText = "Redup";
        cahayaBadge = "Redup";
        cahayaBadgeClass = "status-warn";
        if (elFootCahaya) elFootCahaya.textContent = `Sensor LDR: ${data.cahaya} ADC • Ruangan temaram`;
    } else {
        cahayaText = "Terang";
        cahayaBadge = "Terang";
        cahayaBadgeClass = "status-ok";
        if (elFootCahaya) elFootCahaya.textContent = `Sensor LDR: ${data.cahaya} ADC • Lampu hemat daya padam`;
    }
    elStatCahaya.textContent = cahayaText;
    setBadge(elStatCahayaBadge, cahayaBadge, cahayaBadgeClass);
    const percentCahaya = Math.min(100, Math.max(0, (data.cahaya / 4095) * 100));
    elMeterCahaya.style.width = `${percentCahaya}%`;
}

function updateActuatorCards(data, isOffline = false) {
    if (isOffline) {
        elCardLed.classList.remove("state-led-on");
        elStateLed.textContent = "OFF";
        elPillLed.textContent = "OFFLINE";
        elPillLed.className = "output-state-pill pill-off";
        if (elHumanStatusLed) elHumanStatusLed.textContent = "Menunggu perangkat ESP32";

        elCardBuzzer.classList.remove("state-buzzer-on", "state-buzzer-muted");
        elStateBuzzer.textContent = "OFF";
        elPillBuzzer.textContent = "SIAGA";
        elPillBuzzer.className = "output-state-pill pill-off";
        if (elHumanStatusBuzzer) elHumanStatusBuzzer.textContent = "Menunggu perangkat ESP32";
        if (elBtnBuzzerMute) {
            elBtnBuzzerMute.className = "btn-buzzer-mute state-idle";
            elBtnBuzzerMute.disabled = true;
            elBtnBuzzerMute.innerHTML = `${ICONS_BUZZER_BTN.idle} <span id="btn-buzzer-mute-text">Buzzer Siaga</span>`;
        }

        elCardKipas.classList.remove("state-kipas-on");
        elStateKipas.textContent = "OFF";
        elPillKipas.textContent = "OFFLINE";
        elPillKipas.className = "output-state-pill pill-off";
        if (elHumanStatusKipas) elHumanStatusKipas.textContent = "Menunggu perangkat ESP32";
        return;
    }

    // LED
    if (data.led === "ON") {
        elCardLed.classList.add("state-led-on");
        elStateLed.textContent = "ON";
        elPillLed.textContent = "MENYALA";
        elPillLed.className = "output-state-pill pill-on";
        if (elHumanStatusLed) elHumanStatusLed.textContent = "Menyala Hangat";
    } else {
        elCardLed.classList.remove("state-led-on");
        elStateLed.textContent = "OFF";
        elPillLed.textContent = "PADAM";
        elPillLed.className = "output-state-pill pill-off";
        if (elHumanStatusLed) elHumanStatusLed.textContent = "Padam (Hemat Daya)";
    }

    // Buzzer
    const isMuted = Boolean(data.buzzer_muted) || data.buzzer === "MUTED";
    const isAlarmActive = Number(data.gas) >= GAS_THRESHOLD;

    if (data.buzzer === "ON" || (isAlarmActive && !isMuted)) {
        elCardBuzzer.classList.remove("state-buzzer-muted");
        elCardBuzzer.classList.add("state-buzzer-on");
        elStateBuzzer.textContent = "ON";
        elPillBuzzer.textContent = "BERBUNYI";
        elPillBuzzer.className = "output-state-pill pill-danger-on";
        if (elHumanStatusBuzzer) elHumanStatusBuzzer.textContent = "Berbunyi!";

        if (elBtnBuzzerMute) {
            elBtnBuzzerMute.className = "btn-buzzer-mute state-alarm";
            elBtnBuzzerMute.disabled = false;
            elBtnBuzzerMute.innerHTML = `${ICONS_BUZZER_BTN.mute} <span id="btn-buzzer-mute-text">Senyapkan Alarm Sementara</span>`;
        }
    } else if (isMuted && isAlarmActive) {
        elCardBuzzer.classList.remove("state-buzzer-on");
        elCardBuzzer.classList.add("state-buzzer-muted");
        elStateBuzzer.textContent = "MUTED";
        elPillBuzzer.textContent = "DISENYAPKAN";
        elPillBuzzer.className = "output-state-pill pill-muted";
        if (elHumanStatusBuzzer) elHumanStatusBuzzer.textContent = "Disenyapkan Sementara";

        if (elBtnBuzzerMute) {
            elBtnBuzzerMute.className = "btn-buzzer-mute state-muted";
            elBtnBuzzerMute.disabled = false;
            elBtnBuzzerMute.innerHTML = `${ICONS_BUZZER_BTN.unmute} <span id="btn-buzzer-mute-text">Nyalakan Alarm Kembali</span>`;
        }
    } else {
        elCardBuzzer.classList.remove("state-buzzer-on", "state-buzzer-muted");
        elStateBuzzer.textContent = "OFF";
        elPillBuzzer.textContent = "HENING";
        elPillBuzzer.className = "output-state-pill pill-off";
        if (elHumanStatusBuzzer) elHumanStatusBuzzer.textContent = "Tenang / Siaga";

        if (elBtnBuzzerMute) {
            elBtnBuzzerMute.className = "btn-buzzer-mute state-idle";
            elBtnBuzzerMute.disabled = false;
            elBtnBuzzerMute.innerHTML = `${ICONS_BUZZER_BTN.idle} <span id="btn-buzzer-mute-text">Buzzer Siaga</span>`;
        }
    }

    // Exhaust Fan
    if (data.kipas === "ON") {
        elCardKipas.classList.add("state-kipas-on");
        elStateKipas.textContent = "ON";
        elPillKipas.textContent = "BERPUTAR";
        elPillKipas.className = "output-state-pill pill-on";
        if (elHumanStatusKipas) elHumanStatusKipas.textContent = "Sedang Menyedot Udara";
    } else {
        elCardKipas.classList.remove("state-kipas-on");
        elStateKipas.textContent = "OFF";
        elPillKipas.textContent = "MATI";
        elPillKipas.className = "output-state-pill pill-off";
        if (elHumanStatusKipas) elHumanStatusKipas.textContent = "Siaga (Mati)";
    }
}

function updateAlertBanner(data) {
    elAlertTime.textContent = data.time;

    if (!isEsp32Online && !isSimulationMode) {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.innerHTML = ICONS.stream;
        elAlertTitle.textContent = "ESP32 Sedang Belum Terhubung";
        elAlertMessage.textContent = "Server menunggu koneksi dari ESP32. Anda dapat menyalakan 'Mode Simulasi' untuk menguji fitur.";
        return;
    }

    if (data.gas >= GAS_THRESHOLD) {
        const isMuted = Boolean(data.buzzer_muted) || data.buzzer === "MUTED";
        elAlertBanner.className = isMuted ? "alert-banner alert-warning" : "alert-banner alert-danger";
        elAlertIcon.innerHTML = ICONS.siren;
        elAlertTitle.textContent = isMuted ? "Waspada: Asap atau Gas Terdeteksi (Buzzer Disenyapkan)" : "Waspada: Asap atau Gas Terdeteksi!";
        elAlertMessage.textContent = `Sensor MQ-2 mendeteksi nilai ${data.gas} ADC. Exhaust fan aktif menyedot udara keluar.`;
        return;
    }

    if (data.kelembapan >= HUMIDITY_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-warning";
        elAlertIcon.innerHTML = ICONS.drop;
        elAlertTitle.textContent = "Ruangan lembap. Exhaust fan otomatis aktif.";
        elAlertMessage.textContent = `Kelembapan udara kamar ${data.kelembapan}%. Kipas pembuang aktif menyegarkan sirkulasi udara.`;
        return;
    }

    if (data.led === "ON" || data.cahaya >= LDR_THRESHOLD) {
        elAlertBanner.className = "alert-banner alert-normal";
        elAlertIcon.innerHTML = ICONS.bulb;
        elAlertTitle.textContent = "Kamar gelap. Lampu otomatis menyala.";
        elAlertMessage.textContent = `Intensitas cahaya rendah (LDR ${data.cahaya} ADC). LED kamar menyala hangat otomatis.`;
        return;
    }

    elAlertBanner.className = "alert-banner alert-normal";
    elAlertIcon.innerHTML = ICONS.shield;
    elAlertTitle.textContent = "Kondisi Kamar 01 Nyaman & Aman";
    elAlertMessage.textContent = "Semua sensor lingkungan berada dalam batas toleransi normal.";
}

function updateAlertBannerOnDisconnect() {
    elAlertBanner.className = "alert-banner alert-disconnected";
    elAlertIcon.innerHTML = ICONS.alert;
    elAlertTitle.textContent = "Server Terputus";
    elAlertMessage.textContent = `Gagal mengambil data dari ${API_URL}. Anda dapat mengaktifkan Mode Simulasi untuk mencoba antarmuka 3D.`;
}

function updateRoomSummary(data) {
    const details = [];
    let leadSentence = "";

    if (!isEsp32Online && !isSimulationMode) {
        elSummaryBadge.textContent = "Menunggu";
        elSummaryBadge.style.color = "var(--color-warning)";
        leadSentence = "ESP32 belum terhubung. Aktifkan Mode Simulasi untuk menguji visualisasi 3D secara interaktif.";
        details.push({ icon: ICONS.stream, text: `Status Koneksi: Menunggu sinyal dari mikrokontroler ESP32.` });
        details.push({ icon: ICONS.gear, text: `Fitur Simulasi: Tersedia tombol satu klik di topbar dan panggung 3D.` });
    } else {
        if (data.gas >= GAS_THRESHOLD) {
            elSummaryBadge.textContent = "Gas Tinggi";
            elSummaryBadge.style.color = "var(--color-danger)";
            leadSentence = "Nilai sensor gas sedang tinggi. Exhaust fan dan alarm otomatis merespons.";
            details.push({ icon: ICONS.siren, text: `Nilai MQ-2: ${data.gas} ADC. Peringatan bahaya aktif.` });
        } else if (data.kelembapan >= HUMIDITY_THRESHOLD) {
            elSummaryBadge.textContent = "Lembap";
            elSummaryBadge.style.color = "var(--color-warning)";
            leadSentence = "Udara ruangan terasa lembap. Kipas ventilasi aktif menyejukkan.";
            details.push({ icon: ICONS.drop, text: `Kelembapan udara kamar: ${data.kelembapan}%. Kipas berputar.` });
        } else if (data.cahaya >= LDR_THRESHOLD) {
            elSummaryBadge.textContent = "Gelap";
            elSummaryBadge.style.color = "var(--yellow)";
            leadSentence = "Ruangan dalam keadaan gelap. Lampu kamar menyala otomatis.";
            details.push({ icon: ICONS.moon, text: `Sensor LDR: ${data.cahaya} ADC. Lampu menyala hangat.` });
        } else {
            elSummaryBadge.textContent = "Normal & Nyaman";
            elSummaryBadge.style.color = "var(--color-success)";
            leadSentence = "Seluruh kondisi lingkungan kamar kos terpantau stabil dan nyaman.";
            details.push({ icon: ICONS.check, text: "Suhu, kelembapan, udara, dan pencahayaan berada dalam rentang ideal." });
        }

        details.push({ icon: ICONS.temp, text: `Suhu ruangan terpantau ${data.suhu}°C.` });
        details.push({ icon: ICONS.gear, text: `Aktuator: LED ${data.led}, Buzzer ${data.buzzer}, Exhaust Fan ${data.kipas}.` });
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
    if (isSimulationMode) {
        elSysServerStatus.textContent = "Mode Simulasi Aktif";
        elSysEspStatus.textContent = "Simulasi Interaktif Demo";
        elSysLastUpdate.textContent = new Date().toLocaleTimeString("id-ID", { hour12: false });
        return;
    }

    if (success) {
        elSysServerStatus.textContent = "Terhubung (200 OK)";
        elSysEspStatus.textContent = isEsp32Online ? "Online (Menerima Data)" : "Offline (Menunggu Data)";
        elSysLastUpdate.textContent = lastSeenTime;
    } else {
        elSysServerStatus.textContent = `Terputus: ${errText || "Offline"}`;
        elSysEspStatus.textContent = "Menunggu Server";
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
                <td>${item.suhu}°C</td>
                <td>${item.kelembapan}%</td>
                <td>${item.cahaya}</td>
                <td>${item.gas}</td>
                <td><span class="output-state-pill ${fanClass}">${fanLabel}</span></td>
            </tr>
        `;
    }).join("");
}

// Chart.js Canvas Logic
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
        ctx.fillText("Mengumpulkan titik data riwayat sensor...", width / 2, height / 2);
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
        minY = 200; maxY = 2600; unitLabel = "";
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
        drawThresholdLine(GAS_THRESHOLD, minY, maxY, padding, chartW, chartH, CHART_COLORS.gas, "Ambang Gas (2000)");
    } else if (activeMetric === "kelembapan") {
        drawThresholdLine(HUMIDITY_THRESHOLD, minY, maxY, padding, chartW, chartH, CHART_COLORS.warning, "Ambang Kipas ON (60%)");
    } else if (activeMetric === "cahaya") {
        drawThresholdLine(LDR_THRESHOLD, minY, maxY, padding, chartW, chartH, CHART_COLORS.cahaya, "Ambang Gelap (2000)");
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

// Calibration Listeners
elBtnCalibrationStart.addEventListener("click", () => {
    const slotName = currentTargetSlotLabel.toUpperCase();
    const confirmed = window.confirm(
        `Pastikan ESP32 menyala dan sensor telah stabil.\n\n` +
        `Kalibrasi ini akan mengumpulkan 100 sampel untuk slot [${slotName}].\n` +
        `Mulai kalibrasi slot ${slotName}?`
    );

    if (confirmed) {
        sendCalibrationAction(
            `/api/calibration/start?slot=${encodeURIComponent(currentTargetSlotKey)}`,
            `Mulai kalibrasi (${currentTargetSlotLabel})`
        );
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

if (elBtnCalibrationReset) {
    elBtnCalibrationReset.addEventListener("click", () => {
        const slotName = currentTargetSlotLabel.toUpperCase();
        const confirmed = window.confirm(
            `Apakah Anda yakin ingin mereset dataset & model kalibrasi slot [${slotName}] kembali ke default bawaan umum?`
        );

        if (confirmed) {
            sendCalibrationAction(
                `/api/calibration/reset?slot=${encodeURIComponent(currentTargetSlotKey)}`,
                `Reset slot ${currentTargetSlotLabel}`
            );
        }
    });
}

window.selectSlot = function(slotKey) {
    if (!slotKey || calibrationActionInProgress) return;

    if (manualSelectedSlotKey === slotKey) {
        manualSelectedSlotKey = null;
    } else {
        manualSelectedSlotKey = slotKey;
    }

    if (latestServerData) {
        updateCalibrationUI(latestServerData);
    }
};

elBtnRefresh.addEventListener("click", () => {
    fetchSensorData();
});

window.addEventListener("resize", () => {
    drawChart();
});

// Sidebar Navigation
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

    const label = SECTION_LABELS[id] || "Overview";
    if (elPageTitle) elPageTitle.textContent = "Smart Kamar Kos 01";
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

// Buzzer Mute Action
if (elBtnBuzzerMute) {
    elBtnBuzzerMute.addEventListener("click", async () => {
        if (isBuzzerMuting) return;
        isBuzzerMuting = true;

        if (isSimulationMode) {
            // Local simulation toggle mute
            if (latestServerData) {
                latestServerData.buzzer_muted = !latestServerData.buzzer_muted;
                if (latestServerData.buzzer === "ON" && latestServerData.buzzer_muted) {
                    latestServerData.buzzer = "MUTED";
                } else if (latestServerData.buzzer === "MUTED" && !latestServerData.buzzer_muted) {
                    latestServerData.buzzer = "ON";
                }
                handleDataSuccess(latestServerData);
            }
            isBuzzerMuting = false;
            return;
        }

        const isCurrentlyMuted = elBtnBuzzerMute.classList.contains("state-muted");
        const targetEndpoint = isCurrentlyMuted ? "/api/buzzer/unmute" : "/api/buzzer/mute";

        elBtnBuzzerMute.disabled = true;
        elBtnBuzzerMute.innerHTML = `<span class="btn-spinner"></span> <span>Memproses...</span>`;

        try {
            const response = await fetch(targetEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            await fetchSensorData();
        } catch (err) {
            console.error("Gagal mengubah status buzzer:", err);
            await fetchSensorData();
        } finally {
            isBuzzerMuting = false;
            if (elBtnBuzzerMute) elBtnBuzzerMute.disabled = false;
        }
    });
}

// Mode simulasi dan demo interaktif
const SIM_SCENARIOS = {
    normal: {
        suhu: 26.5,
        kelembapan: 52,
        cahaya: 950,
        gas: 480,
        led: "OFF",
        kipas: "OFF",
        buzzer: "OFF",
        ai_status: "NORMAL",
        ai_score: 94.2,
        ai_status_desc: "Pola sensor stabil dan selaras dengan patokan kalibrasi miniatur."
    },
    dark: {
        suhu: 25.2,
        kelembapan: 54,
        cahaya: 2850,
        gas: 510,
        led: "ON",
        kipas: "OFF",
        buzzer: "OFF",
        ai_status: "NORMAL",
        ai_score: 91.8,
        ai_status_desc: "Kamar gelap terdeteksi, lampu kamar otomatis menyala hangat."
    },
    humid: {
        suhu: 27.8,
        kelembapan: 68,
        cahaya: 1100,
        gas: 530,
        led: "OFF",
        kipas: "ON",
        buzzer: "OFF",
        ai_status: "NORMAL",
        ai_score: 87.5,
        ai_status_desc: "Kelembapan melebihi ambang batas 60%, exhaust fan otomatis menyedot udara."
    },
    gas: {
        suhu: 32.5,
        kelembapan: 63,
        cahaya: 1250,
        gas: 2450,
        led: "OFF",
        kipas: "ON",
        buzzer: "ON",
        ai_status: "ANOMALI",
        ai_score: 38.0,
        ai_status_desc: "Bahaya! Konsentrasi gas MQ-2 tinggi, alarm dan kipas ventilasi aktif."
    },
    anomaly: {
        suhu: 38.5,
        kelembapan: 28,
        cahaya: 3400,
        gas: 1450,
        led: "ON",
        kipas: "OFF",
        buzzer: "OFF",
        ai_status: "ANOMALI",
        ai_score: 32.5,
        ai_status_desc: "Perubahan pola kamar terdeteksi: Suhu dan cahaya tinggi menyimpang dari slot waktu."
    }
};

function toggleSimulationMode() {
    isSimulationMode = !isSimulationMode;

    if (isSimulationMode) {
        elBtnToggleDemo.classList.add("is-active");
        elBtnDemoText.textContent = "Keluar Simulasi";
        if (elSimulationBar) elSimulationBar.style.display = "flex";
        if (elOfflineHelperBanner) elOfflineHelperBanner.style.display = "none";

        applySimulationStep();
        if (simulationInterval) clearInterval(simulationInterval);
        simulationInterval = setInterval(applySimulationStep, 2000);
    } else {
        elBtnToggleDemo.classList.remove("is-active");
        elBtnDemoText.textContent = "Mode Simulasi";
        if (elSimulationBar) elSimulationBar.style.display = "none";
        if (simulationInterval) clearInterval(simulationInterval);

        if (!isEsp32Online) {
            const resetData = {
                suhu: 0,
                kelembapan: 0,
                cahaya: 0,
                gas: 0,
                led: "OFF",
                buzzer: "OFF",
                kipas: "OFF",
                esp32_online: false,
                lastSeen: lastSeenTime
            };
            updateStatCards(resetData, true);
            updateActuatorCards(resetData, true);
            updateAIUI({ ai_status: "STANDBY" }, true);
            updateHumanVerdicts(resetData, { ai_status: "STANDBY" });
            updateAlertBanner(resetData);
            updateRoomSummary(resetData);
            if (window.Room3D && typeof window.Room3D.updateData === "function") {
                window.Room3D.updateData(resetData);
            }
        }
        fetchSensorData();
    }
}

function applySimulationStep() {
    const base = SIM_SCENARIOS[simulationScenario] || SIM_SCENARIOS.normal;
    // Jitter halus agar pembacaan tampak hidup dan alami
    const jitterSuhu = (Math.random() - 0.5) * 0.4;
    const jitterHum = (Math.random() - 0.5) * 1.0;
    const jitterLdr = Math.round((Math.random() - 0.5) * 30);
    const jitterGas = Math.round((Math.random() - 0.5) * 20);

    const simData = {
        suhu: Number((base.suhu + jitterSuhu).toFixed(1)),
        kelembapan: Math.round(base.kelembapan + jitterHum),
        cahaya: Math.max(0, base.cahaya + jitterLdr),
        gas: Math.max(0, base.gas + jitterGas),
        led: base.led,
        kipas: base.kipas,
        buzzer: base.buzzer,
        buzzer_muted: latestServerData?.buzzer_muted || false,
        esp32_online: true,
        last_seen: new Date().toLocaleTimeString("id-ID", { hour12: false }),
        ai_status: base.ai_status,
        ai_score: base.ai_score,
        ai_status_desc: base.ai_status_desc,
        ai_available: true,
        ai_active_slot: "siang",
        ai_active_slot_label: "Siang",
        ai_active_slot_range: "11:00 - 15:00",
        ai_model_source: "Simulasi Interaktif",
        ai_is_slot_calibrated: true,
        calibration_status: "KALIBRASI BERHASIL",
        calibration_samples: 100,
        calibration_target: 100,
        ai_slots: {
            pagi: { key: "pagi", label: "Pagi", range: "05:00 - 11:00", is_calibrated: true, is_active_now: false },
            siang: { key: "siang", label: "Siang", range: "11:00 - 15:00", is_calibrated: true, is_active_now: true, samples: 100 },
            sore: { key: "sore", label: "Sore", range: "15:00 - 18:30", is_calibrated: false, is_active_now: false },
            malam: { key: "malam", label: "Malam", range: "18:30 - 05:00", is_calibrated: false, is_active_now: false }
        }
    };

    handleDataSuccess(simData);
}

if (elBtnToggleDemo) {
    elBtnToggleDemo.addEventListener("click", toggleSimulationMode);
}

if (elBtnActivateSim) {
    elBtnActivateSim.addEventListener("click", () => {
        if (!isSimulationMode) toggleSimulationMode();
    });
}

document.querySelectorAll(".sim-preset-btn[data-sim]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".sim-preset-btn[data-sim]").forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        simulationScenario = btn.dataset.sim;
        applySimulationStep();
        if (window.Room3D && typeof window.Room3D.focusScenario === "function") {
            window.Room3D.focusScenario(simulationScenario);
        }
    });
});

async function fetchInitialHistory() {
    try {
        const response = await fetch("/api/history?limit=40", {
            headers: { "Accept": "application/json" }
        });
        if (!response.ok) return;
        const res = await response.json();
        if (Array.isArray(res.data) && res.data.length > 0) {
            const items = res.data.slice().reverse().map(item => ({
                time: item.timestamp_str || item.created_at || "-",
                suhu: Number(item.suhu ?? 0),
                kelembapan: Number(item.kelembapan ?? 0),
                cahaya: Number(item.cahaya ?? 0),
                gas: Number(item.gas ?? 0),
                led: String(item.led ?? "OFF").toUpperCase(),
                buzzer: String(item.buzzer ?? "OFF").toUpperCase(),
                kipas: String(item.kipas ?? "OFF").toUpperCase(),
                buzzer_muted: String(item.buzzer ?? "").toUpperCase() === "MUTED",
                esp32_online: true,
                lastSeen: item.timestamp_str || "-"
            }));
            historyData = items.slice(-MAX_HISTORY);
            renderHistoryTable();
            drawChart();
        }
    } catch (err) {
        // Fallback jika database belum aktif atau server dalam mode in-memory
    }
}

renderHistoryTable();
fetchInitialHistory();
fetchSensorData();
setInterval(fetchSensorData, POLLING_INTERVAL);
