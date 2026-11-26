import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/CSS2DRenderer.js';

const GAS_THRESHOLD = 3500;

let scene, camera, renderer, cssRenderer, controls;
let container;
let isInitialized = false;

let houseGroup, roofGroup, interiorGroup;
let fanImpeller, fanHousing;
let fanParticles = [];
let smokeParticles = [];
let soundWaveMeshes = [];

let roomLight, espLedLight, floorGlowMesh;
let sunLight, hemiLight, ambientLight;
let sunOrbMesh, sunHaloMesh;
let laptopScreenMat, beamLedMat, insideRedLedMat;

let doorPivot, windowPivot, cubicleDoorPivot;
let interactiveTargets = [];
const doorAnimState = {
    frontDoor: { open: false, current: 0, startVal: 0, target: 0, startTime: 0, animating: false, openAngle: -Math.PI * (85 / 180) },
    frontWindow: { open: false, current: 0, startVal: 0, target: 0, startTime: 0, animating: false, openAngle: -Math.PI * (75 / 180) },
    cubicleDoor: { open: false, current: 0, startVal: 0, target: 0, startTime: 0, animating: false, openAngle: Math.PI * (80 / 180) }
};

let raycaster = new THREE.Raycaster();
let pointerNdc = new THREE.Vector2();
let pointerDownPos = { x: 0, y: 0 };

let hotspotObjects = [];
let activeHotspotId = null;

let currentViewMode = 'outside';
let activeCameraTween = null;

let isRoofOpen = false;
let roofAnim = null;
let isAutoFocusEnabled = true;
let isUserInteracting = false;
let lastAutoHighlightTime = 0;
let prevLiveState = {
    hasBaseline: false,
    fanOn: false,
    ledOn: false,
    gasDanger: false
};

let sunTimeMode = 'auto';
let activeResolvedSlot = 'siang';
let sunTransition = null;
const currentSunVisual = {
    pos: new THREE.Vector3(2.8, 11.6, 2.2),
    sunColor: new THREE.Color(0xfffaf0),
    sunIntensity: 2.15,
    hemiSky: new THREE.Color(0xdbeeff),
    hemiGround: new THREE.Color(0x4f463c),
    hemiIntensity: 0.9,
    ambIntensity: 0.24,
    bgColor: new THREE.Color(0x2a3440),
    orbColor: new THREE.Color(0xfff8dc),
    orbScale: 1.0
};

let currentData = {
    suhu: 0,
    kelembapan: 0,
    cahaya: 0,
    gas: 0,
    led: 'OFF',
    buzzer: 'OFF',
    kipas: 'OFF',
    buzzer_muted: false,
    esp32_online: false,
    active_slot: null,
    sim_scenario: null,
    has_manual_led: false
};

const VIEW_PRESETS = {
    outside: {
        cam: new THREE.Vector3(6.2, 4.4, 7.0),
        target: new THREE.Vector3(0.0, 1.15, -0.15)
    },
    inside: {
        cam: new THREE.Vector3(0.15, 7.2, 4.3),
        target: new THREE.Vector3(0, 0.85, 0)
    },
    sensors: {
        cam: new THREE.Vector3(-1.0, 4.2, -7.5),
        target: new THREE.Vector3(0, 1.3, -0.8)
    }
};

// Sun lighting parameters matched to the four AI time slots
const SUN_PRESETS = {
    pagi: {
        pos: new THREE.Vector3(10.0, 4.9, 1.4),
        sunColor: 0xffd9a8,
        sunIntensity: 1.85,
        hemiSky: 0xbfd8ff,
        hemiGround: 0x453b32,
        hemiIntensity: 0.85,
        ambIntensity: 0.22,
        bgColor: 0x262c38,
        orbColor: 0xffe4a8,
        orbScale: 1.05
    },
    siang: {
        pos: new THREE.Vector3(2.6, 11.6, 2.0),
        sunColor: 0xfffaf0,
        sunIntensity: 2.2,
        hemiSky: 0xdbeeff,
        hemiGround: 0x4f463c,
        hemiIntensity: 0.95,
        ambIntensity: 0.25,
        bgColor: 0x2a3440,
        orbColor: 0xfff8dc,
        orbScale: 0.95
    },
    sore: {
        pos: new THREE.Vector3(-9.8, 4.1, -1.2),
        sunColor: 0xff9e5e,
        sunIntensity: 1.9,
        hemiSky: 0xf09c72,
        hemiGround: 0x3b2824,
        hemiIntensity: 0.72,
        ambIntensity: 0.2,
        bgColor: 0x2c201e,
        orbColor: 0xffaa5c,
        orbScale: 1.1
    },
    malam: {
        pos: new THREE.Vector3(-4.8, 7.6, -3.5),
        sunColor: 0x5c7cfa,
        sunIntensity: 0.34,
        hemiSky: 0x3c4f8a,
        hemiGround: 0x161419,
        hemiIntensity: 0.34,
        ambIntensity: 0.14,
        bgColor: 0x10131c,
        orbColor: 0xdbe4ff,
        orbScale: 0.85
    }
};

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function getActiveWibSlotKey() {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(new Date());
        const h = Number(parts.find(p => p.type === 'hour')?.value ?? 12);
        const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
        const total = h * 60 + m;
        if (total >= 300 && total < 660) return 'pagi';
        if (total >= 660 && total < 900) return 'siang';
        if (total >= 900 && total < 1110) return 'sore';
        return 'malam';
    } catch {
        const now = new Date();
        const total = now.getHours() * 60 + now.getMinutes();
        if (total >= 300 && total < 660) return 'pagi';
        if (total >= 660 && total < 900) return 'siang';
        if (total >= 900 && total < 1110) return 'sore';
        return 'malam';
    }
}

function resolveTargetSunSlot() {
    if (sunTimeMode !== 'auto' && SUN_PRESETS[sunTimeMode]) {
        return sunTimeMode;
    }
    if (window.isSimulationModeActive && currentData.sim_scenario === 'dark') {
        return 'malam';
    }
    if (currentData.active_slot && SUN_PRESETS[currentData.active_slot]) {
        return currentData.active_slot;
    }
    return getActiveWibSlotKey();
}

function animateCameraSpherical(targetCam, targetTarget, duration = 1600, onComplete = null) {
    if (!camera || !controls) return;

    const startTarget = controls.target.clone();
    const endTarget = targetTarget.clone();
    const startOffset = new THREE.Vector3().subVectors(camera.position, startTarget);
    const endOffset = new THREE.Vector3().subVectors(targetCam, endTarget);

    const startSph = new THREE.Spherical().setFromVector3(startOffset);
    const endSph = new THREE.Spherical().setFromVector3(endOffset);

    let dTheta = (endSph.theta - startSph.theta) % (2 * Math.PI);
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI;

    activeCameraTween = {
        type: 'spherical',
        startTarget,
        endTarget,
        startRadius: startSph.radius,
        endRadius: endSph.radius,
        startPhi: startSph.phi,
        endPhi: endSph.phi,
        startTheta: startSph.theta,
        dTheta,
        startTime: performance.now(),
        duration,
        onComplete
    };
}

// Create and configure CanvasTexture objects consistently
function buildCanvasTexture(width, height, drawFn, { srgb = false, repeatX = 1, repeatY = 1 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawFn(ctx, width, height);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    if (srgb) {
        tex.colorSpace = THREE.SRGBColorSpace;
    }
    if (renderer && renderer.capabilities) {
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    }
    return tex;
}

function createSignTexture() {
    return buildCanvasTexture(512, 128, (ctx, w, h) => {
        ctx.fillStyle = '#b98655';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#5c3a1c';
        ctx.lineWidth = 8;
        ctx.strokeRect(6, 6, w - 12, h - 12);

        ctx.fillStyle = '#1c1510';
        ctx.font = 'bold 52px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '4px';
        ctx.fillText('KAMAR KOS 01', w / 2, h / 2);
    }, { srgb: true });
}

function createWallPBRTextures() {
    const map = buildCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#b6352a';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) {
            const x = (i * 73) % w;
            const y = (i * 137) % h;
            const radius = 2 + (i % 5);
            ctx.fillStyle = i % 2 === 0 ? 'rgba(198, 66, 52, 0.14)' : 'rgba(130, 32, 24, 0.14)';
            ctx.fillRect(x, y, radius, radius * 0.7);
        }
        // Subtle painted plaster brush lines
        ctx.strokeStyle = 'rgba(255, 220, 210, 0.04)';
        ctx.lineWidth = 1;
        for (let y = 0; y < h; y += 8) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    }, { srgb: true, repeatX: 2, repeatY: 2 });

    const bumpMap = buildCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 1200; i++) {
            const x = (i * 59) % w;
            const y = (i * 101) % h;
            const shade = i % 2 === 0 ? 148 : 108;
            ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
            ctx.fillRect(x, y, 3, 2);
        }
    }, { repeatX: 2, repeatY: 2 });

    const roughnessMap = buildCanvasTexture(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 320; i++) {
            const v = 185 + (i % 45);
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect((i * 29) % w, (i * 47) % h, 6, 4);
        }
    }, { repeatX: 2, repeatY: 2 });

    return { map, bumpMap, roughnessMap };
}

function createRoofPBRTextures() {
    const map = buildCanvasTexture(256, 256, (ctx, w, h) => {
        const stripeWidth = 16;
        for (let x = 0; x < w; x += stripeWidth) {
            const grad = ctx.createLinearGradient(x, 0, x + stripeWidth, 0);
            grad.addColorStop(0, '#e3b868');
            grad.addColorStop(0.45, '#c99748');
            grad.addColorStop(0.88, '#956626');
            grad.addColorStop(1, '#7d541e');
            ctx.fillStyle = grad;
            ctx.fillRect(x, 0, stripeWidth, h);
        }
    }, { srgb: true, repeatX: 4, repeatY: 2 });

    const bumpMap = buildCanvasTexture(256, 256, (ctx, w, h) => {
        const stripeWidth = 16;
        for (let x = 0; x < w; x += stripeWidth) {
            const grad = ctx.createLinearGradient(x, 0, x + stripeWidth, 0);
            grad.addColorStop(0, '#e8e8e8');
            grad.addColorStop(0.5, '#969696');
            grad.addColorStop(1, '#323232');
            ctx.fillStyle = grad;
            ctx.fillRect(x, 0, stripeWidth, h);
        }
    }, { repeatX: 4, repeatY: 2 });

    const roughnessMap = buildCanvasTexture(256, 256, (ctx, w, h) => {
        const stripeWidth = 16;
        for (let x = 0; x < w; x += stripeWidth) {
            const grad = ctx.createLinearGradient(x, 0, x + stripeWidth, 0);
            grad.addColorStop(0, '#8a8a8a');
            grad.addColorStop(0.5, '#b8b8b8');
            grad.addColorStop(1, '#dedede');
            ctx.fillStyle = grad;
            ctx.fillRect(x, 0, stripeWidth, h);
        }
    }, { repeatX: 4, repeatY: 2 });

    return { map, bumpMap, roughnessMap };
}

function createFloorPBRTextures() {
    // Light white-grey ceramic tile floor matching interior maket photos
    const map = buildCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#dcdedf';
        ctx.fillRect(0, 0, w, h);

        for (let i = 0; i < 650; i++) {
            const v = 208 + (i % 20);
            ctx.fillStyle = `rgba(${v},${v},${v + 2},0.35)`;
            ctx.fillRect((i * 43) % w, (i * 89) % h, 4, 4);
        }

        ctx.strokeStyle = '#adb2b7';
        ctx.lineWidth = 3;
        const step = 64;
        for (let y = 0; y <= h; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        for (let x = 0; x <= w; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
    }, { srgb: true, repeatX: 3, repeatY: 3 });

    const bumpMap = buildCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 3;
        for (let i = 0; i <= 256; i += 64) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(w, i);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
            ctx.stroke();
        }
    }, { repeatX: 3, repeatY: 3 });

    const roughnessMap = buildCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#626262';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#d4d4d4';
        ctx.lineWidth = 3;
        for (let i = 0; i <= 256; i += 64) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(w, i);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
            ctx.stroke();
        }
    }, { repeatX: 3, repeatY: 3 });

    return { map, bumpMap, roughnessMap };
}

function createWoodPBRTextures(baseHex, grainHex, repeatX = 1, repeatY = 1) {
    const map = buildCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = baseHex;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = grainHex;
        for (let y = 0; y < h; y += 5) {
            ctx.globalAlpha = 0.12 + ((y % 15) / 100);
            ctx.lineWidth = 1 + (y % 2);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(w * 0.33, y + (y % 4) - 2, w * 0.66, y - (y % 4) + 2, w, y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }, { srgb: true, repeatX, repeatY });

    const bumpMap = buildCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 5) {
            const v = y % 10 === 0 ? 105 : 145;
            ctx.strokeStyle = `rgb(${v},${v},${v})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    }, { repeatX, repeatY });

    return { map, bumpMap };
}

function createGrassPBRTextures() {
    const map = buildCanvasTexture(256, 256, (ctx, w, h) => {
        const grad = ctx.createRadialGradient(w / 2, h / 2, 16, w / 2, h / 2, w * 0.72);
        grad.addColorStop(0, '#225940');
        grad.addColorStop(1, '#18402e');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        for (let i = 0; i < 1600; i++) {
            const x = (i * 67) % w;
            const y = (i * 113) % h;
            ctx.fillStyle = i % 3 === 0 ? 'rgba(48, 118, 84, 0.22)' : 'rgba(18, 46, 33, 0.24)';
            ctx.fillRect(x, y, 2, 3);
        }
    }, { srgb: true, repeatX: 3, repeatY: 3 });

    const bumpMap = buildCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 1500; i++) {
            const shade = i % 2 === 0 ? 150 : 100;
            ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
            ctx.fillRect((i * 53) % w, (i * 97) % h, 2, 2);
        }
    }, { repeatX: 3, repeatY: 3 });

    return { map, bumpMap };
}

function createMqMeshPBRTextures() {
    const map = buildCanvasTexture(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#c4c8cf';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#6f7580';
        ctx.lineWidth = 2;
        for (let i = 0; i <= w; i += 8) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(w, i);
            ctx.stroke();
        }
    }, { srgb: true, repeatX: 2, repeatY: 2 });

    const bumpMap = buildCanvasTexture(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#404040';
        ctx.lineWidth = 2;
        for (let i = 0; i <= w; i += 8) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(w, i);
            ctx.stroke();
        }
    }, { repeatX: 2, repeatY: 2 });

    return { map, bumpMap };
}

function enableShadows(root) {
    root.traverse(obj => {
        if (!obj.isMesh || obj.userData.noShadow) return;
        obj.castShadow = obj.userData.castShadow !== false;
        obj.receiveShadow = obj.userData.receiveShadow !== false;
    });
}

function addCableTube(parent, points, colorHex, radius = 0.014) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const geo = new THREE.TubeGeometry(curve, 16, radius, 6, false);
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    parent.add(mesh);
    return mesh;
}

function buildModel() {
    houseGroup = new THREE.Group();
    scene.add(houseGroup);

    const wallPbr = createWallPBRTextures();
    const roofPbr = createRoofPBRTextures();
    const floorPbr = createFloorPBRTextures();
    const grassPbr = createGrassPBRTextures();
    const doorWoodPbr = createWoodPBRTextures('#85522d', '#4f2c14', 1, 1);
    const darkWoodPbr = createWoodPBRTextures('#4b3120', '#2b1a10', 1, 1);
    const espBoxWoodPbr = createWoodPBRTextures('#835c3e', '#593b25', 2, 1);

    const houseW = 4.0;
    const houseD = 3.6;
    const houseH = 2.4;
    const roofPeakY = 3.52;
    const wallThick = 0.12;

    // Ground plate and teal rim
    const baseMat = new THREE.MeshStandardMaterial({
        map: grassPbr.map,
        bumpMap: grassPbr.bumpMap,
        bumpScale: 0.015,
        roughness: 0.88,
        metalness: 0.04
    });
    const baseBorderMat = new THREE.MeshStandardMaterial({
        color: 0x097894,
        roughness: 0.6,
        metalness: 0.08
    });

    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 7.6), baseMat);
    baseMesh.position.set(0, -0.11, -0.2);
    houseGroup.add(baseMesh);

    const lipF = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.32, 0.12), baseBorderMat);
    lipF.position.set(0, -0.06, 3.6);
    const lipB = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.32, 0.12), baseBorderMat);
    lipB.position.set(0, -0.06, -4.0);
    const lipL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 7.6), baseBorderMat);
    lipL.position.set(-3.4, -0.06, -0.2);
    const lipR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 7.6), baseBorderMat);
    lipR.position.set(3.4, -0.06, -0.2);
    houseGroup.add(lipF, lipB, lipL, lipR);

    const wallMat = new THREE.MeshStandardMaterial({
        map: wallPbr.map,
        bumpMap: wallPbr.bumpMap,
        bumpScale: 0.014,
        roughnessMap: wallPbr.roughnessMap,
        roughness: 0.78,
        metalness: 0.03
    });

    // Interior ceramic tile floor
    const floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(houseW - 0.08, houseD - 0.08),
        new THREE.MeshStandardMaterial({
            map: floorPbr.map,
            bumpMap: floorPbr.bumpMap,
            bumpScale: 0.012,
            roughnessMap: floorPbr.roughnessMap,
            roughness: 0.42,
            metalness: 0.06
        })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0.01, 0);
    floorMesh.userData.castShadow = false;
    houseGroup.add(floorMesh);

    // Subtle comfort glow plane on interior floor
    floorGlowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(houseW - 0.24, houseD - 0.24),
        new THREE.MeshBasicMaterial({
            color: 0x17c9b4,
            transparent: true,
            opacity: 0.08,
            depthWrite: false
        })
    );
    floorGlowMesh.rotation.x = -Math.PI / 2;
    floorGlowMesh.position.set(0, 0.018, 0);
    floorGlowMesh.userData.noShadow = true;
    houseGroup.add(floorGlowMesh);

    // Front wall (+Z = +1.80) built via Shape + ExtrudeGeometry
    const frontShape = new THREE.Shape();
    frontShape.moveTo(-houseW / 2, 0);
    frontShape.lineTo(houseW / 2, 0);
    frontShape.lineTo(houseW / 2, houseH);
    frontShape.lineTo(-houseW / 2, houseH);
    frontShape.closePath();

    const doorHole = new THREE.Path();
    doorHole.moveTo(-1.60, 0);
    doorHole.lineTo(-0.65, 0);
    doorHole.lineTo(-0.65, 1.80);
    doorHole.lineTo(-1.60, 1.80);
    doorHole.closePath();
    frontShape.holes.push(doorHole);

    const windowHole = new THREE.Path();
    windowHole.moveTo(0.40, 0.65);
    windowHole.lineTo(1.60, 0.65);
    windowHole.lineTo(1.60, 1.70);
    windowHole.lineTo(0.40, 1.70);
    windowHole.closePath();
    frontShape.holes.push(windowHole);

    const vent1 = new THREE.Path();
    vent1.moveTo(-1.48, 1.95);
    vent1.lineTo(-1.20, 1.95);
    vent1.lineTo(-1.20, 2.12);
    vent1.lineTo(-1.48, 2.12);
    vent1.closePath();
    frontShape.holes.push(vent1);

    const vent2 = new THREE.Path();
    vent2.moveTo(-1.05, 1.95);
    vent2.lineTo(-0.77, 1.95);
    vent2.lineTo(-0.77, 2.12);
    vent2.lineTo(-1.05, 2.12);
    vent2.closePath();
    frontShape.holes.push(vent2);

    const vent3 = new THREE.Path();
    vent3.moveTo(0.86, 1.95);
    vent3.lineTo(1.14, 1.95);
    vent3.lineTo(1.14, 2.12);
    vent3.lineTo(0.86, 2.12);
    vent3.closePath();
    frontShape.holes.push(vent3);

    const frontGeo = new THREE.ExtrudeGeometry(frontShape, { depth: wallThick, bevelEnabled: false });
    const frontWallMesh = new THREE.Mesh(frontGeo, wallMat);
    frontWallMesh.position.set(0, 0, houseD / 2 - wallThick);
    houseGroup.add(frontWallMesh);

    const doorMat = new THREE.MeshStandardMaterial({
        map: doorWoodPbr.map,
        bumpMap: doorWoodPbr.bumpMap,
        bumpScale: 0.015,
        roughness: 0.72,
        metalness: 0.06
    });
    const darkFrameMat = new THREE.MeshStandardMaterial({
        map: darkWoodPbr.map,
        bumpMap: darkWoodPbr.bumpMap,
        bumpScale: 0.012,
        roughness: 0.75,
        metalness: 0.05
    });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xd9ad6d, roughness: 0.35, metalness: 0.78 });

    // Front door frames (extruded proud profile)
    const doorFrameT = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.07, 0.16), darkFrameMat);
    doorFrameT.position.set(-1.125, 1.80, houseD / 2 - wallThick / 2);
    const doorFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.82, 0.16), darkFrameMat);
    doorFrameL.position.set(-1.60, 0.91, houseD / 2 - wallThick / 2);
    const doorFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.82, 0.16), darkFrameMat);
    doorFrameR.position.set(-0.65, 0.91, houseD / 2 - wallThick / 2);
    houseGroup.add(doorFrameT, doorFrameL, doorFrameR);

    // Interactive hinged front door pivot at left jamb
    doorPivot = new THREE.Group();
    doorPivot.position.set(-1.57, 0.032, houseD / 2 - 0.04);
    const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.89, 1.74, 0.055), doorMat);
    doorLeaf.position.set(0.445, 0.87, 0);
    doorLeaf.userData.interactiveType = 'frontDoor';

    const doorHandlePlate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), handleMat);
    doorHandlePlate.position.set(0.79, 0.86, 0);
    doorHandlePlate.userData.interactiveType = 'frontDoor';

    const doorHandleLever = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.095), handleMat);
    doorHandleLever.position.set(0.75, 0.86, 0.02);
    doorHandleLever.userData.interactiveType = 'frontDoor';

    doorPivot.add(doorLeaf, doorHandlePlate, doorHandleLever);
    houseGroup.add(doorPivot);
    interactiveTargets.push(doorLeaf, doorHandlePlate, doorHandleLever);

    // Welcome doormat in front of entrance
    const doormatMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.018, 0.44),
        new THREE.MeshStandardMaterial({ color: 0x3b2f28, roughness: 0.95 })
    );
    doormatMesh.position.set(-1.125, 0.009, houseD / 2 + 0.28);
    houseGroup.add(doormatMesh);

    // Profiled outer window frame & sill
    const winTop = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.065, 0.16), darkFrameMat);
    winTop.position.set(1.0, 1.71, houseD / 2 - wallThick / 2);
    const winBottom = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.07, 0.19), darkFrameMat);
    winBottom.position.set(1.0, 0.64, houseD / 2 - wallThick / 2 + 0.01);
    const winLeft = new THREE.Mesh(new THREE.BoxGeometry(0.065, 1.07, 0.16), darkFrameMat);
    winLeft.position.set(0.40, 1.175, houseD / 2 - wallThick / 2);
    const winRight = new THREE.Mesh(new THREE.BoxGeometry(0.065, 1.07, 0.16), darkFrameMat);
    winRight.position.set(1.60, 1.175, houseD / 2 - wallThick / 2);
    houseGroup.add(winTop, winBottom, winLeft, winRight);

    // Interactive hinged casement window sash at left jamb
    windowPivot = new THREE.Group();
    windowPivot.position.set(0.43, 1.175, houseD / 2 - 0.03);

    const sashThick = 0.045;
    const sashW = 1.14;
    const sashH = 1.0;
    const sashTop = new THREE.Mesh(new THREE.BoxGeometry(sashW, 0.055, sashThick), darkFrameMat);
    sashTop.position.set(sashW / 2, sashH / 2 - 0.0275, 0);
    const sashBot = new THREE.Mesh(new THREE.BoxGeometry(sashW, 0.055, sashThick), darkFrameMat);
    sashBot.position.set(sashW / 2, -sashH / 2 + 0.0275, 0);
    const sashL = new THREE.Mesh(new THREE.BoxGeometry(0.055, sashH, sashThick), darkFrameMat);
    sashL.position.set(0.0275, 0, 0);
    const sashR = new THREE.Mesh(new THREE.BoxGeometry(0.055, sashH, sashThick), darkFrameMat);
    sashR.position.set(sashW - 0.0275, 0, 0);

    // Cross mullions
    const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.035, sashH - 0.08, sashThick * 0.8), darkFrameMat);
    mullionV.position.set(sashW / 2, 0, 0);
    const mullionH = new THREE.Mesh(new THREE.BoxGeometry(sashW - 0.08, 0.035, sashThick * 0.8), darkFrameMat);
    mullionH.position.set(sashW / 2, 0, 0);

    const winHandle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.11, 0.06), handleMat);
    winHandle.position.set(sashW - 0.045, 0, 0.02);

    const winGlass = new THREE.Mesh(
        new THREE.BoxGeometry(sashW - 0.08, sashH - 0.08, 0.018),
        new THREE.MeshStandardMaterial({
            color: 0xaad4eb,
            transparent: true,
            opacity: 0.3,
            roughness: 0.08,
            metalness: 0.15
        })
    );
    winGlass.position.set(sashW / 2, 0, 0);
    winGlass.userData.noShadow = true;

    [sashTop, sashBot, sashL, sashR, mullionV, mullionH, winHandle, winGlass].forEach(part => {
        part.userData.interactiveType = 'frontWindow';
        windowPivot.add(part);
        interactiveTargets.push(part);
    });
    houseGroup.add(windowPivot);

    // Cardboard nameplate on front wall
    const signMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.44, 0.05),
        new THREE.MeshStandardMaterial({ map: createSignTexture(), roughness: 0.65 })
    );
    signMesh.position.set(0, 2.05, houseD / 2 + 0.02);
    houseGroup.add(signMesh);

    // Back wall (-Z = -1.80) matching physical maket: Exhaust fan on -X (left from inside / right from outside)
    const backShape = new THREE.Shape();
    backShape.moveTo(-houseW / 2, 0);
    backShape.lineTo(houseW / 2, 0);
    backShape.lineTo(houseW / 2, houseH);
    backShape.lineTo(-houseW / 2, houseH);
    backShape.closePath();

    const backVentHole = new THREE.Path();
    backVentHole.moveTo(-0.45, 1.55);
    backVentHole.lineTo(0.45, 1.55);
    backVentHole.lineTo(0.45, 1.85);
    backVentHole.lineTo(-0.45, 1.85);
    backVentHole.closePath();
    backShape.holes.push(backVentHole);

    const fanHole = new THREE.Path();
    fanHole.moveTo(-1.55, 1.05);
    fanHole.lineTo(-0.75, 1.05);
    fanHole.lineTo(-0.75, 1.85);
    fanHole.lineTo(-1.55, 1.85);
    fanHole.closePath();
    backShape.holes.push(fanHole);

    const backGeo = new THREE.ExtrudeGeometry(backShape, { depth: wallThick, bevelEnabled: false });
    const backWallMesh = new THREE.Mesh(backGeo, wallMat);
    backWallMesh.position.set(0, 0, -houseD / 2);
    houseGroup.add(backWallMesh);

    // Exhaust fan assembly at X = -1.15
    fanHousing = new THREE.Group();
    fanHousing.position.set(-1.15, 1.45, -houseD / 2);

    const fanCasingMat = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.5, metalness: 0.3 });
    const fanOuterFrame = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.82, 0.2), fanCasingMat);
    fanOuterFrame.position.set(0, 0, -0.04);

    // Interior flange + cardboard support tab seen inside the room
    const fanInnerRim = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.84, 0.04), fanCasingMat);
    fanInnerRim.position.set(0, 0, 0.13);

    const fanTunnel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.33, 0.33, 0.22, 32, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.4, side: THREE.BackSide })
    );
    fanTunnel.rotation.x = Math.PI / 2;
    fanTunnel.position.set(0, 0, -0.04);

    const boltGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10);
    const boltMat = new THREE.MeshStandardMaterial({ color: 0xb5b8bf, metalness: 0.88, roughness: 0.2 });
    const bolts = [[-0.34, 0.34], [0.34, 0.34], [-0.34, -0.34], [0.34, -0.34]].map(([bx, by]) => {
        const b = new THREE.Mesh(boltGeo, boltMat);
        b.rotation.x = Math.PI / 2;
        b.position.set(bx, by, -0.145);
        return b;
    });

    fanImpeller = new THREE.Group();
    fanImpeller.position.set(0, 0, -0.04);
    const hubMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.09, 24),
        new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4 })
    );
    hubMesh.rotation.x = Math.PI / 2;
    const logoCenter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.094, 20),
        new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.4 })
    );
    logoCenter.rotation.x = Math.PI / 2;
    const logoInner = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.096, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
    );
    logoInner.rotation.x = Math.PI / 2;
    fanImpeller.add(hubMesh, logoCenter, logoInner);

    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2e3034, roughness: 0.35, metalness: 0.25 });
    const numBlades = 7;
    for (let i = 0; i < numBlades; i++) {
        const bladePivot = new THREE.Group();
        bladePivot.rotation.z = (i * Math.PI * 2) / numBlades;
        const bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.02), bladeMat);
        bladeMesh.position.set(0, 0.15, 0);
        bladeMesh.rotation.x = 0.55;
        bladePivot.add(bladeMesh);
        fanImpeller.add(bladePivot);
    }

    const ringGuard = new THREE.Mesh(
        new THREE.TorusGeometry(0.25, 0.012, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.5 })
    );
    ringGuard.position.set(0, 0, -0.145);

    fanHousing.add(fanOuterFrame, fanInnerRim, fanTunnel, ...bolts, fanImpeller, ringGuard);
    houseGroup.add(fanHousing);

    // Interior piezo buzzer on upper-right side of back wall (visible when roof opens)
    const wallBuzzerBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.095, 0.1, 20),
        new THREE.MeshStandardMaterial({ color: 0x151518, roughness: 0.45, metalness: 0.2 })
    );
    wallBuzzerBody.rotation.x = Math.PI / 2;
    wallBuzzerBody.position.set(1.15, 1.82, -houseD / 2 + wallThick + 0.045);
    const wallBuzzerRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.104, 16),
        new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.35, metalness: 0.5 })
    );
    wallBuzzerRing.rotation.x = Math.PI / 2;
    wallBuzzerRing.position.set(1.15, 1.82, -houseD / 2 + wallThick + 0.047);
    houseGroup.add(wallBuzzerBody, wallBuzzerRing);

    // Back exterior sensors (+X side): DHT11 & blue module with masking tape
    const pcbMat = new THREE.MeshStandardMaterial({ color: 0x0b5fa5, roughness: 0.48, metalness: 0.1 });
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.92 });

    const dhtPcb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.44, 0.03), pcbMat);
    dhtPcb.position.set(0.85, 1.5, -houseD / 2 - 0.02);
    const dhtGrid = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.3, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x72c4e8, roughness: 0.55 })
    );
    dhtGrid.position.set(0.85, 1.55, -houseD / 2 - 0.07);
    const dhtTape = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.012), tapeMat);
    dhtTape.position.set(0.85, 1.28, -houseD / 2 - 0.04);
    houseGroup.add(dhtPcb, dhtGrid, dhtTape);

    const blueModPcb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.03), pcbMat);
    blueModPcb.position.set(1.4, 1.5, -houseD / 2 - 0.02);
    const blueModPot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 })
    );
    blueModPot.rotation.x = Math.PI / 2;
    blueModPot.position.set(1.4, 1.52, -houseD / 2 - 0.05);
    const blueModTape = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.012), tapeMat);
    blueModTape.position.set(1.4, 1.28, -houseD / 2 - 0.04);
    houseGroup.add(blueModPcb, blueModPot, blueModTape);

    // Side gable walls (-X and +X)
    const sideGableShape = new THREE.Shape();
    sideGableShape.moveTo(-houseD / 2, 0);
    sideGableShape.lineTo(houseD / 2, 0);
    sideGableShape.lineTo(houseD / 2, houseH);
    sideGableShape.lineTo(0, roofPeakY);
    sideGableShape.lineTo(-houseD / 2, houseH);
    sideGableShape.closePath();

    const sideGableGeo = new THREE.ExtrudeGeometry(sideGableShape, { depth: wallThick, bevelEnabled: false });

    const wallLeft = new THREE.Mesh(sideGableGeo, wallMat);
    wallLeft.rotation.y = -Math.PI / 2;
    wallLeft.position.set(-houseW / 2 + wallThick, 0, 0);
    houseGroup.add(wallLeft);

    const wallRight = new THREE.Mesh(sideGableGeo, wallMat);
    wallRight.rotation.y = -Math.PI / 2;
    wallRight.position.set(houseW / 2, 0, 0);
    houseGroup.add(wallRight);

    // Left gable wall (-X): exterior sensor PCB + interior sensor head with glowing tiny red indicator LED
    const leftSensorPcb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.38, 0.24), pcbMat);
    leftSensorPcb.position.set(-houseW / 2 - 0.02, 1.45, -1.05);
    const leftSensorTape = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.28), tapeMat);
    leftSensorTape.position.set(-houseW / 2 - 0.038, 1.26, -1.05);

    const insideLeftPcb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.12), pcbMat);
    insideLeftPcb.position.set(-houseW / 2 + wallThick + 0.035, 1.65, -1.05);
    insideRedLedMat = new THREE.MeshStandardMaterial({
        color: 0xff2b3a,
        emissive: 0xff1e2d,
        emissiveIntensity: 2.2,
        roughness: 0.25
    });
    const insideRedLed = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 12), insideRedLedMat);
    insideRedLed.position.set(-houseW / 2 + wallThick + 0.08, 1.63, -1.05);
    insideRedLed.userData.noShadow = true;
    houseGroup.add(leftSensorPcb, leftSensorTape, insideLeftPcb, insideRedLed);

    // Right gable wall (+X, cubicle side): exterior blue MQ-2 PCB + interior shiny silver wire-mesh MQ-2 head
    const rightSensorPcb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.38, 0.24), pcbMat);
    rightSensorPcb.position.set(houseW / 2 + 0.02, 1.45, -1.15);
    const rightSensorTape = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.28), tapeMat);
    rightSensorTape.position.set(houseW / 2 + 0.038, 1.26, -1.15);

    const mqMeshPbr = createMqMeshPBRTextures();
    const mqCollar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.04, 20),
        new THREE.MeshStandardMaterial({ color: 0x33373e, metalness: 0.65, roughness: 0.4 })
    );
    mqCollar.rotation.z = Math.PI / 2;
    mqCollar.position.set(houseW / 2 - wallThick - 0.02, 1.82, -1.15);

    const mqSilverMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.082, 0.082, 0.12, 20),
        new THREE.MeshStandardMaterial({
            map: mqMeshPbr.map,
            bumpMap: mqMeshPbr.bumpMap,
            bumpScale: 0.02,
            color: 0xe6eaf0,
            metalness: 0.88,
            roughness: 0.24
        })
    );
    mqSilverMesh.rotation.z = Math.PI / 2;
    mqSilverMesh.position.set(houseW / 2 - wallThick - 0.085, 1.82, -1.15);
    houseGroup.add(rightSensorPcb, rightSensorTape, mqCollar, mqSilverMesh);

    // Rear ESP32 control box
    const espBox = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 0.85, 1.7),
        new THREE.MeshStandardMaterial({
            map: espBoxWoodPbr.map,
            bumpMap: espBoxWoodPbr.bumpMap,
            bumpScale: 0.018,
            roughness: 0.82,
            metalness: 0.05
        })
    );
    espBox.position.set(0, 0.425, -2.85);
    houseGroup.add(espBox);

    const espLedMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x2bd9a8, emissive: 0x2bd9a8, emissiveIntensity: 1.5 })
    );
    espLedMesh.position.set(0.9, 0.88, -2.85);
    espLedMesh.name = 'espStatusLed';
    espLedMesh.userData.noShadow = true;
    houseGroup.add(espLedMesh);

    espLedLight = new THREE.PointLight(0x2bd9a8, 0.5, 2.0);
    espLedLight.position.set(0.9, 1.05, -2.85);
    houseGroup.add(espLedLight);

    // Exterior buzzer module on top of ESP32 control box (alarm hotspot anchor)
    const buzzerBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.12, 20),
        new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.45, metalness: 0.2 })
    );
    buzzerBody.position.set(1.15, 0.91, -2.65);
    const buzzerRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.13, 16),
        new THREE.MeshStandardMaterial({ color: 0xfe623c, roughness: 0.4 })
    );
    buzzerRing.position.set(1.15, 0.915, -2.65);
    houseGroup.add(buzzerBody, buzzerRing);

    // Neat sensor cables routed into the ESP32 box
    addCableTube(houseGroup, [[-1.15, 1.04, -1.86], [-1.15, 0.92, -1.96], [-1.05, 0.72, -2.02]], 0x22252a);
    addCableTube(houseGroup, [[0.85, 1.24, -1.83], [0.85, 1.0, -1.94], [0.8, 0.74, -2.02]], 0x2b7cb3);
    addCableTube(houseGroup, [[1.4, 1.24, -1.83], [1.4, 1.0, -1.94], [1.3, 0.74, -2.02]], 0xebe6dc);
    addCableTube(houseGroup, [[-2.02, 1.22, -1.05], [-2.04, 0.85, -1.45], [-1.72, 0.65, -2.05]], 0xb8382c);
    addCableTube(houseGroup, [[2.02, 1.22, -1.15], [2.04, 0.85, -1.55], [1.72, 0.65, -2.05]], 0xd6d2c9);

    // Crossbeam + ceiling white LED + orange wire (always attached across walls)
    const beamMat = new THREE.MeshStandardMaterial({
        color: 0xc94a29,
        bumpMap: wallPbr.bumpMap,
        bumpScale: 0.012,
        roughness: 0.76,
        metalness: 0.03
    });
    const crossbeamMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.055, houseD - 0.04), beamMat);
    crossbeamMesh.position.set(0, houseH - 0.05, 0);
    houseGroup.add(crossbeamMesh);

    const beamTape = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.01, 0.22), tapeMat);
    beamTape.position.set(0.02, houseH - 0.018, -0.02);
    const beamBackTape = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.015, 0.16), tapeMat);
    beamBackTape.position.set(0.06, houseH - 0.015, -houseD / 2 + 0.08);
    houseGroup.add(beamTape, beamBackTape);

    beamLedMat = new THREE.MeshStandardMaterial({
        color: 0xf8f9fa,
        emissive: 0xffd27d,
        emissiveIntensity: 0.12,
        roughness: 0.25
    });
    const beamLedBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.032, 0.07, 12),
        new THREE.MeshStandardMaterial({ color: 0x262629, roughness: 0.6 })
    );
    beamLedBase.rotation.x = Math.PI * 0.42;
    beamLedBase.position.set(0, houseH - 0.085, 0.06);

    const beamLedBulb = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 16), beamLedMat);
    beamLedBulb.position.set(0, houseH - 0.12, 0.13);
    beamLedBulb.name = 'ceilingLampBulb';
    beamLedBulb.userData.noShadow = true;
    houseGroup.add(beamLedBase, beamLedBulb);

    addCableTube(
        houseGroup,
        [[0, houseH - 0.07, 0.05], [0.04, houseH - 0.01, -0.15], [0.08, houseH - 0.01, -1.78], [0.4, 2.0, -2.02], [0.65, 0.86, -2.25]],
        0xf58220,
        0.016
    );

    roomLight = new THREE.PointLight(0xffd27d, 0.0, 11.0, 1.25);
    roomLight.position.set(0, houseH - 0.22, 0.15);
    roomLight.castShadow = true;
    roomLight.shadow.mapSize.set(512, 512);
    roomLight.shadow.camera.near = 0.12;
    roomLight.shadow.camera.far = 8.5;
    roomLight.shadow.bias = -0.0012;
    roomLight.shadow.normalBias = 0.02;
    houseGroup.add(roomLight);

    // Interior structure & furnishings matching real maket photos
    interiorGroup = new THREE.Group();
    houseGroup.add(interiorGroup);

    // Cubicle partition in Front-Right corner (+X: 0.28..1.88, +Z: 0.05..1.68)
    const partHeight = 1.54;
    const partThick = 0.06;
    const partBackWall = new THREE.Mesh(new THREE.BoxGeometry(1.62, partHeight, partThick), wallMat);
    partBackWall.position.set(1.09, partHeight / 2, 0.05);
    interiorGroup.add(partBackWall);

    // Partition side wall with doorway opening (local X represents world Z from 0.05 to 1.68)
    const partSideShape = new THREE.Shape();
    partSideShape.moveTo(0.05, 0);
    partSideShape.lineTo(1.68, 0);
    partSideShape.lineTo(1.68, partHeight);
    partSideShape.lineTo(0.05, partHeight);
    partSideShape.closePath();

    const cubDoorHole = new THREE.Path();
    cubDoorHole.moveTo(0.35, 0);
    cubDoorHole.lineTo(1.05, 0);
    cubDoorHole.lineTo(1.05, 1.32);
    cubDoorHole.lineTo(0.35, 1.32);
    cubDoorHole.closePath();
    partSideShape.holes.push(cubDoorHole);

    const partSideGeo = new THREE.ExtrudeGeometry(partSideShape, { depth: partThick, bevelEnabled: false });
    const partSideMesh = new THREE.Mesh(partSideGeo, wallMat);
    partSideMesh.rotation.y = -Math.PI / 2;
    partSideMesh.position.set(0.31, 0, 0);
    interiorGroup.add(partSideMesh);

    // Hinged cubicle mini door (swings inward +X into the cubicle on click)
    cubicleDoorPivot = new THREE.Group();
    cubicleDoorPivot.position.set(0.28, 0.01, 0.35);
    const cubDoorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.29, 0.68), wallMat);
    cubDoorLeaf.position.set(0, 0.645, 0.34);
    cubDoorLeaf.userData.interactiveType = 'cubicleDoor';

    const cubDoorTrim = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.05), handleMat);
    cubDoorTrim.position.set(-0.01, 0.66, 0.6);
    cubDoorTrim.userData.interactiveType = 'cubicleDoor';

    cubicleDoorPivot.add(cubDoorLeaf, cubDoorTrim);
    interiorGroup.add(cubicleDoorPivot);
    interactiveTargets.push(cubDoorLeaf, cubDoorTrim);

    // Minimalist bed on left-back main area (-X: -1.82..-0.64, Z: -1.68..+0.24)
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.26, 1.92), darkFrameMat);
    bedFrame.position.set(-1.23, 0.13, -0.72);
    const mattress = new THREE.Mesh(
        new THREE.BoxGeometry(1.08, 0.18, 1.82),
        new THREE.MeshStandardMaterial({ color: 0xf4eee4, roughness: 0.88 })
    );
    mattress.position.set(-1.23, 0.3, -0.72);
    const pillow = new THREE.Mesh(
        new THREE.BoxGeometry(0.66, 0.09, 0.36),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94 })
    );
    pillow.position.set(-1.23, 0.42, -1.36);
    const blanket = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.19, 1.15),
        new THREE.MeshStandardMaterial({ color: 0x24424d, roughness: 0.82 })
    );
    blanket.position.set(-1.23, 0.305, -0.38);
    interiorGroup.add(bedFrame, mattress, pillow, blanket);

    // Study desk, small chair, and mini laptop behind the cubicle (+X, -Z)
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.07, 0.56), doorMat);
    deskTop.position.set(1.14, 0.66, -1.3);
    const deskLegOffsets = [[-0.46, -0.22], [0.46, -0.22], [-0.46, 0.22], [0.46, 0.22]];
    deskLegOffsets.forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.66, 0.06), doorMat);
        leg.position.set(1.14 + lx, 0.33, -1.3 + lz);
        interiorGroup.add(leg);
    });

    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.38), doorMat);
    chairSeat.position.set(1.14, 0.38, -0.82);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.36, 0.045), doorMat);
    chairBack.position.set(1.14, 0.58, -0.65);
    [[-0.16, -0.15], [0.16, -0.15], [-0.16, 0.15], [0.16, 0.15]].forEach(([cx, cz]) => {
        const cleg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.38, 0.045), doorMat);
        cleg.position.set(1.14 + cx, 0.19, -0.82 + cz);
        interiorGroup.add(cleg);
    });

    const laptopBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.02, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x2a2c32, metalness: 0.72, roughness: 0.32 })
    );
    laptopBase.position.set(1.14, 0.705, -1.27);
    laptopScreenMat = new THREE.MeshStandardMaterial({
        color: 0x58b0ff,
        emissive: 0x4ea8ff,
        emissiveIntensity: 0.35,
        roughness: 0.25
    });
    const laptopScreen = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.02), laptopScreenMat);
    laptopScreen.position.set(1.14, 0.82, -1.38);
    laptopScreen.rotation.x = 0.18;
    interiorGroup.add(deskTop, chairSeat, chairBack, laptopBase, laptopScreen);

    // Wall light switch and twin wall socket inside front wall beside front door
    const plasticWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f2f4, roughness: 0.45 });
    const switchPlate = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.025), plasticWhiteMat);
    switchPlate.position.set(-0.28, 0.96, houseD / 2 - wallThick - 0.012);
    const switchRocker = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.022), plasticWhiteMat);
    switchRocker.position.set(-0.28, 0.96, houseD / 2 - wallThick - 0.022);

    const outletPlate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.025), plasticWhiteMat);
    outletPlate.position.set(-0.28, 0.4, houseD / 2 - wallThick - 0.012);
    const outletRecess = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.036, 0.015, 14),
        new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.6 })
    );
    outletRecess.rotation.x = Math.PI / 2;
    outletRecess.position.set(-0.28, 0.4, houseD / 2 - wallThick - 0.022);
    interiorGroup.add(switchPlate, switchRocker, outletPlate, outletRecess);

    // Corrugated gable roof + fascia edge trim
    roofGroup = new THREE.Group();
    houseGroup.add(roofGroup);

    const roofMat = new THREE.MeshStandardMaterial({
        map: roofPbr.map,
        bumpMap: roofPbr.bumpMap,
        bumpScale: 0.065,
        roughnessMap: roofPbr.roughnessMap,
        roughness: 0.72,
        metalness: 0.08,
        side: THREE.DoubleSide
    });

    const roofOverhangX = 4.38;
    const roofSlopeLen = 2.34;
    const roofPitch = Math.atan2(roofPeakY - houseH, houseD / 2);

    const roofFront = new THREE.Mesh(new THREE.BoxGeometry(roofOverhangX, 0.06, roofSlopeLen), roofMat);
    roofFront.rotation.x = roofPitch;
    roofFront.position.set(0, (roofPeakY + houseH) / 2 - 0.01, houseD / 4 + 0.06);

    const roofBack = new THREE.Mesh(new THREE.BoxGeometry(roofOverhangX, 0.06, roofSlopeLen), roofMat);
    roofBack.rotation.x = -roofPitch;
    roofBack.position.set(0, (roofPeakY + houseH) / 2 - 0.01, -houseD / 4 - 0.06);

    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x916023, roughness: 0.68, metalness: 0.05 });
    const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(roofOverhangX + 0.04, 0.085, 0.24), ridgeMat);
    ridgeCap.position.set(0, roofPeakY + 0.04, 0);

    // Fascia trim along eaves
    const fasciaFront = new THREE.Mesh(new THREE.BoxGeometry(roofOverhangX + 0.04, 0.085, 0.04), ridgeMat);
    fasciaFront.position.set(0, houseH - 0.14, houseD / 2 + 0.25);
    const fasciaBack = new THREE.Mesh(new THREE.BoxGeometry(roofOverhangX + 0.04, 0.085, 0.04), ridgeMat);
    fasciaBack.position.set(0, houseH - 0.14, -houseD / 2 - 0.25);

    roofGroup.add(roofFront, roofBack, ridgeCap, fasciaFront, fasciaBack);

    enableShadows(houseGroup);
    createParticleSystems();
}

function createSunAndSkyRig() {
    ambientLight = new THREE.AmbientLight(0xffe8d6, currentSunVisual.ambIntensity);
    scene.add(ambientLight);

    hemiLight = new THREE.HemisphereLight(
        currentSunVisual.hemiSky,
        currentSunVisual.hemiGround,
        currentSunVisual.hemiIntensity
    );
    scene.add(hemiLight);

    sunLight = new THREE.DirectionalLight(currentSunVisual.sunColor, currentSunVisual.sunIntensity);
    sunLight.position.copy(currentSunVisual.pos);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1.0;
    sunLight.shadow.camera.far = 30.0;
    const frustum = 4.8;
    sunLight.shadow.camera.left = -frustum;
    sunLight.shadow.camera.right = frustum;
    sunLight.shadow.camera.top = frustum;
    sunLight.shadow.camera.bottom = -frustum;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    // Visible glowing orb in sky matching active sun/moon state
    sunOrbMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.36, 20, 20),
        new THREE.MeshBasicMaterial({ color: currentSunVisual.orbColor })
    );
    sunOrbMesh.userData.noShadow = true;
    sunHaloMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.58, 20, 20),
        new THREE.MeshBasicMaterial({
            color: currentSunVisual.orbColor,
            transparent: true,
            opacity: 0.22,
            depthWrite: false
        })
    );
    sunHaloMesh.userData.noShadow = true;
    sunOrbMesh.add(sunHaloMesh);
    scene.add(sunOrbMesh);
    updateSunOrbTransform();
}

function updateSunOrbTransform() {
    if (!sunOrbMesh || !sunLight) return;
    const orbDir = sunLight.position.clone().normalize().multiplyScalar(9.6);
    sunOrbMesh.position.copy(orbDir);
    sunOrbMesh.scale.setScalar(currentSunVisual.orbScale);
    sunOrbMesh.material.color.copy(currentSunVisual.orbColor);
    if (sunHaloMesh) {
        sunHaloMesh.material.color.copy(currentSunVisual.orbColor);
    }
}

function triggerSunTransitionIfNeeded(forceImmediate = false) {
    const nextSlot = resolveTargetSunSlot();
    const preset = SUN_PRESETS[nextSlot] || SUN_PRESETS.siang;

    if (forceImmediate) {
        activeResolvedSlot = nextSlot;
        currentSunVisual.pos.copy(preset.pos);
        currentSunVisual.sunColor.setHex(preset.sunColor);
        currentSunVisual.sunIntensity = preset.sunIntensity;
        currentSunVisual.hemiSky.setHex(preset.hemiSky);
        currentSunVisual.hemiGround.setHex(preset.hemiGround);
        currentSunVisual.hemiIntensity = preset.hemiIntensity;
        currentSunVisual.ambIntensity = preset.ambIntensity;
        currentSunVisual.bgColor.setHex(preset.bgColor);
        currentSunVisual.orbColor.setHex(preset.orbColor);
        currentSunVisual.orbScale = preset.orbScale;
        applyCurrentSunVisuals();
        sunTransition = null;
        return;
    }

    if (nextSlot === activeResolvedSlot && !sunTransition) return;
    activeResolvedSlot = nextSlot;

    const startSph = new THREE.Spherical().setFromVector3(currentSunVisual.pos);
    const endSph = new THREE.Spherical().setFromVector3(preset.pos);
    let dTheta = (endSph.theta - startSph.theta) % (2 * Math.PI);
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI;

    sunTransition = {
        startTime: performance.now(),
        duration: 1000,
        startRadius: startSph.radius,
        endRadius: endSph.radius,
        startPhi: startSph.phi,
        endPhi: endSph.phi,
        startTheta: startSph.theta,
        dTheta,
        startSunColor: currentSunVisual.sunColor.clone(),
        endSunColor: new THREE.Color(preset.sunColor),
        startSunIntensity: currentSunVisual.sunIntensity,
        endSunIntensity: preset.sunIntensity,
        startHemiSky: currentSunVisual.hemiSky.clone(),
        endHemiSky: new THREE.Color(preset.hemiSky),
        startHemiGround: currentSunVisual.hemiGround.clone(),
        endHemiGround: new THREE.Color(preset.hemiGround),
        startHemiIntensity: currentSunVisual.hemiIntensity,
        endHemiIntensity: preset.hemiIntensity,
        startAmbIntensity: currentSunVisual.ambIntensity,
        endAmbIntensity: preset.ambIntensity,
        startBgColor: currentSunVisual.bgColor.clone(),
        endBgColor: new THREE.Color(preset.bgColor),
        startOrbColor: currentSunVisual.orbColor.clone(),
        endOrbColor: new THREE.Color(preset.orbColor),
        startOrbScale: currentSunVisual.orbScale,
        endOrbScale: preset.orbScale
    };
}

function applyCurrentSunVisuals() {
    if (!scene || !sunLight || !hemiLight || !ambientLight) return;
    sunLight.position.copy(currentSunVisual.pos);
    sunLight.color.copy(currentSunVisual.sunColor);
    sunLight.intensity = currentSunVisual.sunIntensity;

    hemiLight.color.copy(currentSunVisual.hemiSky);
    hemiLight.groundColor.copy(currentSunVisual.hemiGround);
    hemiLight.intensity = currentSunVisual.hemiIntensity;

    ambientLight.intensity = currentSunVisual.ambIntensity;
    scene.background = currentSunVisual.bgColor;
    updateSunOrbTransform();
}

function createParticleSystems() {
    // Exhaust airflow particles streaming backward at X = -1.15
    const airMat = new THREE.MeshBasicMaterial({ color: 0x17c9b4, transparent: true, opacity: 0.6 });
    const airGeo = new THREE.SphereGeometry(0.035, 8, 8);
    for (let i = 0; i < 22; i++) {
        const p = new THREE.Mesh(airGeo, airMat.clone());
        p.position.set(
            -1.15 + (Math.random() - 0.5) * 0.35,
            1.45 + (Math.random() - 0.5) * 0.35,
            -1.95 - Math.random() * 1.8
        );
        p.userData = { initZ: -1.95, speed: 0.03 + Math.random() * 0.035, life: Math.random(), noShadow: true };
        p.visible = false;
        houseGroup.add(p);
        fanParticles.push(p);
    }

    const smokeMat = new THREE.MeshBasicMaterial({ color: 0xff5a36, transparent: true, opacity: 0.55 });
    const smokeGeo = new THREE.SphereGeometry(0.12, 8, 8);
    for (let i = 0; i < 26; i++) {
        const s = new THREE.Mesh(smokeGeo, smokeMat.clone());
        s.position.set(
            (Math.random() - 0.5) * 2.8,
            0.5 + Math.random() * 2.4,
            (Math.random() - 0.5) * 2.8
        );
        s.userData = { baseY: 0.4, speedY: 0.015 + Math.random() * 0.02, driftX: (Math.random() - 0.5) * 0.01, noShadow: true };
        s.visible = false;
        houseGroup.add(s);
        smokeParticles.push(s);
    }

    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff3b30,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
    });
    for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 24), ringMat.clone());
        ring.position.set(1.15, 0.99, -2.65);
        ring.rotation.x = Math.PI / 2;
        ring.userData = { progress: i * 0.33, noShadow: true };
        ring.visible = false;
        houseGroup.add(ring);
        soundWaveMeshes.push(ring);
    }
}

const HOTSPOT_DEFINITIONS = [
    {
        id: 'fan',
        name: 'Exhaust Fan',
        icon: 'mode_fan',
        filled: true,
        pos: new THREE.Vector3(-1.15, 1.86, -1.98)
    },
    {
        id: 'lamp',
        name: 'Lampu',
        icon: 'light',
        filled: false,
        pos: new THREE.Vector3(0.0, 2.28, 0.13)
    },
    {
        id: 'alarm',
        name: 'Alarm',
        icon: 'notification_sound',
        filled: true,
        pos: new THREE.Vector3(1.15, 0.98, -2.65)
    }
];

function initHotspots() {
    hotspotObjects = [];

    HOTSPOT_DEFINITIONS.forEach(def => {
        const anchorEl = document.createElement('div');
        anchorEl.className = 'hotspot-anchor';

        const btnEl = document.createElement('button');
        btnEl.type = 'button';
        btnEl.className = `hotspot-pill-btn pin-${def.id}`;
        btnEl.setAttribute('aria-label', `${def.name} - Klik untuk fokus kamera`);
        btnEl.innerHTML = `
            <span class="hotspot-ring" aria-hidden="true"></span>
            <span class="hotspot-icon-circle" aria-hidden="true">
                <span class="material-symbols-rounded${def.filled ? ' icon-filled' : ''} hotspot-gicon">${def.icon}</span>
            </span>
            <span class="hotspot-hover-card">
                <span class="hotspot-name">${def.name}</span>
                <span class="hotspot-sep">&bull;</span>
                <span class="hotspot-state is-off" data-state-label>OFF</span>
            </span>
        `;

        btnEl.addEventListener('click', e => {
            e.stopPropagation();
            focusHotspot(def.id);
        });

        anchorEl.appendChild(btnEl);

        const cObject = new CSS2DObject(anchorEl);
        cObject.position.copy(def.pos);
        houseGroup.add(cObject);

        hotspotObjects.push({
            id: def.id,
            name: def.name,
            object: cObject,
            anchor: anchorEl,
            btn: btnEl,
            stateLabel: btnEl.querySelector('[data-state-label]'),
            worldPos: def.pos.clone()
        });
    });

    bindInteractiveRaycaster();
}

function toggleInteractivePart(type) {
    const entry = doorAnimState[type];
    if (!entry) return;
    entry.open = !entry.open;
    entry.startVal = entry.current;
    entry.target = entry.open ? entry.openAngle : 0;
    entry.startTime = performance.now();
    entry.animating = true;
}

function bindInteractiveRaycaster() {
    const dom = renderer.domElement;

    const getHitObject = (clientX, clientY) => {
        const rect = dom.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(interactiveTargets, false);
        return hits.length ? hits[0].object : null;
    };

    dom.addEventListener('pointerdown', e => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    dom.addEventListener('pointermove', e => {
        if (isUserInteracting) {
            dom.style.cursor = 'grabbing';
            return;
        }
        const hit = getHitObject(e.clientX, e.clientY);
        dom.style.cursor = hit ? 'pointer' : 'grab';
    });

    // Distinguish fast click (< 5px pointer travel) from OrbitControls drag
    dom.addEventListener('pointerup', e => {
        const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        if (dist >= 5) return;

        const hit = getHitObject(e.clientX, e.clientY);
        if (hit && hit.userData.interactiveType) {
            toggleInteractivePart(hit.userData.interactiveType);
        } else {
            closeInspector();
        }
    });
}

function updateHotspotsOcclusion() {
    if (!camera || hotspotObjects.length === 0) return;
    hotspotObjects.forEach(h => {
        h.anchor.style.opacity = '1';
        h.anchor.style.visibility = 'visible';
        h.btn.style.pointerEvents = 'auto';
    });
}

export function focusHotspot(id) {
    activeHotspotId = id;
    hotspotObjects.forEach(h => {
        h.btn.classList.toggle('is-focused', h.id === id);
    });

    if (id === 'lamp') {
        setRoofOpen(true);
        animateCameraSpherical(
            new THREE.Vector3(2.4, 5.0, 3.8),
            new THREE.Vector3(0, 1.85, 0.1),
            1200
        );
    } else if (id === 'fan') {
        animateCameraSpherical(
            new THREE.Vector3(-1.35, 2.35, -5.6),
            new THREE.Vector3(-1.15, 1.45, -1.8),
            1200
        );
    } else if (id === 'alarm') {
        animateCameraSpherical(
            new THREE.Vector3(3.4, 2.7, -5.2),
            new THREE.Vector3(1.05, 1.05, -2.55),
            1200
        );
    }
}

export function inspectHotspot(id) {
    focusHotspot(id);
}

export function closeInspector() {
    activeHotspotId = null;
    hotspotObjects.forEach(h => {
        h.btn.classList.remove('is-focused');
    });
}

export function setSunTime(mode) {
    const normalized = String(mode || 'auto').toLowerCase();
    sunTimeMode = normalized === 'auto' || SUN_PRESETS[normalized] ? normalized : 'auto';
    updateSunButtonsUI();
    triggerSunTransitionIfNeeded(false);
    updateData(currentData);
}

function updateSunButtonsUI() {
    document.querySelectorAll('.sun-btn[data-sun]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.sun === sunTimeMode);
    });
}

export function init(containerElement) {
    if (!containerElement) return false;
    container = containerElement;

    try {
        const testCanvas = document.createElement('canvas');
        if (!window.WebGLRenderingContext || (!testCanvas.getContext('webgl') && !testCanvas.getContext('experimental-webgl'))) {
            showFallback('Browser Anda tidak mendukung WebGL untuk akselerasi 3D.');
            return false;
        }
    } catch {
        showFallback('Terjadi kendala saat memeriksa dukungan WebGL.');
        return false;
    }

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 420;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.copy(VIEW_PRESETS.outside.cam);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Overlay hotspot renderer keeps pointerEvents disabled so orbit drags work seamlessly
    cssRenderer = new CSS2DRenderer();
    cssRenderer.setSize(width, height);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0';
    cssRenderer.domElement.style.left = '0';
    cssRenderer.domElement.style.width = '100%';
    cssRenderer.domElement.style.height = '100%';
    cssRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(cssRenderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 3.5;
    controls.maxDistance = 16.0;
    controls.target.copy(VIEW_PRESETS.outside.target);

    controls.addEventListener('start', () => {
        activeCameraTween = null;
        isUserInteracting = true;
        lastAutoHighlightTime = performance.now();
    });
    controls.addEventListener('end', () => {
        isUserInteracting = false;
        lastAutoHighlightTime = performance.now();
    });

    createSunAndSkyRig();
    triggerSunTransitionIfNeeded(true);
    buildModel();
    initHotspots();

    window.addEventListener('resize', onWindowResize);
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => onWindowResize());
        ro.observe(container);
    }

    const btnViewOutside = document.getElementById('btn-view-outside');
    if (btnViewOutside) {
        btnViewOutside.addEventListener('click', () => setRoomView('outside'));
    }

    const btnViewInside = document.getElementById('btn-view-inside');
    if (btnViewInside) {
        btnViewInside.addEventListener('click', () => setRoomView('inside'));
    }

    const btnToggleAutofocus = document.getElementById('btn-toggle-autofocus');
    if (btnToggleAutofocus) {
        btnToggleAutofocus.addEventListener('click', () => toggleAutoFocus());
    }

    const btnResetCam = document.getElementById('btn-reset-cam');
    if (btnResetCam) {
        btnResetCam.addEventListener('click', resetCamera);
    }

    document.querySelectorAll('.sun-btn[data-sun]').forEach(btn => {
        btn.addEventListener('click', () => setSunTime(btn.dataset.sun));
    });

    updateSunButtonsUI();
    updateAutoFocusButtonUI();
    updateRoofButtonUI();
    updateData(currentData);

    isInitialized = true;
    lastTime = performance.now();
    animate();
    return true;
}

function showFallback(message) {
    if (!container) return;
    container.innerHTML = `
        <div class="webgl-fallback">
            <div class="fallback-icon">⚠️</div>
            <h3>Visualisasi 3D Tidak Tersedia</h3>
            <p>${message}</p>
            <span>Seluruh data sensor dan kendali otomatis tetap aktif normal pada panel dashboard.</span>
        </div>
    `;
}

function onWindowResize() {
    if (!container || !renderer || !camera) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    cssRenderer.setSize(w, h);
}

export function setRoofOpen(open) {
    const targetOpen = Boolean(open);
    if (isRoofOpen === targetOpen && !roofAnim) {
        updateRoofButtonUI();
        return isRoofOpen;
    }

    isRoofOpen = targetOpen;
    const duration = 380;
    const now = performance.now();
    const currentY = roofGroup ? roofGroup.position.y : 0;

    let currentOp = isRoofOpen ? 1.0 : 0.0;
    if (roofGroup) {
        roofGroup.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.transparent = true;
                if (typeof child.material.opacity === 'number' && roofAnim) {
                    currentOp = child.material.opacity;
                }
            }
        });
        roofGroup.visible = true;
    }

    roofAnim = {
        startY: currentY,
        endY: isRoofOpen ? 2.4 : 0.0,
        startOpacity: currentOp,
        endOpacity: isRoofOpen ? 0.0 : 1.0,
        startTime: now,
        duration
    };

    updateRoofButtonUI();
    return isRoofOpen;
}

export function toggleRoof() {
    return setRoofOpen(!isRoofOpen);
}

export function setRoomView(mode) {
    if (mode === 'inside') {
        currentViewMode = 'inside';
        setRoofOpen(true);
        animateCameraSpherical(VIEW_PRESETS.inside.cam, VIEW_PRESETS.inside.target, 1200);
    } else {
        currentViewMode = 'outside';
        setRoofOpen(false);
        closeInspector();
        animateCameraSpherical(VIEW_PRESETS.outside.cam, VIEW_PRESETS.outside.target, 1200);
    }
}

export function updateRoofButtonUI() {
    const btnOutside = document.getElementById('btn-view-outside');
    const btnInside = document.getElementById('btn-view-inside');
    if (btnOutside) btnOutside.classList.toggle('is-active', !isRoofOpen);
    if (btnInside) btnInside.classList.toggle('is-active', isRoofOpen);
}

export function toggleAutoFocus(forceState = null) {
    isAutoFocusEnabled = forceState !== null ? Boolean(forceState) : !isAutoFocusEnabled;
    updateAutoFocusButtonUI();
    return isAutoFocusEnabled;
}

export function updateAutoFocusButtonUI() {
    const btnAuto = document.getElementById('btn-toggle-autofocus');
    if (btnAuto) {
        btnAuto.classList.toggle('is-on', isAutoFocusEnabled);
        btnAuto.setAttribute('aria-checked', String(isAutoFocusEnabled));
    }
}

export function resetCamera() {
    setRoomView('outside');
}

export function setViewMode(modeName) {
    if (modeName === 'inside' || modeName === 'outside') {
        setRoomView(modeName);
        return;
    }
    if (!VIEW_PRESETS[modeName]) return;
    currentViewMode = modeName;
    const preset = VIEW_PRESETS[modeName];
    animateCameraSpherical(preset.cam, preset.target, 1200);
}

export function resetView() {
    resetCamera();
}

export function focusScenario(scenario, force = false) {
    if (!force && !isAutoFocusEnabled) return;

    triggerSunTransitionIfNeeded(false);

    if (scenario === 'dark' || scenario === 'lamp') {
        focusHotspot('lamp');
    } else if (scenario === 'humid' || scenario === 'fan') {
        focusHotspot('fan');
    } else if (scenario === 'gas' || scenario === 'alarm' || scenario === 'emergency') {
        focusHotspot('alarm');
    } else if (scenario === 'normal') {
        setRoomView('outside');
    } else if (scenario === 'anomaly') {
        setRoofOpen(false);
        animateCameraSpherical(new THREE.Vector3(5.5, 4.8, 6.5), new THREE.Vector3(0, 1.2, 0), 1200);
    }
}

function checkAutoHighlight(data) {
    if (!data) return;

    const isOnline = Boolean(data.esp32_online) || Boolean(window.isSimulationModeActive);
    if (!isOnline) {
        prevLiveState.hasBaseline = true;
        prevLiveState.fanOn = false;
        prevLiveState.ledOn = false;
        prevLiveState.gasDanger = false;
        return;
    }

    const gasThreshold = Number(data.gas_threshold ?? GAS_THRESHOLD);
    const gas = Number(data.gas ?? 0);
    const ledOn = String(data.led ?? 'OFF').toUpperCase() === 'ON';
    const fanOn = String(data.kipas ?? 'OFF').toUpperCase() === 'ON';
    const buzzerOn = String(data.buzzer ?? 'OFF').toUpperCase() === 'ON';
    const gasDanger = gas >= gasThreshold || (buzzerOn && !data.buzzer_muted);

    if (!prevLiveState.hasBaseline) {
        prevLiveState = { hasBaseline: true, fanOn, ledOn, gasDanger };
        return;
    }

    const now = performance.now();
    const canTrigger = isAutoFocusEnabled && !isUserInteracting && (now - lastAutoHighlightTime > 1600);

    if (gasDanger && !prevLiveState.gasDanger && canTrigger) {
        lastAutoHighlightTime = now;
        focusScenario('gas');
    } else if (fanOn && !prevLiveState.fanOn && !gasDanger && canTrigger) {
        lastAutoHighlightTime = now;
        focusScenario('humid');
    } else if (ledOn && !prevLiveState.ledOn && canTrigger) {
        lastAutoHighlightTime = now;
        focusScenario('dark');
    }

    prevLiveState.fanOn = fanOn;
    prevLiveState.ledOn = ledOn;
    prevLiveState.gasDanger = gasDanger;
}

export function updateData(data) {
    if (!data) return;
    currentData = Object.assign(currentData, data);

    const online = Boolean(currentData.esp32_online);
    const isSystemActive = online || Boolean(window.isSimulationModeActive);
    const kelembapan = online ? Number(currentData.kelembapan ?? 0) : 0;
    const gas = online ? Number(currentData.gas ?? 0) : 0;
    const realLedOn = String(currentData.led ?? 'OFF').toUpperCase() === 'ON';
    const fanOn = String(currentData.kipas ?? 'OFF').toUpperCase() === 'ON';
    const buzzerRaw = String(currentData.buzzer ?? 'OFF').toUpperCase();
    const isMuted = Boolean(currentData.buzzer_muted) || buzzerRaw === 'MUTED';
    const alarmOn = buzzerRaw === 'ON' && !isMuted;

    triggerSunTransitionIfNeeded(false);
    checkAutoHighlight(currentData);

    // Offline night preview automatically turns on 3D lamp without changing real sensor status cards
    const isNightPreviewAuto = !isSystemActive && sunTimeMode === 'malam' && !Boolean(currentData.has_manual_led);
    const visualLedOn = isNightPreviewAuto ? true : realLedOn;

    const previewBadge = document.getElementById('sun-preview-badge');
    if (previewBadge) {
        previewBadge.hidden = !isNightPreviewAuto;
    }

    if (roomLight) {
        roomLight.intensity = visualLedOn ? 5.6 : 0.0;
        roomLight.color.setHex(0xffd27d);
    }
    if (beamLedMat) {
        beamLedMat.emissiveIntensity = visualLedOn ? 2.6 : 0.1;
    }
    if (laptopScreenMat) {
        laptopScreenMat.emissiveIntensity = activeResolvedSlot === 'malam' ? 0.95 : 0.35;
    }

    const espLed = scene?.getObjectByName('espStatusLed');
    if (espLed && espLed.material && espLedLight) {
        const hex = online ? 0x2bd9a8 : 0xff4d5e;
        espLed.material.color.setHex(hex);
        espLed.material.emissive.setHex(hex);
        espLedLight.color.setHex(hex);
    }

    const gasThreshold = Number(currentData.gas_threshold ?? GAS_THRESHOLD);
    if (floorGlowMesh && floorGlowMesh.material) {
        if (gas >= gasThreshold) {
            floorGlowMesh.material.color.setHex(0xff4d5e);
            floorGlowMesh.material.opacity = 0.28;
        } else if (kelembapan >= 60) {
            floorGlowMesh.material.color.setHex(0x38bdf8);
            floorGlowMesh.material.opacity = 0.2;
        } else {
            floorGlowMesh.material.color.setHex(0x17c9b4);
            floorGlowMesh.material.opacity = online ? 0.1 : 0.04;
        }
    }

    hotspotObjects.forEach(h => {
        let stateText = 'OFF';
        let stateClass = 'is-off';
        let activeHalo = false;
        let dangerHalo = false;

        if (h.id === 'fan') {
            stateText = fanOn ? 'ON' : 'OFF';
            stateClass = fanOn ? 'is-on' : 'is-off';
            activeHalo = fanOn;
        } else if (h.id === 'lamp') {
            stateText = realLedOn ? 'ON' : 'OFF';
            stateClass = realLedOn ? 'is-on' : 'is-off';
            activeHalo = visualLedOn;
        } else if (h.id === 'alarm') {
            if (alarmOn) {
                stateText = 'ON';
                stateClass = 'is-on';
                dangerHalo = true;
            } else if (isMuted && gas >= gasThreshold) {
                stateText = 'MUTED';
                stateClass = 'is-muted';
            }
        }

        if (h.stateLabel) {
            h.stateLabel.textContent = stateText;
            h.stateLabel.className = `hotspot-state ${stateClass}`;
        }
        h.btn.classList.toggle('status-active', activeHalo);
        h.btn.classList.toggle('status-danger', dangerHalo);
    });
}

let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (activeCameraTween) {
        const elapsed = now - activeCameraTween.startTime;
        const p = Math.min(1.0, elapsed / activeCameraTween.duration);
        const ease = easeInOutCubic(p);

        if (activeCameraTween.type === 'spherical') {
            const currentTarget = new THREE.Vector3().lerpVectors(
                activeCameraTween.startTarget,
                activeCameraTween.endTarget,
                ease
            );
            const r = THREE.MathUtils.lerp(activeCameraTween.startRadius, activeCameraTween.endRadius, ease);
            const phi = THREE.MathUtils.lerp(activeCameraTween.startPhi, activeCameraTween.endPhi, ease);
            const theta = activeCameraTween.startTheta + activeCameraTween.dTheta * ease;

            const offset = new THREE.Vector3().setFromSphericalCoords(r, phi, theta);
            camera.position.copy(currentTarget).add(offset);
            controls.target.copy(currentTarget);
        } else {
            camera.position.lerpVectors(activeCameraTween.startCam, activeCameraTween.endCam, ease);
            controls.target.lerpVectors(activeCameraTween.startTarget, activeCameraTween.endTarget, ease);
        }

        if (p >= 1.0) {
            controls.target.copy(activeCameraTween.endTarget || activeCameraTween.startTarget);
            const cb = activeCameraTween.onComplete;
            activeCameraTween = null;
            if (cb) cb();
        }
    }
    controls.update();

    // Smooth ~1s sun cycle spherical arc lerp
    if (sunTransition) {
        const p = Math.min(1.0, (now - sunTransition.startTime) / sunTransition.duration);
        const ease = easeInOutCubic(p);

        const r = THREE.MathUtils.lerp(sunTransition.startRadius, sunTransition.endRadius, ease);
        const phi = THREE.MathUtils.lerp(sunTransition.startPhi, sunTransition.endPhi, ease);
        const theta = sunTransition.startTheta + sunTransition.dTheta * ease;
        currentSunVisual.pos.setFromSphericalCoords(r, phi, theta);

        currentSunVisual.sunColor.copy(sunTransition.startSunColor).lerp(sunTransition.endSunColor, ease);
        currentSunVisual.sunIntensity = THREE.MathUtils.lerp(sunTransition.startSunIntensity, sunTransition.endSunIntensity, ease);
        currentSunVisual.hemiSky.copy(sunTransition.startHemiSky).lerp(sunTransition.endHemiSky, ease);
        currentSunVisual.hemiGround.copy(sunTransition.startHemiGround).lerp(sunTransition.endHemiGround, ease);
        currentSunVisual.hemiIntensity = THREE.MathUtils.lerp(sunTransition.startHemiIntensity, sunTransition.endHemiIntensity, ease);
        currentSunVisual.ambIntensity = THREE.MathUtils.lerp(sunTransition.startAmbIntensity, sunTransition.endAmbIntensity, ease);
        currentSunVisual.bgColor.copy(sunTransition.startBgColor).lerp(sunTransition.endBgColor, ease);
        currentSunVisual.orbColor.copy(sunTransition.startOrbColor).lerp(sunTransition.endOrbColor, ease);
        currentSunVisual.orbScale = THREE.MathUtils.lerp(sunTransition.startOrbScale, sunTransition.endOrbScale, ease);
        applyCurrentSunVisuals();

        if (p >= 1.0) {
            sunTransition = null;
        }
    }

    // Smooth ~380ms roof lift and fade
    if (roofAnim) {
        const p = Math.min(1.0, (now - roofAnim.startTime) / roofAnim.duration);
        const ease = easeOutCubic(p);
        if (roofGroup) {
            roofGroup.position.y = roofAnim.startY + (roofAnim.endY - roofAnim.startY) * ease;
            const currentOp = roofAnim.startOpacity + (roofAnim.endOpacity - roofAnim.startOpacity) * ease;
            roofGroup.traverse(child => {
                if (child.isMesh && child.material) {
                    child.material.opacity = currentOp;
                }
            });
            if (p >= 1.0) {
                roofGroup.position.y = roofAnim.endY;
                if (isRoofOpen) {
                    roofGroup.visible = false;
                } else {
                    roofGroup.traverse(child => {
                        if (child.isMesh && child.material) {
                            child.material.opacity = 1.0;
                            child.material.transparent = false;
                        }
                    });
                }
                roofAnim = null;
            }
        }
    }

    // Smooth 500ms easeOutCubic hinge motion for clickable door, window, and cubicle door
    [
        { pivot: doorPivot, st: doorAnimState.frontDoor },
        { pivot: windowPivot, st: doorAnimState.frontWindow },
        { pivot: cubicleDoorPivot, st: doorAnimState.cubicleDoor }
    ].forEach(({ pivot, st }) => {
        if (!pivot || !st.animating) return;
        const p = Math.min(1.0, (now - st.startTime) / 500);
        const ease = easeOutCubic(p);
        st.current = st.startVal + (st.target - st.startVal) * ease;
        pivot.rotation.y = st.current;
        if (p >= 1.0) {
            st.current = st.target;
            st.animating = false;
        }
    });

    // Gentle pulse on interior wall LED
    if (insideRedLedMat) {
        insideRedLedMat.emissiveIntensity = 1.8 + Math.sin(now * 0.004) * 0.45;
    }

    const isOnline = Boolean(currentData.esp32_online);
    const isFanOn = String(currentData.kipas ?? 'OFF').toUpperCase() === 'ON';
    if (fanImpeller && isFanOn) {
        fanImpeller.rotation.z -= delta * 24.0;
    }

    for (let i = 0; i < fanParticles.length; i++) {
        const p = fanParticles[i];
        p.visible = isFanOn;
        if (isFanOn) {
            p.position.z -= p.userData.speed;
            p.userData.life += delta;
            p.material.opacity = Math.max(0, 0.6 - (p.userData.life % 1.5) * 0.4);
            if (p.position.z < -4.5) {
                p.position.z = p.userData.initZ;
                p.userData.life = 0;
            }
        }
    }

    const gasThreshold = Number(currentData.gas_threshold ?? GAS_THRESHOLD);
    const isGasHazard = isOnline && Number(currentData.gas ?? 0) >= gasThreshold;
    for (let i = 0; i < smokeParticles.length; i++) {
        const s = smokeParticles[i];
        s.visible = isGasHazard;
        if (isGasHazard) {
            s.position.y += s.userData.speedY;
            s.position.x += s.userData.driftX;
            if (s.position.y > 3.4) {
                s.position.y = s.userData.baseY;
                s.position.x = (Math.random() - 0.5) * 2.6;
            }
        }
    }

    const isBuzzerActive = String(currentData.buzzer ?? 'OFF').toUpperCase() === 'ON' && !currentData.buzzer_muted;
    for (let i = 0; i < soundWaveMeshes.length; i++) {
        const ring = soundWaveMeshes[i];
        ring.visible = isBuzzerActive;
        if (isBuzzerActive) {
            ring.userData.progress = (ring.userData.progress + delta * 1.4) % 1.0;
            const prog = ring.userData.progress;
            const scale = 0.5 + prog * 3.5;
            ring.scale.set(scale, scale, 1);
            ring.material.opacity = (1.0 - prog) * 0.8;
        }
    }

    updateHotspotsOcclusion();
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
}

window.Room3D = {
    init,
    updateData,
    toggleRoof,
    setRoofOpen,
    setRoomView,
    toggleAutoFocus,
    resetCamera,
    focusHotspot,
    inspectHotspot,
    closeInspector,
    focusScenario,
    setViewMode,
    resetView,
    setSunTime
};
