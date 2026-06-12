import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS  — tweak these to dial in feel / size
// ─────────────────────────────────────────────────────────────────────────────

// Camera
const CAMERA_Y       = 4.5;    // height above horse pivot point

// Horse start transform
const MODEL_X        = 0;      // world X
const MODEL_Y        = 0;      // world Y  (set to ground level; adjust if model floats)
const MODEL_Z        = 0;      // world Z

const MODEL_ROT_X    = 0;              // rotation X (radians)
const MODEL_ROT_Y    = Math.PI;        // rotation Y — faces away from default camera
const MODEL_ROT_Z    = 0;             // rotation Z

// Scale
const HORSE_SCALE    = 3.0;    // make the horse clearly larger than the pasture grass

// Movement
const MOVE_SPEED     = 6.5;    // m/s at full walk
const TURN_SPEED     = 1.8;    // rad/s lateral turning (A/D)
const SPEED_LERP     = 0.10;   // velocity smoothing (0 = sluggish, 1 = instant)
const PASTURE_LIMIT  = 132;    // keep the horse inside the fence

// Camera orbit
const CAM_DISTANCE      = 9.5;   // follow distance behind horse
const CAM_PITCH_MIN     = 0.06;  // shallowest look angle (radians)
const CAM_PITCH_MAX     = 0.75;  // steepest look angle
const CAM_KEY_SPEED     = 1.6;   // arrow-key orbit speed (rad/s)
const CAM_MOUSE_SENS    = 0.0022;// pointer-lock mouse sensitivity
const CAM_SMOOTH        = 0.10;  // camera position lerp (lower = smoother lag)
const CAM_LOOKAT_HEIGHT = 1.6;   // look-at point height above horse base

// Pasture
const PASTURE_SIZE = 280;
const PASTURE_SEGMENTS = 120;
const GRASS_CLUSTER_COUNT = 42000;
const GRASS_HEIGHT_TO_HORSE = 0.02;
const GRASS_GEOMETRY_MAX_HEIGHT = 1.48;
const STREAM_WIDTH = 5.2;

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERER & SCENE
// ─────────────────────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec8e8);
scene.fog = new THREE.FogExp2(0xb8d8e8, 0.008);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1200);

// ─────────────────────────────────────────────────────────────────────────────
//  LIGHTING
// ─────────────────────────────────────────────────────────────────────────────

const ambient = new THREE.AmbientLight(0xfff5e0, 0.9);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffe8c0, 2.8);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near   = 0.5;
sun.shadow.camera.far    = 500;
sun.shadow.camera.left   = -100;
sun.shadow.camera.right  =  100;
sun.shadow.camera.top    =  100;
sun.shadow.camera.bottom = -100;
sun.shadow.bias = -0.0004;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xc0d8ff, 0.55);
fill.position.set(-40, 25, -30);
scene.add(fill);

// ─────────────────────────────────────────────────────────────────────────────
//  PASTURE GROUND
// ─────────────────────────────────────────────────────────────────────────────

const pastureGround = new THREE.Mesh(
  new THREE.PlaneGeometry(PASTURE_SIZE, PASTURE_SIZE, PASTURE_SEGMENTS, PASTURE_SEGMENTS),
  new THREE.MeshLambertMaterial({ color: 0x5a7a3a })
);
pastureGround.rotation.x = -Math.PI / 2;
pastureGround.receiveShadow = true;
scene.add(pastureGround);

// ─────────────────────────────────────────────────────────────────────────────
//  RUNTIME STATE
// ─────────────────────────────────────────────────────────────────────────────

const keys = {};
let horse      = null;
let mixer      = null;
let walkAction = null;
let idleAction = null;
let activeAction = null;
let horseGroundOffset = 0;
let grassClusters = null;
let grassInstanceData = [];

let horseYaw    = MODEL_ROT_Y;  // current horse facing angle (Y)
let speed       = 0;            // current velocity (m/s, negative = backward)
let isLocked    = false;

// Camera orbit state (relative to horse yaw)
let camYawOffset   = 0;         // horizontal offset from behind-horse position
let camPitch       = 0.28;      // vertical angle in radians
const smoothCamPos = new THREE.Vector3();  // lerp target

// ─────────────────────────────────────────────────────────────────────────────
//  LOADING
// ─────────────────────────────────────────────────────────────────────────────

const loader      = document.getElementById('loading');
const progressBar = document.getElementById('progress-fill');
const loadingText = document.getElementById('loading-text');
let   assetsLoaded = 0;

function setProgress(pct, msg) {
  progressBar.style.width = pct + '%';
  loadingText.textContent = msg;
}

function assetLoaded() {
  assetsLoaded++;
  if (assetsLoaded >= 2) {
    setProgress(100, 'Ready to ride!');
    setTimeout(() => loader.classList.add('hidden'), 600);
  }
}

const gltfLoader = new GLTFLoader();

function getPastureHeight(x, z) {
  const rolling = Math.sin(x * 0.035) * 0.35 + Math.cos(z * 0.028) * 0.28;
  const meadow = Math.sin((x + z) * 0.018) * 0.18;
  return MODEL_Y + rolling + meadow;
}

function getStreamCenterX(z) {
  return Math.sin(z * 0.038) * 18 + Math.sin(z * 0.085 + 1.7) * 7;
}

function distanceToStream(x, z) {
  return Math.abs(x - getStreamCenterX(z));
}

function seededRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function createGrassClusterGeometry() {
  const positions = [];
  const indices = [];
  const bladeCount = 7;

  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI * 2;
    const width = 0.11 + (i % 3) * 0.025;
    const height = 1.0 + (i % 4) * 0.16;
    const lean = 0.18 + (i % 2) * 0.08;
    const rootX = Math.cos(angle) * 0.16;
    const rootZ = Math.sin(angle) * 0.16;
    const sideX = Math.cos(angle + Math.PI / 2) * width;
    const sideZ = Math.sin(angle + Math.PI / 2) * width;
    const tipX = rootX + Math.cos(angle) * lean;
    const tipZ = rootZ + Math.sin(angle) * lean;
    const base = positions.length / 3;

    positions.push(
      rootX - sideX, 0, rootZ - sideZ,
      rootX + sideX, 0, rootZ + sideZ,
      tipX, height, tipZ
    );
    indices.push(base, base + 1, base + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function setHorseOnGround() {
  if (!horse) return;
  horse.position.y = getPastureHeight(horse.position.x, horse.position.z) + horseGroundOffset;
}

function updateHorseGroundOffset() {
  if (!horse) return;
  horse.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(horse);
  horseGroundOffset = Number.isFinite(box.min.y) ? horse.position.y - box.min.y : 0;
  setHorseOnGround();
}

function getHorseWorldHeight() {
  if (!horse) return 0;
  horse.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(horse);
  return box.getSize(new THREE.Vector3()).y;
}

function rescaleGrassToHorse() {
  if (!grassClusters || grassInstanceData.length === 0) return;

  const horseHeight = getHorseWorldHeight();
  if (!Number.isFinite(horseHeight) || horseHeight <= 0) return;

  const maxGrassBladeHeight = horseHeight * GRASS_HEIGHT_TO_HORSE;
  const maxGrassScaleY = maxGrassBladeHeight / GRASS_GEOMETRY_MAX_HEIGHT;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let i = 0; i < grassInstanceData.length; i++) {
    const blade = grassInstanceData[i];
    quaternion.setFromEuler(new THREE.Euler(0, blade.yaw, 0));

    const heightScale = maxGrassScaleY * (0.65 + blade.heightSeed * 0.35);
    const spreadScale = heightScale * (0.7 + blade.spreadSeed * 0.5);
    scale.set(spreadScale, heightScale, spreadScale);
    matrix.compose(new THREE.Vector3(blade.x, blade.y, blade.z), quaternion, scale);
    grassClusters.setMatrixAt(i, matrix);
  }

  grassClusters.instanceMatrix.needsUpdate = true;
}

function buildPasture() {
  setProgress(20, 'Growing pasture...');

  const position = pastureGround.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    position.setZ(i, getPastureHeight(x, -y));
  }
  position.needsUpdate = true;
  pastureGround.geometry.computeVertexNormals();

  const grassMaterial = pastureGround.material;
  grassMaterial.color.set(0x5e8f3e);

  const streamPoints = [];
  const streamSteps = 96;
  for (let i = 0; i <= streamSteps; i++) {
    const z = -PASTURE_LIMIT + (i / streamSteps) * (PASTURE_LIMIT * 2);
    const x = getStreamCenterX(z);
    const dx = getStreamCenterX(z + 0.5) - getStreamCenterX(z - 0.5);
    const tangent = new THREE.Vector3(dx, 0, 1).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const halfWidth = STREAM_WIDTH * (0.82 + seededRandom(i + 20) * 0.28);
    const y = getPastureHeight(x, z) + 0.045;

    streamPoints.push(
      x + normal.x * halfWidth, y, z + normal.z * halfWidth,
      x - normal.x * halfWidth, y, z - normal.z * halfWidth
    );
  }

  const streamIndices = [];
  for (let i = 0; i < streamSteps; i++) {
    const a = i * 2;
    streamIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const streamGeometry = new THREE.BufferGeometry();
  streamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(streamPoints, 3));
  streamGeometry.setIndex(streamIndices);
  streamGeometry.computeVertexNormals();

  const stream = new THREE.Mesh(
    streamGeometry,
    new THREE.MeshLambertMaterial({
      color: 0x4aa8c7,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide
    })
  );
  stream.receiveShadow = true;
  scene.add(stream);

  const grassClusterGeometry = createGrassClusterGeometry();
  const grassClusterMaterial = new THREE.MeshLambertMaterial({
    color: 0x75b843,
    side: THREE.DoubleSide
  });
  grassClusters = new THREE.InstancedMesh(grassClusterGeometry, grassClusterMaterial, GRASS_CLUSTER_COUNT);
  grassInstanceData = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let placedClusters = 0;
  let attempts = 0;

  while (placedClusters < GRASS_CLUSTER_COUNT && attempts < GRASS_CLUSTER_COUNT * 5) {
    attempts++;
    const x = (seededRandom(attempts * 3 + 1) - 0.5) * (PASTURE_LIMIT * 1.85);
    const z = (seededRandom(attempts * 3 + 2) - 0.5) * (PASTURE_LIMIT * 1.85);
    if (distanceToStream(x, z) < STREAM_WIDTH + 1.2) continue;

    const y = getPastureHeight(x, z) + 0.02;
    const yaw = seededRandom(attempts * 3 + 3) * Math.PI * 2;
    const heightSeed = seededRandom(attempts * 3 + 4);
    const spreadSeed = seededRandom(attempts * 3 + 5);
    const height = 0.004 + heightSeed * 0.004;
    const spread = 0.003 + spreadSeed * 0.003;
    quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
    scale.set(spread, height, spread);
    matrix.compose(new THREE.Vector3(x, y, z), quaternion, scale);
    grassClusters.setMatrixAt(placedClusters, matrix);
    grassInstanceData.push({ x, y, z, yaw, heightSeed, spreadSeed });
    placedClusters++;
  }

  grassClusters.count = placedClusters;
  grassClusters.instanceMatrix.needsUpdate = true;
  grassClusters.castShadow = true;
  scene.add(grassClusters);

  const fenceMaterial = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
  const postGeometry = new THREE.BoxGeometry(0.32, 2.1, 0.32);
  const railGeometry = new THREE.BoxGeometry(PASTURE_SIZE - 12, 0.22, 0.22);
  const sideRailGeometry = new THREE.BoxGeometry(0.22, 0.22, PASTURE_SIZE - 12);
  const fenceY = 1.05;
  const edge = PASTURE_LIMIT + 4;

  for (let x = -edge; x <= edge; x += 14) {
    for (const z of [-edge, edge]) {
      const post = new THREE.Mesh(postGeometry, fenceMaterial);
      post.position.set(x, getPastureHeight(x, z) + fenceY, z);
      post.castShadow = true;
      scene.add(post);
    }
  }
  for (let z = -edge; z <= edge; z += 14) {
    for (const x of [-edge, edge]) {
      const post = new THREE.Mesh(postGeometry, fenceMaterial);
      post.position.set(x, getPastureHeight(x, z) + fenceY, z);
      post.castShadow = true;
      scene.add(post);
    }
  }

  for (const z of [-edge, edge]) {
    const rail = new THREE.Mesh(railGeometry, fenceMaterial);
    rail.position.set(0, getPastureHeight(0, z) + 1.35, z);
    rail.castShadow = true;
    scene.add(rail);
  }
  for (const x of [-edge, edge]) {
    const rail = new THREE.Mesh(sideRailGeometry, fenceMaterial);
    rail.position.set(x, getPastureHeight(x, 0) + 1.35, 0);
    rail.castShadow = true;
    scene.add(rail);
  }

  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x6a3f1f });
  const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x2f6b35 });
  const blossomMaterial = new THREE.MeshLambertMaterial({ color: 0xffa6c8 });
  const blossomLightMaterial = new THREE.MeshLambertMaterial({ color: 0xffc7da });

  function addTree(x, z, blossom = false) {
    const y = getPastureHeight(x, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 5, 8), trunkMaterial);
    trunk.position.set(x, y + 2.5, z);
    trunk.castShadow = true;
    scene.add(trunk);

    const canopyMaterial = blossom ? blossomMaterial : leafMaterial;
    const canopyOffsets = blossom
      ? [[0, 0, 0], [-2.2, -0.3, 0.6], [2.0, -0.2, -0.5], [0.4, 0.9, 1.8], [-0.5, 0.7, -1.7]]
      : [[0, 0, 0], [-1.4, -0.4, 0.8], [1.5, -0.2, -0.7]];

    for (let i = 0; i < canopyOffsets.length; i++) {
      const [ox, oy, oz] = canopyOffsets[i];
      const material = blossom && i % 2 === 1 ? blossomLightMaterial : canopyMaterial;
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(blossom ? 2.8 : 3.4, 12, 8), material);
      leaves.position.set(x + ox, y + 6.0 + oy, z + oz);
      leaves.scale.set(blossom ? 1.2 : 1.15, blossom ? 0.82 : 0.9, blossom ? 1.2 : 1.15);
      leaves.castShadow = true;
      scene.add(leaves);
    }
  }

  const treeSpots = [
    [-92, -78], [-76, 64], [86, -72], [72, 86], [-118, 18], [112, 28]
  ];
  const cherrySpots = [
    [-46, -96], [42, 92], [-108, 88], [104, -42], [18, -118]
  ];

  for (const [x, z] of treeSpots) {
    addTree(x, z, false);
  }

  for (const [x, z] of cherrySpots) {
    addTree(x, z, true);
  }

  const rockMaterial = new THREE.MeshLambertMaterial({ color: 0x7d8077 });
  const rockSpots = [[-42, 38], [38, -44], [58, 48], [-68, -26]];
  for (const [x, z] of rockSpots) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), rockMaterial);
    rock.position.set(x, getPastureHeight(x, z) + 0.65, z);
    rock.scale.set(1.4, 0.65, 1.0);
    rock.rotation.set(0.3, x, 0.2);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  setHorseOnGround();
  setProgress(48, 'Pasture ready.');
  assetLoaded();
}

buildPasture();

// ── Horse ────────────────────────────────────────────────────────────────────
setProgress(50, 'Loading horse…');
gltfLoader.load(
  './horse.glb',
  (gltf) => {
    setProgress(95, 'Horse ready.');
    horse = gltf.scene;
    horse.scale.setScalar(HORSE_SCALE);
    horse.position.set(MODEL_X, MODEL_Y, MODEL_Z);
    horse.rotation.set(MODEL_ROT_X, MODEL_ROT_Y, MODEL_ROT_Z);
    horse.traverse(child => {
      if (child.isMesh) {
        child.castShadow   = true;
        child.receiveShadow = true;
      }
    });
    scene.add(horse);
    updateHorseGroundOffset();
    rescaleGrassToHorse();

    // ── Animations ─────────────────────────────────────────────────────────
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(horse);
      const clips = gltf.animations;

      console.log('[horse.glb] animations:', clips.map(c => c.name));

      // Walk: try common names, fall back to first clip
      const walkCandidates = ['Walk','walk','walk_cycle','Walk_cycle','Trot','trot','Gallop','gallop','Run','run','Action'];
      for (const name of walkCandidates) {
        const clip = THREE.AnimationClip.findByName(clips, name);
        if (clip) { walkAction = mixer.clipAction(clip); break; }
      }
      if (!walkAction) walkAction = mixer.clipAction(clips[0]);

      // Idle: try common names, fall back to second clip
      const idleCandidates = ['Idle','idle','Stand','stand','Idle_1','idle_1','Rest','rest'];
      for (const name of idleCandidates) {
        const clip = THREE.AnimationClip.findByName(clips, name);
        if (clip) { idleAction = mixer.clipAction(clip); break; }
      }
      if (!idleAction && clips.length > 1) idleAction = mixer.clipAction(clips[1]);

      // Start idle (or walk if only one clip exists)
      const startAction = idleAction ?? walkAction;
      if (startAction) {
        startAction.paused = false;
        startAction.enabled = true;
        startAction.timeScale = 1;
        startAction.play();
        activeAction = startAction;
      }
    }

    assetLoaded();
  },
  (xhr) => {
    if (xhr.total) setProgress(50 + (xhr.loaded / xhr.total) * 45, 'Loading horse…');
  },
  (err) => {
    console.warn('horse.glb not found — using placeholder geometry.', err);
    // Simple placeholder so scene is still playable
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.9, 2.0),
      new THREE.MeshLambertMaterial({ color: 0x7b3f10 })
    );
    body.position.set(MODEL_X, MODEL_Y + 1.15, MODEL_Z);
    body.rotation.y = MODEL_ROT_Y;
    body.castShadow = true;
    horse = body;
    scene.add(horse);
    updateHorseGroundOffset();
    rescaleGrassToHorse();
    assetLoaded();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
//  INPUT
// ─────────────────────────────────────────────────────────────────────────────

const PREVENT = new Set(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (PREVENT.has(e.code)) e.preventDefault();
  if (e.code === 'Space') toggleLock();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ─────────────────────────────────────────────────────────────────────────────
//  POINTER LOCK
// ─────────────────────────────────────────────────────────────────────────────

const lockOverlay = document.getElementById('lock-overlay');
const crosshair   = document.getElementById('crosshair');

function toggleLock() {
  isLocked ? document.exitPointerLock() : canvas.requestPointerLock();
}

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === canvas;
  lockOverlay.classList.toggle('hidden', isLocked);
  crosshair.classList.toggle('visible', isLocked);
});

canvas.addEventListener('click', () => {
  if (!isLocked) canvas.requestPointerLock();
});

document.addEventListener('mousemove', e => {
  if (!isLocked) return;
  camYawOffset -= e.movementX * CAM_MOUSE_SENS;
  camPitch     -= e.movementY * CAM_MOUSE_SENS;
  camPitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, camPitch));
});

// ─────────────────────────────────────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────────────────────────────────────
//  ANIMATION CROSSFADE HELPER
// ─────────────────────────────────────────────────────────────────────────────

function crossFadeTo(next, fadeSecs = 0.3) {
  if (!next || next === activeAction) return;
  if (activeAction) activeAction.fadeOut(fadeSecs);
  next.reset().fadeIn(fadeSecs).play();
  activeAction = next;
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME LOOP
// ─────────────────────────────────────────────────────────────────────────────

const clock      = new THREE.Clock();
const statePill  = document.getElementById('state-pill');
const speedPill  = document.getElementById('speed-pill');

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05); // cap delta to avoid huge jumps

  if (horse) {

    // ── Arrow keys: camera orbit only ──────────────────────────────────────
    if (keys['ArrowLeft'])  camYawOffset += CAM_KEY_SPEED * delta;
    if (keys['ArrowRight']) camYawOffset -= CAM_KEY_SPEED * delta;
    if (keys['ArrowUp'])    camPitch = Math.max(CAM_PITCH_MIN, camPitch - CAM_KEY_SPEED * 0.45 * delta);
    if (keys['ArrowDown'])  camPitch = Math.min(CAM_PITCH_MAX, camPitch + CAM_KEY_SPEED * 0.45 * delta);

    // ── WASD: horse turn + move ─────────────────────────────────────────────
    const turning = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
    const throttle = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);

    if (throttle !== 0) {
      horseYaw += turning * TURN_SPEED * delta;
    }

    const targetSpeed = -throttle * MOVE_SPEED;
    speed += (targetSpeed - speed) * SPEED_LERP;
    if (Math.abs(speed) < 0.01) speed = 0;

    // Move horse in its facing direction (Three.js default forward is -Z)
    horse.position.x -= Math.sin(horseYaw) * speed * delta;
    horse.position.z -= Math.cos(horseYaw) * speed * delta;
    horse.position.x = Math.max(-PASTURE_LIMIT, Math.min(PASTURE_LIMIT, horse.position.x));
    horse.position.z = Math.max(-PASTURE_LIMIT, Math.min(PASTURE_LIMIT, horse.position.z));
    setHorseOnGround();
    horse.rotation.y  = horseYaw;

    // ── Animations ──────────────────────────────────────────────────────────
    if (mixer) {
      const moving = Math.abs(speed) > 0.4;
      if (moving && walkAction) {
        crossFadeTo(walkAction);
        // Scale playback speed with movement so hooves match ground
        walkAction.paused = false;
        walkAction.enabled = true;
        walkAction.timeScale = Math.abs(speed) / MOVE_SPEED;
      } else if (!moving && idleAction) {
        crossFadeTo(idleAction);
        idleAction.paused = false;
        idleAction.enabled = true;
        idleAction.timeScale = 1;
      } else if (!moving && walkAction) {
        // Only a walk animation exists, so keep a very slow grazing-like motion.
        walkAction.paused = false;
        walkAction.enabled = true;
        walkAction.timeScale = 0.15;
      }
      mixer.update(delta);
    }

    // ── HUD ─────────────────────────────────────────────────────────────────
    const mph = Math.abs(Math.round(speed * 2.237));
    statePill.textContent = Math.abs(speed) > 0.4 ? 'WALKING' : 'IDLE';
    speedPill.textContent = mph + ' MPH';

    // ── Third-person camera ─────────────────────────────────────────────────
    //
    //  Camera orbits at angle: (horse facing angle) + π + camYawOffset
    //  so camYawOffset = 0 puts camera directly behind the horse.
    //
    const orbitAngle = horseYaw + Math.PI + camYawOffset;
    const cosP = Math.cos(camPitch);
    const sinP = Math.sin(camPitch);

    const targetX = horse.position.x + Math.sin(orbitAngle) * CAM_DISTANCE * cosP;
    const targetY = horse.position.y + CAMERA_Y             + sinP * CAM_DISTANCE * 0.55;
    const targetZ = horse.position.z + Math.cos(orbitAngle) * CAM_DISTANCE * cosP;

    smoothCamPos.x += (targetX - smoothCamPos.x) * CAM_SMOOTH;
    smoothCamPos.y += (targetY - smoothCamPos.y) * CAM_SMOOTH;
    smoothCamPos.z += (targetZ - smoothCamPos.z) * CAM_SMOOTH;

    // Initialise smoothCamPos on first frame to avoid a dramatic sweep-in
    if (clock.elapsedTime < 0.1) {
      smoothCamPos.set(targetX, targetY, targetZ);
    }

    camera.position.copy(smoothCamPos);
    camera.lookAt(
      horse.position.x,
      horse.position.y + CAM_LOOKAT_HEIGHT,
      horse.position.z
    );

    // Keep sun shadow frustum centred on horse
    sun.target.position.copy(horse.position);
    sun.target.updateMatrixWorld();
  }

  renderer.render(scene, camera);
}

// Initialise smooth camera position before first frame
smoothCamPos.set(
  MODEL_X + Math.sin(MODEL_ROT_Y + Math.PI) * CAM_DISTANCE,
  MODEL_Y + CAMERA_Y,
  MODEL_Z + Math.cos(MODEL_ROT_Y + Math.PI) * CAM_DISTANCE
);

animate();
