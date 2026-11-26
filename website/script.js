const API_URL = "/api/data";
const POLLING_INTERVAL = 2000;
const MAX_HISTORY = 40;
const MIN_HISTORY_ROWS = 8;

const GAS_THRESHOLD = 3500;
const LDR_THRESHOLD = 2000;
const HUMIDITY_THRESHOLD = 60;
const ARC_LENGTH = 259.71;

const MONTHS_ID = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

const CHART_COLORS = {
    suhu: "#F55AA8",
    kelembapan: "#13CAB6",
    gas: "#FE623C",
    cahaya: "#FFD634",
    grid: "rgba(255, 255, 255, 0.06)",
    axis: "#9C9691"
};

const SLOT_METAS = {
    pagi: { label: "Pagi", range: "05:00 - 11:00", icon: "emoji_food_beverage" },
    siang: { label: "Siang", range: "11:00 - 15:00", icon: "sunny" },
    sore: { label: "Sore", range: "15:00 - 18:30", icon: "wb_twilight" },
    malam: { label: "Malam", range: "18:30 - 05:00", icon: "bedtime" }
};

let historyData = [];
let isServerConnected = false;
let isEsp32Online = false;
let lastSeenTime = "-";
let activeMetric = "all";
let is3DInitialized = false;

// Mode Simulasi
let isSimulationMode = false;
window.isSimulationModeActive = false;
let simulationScenario = "normal";
let simulationInterval = null;

// Override manual perangkat (sinkron dengan server & simulasi/offline test)
const manualDeviceState = {
    kipas: null,
    led: null,
    buzzer: null
};

let currentTargetSlotKey = "pagi";
let currentTargetSlotLabel = "Pagi";
let latestServerData = null;
let calibrationActionInProgress = false;
let calibrationNoticeTimer = null;

// Simulasi pengumpulan data kalibrasi (untuk pratinjau state Collecting data... & 100%)
let simCalibrationTimer = null;
let simCalibrationState = {
    active: false,
    samples: 0,
    target: 100,
    slotKey: null,
    calibratedSlots: { pagi: true, siang: true, sore: false, malam: false },
    trainedAt: {
        pagi: "2026-11-22T09:00:00",
        siang: "2026-11-22T12:00:00",
        sore: null,
        malam: null
    }
};

// DOM Elements
const elHeaderDate = document.getElementById("header-date");
const elHeaderClock = document.getElementById("header-clock");
const elHeaderTimeIcon = document.getElementById("header-time-icon");

const elStatusMenuWrap = document.getElementById("status-menu-wrap");
const elConnectionPill = document.getElementById("connection-pill");
const elConnectionText = document.getElementById("connection-text");
const elStatusPopover = document.getElementById("status-popover");
const elBtnToggleDemo = document.getElementById("btn-toggle-demo");
const elSimulationBar = document.getElementById("simulation-bar");
const elStageSimStrip = document.getElementById("stage-sim-strip");
const elBtnRefresh = document.getElementById("btn-refresh");

// Kondisi Saat Ini
const elConditionVerdict = document.getElementById("condition-verdict");
const elCardStatSuhu = document.getElementById("card-stat-suhu");
const elCardStatKelembapan = document.getElementById("card-stat-kelembapan");
const elCardStatGas = document.getElementById("card-stat-gas");
const elCardStatCahaya = document.getElementById("card-stat-cahaya");
const elStatSuhu = document.getElementById("stat-suhu");
const elStatKelembapan = document.getElementById("stat-kelembapan");
const elStatGas = document.getElementById("stat-gas");
const elTrendGas = document.getElementById("trend-gas");
const elStatCahaya = document.getElementById("stat-cahaya");
const elTrendCahaya = document.getElementById("trend-cahaya");

// 3 Actuator Cards
const elCardKipas = document.getElementById("card-actuator-kipas");
const elToggleKipas = document.getElementById("toggle-kipas");
const elCardLed = document.getElementById("card-actuator-led");
const elToggleLed = document.getElementById("toggle-led");
const elCardBuzzer = document.getElementById("card-actuator-buzzer");
const elToggleBuzzer = document.getElementById("toggle-buzzer");

// AI Pendeteksi
const elBtnAiSlotMenu = document.getElementById("btn-ai-slot-menu");
const elAiSlotHeaderIcon = document.getElementById("ai-slot-header-icon");
const elAiSlotPopover = document.getElementById("ai-slot-popover");
const elAiArcProgress = document.getElementById("ai-arc-progress");
const elAiScoreValue = document.getElementById("ai-score-value");
const elAiHumanSub = document.getElementById("ai-human-sub");
const elAiModelDate = document.getElementById("ai-model-date");
const elBtnCalibrationAction = document.getElementById("btn-calibration-action");
const elBtnCalibrationReset = document.getElementById("btn-calibration-reset");
const elCalibrationProgressTrack = document.getElementById("calibration-progress-track");
const elCalibrationProgressFill = document.getElementById("calibration-progress-fill");
const elCalibrationProgressLabel = document.getElementById("calibration-progress-label");
const elCalibrationProgressPct = document.getElementById("calibration-progress-pct");
const elCalibrationNotice = document.getElementById("calibration-notice");

// Chart & Table & System
const canvas = document.getElementById("monitoring-chart");
const ctx = canvas.getContext("2d");
const tabButtons = document.querySelectorAll(".chart-tab");
const legendItems = document.querySelectorAll(".chart-legend .legend-item");

const elHistoryTbody = document.getElementById("history-tbody");
const elSysServerStatus = document.getElementById("sys-server-status");
const elSysEspStatus = document.getElementById("sys-esp-status");
const elSysLastUpdate = document.getElementById("sys-last-update");
const elSysApiUrl = document.getElementById("sys-api-url");
const elSysPollRate = document.getElementById("sys-poll-rate");

const navItems = document.querySelectorAll(".nav-item[data-nav]");
const pageSections = document.querySelectorAll(".page-section[id]");

if (elSysApiUrl) elSysApiUrl.textContent = API_URL;
if (elSysPollRate) elSysPollRate.textContent = `${Math.round(POLLING_INTERVAL / 1000)}dtk`;

// ==================== CLOCK & TIME-OF-DAY ICON ====================
function getTimeSlotKeyForDate(date = new Date()) {
    const minutes = date.getHours() * 60 + date.getMinutes();
    if (minutes >= 300 && minutes < 660) return "pagi";
    if (minutes >= 660 && minutes < 900) return "siang";
    if (minutes >= 900 && minutes < 1110) return "sore";
    return "malam";
}

function updateClock() {
    const now = new Date();
    const day = now.getDate();
    const monthName = MONTHS_ID[now.getMonth()];
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");

    if (elHeaderDate) elHeaderDate.textContent = `${day} ${monthName}`;
    if (elHeaderClock) elHeaderClock.textContent = `${hh} : ${mm} WIB`;

    const slotKey = getTimeSlotKeyForDate(now);
    const meta = SLOT_METAS[slotKey] || SLOT_METAS.pagi;
    if (elHeaderTimeIcon) {
        elHeaderTimeIcon.textContent = meta.icon;
    }

    if (!latestServerData) {
        currentTargetSlotKey = slotKey;
        currentTargetSlotLabel = meta.label;
        if (elAiSlotHeaderIcon) elAiSlotHeaderIcon.textContent = meta.icon;
        if (elBtnCalibrationAction && !calibrationActionInProgress) {
            elBtnCalibrationAction.textContent = `Ambil Data ${meta.label}`;
        }
        document.querySelectorAll(".slot-pop-item[data-slot]").forEach(itemEl => {
            itemEl.classList.toggle("is-active-slot", itemEl.dataset.slot === slotKey);
        });
        if (elBtnCalibrationReset) {
            elBtnCalibrationReset.textContent = `Reset ${meta.label}`;
            elBtnCalibrationReset.disabled = true;
        }
    }
}
setInterval(updateClock, 1000);
updateClock();

// ==================== 3D INITIALIZATION ====================
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

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init3DStage, 100));
} else {
    setTimeout(init3DStage, 100);
}

// ==================== DATA FETCHING ====================
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

function getEffectiveActuatorState(serverData) {
    const online = Boolean(serverData.esp32_online) || isSimulationMode;
    const overrides = serverData.manual_overrides || {};

    const resolveDevice = (key, rawVal) => {
        if (manualDeviceState[key] === "ON" || manualDeviceState[key] === "OFF") {
            return manualDeviceState[key];
        }
        if (overrides[key] === "ON" || overrides[key] === "OFF") {
            return overrides[key];
        }
        if (!online) return "OFF";
        return String(rawVal ?? "OFF").toUpperCase();
    };

    const led = resolveDevice("led", serverData.led);
    const kipas = resolveDevice("kipas", serverData.kipas);
    let buzzer = resolveDevice("buzzer", serverData.buzzer);
    let buzzerMuted = Boolean(serverData.buzzer_muted) || buzzer === "MUTED";

    if (manualDeviceState.buzzer === "OFF" || overrides.buzzer === "OFF") {
        buzzerMuted = true;
        buzzer = Number(serverData.gas ?? 0) >= GAS_THRESHOLD ? "MUTED" : "OFF";
    } else if (manualDeviceState.buzzer === "ON" || overrides.buzzer === "ON") {
        buzzerMuted = false;
        buzzer = "ON";
    }

    return { led, kipas, buzzer, buzzerMuted };
}

function handleDataSuccess(data, { skipHistory = false } = {}) {
    latestServerData = data;
    isServerConnected = true;
    isEsp32Online = Boolean(data.esp32_online);
    lastSeenTime = data.last_seen || "-";
    const isOfflineLive = !data.esp32_online && !isSimulationMode;

    // Sinkronkan override dari server jika ada
    if (data.manual_overrides && !isSimulationMode) {
        ["led", "kipas", "buzzer"].forEach(dev => {
            const ov = data.manual_overrides[dev];
            manualDeviceState[dev] = (ov === "ON" || ov === "OFF") ? ov : null;
        });
    }

    const suhu = Number(data.suhu ?? 0);
    const kelembapan = Number(data.kelembapan ?? 0);
    const cahaya = Number(data.cahaya ?? 0);
    const gas = Number(data.gas ?? 0);

    const { led, kipas, buzzer, buzzerMuted } = getEffectiveActuatorState(data);

    const normalizedData = {
        time: lastSeenTime !== "-" && lastSeenTime !== "Belum ada data"
            ? lastSeenTime
            : new Date().toLocaleTimeString("id-ID", { hour12: false }),
        suhu,
        kelembapan,
        cahaya,
        gas,
        led,
        buzzer,
        kipas,
        buzzer_muted: buzzerMuted,
        esp32_online: isEsp32Online || isSimulationMode,
        lastSeen: lastSeenTime,
        active_slot: data.ai_active_slot || getTimeSlotKeyForDate(new Date()),
        sim_scenario: isSimulationMode ? simulationScenario : null,
        has_manual_led: Boolean(
            manualDeviceState.led === "ON" ||
            manualDeviceState.led === "OFF" ||
            data.manual_overrides?.led === "ON" ||
            data.manual_overrides?.led === "OFF"
        )
    };

    if (!skipHistory && (isEsp32Online || isSimulationMode)) {
        historyData.push(normalizedData);
        if (historyData.length > MAX_HISTORY) {
            historyData.shift();
        }
    }

    if (window.Room3D && typeof window.Room3D.updateData === "function") {
        window.Room3D.updateData(normalizedData);
    }

    updateConnectionUI();
    updateConditionSection(normalizedData, data, isOfflineLive);
    updateActuatorCards(normalizedData);
    updateSystemInfo(true);
    updateAIUI(data, isOfflineLive);
    renderHistoryTable();
    drawChart();
}

function handleDataError() {
    isServerConnected = false;
    isEsp32Online = false;

    const localLed = manualDeviceState.led || "OFF";
    const localKipas = manualDeviceState.kipas || "OFF";
    const localBuzzer = manualDeviceState.buzzer || "OFF";

    const offlineNorm = {
        suhu: 0,
        kelembapan: 0,
        cahaya: 0,
        gas: 0,
        led: localLed,
        kipas: localKipas,
        buzzer: localBuzzer,
        buzzer_muted: localBuzzer === "OFF",
        esp32_online: false,
        active_slot: getTimeSlotKeyForDate(new Date()),
        sim_scenario: null,
        has_manual_led: Boolean(manualDeviceState.led === "ON" || manualDeviceState.led === "OFF")
    };

    if (window.Room3D && typeof window.Room3D.updateData === "function") {
        window.Room3D.updateData(offlineNorm);
    }

    updateConnectionUI();
    updateSystemInfo(false);
    updateConditionSection(offlineNorm, { ai_status: "STANDBY" }, true);
    updateActuatorCards(offlineNorm);
    updateAIUI({ ai_available: false, ai_status: "TIDAK TERSEDIA" }, true);
}

// ==================== CONNECTION UI ====================
function updateConnectionUI() {
    if (!elConnectionPill || !elConnectionText) return;

    if (isSimulationMode) {
        elConnectionPill.className = "status-pill status-sim";
        elConnectionText.textContent = "Mode Simulasi";
    } else if (!isServerConnected) {
        elConnectionPill.className = "status-pill status-disconnected";
        elConnectionText.textContent = "Server Terputus";
    } else if (isEsp32Online) {
        elConnectionPill.className = "status-pill status-connected";
        elConnectionText.textContent = "ESP32 Online";
    } else {
        elConnectionPill.className = "status-pill status-disconnected";
        elConnectionText.textContent = "Perangkat Offline";
    }
}

// ==================== KONDISI SAAT INI ====================
function updateConditionSection(norm, raw, isOffline) {
    if (!elConditionVerdict) return;

    if (isOffline) {
        elConditionVerdict.textContent = "Siaga";
        elConditionVerdict.className = "condition-verdict state-offline";

        if (elStatSuhu) elStatSuhu.textContent = "--";
        if (elStatKelembapan) elStatKelembapan.textContent = "--";
        if (elStatGas) elStatGas.textContent = "--";
        if (elStatCahaya) elStatCahaya.textContent = "--";
        if (elTrendGas) elTrendGas.textContent = "trending_flat";
        if (elTrendCahaya) elTrendCahaya.textContent = "trending_flat";

        if (elCardStatSuhu) elCardStatSuhu.title = "Menunggu data DHT11";
        if (elCardStatKelembapan) elCardStatKelembapan.title = "Menunggu data DHT11";
        if (elCardStatGas) elCardStatGas.title = "Menunggu data sensor gas MQ-2";
        if (elCardStatCahaya) elCardStatCahaya.title = "Menunggu data sensor cahaya LDR";
        return;
    }

    const aiStatus = String(raw?.ai_status || "").toUpperCase();
    const isEmergency = norm.gas >= 3900 || (norm.gas >= GAS_THRESHOLD && norm.suhu >= 35);
    const isDanger = norm.gas >= GAS_THRESHOLD || norm.buzzer === "ON";
    const isWarning = norm.kelembapan >= HUMIDITY_THRESHOLD || norm.suhu > 30 || norm.gas >= 2200 || aiStatus === "ANOMALI";

    if (isEmergency) {
        elConditionVerdict.textContent = "Darurat";
        elConditionVerdict.className = "condition-verdict state-emergency";
    } else if (isDanger) {
        elConditionVerdict.textContent = "Bahaya";
        elConditionVerdict.className = "condition-verdict state-danger";
    } else if (isWarning) {
        elConditionVerdict.textContent = "Waspada";
        elConditionVerdict.className = "condition-verdict state-warning";
    } else {
        elConditionVerdict.textContent = "Luar Biasa";
        elConditionVerdict.className = "condition-verdict state-excellent";
    }

    if (elStatSuhu) elStatSuhu.textContent = Number(norm.suhu).toFixed(1);
    if (elStatKelembapan) elStatKelembapan.textContent = String(Math.round(norm.kelembapan));

    if (elCardStatSuhu) elCardStatSuhu.title = `Suhu Kamar: ${Number(norm.suhu).toFixed(1)}°C`;
    if (elCardStatKelembapan) elCardStatKelembapan.title = `Kelembapan: ${norm.kelembapan}% (Ambang kipas ≥ ${HUMIDITY_THRESHOLD}%)`;

    // Indikasi Gas
    if (elStatGas && elTrendGas) {
        if (norm.gas >= GAS_THRESHOLD) {
            elStatGas.textContent = "Tinggi";
            elTrendGas.textContent = "trending_up";
        } else if (norm.gas >= 2200) {
            elStatGas.textContent = "Sedang";
            elTrendGas.textContent = "trending_up";
        } else {
            elStatGas.textContent = "Rendah";
            elTrendGas.textContent = "trending_down";
        }
        if (elCardStatGas) elCardStatGas.title = `Sensor MQ-2: ${norm.gas} ADC (Ambang bahaya ≥ ${GAS_THRESHOLD} ADC)`;
    }

    // Intensitas Cahaya (LDR tinggi = gelap, LDR rendah = terang)
    if (elStatCahaya && elTrendCahaya) {
        if (norm.cahaya >= LDR_THRESHOLD) {
            elStatCahaya.textContent = "Rendah";
            elTrendCahaya.textContent = "trending_down";
        } else if (norm.cahaya >= 1200) {
            elStatCahaya.textContent = "Sedang";
            elTrendCahaya.textContent = "trending_flat";
        } else {
            elStatCahaya.textContent = "Tinggi";
            elTrendCahaya.textContent = "trending_up";
        }
        if (elCardStatCahaya) elCardStatCahaya.title = `Sensor LDR: ${norm.cahaya} ADC (Ambang gelap ≥ ${LDR_THRESHOLD} ADC)`;
    }
}

// ==================== 3 MANUAL ACTUATOR CARDS ====================
function updateActuatorCards(data) {
    const fanOn = String(data.kipas || "OFF").toUpperCase() === "ON";
    const ledOn = String(data.led || "OFF").toUpperCase() === "ON";
    const alarmOn = String(data.buzzer || "OFF").toUpperCase() === "ON" && !data.buzzer_muted;

    if (elCardKipas && elToggleKipas) {
        elCardKipas.classList.toggle("is-on", fanOn);
        elToggleKipas.setAttribute("aria-checked", String(fanOn));
    }

    if (elCardLed && elToggleLed) {
        elCardLed.classList.toggle("is-on", ledOn);
        elToggleLed.setAttribute("aria-checked", String(ledOn));
    }

    if (elCardBuzzer && elToggleBuzzer) {
        elCardBuzzer.classList.toggle("is-on", alarmOn);
        elToggleBuzzer.setAttribute("aria-checked", String(alarmOn));
    }
}

async function toggleActuatorManual(device) {
    const currentVal = (() => {
        if (device === "kipas") return elCardKipas?.classList.contains("is-on") ? "ON" : "OFF";
        if (device === "led") return elCardLed?.classList.contains("is-on") ? "ON" : "OFF";
        return elCardBuzzer?.classList.contains("is-on") ? "ON" : "OFF";
    })();

    const nextState = currentVal === "ON" ? "OFF" : "ON";
    manualDeviceState[device] = nextState;

    // Optimistic update langsung pada UI & model 3D
    const baseData = latestServerData ? { ...latestServerData } : {
        suhu: 0,
        kelembapan: 0,
        cahaya: 0,
        gas: 0,
        led: manualDeviceState.led || "OFF",
        kipas: manualDeviceState.kipas || "OFF",
        buzzer: manualDeviceState.buzzer || "OFF",
        esp32_online: false
    };

    baseData[device] = nextState;
    if (device === "buzzer") {
        baseData.buzzer_muted = nextState === "OFF";
    }

    if (isSimulationMode) {
        latestServerData = baseData;
        handleDataSuccess(baseData, { skipHistory: true });
        return;
    }

    const effective = getEffectiveActuatorState(baseData);
    const previewNorm = {
        ...baseData,
        led: effective.led,
        kipas: effective.kipas,
        buzzer: effective.buzzer,
        buzzer_muted: effective.buzzerMuted,
        esp32_online: isEsp32Online,
        active_slot: baseData.ai_active_slot || getTimeSlotKeyForDate(new Date()),
        sim_scenario: null,
        has_manual_led: Boolean(
            manualDeviceState.led === "ON" ||
            manualDeviceState.led === "OFF" ||
            baseData.manual_overrides?.led === "ON" ||
            baseData.manual_overrides?.led === "OFF"
        )
    };
    updateActuatorCards(previewNorm);
    if (window.Room3D && typeof window.Room3D.updateData === "function") {
        window.Room3D.updateData(previewNorm);
    }

    try {
        const res = await fetch("/api/device/control", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ device, state: nextState })
        });
        if (res.ok) {
            await fetchSensorData();
        }
    } catch (err) {
        // Mode preview offline: pertahankan toggle manual lokal
    }
}

[
    { card: elCardKipas, btn: elToggleKipas, device: "kipas" },
    { card: elCardLed, btn: elToggleLed, device: "led" },
    { card: elCardBuzzer, btn: elToggleBuzzer, device: "buzzer" }
].forEach(({ card, btn, device }) => {
    if (card) {
        card.addEventListener("click", (e) => {
            if (e.target.closest(".actuator-switch")) return;
            toggleActuatorManual(device);
        });
    }
    if (btn) {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleActuatorManual(device);
        });
    }
});

// ==================== AI PENDETEKSI & KALIBRASI ====================
function formatShortDate(value) {
    if (!value) return "Belum ada";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function formatSlotDateTime(value) {
    if (!value) return "Belum ada";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const dateStr = date.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${dateStr}, ${hh}:${mm}`;
}

function showCalibrationNotice(text, duration = 4500) {
    if (!elCalibrationNotice) return;
    elCalibrationNotice.textContent = text;
    elCalibrationNotice.hidden = false;
    if (calibrationNoticeTimer) clearTimeout(calibrationNoticeTimer);
    calibrationNoticeTimer = setTimeout(() => {
        if (elCalibrationNotice) elCalibrationNotice.hidden = true;
    }, duration);
}

function updateAIUI(data, isOffline = false) {
    const slotByClock = getTimeSlotKeyForDate(new Date());
    const activeSlot = data.ai_active_slot in SLOT_METAS ? data.ai_active_slot : slotByClock;

    const status = String(data.calibration_status || "BELUM DIKALIBRASI").toUpperCase();
    const samples = Math.max(0, Number(data.calibration_samples ?? 0));
    const target = Math.max(1, Number(data.calibration_target ?? 100));
    const busy = Boolean(data.calibration_busy) || status === "KALIBRASI BERLANGSUNG" || status === "MELATIH MODEL";

    // Kunci target kalibrasi ke waktu sekarang (tidak bisa memilih slot waktu lain)
    const busySlot = data.calibration_target_slot in SLOT_METAS ? data.calibration_target_slot : activeSlot;
    currentTargetSlotKey = busy ? busySlot : activeSlot;
    const targetMeta = SLOT_METAS[currentTargetSlotKey] || SLOT_METAS.pagi;
    currentTargetSlotLabel = targetMeta.label;

    if (elAiSlotHeaderIcon) {
        elAiSlotHeaderIcon.textContent = targetMeta.icon;
    }

    // Update Slot Popover items (hanya untuk melihat status ada/belum & kapan terakhir ambil data)
    const slotsObj = data.ai_slots || {};
    ["pagi", "siang", "sore", "malam"].forEach(slotKey => {
        const itemEl = document.getElementById(`slot-card-${slotKey}`);
        const pillEl = document.getElementById(`slot-pill-${slotKey}`);
        const slotInfo = slotsObj[slotKey];

        if (itemEl) {
            const isNow = Boolean(slotInfo?.is_active_now) || slotKey === activeSlot;
            itemEl.classList.toggle("is-active-slot", isNow);
        }
        if (pillEl) {
            const calibrated = Boolean(slotInfo?.is_calibrated);
            const lastTaken = slotInfo?.trained_at ? formatSlotDateTime(slotInfo.trained_at) : null;
            if (calibrated) {
                pillEl.textContent = lastTaken || "Sudah ada";
                pillEl.title = lastTaken ? `Terakhir ambil data: ${lastTaken}` : "Data kalibrasi sudah ada";
            } else {
                pillEl.textContent = "Belum ada";
                pillEl.title = "Belum ada data kalibrasi pada waktu ini";
            }
            pillEl.classList.toggle("is-calibrated", calibrated);
        }
    });

    const selectedSlotData = slotsObj[currentTargetSlotKey];
    const selectedIsCalibrated = Boolean(selectedSlotData?.is_calibrated);

    if (elBtnCalibrationReset) {
        elBtnCalibrationReset.disabled = !selectedIsCalibrated || calibrationActionInProgress || busy || (!isServerConnected && !isSimulationMode);
        elBtnCalibrationReset.textContent = `Reset ${currentTargetSlotLabel}`;
    }

    // Gauge Score & Subtitle
    const scoreVal = (!isOffline && data.ai_score !== null && data.ai_score !== undefined && Number.isFinite(Number(data.ai_score)))
        ? Number(data.ai_score)
        : null;

    if (elAiScoreValue) {
        elAiScoreValue.textContent = scoreVal !== null ? String(Math.round(scoreVal)) : "--";
    }

    if (elAiArcProgress) {
        const aiStatus = String(data.ai_status || "").toUpperCase();
        if (scoreVal !== null) {
            const clamped = Math.min(100, Math.max(0, scoreVal));
            const offset = ARC_LENGTH * (1 - clamped / 100);
            elAiArcProgress.style.strokeDashoffset = String(offset.toFixed(2));
            if (aiStatus === "NORMAL" || clamped >= 70) {
                elAiArcProgress.style.stroke = "#13CAB6";
            } else if (clamped >= 50) {
                elAiArcProgress.style.stroke = "#FFD634";
            } else {
                elAiArcProgress.style.stroke = "#FE623C";
            }
        } else {
            elAiArcProgress.style.strokeDashoffset = String(ARC_LENGTH);
            elAiArcProgress.style.stroke = "#4D4845";
        }
    }

    if (elAiHumanSub) {
        const aiStatus = String(data.ai_status || "").toUpperCase();
        if (busy) {
            elAiHumanSub.textContent = `Mengambil sampel kalibrasi ${currentTargetSlotLabel}...`;
        } else if (isOffline) {
            elAiHumanSub.textContent = "Menunggu data sensor ESP32";
        } else if (aiStatus === "NORMAL") {
            elAiHumanSub.textContent = "Kondisi normal tidak ada anomali";
        } else if (aiStatus === "ANOMALI") {
            elAiHumanSub.textContent = data.ai_status_desc || "Terdeteksi pola anomali pada sensor";
        } else if (aiStatus === "MENGANALISIS") {
            elAiHumanSub.textContent = "Menganalisis pola sensor kamar...";
        } else {
            elAiHumanSub.textContent = data.ai_status_desc || "AI siap memantau pola kamar";
        }
    }

    // Data Terakhir (sesuai slot waktu aktif)
    const trainedAt = selectedIsCalibrated ? selectedSlotData?.trained_at : null;
    if (elAiModelDate) {
        elAiModelDate.textContent = trainedAt ? formatShortDate(trainedAt) : "Belum ada";
    }

    // Progress Bar & Action Button (Idle vs Collecting)
    let pct = 0;
    let progLabel = "Data Terkumpul";

    if (busy) {
        pct = Math.min(100, Math.round((samples / target) * 100));
        progLabel = status === "MELATIH MODEL" ? "Melatih model AI..." : "Collecting data...";
    } else if (selectedIsCalibrated) {
        pct = 100;
        progLabel = "Data Terkumpul";
    } else {
        pct = 0;
        progLabel = "Data Terkumpul";
    }

    if (elCalibrationProgressFill) elCalibrationProgressFill.style.width = `${pct}%`;
    if (elCalibrationProgressTrack) elCalibrationProgressTrack.setAttribute("aria-valuenow", String(pct));
    if (elCalibrationProgressLabel) elCalibrationProgressLabel.textContent = progLabel;
    if (elCalibrationProgressPct) elCalibrationProgressPct.textContent = `${pct}%`;

    if (elBtnCalibrationAction) {
        if (calibrationActionInProgress) {
            elBtnCalibrationAction.textContent = "Memproses...";
            elBtnCalibrationAction.disabled = true;
        } else if (status === "MELATIH MODEL") {
            elBtnCalibrationAction.textContent = "Melatih...";
            elBtnCalibrationAction.disabled = true;
        } else if (status === "KALIBRASI BERLANGSUNG") {
            elBtnCalibrationAction.textContent = "Batal";
            elBtnCalibrationAction.disabled = false;
        } else {
            elBtnCalibrationAction.textContent = `Ambil Data ${currentTargetSlotLabel}`;
            elBtnCalibrationAction.disabled = false;
        }
    }
}

async function sendCalibrationAction(endpoint, actionName) {
    if (calibrationActionInProgress) return;

    calibrationActionInProgress = true;
    if (latestServerData) updateAIUI(latestServerData, !isEsp32Online && !isSimulationMode);

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
        if (result.message) showCalibrationNotice(result.message);
    } catch (error) {
        showCalibrationNotice(`${actionName} gagal: ${error.message}`);
    } finally {
        calibrationActionInProgress = false;
        await fetchSensorData();
    }
}

function startSimulatedCalibration(slotKey) {
    if (simCalibrationTimer) clearInterval(simCalibrationTimer);
    simCalibrationState.active = true;
    simCalibrationState.samples = 10;
    simCalibrationState.slotKey = slotKey;
    applySimulationStep(true);

    simCalibrationTimer = setInterval(() => {
        if (!isSimulationMode || !simCalibrationState.active) {
            clearInterval(simCalibrationTimer);
            simCalibrationTimer = null;
            return;
        }
        simCalibrationState.samples = Math.min(100, simCalibrationState.samples + 10);
        if (simCalibrationState.samples >= 100) {
            clearInterval(simCalibrationTimer);
            simCalibrationTimer = null;
            simCalibrationState.active = false;
            simCalibrationState.calibratedSlots[slotKey] = true;
            simCalibrationState.trainedAt[slotKey] = new Date().toISOString();
            showCalibrationNotice(`Simulasi kalibrasi slot ${SLOT_METAS[slotKey]?.label || slotKey} selesai (100%).`);
        }
        applySimulationStep(true);
    }, 500);
}

function cancelSimulatedCalibration() {
    if (simCalibrationTimer) {
        clearInterval(simCalibrationTimer);
        simCalibrationTimer = null;
    }
    simCalibrationState.active = false;
    simCalibrationState.samples = 0;
    showCalibrationNotice("Simulasi pengumpulan data dibatalkan.");
    applySimulationStep(true);
}

if (elBtnCalibrationAction) {
    elBtnCalibrationAction.addEventListener("click", () => {
        if (isSimulationMode) {
            if (simCalibrationState.active) {
                cancelSimulatedCalibration();
            } else {
                startSimulatedCalibration(currentTargetSlotKey);
            }
            return;
        }

        const status = String(latestServerData?.calibration_status || "").toUpperCase();
        if (status === "KALIBRASI BERLANGSUNG") {
            if (window.confirm("Batalkan pengumpulan data kalibrasi?")) {
                sendCalibrationAction("/api/calibration/cancel", "Pembatalan kalibrasi");
            }
            return;
        }

        if (!isServerConnected || !isEsp32Online) {
            showCalibrationNotice("Ambil data kalibrasi memerlukan koneksi ESP32 fisik (atau aktifkan Mode Simulasi).");
            return;
        }

        const slotName = currentTargetSlotLabel.toUpperCase();
        if (window.confirm(`Mulai mengambil 100 sampel normal untuk slot ${slotName}?`)) {
            sendCalibrationAction(
                `/api/calibration/start?slot=${encodeURIComponent(currentTargetSlotKey)}`,
                `Kalibrasi ${currentTargetSlotLabel}`
            );
        }
    });
}

if (elBtnCalibrationReset) {
    elBtnCalibrationReset.addEventListener("click", () => {
        if (isSimulationMode) {
            simCalibrationState.calibratedSlots[currentTargetSlotKey] = false;
            simCalibrationState.trainedAt[currentTargetSlotKey] = null;
            if (elAiSlotPopover) elAiSlotPopover.hidden = true;
            showCalibrationNotice(`Slot ${currentTargetSlotLabel} direset ke Default (Simulasi).`);
            applySimulationStep();
            return;
        }
        if (window.confirm(`Reset dataset & model kalibrasi slot ${currentTargetSlotLabel.toUpperCase()} ke default?`)) {
            sendCalibrationAction(
                `/api/calibration/reset?slot=${encodeURIComponent(currentTargetSlotKey)}`,
                `Reset slot ${currentTargetSlotLabel}`
            );
            if (elAiSlotPopover) elAiSlotPopover.hidden = true;
        }
    });
}

if (elBtnAiSlotMenu && elAiSlotPopover) {
    elBtnAiSlotMenu.addEventListener("click", (e) => {
        e.stopPropagation();
        const isHidden = elAiSlotPopover.hidden;
        elAiSlotPopover.hidden = !isHidden;
        elBtnAiSlotMenu.setAttribute("aria-expanded", String(isHidden));
    });
}

// ==================== HISTORY TABLE (5 COLUMNS, NO EXHAUST FAN) ====================
function renderHistoryTable() {
    if (!elHistoryTbody) return;

    const rows = historyData.slice(-10).reverse();
    const htmlRows = rows.map(item => `
        <tr class="is-data-row">
            <td>${item.time}</td>
            <td>${Number(item.suhu).toFixed(1)}&deg;C</td>
            <td>${Math.round(item.kelembapan)}%</td>
            <td>${item.gas}</td>
            <td>${item.cahaya}</td>
        </tr>
    `);

    const placeholdersNeeded = Math.max(0, MIN_HISTORY_ROWS - htmlRows.length);
    for (let i = 0; i < placeholdersNeeded; i++) {
        htmlRows.push(`
            <tr class="is-placeholder-row" aria-hidden="true">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
            </tr>
        `);
    }

    elHistoryTbody.innerHTML = htmlRows.join("");
}

// ==================== SYSTEM INFO ====================
function formatSystemLastUpdate() {
    if (!isServerConnected && !isSimulationMode) return "-";
    if (isSimulationMode) {
        const now = new Date();
        return `${now.getDate()} ${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`;
    }
    if (!lastSeenTime || lastSeenTime === "-" || lastSeenTime === "Belum ada data") {
        const now = new Date();
        return `${now.getDate()} ${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`;
    }
    const now = new Date();
    return `${now.getDate()} ${MONTHS_ID[now.getMonth()]} ${now.getFullYear()} • ${lastSeenTime}`;
}

function updateSystemInfo(success) {
    if (isSimulationMode) {
        if (elSysServerStatus) {
            elSysServerStatus.textContent = "Mode Simulasi";
            elSysServerStatus.className = "info-val val-status-sim";
        }
        if (elSysEspStatus) {
            elSysEspStatus.textContent = "Simulasi Demo";
            elSysEspStatus.className = "info-val val-status-sim";
        }
        if (elSysLastUpdate) elSysLastUpdate.textContent = formatSystemLastUpdate();
        return;
    }

    if (success) {
        if (elSysServerStatus) {
            elSysServerStatus.textContent = "Terhubung";
            elSysServerStatus.className = "info-val val-status-ok";
        }
        if (elSysEspStatus) {
            elSysEspStatus.textContent = isEsp32Online ? "Terhubung" : "Offline";
            elSysEspStatus.className = isEsp32Online ? "info-val val-status-ok" : "info-val val-status-err";
        }
        if (elSysLastUpdate) elSysLastUpdate.textContent = formatSystemLastUpdate();
    } else {
        if (elSysServerStatus) {
            elSysServerStatus.textContent = "Terputus";
            elSysServerStatus.className = "info-val val-status-err";
        }
        if (elSysEspStatus) {
            elSysEspStatus.textContent = "Offline";
            elSysEspStatus.className = "info-val val-status-err";
        }
    }
}

// ==================== SMOOTH CANVAS TREND CHART ====================
function setupCanvasResolution() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.resetTransform?.();
    ctx.scale(dpr, dpr);
    return rect;
}

function drawChart() {
    const rect = setupCanvasResolution();
    if (!rect) return;

    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 14, right: 14, bottom: 16, left: 42 };
    const chartW = Math.max(40, width - padding.left - padding.right);
    const chartH = Math.max(40, height - padding.top - padding.bottom);

    let minY = 20;
    let maxY = 100;
    let unitLabel = "%";

    if (activeMetric === "suhu") {
        minY = 15; maxY = 45; unitLabel = "°C";
    } else if (activeMetric === "kelembapan") {
        minY = 20; maxY = 100; unitLabel = "%";
    } else if (activeMetric === "gas") {
        minY = 0; maxY = 4095; unitLabel = "";
    } else if (activeMetric === "cahaya") {
        minY = 0; maxY = 4095; unitLabel = "";
    }

    const gridLines = 4;
    ctx.strokeStyle = CHART_COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = CHART_COLORS.axis;
    ctx.font = "500 12px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "right";

    for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartH / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        const val = maxY - ((maxY - minY) / gridLines) * i;
        ctx.fillText(Math.round(val) + unitLabel, padding.left - 8, y + 3.5);
    }

    if (historyData.length < 2) {
        ctx.fillStyle = "rgba(181, 175, 169, 0.55)";
        ctx.font = "500 11.5px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "center";
        ctx.fillText("Menunggu titik data riwayat sensor...", padding.left + chartW / 2, padding.top + chartH / 2 + 4);
        return;
    }

    const getX = (index) => padding.left + (index / (historyData.length - 1)) * chartW;
    const getY = (val) => {
        const clamped = Math.max(minY, Math.min(maxY, val));
        return padding.top + chartH - ((clamped - minY) / (maxY - minY)) * chartH;
    };

    if (activeMetric === "all" || activeMetric === "suhu") {
        const values = historyData.map(d => activeMetric === "all" ? (d.suhu / 45) * 100 : d.suhu);
        drawSmoothSeries(values, CHART_COLORS.suhu, getX, getY);
    }
    if (activeMetric === "all" || activeMetric === "kelembapan") {
        const values = historyData.map(d => d.kelembapan);
        drawSmoothSeries(values, CHART_COLORS.kelembapan, getX, getY);
    }
    if (activeMetric === "all" || activeMetric === "gas") {
        const values = historyData.map(d => activeMetric === "all" ? (d.gas / 4095) * 100 : d.gas);
        drawSmoothSeries(values, CHART_COLORS.gas, getX, getY);
    }
    if (activeMetric === "all" || activeMetric === "cahaya") {
        const values = historyData.map(d => activeMetric === "all" ? (d.cahaya / 4095) * 100 : d.cahaya);
        drawSmoothSeries(values, CHART_COLORS.cahaya, getX, getY);
    }
}

function drawSmoothSeries(values, color, getX, getY) {
    if (values.length < 2) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(getX(0), getY(values[0]));

    for (let i = 1; i < values.length - 1; i++) {
        const xc = (getX(i) + getX(i + 1)) / 2;
        const yc = (getY(values[i]) + getY(values[i + 1])) / 2;
        ctx.quadraticCurveTo(getX(i), getY(values[i]), xc, yc);
    }

    const last = values.length - 1;
    ctx.lineTo(getX(last), getY(values[last]));
    ctx.stroke();
    ctx.restore();
}

function setActiveMetric(metric) {
    activeMetric = metric || "all";
    tabButtons.forEach(b => b.classList.toggle("active", b.dataset.metric === activeMetric));
    legendItems.forEach(item => {
        const series = item.dataset.series;
        item.classList.toggle("is-dimmed", activeMetric !== "all" && series !== activeMetric);
    });
    drawChart();
}

tabButtons.forEach(btn => {
    btn.addEventListener("click", () => setActiveMetric(btn.dataset.metric));
});

// ==================== SIMULATION MODE & POPOVER ====================
const SIM_SCENARIOS = {
    normal: {
        suhu: 26.6,
        kelembapan: 54,
        cahaya: 920,
        gas: 460,
        led: "OFF",
        kipas: "OFF",
        buzzer: "OFF",
        ai_status: "NORMAL",
        ai_score: 90.0,
        ai_status_desc: "Kondisi normal tidak ada anomali"
    },
    dark: {
        suhu: 25.4,
        kelembapan: 55,
        cahaya: 2850,
        gas: 490,
        led: "ON",
        kipas: "OFF",
        buzzer: "OFF",
        ai_status: "NORMAL",
        ai_score: 92.0,
        ai_status_desc: "Kondisi normal tidak ada anomali"
    },
    humid: {
        suhu: 28.2,
        kelembapan: 68,
        cahaya: 1050,
        gas: 520,
        led: "OFF",
        kipas: "ON",
        buzzer: "OFF",
        ai_status: "NORMAL",
        ai_score: 86.0,
        ai_status_desc: "Kelembapan meningkat, kipas otomatis menyedot udara"
    },
    gas: {
        suhu: 31.8,
        kelembapan: 62,
        cahaya: 1180,
        gas: 3650,
        led: "OFF",
        kipas: "ON",
        buzzer: "ON",
        ai_status: "ANOMALI",
        ai_score: 42.0,
        ai_status_desc: "Indikasi gas tinggi terdeteksi pada kamar"
    },
    anomaly: {
        suhu: 33.4,
        kelembapan: 30,
        cahaya: 3100,
        gas: 2350,
        led: "ON",
        kipas: "OFF",
        buzzer: "OFF",
        ai_status: "ANOMALI",
        ai_score: 36.0,
        ai_status_desc: "Pola suhu dan cahaya menyimpang dari kebiasaan kamar"
    },
    emergency: {
        suhu: 36.5,
        kelembapan: 72,
        cahaya: 2600,
        gas: 3950,
        led: "ON",
        kipas: "ON",
        buzzer: "ON",
        ai_status: "ANOMALI",
        ai_score: 18.0,
        ai_status_desc: "Darurat! Gas dan suhu ekstrem terdeteksi"
    }
};

function toggleSimulationMode() {
    isSimulationMode = !isSimulationMode;
    window.isSimulationModeActive = isSimulationMode;
    manualDeviceState.kipas = null;
    manualDeviceState.led = null;
    manualDeviceState.buzzer = null;

    if (elBtnToggleDemo) {
        elBtnToggleDemo.classList.toggle("is-on", isSimulationMode);
        elBtnToggleDemo.setAttribute("aria-checked", String(isSimulationMode));
    }
    if (elSimulationBar) elSimulationBar.hidden = !isSimulationMode;
    if (elStageSimStrip) elStageSimStrip.hidden = !isSimulationMode;

    if (isSimulationMode) {
        applySimulationStep();
        if (simulationInterval) clearInterval(simulationInterval);
        simulationInterval = setInterval(applySimulationStep, 2000);
    } else {
        if (simulationInterval) clearInterval(simulationInterval);
        if (simCalibrationTimer) {
            clearInterval(simCalibrationTimer);
            simCalibrationTimer = null;
        }
        simCalibrationState.active = false;
        historyData = [];
        fetchInitialHistory();
        fetchSensorData();
    }
}

function applySimulationStep(skipHistory = false) {
    const base = SIM_SCENARIOS[simulationScenario] || SIM_SCENARIOS.normal;
    const jitterSuhu = (Math.random() - 0.5) * 0.4;
    const jitterHum = (Math.random() - 0.5) * 1.0;
    const jitterLdr = Math.round((Math.random() - 0.5) * 30);
    const jitterGas = Math.round((Math.random() - 0.5) * 20);

    const activeSlot = getTimeSlotKeyForDate(new Date());
    const activeMeta = SLOT_METAS[activeSlot] || SLOT_METAS.pagi;
    const isCalibBusy = simCalibrationState.active;

    const simData = {
        suhu: Number((base.suhu + jitterSuhu).toFixed(1)),
        kelembapan: Math.round(base.kelembapan + jitterHum),
        cahaya: Math.max(0, base.cahaya + jitterLdr),
        gas: Math.max(0, base.gas + jitterGas),
        led: manualDeviceState.led || base.led,
        kipas: manualDeviceState.kipas || base.kipas,
        buzzer: manualDeviceState.buzzer || base.buzzer,
        buzzer_muted: manualDeviceState.buzzer === "OFF",
        esp32_online: true,
        last_seen: new Date().toLocaleTimeString("id-ID", { hour12: false }),
        ai_status: base.ai_status,
        ai_score: base.ai_score,
        ai_status_desc: base.ai_status_desc,
        ai_available: true,
        ai_active_slot: activeSlot,
        ai_active_slot_label: activeMeta.label,
        ai_active_slot_range: activeMeta.range,
        ai_model_trained_at: simCalibrationState.trainedAt[activeSlot] || null,
        calibration_status: isCalibBusy ? "KALIBRASI BERLANGSUNG" : "KALIBRASI BERHASIL",
        calibration_busy: isCalibBusy,
        calibration_samples: isCalibBusy ? simCalibrationState.samples : 100,
        calibration_target: 100,
        calibration_target_slot: isCalibBusy ? simCalibrationState.slotKey : activeSlot,
        ai_slots: {
            pagi: { key: "pagi", label: "Pagi", range: "05:00 - 11:00", is_calibrated: simCalibrationState.calibratedSlots.pagi, is_active_now: activeSlot === "pagi", samples: 100, trained_at: simCalibrationState.trainedAt.pagi },
            siang: { key: "siang", label: "Siang", range: "11:00 - 15:00", is_calibrated: simCalibrationState.calibratedSlots.siang, is_active_now: activeSlot === "siang", samples: 100, trained_at: simCalibrationState.trainedAt.siang },
            sore: { key: "sore", label: "Sore", range: "15:00 - 18:30", is_calibrated: simCalibrationState.calibratedSlots.sore, is_active_now: activeSlot === "sore", samples: 100, trained_at: simCalibrationState.trainedAt.sore },
            malam: { key: "malam", label: "Malam", range: "18:30 - 05:00", is_calibrated: simCalibrationState.calibratedSlots.malam, is_active_now: activeSlot === "malam", samples: 100, trained_at: simCalibrationState.trainedAt.malam }
        }
    };

    handleDataSuccess(simData, { skipHistory });
}

if (elBtnToggleDemo) {
    elBtnToggleDemo.addEventListener("click", toggleSimulationMode);
}

document.querySelectorAll(".sim-preset-btn[data-sim]").forEach(btn => {
    btn.addEventListener("click", () => {
        simulationScenario = btn.dataset.sim;
        manualDeviceState.kipas = null;
        manualDeviceState.led = null;
        manualDeviceState.buzzer = null;
        document.querySelectorAll(".sim-preset-btn[data-sim]").forEach(b => {
            b.classList.toggle("is-active", b.dataset.sim === simulationScenario);
        });
        applySimulationStep();
        if (window.Room3D && typeof window.Room3D.focusScenario === "function") {
            window.Room3D.focusScenario(simulationScenario);
        }
    });
});

// Status Popover Toggle & Outside Click Close
if (elConnectionPill && elStatusPopover) {
    elConnectionPill.addEventListener("click", (e) => {
        e.stopPropagation();
        const isHidden = elStatusPopover.hidden;
        elStatusPopover.hidden = !isHidden;
        elConnectionPill.setAttribute("aria-expanded", String(isHidden));
        if (elAiSlotPopover) elAiSlotPopover.hidden = true;
    });
}

document.addEventListener("click", (e) => {
    if (elStatusPopover && !elStatusPopover.hidden && elStatusMenuWrap && !elStatusMenuWrap.contains(e.target)) {
        elStatusPopover.hidden = true;
        if (elConnectionPill) elConnectionPill.setAttribute("aria-expanded", "false");
    }
    if (elAiSlotPopover && !elAiSlotPopover.hidden && !elAiSlotPopover.contains(e.target) && e.target !== elBtnAiSlotMenu && !elBtnAiSlotMenu?.contains(e.target)) {
        elAiSlotPopover.hidden = true;
        if (elBtnAiSlotMenu) elBtnAiSlotMenu.setAttribute("aria-expanded", "false");
    }
});

if (elBtnRefresh) {
    elBtnRefresh.addEventListener("click", () => {
        fetchSensorData();
    });
}

window.addEventListener("resize", () => {
    drawChart();
});

// ==================== SIDEBAR NAVIGATION & SCROLLSPY ====================
function setActiveNav(id) {
    navItems.forEach(item => {
        const active = item.dataset.nav === id;
        item.classList.toggle("is-active", active);
        const icon = item.querySelector(".material-symbols-rounded");
        if (icon) icon.classList.toggle("icon-filled", active);
    });
}

navItems.forEach(item => {
    item.addEventListener("click", (event) => {
        const id = item.dataset.nav;
        const target = document.getElementById(id);
        if (!target) return;
        event.preventDefault();
        setActiveNav(id);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
});

if ("IntersectionObserver" in window && pageSections.length) {
    const navObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                setActiveNav(entry.target.id);
            }
        });
    }, { rootMargin: "-40% 0px -50% 0px", threshold: 0 });

    pageSections.forEach(section => navObserver.observe(section));
}

// ==================== INIT ====================
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
        // Fallback jika database belum aktif
    }
}

renderHistoryTable();
drawChart();
fetchInitialHistory();
fetchSensorData();
setInterval(fetchSensorData, POLLING_INTERVAL);
