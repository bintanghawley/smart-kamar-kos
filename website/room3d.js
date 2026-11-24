import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/CSS2DRenderer.js';

let scene, camera, renderer, cssRenderer, controls;
let container;
let isInitialized = false;

let houseGroup, roofGroup, interiorGroup;
let fanImpeller, fanParticles = [], smokeParticles = [], soundWaveMeshes = [];
let roomLight, espLedLight, floorGlowMesh;
let callouts = {};

let currentViewMode = 'outside';
let targetCamPos = new THREE.Vector3(7.5, 6.2, 8.5);
let targetLookAt = new THREE.Vector3(0, 1.2, 0);
let currentLookAt = new THREE.Vector3(0, 1.2, 0);
let targetRoofY = 0;
let targetRoofOpacity = 1.0;

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
        cam: new THREE.Vector3(7.5, 6.2, 8.5),
        target: new THREE.Vector3(0, 1.2, 0),
        roofY: 0,
        roofOpacity: 1.0
    },
    inside: {
        cam: new THREE.Vector3(1.2, 8.5, 6.5),
        target: new THREE.Vector3(0, 0.8, 0),
        roofY: 3.2,
        roofOpacity: 0.08
    },
    sensors: {
        cam: new THREE.Vector3(-7.5, 4.8, -7.5),
        target: new THREE.Vector3(0, 1.4, 0),
        roofY: 0,
        roofOpacity: 1.0
    }
};

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
    tex.repeat.set(3, 3);
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

    // 1. Base / Ground Yard
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x1f4b39,
        roughness: 0.85,
        metalness: 0.05
    });
    const baseBorderMat = new THREE.MeshStandardMaterial({
        color: 0x0c83a0,
        roughness: 0.6,
        metalness: 0.1
    });

    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.25, 7.2), baseMat);
    baseMesh.position.set(0, -0.125, 0);
    baseMesh.receiveShadow = true;
    houseGroup.add(baseMesh);

    // Border lip
    const lipMat = baseBorderMat;
    const lipF = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.35, 0.12), lipMat);
    lipF.position.set(0, -0.07, 3.6);
    const lipB = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.35, 0.12), lipMat);
    lipB.position.set(0, -0.07, -3.6);
    const lipL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 7.2), lipMat);
    lipL.position.set(-3.3, -0.07, 0);
    const lipR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 7.2), lipMat);
    lipR.position.set(3.3, -0.07, 0);
    houseGroup.add(lipF, lipB, lipL, lipR);

    // 2. Main Building Walls
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0xb9382d,
        roughness: 0.72,
        metalness: 0.04
    });

    const houseW = 3.8;
    const houseH = 2.4;
    const houseD = 4.2;
    const wallThick = 0.14;

    // Floor inside house
    const floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(houseW - 0.1, houseD - 0.1),
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

    // Floor comfort glow mesh for cutaway
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

    // Side Walls (Left and Right)
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(wallThick, houseH, houseD), wallMat);
    wallL.position.set(-houseW / 2 + wallThick / 2, houseH / 2, 0);
    wallL.castShadow = true;
    wallL.receiveShadow = true;

    const wallR = new THREE.Mesh(new THREE.BoxGeometry(wallThick, houseH, houseD), wallMat);
    wallR.position.set(houseW / 2 - wallThick / 2, houseH / 2, 0);
    wallR.castShadow = true;
    wallR.receiveShadow = true;
    houseGroup.add(wallL, wallR);

    // Front Wall with Cutouts (Door, Window, Plaque)
    // Left front wall (around door)
    const wallFLeft = new THREE.Mesh(new THREE.BoxGeometry(0.3, houseH, wallThick), wallMat);
    wallFLeft.position.set(-houseW / 2 + 0.15, houseH / 2, houseD / 2 - wallThick / 2);

    // Center divider between door and window
    const wallFCenter = new THREE.Mesh(new THREE.BoxGeometry(0.5, houseH, wallThick), wallMat);
    wallFCenter.position.set(-0.25, houseH / 2, houseD / 2 - wallThick / 2);

    // Right front wall (beside window)
    const wallFRight = new THREE.Mesh(new THREE.BoxGeometry(0.5, houseH, wallThick), wallMat);
    wallFRight.position.set(houseW / 2 - 0.25, houseH / 2, houseD / 2 - wallThick / 2);

    // Top lintel / header above door & window
    const wallFTop = new THREE.Mesh(new THREE.BoxGeometry(houseW, 0.65, wallThick), wallMat);
    wallFTop.position.set(0, houseH - 0.325, houseD / 2 - wallThick / 2);

    // Sill under window
    const wallFSill = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.65, wallThick), wallMat);
    wallFSill.position.set(0.65, 0.325, houseD / 2 - wallThick / 2);

    houseGroup.add(wallFLeft, wallFCenter, wallFRight, wallFTop, wallFSill);

    // Front Door
    const doorMat = new THREE.MeshStandardMaterial({
        color: 0x8a5530,
        roughness: 0.8,
        metalness: 0.1
    });
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.7, 0.08), doorMat);
    doorMesh.position.set(-0.95, 0.85, houseD / 2 - 0.03);
    doorMesh.castShadow = true;

    // Door latch / handle
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xc89e6c, roughness: 0.5 });
    const handleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), handleMat);
    handleMesh.position.set(-0.55, 0.85, houseD / 2 + 0.03);
    houseGroup.add(doorMesh, handleMesh);

    // Window Glass
    const glassMat = new THREE.MeshStandardMaterial({
        color: 0x9bc6dc,
        transparent: true,
        opacity: 0.45,
        roughness: 0.15,
        metalness: 0.1
    });
    const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.05, 0.04), glassMat);
    windowMesh.position.set(0.65, 1.2, houseD / 2 - 0.04);

    // Window frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3d2719, roughness: 0.7 });
    const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1.09, 0.06), frameMat);
    frameMesh.position.set(0.65, 1.2, houseD / 2 - 0.05);
    houseGroup.add(frameMesh, windowMesh);

    // Front Vent Holes (above door and window)
    const ventHoleMat = new THREE.MeshBasicMaterial({ color: 0x120c0a });
    const vent1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.04), ventHoleMat);
    vent1.position.set(-1.15, 1.88, houseD / 2 + 0.01);
    const vent2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.04), ventHoleMat);
    vent2.position.set(-0.75, 1.88, houseD / 2 + 0.01);
    const vent3 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.04), ventHoleMat);
    vent3.position.set(0.65, 1.88, houseD / 2 + 0.01);
    houseGroup.add(vent1, vent2, vent3);

    // "KAMAR KOS 01" Plaque Sign
    const signMat = new THREE.MeshStandardMaterial({
        map: createSignTexture(),
        roughness: 0.6
    });
    const signMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 0.05), signMat);
    signMesh.position.set(0, 2.05, houseD / 2 + 0.05);
    houseGroup.add(signMesh);

    // Back Wall with Vent, Fan, and Sensors
    const wallB = new THREE.Mesh(new THREE.BoxGeometry(houseW, houseH, wallThick), wallMat);
    wallB.position.set(0, houseH / 2, -houseD / 2 + wallThick / 2);
    houseGroup.add(wallB);

    // Center Vent on back wall
    const backVent = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.28, 0.06), ventHoleMat);
    backVent.position.set(0, 1.6, -houseD / 2 - 0.02);
    houseGroup.add(backVent);

    // Exhaust Fan Assembly on Back Wall (Right side when viewed from back)
    const fanCasingMat = new THREE.MeshStandardMaterial({
        color: 0x1c1c1c,
        roughness: 0.6,
        metalness: 0.2
    });
    const fanCasing = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.14), fanCasingMat);
    fanCasing.position.set(1.15, 1.45, -houseD / 2 - 0.05);
    houseGroup.add(fanCasing);

    // Fan circular rim & grille
    const fanHole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.15, 24),
        new THREE.MeshBasicMaterial({ color: 0x080808 })
    );
    fanHole.rotation.x = Math.PI / 2;
    fanHole.position.set(1.15, 1.45, -houseD / 2 - 0.06);
    houseGroup.add(fanHole);

    // Fan Impeller (4 Blades)
    fanImpeller = new THREE.Group();
    fanImpeller.position.set(1.15, 1.45, -houseD / 2 - 0.1);

    const bladeMat = new THREE.MeshStandardMaterial({
        color: 0xff3b30,
        roughness: 0.4,
        metalness: 0.1
    });
    const bladeGeo = new THREE.BoxGeometry(0.12, 0.26, 0.02);
    for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.y = 0.13;
        const bladePivot = new THREE.Group();
        bladePivot.rotation.z = (i * Math.PI) / 2;
        blade.rotation.x = 0.25;
        bladePivot.add(blade);
        fanImpeller.add(bladePivot);
    }
    const fanCenterHub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 })
    );
    fanCenterHub.rotation.x = Math.PI / 2;
    fanImpeller.add(fanCenterHub);
    houseGroup.add(fanImpeller);

    // Sensor Modules on Back Wall (DHT11 & MQ-2)
    // DHT11 (Blue PCB + White-Cyan slotted grid)
    const pcbMat = new THREE.MeshStandardMaterial({ color: 0x0b5fa5, roughness: 0.5 });
    const dhtPcb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.04), pcbMat);
    dhtPcb.position.set(-1.15, 1.5, -houseD / 2 - 0.03);

    const dhtGrid = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.3, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x72c4e8, roughness: 0.6 })
    );
    dhtGrid.position.set(-1.15, 1.55, -houseD / 2 - 0.08);
    houseGroup.add(dhtPcb, dhtGrid);

    // MQ-2 Gas Sensor on Back Wall
    const mqPcb = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.48, 0.04), pcbMat);
    mqPcb.position.set(-0.6, 1.45, -houseD / 2 - 0.03);

    const mqChamber = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.14, 16),
        new THREE.MeshStandardMaterial({ color: 0xc8cbd0, metalness: 0.8, roughness: 0.3 })
    );
    mqChamber.rotation.x = Math.PI / 2;
    mqChamber.position.set(-0.6, 1.45, -houseD / 2 - 0.09);
    houseGroup.add(mqPcb, mqChamber);

    // LDR Sensor Module on Side Wall
    const ldrPcb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.28), pcbMat);
    ldrPcb.position.set(-houseW / 2 - 0.02, 1.2, 0.8);
    const ldrEye = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0xaa2211, roughness: 0.4 })
    );
    ldrEye.rotation.z = Math.PI / 2;
    ldrEye.position.set(-houseW / 2 - 0.05, 1.2, 0.8);
    houseGroup.add(ldrPcb, ldrEye);

    // ESP32 Control Box (Attached to side-back of house)
    const espBoxMat = new THREE.MeshStandardMaterial({
        color: 0x7c5535,
        roughness: 0.78,
        metalness: 0.08
    });
    const espBox = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 2.6), espBoxMat);
    espBox.position.set(2.4, 0.45, -0.6);
    espBox.castShadow = true;
    espBox.receiveShadow = true;
    houseGroup.add(espBox);

    // ESP32 Status LED Indicator on Control Box
    const ledGeo = new THREE.SphereGeometry(0.05, 16, 16);
    const espLedMat = new THREE.MeshStandardMaterial({
        color: 0x2bd9a8,
        emissive: 0x2bd9a8,
        emissiveIntensity: 1.5
    });
    const espLedMesh = new THREE.Mesh(ledGeo, espLedMat);
    espLedMesh.position.set(2.4, 0.92, -0.6);
    espLedMesh.name = 'espStatusLed';
    houseGroup.add(espLedMesh);

    espLedLight = new THREE.PointLight(0x2bd9a8, 0.6, 2.0);
    espLedLight.position.set(2.4, 1.1, -0.6);
    houseGroup.add(espLedLight);

    // 3. Interior Minimalist Kos Furniture (Visible in Cutaway Mode)
    interiorGroup = new THREE.Group();
    houseGroup.add(interiorGroup);

    // Bed
    const bedFrame = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.28, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.8 })
    );
    bedFrame.position.set(-1.0, 0.14, -0.8);

    const mattress = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 0.2, 2.1),
        new THREE.MeshStandardMaterial({ color: 0xf5efe6, roughness: 0.9 })
    );
    mattress.position.set(-1.0, 0.32, -0.8);

    const pillow = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.1, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })
    );
    pillow.position.set(-1.0, 0.45, -1.55);

    const blanket = new THREE.Mesh(
        new THREE.BoxGeometry(1.32, 0.22, 1.3),
        new THREE.MeshStandardMaterial({ color: 0x24424d, roughness: 0.8 })
    );
    blanket.position.set(-1.0, 0.33, -0.4);

    // Study Desk & Chair
    const deskTop = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 0.08, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x573b27, roughness: 0.7 })
    );
    deskTop.position.set(1.0, 0.75, -1.3);

    const deskLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), deskTop.material);
    deskLeg1.position.set(0.45, 0.375, -1.6);
    const deskLeg2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), deskTop.material);
    deskLeg2.position.set(1.55, 0.375, -1.6);
    const deskLeg3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), deskTop.material);
    deskLeg3.position.set(0.45, 0.375, -1.0);
    const deskLeg4 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), deskTop.material);
    deskLeg4.position.set(1.55, 0.375, -1.0);

    // Laptop on Desk
    const laptopBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.02, 0.24),
        new THREE.MeshStandardMaterial({ color: 0x2a2b2f, metalness: 0.7 })
    );
    laptopBase.position.set(1.0, 0.8, -1.3);

    const laptopScreen = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.24, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x4ea8ff, emissive: 0x4ea8ff, emissiveIntensity: 0.4 })
    );
    laptopScreen.position.set(1.0, 0.92, -1.42);
    laptopScreen.rotation.x = -0.2;

    interiorGroup.add(bedFrame, mattress, pillow, blanket, deskTop, deskLeg1, deskLeg2, deskLeg3, deskLeg4, laptopBase, laptopScreen);

    // Interior Ceiling Lamp
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

    // Room PointLight (Dynamic with LED GPIO 26)
    roomLight = new THREE.PointLight(0xffa834, 0.15, 7.5);
    roomLight.position.set(0, 1.95, 0);
    roomLight.castShadow = true;
    interiorGroup.add(roomLight);

    // 4. Corrugated Gable Pitch Roof (Grouped for cutaway animation)
    roofGroup = new THREE.Group();
    houseGroup.add(roofGroup);

    const roofTex = createRoofTexture();
    const roofMat = new THREE.MeshStandardMaterial({
        map: roofTex,
        roughness: 0.75,
        metalness: 0.05,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1.0
    });

    const roofPitchAngle = 0.52; // ~30 degrees
    const roofSlopeLen = 2.45;
    const roofOverhang = 4.6;

    // Left slope
    const roofSlopeL = new THREE.Mesh(new THREE.BoxGeometry(roofSlopeLen, 0.06, roofOverhang), roofMat);
    roofSlopeL.rotation.z = roofPitchAngle;
    roofSlopeL.position.set(-1.02, houseH + 0.62, 0);
    roofSlopeL.castShadow = true;

    // Right slope
    const roofSlopeR = new THREE.Mesh(new THREE.BoxGeometry(roofSlopeLen, 0.06, roofOverhang), roofMat);
    roofSlopeR.rotation.z = -roofPitchAngle;
    roofSlopeR.position.set(1.02, houseH + 0.62, 0);
    roofSlopeR.castShadow = true;

    // Ridge cap
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x936224, roughness: 0.7 });
    const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, roofOverhang + 0.04), ridgeMat);
    ridgeCap.position.set(0, houseH + 1.25, 0);

    // Triangular Gable Ends (Front and Back)
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-houseW / 2, 0);
    gableShape.lineTo(0, 1.2);
    gableShape.lineTo(houseW / 2, 0);
    gableShape.closePath();

    const gableGeo = new THREE.ShapeGeometry(gableShape);
    const gableFront = new THREE.Mesh(gableGeo, wallMat);
    gableFront.position.set(0, houseH, houseD / 2 - wallThick / 2);

    const gableBack = new THREE.Mesh(gableGeo, wallMat);
    gableBack.position.set(0, houseH, -houseD / 2 + wallThick / 2);
    gableBack.rotation.y = Math.PI;

    roofGroup.add(roofSlopeL, roofSlopeR, ridgeCap, gableFront, gableBack);

    // 5. Dynamic Particle Systems
    createParticleSystems();
}

function createParticleSystems() {
    // Airflow particles from Exhaust Fan
    const airMat = new THREE.MeshBasicMaterial({
        color: 0x17c9b4,
        transparent: true,
        opacity: 0.6
    });
    const airGeo = new THREE.SphereGeometry(0.035, 8, 8);
    for (let i = 0; i < 22; i++) {
        const p = new THREE.Mesh(airGeo, airMat.clone());
        p.position.set(
            1.15 + (Math.random() - 0.5) * 0.35,
            1.45 + (Math.random() - 0.5) * 0.35,
            -2.2 - Math.random() * 1.8
        );
        p.userData = {
            initZ: -2.2,
            speed: 0.03 + Math.random() * 0.035,
            life: Math.random()
        };
        p.visible = false;
        houseGroup.add(p);
        fanParticles.push(p);
    }

    // Smoke particles for Gas Hazard
    const smokeMat = new THREE.MeshBasicMaterial({
        color: 0xff5a36,
        transparent: true,
        opacity: 0.55
    });
    const smokeGeo = new THREE.SphereGeometry(0.12, 8, 8);
    for (let i = 0; i < 26; i++) {
        const s = new THREE.Mesh(smokeGeo, smokeMat.clone());
        s.position.set(
            (Math.random() - 0.5) * 2.8,
            0.5 + Math.random() * 2.4,
            (Math.random() - 0.5) * 3.2
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

    // Sound Wave Rings for Buzzer Alarm
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
        ring.position.set(2.4, 1.0, -0.6);
        ring.rotation.x = Math.PI / 2;
        ring.userData = { progress: i * 0.33 };
        ring.visible = false;
        houseGroup.add(ring);
        soundWaveMeshes.push(ring);
    }
}

function createCallout(id, title, position, iconType) {
    const el = document.createElement('div');
    el.className = `room-callout callout-${id}`;
    el.id = `3d-callout-${id}`;
    el.innerHTML = `
        <div class="callout-dot"></div>
        <div class="callout-box">
            <span class="callout-title">${title}</span>
            <strong class="callout-value" id="callout-val-${id}">--</strong>
            <small class="callout-sub" id="callout-sub-${id}">Menunggu data</small>
        </div>
    `;

    const cObject = new CSS2DObject(el);
    cObject.position.copy(position);
    houseGroup.add(cObject);
    callouts[id] = { object: cObject, element: el };
}

function initCallouts() {
    createCallout('lamp', 'Lampu Kamar', new THREE.Vector3(0.65, 1.35, 2.3), 'bulb');
    createCallout('temp', 'Suhu & Kelembapan', new THREE.Vector3(-1.6, 2.1, -1.8), 'temp');
    createCallout('gas', 'Sensor Gas MQ-2', new THREE.Vector3(-0.6, 2.0, -2.4), 'gas');
    createCallout('fan', 'Exhaust Fan', new THREE.Vector3(1.15, 2.2, -2.4), 'fan');
    createCallout('esp', 'ESP32 Controller', new THREE.Vector3(2.6, 1.5, -0.6), 'chip');
}

export function init(containerElement) {
    if (!containerElement) return false;
    container = containerElement;

    // Check WebGL support
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
    camera.position.copy(targetCamPos);
    currentLookAt.copy(targetLookAt);
    camera.lookAt(currentLookAt);

    // 3. WebGL Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // 4. CSS2D Renderer for HTML Callout Labels
    cssRenderer = new CSS2DRenderer();
    cssRenderer.setSize(width, height);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0';
    cssRenderer.domElement.style.left = '0';
    cssRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(cssRenderer.domElement);

    // 5. OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent flipping below ground
    controls.minDistance = 4.0;
    controls.maxDistance = 16.0;
    controls.target.copy(targetLookAt);

    // 6. Studio Lighting
    const ambLight = new THREE.AmbientLight(0xffeedd, 0.9);
    scene.add(ambLight);

    const dirLight1 = new THREE.DirectionalLight(0xfff7ed, 1.8);
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

    const dirLight2 = new THREE.DirectionalLight(0x7fb6d5, 0.85);
    dirLight2.position.set(-8, 6, -8);
    scene.add(dirLight2);

    // Build Model and Callouts
    buildModel();
    initCallouts();

    // Event Listeners
    window.addEventListener('resize', onWindowResize);

    // Start Render Loop
    isInitialized = true;
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

export function setViewMode(modeName) {
    if (!VIEW_PRESETS[modeName]) return;
    currentViewMode = modeName;
    const preset = VIEW_PRESETS[modeName];
    targetCamPos.copy(preset.cam);
    targetLookAt.copy(preset.target);
    targetRoofY = preset.roofY;
    targetRoofOpacity = preset.roofOpacity;

    // Adjust callouts visibility in inside mode to keep interior clean
    const isInside = modeName === 'inside';
    Object.keys(callouts).forEach(k => {
        const item = callouts[k];
        if (item && item.element) {
            item.element.classList.toggle('callout-dimmed', isInside && (k === 'fan' || k === 'esp'));
        }
    });
}

export function resetView() {
    setViewMode('outside');
}

export function updateData(data) {
    if (!data) return;
    currentData = Object.assign(currentData, data);

    const suhu = Number(data.suhu ?? 0);
    const kelembapan = Number(data.kelembapan ?? 0);
    const cahaya = Number(data.cahaya ?? 0);
    const gas = Number(data.gas ?? 0);
    const ledOn = String(data.led ?? 'OFF').toUpperCase() === 'ON';
    const fanOn = String(data.kipas ?? 'OFF').toUpperCase() === 'ON';
    const buzzerOn = String(data.buzzer ?? 'OFF').toUpperCase() === 'ON';
    const buzzerMuted = Boolean(data.buzzer_muted || String(data.buzzer ?? '').toUpperCase() === 'MUTED');
    const online = Boolean(data.esp32_online);

    // 1. Update Interior Ceiling Lamp
    if (roomLight) {
        roomLight.intensity = ledOn ? 2.8 : 0.12;
        roomLight.color.setHex(ledOn ? 0xffb74d : 0x334466);
    }
    const bulbMesh = scene.getObjectByName('ceilingLampBulb');
    if (bulbMesh && bulbMesh.material) {
        bulbMesh.material.emissiveIntensity = ledOn ? 1.8 : 0.1;
    }

    // 2. Update ESP32 Status LED
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

    // 3. Update Floor Glow Comfort Color
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

    // 4. Update Callouts Content
    const elLampVal = document.getElementById('callout-val-lamp');
    const elLampSub = document.getElementById('callout-sub-lamp');
    if (elLampVal && elLampSub) {
        elLampVal.textContent = ledOn ? 'Menyala Hangat' : 'Padam (Hemat Daya)';
        elLampSub.textContent = `LDR: ${cahaya} ADC (${cahaya >= 2000 ? 'Kamar Gelap' : 'Kamar Terang'})`;
        const cBox = document.getElementById('3d-callout-lamp');
        if (cBox) cBox.classList.toggle('is-active', ledOn);
    }

    const elTempVal = document.getElementById('callout-val-temp');
    const elTempSub = document.getElementById('callout-sub-temp');
    if (elTempVal && elTempSub) {
        const tempDesc = suhu < 24 ? 'Sejuk' : (suhu <= 30 ? 'Nyaman' : 'Terasa Gerah');
        const humDesc = kelembapan < 45 ? 'Udara Kering' : (kelembapan < 60 ? 'Segar' : 'Lembap');
        elTempVal.textContent = `${suhu.toFixed(1)}°C · ${tempDesc}`;
        elTempSub.textContent = `Kelembapan ${kelembapan.toFixed(0)}% (${humDesc})`;
    }

    const elGasVal = document.getElementById('callout-val-gas');
    const elGasSub = document.getElementById('callout-sub-gas');
    if (elGasVal && elGasSub) {
        const isHazard = gas >= 2000;
        elGasVal.textContent = isHazard ? 'Waspada! Asap Terdeteksi' : (gas >= 1200 ? 'Mulai Pengap' : 'Udara Bersih & Aman');
        elGasSub.textContent = `Sensor MQ-2: ${gas} ADC`;
        const cGas = document.getElementById('3d-callout-gas');
        if (cGas) cGas.classList.toggle('is-danger', isHazard);
    }

    const elFanVal = document.getElementById('callout-val-fan');
    const elFanSub = document.getElementById('callout-sub-fan');
    if (elFanVal && elFanSub) {
        elFanVal.textContent = fanOn ? 'Sedang Menyedot Udara' : 'Siaga (Mati)';
        elFanSub.textContent = fanOn ? 'Relay GPIO27 Aktif' : 'Menunggu pemicu udara';
        const cFan = document.getElementById('3d-callout-fan');
        if (cFan) cFan.classList.toggle('is-active', fanOn);
    }

    const elEspVal = document.getElementById('callout-val-esp');
    const elEspSub = document.getElementById('callout-sub-esp');
    if (elEspVal && elEspSub) {
        elEspVal.textContent = online ? 'ESP32 Terhubung' : 'ESP32 Belum Terhubung';
        elEspSub.textContent = online ? 'MicroPython Live' : 'Mode Simulasi Tersedia';
        const cEsp = document.getElementById('3d-callout-esp');
        if (cEsp) {
            cEsp.classList.toggle('is-online', online);
            cEsp.classList.toggle('is-offline', !online);
        }
    }
}

let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // 1. Smooth Camera Lerping
    camera.position.lerp(targetCamPos, 0.05);
    currentLookAt.lerp(targetLookAt, 0.05);
    controls.target.copy(currentLookAt);
    controls.update();

    // 2. Smooth Roof Lifting for Cutaway Mode
    if (roofGroup) {
        roofGroup.position.y += (targetRoofY - roofGroup.position.y) * 0.07;
        roofGroup.traverse(child => {
            if (child.isMesh && child.material) {
                if (child.material.transparent) {
                    child.material.opacity += (targetRoofOpacity - child.material.opacity) * 0.07;
                }
            }
        });
    }

    // 3. Exhaust Fan Rotation
    const isFanOn = String(currentData.kipas ?? 'OFF').toUpperCase() === 'ON';
    if (fanImpeller && isFanOn) {
        fanImpeller.rotation.z -= delta * 18.0; // Spin smoothly
    }

    // 4. Fan Airflow Particles
    for (let i = 0; i < fanParticles.length; i++) {
        const p = fanParticles[i];
        p.visible = isFanOn;
        if (isFanOn) {
            p.position.z -= p.userData.speed;
            p.userData.life += delta;
            p.material.opacity = Math.max(0, 0.6 - (p.userData.life % 1.5) * 0.4);
            if (p.position.z < -4.2) {
                p.position.z = p.userData.initZ;
                p.userData.life = 0;
            }
        }
    }

    // 5. Smoke Particles (Gas >= 2000)
    const isGasHazard = Number(currentData.gas ?? 0) >= 2000;
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

    // 6. Sound Wave Pulse (Buzzer ON & NOT MUTED)
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

    // 7. Render 3D and CSS2D Layers
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
}

// Global hook for script.js
window.Room3D = {
    init,
    updateData,
    setViewMode,
    resetView
};
