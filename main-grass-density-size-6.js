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
const HORSE_SCALE    = 1.47;   // 30% smaller than the previous 2.1 scale

// Movement
const MOVE_SPEED     = 6.5;    // m/s at full walk
const GALLOP_SPEED   = 12.5;   // apple-powered burst speed
const GALLOP_COST    = 5;
const GALLOP_SECONDS = 5;
const TURN_SPEED     = 1.8;    // rad/s lateral turning (A/D)
const SPEED_LERP     = 0.10;   // velocity smoothing (0 = sluggish, 1 = instant)
const PASTURE_RADIUS_X = 92;    // irregular oval rideable boundary, east/west
const PASTURE_RADIUS_Z = 76;    // irregular oval rideable boundary, north/south
const PASTURE_MARGIN   = 8;     // keeps the horse off the tree line

// Camera orbit
const CAM_DISTANCE      = 9.5;   // follow distance behind horse
const CAM_PITCH_MIN     = 0.06;  // shallowest look angle (radians)
const CAM_PITCH_MAX     = 0.75;  // steepest look angle
const CAM_KEY_SPEED     = 1.6;   // arrow-key orbit speed (rad/s)
const CAM_MOUSE_SENS    = 0.0022;// pointer-lock mouse sensitivity
const CAM_SMOOTH        = 0.10;  // camera position lerp (lower = smoother lag)
const CAM_LOOKAT_HEIGHT = 1.6;   // look-at point height above horse base

// Pasture
const PASTURE_SIZE = 220;
const PASTURE_SEGMENTS = 90;
const GRASS_CLUSTER_COUNT = 120000;
const SINGLE_GRASS_COUNT = 180000;
const GRASS_MIN_HEIGHT = 0.34;
const GRASS_MAX_HEIGHT = 0.52;
const GRASS_GEOMETRY_MAX_HEIGHT = 1.48;
const SINGLE_GRASS_GEOMETRY_MAX_HEIGHT = 1.0;
const STREAM_WIDTH = 5.2;
const PERIMETER_TREE_COUNT = 32;
const PERIMETER_RAIL_COUNT = 48;
const GRASS_COLOR_PALETTE = [0x4f9900, 0x82c23a, 0xa5c940, 0xd7e356];
const APPLE_COLLECT_RADIUS = 6.5;
const ORCHARD_ROW_COUNT = 4;
const ORCHARD_TREES_PER_ROW = 5;
const TREE_MODEL_PATHS = ['./tree.glb', './tree2.glb', './tree3.glb'];
const BUNNY_MODEL_PATH = './animated_rabbit__3d_animal_model.glb';
const SKYBOX_MODEL_PATH = './free_-_skybox_in_the_cloud.glb';

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERER & SCENE
// ─────────────────────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec8e8);
scene.fog = new THREE.FogExp2(0xb8d8e8, 0.016);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1200);

// ─────────────────────────────────────────────────────────────────────────────
//  LIGHTING
// ─────────────────────────────────────────────────────────────────────────────

const ambient = new THREE.AmbientLight(0xfff5e0, 1.35);
scene.add(ambient);

const hemi = new THREE.HemisphereLight(0xcfeeff, 0x6f8a48, 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffe8c0, 0.55);
sun.position.set(60, 90, 40);
sun.castShadow = false;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near   = 0.5;
sun.shadow.camera.far    = 500;
sun.shadow.camera.left   = -100;
sun.shadow.camera.right  =  100;
sun.shadow.camera.top    =  100;
sun.shadow.camera.bottom = -100;
sun.shadow.bias = -0.0004;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xc0d8ff, 0.18);
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
let appleItems = [];
let appleScore = 0;
let treeTemplates = [];
let bunny = null;
let bunnyMixer = null;
let bunnyMoveAction = null;
let bunnyIdleAction = null;
let bunnyActiveAction = null;
let bunnyTarget = new THREE.Vector3(18, 0, 18);
let bunnyPauseUntil = 0;
let bunnyGroundOffset = 0;
let skyboxModel = null;
let skyboxOffset = new THREE.Vector3();

let horseYaw    = MODEL_ROT_Y;  // current horse facing angle (Y)
let speed       = 0;            // current velocity (m/s, negative = backward)
let isLocked    = false;
let gallopUntil = 0;

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

function loadSkybox() {
  gltfLoader.load(
    SKYBOX_MODEL_PATH,
    (gltf) => {
      skyboxModel = gltf.scene;
      skyboxModel.traverse(child => {
        if (!child.isMesh) return;

        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        child.renderOrder = -1000;
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            material.side = THREE.DoubleSide;
            material.depthTest = false;
            material.depthWrite = false;
            material.fog = false;
          }
        }
      });

      skyboxModel.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(skyboxModel);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxAxis = Math.max(size.x, size.y, size.z, 1);
      const scale = 950 / maxAxis;
      skyboxModel.scale.setScalar(scale);
      skyboxOffset.copy(center).multiplyScalar(-scale);
      skyboxModel.position.copy(skyboxOffset);
      skyboxModel.frustumCulled = false;
      scene.add(skyboxModel);
    },
    undefined,
    (err) => console.warn('Skybox model failed to load.', err)
  );
}

loadSkybox();

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

function getGrassColor(seedA, seedB, x, z) {
  const wave = Math.sin(x * 0.045) * 0.24 + Math.cos(z * 0.038) * 0.2;
  const noise = (seedA - 0.5) * 0.22 + (seedB - 0.5) * 0.12;
  const t = Math.max(0, Math.min(0.999, 0.5 + wave + noise));
  const scaled = t * (GRASS_COLOR_PALETTE.length - 1);
  const index = Math.floor(scaled);
  const blend = scaled - index;
  const color = new THREE.Color(GRASS_COLOR_PALETTE[index]);
  return color.lerp(new THREE.Color(GRASS_COLOR_PALETTE[index + 1]), blend);
}

function getBoundaryScale(angle) {
  return 1
    + Math.sin(angle * 3.0 + 0.45) * 0.055
    + Math.sin(angle * 5.0 - 1.1) * 0.035
    + Math.cos(angle * 7.0 + 0.8) * 0.025;
}

function getPastureBoundaryPoint(angle, inset = 0) {
  const scale = getBoundaryScale(angle);
  const radiusX = Math.max(1, PASTURE_RADIUS_X * scale - inset);
  const radiusZ = Math.max(1, PASTURE_RADIUS_Z * scale - inset);
  return new THREE.Vector3(
    Math.cos(angle) * radiusX,
    0,
    Math.sin(angle) * radiusZ
  );
}

function getPastureBoundaryRatio(x, z, inset = 0) {
  const angle = Math.atan2(z / PASTURE_RADIUS_Z, x / PASTURE_RADIUS_X);
  const scale = getBoundaryScale(angle);
  const radiusX = Math.max(1, PASTURE_RADIUS_X * scale - inset);
  const radiusZ = Math.max(1, PASTURE_RADIUS_Z * scale - inset);
  return Math.sqrt((x * x) / (radiusX * radiusX) + (z * z) / (radiusZ * radiusZ));
}

function isInsidePasture(x, z, inset = 0) {
  return getPastureBoundaryRatio(x, z, inset) <= 1;
}

function clampToPasture(point, inset = PASTURE_MARGIN) {
  const ratio = getPastureBoundaryRatio(point.x, point.z, inset);
  if (ratio <= 1) return point;

  point.x /= ratio;
  point.z /= ratio;
  return point;
}

function createGrassClusterGeometry() {
  const positions = [];
  const indices = [];
  const colors = [];
  const bladeCount = 11;

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
    colors.push(1, 1, 1, 1, 1, 1, 1, 1, 1);
    indices.push(base, base + 1, base + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSingleGrassGeometry() {
  const positions = [
    -0.035, 0, 0,
     0.035, 0, 0,
     0.0, 1.0, 0.045
  ];
  const colors = [
    1, 1, 1,
    1, 1, 1,
    1, 1, 1
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex([0, 1, 2]);
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

function applyGrassSizeVariation() {
  if (!grassClusters || grassInstanceData.length === 0) return;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let i = 0; i < grassInstanceData.length; i++) {
    const blade = grassInstanceData[i];
    quaternion.setFromEuler(new THREE.Euler(0, blade.yaw, 0));

    const targetHeight = GRASS_MIN_HEIGHT + blade.heightSeed * (GRASS_MAX_HEIGHT - GRASS_MIN_HEIGHT);
    const heightScale = targetHeight / GRASS_GEOMETRY_MAX_HEIGHT;
    const spreadScale = heightScale * (0.62 + blade.spreadSeed * 0.52);
    scale.set(spreadScale, heightScale, spreadScale);
    matrix.compose(new THREE.Vector3(blade.x, blade.y, blade.z), quaternion, scale);
    grassClusters.setMatrixAt(i, matrix);
  }

  grassClusters.instanceMatrix.needsUpdate = true;
}

function buildPasture() {
  setProgress(20, 'Growing pasture...');

  const position = pastureGround.geometry.attributes.position;
  const boundaryProjector = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = -position.getY(i);
    boundaryProjector.set(x, 0, z);
    clampToPasture(boundaryProjector, 0);
    position.setX(i, boundaryProjector.x);
    position.setY(i, -boundaryProjector.z);
    position.setZ(i, getPastureHeight(boundaryProjector.x, boundaryProjector.z));
  }
  position.needsUpdate = true;
  pastureGround.geometry.computeVertexNormals();

  const grassMaterial = pastureGround.material;
  grassMaterial.color.set(0x5e8f3e);

  const streamPoints = [];
  const streamSteps = 96;
  for (let i = 0; i <= streamSteps; i++) {
    const z = -PASTURE_RADIUS_Z + (i / streamSteps) * (PASTURE_RADIUS_Z * 2);
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
  const grassClusterMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    toneMapped: false,
    side: THREE.DoubleSide
  });
  grassClusters = new THREE.InstancedMesh(grassClusterGeometry, grassClusterMaterial, GRASS_CLUSTER_COUNT);
  grassInstanceData = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const instanceColor = new THREE.Color();
  let placedClusters = 0;
  let attempts = 0;

  while (placedClusters < GRASS_CLUSTER_COUNT && attempts < GRASS_CLUSTER_COUNT * 5) {
    attempts++;
    const x = (seededRandom(attempts * 3 + 1) - 0.5) * (PASTURE_RADIUS_X * 2.05);
    const z = (seededRandom(attempts * 3 + 2) - 0.5) * (PASTURE_RADIUS_Z * 2.05);
    if (!isInsidePasture(x, z, PASTURE_MARGIN + 2)) continue;
    if (distanceToStream(x, z) < STREAM_WIDTH + 1.2) continue;

    const y = getPastureHeight(x, z) + 0.02;
    const yaw = seededRandom(attempts * 3 + 3) * Math.PI * 2;
    const heightSeed = seededRandom(attempts * 3 + 4);
    const spreadSeed = seededRandom(attempts * 3 + 5);
    const colorSeed = seededRandom(attempts * 3 + 6);
    const targetHeight = GRASS_MIN_HEIGHT + heightSeed * (GRASS_MAX_HEIGHT - GRASS_MIN_HEIGHT);
    const height = targetHeight / GRASS_GEOMETRY_MAX_HEIGHT;
    const spread = height * (0.62 + spreadSeed * 0.52);
    quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
    scale.set(spread, height, spread);
    matrix.compose(new THREE.Vector3(x, y, z), quaternion, scale);
    grassClusters.setMatrixAt(placedClusters, matrix);
    grassClusters.setColorAt(placedClusters, instanceColor.copy(getGrassColor(colorSeed, spreadSeed, x, z)));
    grassInstanceData.push({ x, y, z, yaw, heightSeed, spreadSeed });
    placedClusters++;
  }

  grassClusters.count = placedClusters;
  grassClusters.instanceMatrix.needsUpdate = true;
  grassClusters.instanceColor.needsUpdate = true;
  grassClusters.castShadow = false;
  grassClusters.receiveShadow = false;
  scene.add(grassClusters);

  const singleGrassGeometry = createSingleGrassGeometry();
  const singleGrassMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    toneMapped: false,
    side: THREE.DoubleSide
  });
  const singleGrass = new THREE.InstancedMesh(singleGrassGeometry, singleGrassMaterial, SINGLE_GRASS_COUNT);
  let placedSingles = 0;
  let singleAttempts = 0;

  while (placedSingles < SINGLE_GRASS_COUNT && singleAttempts < SINGLE_GRASS_COUNT * 6) {
    singleAttempts++;
    const x = (seededRandom(singleAttempts * 5 + 11) - 0.5) * (PASTURE_RADIUS_X * 2.0);
    const z = (seededRandom(singleAttempts * 5 + 12) - 0.5) * (PASTURE_RADIUS_Z * 2.0);
    if (!isInsidePasture(x, z, PASTURE_MARGIN + 1)) continue;
    if (distanceToStream(x, z) < STREAM_WIDTH + 0.9) continue;

    const y = getPastureHeight(x, z) + 0.028;
    const yaw = seededRandom(singleAttempts * 5 + 13) * Math.PI * 2;
    const heightSeed = seededRandom(singleAttempts * 5 + 14);
    const widthSeed = seededRandom(singleAttempts * 5 + 15);
    const colorSeed = seededRandom(singleAttempts * 5 + 16);
    const height = (0.22 + heightSeed * 0.36) / SINGLE_GRASS_GEOMETRY_MAX_HEIGHT;
    const width = 0.65 + widthSeed * 0.7;

    quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
    scale.set(width, height, width);
    matrix.compose(new THREE.Vector3(x, y, z), quaternion, scale);
    singleGrass.setMatrixAt(placedSingles, matrix);
    singleGrass.setColorAt(placedSingles, instanceColor.copy(getGrassColor(colorSeed, widthSeed, x, z)));
    placedSingles++;
  }

  singleGrass.count = placedSingles;
  singleGrass.instanceMatrix.needsUpdate = true;
  if (singleGrass.instanceColor) singleGrass.instanceColor.needsUpdate = true;
  singleGrass.castShadow = false;
  singleGrass.receiveShadow = false;
  scene.add(singleGrass);

  const appleRedMaterial = new THREE.MeshLambertMaterial({ color: 0xb62218 });
  const appleGreenMaterial = new THREE.MeshLambertMaterial({ color: 0x92ad33 });
  const appleStemMaterial = new THREE.MeshLambertMaterial({ color: 0x4b2c17 });
  const appleGeometry = new THREE.SphereGeometry(0.32, 14, 10);
  const appleStemGeometry = new THREE.CylinderGeometry(0.025, 0.035, 0.24, 5);

  function addApple(x, y, z, colorSeed) {
    const group = new THREE.Group();
    const apple = new THREE.Mesh(appleGeometry, colorSeed > 0.23 ? appleRedMaterial : appleGreenMaterial);
    const stem = new THREE.Mesh(appleStemGeometry, appleStemMaterial);
    stem.position.y = 0.3;
    stem.rotation.z = 0.25;
    apple.castShadow = true;
    stem.castShadow = true;
    group.add(apple, stem);
    group.position.set(x, y, z);
    group.userData.baseY = y;
    group.userData.spin = 0.7 + colorSeed * 0.8;
    scene.add(group);
    appleItems.push({ group, collected: false });
    return group;
  }

  function addModelAppleTree(x, z, seed = 1, targetHeight = 11) {
    if (treeTemplates.length === 0) {
      return;
    }

    const y = getPastureHeight(x, z);
    const templateIndex = Math.floor(seededRandom(seed + 5) * treeTemplates.length) % treeTemplates.length;
    const tree = treeTemplates[templateIndex].clone(true);
    tree.rotation.y = seededRandom(seed + 70) * Math.PI * 2;
    tree.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    tree.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(tree);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const sourceHeight = Math.max(1, sourceSize.y);
    const modelScale = targetHeight / sourceHeight;
    tree.scale.setScalar(modelScale);
    tree.updateMatrixWorld(true);

    const scaledBox = new THREE.Box3().setFromObject(tree);
    const center = scaledBox.getCenter(new THREE.Vector3());
    tree.position.set(x - center.x, y - scaledBox.min.y, z - center.z);
    tree.userData.isOrchardTree = true;
    scene.add(tree);

    const appleCount = 12;
    for (let i = 0; i < appleCount; i++) {
      const angle = seededRandom(seed + i * 19) * Math.PI * 2;
      const radius = (1.4 + seededRandom(seed + i * 23) * 3.4) * (targetHeight / 11);
      const height = y + targetHeight * (0.45 + seededRandom(seed + i * 29) * 0.36);
      addApple(
        x + Math.cos(angle) * radius,
        height,
        z + Math.sin(angle) * radius,
        seededRandom(seed + i * 31)
      );
    }
  }

  const fenceMaterial = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
  const postGeometry = new THREE.CylinderGeometry(0.18, 0.24, 1.7, 7);
  const railGeometry = new THREE.BoxGeometry(1, 0.16, 0.18);

  for (let i = 0; i < PERIMETER_RAIL_COUNT; i++) {
    const angleA = (i / PERIMETER_RAIL_COUNT) * Math.PI * 2;
    const angleB = ((i + 1) / PERIMETER_RAIL_COUNT) * Math.PI * 2;
    const a = getPastureBoundaryPoint(angleA, 1.6);
    const b = getPastureBoundaryPoint(angleB, 1.6);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const span = a.distanceTo(b) * 0.92;
    const heading = Math.atan2(b.z - a.z, b.x - a.x);
    const groundY = getPastureHeight(mid.x, mid.z);

    const post = new THREE.Mesh(postGeometry, fenceMaterial);
    post.position.set(a.x, getPastureHeight(a.x, a.z) + 0.85, a.z);
    post.castShadow = true;
    scene.add(post);

    const rail = new THREE.Mesh(railGeometry, fenceMaterial);
    rail.position.set(mid.x, groundY + 1.18, mid.z);
    rail.scale.set(span, 1, 1);
    rail.rotation.y = -heading;
    rail.castShadow = true;
    scene.add(rail);
  }

  for (let i = 0; i < PERIMETER_TREE_COUNT; i++) {
    const angle = (i / PERIMETER_TREE_COUNT) * Math.PI * 2 + seededRandom(i + 80) * 0.032;
    const inset = 7 + seededRandom(i + 90) * 8;
    const point = getPastureBoundaryPoint(angle, inset);
    const height = 8.8 + seededRandom(i + 100) * 3.2;
    addModelAppleTree(point.x, point.z, i + 1000, height);
  }

  for (let row = 0; row < ORCHARD_ROW_COUNT; row++) {
    const z = (row - (ORCHARD_ROW_COUNT - 1) * 0.5) * 19;
    const rowOffset = row % 2 === 0 ? -8 : 8;
    for (let col = 0; col < ORCHARD_TREES_PER_ROW; col++) {
      const seed = 2000 + row * 50 + col * 7;
      const x = (col - (ORCHARD_TREES_PER_ROW - 1) * 0.5) * 21 + rowOffset;
      const jitterX = (seededRandom(seed) - 0.5) * 7;
      const jitterZ = (seededRandom(seed + 1) - 0.5) * 8;
      const treeX = x + jitterX;
      const treeZ = z + jitterZ;
      if (!isInsidePasture(treeX, treeZ, 24)) continue;
      if (distanceToStream(treeX, treeZ) < STREAM_WIDTH + 8) continue;
      addModelAppleTree(treeX, treeZ, seed, 9.8 + seededRandom(seed + 2) * 2.4);
    }
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

function loadGLTF(path) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(path, resolve, undefined, reject);
  });
}

function prepareTemplate(template) {
  template.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return template;
}

function loadTreeAssetsAndBuildPasture() {
  setProgress(12, 'Loading orchard trees...');
  Promise.all(TREE_MODEL_PATHS.map(path => loadGLTF(path)))
    .then(gltfs => {
      treeTemplates = gltfs.map(gltf => prepareTemplate(gltf.scene));
      buildPasture();
      loadBunny();
    })
    .catch(err => {
      console.warn('Orchard tree models failed to load.', err);
      treeTemplates = [];
      buildPasture();
      loadBunny();
    });
}

loadTreeAssetsAndBuildPasture();

function chooseBunnyAction(clips, names) {
  for (const name of names) {
    const clip = THREE.AnimationClip.findByName(clips, name);
    if (clip) return bunnyMixer.clipAction(clip);
  }
  const lowerNames = names.map(name => name.toLowerCase());
  const fuzzy = clips.find(clip => lowerNames.some(name => clip.name.toLowerCase().includes(name)));
  return fuzzy ? bunnyMixer.clipAction(fuzzy) : null;
}

function placeBunnyModel(model) {
  const start = new THREE.Vector3(18, 0, 18);
  clampToPasture(start, 28);
  start.y = getPastureHeight(start.x, start.z);

  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = 1.05 / Math.max(0.1, size.y);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = scaledBox.getCenter(new THREE.Vector3());
  model.position.set(start.x - center.x, start.y - scaledBox.min.y, start.z - center.z);
  bunnyGroundOffset = model.position.y - start.y;
  model.rotation.y = Math.PI * 0.25;
}

function loadBunny() {
  gltfLoader.load(
    BUNNY_MODEL_PATH,
    (gltf) => {
      bunny = gltf.scene;
      bunny.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      placeBunnyModel(bunny);
      scene.add(bunny);

      if (gltf.animations && gltf.animations.length > 0) {
        bunnyMixer = new THREE.AnimationMixer(bunny);
        bunnyMoveAction = chooseBunnyAction(gltf.animations, ['hop', 'jump', 'walk', 'run', 'move']);
        bunnyIdleAction = chooseBunnyAction(gltf.animations, ['idle', 'sit', 'rest', 'look']);
        if (!bunnyMoveAction) bunnyMoveAction = bunnyMixer.clipAction(gltf.animations[0]);
        if (!bunnyIdleAction && gltf.animations.length > 1) bunnyIdleAction = bunnyMixer.clipAction(gltf.animations[1]);
        bunnyActiveAction = bunnyIdleAction || bunnyMoveAction;
        bunnyActiveAction?.reset().play();
      }
    },
    undefined,
    (err) => console.warn('Bunny model failed to load.', err)
  );
}

// ── Horse ────────────────────────────────────────────────────────────────────
setProgress(50, 'Loading horse…');
gltfLoader.load(
  './horse.glb',
  (gltf) => {
    setProgress(95, 'Horse ready.');
    horse = gltf.scene;
    horse.scale.setScalar(HORSE_SCALE);
    horse.position.set(MODEL_X, MODEL_Y, MODEL_Z);
    horse.rotation.set(MODEL_ROT_X, horseYaw, MODEL_ROT_Z);
    horse.traverse(child => {
      if (child.isMesh) {
        child.castShadow   = true;
        child.receiveShadow = true;
      }
    });
    scene.add(horse);
    updateHorseGroundOffset();
    applyGrassSizeVariation();

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
    applyGrassSizeVariation();
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
  if (e.code === 'KeyQ' && !e.repeat) collectNearestApple();
  if (e.code === 'KeyE' && !e.repeat) startGallop();
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

function updateAppleHud() {
  if (applePill) applePill.textContent = 'APPLES ' + appleScore;
}

function collectNearestApple() {
  if (!horse || appleItems.length === 0) return;

  let nearest = null;
  let nearestDistanceSq = APPLE_COLLECT_RADIUS * APPLE_COLLECT_RADIUS;

  for (const apple of appleItems) {
    if (apple.collected) continue;
    const dx = apple.group.position.x - horse.position.x;
    const dz = apple.group.position.z - horse.position.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < nearestDistanceSq) {
      nearest = apple;
      nearestDistanceSq = distanceSq;
    }
  }

  if (!nearest) return;
  nearest.collected = true;
  scene.remove(nearest.group);
  appleScore++;
  updateAppleHud();
}

function startGallop() {
  if (!horse || clock.elapsedTime < gallopUntil || appleScore < GALLOP_COST) return;
  appleScore -= GALLOP_COST;
  gallopUntil = clock.elapsedTime + GALLOP_SECONDS;
  updateAppleHud();
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

function crossFadeBunnyTo(next, fadeSecs = 0.35) {
  if (!next || next === bunnyActiveAction) return;
  if (bunnyActiveAction) bunnyActiveAction.fadeOut(fadeSecs);
  next.reset().fadeIn(fadeSecs).play();
  bunnyActiveAction = next;
}

function pickBunnyTarget(elapsed) {
  for (let i = 0; i < 12; i++) {
    const seed = elapsed * 13.7 + i * 19.3;
    const x = (seededRandom(seed + 1) - 0.5) * PASTURE_RADIUS_X * 1.5;
    const z = (seededRandom(seed + 2) - 0.5) * PASTURE_RADIUS_Z * 1.35;
    if (!isInsidePasture(x, z, 26)) continue;
    if (distanceToStream(x, z) < STREAM_WIDTH + 5) continue;
    bunnyTarget.set(x, getPastureHeight(x, z), z);
    return;
  }
}

function updateBunny(delta, elapsed) {
  if (!bunny) return;

  const dx = bunnyTarget.x - bunny.position.x;
  const dz = bunnyTarget.z - bunny.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const pausing = elapsed < bunnyPauseUntil;

  if (distance < 1.6) {
    bunnyPauseUntil = elapsed + 1.2 + seededRandom(elapsed + 5) * 2.4;
    pickBunnyTarget(elapsed + 11);
  }

  if (pausing) {
    crossFadeBunnyTo(bunnyIdleAction || bunnyMoveAction);
  } else {
    crossFadeBunnyTo(bunnyMoveAction || bunnyIdleAction);
    const yaw = Math.atan2(dx, dz);
    bunny.rotation.y += (yaw - bunny.rotation.y) * Math.min(1, delta * 4.5);
    const speedScale = 1.2 + seededRandom(Math.floor(elapsed * 2)) * 0.45;
    bunny.position.x += Math.sin(yaw) * delta * speedScale;
    bunny.position.z += Math.cos(yaw) * delta * speedScale;
    clampToPasture(bunny.position, 24);
    bunny.position.y = getPastureHeight(bunny.position.x, bunny.position.z) + bunnyGroundOffset;
  }

  if (bunnyMoveAction) bunnyMoveAction.timeScale = pausing ? 0.45 : 1.0;
  if (bunnyMixer) bunnyMixer.update(delta);
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME LOOP
// ─────────────────────────────────────────────────────────────────────────────

const clock      = new THREE.Clock();
const statePill  = document.getElementById('state-pill');
const speedPill  = document.getElementById('speed-pill');
const applePill  = document.getElementById('apple-pill');
updateAppleHud();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05); // cap delta to avoid huge jumps
  const elapsed = clock.elapsedTime;

  for (const apple of appleItems) {
    if (apple.collected) continue;
    apple.group.rotation.y += delta * apple.group.userData.spin;
    apple.group.position.y = apple.group.userData.baseY + Math.sin(elapsed * 2.4 + apple.group.position.x) * 0.035;
  }

  updateBunny(delta, elapsed);

  if (skyboxModel) {
    skyboxModel.position.copy(camera.position).add(skyboxOffset);
  }

  if (horse) {

    // ── Arrow keys: camera orbit only ──────────────────────────────────────
    if (keys['ArrowLeft'])  camYawOffset += CAM_KEY_SPEED * delta;
    if (keys['ArrowRight']) camYawOffset -= CAM_KEY_SPEED * delta;
    if (keys['ArrowUp'])    camPitch = Math.max(CAM_PITCH_MIN, camPitch - CAM_KEY_SPEED * 0.45 * delta);
    if (keys['ArrowDown'])  camPitch = Math.min(CAM_PITCH_MAX, camPitch + CAM_KEY_SPEED * 0.45 * delta);

    // ── WASD: horse turn + move ─────────────────────────────────────────────
    const turning = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
    const throttle = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const galloping = elapsed < gallopUntil;
    const moveSpeed = galloping ? GALLOP_SPEED : MOVE_SPEED;

    if (throttle !== 0) {
      horseYaw += turning * TURN_SPEED * delta;
    }

    const targetSpeed = -throttle * moveSpeed;
    speed += (targetSpeed - speed) * SPEED_LERP;
    if (Math.abs(speed) < 0.01) speed = 0;

    // Move horse in its facing direction (Three.js default forward is -Z)
    horse.position.x -= Math.sin(horseYaw) * speed * delta;
    horse.position.z -= Math.cos(horseYaw) * speed * delta;
    clampToPasture(horse.position);
    setHorseOnGround();
    horse.rotation.y = horseYaw;

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
    statePill.textContent = galloping ? 'GALLOP' : (Math.abs(speed) > 0.4 ? 'WALKING' : 'IDLE');
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
