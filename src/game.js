import * as THREE from "../assets/vendor/three.module.js";

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
};

const canvas = $("#gameCanvas");
const startScreen = $("#startScreen");
const gameScreen = $("#gameScreen");
const backendPanel = $("#backendPanel");
const toastEl = $("#toast");
const ui = {
  hp: $("#coinText"),
  level: $("#levelText"),
  stamina: $("#energyText"),
  needs: $("#dateText"),
  threat: $("#roomText"),
  sync: $("#syncStatus"),
  panel: $("#rpgPanel"),
  panelTitle: $("#panelTitle"),
  panelBody: $("#panelBody"),
  chatPanel: $("#chatPanel"),
  chatMessages: $("#chatMessages"),
  chatInput: $("#chatInput"),
};

const WORLD = 180;
const clock = new THREE.Clock();
let renderer;
let scene;
let camera;
let player;
let sun;
let water;
let started = false;
let fallback2D = false;
let ctx2d = null;
let fallbackWorld = null;
let yaw = 0;
let attackCooldown = 0;
let saveTimer = 0;
let toastTimer = 0;
let joystick = { x: 0, y: 0 };
const keys = new Set();
const interactables = [];
const dinos = [];
const structures = [];
const logs = [];

const state = {
  name: "幸存者",
  hp: 100,
  stamina: 100,
  hunger: 100,
  thirst: 100,
  level: 1,
  xp: 0,
  dayTime: 0.28,
  inventory: {
    wood: 0,
    stone: 0,
    fiber: 0,
    berries: 2,
    meat: 0,
    hide: 0,
    spear: 1,
  },
  crafted: {
    campfire: 0,
    foundation: 0,
  },
};

const material = {
  grass: new THREE.MeshLambertMaterial({ color: 0x426f32 }),
  sand: new THREE.MeshLambertMaterial({ color: 0xb99a63 }),
  rock: new THREE.MeshLambertMaterial({ color: 0x6b7178 }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x7a4a2a }),
  leaf: new THREE.MeshLambertMaterial({ color: 0x2f7d3a }),
  water: new THREE.MeshLambertMaterial({ color: 0x2589c7, transparent: true, opacity: 0.72 }),
  player: new THREE.MeshStandardMaterial({ color: 0xd9b06e, roughness: 0.75 }),
  playerCloth: new THREE.MeshStandardMaterial({ color: 0x315f48, roughness: 0.85 }),
  raptor: new THREE.MeshStandardMaterial({ color: 0x7b6b4f, roughness: 0.95 }),
  herb: new THREE.MeshStandardMaterial({ color: 0x4f8b5b, roughness: 0.95 }),
  warning: new THREE.MeshBasicMaterial({ color: 0xff5f4a }),
};

function init() {
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) {
    initFallback2D();
    return;
  }
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x7ab6d6);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8bb6cc, 55, 170);

  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xb9e7ff, 0x28351f, 1.15);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffe2a2, 1.45);
  sun.position.set(38, 58, 18);
  sun.castShadow = true;
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  buildIsland();
  player = createPlayer();
  player.position.set(0, 1.1, 10);
  scene.add(player);
  spawnWorld();
  resizeCanvas();
  log("你在陌生荒岛醒来。先采集木头、石头和浆果。");
  log("靠近湖边可饮水，遇到迅猛龙请攻击或逃跑。");
}

function buildIsland() {
  const groundGeo = new THREE.PlaneGeometry(WORLD, WORLD, 96, 96);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (WORLD / 2);
    const height = Math.sin(x * 0.16) * 0.45 + Math.cos(z * 0.14) * 0.35 - Math.max(0, edge - 0.76) * 8;
    pos.setY(i, height);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, material.grass);
  ground.receiveShadow = true;
  scene.add(ground);

  const beach = new THREE.Mesh(
    new THREE.RingGeometry(70, 90, 96),
    material.sand,
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.y = 0.04;
  beach.receiveShadow = true;
  scene.add(beach);

  water = new THREE.Mesh(new THREE.CircleGeometry(16, 48), material.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(-25, 0.18, -18);
  water.name = "淡水湖";
  scene.add(water);

  const lakeRing = new THREE.Mesh(new THREE.RingGeometry(16, 18, 48), material.sand);
  lakeRing.rotation.x = -Math.PI / 2;
  lakeRing.position.copy(water.position);
  lakeRing.position.y = 0.16;
  scene.add(lakeRing);
}

function spawnWorld() {
  for (let i = 0; i < 42; i += 1) {
    const p = randomLandPoint();
    addTree(p.x, p.z);
  }
  for (let i = 0; i < 26; i += 1) {
    const p = randomLandPoint();
    addRock(p.x, p.z);
  }
  for (let i = 0; i < 24; i += 1) {
    const p = randomLandPoint();
    addBush(p.x, p.z);
  }
  [
    { x: 18, z: -30, kind: "herb" },
    { x: -38, z: 32, kind: "herb" },
    { x: 45, z: 20, kind: "raptor" },
    { x: -52, z: -42, kind: "raptor" },
  ].forEach((d) => addDino(d.x, d.z, d.kind));
}

function initFallback2D() {
  fallback2D = true;
  ctx2d = canvas.getContext("2d");
  player = { position: new THREE.Vector3(0, 1.1, 10), rotation: { y: 0 } };
  fallbackWorld = {
    nodes: [
      ...Array.from({ length: 18 }, () => ({ type: "tree", x: rand(-70, 70), z: rand(-70, 70), hp: 3 })),
      ...Array.from({ length: 12 }, () => ({ type: "rock", x: rand(-70, 70), z: rand(-70, 70), hp: 3 })),
      ...Array.from({ length: 12 }, () => ({ type: "bush", x: rand(-70, 70), z: rand(-70, 70), hp: 1 })),
    ],
    dinos: [
      { kind: "raptor", x: 45, z: 22, hp: 42, attack: 0 },
      { kind: "raptor", x: -48, z: -38, hp: 42, attack: 0 },
      { kind: "herb", x: 20, z: -32, hp: 62, attack: 0 },
    ],
    structures: [],
  };
  showToast("当前浏览器禁用了 WebGL，已进入 2D 降级生存模式。");
  log("WebGL 不可用：已启用 Canvas 2D 降级模式，核心生存玩法仍可测试。");
}

function randomLandPoint() {
  for (let i = 0; i < 50; i += 1) {
    const x = rand(-75, 75);
    const z = rand(-75, 75);
    if (Math.hypot(x, z) < 78 && Math.hypot(x + 25, z + 18) > 22) return { x, z };
  }
  return { x: rand(-45, 45), z: rand(-45, 45) };
}

function createPlayer() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.05, 4, 8), material.player);
  body.position.y = 0.8;
  body.castShadow = true;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.55, 0.38), material.playerCloth);
  cloth.position.set(0, 0.75, -0.03);
  cloth.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), material.player);
  head.position.y = 1.65;
  head.castShadow = true;
  const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0x72512b }));
  spear.rotation.z = Math.PI / 2.8;
  spear.position.set(0.55, 1.05, -0.2);
  spear.castShadow = true;
  g.add(body, cloth, head, spear);
  return g;
}

function addTree(x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 3.2, 7), material.trunk);
  trunk.position.y = 1.6;
  trunk.castShadow = true;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.55, 4.1, 8), material.leaf);
  crown.position.y = 4;
  crown.castShadow = true;
  g.add(trunk, crown);
  g.position.set(x, 0, z);
  g.userData = { type: "tree", hp: 3, label: "树木", gives: { wood: 2, fiber: 1 } };
  scene.add(g);
  interactables.push(g);
}

function addRock(x, z) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.7, 1.25), 0), material.rock);
  rock.scale.y = rand(0.55, 1.15);
  rock.position.set(x, 0.7, z);
  rock.castShadow = true;
  rock.receiveShadow = true;
  rock.userData = { type: "rock", hp: 3, label: "岩石", gives: { stone: 2 } };
  scene.add(rock);
  interactables.push(rock);
}

function addBush(x, z) {
  const bush = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3f9b42 }));
  bush.scale.y = 0.55;
  bush.position.set(x, 0.45, z);
  bush.castShadow = true;
  bush.userData = { type: "bush", hp: 1, label: "浆果丛", gives: { berries: 2, fiber: 1 } };
  scene.add(bush);
  interactables.push(bush);
}

function addDino(x, z, kind) {
  const g = new THREE.Group();
  const mat = kind === "raptor" ? material.raptor : material.herb;
  const body = new THREE.Mesh(new THREE.BoxGeometry(kind === "raptor" ? 1.6 : 2.5, 1.05, 0.85), mat);
  body.position.y = 1.05;
  body.castShadow = true;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.0, 6), mat);
  neck.position.set(0.72, 1.55, 0);
  neck.rotation.z = -0.65;
  neck.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.52), mat);
  head.position.set(1.25, 1.85, 0);
  head.castShadow = true;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.8, 6), mat);
  tail.position.set(-1.1, 1.1, 0);
  tail.rotation.z = Math.PI / 2;
  tail.castShadow = true;
  for (const lx of [-0.55, 0.55]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.9, 6), mat);
    leg.position.set(lx, 0.45, 0.28);
    leg.castShadow = true;
    const leg2 = leg.clone();
    leg2.position.z = -0.28;
    g.add(leg, leg2);
  }
  g.add(body, neck, head, tail);
  g.position.set(x, 0, z);
  g.userData = {
    type: "dino",
    kind,
    hp: kind === "raptor" ? 42 : 62,
    maxHp: kind === "raptor" ? 42 : 62,
    speed: kind === "raptor" ? 8.5 : 3.2,
    state: "wander",
    target: randomLandPoint(),
    attackTimer: 0,
  };
  scene.add(g);
  dinos.push(g);
}

function update(dt) {
  if (!started) return;
  if (fallback2D) {
    updateFallback2D(dt);
    return;
  }
  attackCooldown = Math.max(0, attackCooldown - dt);
  saveTimer += dt;
  updateSurvival(dt);
  updatePlayer(dt);
  updateDinos(dt);
  updateDayNight(dt);
  updateCamera(dt);
  updateHud();
  if (saveTimer > 6) {
    saveTimer = 0;
    saveLocal();
  }
}

function updateSurvival(dt) {
  state.hunger = clamp(state.hunger - dt * 0.45, 0, 100);
  state.thirst = clamp(state.thirst - dt * 0.7, 0, 100);
  if (state.hunger <= 0 || state.thirst <= 0) state.hp = clamp(state.hp - dt * 4, 0, 100);
  if (state.hunger > 35 && state.thirst > 35 && state.hp < 100) state.hp = clamp(state.hp + dt * 1.1, 0, 100);
  if (state.hp <= 0) respawn();
}

function updatePlayer(dt) {
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const keyX = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const keyY = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const mx = joystick.x || keyX;
  const my = -joystick.y || keyY;
  const move = new THREE.Vector3();
  move.addScaledVector(right, mx);
  move.addScaledVector(forward, my);
  const len = move.length();
  const sprinting = keys.has("ShiftLeft") && state.stamina > 3 && len > 0.1;
  if (len > 0.1) {
    move.normalize();
    const speed = sprinting ? 13 : 8;
    if (sprinting) state.stamina = clamp(state.stamina - dt * 14, 0, 100);
    player.position.addScaledVector(move, speed * dt);
    player.rotation.y = Math.atan2(move.x, move.z);
  } else {
    state.stamina = clamp(state.stamina + dt * 8, 0, 100);
  }
  const r = Math.hypot(player.position.x, player.position.z);
  if (r > 84) {
    player.position.x *= 84 / r;
    player.position.z *= 84 / r;
  }
  player.position.y = 1.1;
}

function updateDinos(dt) {
  const p = player.position;
  dinos.slice().forEach((d) => {
    const data = d.userData;
    data.attackTimer = Math.max(0, data.attackTimer - dt);
    const dToPlayer = dist2(d.position, p);
    let target = data.target;
    let speed = data.speed;
    if (data.kind === "raptor" && dToPlayer < 34) {
      target = p;
      speed *= dToPlayer < 8 ? 1.15 : 1;
      if (dToPlayer < 2.4 && data.attackTimer <= 0) {
        data.attackTimer = 1.15;
        state.hp = clamp(state.hp - 11, 0, 100);
        log("迅猛龙咬伤了你，快攻击或逃离！");
        flashDamage();
      }
    } else if (dToPlayer < 8 && data.kind === "herb") {
      target = new THREE.Vector3(d.position.x - (p.x - d.position.x), 0, d.position.z - (p.z - d.position.z));
      speed *= 1.35;
    } else if (dist2(d.position, data.target) < 3) {
      data.target = randomLandPoint();
      target = data.target;
    }
    const dir = new THREE.Vector3(target.x - d.position.x, 0, target.z - d.position.z);
    if (dir.length() > 0.1) {
      dir.normalize();
      d.position.addScaledVector(dir, speed * dt);
      d.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
    }
  });
}

function updateDayNight(dt) {
  state.dayTime = (state.dayTime + dt * 0.012) % 1;
  const angle = state.dayTime * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 55, Math.max(8, Math.sin(angle) * 70), 28);
  const daylight = clamp(Math.sin(angle) * 0.75 + 0.35, 0.18, 1.35);
  sun.intensity = daylight;
  renderer.setClearColor(new THREE.Color().setHSL(0.57, 0.45, daylight > 0.35 ? 0.62 : 0.16));
  scene.fog.color = renderer.getClearColor(new THREE.Color());
}

function updateCamera(dt) {
  const desired = new THREE.Vector3(
    player.position.x - Math.sin(yaw) * 11,
    player.position.y + 6.2,
    player.position.z - Math.cos(yaw) * 11,
  );
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  camera.lookAt(player.position.x, player.position.y + 1.2, player.position.z);
}

function updateFallback2D(dt) {
  attackCooldown = Math.max(0, attackCooldown - dt);
  saveTimer += dt;
  updateSurvival(dt);
  const keyX = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const keyY = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  const vx = joystick.x || keyX;
  const vz = joystick.y || keyY;
  const len = Math.hypot(vx, vz);
  if (len > 0.1) {
    player.position.x += (vx / len) * 28 * dt;
    player.position.z += (vz / len) * 28 * dt;
    const r = Math.hypot(player.position.x, player.position.z);
    if (r > 82) {
      player.position.x *= 82 / r;
      player.position.z *= 82 / r;
    }
  }
  fallbackWorld.dinos.forEach((d) => {
    d.attack = Math.max(0, d.attack - dt);
    const dx = player.position.x - d.x;
    const dz = player.position.z - d.z;
    const dd = Math.hypot(dx, dz);
    const speed = d.kind === "raptor" && dd < 34 ? 13 : d.kind === "herb" ? 4 : 6;
    if (dd > 0.1) {
      const sign = d.kind === "herb" && dd < 9 ? -1 : 1;
      d.x += (dx / dd) * speed * dt * sign;
      d.z += (dz / dd) * speed * dt * sign;
    }
    if (d.kind === "raptor" && dd < 3.5 && d.attack <= 0) {
      d.attack = 1.2;
      state.hp = clamp(state.hp - 9, 0, 100);
      flashDamage();
      log("迅猛龙扑咬了你。");
    }
  });
  state.dayTime = (state.dayTime + dt * 0.012) % 1;
  updateHud();
  if (saveTimer > 6) {
    saveTimer = 0;
    saveLocal();
  }
}

function renderFallback2D() {
  if (!ctx2d || !fallbackWorld) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.floor(rect.width || window.innerWidth);
  const h = Math.floor(rect.height || window.innerHeight);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const cx = w / 2;
  const cy = h / 2;
  const scale = Math.min(w, h) / 190;
  ctx2d.fillStyle = "#78a95a";
  ctx2d.fillRect(0, 0, w, h);
  ctx2d.save();
  ctx2d.translate(cx - player.position.x * scale, cy - player.position.z * scale);
  ctx2d.scale(scale, scale);
  ctx2d.fillStyle = "#c7ad75";
  ctx2d.beginPath();
  ctx2d.arc(0, 0, 88, 0, Math.PI * 2);
  ctx2d.fill();
  ctx2d.fillStyle = "#4f8b3f";
  ctx2d.beginPath();
  ctx2d.arc(0, 0, 80, 0, Math.PI * 2);
  ctx2d.fill();
  ctx2d.fillStyle = "#287fc0";
  ctx2d.beginPath();
  ctx2d.arc(-25, -18, 16, 0, Math.PI * 2);
  ctx2d.fill();
  fallbackWorld.nodes.forEach((n) => {
    ctx2d.fillStyle = n.type === "tree" ? "#1d6b35" : n.type === "rock" ? "#72777f" : "#3fa34d";
    ctx2d.beginPath();
    ctx2d.arc(n.x, n.z, n.type === "tree" ? 2.8 : 2.1, 0, Math.PI * 2);
    ctx2d.fill();
  });
  fallbackWorld.structures.forEach((s) => {
    ctx2d.fillStyle = s.type === "campfire" ? "#ff8a2a" : "#8a5a2f";
    ctx2d.fillRect(s.x - 2, s.z - 2, 4, 4);
  });
  fallbackWorld.dinos.forEach((d) => {
    ctx2d.fillStyle = d.kind === "raptor" ? "#8b6c4a" : "#4f8b5b";
    ctx2d.fillRect(d.x - 3, d.z - 2, 6, 4);
    ctx2d.fillStyle = "#1a1510";
    ctx2d.fillRect(d.x - 3, d.z - 4, 6 * clamp(d.hp / (d.kind === "raptor" ? 42 : 62), 0, 1), 1);
  });
  ctx2d.fillStyle = "#f0c38a";
  ctx2d.beginPath();
  ctx2d.arc(player.position.x, player.position.z, 2.6, 0, Math.PI * 2);
  ctx2d.fill();
  ctx2d.restore();
  ctx2d.fillStyle = "rgba(0,0,0,.48)";
  ctx2d.fillRect(12, h - 34, w - 24, 22);
  ctx2d.fillStyle = "#fff3d4";
  ctx2d.font = "12px sans-serif";
  ctx2d.fillText("2D 降级模式：WASD/摇杆移动，采集/饮水/攻击/建造仍可用", 22, h - 19);
}

function nearestFallbackNode(range) {
  return fallbackWorld.nodes
    .filter((n) => Math.hypot(n.x - player.position.x, n.z - player.position.z) <= range)
    .sort((a, b) => Math.hypot(a.x - player.position.x, a.z - player.position.z) - Math.hypot(b.x - player.position.x, b.z - player.position.z))[0];
}

function nearestFallbackDino(range) {
  return fallbackWorld.dinos
    .filter((d) => Math.hypot(d.x - player.position.x, d.z - player.position.z) <= range)
    .sort((a, b) => Math.hypot(a.x - player.position.x, a.z - player.position.z) - Math.hypot(b.x - player.position.x, b.z - player.position.z))[0];
}

function gatherFallback2D() {
  const n = nearestFallbackNode(5);
  if (!n) return showToast("靠近树、岩石或浆果丛再采集");
  if (state.stamina < 8) return showToast("体力不足");
  state.stamina -= 8;
  n.hp -= 1;
  const gives = n.type === "tree" ? { wood: 2, fiber: 1 } : n.type === "rock" ? { stone: 2 } : { berries: 2, fiber: 1 };
  Object.entries(gives).forEach(([k, v]) => { state.inventory[k] += v; });
  showToast(`采集获得：${Object.keys(gives).join("、")}`);
  if (n.hp <= 0) fallbackWorld.nodes.splice(fallbackWorld.nodes.indexOf(n), 1);
}

function drinkFallback2D() {
  if (Math.hypot(player.position.x + 25, player.position.z + 18) < 18) {
    state.thirst = 100;
    showToast("喝下淡水，口渴恢复。");
  } else if (state.inventory.berries > 0) {
    state.inventory.berries -= 1;
    state.hunger = clamp(state.hunger + 18, 0, 100);
    state.thirst = clamp(state.thirst + 8, 0, 100);
    showToast("吃下浆果。");
  } else showToast("没有浆果，去湖边饮水。");
}

function attackFallback2D() {
  if (attackCooldown > 0) return;
  const d = nearestFallbackDino(6);
  if (!d) return showToast("附近没有目标");
  attackCooldown = 0.55;
  d.hp -= state.inventory.spear > 0 ? 20 : 8;
  if (d.hp <= 0) {
    fallbackWorld.dinos.splice(fallbackWorld.dinos.indexOf(d), 1);
    state.inventory.meat += d.kind === "raptor" ? 3 : 5;
    state.inventory.hide += d.kind === "raptor" ? 2 : 3;
    showToast("猎物倒下，获得肉和兽皮。");
  }
}

function buildFallback2D() {
  if (state.inventory.wood >= 4 && state.inventory.stone >= 2) {
    state.inventory.wood -= 4;
    state.inventory.stone -= 2;
    fallbackWorld.structures.push({ type: "campfire", x: player.position.x + 4, z: player.position.z });
    showToast("建造营火。");
  } else if (state.inventory.wood >= 3 && state.inventory.fiber >= 2) {
    state.inventory.wood -= 3;
    state.inventory.fiber -= 2;
    fallbackWorld.structures.push({ type: "foundation", x: player.position.x + 4, z: player.position.z });
    showToast("铺设地基。");
  } else showToast("建造需要更多木材、石头或纤维。");
}

function gather() {
  if (fallback2D) return gatherFallback2D();
  const target = nearestInteractable(4.2);
  if (!target) return showToast("靠近树、岩石或浆果丛再采集");
  if (state.stamina < 8) return showToast("体力不足，等一会儿恢复");
  state.stamina = clamp(state.stamina - 8, 0, 100);
  target.userData.hp -= 1;
  Object.entries(target.userData.gives || {}).forEach(([k, v]) => {
    state.inventory[k] = (state.inventory[k] || 0) + v;
  });
  gainXp(4);
  log(`采集 ${target.userData.label}，获得资源。`);
  showToast(`获得：${Object.keys(target.userData.gives || {}).join("、")}`);
  if (target.userData.hp <= 0) {
    scene.remove(target);
    const i = interactables.indexOf(target);
    if (i >= 0) interactables.splice(i, 1);
  }
  saveLocal();
}

function drinkOrEat() {
  if (fallback2D) return drinkFallback2D();
  const lakeDistance = Math.hypot(player.position.x + 25, player.position.z + 18);
  if (lakeDistance < 18) {
    state.thirst = 100;
    showToast("喝下淡水，口渴恢复。");
    log("你在湖边补满了水分。");
    return;
  }
  if (state.inventory.berries > 0) {
    state.inventory.berries -= 1;
    state.hunger = clamp(state.hunger + 18, 0, 100);
    state.thirst = clamp(state.thirst + 8, 0, 100);
    showToast("吃下浆果，恢复少量饥饿和口渴。");
    saveLocal();
  } else {
    showToast("没有浆果；靠近湖边可以饮水。");
  }
}

function attack() {
  if (fallback2D) return attackFallback2D();
  if (attackCooldown > 0) return;
  if (state.stamina < 10) return showToast("体力不足，无法攻击");
  attackCooldown = 0.55;
  state.stamina = clamp(state.stamina - 10, 0, 100);
  const target = nearestDino(4.2);
  if (!target) {
    showToast("附近没有目标");
    return;
  }
  const damage = state.inventory.spear > 0 ? 20 : 8;
  target.userData.hp -= damage;
  log(`你攻击了${target.userData.kind === "raptor" ? "迅猛龙" : "三角兽"}，造成 ${damage} 伤害。`);
  if (target.userData.hp <= 0) {
    scene.remove(target);
    dinos.splice(dinos.indexOf(target), 1);
    state.inventory.meat += target.userData.kind === "raptor" ? 3 : 5;
    state.inventory.hide += target.userData.kind === "raptor" ? 2 : 3;
    gainXp(target.userData.kind === "raptor" ? 35 : 22);
    showToast("猎物倒下，获得肉和兽皮。");
  }
  saveLocal();
}

function build() {
  if (fallback2D) return buildFallback2D();
  if (state.inventory.wood >= 4 && state.inventory.stone >= 2) {
    state.inventory.wood -= 4;
    state.inventory.stone -= 2;
    state.crafted.campfire += 1;
    addCampfire(player.position.x + Math.sin(yaw) * 3, player.position.z + Math.cos(yaw) * 3);
    showToast("建造营火：夜晚更安全。");
    log("你搭起了一座营火。");
    saveLocal();
    return;
  }
  if (state.inventory.wood >= 3 && state.inventory.fiber >= 2) {
    state.inventory.wood -= 3;
    state.inventory.fiber -= 2;
    state.crafted.foundation += 1;
    addFoundation(player.position.x + Math.sin(yaw) * 3, player.position.z + Math.cos(yaw) * 3);
    showToast("铺设木质地基。");
    saveLocal();
    return;
  }
  showToast("建造需要：营火 4木+2石，地基 3木+2纤维");
}

function addCampfire(x, z) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.25, 8), material.rock);
  base.position.y = 0.18;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 8), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
  flame.position.y = 0.78;
  const light = new THREE.PointLight(0xff8a2a, 1.8, 16);
  light.position.y = 1.3;
  g.add(base, flame, light);
  g.position.set(x, 0, z);
  scene.add(g);
  structures.push(g);
}

function addFoundation(x, z) {
  const f = new THREE.Mesh(new THREE.BoxGeometry(4, 0.35, 4), new THREE.MeshLambertMaterial({ color: 0x8a5a2f }));
  f.position.set(x, 0.22, z);
  f.receiveShadow = true;
  f.castShadow = true;
  scene.add(f);
  structures.push(f);
}

function nearestInteractable(range) {
  return interactables
    .filter((o) => dist2(o.position, player.position) <= range)
    .sort((a, b) => dist2(a.position, player.position) - dist2(b.position, player.position))[0];
}

function nearestDino(range) {
  return dinos
    .filter((o) => dist2(o.position, player.position) <= range)
    .sort((a, b) => dist2(a.position, player.position) - dist2(b.position, player.position))[0];
}

function gainXp(amount) {
  state.xp += amount;
  const next = state.level * 80;
  if (state.xp >= next) {
    state.xp -= next;
    state.level += 1;
    state.hp = 100;
    state.stamina = 100;
    showToast(`升级到 ${state.level} 级`);
  }
}

function respawn() {
  state.hp = 100;
  state.stamina = 100;
  state.hunger = 70;
  state.thirst = 70;
  player.position.set(0, 1.1, 10);
  log("你昏迷后在海滩醒来，丢失了一些肉和兽皮。");
  state.inventory.meat = Math.max(0, state.inventory.meat - 2);
  state.inventory.hide = Math.max(0, state.inventory.hide - 1);
}

function flashDamage() {
  gameScreen.classList.add("damage");
  setTimeout(() => gameScreen.classList.remove("damage"), 180);
}

function openBag() {
  const rows = Object.entries(state.inventory)
    .map(([k, v]) => `<div class="bag-row"><span>${itemName(k)}</span><strong>×${v}</strong></div>`)
    .join("");
  openPanel("背包", `<div class="bag-list">${rows}</div><p class="panel-note">采集：靠近树/石/浆果丛点“采集”。饮水：靠近湖泊点“饮水”。</p>`);
}

function openCraft() {
  openPanel("制作", `
    <div class="quest-row"><strong>石矛</strong><p>已有：${state.inventory.spear}</p><button class="panel-action" data-craft="spear">2木 + 1石 + 1纤维</button></div>
    <div class="quest-row"><strong>营火</strong><p>已有：${state.crafted.campfire}</p><button class="panel-action" data-craft="campfire">4木 + 2石</button></div>
    <div class="quest-row"><strong>木质地基</strong><p>已有：${state.crafted.foundation}</p><button class="panel-action" data-craft="foundation">3木 + 2纤维</button></div>
  `);
}

function craft(kind) {
  const need = {
    spear: { wood: 2, stone: 1, fiber: 1 },
    campfire: { wood: 4, stone: 2 },
    foundation: { wood: 3, fiber: 2 },
  }[kind];
  if (!need) return;
  if (!Object.entries(need).every(([k, v]) => (state.inventory[k] || 0) >= v)) {
    showToast("材料不足");
    return;
  }
  Object.entries(need).forEach(([k, v]) => { state.inventory[k] -= v; });
  if (kind === "spear") state.inventory.spear += 1;
  if (kind === "campfire") {
    state.crafted.campfire += 1;
    addCampfire(player.position.x + 3, player.position.z);
  }
  if (kind === "foundation") {
    state.crafted.foundation += 1;
    addFoundation(player.position.x + 3, player.position.z);
  }
  showToast("制作完成");
  openCraft();
  saveLocal();
}

function openLogPanel() {
  ui.chatPanel.classList.toggle("hidden");
  renderLogs();
}

function openPanel(title, html) {
  ui.panelTitle.textContent = title;
  ui.panelBody.innerHTML = html;
  ui.panel.classList.remove("hidden");
}

function closePanel() {
  ui.panel.classList.add("hidden");
}

function itemName(k) {
  return {
    wood: "木材",
    stone: "石头",
    fiber: "纤维",
    berries: "浆果",
    meat: "生肉",
    hide: "兽皮",
    spear: "石矛",
  }[k] || k;
}

function log(text) {
  logs.unshift({ t: Date.now(), text });
  logs.splice(24);
  renderLogs();
}

function renderLogs() {
  if (!ui.chatMessages) return;
  ui.chatMessages.innerHTML = logs.map((l) => `<div class="chat-line">${l.text}</div>`).join("");
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2100);
}

function updateHud() {
  const nearestThreat = dinos.reduce((m, d) => Math.min(m, d.userData.kind === "raptor" ? dist2(d.position, player.position) : 999), 999);
  ui.hp.textContent = Math.round(state.hp);
  ui.level.textContent = state.level;
  ui.stamina.textContent = Math.round(state.stamina);
  ui.needs.textContent = `${Math.round(state.hunger)}/${Math.round(state.thirst)}`;
  ui.threat.textContent = nearestThreat < 10 ? "高" : nearestThreat < 28 ? "中" : "低";
  ui.sync.textContent = `木${state.inventory.wood} 石${state.inventory.stone} 矛${state.inventory.spear}`;
}

function saveLocal() {
  localStorage.setItem("arkLikeSurvival3D", JSON.stringify({
    state,
    logs: logs.slice(0, 12),
  }));
}

function loadLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem("arkLikeSurvival3D") || "null");
    if (!raw?.state) return;
    Object.assign(state, raw.state);
    logs.splice(0, logs.length, ...(raw.logs || []));
  } catch {}
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width || window.innerWidth));
  const h = Math.max(1, Math.floor(rect.height || window.innerHeight));
  if (fallback2D) {
    canvas.width = w;
    canvas.height = h;
    return;
  }
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function startGame() {
  state.name = $("#playerName").value.trim() || "幸存者";
  startScreen.classList.remove("active");
  gameScreen.classList.remove("hidden");
  if (!scene && !fallback2D) init();
  loadLocal();
  started = true;
  resizeCanvas();
  requestAnimationFrame(resizeCanvas);
  showToast("进入荒岛：采集、饮水、制作、战斗。");
}

function bindJoystick() {
  const base = $("#joystick");
  const stick = $("#joystickStick");
  if (!base || !stick) return;
  let active = false;
  const reset = () => {
    active = false;
    joystick = { x: 0, y: 0 };
    stick.style.transform = "translate(-50%, -50%)";
  };
  const move = (event) => {
    if (!active) return;
    const rect = base.getBoundingClientRect();
    const radius = rect.width / 2;
    const cx = rect.left + radius;
    const cy = rect.top + radius;
    const rawX = event.clientX - cx;
    const rawY = event.clientY - cy;
    const dist = Math.hypot(rawX, rawY);
    const max = radius * 0.55;
    const scale = dist > max ? max / dist : 1;
    stick.style.transform = `translate(calc(-50% + ${rawX * scale}px), calc(-50% + ${rawY * scale}px))`;
    joystick = { x: clamp(rawX / max, -1, 1), y: clamp(rawY / max, -1, 1) };
  };
  base.addEventListener("pointerdown", (e) => {
    active = true;
    base.setPointerCapture?.(e.pointerId);
    move(e);
  });
  base.addEventListener("pointermove", move);
  base.addEventListener("pointerup", reset);
  base.addEventListener("pointercancel", reset);
}

function bindEvents() {
  $("#startGame").addEventListener("click", startGame);
  $("#openBackend").addEventListener("click", () => backendPanel.classList.remove("hidden"));
  $("#closeBackend").addEventListener("click", () => backendPanel.classList.add("hidden"));
  $("#saveBackend").addEventListener("click", () => {
    backendPanel.classList.add("hidden");
    showToast("3D 单机原型不需要后端，已关闭设置面板。");
  });
  $("#plantBtn").addEventListener("click", gather);
  $("#waterBtn").addEventListener("click", drinkOrEat);
  $("#harvestBtn").addEventListener("click", attack);
  $("#shopBtn").addEventListener("click", build);
  $("#bagBtn").addEventListener("click", openBag);
  $("#questBtn").addEventListener("click", openCraft);
  $("#sleepBtn").addEventListener("click", () => {
    state.hunger = clamp(state.hunger - 8, 0, 100);
    state.thirst = clamp(state.thirst - 8, 0, 100);
    state.hp = clamp(state.hp + 28, 0, 100);
    state.stamina = 100;
    showToast("在营地短暂休息，生命和体力恢复。");
  });
  $("#chatToggle").addEventListener("click", openLogPanel);
  $("#closeChat").addEventListener("click", () => ui.chatPanel.classList.add("hidden"));
  $("#syncNow").addEventListener("click", () => {
    saveLocal();
    showToast("本地存档已保存");
  });
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = ui.chatInput.value.trim();
    if (text) log(`笔记：${text}`);
    ui.chatInput.value = "";
  });
  $("#panelClose").addEventListener("click", closePanel);
  ui.panelBody.addEventListener("click", (e) => {
    const craftKind = e.target.closest("[data-craft]")?.dataset.craft;
    if (craftKind) craft(craftKind);
  });
  $("#toolToggle").addEventListener("click", () => {
    const controls = $("#controlsPanel");
    const cropBar = $("#cropBar");
    const open = controls.classList.toggle("collapsed") === false;
    cropBar.classList.toggle("collapsed", !open);
    $("#toolToggle").classList.toggle("open", open);
    $("#toolToggle").setAttribute("aria-expanded", String(open));
  });

  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyE") gather();
    if (e.code === "KeyF") attack();
    if (e.code === "KeyB") build();
    if (e.code === "KeyQ") drinkOrEat();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("resize", resizeCanvas);

  let dragging = false;
  let lastX = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("pointercancel", () => { dragging = false; });
  bindJoystick();
}

function loop() {
  const dt = Math.min(0.033, clock.getDelta());
  update(dt);
  if (fallback2D) renderFallback2D();
  if (renderer && scene && camera) renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

bindEvents();
loop();
