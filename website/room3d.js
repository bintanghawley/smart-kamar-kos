import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/CSS2DRenderer.js';

let scene, camera, renderer, cssRenderer, controls;
let container;
let isInitialized = false;

let houseGroup, roofGroup, interiorGroup;
let fanImpeller, fanHousing, fanParticles = [], smokeParticles = [], soundWaveMeshes = [];
let roomLight, espLedLight, floorGlowMesh;

// Hotspot System
let hotspotObjects = [];
let activeHotspotId = null;

let currentViewMode = 'outside';
let activeCameraTween = null;

// Roof & Auto-Focus System
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

let currentData = {
    suhu: 0,
    kelembapan: 0,
    cahaya: 0,
    gas: 0,
    led: 'OFF',
    buzzer: 'OFF',
    kipas: 'OFF',
    buzzer_muted: false,
    esp32_online: false
};

const VIEW_PRESETS = {
    outside: {
        cam: new THREE.Vector3(6.8, 5.2, 7.8),
        target: new THREE.Vector3(0, 1.2, 0)
    },
    inside: {
        cam: new THREE.Vector3(0.1, 7.8, 4.5),
        target: new THREE.Vector3(0, 0.8, 0)
    },
    sensors: {
        cam: new THREE.Vector3(-1.0, 4.2, -7.5),
        target: new THREE.Vector3(0, 1.3, -0.8)
    }
};

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function animateCameraSpherical(targetCam, targetTarget, duration = 1600, onComplete = null) {
    if (!camera || !controls) return;

    const startTarget = controls.target.clone();
    const endTarget = targetTarget.clone();

    const startOffset = new THREE.Vector3().subVectors(camera.position, startTarget);
    const endOffset = new THREE.Vector3().subVectors(targetCam, endTarget);

    const startSph = new THREE.Spherical().setFromVector3(startOffset);
    const endSph = new THREE.Spherical().setFromVector3(endOffset);

    // Ambil jalur rotasi theta terpendek pada sumbu horizontal
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

function animateCameraTo(targetCam, targetTarget, duration = 1600, onComplete = null) {
    animateCameraSpherical(targetCam, targetTarget, duration, onComplete);
}

function createSignTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#b68352';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#5c3a1c';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

    ctx.fillStyle = '#1c1510';
    ctx.font = 'bold 52px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '4px';
    ctx.fillText('KAMAR KOS 01', canvas.width / 2, canvas.height / 2);

    return new THREE.CanvasTexture(canvas);
}

function createRoofTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#c7974c';
    ctx.fillRect(0, 0, 256, 256);

    const stripeWidth = 16;
    for (let x = 0; x < 256; x += stripeWidth) {
        const grad = ctx.createLinearGradient(x, 0, x + stripeWidth, 0);
        grad.addColorStop(0, '#e5b869');
        grad.addColorStop(0.4, '#c7974c');
        grad.addColorStop(0.9, '#9d6e2c');
        grad.addColorStop(1, '#835a22');
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, stripeWidth, 256);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 2);
    return tex;
}

function createFloorTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#7a5133';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#57371f';
    ctx.lineWidth = 2;
    const tileSize = 32;
    for (let y = 0; y < 256; y += tileSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
    }
    for (let x = 0; x < 256; x += tileSize * 2) {
        for (let y = 0; y < 256; y += tileSize) {
            const shift = (y / tileSize) % 2 === 0 ? 0 : tileSize;
            ctx.beginPath();
            ctx.moveTo(x + shift, y);
            ctx.lineTo(x + shift, y + tileSize);
            ctx.stroke();
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
}

function buildModel() {
    houseGroup = new THREE.Group();
    scene.add(houseGroup);

    // 1. Alas Maket / Ground Plate (Karton Hijau Tua dengan Lis Biru Teal)
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x1e4b37,
        roughness: 0.85,
        metalness: 0.05
    });
    const baseBorderMat = new THREE.MeshStandardMaterial({
        color: 0x097894,
        roughness: 0.6,
        metalness: 0.1
    });

    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 7.6), baseMat);
    baseMesh.position.set(0, -0.11, -0.2);
    baseMesh.receiveShadow = true;
    houseGroup.add(baseMesh);

    // Lis Pembatas Alas Maket
    const lipF = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.32, 0.12), baseBorderMat);
    lipF.position.set(0, -0.06, 3.6);
    const lipB = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.32, 0.12), baseBorderMat);
    lipB.position.set(0, -0.06, -4.0);
    const lipL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 7.6), baseBorderMat);
    lipL.position.set(-3.4, -0.06, -0.2);
    const lipR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 7.6), baseBorderMat);
    lipR.position.set(3.4, -0.06, -0.2);
    houseGroup.add(lipF, lipB, lipL, lipR);

    // 2. Bangunan Utama (Dinding Merah Bata Matte)
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0xb5362b,
        roughness: 0.72,
        metalness: 0.04
    });

    const houseW = 4.0;  // X: -2.0 s/d +2.0
    const houseD = 3.6;  // Z: -1.8 s/d +1.8
    const houseH = 2.4;  // Eaves height at Y = 2.4
    const roofPeakY = 3.52; // Ridge peak at Z = 0, Y = 3.52
    const wallThick = 0.12;

    // Lantai Kamar Kos
    const floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(houseW - 0.08, houseD - 0.08),
        new THREE.MeshStandardMaterial({
            map: createFloorTexture(),
            roughness: 0.6,
            metalness: 0.1
        })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0.01, 0);
    floorMesh.receiveShadow = true;
    houseGroup.add(floorMesh);

    // Pendar Kenyamanan Lantai (Comfort Glow)
    floorGlowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(houseW - 0.2, houseD - 0.2),
        new THREE.MeshBasicMaterial({
            color: 0x17c9b4,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide
        })
    );
    floorGlowMesh.rotation.x = -Math.PI / 2;
    floorGlowMesh.position.set(0, 0.02, 0);
    houseGroup.add(floorGlowMesh);

    // Dinding depan (+Z = 1.80) via THREE.Shape utuh dengan lubang pintu, jendela, dan ventilasi
    const frontShape = new THREE.Shape();
    frontShape.moveTo(-houseW / 2, 0);
    frontShape.lineTo(houseW / 2, 0);
    frontShape.lineTo(houseW / 2, houseH);
    frontShape.lineTo(-houseW / 2, houseH);
    frontShape.closePath();

    // Lubang Pintu (Kiri Bawah): X dari -1.60 s/d -0.65, Y dari 0 s/d 1.80
    const doorHole = new THREE.Path();
    doorHole.moveTo(-1.60, 0);
    doorHole.lineTo(-0.65, 0);
    doorHole.lineTo(-0.65, 1.80);
    doorHole.lineTo(-1.60, 1.80);
    doorHole.closePath();
    frontShape.holes.push(doorHole);

    // Lubang Jendela (Kanan): X dari 0.40 s/d 1.60, Y dari 0.65 s/d 1.70
    const windowHole = new THREE.Path();
    windowHole.moveTo(0.40, 0.65);
    windowHole.lineTo(1.60, 0.65);
    windowHole.lineTo(1.60, 1.70);
    windowHole.lineTo(0.40, 1.70);
    windowHole.closePath();
    frontShape.holes.push(windowHole);

    // Lubang Ventilasi Kecil Depan (2 di atas pintu, 1 di atas jendela)
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

    const frontGeo = new THREE.ExtrudeGeometry(frontShape, {
        depth: wallThick,
        bevelEnabled: false
    });
    const frontWallMesh = new THREE.Mesh(frontGeo, wallMat);
    // Extruded along Z: position at z = houseD/2 - wallThick so front surface is at z = houseD/2 (+1.80)
    frontWallMesh.position.set(0, 0, houseD / 2 - wallThick);
    frontWallMesh.castShadow = true;
    frontWallMesh.receiveShadow = true;
    houseGroup.add(frontWallMesh);

    // Daun Pintu Cokelat Kayu & Kusen di Lubang Pintu
    const doorMat = new THREE.MeshStandardMaterial({
        color: 0x824f2b,
        roughness: 0.8,
        metalness: 0.08
    });
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.78, 0.06), doorMat);
    doorMesh.position.set(-1.125, 0.89, houseD / 2 - wallThick / 2);
    doorMesh.castShadow = true;

    const handleMat = new THREE.MeshStandardMaterial({ color: 0xd4a76a, roughness: 0.4, metalness: 0.7 });
    const handleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), handleMat);
    handleMesh.position.set(-0.74, 0.88, houseD / 2 + 0.02);
    houseGroup.add(doorMesh, handleMesh);

    // Bingkai Kusen Pintu
    const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x3d2719, roughness: 0.8 });
    const doorFrameT = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.05, 0.08), doorFrameMat);
    doorFrameT.position.set(-1.125, 1.78, houseD / 2 - 0.02);
    const doorFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.80, 0.08), doorFrameMat);
    doorFrameL.position.set(-1.60, 0.90, houseD / 2 - 0.02);
    const doorFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.80, 0.08), doorFrameMat);
    doorFrameR.position.set(-0.65, 0.90, houseD / 2 - 0.02);
    houseGroup.add(doorFrameT, doorFrameL, doorFrameR);

    // Bingkai Jendela & Kaca Semi-Transparan di Lubang Jendela
    const windowFrameMat = new THREE.MeshStandardMaterial({ color: 0x3a2417, roughness: 0.75 });
    const winFrameOuter = new THREE.Mesh(new THREE.BoxGeometry(1.22, 1.07, 0.08), windowFrameMat);
    winFrameOuter.position.set(1.0, 1.175, houseD / 2 - wallThick / 2);

    const winGlassMat = new THREE.MeshStandardMaterial({
        color: 0x9bc6dc,
        transparent: true,
        opacity: 0.45,
        roughness: 0.15,
        metalness: 0.1
    });
    const winGlass = new THREE.Mesh(new THREE.BoxGeometry(1.16, 1.01, 0.04), winGlassMat);
    winGlass.position.set(1.0, 1.175, houseD / 2 - wallThick / 2);
    houseGroup.add(winFrameOuter, winGlass);

    // Papan Nama Timbul "KAMAR KOS 01" di Tengah Atas Dinding Depan
    const signMat = new THREE.MeshStandardMaterial({
        map: createSignTexture(),
        roughness: 0.6
    });
    const signMesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.44, 0.05), signMat);
    signMesh.position.set(0, 2.05, houseD / 2 + 0.02);
    houseGroup.add(signMesh);

    // Dinding belakang (-Z = -1.80) utuh dengan ventilasi tengah, kipas, dan sensor DHT11
    const backShape = new THREE.Shape();
    backShape.moveTo(-houseW / 2, 0);
    backShape.lineTo(houseW / 2, 0);
    backShape.lineTo(houseW / 2, houseH);
    backShape.lineTo(-houseW / 2, houseH);
    backShape.closePath();

    // Lubang Ventilasi Horizontal Tengah Belakang: X dari -0.45 s/d 0.45, Y dari 1.55 s/d 1.85
    const backVentHole = new THREE.Path();
    backVentHole.moveTo(-0.45, 1.55);
    backVentHole.lineTo(0.45, 1.55);
    backVentHole.lineTo(0.45, 1.85);
    backVentHole.lineTo(-0.45, 1.85);
    backVentHole.closePath();
    backShape.holes.push(backVentHole);

    // Lubang Exhaust Fan di kanan pandangan dari belakang (-X): X dari -1.55 s/d -0.75, Y dari 1.05 s/d 1.85
    const fanHole = new THREE.Path();
    fanHole.moveTo(-1.55, 1.05);
    fanHole.lineTo(-0.75, 1.05);
    fanHole.lineTo(-0.75, 1.85);
    fanHole.lineTo(-1.55, 1.85);
    fanHole.closePath();
    backShape.holes.push(fanHole);

    const backGeo = new THREE.ExtrudeGeometry(backShape, {
        depth: wallThick,
        bevelEnabled: false
    });
    const backWallMesh = new THREE.Mesh(backGeo, wallMat);
    // Extruded along Z: position at z = -houseD / 2 so rear surface is at z = -houseD / 2 (-1.80)
    backWallMesh.position.set(0, 0, -houseD / 2);
    backWallMesh.castShadow = true;
    backWallMesh.receiveShadow = true;
    houseGroup.add(backWallMesh);

    // Exhaust fan di dinding belakang (X = -1.15) dengan bilah berputar dan housing
    fanHousing = new THREE.Group();
    fanHousing.position.set(-1.15, 1.45, -houseD / 2);

    const fanCasingMat = new THREE.MeshStandardMaterial({
        color: 0x18181c,
        roughness: 0.5,
        metalness: 0.3
    });
    const fanOuterFrame = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.82, 0.16), fanCasingMat);
    fanOuterFrame.position.set(0, 0, -0.08);

    const fanTunnel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.33, 0.33, 0.17, 32, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.4, side: THREE.BackSide })
    );
    fanTunnel.rotation.x = Math.PI / 2;
    fanTunnel.position.set(0, 0, -0.08);

    // 4 Baut sudut housing
    const boltGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.025, 8);
    const boltMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.85, roughness: 0.2 });
    const b1 = new THREE.Mesh(boltGeo, boltMat); b1.rotation.x = Math.PI / 2; b1.position.set(-0.34, 0.34, -0.165);
    const b2 = new THREE.Mesh(boltGeo, boltMat); b2.rotation.x = Math.PI / 2; b2.position.set(0.34, 0.34, -0.165);
    const b3 = new THREE.Mesh(boltGeo, boltMat); b3.rotation.x = Math.PI / 2; b3.position.set(-0.34, -0.34, -0.165);
    const b4 = new THREE.Mesh(boltGeo, boltMat); b4.rotation.x = Math.PI / 2; b4.position.set(0.34, -0.34, -0.165);

    // Baling-baling Kipas (7 Bilah Abu-abu Gelap Melengkung)
    fanImpeller = new THREE.Group();
    fanImpeller.position.set(0, 0, -0.08);

    const hubMat = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4 });
    const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 24), hubMat);
    hubMesh.rotation.x = Math.PI / 2;

    const logoMat = new THREE.MeshBasicMaterial({ color: 0xd32f2f });
    const logoCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.084, 20), logoMat);
    logoCenter.rotation.x = Math.PI / 2;

    const logoInnerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const logoInner = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.086, 16), logoInnerMat);
    logoInner.rotation.x = Math.PI / 2;
    fanImpeller.add(hubMesh, logoCenter, logoInner);

    const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x2e3034,
        roughness: 0.35,
        metalness: 0.25
    });
    const numBlades = 7;
    for (let i = 0; i < numBlades; i++) {
        const bladePivot = new THREE.Group();
        bladePivot.rotation.z = (i * Math.PI * 2) / numBlades;

        const bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.20, 0.02), bladeMat);
        bladeMesh.position.set(0, 0.15, 0);
        bladeMesh.rotation.x = 0.55; // Kemiringan aerodinamis
        bladePivot.add(bladeMesh);
        fanImpeller.add(bladePivot);
    }

    const ringGuard = new THREE.Mesh(
        new THREE.TorusGeometry(0.25, 0.012, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.5 })
    );
    ringGuard.position.set(0, 0, -0.165);

    fanHousing.add(fanOuterFrame, fanTunnel, b1, b2, b3, b4, fanImpeller, ringGuard);
    houseGroup.add(fanHousing);

    // Sensor belakang (+X): DHT11 dan modul biru
    const pcbMat = new THREE.MeshStandardMaterial({ color: 0x0b5fa5, roughness: 0.5 });
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.9 });

    // Modul DHT11 (Biru-Putih berongga) pada X = +0.85
    const dhtPcb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.44, 0.03), pcbMat);
    dhtPcb.position.set(0.85, 1.50, -houseD / 2 - 0.02);

    const dhtGrid = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.30, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x72c4e8, roughness: 0.6 })
    );
    dhtGrid.position.set(0.85, 1.55, -houseD / 2 - 0.07);

    // Lakban kertas putih modul DHT11
    const dhtTape = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.01), tapeMat);
    dhtTape.position.set(0.85, 1.28, -houseD / 2 - 0.04);
    houseGroup.add(dhtPcb, dhtGrid, dhtTape);

    // Modul Sensor Biru Tambahan pada X = +1.40
    const blueModPcb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.03), pcbMat);
    blueModPcb.position.set(1.40, 1.50, -houseD / 2 - 0.02);

    const blueModPot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 })
    );
    blueModPot.rotation.x = Math.PI / 2;
    blueModPot.position.set(1.40, 1.52, -houseD / 2 - 0.05);

    const blueModTape = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.12, 0.01), tapeMat);
    blueModTape.position.set(1.40, 1.28, -houseD / 2 - 0.04);
    houseGroup.add(blueModPcb, blueModPot, blueModTape);

    // Dinding samping kiri (-X) dan kanan (+X) dengan bentuk segilima pelana
    const sideGableShape = new THREE.Shape();
    // 2D Coordinates: X represents Z (depth -1.8 s/d +1.8), Y represents Y (height 0 s/d 3.52)
    sideGableShape.moveTo(-houseD / 2, 0);
    sideGableShape.lineTo(houseD / 2, 0);
    sideGableShape.lineTo(houseD / 2, houseH);
    sideGableShape.lineTo(0, roofPeakY);
    sideGableShape.lineTo(-houseD / 2, houseH);
    sideGableShape.closePath();

    const sideGableGeo = new THREE.ExtrudeGeometry(sideGableShape, {
        depth: wallThick,
        bevelEnabled: false
    });

    // Dinding Samping Kiri (-X = -2.0)
    // Rotated around Y by -90 deg: local X maps to world Z, local Z maps to world -X
    const wallLeft = new THREE.Mesh(sideGableGeo, wallMat);
    wallLeft.rotation.y = -Math.PI / 2;
    wallLeft.position.set(-houseW / 2 + wallThick, 0, 0);
    wallLeft.castShadow = true;
    wallLeft.receiveShadow = true;
    houseGroup.add(wallLeft);

    // Modul Sensor Gas MQ-2 di Dinding Samping Kiri Atas (-X = -2.0, Y = 1.85, Z = -0.80)
    const leftSensorPcb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.38, 0.24), pcbMat);
    leftSensorPcb.position.set(-houseW / 2 - 0.02, 1.85, -0.80);
    const leftSensorTape = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.28), tapeMat);
    leftSensorTape.position.set(-houseW / 2 - 0.036, 1.66, -0.80);

    const mqCapMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b8, metalness: 0.75, roughness: 0.35 });
    const mqCap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), mqCapMat);
    mqCap.rotation.z = Math.PI / 2;
    mqCap.position.set(-houseW / 2 - 0.05, 1.88, -0.80);
    houseGroup.add(leftSensorPcb, leftSensorTape, mqCap);

    // Dinding Samping Kanan (+X = +2.0)
    const wallRight = new THREE.Mesh(sideGableGeo, wallMat);
    wallRight.rotation.y = -Math.PI / 2;
    wallRight.position.set(houseW / 2, 0, 0);
    wallRight.castShadow = true;
    wallRight.receiveShadow = true;
    houseGroup.add(wallRight);

    // Modul Sensor Samping Kanan (Sesuai foto maket sisi kanan)
    const rightSensorPcb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.38, 0.24), pcbMat);
    rightSensorPcb.position.set(houseW / 2 + 0.02, 0.65, -0.90);
    const rightSensorTape = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.28), tapeMat);
    rightSensorTape.position.set(houseW / 2 + 0.036, 0.46, -0.90);
    houseGroup.add(rightSensorPcb, rightSensorTape);

    // Kotak kontrol ESP32 di belakang rumah
    const espBoxMat = new THREE.MeshStandardMaterial({
        color: 0x785338,
        roughness: 0.8,
        metalness: 0.06
    });
    const espBox = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.85, 1.7), espBoxMat);
    espBox.position.set(0, 0.425, -2.85);
    espBox.castShadow = true;
    espBox.receiveShadow = true;
    houseGroup.add(espBox);

    // LED Indikator Status ESP32 pada Boks Kontrol
    const ledGeo = new THREE.SphereGeometry(0.05, 16, 16);
    const espLedMat = new THREE.MeshStandardMaterial({
        color: 0x2bd9a8,
        emissive: 0x2bd9a8,
        emissiveIntensity: 1.5
    });
    const espLedMesh = new THREE.Mesh(ledGeo, espLedMat);
    espLedMesh.position.set(0.9, 0.88, -2.85);
    espLedMesh.name = 'espStatusLed';
    houseGroup.add(espLedMesh);

    espLedLight = new THREE.PointLight(0x2bd9a8, 0.6, 2.0);
    espLedLight.position.set(0.9, 1.05, -2.85);
    houseGroup.add(espLedLight);

    // Interior kamar kos: tempat tidur, meja, laptop, dan lampu plafon
    interiorGroup = new THREE.Group();
    houseGroup.add(interiorGroup);

    // Kasur / Tempat Tidur Minimalis
    const bedFrame = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.28, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.8 })
    );
    bedFrame.position.set(-1.0, 0.14, -0.4);

    const mattress = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 0.2, 2.1),
        new THREE.MeshStandardMaterial({ color: 0xf5efe6, roughness: 0.9 })
    );
    mattress.position.set(-1.0, 0.32, -0.4);

    const pillow = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.1, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })
    );
    pillow.position.set(-1.0, 0.45, -1.15);

    const blanket = new THREE.Mesh(
        new THREE.BoxGeometry(1.32, 0.22, 1.3),
        new THREE.MeshStandardMaterial({ color: 0x24424d, roughness: 0.8 })
    );
    blanket.position.set(-1.0, 0.33, 0.0);

    // Meja Belajar & Laptop
    const deskTop = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 0.08, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x573b27, roughness: 0.7 })
    );
    deskTop.position.set(1.0, 0.75, -0.9);

    const deskLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), deskTop.material);
    deskLeg1.position.set(0.45, 0.375, -1.2);
    const deskLeg2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), deskTop.material);
    deskLeg2.position.set(1.55, 0.375, -1.2);
    const deskLeg3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), deskTop.material);
    deskLeg3.position.set(0.45, 0.375, -0.6);
    const deskLeg4 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), deskTop.material);
    deskLeg4.position.set(1.55, 0.375, -0.6);

    const laptopBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.02, 0.24),
        new THREE.MeshStandardMaterial({ color: 0x2a2b2f, metalness: 0.7 })
    );
    laptopBase.position.set(1.0, 0.8, -0.9);

    const laptopScreen = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.24, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x4ea8ff, emissive: 0x4ea8ff, emissiveIntensity: 0.4 })
    );
    laptopScreen.position.set(1.0, 0.92, -1.02);
    laptopScreen.rotation.x = -0.2;

    interiorGroup.add(bedFrame, mattress, pillow, blanket, deskTop, deskLeg1, deskLeg2, deskLeg3, deskLeg4, laptopBase, laptopScreen);

    // Lampu Plafon Kamar
    const lampCord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8),
        new THREE.MeshBasicMaterial({ color: 0x111111 })
    );
    lampCord.position.set(0, 2.2, 0);

    const lampBulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshStandardMaterial({
            color: 0xffd72f,
            emissive: 0xffd72f,
            emissiveIntensity: 0.2
        })
    );
    lampBulb.position.set(0, 1.98, 0);
    lampBulb.name = 'ceilingLampBulb';
    interiorGroup.add(lampCord, lampBulb);

    roomLight = new THREE.PointLight(0xffa834, 0.15, 7.5);
    roomLight.position.set(0, 1.95, 0);
    roomLight.castShadow = true;
    interiorGroup.add(roomLight);

    // Atap pelana bergelombang: ridge membentang -X ke +X, lereng ke depan (+Z) dan belakang (-Z)
    roofGroup = new THREE.Group();
    houseGroup.add(roofGroup);

    const roofTex = createRoofTexture();
    const roofMat = new THREE.MeshStandardMaterial({
        map: roofTex,
        roughness: 0.75,
        metalness: 0.05,
        side: THREE.DoubleSide
    });

    const roofOverhangX = 4.36; // Lebar membentang -X ke +X (overhang tipis)
    const roofSlopeLen = 2.30;  // Panjang bidang miring
    const roofPitch = Math.atan2(roofPeakY - houseH, houseD / 2); // ~30 derajat

    // Bidang Atap Depan (Miring turun ke arah +Z)
    const roofFront = new THREE.Mesh(new THREE.BoxGeometry(roofOverhangX, 0.06, roofSlopeLen), roofMat);
    roofFront.rotation.x = roofPitch;
    roofFront.position.set(0, (roofPeakY + houseH) / 2 - 0.02, houseD / 4 + 0.05);
    roofFront.castShadow = true;

    // Bidang Atap Belakang (Miring turun ke arah -Z)
    const roofBack = new THREE.Mesh(new THREE.BoxGeometry(roofOverhangX, 0.06, roofSlopeLen), roofMat);
    roofBack.rotation.x = -roofPitch;
    roofBack.position.set(0, (roofPeakY + houseH) / 2 - 0.02, -houseD / 4 - 0.05);
    roofBack.castShadow = true;

    // Bubungan Atap (Ridge Cap)
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x936224, roughness: 0.7 });
    const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(roofOverhangX + 0.04, 0.08, 0.22), ridgeMat);
    ridgeCap.position.set(0, roofPeakY + 0.04, 0);

    roofGroup.add(roofFront, roofBack, ridgeCap);

    // 5. Partikel & Gelombang Suara
    createParticleSystems();
}

function createParticleSystems() {
    // Partikel Udara Exhaust Fan (Mengalir ke arah -Z di belakang)
    const airMat = new THREE.MeshBasicMaterial({ color: 0x17c9b4, transparent: true, opacity: 0.6 });
    const airGeo = new THREE.SphereGeometry(0.035, 8, 8);
    for (let i = 0; i < 22; i++) {
        const p = new THREE.Mesh(airGeo, airMat.clone());
        p.position.set(
            -1.15 + (Math.random() - 0.5) * 0.35,
            1.45 + (Math.random() - 0.5) * 0.35,
            -1.95 - Math.random() * 1.8
        );
        p.userData = {
            initZ: -1.95,
            speed: 0.03 + Math.random() * 0.035,
            life: Math.random()
        };
        p.visible = false;
        houseGroup.add(p);
        fanParticles.push(p);
    }

    // Partikel Asap saat Bahaya Gas
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0xff5a36, transparent: true, opacity: 0.55 });
    const smokeGeo = new THREE.SphereGeometry(0.12, 8, 8);
    for (let i = 0; i < 26; i++) {
        const s = new THREE.Mesh(smokeGeo, smokeMat.clone());
        s.position.set(
            (Math.random() - 0.5) * 2.8,
            0.5 + Math.random() * 2.4,
            (Math.random() - 0.5) * 2.8
        );
        s.userData = {
            baseY: 0.4,
            speedY: 0.015 + Math.random() * 0.02,
            driftX: (Math.random() - 0.5) * 0.01
        };
        s.visible = false;
        houseGroup.add(s);
        smokeParticles.push(s);
    }

    // Gelombang Suara Buzzer Alarm
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff3b30,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
    });
    for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.2, 0.28, 24),
            ringMat.clone()
        );
        ring.position.set(0.9, 1.0, -2.85);
        ring.rotation.x = Math.PI / 2;
        ring.userData = { progress: i * 0.33 };
        ring.visible = false;
        houseGroup.add(ring);
        soundWaveMeshes.push(ring);
    }
}

// Definisi titik hotspot 3D dengan transform anchor dan dot interaktif
const HOTSPOT_DEFINITIONS = [
    {
        id: 'lamp',
        name: 'Lampu Kamar & Sensor Cahaya',
        pinText: '💡',
        pos: new THREE.Vector3(0, 2.05, 0),
        normal: new THREE.Vector3(0, 1, 0)
    },
    {
        id: 'left_sensor',
        name: 'Sensor Samping Kiri (MQ-2)',
        pinText: '⚠️',
        pos: new THREE.Vector3(-2.0 - 0.18, 1.85, -0.80),
        normal: new THREE.Vector3(-1, 0, 0)
    },
    {
        id: 'right_sensor',
        name: 'Sensor Samping Kanan (LDR)',
        pinText: '☀️',
        pos: new THREE.Vector3(2.0 + 0.18, 0.65, -0.90),
        normal: new THREE.Vector3(1, 0, 0)
    },
    {
        id: 'temp',
        name: 'Sensor Suhu & Kelembapan (DHT11)',
        pinText: '🌡️',
        pos: new THREE.Vector3(0.85, 1.50, -1.8 - 0.18),
        normal: new THREE.Vector3(0, 0, -1)
    },
    {
        id: 'fan',
        name: 'Exhaust Fan (GPIO 27)',
        pinText: '🌀',
        pos: new THREE.Vector3(-1.15, 1.45, -1.8 - 0.18),
        normal: new THREE.Vector3(0, 0, -1)
    },
    {
        id: 'esp',
        name: 'Boks Kontroler ESP32',
        pinText: '⚙️',
        pos: new THREE.Vector3(0.0, 0.95, -2.85),
        normal: new THREE.Vector3(0, 0.7, -0.7).normalize()
    }
];

function initHotspots() {
    hotspotObjects = [];

    HOTSPOT_DEFINITIONS.forEach(def => {
        // Lapisan 1 (Outer): Anchor untuk CSS2DObject (Three.js transform kontrol)
        const anchorEl = document.createElement('div');
        anchorEl.className = 'hotspot-anchor';

        // Lapisan 2 (Inner): Tombol interaktif (menangani klik, hover scale, warna)
        const dotEl = document.createElement('button');
        dotEl.type = 'button';
        dotEl.className = `hotspot-dot pin-${def.id}`;
        dotEl.setAttribute('aria-label', `Periksa komponen ${def.name}`);
        dotEl.title = `Klik untuk info: ${def.name}`;
        dotEl.innerHTML = `
            <span class="dot-pulse"></span>
            <span class="dot-icon">${def.pinText}</span>
        `;

        dotEl.addEventListener('click', (e) => {
            e.stopPropagation();
            inspectHotspot(def.id);
        });

        anchorEl.appendChild(dotEl);

        const cObject = new CSS2DObject(anchorEl);
        cObject.position.copy(def.pos);
        houseGroup.add(cObject);

        hotspotObjects.push({
            id: def.id,
            name: def.name,
            object: cObject,
            anchor: anchorEl,
            dot: dotEl,
            worldPos: def.pos.clone(),
            normal: def.normal.clone()
        });
    });

    // Klik di canvas menutup inspector
    renderer.domElement.addEventListener('click', () => {
        closeInspector();
    });
}

function updateHotspotsOcclusion() {
    if (!camera || hotspotObjects.length === 0) return;

    const camPos = camera.position;
    const toCam = new THREE.Vector3();

    hotspotObjects.forEach(h => {
        toCam.subVectors(camPos, h.worldPos).normalize();
        const dot = toCam.dot(h.normal);

        let isFacing = false;
        if (h.id === 'lamp') {
            isFacing = isRoofOpen ? (camPos.y > 0.5) : (camPos.z > 2.0 && camPos.y > 0.8);
        } else {
            isFacing = dot > 0.12;
        }

        if (isFacing) {
            h.anchor.style.opacity = '1';
            h.anchor.style.visibility = 'visible';
            h.dot.style.pointerEvents = 'auto';
        } else {
            h.anchor.style.opacity = '0';
            h.anchor.style.visibility = 'hidden';
            h.dot.style.pointerEvents = 'none';
        }
    });
}

export function inspectHotspot(id) {
    activeHotspotId = id;
    const card = document.getElementById('hotspot-inspector-card');
    if (!card) return;

    // Tandai titik aktif dengan ring sorotan
    hotspotObjects.forEach(h => {
        h.dot.classList.toggle('is-selected', h.id === id);
    });

    const titleEl = document.getElementById('inspector-title');
    const badgeEl = document.getElementById('inspector-badge');
    const descEl = document.getElementById('inspector-desc');
    const subEl = document.getElementById('inspector-sub');

    const suhu = Number(currentData.suhu ?? 0);
    const kelembapan = Number(currentData.kelembapan ?? 0);
    const cahaya = Number(currentData.cahaya ?? 0);
    const gas = Number(currentData.gas ?? 0);
    const ledOn = String(currentData.led ?? 'OFF').toUpperCase() === 'ON';
    const fanOn = String(currentData.kipas ?? 'OFF').toUpperCase() === 'ON';
    const online = Boolean(currentData.esp32_online);

    if (!online) {
        if (id === 'lamp') {
            titleEl.textContent = 'Lampu Kamar & Sensor Cahaya';
            badgeEl.textContent = 'Offline';
            badgeEl.className = 'inspector-badge badge-normal';
            descEl.textContent = 'Perangkat Offline — Menunggu data dari ESP32.';
            subEl.textContent = 'Sensor LDR: Standby • Pin Kontrol: GPIO 26';
        } else if (id === 'left_sensor') {
            titleEl.textContent = 'Sensor Samping Kiri (MQ-2 Gas & Asap)';
            badgeEl.textContent = 'Offline';
            badgeEl.className = 'inspector-badge badge-normal';
            descEl.textContent = 'Perangkat Offline — Menunggu data dari ESP32.';
            subEl.textContent = 'Sensor MQ-2: Standby • Ambang Bahaya ≥ 2000 ADC';
        } else if (id === 'right_sensor') {
            titleEl.textContent = 'Sensor Samping Kanan (LDR Cahaya)';
            badgeEl.textContent = 'Offline';
            badgeEl.className = 'inspector-badge badge-normal';
            descEl.textContent = 'Perangkat Offline — Menunggu data dari ESP32.';
            subEl.textContent = 'Sensor LDR: Standby • Ambang Gelap ≥ 2000 ADC';
        } else if (id === 'temp') {
            titleEl.textContent = 'Sensor Suhu & Kelembapan (DHT11)';
            badgeEl.textContent = 'Offline';
            badgeEl.className = 'inspector-badge badge-normal';
            descEl.textContent = 'Perangkat Offline — Menunggu data dari ESP32.';
            subEl.textContent = 'Modul DHT11 (GPIO 18) • Standby';
        } else if (id === 'fan') {
            titleEl.textContent = 'Exhaust Fan Ventilasi';
            badgeEl.textContent = 'Offline';
            badgeEl.className = 'inspector-badge badge-normal';
            descEl.textContent = 'Perangkat Offline — Menunggu data dari ESP32.';
            subEl.textContent = 'Relay GPIO 27 • Standby';
        } else if (id === 'esp') {
            titleEl.textContent = 'Boks Kontroler ESP32';
            badgeEl.textContent = 'ESP32 Offline';
            badgeEl.className = 'inspector-badge badge-warn';
            descEl.textContent = 'ESP32 belum terhubung fisik. Anda dapat menggunakan Mode Simulasi untuk pengujian.';
            subEl.textContent = 'Firmware MicroPython • Dual-Core Tensilica LX6';
        }
        card.classList.add('is-open');
        return;
    }

    if (id === 'lamp') {
        titleEl.textContent = 'Lampu Kamar & Sensor Cahaya';
        badgeEl.textContent = ledOn ? 'Menyala Hangat' : 'Padam (Hemat Daya)';
        badgeEl.className = `inspector-badge ${ledOn ? 'badge-warn' : 'badge-normal'}`;
        descEl.textContent = ledOn
            ? 'Lampu kamar menyala otomatis karena sensor mendeteksi intensitas cahaya rendah.'
            : 'Ruangan cukup terang. Lampu dalam kondisi padam hemat daya.';
        subEl.textContent = `Sensor LDR: ${cahaya} ADC • Pin Kontrol: GPIO 26`;
    } else if (id === 'left_sensor') {
        titleEl.textContent = 'Sensor Samping Kiri (MQ-2 Gas & Asap)';
        const isDanger = gas >= 2000;
        badgeEl.textContent = isDanger ? 'Bahaya Asap' : (gas >= 1200 ? 'Agak Pengap' : 'Udara Bersih');
        badgeEl.className = `inspector-badge ${isDanger ? 'badge-danger' : (gas >= 1200 ? 'badge-warn' : 'badge-normal')}`;
        descEl.textContent = isDanger
            ? 'Terdeteksi konsentrasi gas/asap tinggi! Alarm buzzer dan exhaust fan otomatis aktif.'
            : 'Konsentrasi gas dalam batas normal kamar kos.';
        subEl.textContent = `Sensor MQ-2: ${gas} ADC • Ambang Bahaya ≥ 2000 ADC`;
    } else if (id === 'right_sensor') {
        titleEl.textContent = 'Sensor Samping Kanan (LDR Cahaya)';
        const isDark = cahaya >= 2000;
        badgeEl.textContent = isDark ? 'Kamar Gelap' : (cahaya >= 1200 ? 'Kamar Redup' : 'Kamar Terang');
        badgeEl.className = `inspector-badge ${isDark ? 'badge-warn' : 'badge-normal'}`;
        descEl.textContent = isDark
            ? 'Pencahayaan rendah, sistem mengaktifkan lampu kamar otomatis.'
            : 'Intensitas cahaya alami mencukupi aktivitas kamar.';
        subEl.textContent = `Sensor LDR: ${cahaya} ADC • Ambang Gelap ≥ 2000 ADC`;
    } else if (id === 'temp') {
        titleEl.textContent = 'Sensor Suhu & Kelembapan (DHT11)';
        const tempState = suhu < 24 ? 'Sejuk' : (suhu <= 30 ? 'Nyaman' : 'Gerah');
        const humState = kelembapan < 45 ? 'Kering' : (kelembapan < 60 ? 'Segar' : 'Lembap');
        badgeEl.textContent = `${tempState} & ${humState}`;
        badgeEl.className = `inspector-badge ${kelembapan >= 60 ? 'badge-warn' : 'badge-normal'}`;
        descEl.textContent = `Suhu kamar ${suhu.toFixed(1)}°C dan kelembapan ${kelembapan}%. ${kelembapan >= 60 ? 'Exhaust fan aktif membantu sirkulasi udara.' : 'Kondisi udara terpantau nyaman.'}`;
        subEl.textContent = `Modul DHT11 (GPIO 18) • Ambang Kipas Kelembapan ≥ 60%`;
    } else if (id === 'fan') {
        titleEl.textContent = 'Exhaust Fan Ventilasi';
        badgeEl.textContent = fanOn ? 'Sedang Menyedot Udara' : 'Siaga (Mati)';
        badgeEl.className = `inspector-badge ${fanOn ? 'badge-active' : 'badge-normal'}`;
        descEl.textContent = fanOn
            ? 'Baling-baling kipas 7-blade berputar menyedot udara keluar untuk menjaga sirkulasi.'
            : 'Kipas dalam posisi siaga. Otomatis berputar saat kelembapan ≥ 60% atau gas ≥ 2000 ADC.';
        subEl.textContent = `Relay GPIO 27 • Proteksi Delay Pendinginan 10 Detik`;
    } else if (id === 'esp') {
        titleEl.textContent = 'Boks Kontroler ESP32';
        badgeEl.textContent = online ? 'ESP32 Terhubung' : 'Siaga Simulasi';
        badgeEl.className = `inspector-badge ${online ? 'badge-normal' : 'badge-warn'}`;
        descEl.textContent = online
            ? 'Mikrokontroler ESP32 terhubung dan mengirimkan data telemetri sensor secara berkala.'
            : 'ESP32 belum terhubung fisik. Anda dapat menggunakan Mode Simulasi untuk pengujian.';
        subEl.textContent = `Firmware MicroPython • Dual-Core Tensilica LX6`;
    }

    card.classList.add('is-open');
}

export function closeInspector() {
    activeHotspotId = null;
    hotspotObjects.forEach(h => {
        h.dot.classList.remove('is-selected');
    });
    const card = document.getElementById('hotspot-inspector-card');
    if (card) card.classList.remove('is-open');
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
    } catch (e) {
        showFallback('Terjadi kendala saat memeriksa dukungan WebGL.');
        return false;
    }

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 520;

    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0b0a);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.copy(VIEW_PRESETS.outside.cam);

    // 3. WebGL Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // 4. CSS2D Renderer for HTML Hotspot Pins (pointerEvents: none agar orbit drag tidak terblokir!)
    cssRenderer = new CSS2DRenderer();
    cssRenderer.setSize(width, height);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0';
    cssRenderer.domElement.style.left = '0';
    cssRenderer.domElement.style.width = '100%';
    cssRenderer.domElement.style.height = '100%';
    cssRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(cssRenderer.domElement);

    // OrbitControls (Putar bebas 360 derajat)
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

    // Deteksi interaksi pengguna untuk melepas kontrol otomatis
    controls.addEventListener('start', () => {
        activeCameraTween = null;
        isUserInteracting = true;
        lastAutoHighlightTime = performance.now();
    });
    controls.addEventListener('end', () => {
        isUserInteracting = false;
        lastAutoHighlightTime = performance.now();
    });

    // Pencahayaan Studio
    const ambLight = new THREE.AmbientLight(0xffeedd, 0.95);
    scene.add(ambLight);

    const dirLight1 = new THREE.DirectionalLight(0xfff7ed, 1.85);
    dirLight1.position.set(8, 12, 10);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048;
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.camera.near = 0.5;
    dirLight1.shadow.camera.far = 30;
    const d = 6.5;
    dirLight1.shadow.camera.left = -d;
    dirLight1.shadow.camera.right = d;
    dirLight1.shadow.camera.top = d;
    dirLight1.shadow.camera.bottom = -d;
    dirLight1.shadow.bias = -0.0005;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x7fb6d5, 0.9);
    dirLight2.position.set(-8, 6, -8);
    scene.add(dirLight2);

    // Bangun Model & Hotspot
    buildModel();
    initHotspots();

    // Event Listeners
    window.addEventListener('resize', onWindowResize);

    const btnCloseInspector = document.getElementById('btn-close-inspector');
    if (btnCloseInspector) {
        btnCloseInspector.addEventListener('click', closeInspector);
    }

    const btnToggleRoof = document.getElementById('btn-toggle-roof');
    if (btnToggleRoof) {
        btnToggleRoof.addEventListener('click', toggleRoof);
    }

    const btnToggleAutofocus = document.getElementById('btn-toggle-autofocus');
    if (btnToggleAutofocus) {
        btnToggleAutofocus.addEventListener('click', () => {
            toggleAutoFocus();
        });
    }

    const btnResetCam = document.getElementById('btn-reset-cam');
    if (btnResetCam) {
        btnResetCam.addEventListener('click', resetCamera);
    }

    updateAutoFocusButtonUI();
    updateRoofButtonUI();

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
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    cssRenderer.setSize(w, h);
}

export function toggleRoof() {
    isRoofOpen = !isRoofOpen;
    const duration = 350;
    const now = performance.now();
    const currentY = roofGroup ? roofGroup.position.y : 0;

    if (roofGroup) {
        roofGroup.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.transparent = true;
            }
        });
        roofGroup.visible = true;
    }

    const targetY = isRoofOpen ? 2.4 : 0.0;
    const startOp = isRoofOpen ? 1.0 : 0.0;
    const targetOp = isRoofOpen ? 0.0 : 1.0;

    roofAnim = {
        startY: currentY,
        endY: targetY,
        startOpacity: startOp,
        endOpacity: targetOp,
        startTime: now,
        duration
    };

    updateRoofButtonUI();
    return isRoofOpen;
}

export function updateRoofButtonUI() {
    const btnRoofText = document.getElementById('btn-roof-text');
    const btnRoof = document.getElementById('btn-toggle-roof');
    if (btnRoofText) {
        btnRoofText.textContent = isRoofOpen ? 'Tutup Atap' : 'Buka Atap';
    }
    if (btnRoof) {
        btnRoof.classList.toggle('is-open', isRoofOpen);
        btnRoof.title = isRoofOpen ? 'Tutup kembali atap kamar kos' : 'Buka atap untuk melihat perabot interior';
    }
}

export function toggleAutoFocus(forceState = null) {
    if (forceState !== null) {
        isAutoFocusEnabled = Boolean(forceState);
    } else {
        isAutoFocusEnabled = !isAutoFocusEnabled;
    }
    updateAutoFocusButtonUI();
    return isAutoFocusEnabled;
}

export function updateAutoFocusButtonUI() {
    const btnText = document.getElementById('btn-autofocus-text');
    const btnAuto = document.getElementById('btn-toggle-autofocus');
    if (btnText) {
        btnText.textContent = isAutoFocusEnabled ? 'Auto-Fokus: ON' : 'Auto-Fokus: OFF';
    }
    if (btnAuto) {
        btnAuto.classList.toggle('is-active', isAutoFocusEnabled);
        btnAuto.title = isAutoFocusEnabled
            ? 'Auto-Fokus Aktif: Kamera otomatis menyorot saat sensor/aktuator terpicu'
            : 'Auto-Fokus Nonaktif: Kamera tetap pada posisi pilihan Anda';
    }
}

export function resetCamera() {
    animateCameraSpherical(VIEW_PRESETS.outside.cam, VIEW_PRESETS.outside.target, 1400);
    closeInspector();
}

export function setViewMode(modeName) {
    if (!VIEW_PRESETS[modeName]) return;
    currentViewMode = modeName;
    const preset = VIEW_PRESETS[modeName];

    if (roofGroup) {
        roofGroup.visible = (modeName !== 'inside');
    }

    animateCameraSpherical(preset.cam, preset.target, 1400);
}

export function resetView() {
    resetCamera();
}

export function focusScenario(scenario) {
    if (!isAutoFocusEnabled) return;

    if (scenario === 'dark' || scenario === 'lamp') {
        if (!isRoofOpen) toggleRoof();
        animateCameraSpherical(
            new THREE.Vector3(2.2, 4.4, 3.6),
            new THREE.Vector3(0, 1.85, 0),
            1600,
            () => inspectHotspot('lamp')
        );
        showAutoHighlightBadge('Auto-Fokus: Lampu Kamar Menyala');
    } else if (scenario === 'humid' || scenario === 'fan') {
        animateCameraSpherical(
            new THREE.Vector3(-1.15, 2.2, -5.8),
            new THREE.Vector3(-1.15, 1.45, -1.8),
            1600,
            () => inspectHotspot('fan')
        );
        showAutoHighlightBadge('Auto-Fokus: Sirkulasi Kipas Aktif');
    } else if (scenario === 'gas') {
        animateCameraSpherical(
            new THREE.Vector3(-4.8, 3.2, -3.8),
            new THREE.Vector3(-1.5, 1.85, -1.2),
            1600,
            () => inspectHotspot('left_sensor')
        );
        showAutoHighlightBadge('Auto-Fokus: Deteksi Gas & Kipas Aktif');
    } else if (scenario === 'normal') {
        animateCameraSpherical(
            VIEW_PRESETS.outside.cam,
            VIEW_PRESETS.outside.target,
            1600,
            () => closeInspector()
        );
    } else if (scenario === 'anomaly') {
        animateCameraSpherical(
            new THREE.Vector3(5.5, 4.8, 6.5),
            new THREE.Vector3(0, 1.2, 0),
            1600
        );
    }
}

function checkAutoHighlight(data) {
    if (!data) return;

    const gas = Number(data.gas ?? 0);
    const ledOn = String(data.led ?? 'OFF').toUpperCase() === 'ON';
    const fanOn = String(data.kipas ?? 'OFF').toUpperCase() === 'ON';
    const buzzerOn = String(data.buzzer ?? 'OFF').toUpperCase() === 'ON';
    const gasDanger = gas >= 2000 || (buzzerOn && !data.buzzer_muted);

    if (!prevLiveState.hasBaseline) {
        prevLiveState = {
            hasBaseline: true,
            fanOn,
            ledOn,
            gasDanger
        };
        return;
    }

    const now = performance.now();
    const canTrigger = isAutoFocusEnabled && !isUserInteracting && (now - lastAutoHighlightTime > 1600);

    // Prioritas 1: Bahaya gas atau buzzer aktif
    if (gasDanger && !prevLiveState.gasDanger) {
        if (canTrigger) {
            lastAutoHighlightTime = now;
            focusScenario('gas');
        }
    }
    // Prioritas 2: Exhaust fan menyala karena kelembapan
    else if (fanOn && !prevLiveState.fanOn && !gasDanger) {
        if (canTrigger) {
            lastAutoHighlightTime = now;
            focusScenario('humid');
        }
    }
    // Prioritas 3: Lampu otomatis menyala
    else if (ledOn && !prevLiveState.ledOn) {
        if (canTrigger) {
            lastAutoHighlightTime = now;
            focusScenario('dark');
        }
    }

    prevLiveState.fanOn = fanOn;
    prevLiveState.ledOn = ledOn;
    prevLiveState.gasDanger = gasDanger;
}

function showAutoHighlightBadge(text) {
    const subEl = document.getElementById('inspector-sub');
    if (subEl) {
        subEl.innerHTML = `<span style="color:var(--turq);font-weight:700;">★ ${text}</span>`;
    }
}

export function updateData(data) {
    if (!data) return;
    currentData = Object.assign(currentData, data);

    const online = Boolean(data.esp32_online);
    const kelembapan = online ? Number(data.kelembapan ?? 0) : 0;
    const gas = online ? Number(data.gas ?? 0) : 0;
    const ledOn = online && String(data.led ?? 'OFF').toUpperCase() === 'ON';
    const fanOn = online && String(data.kipas ?? 'OFF').toUpperCase() === 'ON';

    checkAutoHighlight(data);

    // 1. Lampu Plafon Kamar
    if (roomLight) {
        roomLight.intensity = ledOn ? 2.8 : 0.12;
        roomLight.color.setHex(ledOn ? 0xffb74d : 0x334466);
    }
    const bulbMesh = scene.getObjectByName('ceilingLampBulb');
    if (bulbMesh && bulbMesh.material) {
        bulbMesh.material.emissiveIntensity = ledOn ? 1.8 : 0.1;
    }

    // 2. LED Status ESP32
    const espLed = scene.getObjectByName('espStatusLed');
    if (espLed && espLed.material && espLedLight) {
        if (online) {
            espLed.material.color.setHex(0x2bd9a8);
            espLed.material.emissive.setHex(0x2bd9a8);
            espLedLight.color.setHex(0x2bd9a8);
        } else {
            espLed.material.color.setHex(0xff4d5e);
            espLed.material.emissive.setHex(0xff4d5e);
            espLedLight.color.setHex(0xff4d5e);
        }
    }

    // 3. Pendar Lantai Kamar (Comfort Glow)
    if (floorGlowMesh && floorGlowMesh.material) {
        if (gas >= 2000) {
            floorGlowMesh.material.color.setHex(0xff4d5e);
            floorGlowMesh.material.opacity = 0.45;
        } else if (kelembapan >= 60) {
            floorGlowMesh.material.color.setHex(0x38bdf8);
            floorGlowMesh.material.opacity = 0.35;
        } else {
            floorGlowMesh.material.color.setHex(0x17c9b4);
            floorGlowMesh.material.opacity = 0.18;
        }
    }

    // 4. Perbarui warna status titik hotspot
    hotspotObjects.forEach(h => {
        if (h.id === 'lamp') {
            h.dot.classList.toggle('status-active', ledOn);
        } else if (h.id === 'fan') {
            h.dot.classList.toggle('status-active', fanOn);
        } else if (h.id === 'left_sensor') {
            h.dot.classList.toggle('status-danger', gas >= 2000);
        } else if (h.id === 'temp') {
            h.dot.classList.toggle('status-warn', kelembapan >= 60);
        }
    });

    if (activeHotspotId) {
        inspectHotspot(activeHotspotId);
    }
}

let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Kamera Tweening Cinematic Spherical Glide
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

    // Animasi Buka/Tutup Atap (~350ms)
    if (roofAnim) {
        const elapsed = now - roofAnim.startTime;
        const p = Math.min(1.0, elapsed / roofAnim.duration);
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
                }
                roofAnim = null;
            }
        }
    }

    // 2. Putaran Bilah Exhaust Fan 3D
    const isOnline = Boolean(currentData.esp32_online);
    const isFanOn = isOnline && String(currentData.kipas ?? 'OFF').toUpperCase() === 'ON';
    if (fanImpeller && isFanOn) {
        fanImpeller.rotation.z -= delta * 24.0;
    }

    // 3. Partikel Udara Exhaust Fan
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

    // 4. Partikel Asap saat Gas >= 2000
    const isGasHazard = isOnline && Number(currentData.gas ?? 0) >= 2000;
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

    // 5. Gelombang Suara Buzzer
    const isBuzzerActive = isOnline && String(currentData.buzzer ?? 'OFF').toUpperCase() === 'ON' && !currentData.buzzer_muted;
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

    // 6. Pengecekan Sudut Kamera Hotspot (Backface Culling)
    updateHotspotsOcclusion();

    // 7. Render WebGL & CSS2D
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
}

// Global API
window.Room3D = {
    init,
    updateData,
    toggleRoof,
    toggleAutoFocus,
    resetCamera,
    inspectHotspot,
    closeInspector,
    focusScenario,
    setViewMode,
    resetView
};
