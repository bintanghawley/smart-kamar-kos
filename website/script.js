const API_URL = "/api/data";
const POLLING_INTERVAL = 2000;
const MAX_HISTORY = 40;
const MIN_HISTORY_ROWS = 8;

const GAS_THRESHOLD = 3500;
const LDR_THRESHOLD = 2000;
const HUMIDITY_THRESHOLD = 60;
const FAN_MANUAL_SNOOZE_MS = 30 * 60 * 1000;
const FAN_HUMIDITY_CLEAR_OFFSET = 2;
const LED_OFF_SNOOZE_MS = 8 * 60 * 60 * 1000;
const LED_ON_SNOOZE_MS = 2 * 60 * 60 * 1000;
const LED_BRIGHT_CLEAR_OFFSET = 200;
const ARC_LENGTH = 259.71;

const DAYS_ID = [
    "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"
];

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
let simFanSnoozeUntil = 0;
let simFanWaitHumidClear = false;
let simLedSnoozeUntil = 0;
let simLedWaitDarkClear = false;

// Guard anti-kedip: cegah respons polling /api/data lama menimpa klik manual terbaru
let dataFetchSeq = 0;
let latestAppliedFetchSeq = 0;
let controlMutationEpoch = 0;
let pendingControlRequests = 0;
let activeSensorFetchController = null;
const controlOptimisticHoldUntil = { kipas: 0, led: 0, buzzer: 0 };

function clearFanManualMeta() {
    manualDeviceState.kipas = null;
    simFanSnoozeUntil = 0;
    simFanWaitHumidClear = false;
}

function clearLedManualMeta() {
    manualDeviceState.led = null;
    simLedSnoozeUntil = 0;
    simLedWaitDarkClear = false;
}

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
const elSunCycleSwitch = document.getElementById("sun-cycle-switch");
const elBtnRefresh = document.getElementById("btn-refresh");
const elBtnWeeklySummary = document.getElementById("btn-weekly-summary");
const elWeeklyReportPage = document.getElementById("weekly-report");
const elBtnWeeklyBack = document.getElementById("btn-weekly-back");
const elWeeklySourcePill = document.getElementById("weekly-source-pill");
const elWeeklyWeekTabs = document.getElementById("weekly-week-tabs");
const elWeeklyRangeText = document.getElementById("weekly-range-text");
const elWeeklyHeroRange = document.getElementById("weekly-hero-range");
const elWeeklyHeroValue = document.getElementById("weekly-hero-value");
const elWeeklyHeroUnit = document.getElementById("weekly-hero-unit");
const elWeeklyHeroLabel = document.getElementById("weekly-hero-label");
const elWeeklyChartWrap = document.getElementById("weekly-chart-wrap");
const elWeeklyBarChart = document.getElementById("weekly-bar-chart");
const weeklyBarCtx = elWeeklyBarChart ? elWeeklyBarChart.getContext("2d") : null;
const elWeeklyChartTooltip = document.getElementById("weekly-chart-tooltip");
const elWeeklyEmptyHint = document.getElementById("weekly-empty-hint");
const elWeeklyAiStatusPill = document.getElementById("weekly-ai-status-pill");
const elWeeklyAiNarrative = document.getElementById("weekly-ai-narrative");
const elWeeklySlotsGrid = document.getElementById("weekly-slots-grid");
const elWeeklyAiBullets = document.getElementById("weekly-ai-bullets");
const elBtnWeeklyExport = document.getElementById("btn-weekly-export");
const elWeeklyHlTemp = document.getElementById("weekly-hl-temp");
const elWeeklyHlFan = document.getElementById("weekly-hl-fan");
const elWeeklyHlLed = document.getElementById("weekly-hl-led");
const elWeeklyHlInc = document.getElementById("weekly-hl-inc");
const elWeeklyDailyTbody = document.getElementById("weekly-daily-tbody");
const weeklyMetricTabs = document.querySelectorAll("[data-weekly-metric]");

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
const elActuatorAutoBar = document.getElementById("actuator-auto-bar");
const elActuatorAutoText = document.getElementById("actuator-auto-text");
const elBtnActuatorsAuto = document.getElementById("btn-actuators-auto");

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
    const dayName = DAYS_ID[now.getDay()];
    const day = now.getDate();
    const monthName = MONTHS_ID[now.getMonth()];
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");

    if (elHeaderDate) elHeaderDate.textContent = `${dayName}, ${day} ${monthName}`;
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
function beginControlMutation(devices) {
    controlMutationEpoch += 1;
    pendingControlRequests += 1;
    if (activeSensorFetchController) {
        activeSensorFetchController._abortedByControl = true;
        activeSensorFetchController.abort();
        activeSensorFetchController = null;
    }
    const holdUntil = Date.now() + 3000;
    devices.forEach((dev) => {
        if (dev in controlOptimisticHoldUntil) {
            controlOptimisticHoldUntil[dev] = holdUntil;
        }
    });
    return controlMutationEpoch;
}

async function fetchSensorData() {
    if (isSimulationMode || pendingControlRequests > 0) return;

    const reqSeq = ++dataFetchSeq;
    const reqEpoch = controlMutationEpoch;

    if (activeSensorFetchController) {
        activeSensorFetchController._abortedByControl = true;
        activeSensorFetchController.abort();
    }

    const controller = new AbortController();
    activeSensorFetchController = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, 2500);

    try {
        const response = await fetch(API_URL, {
            method: "GET",
            headers: { "Accept": "application/json" },
            cache: "no-store",
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Abaikan respons polling yang sudah kadaluwarsa oleh klik manual atau polling baru
        if (isSimulationMode || reqEpoch !== controlMutationEpoch || pendingControlRequests > 0 || reqSeq < latestAppliedFetchSeq) {
            return;
        }
        latestAppliedFetchSeq = reqSeq;
        handleDataSuccess(data);
    } catch (error) {
        clearTimeout(timeoutId);
        if (error?.name === "AbortError" && !timedOut) {
            return;
        }
        if (reqEpoch === controlMutationEpoch && pendingControlRequests === 0) {
            handleDataError(error);
        }
    } finally {
        if (activeSensorFetchController === controller) {
            activeSensorFetchController = null;
        }
    }
}

function getEffectiveActuatorState(serverData) {
    const online = Boolean(serverData.esp32_online) || isSimulationMode;
    const overrides = serverData.manual_overrides || {};

    const gasVal = Number(serverData.gas ?? 0);
    const humidVal = Number(serverData.kelembapan ?? 0);
    const ldrVal = Number(serverData.cahaya ?? 0);
    const gasThreshold = Number(serverData.gas_threshold ?? GAS_THRESHOLD);
    const ldrThreshold = Number(serverData.ldr_threshold ?? LDR_THRESHOLD);
    const humidThreshold = Number(serverData.humidity_threshold ?? HUMIDITY_THRESHOLD);

    // Auto-release manual Exhaust Fan OFF & Lampu ON/OFF saat bahaya, snooze habis, atau siklus baru
    const nowMs = Date.now();
    if (online && manualDeviceState.kipas === "OFF") {
        if (gasVal >= gasThreshold) {
            clearFanManualMeta();
        } else if (simFanSnoozeUntil > 0 && nowMs >= simFanSnoozeUntil) {
            clearFanManualMeta();
        } else if (isSimulationMode) {
            if (simFanWaitHumidClear) {
                if (humidVal < humidThreshold - FAN_HUMIDITY_CLEAR_OFFSET) {
                    simFanWaitHumidClear = false;
                }
            } else if (humidVal >= humidThreshold) {
                clearFanManualMeta();
            }
        }
    }

    if (online && (manualDeviceState.led === "ON" || manualDeviceState.led === "OFF")) {
        if (simLedSnoozeUntil > 0 && nowMs >= simLedSnoozeUntil) {
            clearLedManualMeta();
        } else if (isSimulationMode) {
            if (simLedWaitDarkClear) {
                if (ldrVal < ldrThreshold - LED_BRIGHT_CLEAR_OFFSET) {
                    clearLedManualMeta();
                }
            } else if (ldrVal >= ldrThreshold) {
                clearLedManualMeta();
            }
        }
    }

    const autoFan = gasVal >= gasThreshold || humidVal >= humidThreshold;
    const autoLed = ldrVal >= ldrThreshold;
    const autoBuzzer = gasVal >= gasThreshold;

    const resolveDevice = (key, rawVal, autoTrigger) => {
        if (manualDeviceState[key] === "ON" || manualDeviceState[key] === "OFF") {
            return manualDeviceState[key];
        }
        if (overrides[key] === "ON" || overrides[key] === "OFF") {
            return overrides[key];
        }
        if (!online) return "OFF";
        return (String(rawVal ?? "OFF").toUpperCase() === "ON" || autoTrigger) ? "ON" : "OFF";
    };

    const led = resolveDevice("led", serverData.led, autoLed);
    const kipas = resolveDevice("kipas", serverData.kipas, autoFan);
    let buzzer = resolveDevice("buzzer", serverData.buzzer, autoBuzzer);
    let buzzerMuted = Boolean(serverData.buzzer_muted) || buzzer === "MUTED";

    if (manualDeviceState.buzzer === "OFF" || overrides.buzzer === "OFF") {
        buzzerMuted = true;
        buzzer = gasVal >= gasThreshold ? "MUTED" : "OFF";
    } else if (manualDeviceState.buzzer === "ON" || overrides.buzzer === "ON") {
        buzzerMuted = false;
        buzzer = "ON";
    } else if (online && autoBuzzer && !buzzerMuted) {
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

    // Sinkronkan override dari server, lindungi klik manual yang baru dilakukan dari polling tertunda
    if (data.manual_overrides && !isSimulationMode) {
        const nowMs = Date.now();
        const mergedOverrides = { ...data.manual_overrides };
        ["led", "kipas", "buzzer"].forEach(dev => {
            const ov = mergedOverrides[dev];
            const serverOv = (ov === "ON" || ov === "OFF") ? ov : null;
            if (nowMs < controlOptimisticHoldUntil[dev] && serverOv !== manualDeviceState[dev]) {
                mergedOverrides[dev] = manualDeviceState[dev] || "AUTO";
                if (manualDeviceState[dev] === "ON" || manualDeviceState[dev] === "OFF") {
                    data[dev] = manualDeviceState[dev];
                    if (dev === "buzzer") {
                        data.buzzer_muted = manualDeviceState.buzzer === "OFF";
                    }
                }
            } else {
                manualDeviceState[dev] = serverOv;
                controlOptimisticHoldUntil[dev] = 0;
            }
        });
        data.manual_overrides = mergedOverrides;
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
    updateActuatorAutoBar(data);
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
    updateActuatorAutoBar();
    updateAIUI({ ai_available: false, ai_status: "TIDAK TERSEDIA" }, true);
}

// ==================== CONNECTION UI ====================
const mobileStatusQuery = window.matchMedia ? window.matchMedia("(max-width: 760px)") : null;

function updateConnectionUI() {
    if (!elConnectionPill || !elConnectionText) return;

    const isCompactMobile = mobileStatusQuery ? mobileStatusQuery.matches : window.innerWidth <= 760;

    if (isSimulationMode) {
        elConnectionPill.className = "status-pill status-sim";
        elConnectionText.textContent = isCompactMobile ? "Simulasi" : "Mode Simulasi";
    } else if (!isServerConnected) {
        elConnectionPill.className = "status-pill status-disconnected";
        elConnectionText.textContent = isCompactMobile ? "Offline" : "Server Terputus";
    } else if (isEsp32Online) {
        elConnectionPill.className = "status-pill status-connected";
        elConnectionText.textContent = isCompactMobile ? "Online" : "ESP32 Online";
    } else {
        elConnectionPill.className = "status-pill status-disconnected";
        elConnectionText.textContent = isCompactMobile ? "Offline" : "Perangkat Offline";
    }
}

if (mobileStatusQuery && mobileStatusQuery.addEventListener) {
    mobileStatusQuery.addEventListener("change", updateConnectionUI);
}
updateConnectionUI();

// ==================== KONDISI SAAT INI ====================
const CHECKING_DURATION_MS = 1000;
const OFFLINE_CHECK_DURATION_MS = 750;
const NUMERIC_GLIDE_DURATION_MS = 450;
const VERDICT_CHAR_STAGGER_MS = 80;

const conditionUiState = {
    hasCompletedFirstCheck: false,
    forceCheckingNext: true,
    forceCountFromZero: true,
    isChecking: false,
    animActive: false,
    wasOffline: null,
    lastVerdictText: null,
    lastSimScenario: null,
    rafId: null,
    displayedSuhu: null,
    displayedKelembapan: null,
    displayedAiScore: null,
    pendingTarget: null
};

function easeOutCubicVal(t) {
    return 1 - Math.pow(1 - t, 3);
}

function renderCheckingVerdict() {
    if (!elConditionVerdict) return;
    elConditionVerdict.className = "condition-verdict state-checking";
    elConditionVerdict.innerHTML = 'Checking<span class="checking-dots" aria-hidden="true"><span class="checking-dot">.</span><span class="checking-dot">.</span><span class="checking-dot">.</span></span>';
}

function renderVerdictPerChar(text, stateClass) {
    if (!elConditionVerdict) return;
    elConditionVerdict.className = `condition-verdict ${stateClass}`;
    elConditionVerdict.replaceChildren();

    Array.from(String(text || "")).forEach((ch, idx) => {
        const span = document.createElement("span");
        span.className = ch === " " ? "verdict-char is-space" : "verdict-char";
        span.style.animationDelay = `${idx * VERDICT_CHAR_STAGGER_MS}ms`;
        span.textContent = ch;
        elConditionVerdict.appendChild(span);
    });
}

function resolveConditionMeta(norm, raw, isOffline) {
    if (isOffline) {
        return {
            isOffline: true,
            text: "Siaga",
            cls: "state-offline",
            suhu: null,
            kelembapan: null,
            aiScore: null,
            gasText: "--",
            gasTrend: "trending_flat",
            cahayaText: "--",
            cahayaTrend: "trending_flat",
            suhuTitle: "Menunggu data DHT11",
            humTitle: "Menunggu data DHT11",
            gasTitle: "Menunggu data sensor gas MQ-2",
            cahayaTitle: "Menunggu data sensor cahaya LDR"
        };
    }

    const aiStatus = String(raw?.ai_status || "").toUpperCase();
    const isEmergency = norm.gas >= 3900 || (norm.gas >= GAS_THRESHOLD && norm.suhu >= 35);
    const isDanger = norm.gas >= GAS_THRESHOLD || norm.buzzer === "ON";
    const isWarning = norm.kelembapan >= HUMIDITY_THRESHOLD || norm.suhu > 30 || norm.gas >= 2200 || aiStatus === "ANOMALI";

    let text = "Luar Biasa";
    let cls = "state-excellent";
    if (isEmergency) {
        text = "Darurat";
        cls = "state-emergency";
    } else if (isDanger) {
        text = "Bahaya";
        cls = "state-danger";
    } else if (isWarning) {
        text = "Waspada";
        cls = "state-warning";
    }

    let gasText = "Rendah";
    let gasTrend = "trending_down";
    if (norm.gas >= GAS_THRESHOLD) {
        gasText = "Tinggi";
        gasTrend = "trending_up";
    } else if (norm.gas >= 2200) {
        gasText = "Sedang";
        gasTrend = "trending_up";
    }

    let cahayaText = "Tinggi";
    let cahayaTrend = "trending_up";
    if (norm.cahaya >= LDR_THRESHOLD) {
        cahayaText = "Rendah";
        cahayaTrend = "trending_down";
    } else if (norm.cahaya >= 1200) {
        cahayaText = "Sedang";
        cahayaTrend = "trending_flat";
    }

    const rawAi = raw?.ai_score;
    const aiScore = (rawAi !== null && rawAi !== undefined && Number.isFinite(Number(rawAi)))
        ? Number(rawAi)
        : null;

    return {
        isOffline: false,
        text,
        cls,
        suhu: Number(norm.suhu),
        kelembapan: Math.round(Number(norm.kelembapan)),
        aiScore,
        gasText,
        gasTrend,
        cahayaText,
        cahayaTrend,
        suhuTitle: `Suhu Kamar: ${Number(norm.suhu).toFixed(1)}°C`,
        humTitle: `Kelembapan: ${norm.kelembapan}% (Ambang kipas ≥ ${HUMIDITY_THRESHOLD}%)`,
        gasTitle: `Sensor MQ-2: ${norm.gas} ADC (Ambang bahaya ≥ ${GAS_THRESHOLD} ADC)`,
        cahayaTitle: `Sensor LDR: ${norm.cahaya} ADC (Ambang gelap ≥ ${LDR_THRESHOLD} ADC)`
    };
}

function triggerSoftWordRise(el) {
    if (!el) return;
    el.classList.remove("is-revealing");
    void el.offsetWidth;
    el.classList.add("is-revealing");
}

function applyGasAndLightCards(meta, animateChanged = false) {
    if (elCardStatSuhu) elCardStatSuhu.title = meta.suhuTitle;
    if (elCardStatKelembapan) elCardStatKelembapan.title = meta.humTitle;
    if (elCardStatGas) elCardStatGas.title = meta.gasTitle;
    if (elCardStatCahaya) elCardStatCahaya.title = meta.cahayaTitle;

    if (elStatGas && elTrendGas) {
        const changed = elStatGas.textContent !== meta.gasText;
        elStatGas.textContent = meta.gasText;
        elTrendGas.textContent = meta.gasTrend;
        if (animateChanged && (changed || meta.gasText !== "--")) {
            triggerSoftWordRise(elStatGas);
        }
    }

    if (elStatCahaya && elTrendCahaya) {
        const changed = elStatCahaya.textContent !== meta.cahayaText;
        elStatCahaya.textContent = meta.cahayaText;
        elTrendCahaya.textContent = meta.cahayaTrend;
        if (animateChanged && (changed || meta.cahayaText !== "--")) {
            triggerSoftWordRise(elStatCahaya);
        }
    }
}

function renderNumericFrame(suhuVal, humVal, aiVal) {
    if (suhuVal !== null && Number.isFinite(suhuVal)) {
        conditionUiState.displayedSuhu = suhuVal;
        if (elStatSuhu) elStatSuhu.textContent = suhuVal.toFixed(1);
    } else {
        conditionUiState.displayedSuhu = null;
        if (elStatSuhu) elStatSuhu.textContent = "--";
    }

    if (humVal !== null && Number.isFinite(humVal)) {
        conditionUiState.displayedKelembapan = humVal;
        if (elStatKelembapan) elStatKelembapan.textContent = String(Math.round(humVal));
    } else {
        conditionUiState.displayedKelembapan = null;
        if (elStatKelembapan) elStatKelembapan.textContent = "--";
    }

    if (aiVal !== null && Number.isFinite(aiVal)) {
        conditionUiState.displayedAiScore = aiVal;
        if (elAiScoreValue) elAiScoreValue.textContent = String(Math.round(aiVal));
    } else if (conditionUiState.pendingTarget?.isOffline) {
        conditionUiState.displayedAiScore = null;
        if (elAiScoreValue) elAiScoreValue.textContent = "--";
    }
}

function stopConditionAnim() {
    if (conditionUiState.rafId !== null) {
        cancelAnimationFrame(conditionUiState.rafId);
        conditionUiState.rafId = null;
    }
    conditionUiState.animActive = false;
}

function startConditionAnimation({ duration, withChecking, fromZero, initialMeta }) {
    stopConditionAnim();

    conditionUiState.pendingTarget = { ...initialMeta };
    conditionUiState.animActive = true;
    conditionUiState.isChecking = Boolean(withChecking);

    const startSuhu = initialMeta.isOffline ? null : (fromZero || conditionUiState.displayedSuhu === null ? 0 : conditionUiState.displayedSuhu);
    const startHum = initialMeta.isOffline ? null : (fromZero || conditionUiState.displayedKelembapan === null ? 0 : conditionUiState.displayedKelembapan);
    const startAi = (initialMeta.isOffline || initialMeta.aiScore === null)
        ? null
        : (fromZero || conditionUiState.displayedAiScore === null ? 0 : conditionUiState.displayedAiScore);

    if (initialMeta.isOffline) {
        renderNumericFrame(null, null, null);
        applyGasAndLightCards(initialMeta, false);
    } else {
        if (fromZero) {
            renderNumericFrame(0, 0, startAi);
        }
        if (elCardStatSuhu) elCardStatSuhu.title = initialMeta.suhuTitle;
        if (elCardStatKelembapan) elCardStatKelembapan.title = initialMeta.humTitle;
        if (elCardStatGas) elCardStatGas.title = initialMeta.gasTitle;
        if (elCardStatCahaya) elCardStatCahaya.title = initialMeta.cahayaTitle;
    }

    if (withChecking) {
        renderCheckingVerdict();
    }

    const startTime = performance.now();

    function step(now) {
        const target = conditionUiState.pendingTarget;
        if (!target) {
            stopConditionAnim();
            conditionUiState.isChecking = false;
            return;
        }

        const rawT = duration > 0 ? Math.min(1, (now - startTime) / duration) : 1;
        const ease = easeOutCubicVal(rawT);

        if (!target.isOffline) {
            const curSuhu = startSuhu !== null ? startSuhu + (target.suhu - startSuhu) * ease : target.suhu;
            const curHum = startHum !== null ? startHum + (target.kelembapan - startHum) * ease : target.kelembapan;
            const curAi = (target.aiScore !== null && startAi !== null)
                ? startAi + (target.aiScore - startAi) * ease
                : target.aiScore;
            renderNumericFrame(curSuhu, curHum, curAi);
        }

        if (rawT < 1) {
            conditionUiState.rafId = requestAnimationFrame(step);
            return;
        }

        conditionUiState.rafId = null;
        conditionUiState.animActive = false;
        conditionUiState.isChecking = false;

        renderNumericFrame(target.suhu, target.kelembapan, target.aiScore);
        if (!target.isOffline) {
            applyGasAndLightCards(target, withChecking);
        }
        if (withChecking) {
            renderVerdictPerChar(target.text, target.cls);
            conditionUiState.lastVerdictText = target.text;
        }
    }

    conditionUiState.rafId = requestAnimationFrame(step);
}

function updateConditionSection(norm, raw, isOffline) {
    if (!elConditionVerdict) return;

    const meta = resolveConditionMeta(norm, raw, isOffline);
    const currentScenario = isSimulationMode ? simulationScenario : null;

    const expectedVerdict = (conditionUiState.isChecking && conditionUiState.pendingTarget)
        ? conditionUiState.pendingTarget.text
        : conditionUiState.lastVerdictText;
    const isInitial = !conditionUiState.hasCompletedFirstCheck;
    const offlineToggled = conditionUiState.wasOffline !== null && conditionUiState.wasOffline !== isOffline;
    const scenarioChanged = isSimulationMode && conditionUiState.lastSimScenario !== currentScenario;
    const verdictChanged = expectedVerdict !== null && expectedVerdict !== meta.text;
    const forced = conditionUiState.forceCheckingNext;

    const needsChecking = isInitial || forced || offlineToggled || scenarioChanged || verdictChanged;
    const fromZero = !isOffline && (
        conditionUiState.forceCountFromZero ||
        isInitial ||
        conditionUiState.wasOffline === true ||
        conditionUiState.displayedSuhu === null
    );

    conditionUiState.hasCompletedFirstCheck = true;
    conditionUiState.forceCheckingNext = false;
    conditionUiState.forceCountFromZero = false;
    conditionUiState.wasOffline = isOffline;
    conditionUiState.lastSimScenario = currentScenario;

    if (needsChecking) {
        startConditionAnimation({
            duration: isOffline ? OFFLINE_CHECK_DURATION_MS : CHECKING_DURATION_MS,
            withChecking: true,
            fromZero,
            initialMeta: meta
        });
        return;
    }

    if (conditionUiState.isChecking && conditionUiState.animActive) {
        conditionUiState.pendingTarget = { ...meta };
        return;
    }

    conditionUiState.lastVerdictText = meta.text;

    if (isOffline) {
        stopConditionAnim();
        renderNumericFrame(null, null, null);
        applyGasAndLightCards(meta, false);
        if (elConditionVerdict.classList.contains("state-checking") || elConditionVerdict.textContent !== meta.text) {
            renderVerdictPerChar(meta.text, meta.cls);
        }
        return;
    }

    applyGasAndLightCards(meta, true);
    startConditionAnimation({
        duration: NUMERIC_GLIDE_DURATION_MS,
        withChecking: false,
        fromZero: false,
        initialMeta: meta
    });
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

function formatSnoozeRemaining(remSec) {
    if (!Number.isFinite(remSec) || remSec <= 0) return "";
    const totalMins = Math.max(1, Math.ceil(remSec / 60));
    if (totalMins >= 60) {
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return mins > 0 ? `${hours} jam ${mins} mnt` : `${hours} jam`;
    }
    return `${totalMins} mnt`;
}

function updateActuatorAutoBar(serverData = latestServerData) {
    if (!elActuatorAutoBar || !elActuatorAutoText) return;

    const labels = { kipas: "Exhaust Fan", led: "Lampu", buzzer: "Alarm" };
    const overrides = !isSimulationMode && serverData?.manual_overrides ? serverData.manual_overrides : {};
    const activeManual = ["kipas", "led", "buzzer"]
        .map(dev => {
            const val = (manualDeviceState[dev] === "ON" || manualDeviceState[dev] === "OFF")
                ? manualDeviceState[dev]
                : (overrides[dev] === "ON" || overrides[dev] === "OFF" ? overrides[dev] : null);
            if (!val) return null;
            if (dev === "kipas" && val === "OFF") {
                const remSec = isSimulationMode
                    ? (simFanSnoozeUntil > Date.now() ? Math.ceil((simFanSnoozeUntil - Date.now()) / 1000) : 0)
                    : Number(serverData?.kipas_snooze_remaining_sec ?? 0);
                const dur = formatSnoozeRemaining(remSec);
                return dur
                    ? `${labels[dev]} (OFF · auto lembap baru / ${dur})`
                    : `${labels[dev]} (OFF · auto lembap baru)`;
            }
            if (dev === "led") {
                const remSec = isSimulationMode
                    ? (simLedSnoozeUntil > Date.now() ? Math.ceil((simLedSnoozeUntil - Date.now()) / 1000) : 0)
                    : Number(serverData?.led_snooze_remaining_sec ?? 0);
                const dur = formatSnoozeRemaining(remSec);
                return dur
                    ? `${labels[dev]} (${val} · auto siklus cahaya / ${dur})`
                    : `${labels[dev]} (${val} · auto siklus cahaya)`;
            }
            return `${labels[dev]} (${val})`;
        })
        .filter(Boolean);

    elActuatorAutoBar.hidden = activeManual.length === 0;
    if (activeManual.length > 0) {
        elActuatorAutoText.textContent = `Kendali manual aktif: ${activeManual.join(", ")}`;
    }
}

function renderActuatorSnapshot(baseData) {
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
    updateActuatorAutoBar(baseData);
    if (window.Room3D && typeof window.Room3D.updateData === "function") {
        window.Room3D.updateData(previewNorm);
    }
}

async function resetActuatorsToAuto() {
    clearFanManualMeta();
    clearLedManualMeta();
    manualDeviceState.buzzer = null;

    if (isSimulationMode) {
        applySimulationStep(true);
        return;
    }

    const mutationEpoch = beginControlMutation(["kipas", "led", "buzzer"]);

    if (latestServerData) {
        latestServerData = {
            ...latestServerData,
            buzzer_muted: false,
            kipas_snooze_remaining_sec: 0,
            led_snooze_remaining_sec: 0,
            manual_overrides: { led: "AUTO", kipas: "AUTO", buzzer: "AUTO" }
        };
        renderActuatorSnapshot(latestServerData);
    }

    try {
        const res = await fetch("/api/device/control", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ device: "all", state: "AUTO" })
        });
        if (res.ok && mutationEpoch === controlMutationEpoch) {
            const ctrl = await res.json();
            if (latestServerData && ctrl.manual_overrides && mutationEpoch === controlMutationEpoch) {
                latestServerData = {
                    ...latestServerData,
                    buzzer_muted: Boolean(ctrl.buzzer_muted),
                    kipas_snooze_remaining_sec: Number(ctrl.kipas_snooze_remaining_sec ?? 0),
                    led_snooze_remaining_sec: Number(ctrl.led_snooze_remaining_sec ?? 0),
                    manual_overrides: { ...ctrl.manual_overrides }
                };
            }
        }
    } catch (err) {
        if (mutationEpoch === controlMutationEpoch) {
            if (latestServerData) {
                renderActuatorSnapshot(latestServerData);
            } else {
                updateActuatorAutoBar();
            }
        }
    } finally {
        pendingControlRequests = Math.max(0, pendingControlRequests - 1);
        if (pendingControlRequests === 0 && mutationEpoch === controlMutationEpoch) {
            await fetchSensorData();
        }
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
        esp32_online: false,
        manual_overrides: { led: "AUTO", kipas: "AUTO", buzzer: "AUTO" }
    };

    if (device === "kipas") {
        if (nextState === "OFF") {
            const curHumid = Number(baseData.kelembapan ?? 0);
            const humidThresh = Number(baseData.humidity_threshold ?? HUMIDITY_THRESHOLD);
            simFanSnoozeUntil = Date.now() + FAN_MANUAL_SNOOZE_MS;
            simFanWaitHumidClear = curHumid >= humidThresh;
            baseData.kipas_snooze_remaining_sec = Math.round(FAN_MANUAL_SNOOZE_MS / 1000);
        } else {
            simFanSnoozeUntil = 0;
            simFanWaitHumidClear = false;
            baseData.kipas_snooze_remaining_sec = 0;
        }
    } else if (device === "led") {
        const curLdr = Number(baseData.cahaya ?? 0);
        const ldrThresh = Number(baseData.ldr_threshold ?? LDR_THRESHOLD);
        const snoozeMs = nextState === "OFF" ? LED_OFF_SNOOZE_MS : LED_ON_SNOOZE_MS;
        simLedSnoozeUntil = Date.now() + snoozeMs;
        simLedWaitDarkClear = curLdr >= ldrThresh;
        baseData.led_snooze_remaining_sec = Math.round(snoozeMs / 1000);
    }

    baseData[device] = nextState;
    baseData.manual_overrides = {
        ...(baseData.manual_overrides || { led: "AUTO", kipas: "AUTO", buzzer: "AUTO" }),
        [device]: nextState
    };
    if (device === "buzzer") {
        baseData.buzzer_muted = nextState === "OFF";
    }

    if (isSimulationMode) {
        latestServerData = baseData;
        handleDataSuccess(baseData, { skipHistory: true });
        return;
    }

    const mutationEpoch = beginControlMutation([device]);
    latestServerData = baseData;
    renderActuatorSnapshot(baseData);

    try {
        const res = await fetch("/api/device/control", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ device, state: nextState })
        });
        if (res.ok && mutationEpoch === controlMutationEpoch) {
            const ctrl = await res.json();
            if (ctrl && ctrl.manual_overrides && mutationEpoch === controlMutationEpoch) {
                const confirmedState = String(ctrl.state || nextState).toUpperCase();
                const confirmedOv = ctrl.manual_overrides[device];
                manualDeviceState[device] = (confirmedOv === "ON" || confirmedOv === "OFF") ? confirmedOv : null;
                if (manualDeviceState[device] === nextState) {
                    controlOptimisticHoldUntil[device] = Date.now() + 1200;
                } else {
                    controlOptimisticHoldUntil[device] = 0;
                }
                latestServerData = {
                    ...(latestServerData || baseData),
                    [device]: confirmedState,
                    buzzer_muted: ctrl.buzzer_muted !== undefined ? Boolean(ctrl.buzzer_muted) : (latestServerData?.buzzer_muted ?? false),
                    manual_overrides: { ...ctrl.manual_overrides },
                    kipas_snooze_remaining_sec: Number(ctrl.kipas_snooze_remaining_sec ?? latestServerData?.kipas_snooze_remaining_sec ?? 0),
                    led_snooze_remaining_sec: Number(ctrl.led_snooze_remaining_sec ?? latestServerData?.led_snooze_remaining_sec ?? 0)
                };
                renderActuatorSnapshot(latestServerData);
            }
        }
    } catch (err) {
        // Mode preview offline: pertahankan toggle manual lokal
    } finally {
        pendingControlRequests = Math.max(0, pendingControlRequests - 1);
    }
}

if (elBtnActuatorsAuto) {
    elBtnActuatorsAuto.addEventListener("click", resetActuatorsToAuto);
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
        if (scoreVal === null) {
            conditionUiState.displayedAiScore = null;
            elAiScoreValue.textContent = "--";
        } else if (conditionUiState.animActive && conditionUiState.pendingTarget) {
            conditionUiState.pendingTarget.aiScore = scoreVal;
        } else {
            conditionUiState.displayedAiScore = scoreVal;
            elAiScoreValue.textContent = String(Math.round(scoreVal));
        }
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
function setupCanvasResolution(targetCanvas = canvas, targetCtx = ctx) {
    if (!targetCanvas || !targetCtx) return null;
    const dpr = window.devicePixelRatio || 1;
    const rect = targetCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    targetCanvas.width = rect.width * dpr;
    targetCanvas.height = rect.height * dpr;
    targetCtx.resetTransform?.();
    targetCtx.scale(dpr, dpr);
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
    clearFanManualMeta();
    clearLedManualMeta();
    manualDeviceState.buzzer = null;

    if (elBtnToggleDemo) {
        elBtnToggleDemo.classList.toggle("is-on", isSimulationMode);
        elBtnToggleDemo.setAttribute("aria-checked", String(isSimulationMode));
    }
    if (elSimulationBar) elSimulationBar.hidden = !isSimulationMode;
    if (elStageSimStrip) elStageSimStrip.hidden = !isSimulationMode;
    if (elSunCycleSwitch) elSunCycleSwitch.hidden = !isSimulationMode;

    conditionUiState.forceCheckingNext = true;
    if (isSimulationMode) {
        conditionUiState.forceCountFromZero = true;
        applySimulationStep();
        if (simulationInterval) clearInterval(simulationInterval);
        simulationInterval = setInterval(applySimulationStep, 2000);
    } else {
        if (simulationInterval) clearInterval(simulationInterval);
        if (simCalibrationTimer) {
            clearInterval(simCalibrationTimer);
            simCalibrationTimer = null;
        }
        if (window.Room3D && typeof window.Room3D.setSunTime === "function") {
            window.Room3D.setSunTime("auto");
        }
        simCalibrationState.active = false;
        historyData = [];
        fetchInitialHistory();
        fetchSensorData();
    }

    if (currentAppPage === "weekly") {
        loadWeeklySummary();
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
        conditionUiState.forceCheckingNext = true;
        clearFanManualMeta();
        clearLedManualMeta();
        manualDeviceState.buzzer = null;
        document.querySelectorAll(".sim-preset-btn[data-sim]").forEach(b => {
            b.classList.toggle("is-active", b.dataset.sim === simulationScenario);
        });
        if (isSimulationMode) {
            if (simulationInterval) clearInterval(simulationInterval);
            simulationInterval = setInterval(applySimulationStep, 2000);
        }
        applySimulationStep();
    });
});

// ==================== WEEKLY REPORT PAGE CONTROLLER ====================
const WEEK_DAYS_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const WEEK_DAYS_FULL = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

const WEEKLY_METRIC_META = {
    suhu: {
        label: "Rata-rata Suhu",
        unit: "°C",
        color: CHART_COLORS.suhu,
        avgKey: "suhu_avg",
        minKey: "suhu_min",
        maxKey: "suhu_max",
        decimals: 1,
        minY: 20,
        defaultMaxY: 36,
        stepY: 5
    },
    kelembapan: {
        label: "Rata-rata Kelembapan",
        unit: "%",
        color: CHART_COLORS.kelembapan,
        avgKey: "kelembapan_avg",
        minKey: "kelembapan_min",
        maxKey: "kelembapan_max",
        decimals: 0,
        minY: 0,
        defaultMaxY: 100,
        stepY: 25
    },
    gas: {
        label: "Rata-rata Gas",
        unit: "ADC",
        color: CHART_COLORS.gas,
        avgKey: "gas_avg",
        maxKey: "gas_max",
        decimals: 0,
        minY: 0,
        defaultMaxY: 1200,
        stepY: 500
    },
    cahaya: {
        label: "Rata-rata Cahaya",
        unit: "ADC",
        color: CHART_COLORS.cahaya,
        avgKey: "cahaya_avg",
        maxKey: "cahaya_max",
        decimals: 0,
        minY: 0,
        defaultMaxY: 4000,
        stepY: 1000
    }
};

let currentAppPage = "dashboard";
const weeklyState = {
    selectedYear: null,
    selectedWeek: null,
    activeMetric: "suhu",
    selectedDayIdx: null,
    payload: null,
    barHitboxes: [],
    animRafId: null
};

function getIsoWeekInfo(dateObj = new Date()) {
    const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
}

function getMondayOfIsoWeek(isoYear, isoWeek) {
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (isoWeek - 1) * 7);
    return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
}

function getRecentWeeksMetadata(numWeeks = 4) {
    const curr = getIsoWeekInfo(new Date());
    const currMonday = getMondayOfIsoWeek(curr.year, curr.week);
    const weeks = [];
    for (let offset = -(numWeeks - 1); offset <= 0; offset++) {
        const monday = new Date(currMonday);
        monday.setDate(currMonday.getDate() + offset * 7);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const info = getIsoWeekInfo(monday);
        weeks.push({
            key: `${info.year}-W${String(info.week).padStart(2, "0")}`,
            year: info.year,
            week: info.week,
            label: `W${String(info.week).padStart(2, "0")}`,
            monday,
            sunday,
            range_label: `${monday.getDate()} ${MONTHS_ID[monday.getMonth()]} - ${sunday.getDate()} ${MONTHS_ID[sunday.getMonth()]} (Week ${info.week})`,
            is_current: offset === 0
        });
    }
    return weeks;
}

function formatMetricNumber(val, decimals = 1) {
    if (val === null || val === undefined || !Number.isFinite(Number(val))) return "--";
    return Number(val).toFixed(decimals);
}

function buildSimulatedWeeklySummary(isoYear, isoWeek) {
    const available = getRecentWeeksMetadata(4);
    const matched = available.find((w) => w.year === isoYear && w.week === isoWeek) || available[available.length - 1];
    const seed = matched.week;

    // Distinct weekly profile per week number so week selector feels genuinely alive
    const tempBase = 26.8 + ((seed % 4) * 0.45);
    const humBase = 57 + ((seed % 3) * 3);
    const gasBias = seed % 2 === 0 ? 480 : 540;
    const anomDay = (seed + 2) % 7;

    const days = [];
    for (let idx = 0; idx < 7; idx++) {
        const dayDate = new Date(matched.monday);
        dayDate.setDate(matched.monday.getDate() + idx);
        const wave = Math.sin((idx + seed) * 0.95);
        const suhuAvg = Number((tempBase + wave * 1.6).toFixed(1));
        const suhuMin = Number((suhuAvg - (2.3 + (idx % 2) * 0.5)).toFixed(1));
        const suhuMax = Number((suhuAvg + (3.1 + ((idx + seed) % 3) * 0.6)).toFixed(1));
        const humAvg = Math.round(Math.min(82, Math.max(46, humBase - wave * 5 + (idx === 5 ? 6 : 0))));
        const humMax = Math.min(90, humAvg + 12);
        const gasAvg = Math.round(gasBias + ((idx * 37 + seed * 19) % 140));
        const gasMax = gasAvg + 110;
        const cahayaAvg = Math.round(1350 + Math.cos((idx + seed) * 0.8) * 320);
        const isAnom = idx === anomDay;
        const aiScoreAvg = isAnom ? 74.5 : Number((91 + ((idx + seed) % 5) * 1.2).toFixed(1));
        const kipasPct = humAvg >= 60 ? Math.min(48, 18 + (humAvg - 58) * 2) : 8;
        const ledPct = 36 + ((idx + seed) % 10);

        const localDateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;
        days.push({
            date: localDateStr,
            day_index: idx,
            day_short: WEEK_DAYS_SHORT[idx],
            day_full: WEEK_DAYS_FULL[idx],
            date_label: `${dayDate.getDate()} ${MONTHS_ID[dayDate.getMonth()].slice(0, 3)}`,
            sample_count: 180 + idx * 14,
            suhu_avg: suhuAvg,
            suhu_min: suhuMin,
            suhu_max: suhuMax,
            kelembapan_avg: humAvg,
            kelembapan_min: Math.max(40, humAvg - 9),
            kelembapan_max: humMax,
            gas_avg: gasAvg,
            gas_max: gasMax,
            cahaya_avg: cahayaAvg,
            cahaya_max: cahayaAvg + 950,
            ai_score_avg: aiScoreAvg,
            anomaly_count: isAnom ? 1 : 0,
            gas_danger_count: 0,
            kipas_pct: kipasPct,
            led_pct: ledPct
        });
    }

    const avg = (arr) => Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1));
    return {
        status: "OK",
        source: "simulation",
        has_data: true,
        week: {
            key: matched.key,
            year: matched.year,
            week: matched.week,
            label: matched.label,
            range_label: matched.range_label
        },
        available_weeks: available.map((w) => ({
            key: w.key,
            year: w.year,
            week: w.week,
            label: w.label,
            range_label: w.range_label,
            is_current: w.is_current
        })),
        totals: {
            total_samples: days.reduce((s, d) => s + d.sample_count, 0),
            days_with_data: 7,
            suhu_avg: avg(days.map((d) => d.suhu_avg)),
            suhu_min: Math.min(...days.map((d) => d.suhu_min)),
            suhu_max: Math.max(...days.map((d) => d.suhu_max)),
            kelembapan_avg: avg(days.map((d) => d.kelembapan_avg)),
            kelembapan_max: Math.max(...days.map((d) => d.kelembapan_max)),
            gas_avg: Math.round(avg(days.map((d) => d.gas_avg))),
            gas_max: Math.max(...days.map((d) => d.gas_max)),
            cahaya_avg: Math.round(avg(days.map((d) => d.cahaya_avg))),
            cahaya_max: Math.max(...days.map((d) => d.cahaya_max)),
            ai_score_avg: avg(days.map((d) => d.ai_score_avg)),
            kipas_pct_avg: Math.round(avg(days.map((d) => d.kipas_pct))),
            led_pct_avg: Math.round(avg(days.map((d) => d.led_pct))),
            gas_incidents: 0,
            ai_anomalies: days.reduce((s, d) => s + d.anomaly_count, 0)
        },
        days,
        time_slots: {
            pagi: { sample_count: 340, suhu_avg: Number((tempBase - 1.5).toFixed(1)), kelembapan_avg: humBase - 3 },
            siang: { sample_count: 360, suhu_avg: Number((tempBase + 2.8).toFixed(1)), kelembapan_avg: humBase - 8 },
            sore: { sample_count: 310, suhu_avg: Number((tempBase + 0.6).toFixed(1)), kelembapan_avg: humBase + 2 },
            malam: { sample_count: 420, suhu_avg: Number((tempBase - 0.9).toFixed(1)), kelembapan_avg: humBase + 8 }
        }
    };
}

function mergeSessionHistoryIntoWeeklyPayload(payload) {
    if (!payload || payload.has_data || !Array.isArray(historyData) || !historyData.length) return payload;
    const curr = getIsoWeekInfo(new Date());
    if (payload.week?.year !== curr.year || payload.week?.week !== curr.week) return payload;

    const valid = historyData.filter((d) => Number.isFinite(Number(d?.suhu)) && Number.isFinite(Number(d?.kelembapan)));
    if (!valid.length) return payload;

    const jsDay = new Date().getDay(); // 0=Sun..6=Sat
    const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
    const targetDay = payload.days?.[dayIdx];
    if (!targetDay) return payload;

    const temps = valid.map((d) => Number(d.suhu));
    const hums = valid.map((d) => Number(d.kelembapan));
    const gases = valid.map((d) => Number(d.gas || 0));
    const lights = valid.map((d) => Number(d.cahaya || 0));
    const kipasOn = valid.filter((d) => String(d.kipas || "").toUpperCase() === "ON").length;
    const ledOn = valid.filter((d) => String(d.led || "").toUpperCase() === "ON").length;

    const avgArr = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    targetDay.sample_count = valid.length;
    targetDay.suhu_avg = Number(avgArr(temps).toFixed(1));
    targetDay.suhu_min = Number(Math.min(...temps).toFixed(1));
    targetDay.suhu_max = Number(Math.max(...temps).toFixed(1));
    targetDay.kelembapan_avg = Number(avgArr(hums).toFixed(1));
    targetDay.kelembapan_max = Number(Math.max(...hums).toFixed(1));
    targetDay.gas_avg = Math.round(avgArr(gases));
    targetDay.gas_max = Math.max(...gases);
    targetDay.cahaya_avg = Math.round(avgArr(lights));
    targetDay.kipas_pct = Math.round((kipasOn / valid.length) * 100);
    targetDay.led_pct = Math.round((ledOn / valid.length) * 100);
    targetDay.gas_danger_count = gases.filter((g) => g >= GAS_THRESHOLD).length;
    targetDay.ai_score_avg = latestServerData?.ai_score != null ? Number(latestServerData.ai_score) : null;

    payload.has_data = true;
    payload.source = "session";
    payload.totals = {
        total_samples: valid.length,
        days_with_data: 1,
        suhu_avg: targetDay.suhu_avg,
        suhu_min: targetDay.suhu_min,
        suhu_max: targetDay.suhu_max,
        kelembapan_avg: targetDay.kelembapan_avg,
        kelembapan_max: targetDay.kelembapan_max,
        gas_avg: targetDay.gas_avg,
        gas_max: targetDay.gas_max,
        cahaya_avg: targetDay.cahaya_avg,
        cahaya_max: Math.max(...lights),
        ai_score_avg: targetDay.ai_score_avg,
        kipas_pct_avg: targetDay.kipas_pct,
        led_pct_avg: targetDay.led_pct,
        gas_incidents: targetDay.gas_danger_count,
        ai_anomalies: targetDay.anomaly_count
    };
    return payload;
}

function renderWeeklyWeekTabs(payload) {
    if (!elWeeklyWeekTabs) return;
    const weeks = Array.isArray(payload?.available_weeks) && payload.available_weeks.length
        ? payload.available_weeks
        : getRecentWeeksMetadata(4);
    const activeKey = payload?.week?.key;

    elWeeklyWeekTabs.innerHTML = weeks.map((w) => {
        const isActive = w.key === activeKey;
        return `<button type="button" class="weekly-week-btn${isActive ? " is-active" : ""}" role="tab" aria-selected="${isActive}" data-wy="${w.year}" data-ww="${w.week}">${w.label}</button>`;
    }).join("");

    elWeeklyWeekTabs.querySelectorAll(".weekly-week-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            weeklyState.selectedYear = Number(btn.dataset.wy);
            weeklyState.selectedWeek = Number(btn.dataset.ww);
            weeklyState.selectedDayIdx = null;
            hideWeeklyChartTooltip();
            loadWeeklySummary();
        });
    });

    if (elWeeklyRangeText) {
        elWeeklyRangeText.textContent = payload?.week?.range_label || "-";
    }
    if (elWeeklySourcePill) {
        const isSim = payload?.source === "simulation";
        elWeeklySourcePill.hidden = !isSim;
        if (isSim) elWeeklySourcePill.textContent = "Simulasi";
    }
}

function hideWeeklyChartTooltip() {
    if (elWeeklyChartTooltip) elWeeklyChartTooltip.hidden = true;
}

function showWeeklyChartTooltip(day, metricMeta) {
    if (!elWeeklyChartTooltip || !day || day.sample_count <= 0) {
        hideWeeklyChartTooltip();
        return;
    }
    const avgVal = day[metricMeta.avgKey];
    const extraMinMax = (weeklyState.activeMetric === "suhu" && day.suhu_min != null && day.suhu_max != null)
        ? ` · Min ${day.suhu_min}° / Maks ${day.suhu_max}°`
        : (day[metricMeta.maxKey] != null ? ` · Maks ${formatMetricNumber(day[metricMeta.maxKey], metricMeta.decimals)}${metricMeta.unit === "%" || metricMeta.unit === "°C" ? metricMeta.unit : " " + metricMeta.unit}` : "");
    const unitDisplay = metricMeta.unit === "ADC" ? " ADC" : metricMeta.unit;

    elWeeklyChartTooltip.textContent = `${day.day_full}, ${day.date_label}: ${formatMetricNumber(avgVal, metricMeta.decimals)}${unitDisplay}${extraMinMax}`;
    elWeeklyChartTooltip.hidden = false;
}

function drawRoundedCapsule(ctxRef, x, y, w, h, radius) {
    if (h <= 0 || w <= 0) return;
    const r = Math.min(radius, w / 2, h / 2);
    ctxRef.beginPath();
    if (typeof ctxRef.roundRect === "function") {
        ctxRef.roundRect(x, y, w, h, r);
    } else {
        ctxRef.moveTo(x + r, y);
        ctxRef.lineTo(x + w - r, y);
        ctxRef.quadraticCurveTo(x + w, y, x + w, y + r);
        ctxRef.lineTo(x + w, y + h - r);
        ctxRef.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctxRef.lineTo(x + r, y + h);
        ctxRef.quadraticCurveTo(x, y + h, x, y + h - r);
        ctxRef.lineTo(x, y + r);
        ctxRef.quadraticCurveTo(x, y, x + r, y);
    }
    ctxRef.closePath();
}

function drawWeeklyBarChart(animOpts = null) {
    const payload = weeklyState.payload;
    const meta = WEEKLY_METRIC_META[weeklyState.activeMetric] || WEEKLY_METRIC_META.suhu;
    const totals = payload?.totals || {};
    const days = Array.isArray(payload?.days) ? payload.days : [];
    const barFactors = animOpts?.barFactors || null;
    const avgAlpha = animOpts?.avgAlpha !== undefined ? animOpts.avgAlpha : 1;
    const skipHeroText = Boolean(animOpts?.skipHeroText);

    // Hero average & min/max meta
    const heroVal = totals[meta.avgKey];
    if (elWeeklyHeroValue && !skipHeroText) {
        elWeeklyHeroValue.textContent = formatMetricNumber(heroVal, meta.decimals);
    }
    if (elWeeklyHeroUnit) elWeeklyHeroUnit.textContent = meta.unit;
    if (elWeeklyHeroLabel) elWeeklyHeroLabel.textContent = meta.label;
    if (elWeeklyHeroRange) {
        if (weeklyState.activeMetric === "suhu") {
            elWeeklyHeroRange.textContent = `Min ${formatMetricNumber(totals.suhu_min, 1)}° · Maks ${formatMetricNumber(totals.suhu_max, 1)}°`;
        } else if (weeklyState.activeMetric === "kelembapan") {
            elWeeklyHeroRange.textContent = `Puncak ${formatMetricNumber(totals.kelembapan_max, 0)}% · ${totals.days_with_data || 0} hari data`;
        } else if (weeklyState.activeMetric === "gas") {
            elWeeklyHeroRange.textContent = `Puncak ${formatMetricNumber(totals.gas_max, 0)} ADC · Ambang ${GAS_THRESHOLD}`;
        } else {
            elWeeklyHeroRange.textContent = `Puncak ${formatMetricNumber(totals.cahaya_max, 0)} ADC · Ambang ${LDR_THRESHOLD}`;
        }
    }

    if (elWeeklyEmptyHint) {
        const showEmptyHint = !payload?.has_data;
        elWeeklyEmptyHint.hidden = !showEmptyHint;
        if (showEmptyHint) {
            elWeeklyEmptyHint.textContent = "Belum ada telemetri tersimpan untuk minggu ini. Aktifkan Mode Simulasi pada menu status untuk melihat pratinjau penuh.";
        }
    }

    const rect = setupCanvasResolution(elWeeklyBarChart, weeklyBarCtx);
    if (!rect || !weeklyBarCtx) return;

    const width = rect.width;
    const height = rect.height;
    weeklyBarCtx.clearRect(0, 0, width, height);
    weeklyState.barHitboxes = [];

    const pad = { top: 20, right: 54, bottom: 28, left: 6 };
    const plotW = Math.max(60, width - pad.left - pad.right);
    const plotH = Math.max(60, height - pad.top - pad.bottom);

    const values = days.map((d) => (d.sample_count > 0 && d[meta.avgKey] != null ? Number(d[meta.avgKey]) : null));
    const numericVals = values.filter((v) => v !== null && Number.isFinite(v));

    let minY = meta.minY;
    let maxY = meta.defaultMaxY;
    if (numericVals.length) {
        const peak = Math.max(...numericVals);
        const valley = Math.min(...numericVals);
        if (weeklyState.activeMetric === "suhu") {
            minY = Math.min(20, Math.floor((valley - 2) / 5) * 5);
            maxY = Math.max(35, Math.ceil((peak + 2) / 5) * 5);
        } else if (weeklyState.activeMetric === "gas" || weeklyState.activeMetric === "cahaya") {
            maxY = Math.max(1000, Math.ceil((peak * 1.2) / 500) * 500);
        }
    }

    // Horizontal gridlines & right-side labels
    const gridLines = 4;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    weeklyBarCtx.strokeStyle = CHART_COLORS.grid;
    weeklyBarCtx.lineWidth = 1;
    weeklyBarCtx.fillStyle = CHART_COLORS.axis;
    weeklyBarCtx.font = `500 11px ${fontFamily}`;
    weeklyBarCtx.textAlign = "left";
    weeklyBarCtx.textBaseline = "middle";

    for (let i = 0; i <= gridLines; i++) {
        const y = pad.top + (plotH / gridLines) * i;
        weeklyBarCtx.beginPath();
        weeklyBarCtx.moveTo(pad.left, y);
        weeklyBarCtx.lineTo(pad.left + plotW, y);
        weeklyBarCtx.stroke();

        const tickVal = maxY - ((maxY - minY) / gridLines) * i;
        const unitStr = meta.unit === "ADC" ? "" : meta.unit;
        weeklyBarCtx.fillText(`${Math.round(tickVal)}${unitStr}`, pad.left + plotW + 10, y);
    }

    const colCount = 7;
    const colStep = plotW / colCount;
    const barW = Math.min(24, Math.max(11, Math.round(colStep * 0.42)));

    // Background tracks & actual day bars
    for (let i = 0; i < colCount; i++) {
        const day = days[i] || { day_short: WEEK_DAYS_SHORT[i], sample_count: 0 };
        const centerX = pad.left + colStep * i + colStep / 2;
        const barX = centerX - barW / 2;

        // Subtle capsule track
        weeklyBarCtx.fillStyle = "rgba(255, 255, 255, 0.045)";
        drawRoundedCapsule(weeklyBarCtx, barX, pad.top, barW, plotH, barW / 2);
        weeklyBarCtx.fill();

        const val = values[i];
        const isSelected = weeklyState.selectedDayIdx === i;
        const grow = barFactors ? Math.max(0, Math.min(1, barFactors[i] ?? 1)) : 1;

        if (val !== null && grow > 0.01) {
            const ratio = Math.max(0.06, Math.min(1, (val - minY) / Math.max(1, maxY - minY)));
            const fullBarH = Math.max(barW, ratio * plotH);
            const barH = Math.max(barW * 0.55, fullBarH * grow);
            const barY = pad.top + plotH - barH;

            weeklyBarCtx.save();
            weeklyBarCtx.globalAlpha = Math.min(1, 0.35 + grow * 0.65);
            weeklyBarCtx.fillStyle = meta.color;
            if (isSelected) {
                weeklyBarCtx.shadowColor = meta.color;
                weeklyBarCtx.shadowBlur = 12;
            }
            drawRoundedCapsule(weeklyBarCtx, barX, barY, barW, barH, barW / 2);
            weeklyBarCtx.fill();

            if (isSelected) {
                weeklyBarCtx.shadowBlur = 0;
                weeklyBarCtx.strokeStyle = "#ffffff";
                weeklyBarCtx.lineWidth = 1.6;
                weeklyBarCtx.stroke();
            }
            weeklyBarCtx.restore();
        }

        // Day X-axis label
        weeklyBarCtx.fillStyle = isSelected ? "#ffffff" : CHART_COLORS.axis;
        weeklyBarCtx.font = `${isSelected ? "700" : "500"} 11.5px ${fontFamily}`;
        weeklyBarCtx.textAlign = "center";
        weeklyBarCtx.textBaseline = "top";
        weeklyBarCtx.fillText(day.day_short || WEEK_DAYS_SHORT[i], centerX, pad.top + plotH + 9);

        weeklyState.barHitboxes.push({
            idx: i,
            x1: pad.left + colStep * i,
            x2: pad.left + colStep * (i + 1),
            y1: pad.top,
            y2: pad.top + plotH
        });
    }

    // Horizontal dashed Average Benchmark Line across the 7 bars
    if (heroVal !== null && heroVal !== undefined && Number.isFinite(Number(heroVal)) && numericVals.length && avgAlpha > 0.02) {
        const avgNum = Number(heroVal);
        const avgRatio = Math.max(0, Math.min(1, (avgNum - minY) / Math.max(1, maxY - minY)));
        const avgY = pad.top + plotH - avgRatio * plotH;

        weeklyBarCtx.save();
        weeklyBarCtx.globalAlpha = avgAlpha;
        weeklyBarCtx.strokeStyle = "rgba(255, 255, 255, 0.72)";
        weeklyBarCtx.lineWidth = 1.4;
        weeklyBarCtx.setLineDash([5, 5]);
        weeklyBarCtx.beginPath();
        weeklyBarCtx.moveTo(pad.left, avgY);
        weeklyBarCtx.lineTo(pad.left + plotW, avgY);
        weeklyBarCtx.stroke();
        weeklyBarCtx.setLineDash([]);

        const unitTxt = meta.unit === "ADC" ? " ADC" : meta.unit;
        const badgeText = `Rata-rata ${formatMetricNumber(avgNum, meta.decimals)}${unitTxt}`;
        weeklyBarCtx.font = `600 10.5px ${fontFamily}`;
        const badgeW = weeklyBarCtx.measureText(badgeText).width + 14;
        const badgeH = 19;
        const badgeX = pad.left + plotW - badgeW - 4;
        const badgeY = avgY - badgeH - 5 >= pad.top ? avgY - badgeH - 5 : avgY + 5;

        weeklyBarCtx.fillStyle = "rgba(18, 16, 15, 0.88)";
        drawRoundedCapsule(weeklyBarCtx, badgeX, badgeY, badgeW, badgeH, 9.5);
        weeklyBarCtx.fill();
        weeklyBarCtx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        weeklyBarCtx.lineWidth = 1;
        weeklyBarCtx.stroke();

        weeklyBarCtx.fillStyle = "#f5f2ef";
        weeklyBarCtx.textAlign = "center";
        weeklyBarCtx.textBaseline = "middle";
        weeklyBarCtx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5);
        weeklyBarCtx.restore();
    }
}

function animateWeeklyEntrance() {
    if (weeklyState.animRafId) {
        cancelAnimationFrame(weeklyState.animRafId);
        weeklyState.animRafId = null;
    }

    const payload = weeklyState.payload;
    const meta = WEEKLY_METRIC_META[weeklyState.activeMetric] || WEEKLY_METRIC_META.suhu;
    const targetRaw = payload?.totals?.[meta.avgKey];
    const targetVal = (targetRaw !== null && targetRaw !== undefined && Number.isFinite(Number(targetRaw)))
        ? Number(targetRaw)
        : null;
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || !payload?.has_data || targetVal === null) {
        drawWeeklyBarChart();
        return;
    }

    const totalDuration = 720;
    const staggerMs = 42;
    const perBarDuration = totalDuration - staggerMs * 6;
    const startTs = performance.now();

    const step = (now) => {
        if (currentAppPage !== "weekly") {
            weeklyState.animRafId = null;
            return;
        }
        const elapsed = now - startTs;
        const globalT = Math.min(1, elapsed / totalDuration);
        const easedCount = 1 - Math.pow(1 - globalT, 3);

        if (elWeeklyHeroValue) {
            elWeeklyHeroValue.textContent = formatMetricNumber(targetVal * easedCount, meta.decimals);
        }

        const barFactors = [];
        for (let i = 0; i < 7; i++) {
            const localElapsed = Math.max(0, elapsed - i * staggerMs);
            const localT = Math.min(1, localElapsed / perBarDuration);
            barFactors.push(1 - Math.pow(1 - localT, 3));
        }

        drawWeeklyBarChart({
            barFactors,
            avgAlpha: Math.min(1, Math.max(0, (globalT - 0.15) / 0.65)),
            skipHeroText: true
        });

        if (globalT < 1) {
            weeklyState.animRafId = requestAnimationFrame(step);
        } else {
            weeklyState.animRafId = null;
            drawWeeklyBarChart();
        }
    };

    weeklyState.animRafId = requestAnimationFrame(step);
}

function renderWeeklyRecap() {
    const payload = weeklyState.payload;
    const totals = payload?.totals || {};
    const days = Array.isArray(payload?.days) ? payload.days : [];

    if (elWeeklyHlTemp) {
        elWeeklyHlTemp.textContent = totals.suhu_min != null && totals.suhu_max != null
            ? `${formatMetricNumber(totals.suhu_min, 1)}° / ${formatMetricNumber(totals.suhu_max, 1)}°C`
            : "-- / --°C";
    }
    if (elWeeklyHlFan) {
        elWeeklyHlFan.textContent = payload?.has_data ? `${totals.kipas_pct_avg || 0}% waktu` : "--";
    }
    if (elWeeklyHlLed) {
        elWeeklyHlLed.textContent = payload?.has_data ? `${totals.led_pct_avg || 0}% waktu` : "--";
    }
    if (elWeeklyHlInc) {
        elWeeklyHlInc.textContent = `${totals.gas_incidents || 0} Gas · ${totals.ai_anomalies || 0} AI`;
    }

    if (!elWeeklyDailyTbody) return;
    elWeeklyDailyTbody.innerHTML = days.map((d, idx) => {
        const hasRow = d.sample_count > 0;
        const isSelected = weeklyState.selectedDayIdx === idx;
        const tempCell = hasRow
            ? `<strong>${formatMetricNumber(d.suhu_avg, 1)}°</strong> <small style="color:var(--text-muted)">/${formatMetricNumber(d.suhu_max, 1)}°</small>`
            : `<span style="color:var(--text-muted)">--</span>`;
        const humCell = hasRow ? `${Math.round(d.kelembapan_avg)}%` : `<span style="color:var(--text-muted)">--</span>`;

        let gasBadge = `<span class="weekly-badge is-muted">--</span>`;
        if (hasRow) {
            if (d.gas_danger_count > 0 || (d.gas_max || 0) >= GAS_THRESHOLD) {
                gasBadge = `<span class="weekly-badge is-danger">${d.gas_max}</span>`;
            } else {
                gasBadge = `<span class="weekly-badge is-ok">${d.gas_max}</span>`;
            }
        }

        let aiBadge = `<span class="weekly-badge is-muted">--</span>`;
        if (hasRow) {
            if (d.anomaly_count > 0) {
                aiBadge = `<span class="weekly-badge is-warn">Anomali</span>`;
            } else {
                aiBadge = `<span class="weekly-badge is-ok">Normal</span>`;
            }
        }

        return `
            <tr class="${isSelected ? "is-selected-day" : ""}" data-day-idx="${idx}">
                <td><strong>${d.day_short}</strong> <small style="color:var(--text-muted)">${d.date_label || ""}</small></td>
                <td>${tempCell}</td>
                <td>${humCell}</td>
                <td>${gasBadge}</td>
                <td>${aiBadge}</td>
            </tr>
        `;
    }).join("");

    elWeeklyDailyTbody.querySelectorAll("tr[data-day-idx]").forEach((tr) => {
        tr.addEventListener("click", () => {
            const idx = Number(tr.dataset.dayIdx);
            weeklyState.selectedDayIdx = weeklyState.selectedDayIdx === idx ? null : idx;
            const meta = WEEKLY_METRIC_META[weeklyState.activeMetric] || WEEKLY_METRIC_META.suhu;
            if (weeklyState.selectedDayIdx !== null) {
                showWeeklyChartTooltip(days[idx], meta);
            } else {
                hideWeeklyChartTooltip();
            }
            drawWeeklyBarChart();
            renderWeeklyRecap();
        });
    });
}

function renderWeeklyAISummary() {
    const payload = weeklyState.payload;
    const totals = payload?.totals || {};
    const days = Array.isArray(payload?.days) ? payload.days.filter((d) => d.sample_count > 0) : [];
    const slots = payload?.time_slots || {};

    // Stability pill
    if (elWeeklyAiStatusPill) {
        elWeeklyAiStatusPill.classList.remove("is-warning", "is-danger");
        if (!payload?.has_data) {
            elWeeklyAiStatusPill.textContent = "Menunggu Data";
        } else {
            const score = totals.ai_score_avg != null ? `${Math.round(totals.ai_score_avg)}%` : "--%";
            if ((totals.gas_incidents || 0) > 0) {
                elWeeklyAiStatusPill.textContent = `Waspada · ${score}`;
                elWeeklyAiStatusPill.classList.add("is-danger");
            } else if ((totals.ai_anomalies || 0) > 0) {
                elWeeklyAiStatusPill.textContent = `Perlu Pantau · ${score}`;
                elWeeklyAiStatusPill.classList.add("is-warning");
            } else {
                elWeeklyAiStatusPill.textContent = `Stabil · ${score}`;
            }
        }
    }

    // 4-Slot Pola Waktu Grid
    if (elWeeklySlotsGrid) {
        elWeeklySlotsGrid.innerHTML = ["pagi", "siang", "sore", "malam"].map((key) => {
            const meta = SLOT_METAS[key];
            const s = slots[key] || {};
            const hasSlot = (s.sample_count || 0) > 0 && s.suhu_avg != null;
            const valText = hasSlot ? `${formatMetricNumber(s.suhu_avg, 1)}°C · ${Math.round(s.kelembapan_avg)}%` : "--";
            return `
                <div class="weekly-slot-tile">
                    <span class="material-symbols-rounded icon-filled" aria-hidden="true">${meta.icon}</span>
                    <div class="weekly-slot-tile-info">
                        <span>${meta.label}</span>
                        <strong>${valText}</strong>
                    </div>
                </div>
            `;
        }).join("");
    }

    // Narrative & Bullets
    if (!days.length) {
        if (elWeeklyAiNarrative) {
            elWeeklyAiNarrative.textContent = "Belum terdapat cukup riwayat telemetri pada minggu ini untuk menyusun ringkasan pola harian kamar kos.";
        }
        if (elWeeklyAiBullets) {
            elWeeklyAiBullets.innerHTML = `
                <li><span class="material-symbols-rounded" aria-hidden="true">info</span><span>Pastikan perangkat ESP32 mengirimkan data atau aktifkan Mode Simulasi untuk melihat contoh analisis AI mingguan.</span></li>
            `;
        }
        return;
    }

    const hottest = days.reduce((a, b) => ((b.suhu_max ?? -99) > (a.suhu_max ?? -99) ? b : a), days[0]);
    const mostHumid = days.reduce((a, b) => ((b.kelembapan_avg ?? -1) > (a.kelembapan_avg ?? -1) ? b : a), days[0]);

    if (elWeeklyAiNarrative) {
        const gasText = (totals.gas_incidents || 0) > 0
            ? `tercatat ${totals.gas_incidents} insiden gas tinggi`
            : "kualitas udara aman tanpa kebocoran gas";
        elWeeklyAiNarrative.textContent = `Sepanjang ${payload.week?.label || "minggu ini"}, suhu kamar rata-rata berada di ${formatMetricNumber(totals.suhu_avg, 1)}°C dengan puncak terpanas pada hari ${hottest.day_full} (${formatMetricNumber(hottest.suhu_max, 1)}°C). Kelembapan rata-rata terjaga pada ${Math.round(totals.kelembapan_avg)}% dengan ${gasText}.`;
    }

    if (elWeeklyAiBullets) {
        const coolest = days.reduce((a, b) => ((b.suhu_min ?? 99) < (a.suhu_min ?? 99) ? b : a), days[0]);
        const bullets = [
            {
                cls: "",
                icon: "thermostat",
                text: `Hari paling sejuk/nyaman tercatat ${coolest.day_full} (${formatMetricNumber(totals.suhu_min, 1)}°C), sedangkan puncak panas di hari ${hottest.day_full} (${formatMetricNumber(hottest.suhu_max, 1)}°C).`
            },
            {
                cls: mostHumid.kelembapan_avg >= HUMIDITY_THRESHOLD ? "is-warn" : "",
                icon: "air",
                text: `Kelembapan tertinggi muncul pada hari ${mostHumid.day_full} (${Math.round(mostHumid.kelembapan_avg)}%). Exhaust Fan aktif otomatis sekitar ${totals.kipas_pct_avg}% waktu pengamatan.`
            },
            {
                cls: (totals.ai_anomalies || 0) > 0 ? "is-warn" : "",
                icon: (totals.ai_anomalies || 0) > 0 ? "warning" : "verified_user",
                text: (totals.ai_anomalies || 0) > 0
                    ? `Model AI mendeteksi ${totals.ai_anomalies} kejadian pola sensor tidak biasa; periksa baris hari yang ditandai di Rekap 7 Hari.`
                    : `Seluruh hari menunjukkan pola normal sesuai kebiasaan kamar (tidak ada penyimpangan anomali AI).`
            }
        ];
        elWeeklyAiBullets.innerHTML = bullets.map((b) => `
            <li class="${b.cls}">
                <span class="material-symbols-rounded" aria-hidden="true">${b.icon}</span>
                <span>${b.text}</span>
            </li>
        `).join("");
    }
}

function renderWeeklyPageAll() {
    if (!weeklyState.payload) return;
    renderWeeklyWeekTabs(weeklyState.payload);
    animateWeeklyEntrance();
    renderWeeklyRecap();
    renderWeeklyAISummary();
}

async function loadWeeklySummary() {
    if (weeklyState.selectedYear === null || weeklyState.selectedWeek === null) {
        const curr = getIsoWeekInfo(new Date());
        weeklyState.selectedYear = curr.year;
        weeklyState.selectedWeek = curr.week;
    }

    if (isSimulationMode) {
        weeklyState.payload = buildSimulatedWeeklySummary(weeklyState.selectedYear, weeklyState.selectedWeek);
        renderWeeklyPageAll();
        return;
    }

    try {
        const qs = `year=${encodeURIComponent(weeklyState.selectedYear)}&week=${encodeURIComponent(weeklyState.selectedWeek)}`;
        const response = await fetch(`/api/summary/weekly?${qs}`, {
            headers: { "Accept": "application/json" }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let payload = await response.json();
        payload = mergeSessionHistoryIntoWeeklyPayload(payload);
        weeklyState.payload = payload;
        renderWeeklyPageAll();
    } catch (err) {
        // Fallback offline skeleton so UI stays clean without throwing runtime errors
        const fallback = {
            status: "OK",
            source: "offline",
            has_data: false,
            week: getRecentWeeksMetadata(4).find((w) => w.year === weeklyState.selectedYear && w.week === weeklyState.selectedWeek) || getRecentWeeksMetadata(4)[3],
            available_weeks: getRecentWeeksMetadata(4),
            totals: {},
            days: WEEK_DAYS_SHORT.map((s, idx) => ({
                day_index: idx,
                day_short: s,
                day_full: WEEK_DAYS_FULL[idx],
                date_label: "",
                sample_count: 0,
                anomaly_count: 0,
                gas_danger_count: 0
            })),
            time_slots: {}
        };
        weeklyState.payload = mergeSessionHistoryIntoWeeklyPayload(fallback);
        renderWeeklyPageAll();
    }
}

function setAppPage(page) {
    currentAppPage = page === "weekly" ? "weekly" : "dashboard";
    const isWeekly = currentAppPage === "weekly";

    document.body.classList.toggle("is-weekly-page", isWeekly);
    if (elWeeklyReportPage) elWeeklyReportPage.hidden = !isWeekly;

    if (elBtnWeeklySummary) {
        elBtnWeeklySummary.classList.toggle("is-active", isWeekly);
        elBtnWeeklySummary.setAttribute("aria-pressed", String(isWeekly));
    }

    if (elStatusPopover) elStatusPopover.hidden = true;
    if (elConnectionPill) elConnectionPill.setAttribute("aria-expanded", "false");
    if (elAiSlotPopover) elAiSlotPopover.hidden = true;
    if (elBtnAiSlotMenu) elBtnAiSlotMenu.setAttribute("aria-expanded", "false");

    window.scrollTo({ top: 0, behavior: "auto" });

    if (isWeekly) {
        loadWeeklySummary();
    } else {
        if (weeklyState.animRafId) {
            cancelAnimationFrame(weeklyState.animRafId);
            weeklyState.animRafId = null;
        }
        requestAnimationFrame(() => drawChart());
    }
}

if (elBtnWeeklySummary) {
    elBtnWeeklySummary.addEventListener("click", (e) => {
        e.stopPropagation();
        setAppPage(currentAppPage === "weekly" ? "dashboard" : "weekly");
    });
}

if (elBtnWeeklyBack) {
    elBtnWeeklyBack.addEventListener("click", () => {
        setAppPage("dashboard");
    });
}

weeklyMetricTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
        const metric = btn.dataset.weeklyMetric;
        if (!metric || !(metric in WEEKLY_METRIC_META)) return;
        weeklyState.activeMetric = metric;
        weeklyMetricTabs.forEach((b) => b.classList.toggle("active", b.dataset.weeklyMetric === metric));
        hideWeeklyChartTooltip();
        animateWeeklyEntrance();
    });
});

if (elWeeklyBarChart) {
    const pickBarFromEvent = (clientX) => {
        const rect = elWeeklyBarChart.getBoundingClientRect();
        const relX = clientX - rect.left;
        return weeklyState.barHitboxes.find((b) => relX >= b.x1 && relX <= b.x2) || null;
    };

    elWeeklyBarChart.addEventListener("click", (e) => {
        const hit = pickBarFromEvent(e.clientX);
        if (!hit) return;
        weeklyState.selectedDayIdx = weeklyState.selectedDayIdx === hit.idx ? null : hit.idx;
        const meta = WEEKLY_METRIC_META[weeklyState.activeMetric] || WEEKLY_METRIC_META.suhu;
        const days = weeklyState.payload?.days || [];
        if (weeklyState.selectedDayIdx !== null) {
            showWeeklyChartTooltip(days[hit.idx], meta);
        } else {
            hideWeeklyChartTooltip();
        }
        drawWeeklyBarChart();
        renderWeeklyRecap();
    });
}

if (elBtnWeeklyExport) {
    elBtnWeeklyExport.addEventListener("click", () => {
        const payload = weeklyState.payload;
        if (!payload) return;
        if (isSimulationMode) {
            const headers = ["Hari", "Tanggal", "Suhu Rata2", "Suhu Min", "Suhu Maks", "Kelembapan (%)", "Gas Maks", "Skor AI (%)"];
            const lines = [headers.join(",")];
            (payload.days || []).forEach((d) => {
                lines.push([d.day_full, d.date || "", d.suhu_avg ?? "", d.suhu_min ?? "", d.suhu_max ?? "", d.kelembapan_avg ?? "", d.gas_max ?? "", d.ai_score_avg ?? ""].join(","));
            });
            const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `rekap_mingguan_${payload.week?.label || "sim"}_simulasi.csv`;
            a.click();
            URL.revokeObjectURL(url);
            return;
        }
        const y = weeklyState.selectedYear || "";
        const w = weeklyState.selectedWeek || "";
        window.location.href = `/api/export/weekly-csv?year=${encodeURIComponent(y)}&week=${encodeURIComponent(w)}`;
    });
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentAppPage === "weekly" && !(window.Room3D?.is3DFullscreen?.())) {
        setAppPage("dashboard");
    }
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
        conditionUiState.forceCheckingNext = true;
        conditionUiState.forceCountFromZero = true;
        fetchSensorData();
        if (currentAppPage === "weekly") {
            loadWeeklySummary();
        }
    });
}

window.addEventListener("resize", () => {
    if (currentAppPage === "weekly") {
        drawWeeklyBarChart();
    } else {
        drawChart();
    }
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
        if (currentAppPage !== "dashboard") {
            setAppPage("dashboard");
        }
        setActiveNav(id);
        requestAnimationFrame(() => {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
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

if (elSunCycleSwitch) elSunCycleSwitch.hidden = !isSimulationMode;
renderHistoryTable();
drawChart();
fetchInitialHistory();
fetchSensorData();
setInterval(fetchSensorData, POLLING_INTERVAL);
