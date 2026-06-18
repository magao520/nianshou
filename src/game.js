const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
const BASE_WIDTH = 960;
const BASE_HEIGHT = 540;
const WORLD_WIDTH = 2600;
const WORLD_HEIGHT = 1500;

const $ = (selector) => document.querySelector(selector);
const startScreen = $("#startScreen");
const gameScreen = $("#gameScreen");
const backendPanel = $("#backendPanel");
const toastEl = $("#toast");

const ui = {
  coin: $("#coinText"),
  level: $("#levelText"),
  water: $("#waterText"),
  room: $("#roomText"),
  sync: $("#syncStatus"),
  cropBar: $("#cropBar"),
  chatPanel: $("#chatPanel"),
  chatMessages: $("#chatMessages"),
  chatInput: $("#chatInput"),
};

const crops = [
  { id: "radish", name: "樱桃萝卜", icon: "🌱", matureIcon: "🥕", cost: 4, value: 12, grow: 14, xp: 4, water: 8, color: "#ff6b88" },
  { id: "tomato", name: "星光番茄", icon: "🌿", matureIcon: "🍅", cost: 8, value: 25, grow: 24, xp: 8, water: 10, color: "#ff6b3d" },
  { id: "pumpkin", name: "月亮南瓜", icon: "🍃", matureIcon: "🎃", cost: 16, value: 48, grow: 38, xp: 14, water: 13, color: "#ffb347" },
  { id: "corn", name: "金穗玉米", icon: "🌾", matureIcon: "🌽", cost: 22, value: 64, grow: 46, xp: 20, water: 15, color: "#ffd166" },
];

const buildings = [
  { id: "home", name: "玩家小屋", type: "home", x: 300, y: 300, w: 210, h: 150 },
  { id: "market", name: "集市小站", type: "market", x: 760, y: 260, w: 240, h: 145 },
  { id: "greenhouse", name: "星光温室", type: "greenhouse", x: 1460, y: 330, w: 300, h: 165 },
  { id: "mill", name: "风车仓库", type: "mill", x: 2050, y: 420, w: 230, h: 180 },
  { id: "pond", name: "月亮池塘", type: "pond", x: 1160, y: 980, w: 300, h: 155 },
];

const bg = new Image();
bg.src = "./assets/verdant-terraces-bg.jpg";

const savedBackend = JSON.parse(localStorage.getItem("cloudFarmBackend") || "{}");
const now = () => Date.now();

let selectedCrop = crops[0].id;
let lastTime = performance.now();
let syncTimer = 0;
let toastTimer = 0;
let lastChatSignature = "";
let input = { left: false, right: false, up: false, down: false };
let game = createInitialState();

function createInitialState() {
  return {
    version: 2,
    room: "PUBLIC-FARM",
    updatedAt: now(),
    dayTime: 0.18,
    coins: 60,
    xp: 0,
    level: 1,
    water: 100,
    expansion: 0,
    player: {
      id: getClientId(),
      name: "菜园主",
      x: 430,
      y: 520,
      facing: 1,
      color: randomPlayerColor(),
      lastSeen: now(),
    },
    visitors: {},
    plots: createMapPlots(),
    chat: [],
    log: [],
  };
}

function createMapPlots() {
  const clusters = [
    { x: 520, y: 620, rows: 3, cols: 5 },
    { x: 1160, y: 650, rows: 3, cols: 5 },
    { x: 1770, y: 720, rows: 3, cols: 5 },
    { x: 760, y: 1110, rows: 2, cols: 6 },
    { x: 1570, y: 1160, rows: 2, cols: 6 },
  ];
  const plots = [];
  clusters.forEach((cluster, clusterIndex) => {
    for (let row = 0; row < cluster.rows; row += 1) {
      for (let col = 0; col < cluster.cols; col += 1) {
        plots.push(makePlot(plots.length, cluster.x + col * 112, cluster.y + row * 78, clusterIndex));
      }
    }
  });
  return plots;
}

function makePlot(i, x = 230 + i * 170, y = 422 + (i % 2) * 8, cluster = 0) {
  return {
    id: `plot-${i}`,
    x,
    y,
    cluster,
    locked: i >= 12,
    crop: null,
    plantedAt: 0,
    wateredAt: 0,
    moisture: 0,
    fertility: 0.8 + ((i * 17) % 35) / 100,
    harvests: 0,
  };
}

function getClientId() {
  let id = localStorage.getItem("cloudFarmClientId");
  if (!id) {
    id = `p-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("cloudFarmClientId", id);
  }
  return id;
}

function randomPlayerColor() {
  const colors = ["#55d37b", "#6fd3ff", "#ffd166", "#ff8fb7", "#c6a7ff"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function showToast(message, tone = "normal") {
  toastEl.textContent = message;
  toastEl.style.border = tone === "bad" ? "1px solid rgba(255,107,107,.55)" : "1px solid rgba(255,255,255,.18)";
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

function saveLocal() {
  localStorage.setItem(`cloudFarm:${game.room}`, JSON.stringify(game));
}

function loadLocal(room) {
  const raw = localStorage.getItem(`cloudFarm:${room}`);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return normalizeState(data);
  } catch {
    return null;
  }
}

function normalizeState(data) {
  const base = createInitialState();
  return {
    ...base,
    ...data,
    player: { ...base.player, ...(data.player || {}), id: getClientId(), lastSeen: now() },
    visitors: data.visitors || {},
    chat: Array.isArray(data.chat) ? data.chat.slice(-60) : [],
    plots: normalizePlots(data.plots, base.plots),
  };
}

function normalizePlots(savedPlots, basePlots) {
  const saved = new Map((savedPlots || []).map((plot) => [plot.id, plot]));
  return basePlots.map((base, i) => ({ ...base, ...(saved.get(base.id) || savedPlots?.[i] || {}) }));
}

function levelFromXp(xp) {
  return Math.max(1, Math.floor(Math.sqrt(xp / 18)) + 1);
}

function cropById(id) {
  return crops.find((crop) => crop.id === id) || crops[0];
}

function getNearestPlot() {
  return game.plots
    .filter((plot) => !plot.locked)
    .map((plot) => ({ plot, dist: Math.hypot(plot.x - game.player.x, plot.y - game.player.y) }))
    .sort((a, b) => a.dist - b.dist)[0];
}

function getCropProgress(plot) {
  if (!plot.crop) return 0;
  const crop = cropById(plot.crop);
  const moistureBoost = 0.72 + clamp(plot.moisture || 0, 0, 100) / 100 * 0.55;
  const fertilityBoost = clamp(plot.fertility || 1, 0.75, 1.35);
  return clamp(((now() - plot.plantedAt) / 1000 / crop.grow) * moistureBoost * fertilityBoost, 0, 1);
}

function plant() {
  const target = getNearestPlot();
  if (!target || target.dist > 92) return showToast("靠近一块空地再播种", "bad");
  const plot = target.plot;
  if (plot.crop) return showToast("这块地已经种下作物了", "bad");
  const crop = cropById(selectedCrop);
  if (game.coins < crop.cost) return showToast(`金币不足，需要 ${crop.cost}`, "bad");
  game.coins -= crop.cost;
  plot.crop = crop.id;
  plot.plantedAt = now();
  plot.wateredAt = 0;
  plot.moisture = Math.max(plot.moisture || 0, 28);
  addLog(`${game.player.name} 种下了 ${crop.name}`);
  saveLocal();
}

function water() {
  const target = getNearestPlot();
  if (!target || target.dist > 96) return showToast("靠近作物再浇水", "bad");
  const plot = target.plot;
  if (!plot.crop) return showToast("这块地还没有作物", "bad");
  const cost = cropById(plot.crop).water;
  if (game.water < cost) return showToast(`水量不足，需要 ${cost}`, "bad");
  game.water -= cost;
  plot.wateredAt = now();
  plot.moisture = clamp((plot.moisture || 0) + 45, 0, 100);
  plot.fertility = clamp((plot.fertility || 1) + 0.015, 0.75, 1.35);
  addLog(`${game.player.name} 给作物浇了水`);
  saveLocal();
}

function harvest() {
  const target = getNearestPlot();
  if (!target || target.dist > 96) return showToast("靠近成熟作物再收获", "bad");
  const plot = target.plot;
  if (!plot.crop) return showToast("这里还没有可收获的作物", "bad");
  const progress = getCropProgress(plot);
  if (progress < 1) return showToast(`还需要 ${Math.ceil((1 - progress) * cropById(plot.crop).grow)} 秒成熟`, "bad");
  const crop = cropById(plot.crop);
  const combo = 1 + Math.min(0.4, plot.harvests * 0.04);
  const gain = Math.round(crop.value * combo);
  game.coins += gain;
  game.xp += crop.xp;
  game.level = levelFromXp(game.xp);
  plot.crop = null;
  plot.harvests += 1;
  plot.moisture = clamp((plot.moisture || 0) - 20, 0, 100);
  plot.fertility = clamp((plot.fertility || 1) - 0.025, 0.75, 1.35);
  addLog(`${game.player.name} 收获 ${crop.name}，获得 ${gain} 金币`);
  showToast(`收获成功 +${gain} 金币`);
  saveLocal();
}

function expandFarm() {
  const locked = game.plots.find((plot) => plot.locked);
  if (!locked) return showToast("菜园已经全部解锁");
  const price = 55 + game.expansion * 18;
  if (game.coins < price) return showToast(`开垦新田需要 ${price} 金币`, "bad");
  game.coins -= price;
  game.expansion += 1;
  locked.locked = false;
  locked.fertility = 1.08;
  showToast("新田已开垦");
  addLog(`${game.player.name} 开垦了一块新田`);
  saveLocal();
}

function addLog(message) {
  game.log = [{ t: now(), message }, ...(game.log || [])].slice(0, 20);
}

function renderCropBar() {
  ui.cropBar.innerHTML = "";
  crops.forEach((crop) => {
    const button = document.createElement("button");
    button.className = `crop-choice ${selectedCrop === crop.id ? "active" : ""}`;
    button.innerHTML = `<span>${crop.matureIcon}</span><strong>${crop.name.replace("樱桃", "")}</strong><small>${crop.cost} 金</small>`;
    button.title = crop.name;
    button.addEventListener("click", () => {
      selectedCrop = crop.id;
      renderCropBar();
    });
    ui.cropBar.appendChild(button);
  });
}

function update(delta) {
  const movingX = Number(input.right) - Number(input.left);
  const movingY = Number(input.down) - Number(input.up);
  const length = Math.hypot(movingX, movingY) || 1;
  const speed = 245;
  if (input.left) {
    game.player.facing = -1;
  }
  if (input.right) {
    game.player.facing = 1;
  }
  game.player.x += (movingX / length) * speed * delta;
  game.player.y += (movingY / length) * speed * delta;
  game.player.x = clamp(game.player.x, 90, WORLD_WIDTH - 90);
  game.player.y = clamp(game.player.y, 170, WORLD_HEIGHT - 90);
  game.player.lastSeen = now();
  game.water = clamp(game.water + delta * 2.2, 0, 100);
  game.plots.forEach((plot) => {
    if (plot.crop) plot.moisture = clamp((plot.moisture || 0) - delta * 0.85, 0, 100);
  });
  game.dayTime = (game.dayTime + delta * 0.008) % 1;
  game.updatedAt = now();
  syncTimer += delta;
  if (syncTimer > 8) {
    syncTimer = 0;
    backgroundSync();
  }
}

function draw() {
  const width = canvas.width;
  const height = canvas.height;
  const camera = {
    x: clamp(game.player.x - width * 0.5, 0, Math.max(0, WORLD_WIDTH - width)),
    y: clamp(game.player.y - height * 0.55, 0, Math.max(0, WORLD_HEIGHT - height)),
  };

  ctx.clearRect(0, 0, width, height);
  drawBackground(camera);
  drawSunsetOverlay();
  drawGround(camera);
  drawBuildings(camera);
  drawPlots(camera);
  const players = [game.player, ...Object.values(game.visitors || {}).filter((p) => p.id !== game.player.id && now() - p.lastSeen < 45000)];
  players
    .sort((a, b) => a.y - b.y)
    .forEach((player) => drawPlayer(player, camera, player.id === game.player.id));
  drawPointer(camera);
  drawMiniMap(camera);
  drawLog();
  updateHud();
  renderChat();
}

function drawBackground(camera) {
  const parallax = camera.x * 0.08;
  if (bg.complete) {
    const scale = canvas.height / bg.height;
    const bgWidth = bg.width * scale;
    const x = -parallax % bgWidth;
    ctx.drawImage(bg, x - bgWidth, 0, bgWidth, canvas.height);
    ctx.drawImage(bg, x, 0, bgWidth, canvas.height);
    ctx.drawImage(bg, x + bgWidth, 0, bgWidth, canvas.height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#8ed6ff");
    gradient.addColorStop(0.55, "#ffe0a3");
    gradient.addColorStop(1, "#2f7d44");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawSunsetOverlay() {
  const night = Math.max(0, Math.sin(game.dayTime * Math.PI * 2 - 0.8));
  ctx.fillStyle = `rgba(9, 23, 44, ${night * 0.26})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawGround(camera) {
  const ground = ctx.createLinearGradient(0, 0, 0, canvas.height);
  ground.addColorStop(0, "rgba(118, 210, 122, 0.78)");
  ground.addColorStop(1, "#286b3c");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawRoad(camera, [
    [160, 520],
    [720, 520],
    [1040, 760],
    [1620, 780],
    [2380, 620],
  ]);
  drawRoad(camera, [
    [980, 180],
    [1080, 760],
    [990, 1260],
  ]);
  drawRoad(camera, [
    [200, 1180],
    [860, 1080],
    [1500, 1180],
    [2360, 1120],
  ]);

  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = 1;
  for (let x = -((camera.x * 0.45) % 90); x < canvas.width + 90; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 220, canvas.height);
    ctx.stroke();
  }
}

function drawRoad(camera, points) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(123, 83, 45, 0.62)";
  ctx.lineWidth = 58;
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const sx = x - camera.x;
    const sy = y - camera.y;
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 224, 148, 0.35)";
  ctx.lineWidth = 38;
  ctx.stroke();
  ctx.restore();
}

function drawBuildings(camera) {
  buildings
    .filter((building) => {
      const x = building.x - camera.x;
      const y = building.y - camera.y;
      return x > -building.w - 80 && x < canvas.width + 80 && y > -building.h - 120 && y < canvas.height + 120;
    })
    .sort((a, b) => a.y - b.y)
    .forEach((building) => drawBuilding(building, camera));
}

function drawBuilding(building, camera) {
  const x = building.x - camera.x;
  const y = building.y - camera.y;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,.2)";
  drawEllipse(building.w * 0.5, building.h + 20, building.w * 0.55, 24);
  ctx.fill();

  if (building.type === "pond") {
    const water = ctx.createRadialGradient(building.w * 0.5, building.h * 0.5, 30, building.w * 0.5, building.h * 0.5, building.w * 0.58);
    water.addColorStop(0, "#9ee8ff");
    water.addColorStop(1, "#3b9bd4");
    ctx.fillStyle = water;
    drawEllipse(building.w * 0.5, building.h * 0.5, building.w * 0.48, building.h * 0.38);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.45)";
    ctx.lineWidth = 5;
    ctx.stroke();
  } else if (building.type === "greenhouse") {
    ctx.fillStyle = "rgba(195, 245, 255, .64)";
    roundRect(18, 48, building.w - 36, building.h - 36, 32);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.72)";
    ctx.lineWidth = 6;
    ctx.stroke();
    for (let i = 45; i < building.w - 30; i += 44) {
      ctx.beginPath();
      ctx.moveTo(i, 54);
      ctx.lineTo(i + 18, building.h - 12);
      ctx.stroke();
    }
  } else if (building.type === "mill") {
    ctx.fillStyle = "#e8c58c";
    roundRect(55, 58, 110, 115, 18);
    ctx.fill();
    ctx.fillStyle = "#8d5134";
    ctx.beginPath();
    ctx.moveTo(42, 64);
    ctx.lineTo(110, 10);
    ctx.lineTo(178, 64);
    ctx.closePath();
    ctx.fill();
    drawWindmill(110, 64);
  } else {
    ctx.fillStyle = building.type === "market" ? "#ffd166" : "#fff3d4";
    roundRect(24, 54, building.w - 48, building.h - 42, 18);
    ctx.fill();
    ctx.fillStyle = building.type === "market" ? "#ff6b6b" : "#55d37b";
    ctx.beginPath();
    ctx.moveTo(12, 62);
    ctx.lineTo(building.w * 0.5, 10);
    ctx.lineTo(building.w - 12, 62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(35, 25, 20, .48)";
    roundRect(building.w * 0.5 - 24, building.h - 48, 48, 60, 8);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(10,24,19,.75)";
  roundRect(building.w * 0.5 - 56, building.h + 32, 112, 28, 14);
  ctx.fill();
  ctx.fillStyle = "#fff3d4";
  ctx.font = "800 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(building.name, building.w * 0.5, building.h + 51);
  ctx.restore();
}

function drawWindmill(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#fff3d4";
  ctx.lineWidth = 6;
  for (let i = 0; i < 4; i += 1) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -48);
    ctx.stroke();
  }
  ctx.fillStyle = "#8d5134";
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlots(camera) {
  game.plots.forEach((plot) => {
    const x = plot.x - camera.x;
    const y = plot.y - camera.y;
    if (x < -130 || x > canvas.width + 130 || y < -90 || y > canvas.height + 110) return;

    ctx.save();
    ctx.translate(x, y);
    const moisture = clamp(plot.moisture || 0, 0, 100) / 100;
    ctx.fillStyle = plot.locked ? "rgba(36,42,35,.72)" : `rgb(${116 - moisture * 22}, ${72 + moisture * 16}, ${38 + moisture * 10})`;
    ctx.strokeStyle = plot.locked ? "rgba(255,255,255,.18)" : "#d49758";
    ctx.lineWidth = 4;
    drawEllipse(0, 0, 48, 26);
    ctx.fill();
    ctx.stroke();

    if (plot.locked) {
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = "700 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("未开垦", 0, 5);
      ctx.restore();
      return;
    }

    ctx.fillStyle = `rgba(108, 211, 255, ${moisture * 0.22})`;
    drawEllipse(0, 0, 42, 20);
    ctx.fill();
    if (plot.crop) drawCrop(plot);
    ctx.restore();
  });
}

function drawCrop(plot) {
  const crop = cropById(plot.crop);
  const progress = getCropProgress(plot);
  const stem = 16 + progress * 40;

  ctx.strokeStyle = "#2f8f53";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.quadraticCurveTo(-8, -stem * 0.55, 0, -stem);
  ctx.stroke();

  ctx.fillStyle = crop.color;
  const size = 12 + progress * 22;
  ctx.beginPath();
  ctx.arc(0, -stem - 8, size, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,.34)";
  ctx.beginPath();
  ctx.arc(-size * 0.35, -stem - size * 1.1, size * 0.32, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,.86)";
  ctx.font = "900 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(progress >= 1 ? "可收获" : `${Math.round(progress * 100)}%`, 0, 46);
}

function drawPlayer(player, camera, isSelf) {
  const x = player.x - camera.x;
  const y = player.y - camera.y;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(player.facing || 1, 1);

  ctx.fillStyle = "rgba(0,0,0,.22)";
  drawEllipse(0, 18, 30, 9);
  ctx.fill();

  ctx.strokeStyle = "#2e2018";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.lineTo(-22, 18);
  ctx.moveTo(12, -5);
  ctx.lineTo(22, 18);
  ctx.stroke();

  ctx.fillStyle = player.color || "#55d37b";
  roundRect(-19, -39, 38, 50, 16);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.22)";
  roundRect(-12, -31, 24, 16, 8);
  ctx.fill();

  ctx.strokeStyle = "#ffe1b4";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-17, -25);
  ctx.lineTo(-34, -10);
  ctx.moveTo(17, -25);
  ctx.lineTo(32, -8);
  ctx.stroke();

  ctx.fillStyle = "#ffe1b4";
  ctx.beginPath();
  ctx.arc(0, -48, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#4b2d1c";
  ctx.beginPath();
  ctx.arc(0, -55, 18, Math.PI, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2d1d12";
  ctx.beginPath();
  ctx.arc(-7, -51, 2.2, 0, Math.PI * 2);
  ctx.arc(7, -51, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#2d1d12";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -45, 7, 0.1, Math.PI - 0.1);
  ctx.stroke();

  ctx.fillStyle = "#fff3d4";
  ctx.font = "800 13px sans-serif";
  ctx.textAlign = "center";
  ctx.scale(player.facing || 1, 1);
  ctx.fillText(isSelf ? `${player.name}（你）` : player.name, 0, -74);
  ctx.restore();
}

function drawPointer(camera) {
  const target = getNearestPlot();
  if (!target || target.dist > 108) return;
  const plot = target.plot;
  const x = plot.x - camera.x;
  const y = plot.y - camera.y;
  ctx.save();
  ctx.strokeStyle = "#fff3a7";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  drawEllipse(x, y, 62, 36);
  ctx.stroke();
  ctx.restore();
}

function drawLog() {
  const entries = (game.log || []).slice(0, 4);
  if (!entries.length) return;
  ctx.save();
  ctx.globalAlpha = 0.86;
  ctx.fillStyle = "rgba(8, 20, 15, .52)";
  roundRect(18, 126, 330, 88, 18);
  ctx.fill();
  ctx.fillStyle = "rgba(255,243,212,.86)";
  ctx.font = "700 13px sans-serif";
  entries.forEach((entry, i) => ctx.fillText(entry.message, 34, 152 + i * 18));
  ctx.restore();
}

function drawMiniMap(camera) {
  const x = canvas.width - 154;
  const y = canvas.height - 94;
  const w = 132;
  const h = 72;
  ctx.save();
  ctx.fillStyle = "rgba(8,20,15,.58)";
  roundRect(x, y, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.22)";
  buildings.forEach((building) => {
    ctx.fillRect(x + (building.x / WORLD_WIDTH) * w - 2, y + (building.y / WORLD_HEIGHT) * h - 2, 4, 4);
  });
  ctx.strokeStyle = "rgba(255,243,167,.8)";
  ctx.strokeRect(x + (camera.x / WORLD_WIDTH) * w, y + (camera.y / WORLD_HEIGHT) * h, (canvas.width / WORLD_WIDTH) * w, (canvas.height / WORLD_HEIGHT) * h);
  ctx.fillStyle = "#55d37b";
  ctx.beginPath();
  ctx.arc(x + (game.player.x / WORLD_WIDTH) * w, y + (game.player.y / WORLD_HEIGHT) * h, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderChat() {
  if (!ui.chatMessages || ui.chatPanel.classList.contains("hidden")) return;
  const messages = (game.chat || []).slice(-18);
  const signature = messages.map((message) => message.id).join("|");
  if (signature === lastChatSignature) return;
  lastChatSignature = signature;
  ui.chatMessages.innerHTML = "";
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-line";
    empty.textContent = "还没有消息，发一句欢迎大家。";
    ui.chatMessages.appendChild(empty);
    return;
  }
  messages.forEach((message) => {
    const line = document.createElement("div");
    line.className = "chat-line";
    const name = document.createElement("strong");
    name.textContent = message.name || "玩家";
    line.appendChild(name);
    line.append(document.createTextNode(message.text || ""));
    ui.chatMessages.appendChild(line);
  });
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

function sendChat(text) {
  const clean = text.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean) return;
  game.chat = [
    ...(game.chat || []),
    {
      id: `${game.player.id}-${now()}`,
      playerId: game.player.id,
      name: game.player.name,
      text: clean,
      t: now(),
    },
  ].slice(-60);
  addLog(`${game.player.name}：${clean}`);
  renderChat();
  saveLocal();
  if (backendReady()) pushToGithub(true);
}

function updateHud() {
  ui.coin.textContent = Math.floor(game.coins);
  ui.level.textContent = game.level;
  ui.water.textContent = Math.floor(game.water);
  ui.room.textContent = game.room;
}

function drawEllipse(x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function roundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function gameLoop(time) {
  const delta = Math.min(0.033, (time - lastTime) / 1000);
  lastTime = time;
  update(delta);
  draw();
  requestAnimationFrame(gameLoop);
}

function setMove(direction, pressed) {
  input[direction] = pressed;
}

function bindHold(button, direction) {
  const el = $(button);
  const down = (event) => {
    event.preventDefault();
    setMove(direction, true);
  };
  const up = () => setMove(direction, false);
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerleave", up);
}

function resizeCanvas() {
  canvas.width = BASE_WIDTH;
  canvas.height = BASE_HEIGHT;
}

function readBackendConfig() {
  return {
    owner: $("#ghOwner").value.trim(),
    repo: $("#ghRepo").value.trim(),
    branch: $("#ghBranch").value.trim() || "main",
    token: $("#ghToken").value.trim(),
  };
}

function getBackendConfig() {
  return JSON.parse(localStorage.getItem("cloudFarmBackend") || "{}");
}

function backendReady() {
  const config = getBackendConfig();
  return Boolean(config.owner && config.repo && config.branch && config.token);
}

function roomPath() {
  return `rooms/${encodeURIComponent(game.room)}.json`;
}

async function githubRequest(path, options = {}) {
  const config = getBackendConfig();
  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub 请求失败：${response.status} ${text}`);
  }
  return response.json();
}

function encodeBase64Unicode(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64Unicode(value) {
  return decodeURIComponent(escape(atob(value.replace(/\n/g, ""))));
}

function publicState() {
  const clone = JSON.parse(JSON.stringify(game));
  clone.visitors = {
    ...(clone.visitors || {}),
    [game.player.id]: game.player,
  };
  clone.chat = (clone.chat || []).slice(-60);
  clone.updatedAt = now();
  return clone;
}

async function pullFromGithub(silent = false) {
  if (!backendReady()) {
    if (!silent) showToast("请先配置 GitHub 后端", "bad");
    return false;
  }
  try {
    ui.sync.textContent = "正在拉取云端房间...";
    const file = await githubRequest(roomPath());
    const remote = normalizeState(JSON.parse(decodeBase64Unicode(file.content)));
    mergeRemote(remote);
    saveLocal();
    ui.sync.textContent = "已从 GitHub 拉取";
    if (!silent) showToast("已同步云端房间");
    return file.sha;
  } catch (error) {
    if (String(error.message).includes("404")) {
      ui.sync.textContent = "云端暂无房间，等待创建";
      return null;
    }
    ui.sync.textContent = "同步失败";
    if (!silent) showToast("GitHub 同步失败，请检查仓库权限", "bad");
    return false;
  }
}

function mergeRemote(remote) {
  const localPlayer = game.player;
  const remotePlots = new Map(remote.plots.map((plot) => [plot.id, plot]));
  game = {
    ...game,
    ...remote,
    coins: Math.max(game.coins, remote.coins || 0),
    xp: Math.max(game.xp, remote.xp || 0),
    level: Math.max(game.level, remote.level || 1),
    water: Math.max(game.water, remote.water || 0),
    chat: mergeChat(game.chat || [], remote.chat || []),
    plots: game.plots.map((plot) => {
      const remotePlot = remotePlots.get(plot.id);
      if (!remotePlot) return plot;
      if ((remotePlot.plantedAt || 0) > (plot.plantedAt || 0) || remotePlot.crop !== plot.crop) return remotePlot;
      return { ...remotePlot, ...plot, harvests: Math.max(plot.harvests || 0, remotePlot.harvests || 0) };
    }),
    visitors: {
      ...(remote.visitors || {}),
      [localPlayer.id]: localPlayer,
    },
    player: localPlayer,
  };
}

function mergeChat(localChat, remoteChat) {
  const map = new Map();
  [...remoteChat, ...localChat].forEach((message) => {
    if (!message?.id) return;
    map.set(message.id, message);
  });
  return [...map.values()].sort((a, b) => (a.t || 0) - (b.t || 0)).slice(-60);
}

async function pushToGithub(silent = false) {
  if (!backendReady()) {
    if (!silent) showToast("当前是本地模式，未配置 GitHub Token", "bad");
    return;
  }
  try {
    ui.sync.textContent = "正在推送到 GitHub...";
    const sha = await pullFromGithub(true);
    const config = getBackendConfig();
    const body = {
      message: `sync cloud farm room ${game.room}`,
      content: encodeBase64Unicode(JSON.stringify(publicState(), null, 2)),
      branch: config.branch,
      ...(sha ? { sha } : {}),
    };
    await githubRequest(roomPath(), {
      method: "PUT",
      body: JSON.stringify(body),
    });
    ui.sync.textContent = `GitHub 已同步 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    if (!silent) showToast("云端同步完成");
  } catch (error) {
    ui.sync.textContent = "同步失败";
    if (!silent) showToast("推送失败：请检查 Token 是否有仓库 contents 读写权限", "bad");
  }
}

async function backgroundSync() {
  saveLocal();
  if (backendReady()) await pushToGithub(true);
}

function startGame() {
  const name = $("#playerName").value.trim() || "菜园主";
  const room = ($("#roomCode").value.trim() || "PUBLIC-FARM").toUpperCase();
  const local = loadLocal(room) || createInitialState();
  game = normalizeState(local);
  game.room = room;
  game.player.name = name;
  game.player.id = getClientId();
  game.player.lastSeen = now();
  if (!game.chat?.length) {
    game.chat = [
      {
        id: `system-${now()}`,
        playerId: "system",
        name: "系统",
        text: "欢迎来到公共大地图，所有玩家默认在这里一起种菜。",
        t: now(),
      },
    ];
  }
  startScreen.classList.remove("active");
  gameScreen.classList.remove("hidden");
  ui.sync.textContent = backendReady() ? "GitHub 后端已就绪" : "本地模式";
  addLog(`${name} 进入了房间`);
  saveLocal();
  if (backendReady()) pushToGithub(true);
}

function initBackendForm() {
  $("#ghOwner").value = savedBackend.owner || "magao520";
  $("#ghRepo").value = savedBackend.repo || "";
  $("#ghBranch").value = savedBackend.branch || "main";
  $("#ghToken").value = savedBackend.token || "";
}

function bindEvents() {
  $("#startGame").addEventListener("click", startGame);
  $("#openBackend").addEventListener("click", () => backendPanel.classList.remove("hidden"));
  $("#closeBackend").addEventListener("click", () => backendPanel.classList.add("hidden"));
  $("#saveBackend").addEventListener("click", () => {
    localStorage.setItem("cloudFarmBackend", JSON.stringify(readBackendConfig()));
    backendPanel.classList.add("hidden");
    showToast("GitHub 后端设置已保存到本机");
  });
  $("#plantBtn").addEventListener("click", plant);
  $("#waterBtn").addEventListener("click", water);
  $("#harvestBtn").addEventListener("click", harvest);
  $("#shopBtn").addEventListener("click", expandFarm);
  $("#syncNow").addEventListener("click", () => pushToGithub(false));
  $("#chatToggle").addEventListener("click", () => {
    ui.chatPanel.classList.toggle("hidden");
    renderChat();
    if (!ui.chatPanel.classList.contains("hidden")) ui.chatInput.focus();
  });
  $("#closeChat").addEventListener("click", () => ui.chatPanel.classList.add("hidden"));
  $("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat(ui.chatInput.value);
    ui.chatInput.value = "";
  });
  bindHold("#upBtn", "up");
  bindHold("#leftBtn", "left");
  bindHold("#rightBtn", "right");
  bindHold("#downBtn", "down");

  window.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") setMove("left", true);
    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") setMove("right", true);
    if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") setMove("up", true);
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") setMove("down", true);
    if (event.key.toLowerCase() === "j") plant();
    if (event.key.toLowerCase() === "k") water();
    if (event.key.toLowerCase() === "l") harvest();
    if (event.key.toLowerCase() === "enter") $("#chatToggle").click();
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") setMove("left", false);
    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") setMove("right", false);
    if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") setMove("up", false);
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") setMove("down", false);
  });
  window.addEventListener("resize", resizeCanvas);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("./sw.js").then((registration) => registration.update()).catch(() => {});
  }
}

initBackendForm();
renderCropBar();
resizeCanvas();
bindEvents();
registerServiceWorker();
requestAnimationFrame(gameLoop);
