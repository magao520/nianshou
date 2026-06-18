const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

const canvas = $("#gameCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
const startScreen = $("#startScreen");
const gameScreen = $("#gameScreen");
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

const WORLD = 2600;
const SAVE_KEY = "primeArk2D_v4";
const SAFE_RADIUS = 260;
const START_SAFE_TIME = 75;
const LAKES = [
  { x: -330, y: -150, rx: 185, ry: 128, rot: -0.15 },
  { x: 470, y: 520, rx: 120, ry: 80, rot: 0 },
];
const keys = new Set();
const particles = [];
const floaters = [];
const logs = [];
const resources = [];
const dinos = [];
const buildings = [];
const decals = [];
const ripples = [];
const images = {};
let started = false;
let last = performance.now();
let time = 0;
let weather = "clear";
let weatherTimer = 25;
let rainPower = 0;
let toastTimer = 0;
let attackTimer = 0;
let gatherTimer = 0;
let cameraShake = 0;
let pointerAim = { x: 0, y: 0 };
let joystick = { x: 0, y: 0 };
let camera = { x: 0, y: 0, zoom: 1 };
let graceTimer = START_SAFE_TIME;

const player = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  r: 18,
  dir: 0,
  hp: 100,
  stamina: 100,
  hunger: 100,
  thirst: 100,
  level: 1,
  xp: 0,
  inv: { wood: 0, stone: 0, fiber: 0, berries: 3, meat: 0, hide: 0, spear: 1 },
  quests: { gather: 0, build: 0, hunt: 0 },
};

const recipes = {
  spear: { name: "骨矛", cost: { wood: 2, stone: 1, fiber: 1 }, apply: () => player.inv.spear += 1 },
  campfire: { name: "营火", cost: { wood: 4, stone: 2 }, apply: () => placeBuilding("campfire") },
  palisade: { name: "木栅栏", cost: { wood: 3, fiber: 1 }, apply: () => placeBuilding("palisade") },
  hut: { name: "棕榈棚屋", cost: { wood: 10, fiber: 6, hide: 1 }, apply: () => placeBuilding("hut") },
};

const tasks = [
  { id: "gather", name: "立足荒岛", text: "采集 12 份资源", goal: 12 },
  { id: "build", name: "点亮营地", text: "建造 2 个建筑", goal: 2 },
  { id: "hunt", name: "猎手证明", text: "击倒 2 只恐龙", goal: 2 },
];

function loadImage(key, src) {
  const img = new Image();
  img.src = src;
  images[key] = img;
}

[
  ["flame", "./assets/2d/kenney/particles/flame_06.png"],
  ["smoke", "./assets/2d/kenney/particles/smoke_07.png"],
  ["spark", "./assets/2d/kenney/particles/spark_06.png"],
  ["slash", "./assets/2d/kenney/particles/slash_01.png"],
  ["light", "./assets/2d/kenney/particles/light_01.png"],
  ["uiPanel", "./assets/2d/kenney/ui/panel_beige.png"],
  ["uiButton", "./assets/2d/kenney/ui/buttonLong_beige.png"],
].forEach(([k, v]) => loadImage(k, v));

function initWorld() {
  resources.length = 0;
  dinos.length = 0;
  buildings.length = 0;
  decals.length = 0;
  ripples.length = 0;

  const rngPoints = (count, minR, maxR, options = {}) => {
    const pts = [];
    let guard = 0;
    while (pts.length < count && guard < count * 80) {
      guard += 1;
      const a = rand(0, TAU);
      const r = rand(minR, maxR);
      const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      if (isValidLandPoint(p.x, p.y, options)) pts.push(p);
    }
    return pts;
  };

  rngPoints(72, 260, 1080, { avoidCamp: true, avoidWater: true }).forEach((p, i) => {
    resources.push({ id: `tree-${i}`, type: "tree", x: p.x, y: p.y, r: rand(24, 42), hp: 3, maxHp: 3, sway: rand(0, TAU) });
  });
  rngPoints(34, 260, 1040, { avoidCamp: true, avoidWater: true }).forEach((p, i) => {
    resources.push({ id: `rock-${i}`, type: "rock", x: p.x, y: p.y, r: rand(20, 34), hp: 3, maxHp: 3, rot: rand(0, TAU) });
  });
  rngPoints(40, 210, 940, { avoidCamp: true, avoidWater: true }).forEach((p, i) => {
    resources.push({ id: `bush-${i}`, type: "bush", x: p.x, y: p.y, r: rand(18, 28), hp: 1, maxHp: 1, sway: rand(0, TAU) });
  });
  rngPoints(150, 80, 1120, { avoidWater: true }).forEach((p) => {
    const flower = Math.random() >= 0.72;
    decals.push({
      type: flower ? "flower" : "grass",
      x: p.x,
      y: p.y,
      s: rand(0.6, 1.4),
      a: rand(0, TAU),
      color: flower ? (Math.random() < 0.5 ? "#e8d653" : "#f1a7d5") : "#74a95b",
    });
  });
  [
    { type: "bush", x: 185, y: -40, r: 22, hp: 1, maxHp: 1, sway: rand(0, TAU), id: "starter-bush-a" },
    { type: "tree", x: 235, y: 105, r: 30, hp: 3, maxHp: 3, sway: rand(0, TAU), id: "starter-tree-a" },
    { type: "rock", x: -210, y: 160, r: 24, hp: 3, maxHp: 3, rot: rand(0, TAU), id: "starter-rock-a" },
  ].forEach((r) => resources.push(r));
  [
    { type: "raptor", x: 1040, y: 650 },
    { type: "raptor", x: -1080, y: -720 },
    { type: "raptor", x: 320, y: -1080 },
    { type: "trike", x: -760, y: 640 },
    { type: "trike", x: 860, y: -650 },
    { type: "stego", x: -1020, y: 280 },
  ].forEach(spawnDino);
  buildings.push({ type: "campfire", x: 70, y: 70, hp: 100, built: true });
  buildings.push({ type: "hut", x: -80, y: 65, hp: 140, built: true });
}

function isValidLandPoint(x, y, options = {}) {
  if (Math.hypot(x, y) > WORLD * 0.45) return false;
  if (options.avoidCamp && Math.hypot(x, y) < SAFE_RADIUS) return false;
  if (options.avoidWater && LAKES.some((lake) => inEllipse(x, y, lake, 42))) return false;
  return true;
}

function inEllipse(x, y, lake, margin = 0) {
  const cos = Math.cos(-lake.rot);
  const sin = Math.sin(-lake.rot);
  const dx = x - lake.x;
  const dy = y - lake.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return (lx * lx) / ((lake.rx + margin) ** 2) + (ly * ly) / ((lake.ry + margin) ** 2) < 1;
}

function spawnDino(d) {
  const stats = {
    raptor: { hp: 46, r: 24, speed: 82, damage: 7, aggro: 230, color: "#9c6c3d" },
    trike: { hp: 90, r: 34, speed: 55, damage: 14, aggro: 95, color: "#66794a" },
    stego: { hp: 115, r: 38, speed: 44, damage: 16, aggro: 80, color: "#546e62" },
  }[d.type];
  dinos.push({ ...d, ...stats, maxHp: stats.hp, vx: 0, vy: 0, dir: rand(0, TAU), state: "wander", target: randomLandPoint(), atk: 0, hurt: 0 });
}

function randomLandPoint() {
  for (let i = 0; i < 80; i += 1) {
    const a = rand(0, TAU);
    const r = rand(320, 1050);
    const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    if (isValidLandPoint(p.x, p.y, { avoidCamp: true, avoidWater: true })) return p;
  }
  return { x: 800, y: 600 };
}

function resizeCanvas() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startGame() {
  startScreen.classList.remove("active");
  gameScreen.classList.remove("hidden");
  loadSave();
  if (Math.hypot(player.x, player.y) > 420) {
    player.x = 0;
    player.y = 0;
  }
  if (player.hp < 70) {
    player.hp = 100;
    player.hunger = Math.max(player.hunger, 90);
    player.thirst = Math.max(player.thirst, 90);
  }
  graceTimer = START_SAFE_TIME;
  started = true;
  resizeCanvas();
  showToast("2D 极致版：活下去，建营地，猎恐龙。");
  log("你醒在原始岛中央。采集、饮水、制作，天黑前点起火。");
}

function update(dt) {
  time += dt;
  weatherTimer -= dt;
  if (weatherTimer <= 0) {
    weather = Math.random() < 0.45 ? "rain" : Math.random() < 0.2 ? "fog" : "clear";
    weatherTimer = rand(28, 55);
    log(weather === "rain" ? "热带雨云压过来了。" : weather === "fog" ? "雾气从林间漫起。" : "天空放晴了。");
  }
  rainPower = lerp(rainPower, weather === "rain" ? 1 : 0, 1 - Math.pow(0.02, dt));
  attackTimer = Math.max(0, attackTimer - dt);
  gatherTimer = Math.max(0, gatherTimer - dt);
  graceTimer = Math.max(0, graceTimer - dt);
  cameraShake = Math.max(0, cameraShake - dt * 18);

  updatePlayer(dt);
  updateDinos(dt);
  updateParticles(dt);
  updateNeeds(dt);
  updateCamera(dt);
  updateHud();
}

function updatePlayer(dt) {
  const kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const ky = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  let mx = joystick.x || kx;
  let my = joystick.y || ky;
  const len = Math.hypot(mx, my);
  const sprint = keys.has("ShiftLeft") && player.stamina > 4 && len > 0.1;
  if (len > 0.1) {
    mx /= len; my /= len;
    const speed = sprint ? 210 : 135;
    player.x += mx * speed * dt;
    player.y += my * speed * dt;
    player.dir = Math.atan2(my, mx);
    player.stamina = clamp(player.stamina - (sprint ? 18 : 4) * dt, 0, 100);
    if (Math.random() < 10 * dt) dust(player.x - mx * 10, player.y - my * 10, 1);
  } else {
    player.stamina = clamp(player.stamina + 13 * dt, 0, 100);
  }
  const islandR = WORLD * 0.46;
  const d = Math.hypot(player.x, player.y);
  if (d > islandR) {
    player.x *= islandR / d;
    player.y *= islandR / d;
    showToast("海浪太急，别离岛太远。");
  }
}

function updateDinos(dt) {
  dinos.forEach((d) => {
    d.atk = Math.max(0, d.atk - dt);
    d.hurt = Math.max(0, d.hurt - dt);
    const pd = Math.hypot(player.x - d.x, player.y - d.y);
    let tx = d.target.x;
    let ty = d.target.y;
    let speed = d.speed;
    if (graceTimer > 0 && pd < 620) {
      const away = Math.atan2(d.y - player.y, d.x - player.x);
      d.x += Math.cos(away) * Math.max(speed, 120) * dt;
      d.y += Math.sin(away) * Math.max(speed, 120) * dt;
      d.target = randomLandPoint();
      return;
    }
    if (d.type === "raptor" && pd < d.aggro && graceTimer <= 0) {
      d.state = "hunt";
      tx = player.x; ty = player.y; speed *= 1.18;
    } else if (d.type !== "raptor" && pd < d.aggro) {
      d.state = "flee";
      tx = d.x - (player.x - d.x); ty = d.y - (player.y - d.y); speed *= 1.35;
    } else if (Math.hypot(d.target.x - d.x, d.target.y - d.y) < 30) {
      d.target = randomLandPoint();
      d.state = "wander";
    }
    const a = Math.atan2(ty - d.y, tx - d.x);
    d.dir = lerpAngle(d.dir, a, 1 - Math.pow(0.03, dt));
    d.x += Math.cos(d.dir) * speed * dt;
    d.y += Math.sin(d.dir) * speed * dt;
    const edge = Math.hypot(d.x, d.y);
    if (edge > WORLD * 0.45) {
      d.x *= (WORLD * 0.45) / edge;
      d.y *= (WORLD * 0.45) / edge;
      d.target = randomLandPoint();
    }
    if (pd < d.r + player.r + 4 && d.atk <= 0 && graceTimer <= 0) {
      d.atk = d.type === "raptor" ? 0.9 : 1.5;
      player.hp = clamp(player.hp - d.damage, 0, 100);
      cameraShake = 8;
      blood(player.x, player.y, 8);
      log(`${dinoName(d.type)}伤到了你。`);
    }
  });
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  return a + d * t;
}

function updateNeeds(dt) {
  player.hunger = clamp(player.hunger - dt * 0.55, 0, 100);
  player.thirst = clamp(player.thirst - dt * (weather === "rain" ? 0.28 : 0.82), 0, 100);
  if (player.hunger <= 0 || player.thirst <= 0) player.hp = clamp(player.hp - dt * 3.2, 0, 100);
  if (player.hp <= 0) {
    player.hp = 100; player.stamina = 100; player.hunger = 70; player.thirst = 70; player.x = 0; player.y = 0;
    log("你昏迷后被潮水冲回营地，丢失了一些材料。");
    player.inv.wood = Math.floor(player.inv.wood * 0.7);
    player.inv.stone = Math.floor(player.inv.stone * 0.7);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.02, dt);
    p.vy *= Math.pow(0.02, dt);
    p.size += (p.grow || 0) * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i -= 1) {
    const f = floaters[i];
    f.life -= dt; f.y -= 30 * dt;
    if (f.life <= 0) floaters.splice(i, 1);
  }
  buildings.filter((b) => b.type === "campfire").forEach((b) => {
    if (Math.random() < 16 * dt) {
      particles.push({ img: "flame", x: b.x + rand(-8, 8), y: b.y + rand(-8, 6), vx: rand(-6, 6), vy: rand(-30, -12), life: rand(0.4, 0.9), max: 0.9, size: rand(18, 36), grow: 8, color: "#ff9b38" });
      particles.push({ img: "smoke", x: b.x + rand(-6, 6), y: b.y - 12, vx: rand(-12, 12), vy: rand(-28, -10), life: rand(0.8, 1.8), max: 1.8, size: rand(18, 38), grow: 16, color: "#6d6a62" });
    }
  });
  if (rainPower > 0.05) {
    for (let i = 0; i < 60 * rainPower * dt; i += 1) {
      particles.push({ type: "rain", x: camera.x + rand(-canvas.clientWidth * 0.7, canvas.clientWidth * 0.7), y: camera.y + rand(-canvas.clientHeight * 0.7, canvas.clientHeight * 0.7), vx: -230, vy: 640, life: 0.45, max: 0.45, size: 1 });
    }
  }
}

function updateCamera(dt) {
  camera.x = lerp(camera.x, player.x, 1 - Math.pow(0.001, dt));
  camera.y = lerp(camera.y, player.y, 1 - Math.pow(0.001, dt));
  camera.zoom = lerp(camera.zoom, keys.has("ShiftLeft") ? 0.92 : 1, 1 - Math.pow(0.01, dt));
}

function gather() {
  if (gatherTimer > 0) return;
  const target = nearest(resources, 70);
  if (!target) return showToast("靠近树、岩石或浆果丛再采集。");
  if (player.stamina < 8) return showToast("体力不足。");
  gatherTimer = 0.35;
  player.stamina -= 8;
  target.hp -= 1;
  slash(target.x, target.y, "#f7d28b");
  cameraShake = 3;
  const gain = target.type === "tree" ? { wood: 2, fiber: 1 } : target.type === "rock" ? { stone: 2 } : { berries: 2, fiber: 1 };
  Object.entries(gain).forEach(([k, v]) => player.inv[k] += v);
  player.quests.gather += Object.values(gain).reduce((a, b) => a + b, 0);
  floatText(target.x, target.y - 28, `+${Object.keys(gain).map(itemName).join(" +")}`, "#fff0a8");
  if (target.hp <= 0) {
    resources.splice(resources.indexOf(target), 1);
    burst(target.x, target.y, target.type === "rock" ? "#9aa2a8" : "#4e8d3f", 18);
  }
  gainXp(4);
}

function drinkOrEat() {
  if (LAKES.some((lake) => inEllipse(player.x, player.y, lake, 20)) || weather === "rain") {
    player.thirst = 100;
    showToast(weather === "rain" ? "雨水让你补充了水分。" : "喝下湖水，口渴恢复。");
    ripple(player.x, player.y);
    return;
  }
  if (player.inv.berries > 0) {
    player.inv.berries -= 1;
    player.hunger = clamp(player.hunger + 20, 0, 100);
    player.thirst = clamp(player.thirst + 8, 0, 100);
    showToast("吃下浆果，恢复饥饿。");
  } else showToast("没有浆果，去湖边或等下雨补水。");
}

function attack() {
  if (attackTimer > 0) return;
  if (player.stamina < 12) return showToast("体力不足，无法攻击。");
  attackTimer = 0.42;
  player.stamina -= 12;
  const range = player.inv.spear > 0 ? 78 : 48;
  const target = nearest(dinos, range);
  const sx = player.x + Math.cos(player.dir) * 36;
  const sy = player.y + Math.sin(player.dir) * 36;
  slash(sx, sy, "#d8f6ff");
  if (!target) {
    showToast("挥空了。");
    return;
  }
  const dmg = player.inv.spear > 0 ? 24 : 9;
  target.hp -= dmg;
  target.hurt = 0.18;
  cameraShake = 5;
  blood(target.x, target.y, 10);
  floatText(target.x, target.y - 30, `-${dmg}`, "#ffb0a2");
  if (target.hp <= 0) {
    dinos.splice(dinos.indexOf(target), 1);
    player.inv.meat += target.type === "raptor" ? 3 : 5;
    player.inv.hide += target.type === "raptor" ? 2 : 3;
    player.quests.hunt += 1;
    gainXp(target.type === "raptor" ? 40 : 28);
    burst(target.x, target.y, "#9b3329", 26);
    log(`击倒${dinoName(target.type)}，获得肉和兽皮。`);
  }
}

function craft(kind) {
  const r = recipes[kind];
  if (!r) return;
  if (!Object.entries(r.cost).every(([k, v]) => player.inv[k] >= v)) return showToast("材料不够。");
  Object.entries(r.cost).forEach(([k, v]) => player.inv[k] -= v);
  r.apply();
  player.quests.build += kind === "spear" ? 0 : 1;
  showToast(`${r.name} 完成。`);
  openCraft();
  saveGame();
}

function placeBuilding(type) {
  const x = player.x + Math.cos(player.dir) * 70;
  const y = player.y + Math.sin(player.dir) * 70;
  buildings.push({ type, x, y, hp: type === "hut" ? 160 : 100, built: true });
  burst(x, y, type === "campfire" ? "#ffb15c" : "#c3955b", 20);
}

function nearest(list, range) {
  let best = null; let bd = range;
  list.forEach((o) => {
    const d = Math.hypot(o.x - player.x, o.y - player.y) - (o.r || 0);
    if (d < bd) { bd = d; best = o; }
  });
  return best;
}

function gainXp(v) {
  player.xp += v;
  const need = 70 + player.level * 45;
  if (player.xp >= need) {
    player.xp -= need;
    player.level += 1;
    player.hp = 100;
    player.stamina = 100;
    showToast(`升级到 ${player.level} 级。`);
    burst(player.x, player.y, "#ffe58a", 42);
  }
}

function render() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const shakeX = rand(-cameraShake, cameraShake);
  const shakeY = rand(-cameraShake, cameraShake);
  ctx.save();
  ctx.translate(w / 2 + shakeX, h / 2 + shakeY);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  drawWorld();
  drawObjects();
  drawParticles(false);
  drawLightAndWeather(w, h);
  ctx.restore();
  drawScreenWeather(w, h);
  drawFloaters();
  drawMinimap(w, h);
}

function drawWorld() {
  const grd = ctx.createRadialGradient(0, 0, 60, 0, 0, WORLD * 0.5);
  grd.addColorStop(0, "#608d45");
  grd.addColorStop(0.55, "#47783b");
  grd.addColorStop(0.88, "#d7b878");
  grd.addColorStop(1, "#2779a9");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(0, 0, WORLD * 0.54, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#4f8744";
  for (let i = -1200; i <= 1200; i += 80) {
    for (let j = -1200; j <= 1200; j += 80) {
      const n = Math.sin(i * 0.013 + j * 0.007) + Math.cos(j * 0.017);
      if (n > 0.6) {
        ctx.globalAlpha = 0.11;
        ctx.fillRect(i, j, 55, 3);
      }
    }
  }
  ctx.globalAlpha = 1;
  LAKES.forEach(drawLake);
  decals.forEach(drawDecal);
}

function drawLake(lake) {
  const { x, y, rx, ry, rot } = lake;
  const water = ctx.createRadialGradient(x - rx * 0.2, y - ry * 0.2, 10, x, y, rx);
  water.addColorStop(0, "#57c7e8");
  water.addColorStop(0.65, "#2485c5");
  water.addColorStop(1, "#17618c");
  ctx.fillStyle = water;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(238,225,170,.75)";
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.ellipse(x + Math.sin(time + i) * rx * 0.45, y + Math.cos(time * 0.7 + i) * ry * 0.38, rx * 0.18, ry * 0.025, rot, 0, TAU);
    ctx.stroke();
  }
}

function drawDecal(d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.a + Math.sin(time + d.x) * 0.05);
  ctx.scale(d.s, d.s);
  if (d.type === "flower") {
    ctx.fillStyle = d.color;
    ctx.fillRect(-2, -2, 4, 4);
  } else {
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 4); ctx.lineTo(-4, -3); ctx.moveTo(0, 4); ctx.lineTo(4, -4); ctx.stroke();
  }
  ctx.restore();
}

function drawObjects() {
  const visibleDinos = graceTimer > 0
    ? dinos.filter((d) => Math.hypot(d.x - player.x, d.y - player.y) > 780)
    : dinos;
  const drawables = [...resources, ...buildings, ...visibleDinos, player].sort((a, b) => (a.y + (a.r || 0)) - (b.y + (b.r || 0)));
  drawables.forEach((o) => {
    if (o === player) drawPlayer();
    else if (o.hp !== undefined && o.type && ["raptor", "trike", "stego"].includes(o.type)) drawDino(o);
    else if (o.built) drawBuilding(o);
    else drawResource(o);
  });
}

function drawResource(o) {
  ctx.save();
  ctx.translate(o.x, o.y);
  drawShadow(0, 10, o.r * 1.15, o.r * 0.38);
  if (o.type === "tree") {
    const sway = Math.sin(time * 1.8 + o.sway) * 0.07;
    ctx.rotate(sway);
    ctx.fillStyle = "#76512f"; roundedRect(-7, -5, 14, 34, 5, true);
    ["#2f6d35", "#3c8c43", "#74a94e"].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc((i - 1) * 13, -16 - i * 5, o.r * (0.62 - i * 0.06), 0, TAU);
      ctx.fill();
    });
  } else if (o.type === "rock") {
    ctx.rotate(o.rot);
    ctx.fillStyle = "#687078"; polyBlob(o.r, 8);
    ctx.fillStyle = "rgba(255,255,255,.18)"; polyBlob(o.r * 0.45, 5, -5, -5);
  } else {
    ctx.fillStyle = "#356f35"; polyBlob(o.r, 9);
    ctx.fillStyle = "#d35270";
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath(); ctx.arc(Math.cos(i) * o.r * 0.45, Math.sin(i * 2) * o.r * 0.36, 3, 0, TAU); ctx.fill();
    }
  }
  if (o.hp < o.maxHp) drawBar(-o.r, -o.r - 16, o.r * 2, 4, o.hp / o.maxHp, "#ffe27a");
  ctx.restore();
}

function drawDino(d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.dir);
  drawShadow(0, 12, d.r * 1.45, d.r * 0.48);
  ctx.fillStyle = d.hurt > 0 ? "#ffccc1" : d.color;
  roundedRect(-d.r * 0.9, -d.r * 0.45, d.r * 1.7, d.r * 0.9, d.r * 0.35, true);
  ctx.fillStyle = shade(d.color, 22);
  roundedRect(d.r * 0.35, -d.r * 0.35, d.r * 0.85, d.r * 0.7, d.r * 0.2, true);
  ctx.fillStyle = shade(d.color, -18);
  ctx.beginPath(); ctx.moveTo(-d.r * 0.8, 0); ctx.lineTo(-d.r * 1.7, -d.r * 0.28); ctx.lineTo(-d.r * 1.25, d.r * 0.18); ctx.fill();
  if (d.type === "trike") {
    ctx.fillStyle = "#e9ddbd";
    ctx.beginPath(); ctx.moveTo(d.r * 1.15, -8); ctx.lineTo(d.r * 1.65, -18); ctx.lineTo(d.r * 1.2, -2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(d.r * 1.15, 8); ctx.lineTo(d.r * 1.65, 18); ctx.lineTo(d.r * 1.2, 2); ctx.fill();
  }
  if (d.type === "stego") {
    ctx.fillStyle = "#b47d55";
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath(); ctx.moveTo(i * 14, -d.r * 0.42); ctx.lineTo(i * 14 + 7, -d.r * 0.95); ctx.lineTo(i * 14 + 15, -d.r * 0.42); ctx.fill();
    }
  }
  ctx.fillStyle = "#130f0b";
  ctx.beginPath(); ctx.arc(d.r * 0.92, -5, 2.2, 0, TAU); ctx.fill();
  ctx.restore();
  if (d.hp < d.maxHp) drawBar(d.x - d.r, d.y - d.r - 18, d.r * 2, 5, d.hp / d.maxHp, "#ff6b5c");
}

function drawBuilding(b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  drawShadow(0, 12, 40, 16);
  if (b.type === "campfire") {
    ctx.fillStyle = "#605548";
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill();
    ctx.fillStyle = "#8b5a31"; ctx.fillRect(-18, -4, 36, 8); ctx.rotate(Math.PI / 2); ctx.fillRect(-18, -4, 36, 8);
    const img = images.flame;
    if (img.complete) ctx.drawImage(img, -23, -45, 46, 52);
  } else if (b.type === "hut") {
    ctx.fillStyle = "#8b6236"; roundedRect(-42, -28, 84, 64, 10, true);
    ctx.fillStyle = "#d0a15c"; ctx.beginPath(); ctx.moveTo(-54, -22); ctx.lineTo(0, -62); ctx.lineTo(54, -22); ctx.fill();
    ctx.fillStyle = "#3c281c"; roundedRect(-10, 8, 20, 28, 5, true);
  } else {
    ctx.fillStyle = "#7c522e"; roundedRect(-30, -14, 60, 28, 6, true);
    ctx.strokeStyle = "#d0a15c"; ctx.lineWidth = 3; ctx.strokeRect(-27, -11, 54, 22);
  }
  ctx.restore();
}

function drawPlayer() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.dir);
  drawShadow(0, 12, 20, 9);
  ctx.fillStyle = "#273d31"; roundedRect(-12, -13, 28, 26, 10, true);
  ctx.fillStyle = "#d8a66a"; ctx.beginPath(); ctx.arc(12, 0, 10, 0, TAU); ctx.fill();
  ctx.fillStyle = "#704627"; ctx.beginPath(); ctx.arc(15, -4, 3, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#d7d2bf"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(38, 20); ctx.stroke();
  ctx.restore();
}

function drawParticles(screenOnly) {
  particles.forEach((p) => {
    if (screenOnly !== !!p.screen) return;
    const a = clamp(p.life / (p.max || 1), 0, 1);
    ctx.save();
    ctx.globalAlpha = a * (p.alpha || 1);
    if (p.type === "rain") {
      ctx.strokeStyle = "rgba(180,220,255,.6)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 10, p.y + 28); ctx.stroke();
    } else if (p.img && images[p.img]?.complete) {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot || 0);
      ctx.drawImage(images[p.img], -p.size / 2, -p.size / 2, p.size, p.size);
    } else {
      ctx.fillStyle = p.color || "#fff";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.restore();
  });
}

function drawLightAndWeather(w, h) {
  const day = (Math.sin(time * 0.025) + 1) / 2;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgba(11,20,38,${0.18 + (1 - day) * 0.44})`;
  ctx.fillRect(camera.x - w, camera.y - h, w * 2, h * 2);
  ctx.restore();
  buildings.filter((b) => b.type === "campfire").forEach((b) => radialLight(b.x, b.y, 170, "rgba(255,153,58,.34)"));
  radialLight(player.x, player.y, 105, "rgba(255,232,168,.13)");
}

function drawScreenWeather(w, h) {
  if (weather === "fog") {
    ctx.fillStyle = "rgba(210,225,210,.12)";
    for (let i = 0; i < 8; i += 1) {
      ctx.fillRect(((time * 28 + i * 210) % (w + 260)) - 260, i * h / 8, 260, 44);
    }
  }
  if (rainPower > 0.05) {
    ctx.fillStyle = `rgba(40,70,90,${rainPower * 0.16})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawFloaters() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  floaters.forEach((f) => {
    const sx = (f.x - camera.x) * camera.zoom + w / 2;
    const sy = (f.y - camera.y) * camera.zoom + h / 2;
    ctx.globalAlpha = clamp(f.life, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = "700 14px system-ui";
    ctx.fillText(f.text, sx, sy);
    ctx.globalAlpha = 1;
  });
}

function drawMinimap(w, h) {
  const x = w - 132, y = h - 132, s = 108;
  ctx.save();
  ctx.globalAlpha = 0.86;
  ctx.fillStyle = "rgba(10,20,18,.65)";
  roundedRect(x, y, s, s, 18, true);
  ctx.strokeStyle = "rgba(255,255,255,.16)";
  ctx.stroke();
  ctx.translate(x + s / 2, y + s / 2);
  const scale = s / (WORLD * 1.05);
  ctx.fillStyle = "#6ea052"; ctx.beginPath(); ctx.arc(0, 0, WORLD * 0.46 * scale, 0, TAU); ctx.fill();
  ctx.fillStyle = "#308cc8"; ctx.beginPath(); ctx.ellipse(-330 * scale, -150 * scale, 185 * scale, 128 * scale, -0.15, 0, TAU); ctx.fill();
  dinos.forEach((d) => { ctx.fillStyle = d.type === "raptor" ? "#ff6b5c" : "#ffe08a"; ctx.fillRect(d.x * scale - 1.5, d.y * scale - 1.5, 3, 3); });
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(player.x * scale, player.y * scale, 3, 0, TAU); ctx.fill();
  ctx.restore();
}

function radialLight(x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawShadow(x, y, rx, ry) {
  ctx.fillStyle = "rgba(0,0,0,.24)";
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
}

function drawBar(x, y, w, h, p, color) {
  ctx.fillStyle = "rgba(0,0,0,.5)"; roundedRect(x, y, w, h, h / 2, true);
  ctx.fillStyle = color; roundedRect(x, y, w * clamp(p, 0, 1), h, h / 2, true);
}

function roundedRect(x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) ctx.fill(); else ctx.stroke();
}

function polyBlob(r, n, ox = 0, oy = 0) {
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const a = i / n * TAU;
    const rr = r * (0.75 + Math.sin(i * 5.13) * 0.18);
    const x = ox + Math.cos(a) * rr;
    const y = oy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const a = rand(0, TAU), s = rand(45, 180);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.35, 0.9), max: 0.9, size: rand(2, 6), grow: -2, color });
  }
}

function dust(x, y, count) {
  for (let i = 0; i < count; i += 1) particles.push({ x: x + rand(-8, 8), y: y + rand(-8, 8), vx: rand(-18, 18), vy: rand(-18, 18), life: 0.5, max: 0.5, size: rand(4, 9), grow: 8, color: "#cbb17b", alpha: 0.45 });
}

function slash(x, y, color) {
  particles.push({ img: "slash", x, y, vx: 0, vy: 0, life: 0.18, max: 0.18, size: 74, rot: player.dir, color });
}

function blood(x, y, count) {
  burst(x, y, "#9d2b25", count);
}

function ripple(x, y) {
  for (let i = 0; i < 12; i += 1) particles.push({ x: x + rand(-15, 15), y: y + rand(-15, 15), vx: rand(-20, 20), vy: rand(-20, 20), life: 0.8, max: 0.8, size: rand(3, 8), grow: 12, color: "#9ee8ff", alpha: 0.45 });
}

function floatText(x, y, text, color) {
  floaters.push({ x, y, text, color, life: 1 });
}

function openBag() {
  ui.panelTitle.textContent = "背包";
  ui.panelBody.innerHTML = `<div class="bag-list">${Object.entries(player.inv).map(([k, v]) => `<div class="bag-row"><span>${itemName(k)}</span><strong>×${v}</strong></div>`).join("")}</div>`;
  ui.panel.classList.remove("hidden");
}

function openCraft() {
  ui.panelTitle.textContent = "制作";
  ui.panelBody.innerHTML = Object.entries(recipes).map(([k, r]) => {
    const cost = Object.entries(r.cost).map(([ck, v]) => `${v}${itemName(ck)}`).join(" + ");
    return `<div class="quest-row"><strong>${r.name}</strong><p>${cost}</p><button class="panel-action" data-craft="${k}">制作</button></div>`;
  }).join("");
  ui.panel.classList.remove("hidden");
}

function openTasks() {
  ui.panelTitle.textContent = "生存目标";
  ui.panelBody.innerHTML = tasks.map((t) => `<div class="quest-row"><strong>${t.name}</strong><p>${t.text}</p><div class="progress"><span style="width:${clamp(player.quests[t.id] / t.goal, 0, 1) * 100}%"></span></div><em>${Math.min(player.quests[t.id], t.goal)}/${t.goal}</em></div>`).join("");
  ui.panel.classList.remove("hidden");
}

function updateHud() {
  ui.hp.textContent = Math.round(player.hp);
  ui.level.textContent = player.level;
  ui.stamina.textContent = Math.round(player.stamina);
  ui.needs.textContent = `${Math.round(player.hunger)}/${Math.round(player.thirst)}`;
  const threat = dinos.filter((d) => d.type === "raptor").reduce((m, d) => Math.min(m, Math.hypot(d.x - player.x, d.y - player.y)), 9999);
  ui.threat.textContent = graceTimer > 0 ? "保护" : threat < 160 ? "高" : threat < 340 ? "中" : "低";
  ui.sync.textContent = `木${player.inv.wood} 石${player.inv.stone} 浆${player.inv.berries}`;
}

function itemName(k) {
  return { wood: "木材", stone: "石头", fiber: "纤维", berries: "浆果", meat: "生肉", hide: "兽皮", spear: "骨矛" }[k] || k;
}

function dinoName(t) {
  return { raptor: "迅爪龙", trike: "角盾兽", stego: "剑背龙" }[t] || "恐龙";
}

function log(text) {
  logs.unshift({ text, t: Date.now() });
  logs.splice(24);
  ui.chatMessages.innerHTML = logs.map((l) => `<div class="chat-line">${l.text}</div>`).join("");
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2000);
}

function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ player, buildings, logs: logs.slice(0, 12) }));
  showToast("已保存。");
}

function loadSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    if (!raw?.player) return;
    Object.assign(player, raw.player);
    buildings.splice(0, buildings.length, ...(raw.buildings || buildings));
    logs.splice(0, logs.length, ...(raw.logs || []));
  } catch {}
}

function bindEvents() {
  $("#startGame").addEventListener("click", startGame);
  $("#openBackend").addEventListener("click", () => showToast("2D 极致版为本地单机原型，不需要后端。"));
  $("#closeBackend")?.addEventListener("click", () => $("#backendPanel").classList.add("hidden"));
  $("#saveBackend")?.addEventListener("click", () => $("#backendPanel").classList.add("hidden"));
  $("#plantBtn").addEventListener("click", gather);
  $("#waterBtn").addEventListener("click", drinkOrEat);
  $("#harvestBtn").addEventListener("click", attack);
  $("#shopBtn").addEventListener("click", () => openCraft());
  $("#bagBtn").addEventListener("click", openBag);
  $("#questBtn").addEventListener("click", openTasks);
  $("#sleepBtn").addEventListener("click", () => { player.hp = clamp(player.hp + 25, 0, 100); player.stamina = 100; player.hunger -= 6; player.thirst -= 6; showToast("在营火旁休息了一会。"); });
  $("#chatToggle").addEventListener("click", () => ui.chatPanel.classList.toggle("hidden"));
  $("#closeChat").addEventListener("click", () => ui.chatPanel.classList.add("hidden"));
  $("#syncNow").addEventListener("click", saveGame);
  $("#panelClose").addEventListener("click", () => ui.panel.classList.add("hidden"));
  ui.panelBody.addEventListener("click", (e) => {
    const kind = e.target.closest("[data-craft]")?.dataset.craft;
    if (kind) craft(kind);
  });
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = ui.chatInput.value.trim();
    if (t) log(`笔记：${t}`);
    ui.chatInput.value = "";
  });
  $("#toolToggle").addEventListener("click", () => {
    $("#controlsPanel").classList.toggle("collapsed");
    $("#cropBar").classList.toggle("collapsed");
  });
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyE") gather();
    if (e.code === "KeyQ") drinkOrEat();
    if (e.code === "KeyF") attack();
    if (e.code === "KeyB") openCraft();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("resize", resizeCanvas);
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    pointerAim.x = (e.clientX - rect.left - rect.width / 2) / camera.zoom + camera.x;
    pointerAim.y = (e.clientY - rect.top - rect.height / 2) / camera.zoom + camera.y;
    player.dir = Math.atan2(pointerAim.y - player.y, pointerAim.x - player.x);
  });
  canvas.addEventListener("click", attack);
  bindJoystick();
}

function bindJoystick() {
  const base = $("#joystick");
  const stick = $("#joystickStick");
  let active = false;
  const reset = () => { active = false; joystick = { x: 0, y: 0 }; stick.style.transform = "translate(-50%, -50%)"; };
  const move = (e) => {
    if (!active) return;
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width * 0.28;
    const x = clamp(e.clientX - cx, -max, max), y = clamp(e.clientY - cy, -max, max);
    joystick = { x: x / max, y: y / max };
    stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  };
  base.addEventListener("pointerdown", (e) => { active = true; base.setPointerCapture?.(e.pointerId); move(e); });
  base.addEventListener("pointermove", move);
  base.addEventListener("pointerup", reset);
  base.addEventListener("pointercancel", reset);
}

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (started) update(dt);
  render();
  requestAnimationFrame(loop);
}

initWorld();
resizeCanvas();
bindEvents();
requestAnimationFrame(loop);
