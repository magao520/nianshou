const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";

const BASE_WIDTH = 960;
const BASE_HEIGHT = 540;
const WORLD_WIDTH = 2048;
const WORLD_HEIGHT = 1152;

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
  { id: "radish", name: "樱桃萝卜", col: 0, cost: 4, value: 12, grow: 14, xp: 4, water: 8, color: "#ff6b88" },
  { id: "tomato", name: "星光番茄", col: 1, cost: 8, value: 25, grow: 24, xp: 8, water: 10, color: "#ff6b3d" },
  { id: "pumpkin", name: "月亮南瓜", col: 2, cost: 16, value: 48, grow: 38, xp: 14, water: 13, color: "#ffb347" },
  { id: "corn", name: "金穗玉米", col: 3, cost: 22, value: 64, grow: 46, xp: 20, water: 15, color: "#ffd166" },
];

// 与油画背景中各建筑的视觉位置对齐
const buildings = [
  { id: "home", name: "玩家小屋", type: "home", x: 360, y: 470 },
  { id: "market", name: "集市小站", type: "market", x: 700, y: 540 },
  { id: "greenhouse", name: "星光温室", type: "greenhouse", x: 1180, y: 540 },
  { id: "mill", name: "风车仓库", type: "mill", x: 1860, y: 360 },
  { id: "pond", name: "月亮池塘", type: "pond", x: 1700, y: 870 },
];

// 资源
const ASSET = {
  worldMap: loadImage("./assets/world_map.jpg"),
  farmer: loadImage("./assets/farmer.jpg", { chromaKey: 245 }),
  soil: loadImage("./assets/plot_soil.jpg", { chromaKey: 245 }),
  crops: loadImage("./assets/crops_mature.jpg", { chromaKey: 245 }),
};

function loadImage(src, options = {}) {
  const img = new Image();
  const wrap = { ready: false, image: null, raw: img };
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (options.chromaKey) {
      wrap.image = chromaKey(img, options.chromaKey);
    } else {
      wrap.image = img;
    }
    wrap.ready = true;
  };
  img.src = src;
  return wrap;
}

// 把白色背景去掉 (近白 -> 透明，浅色 -> 软透明)
function chromaKey(img, threshold = 240) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, c.width, c.height);
  const arr = data.data;
  for (let i = 0; i < arr.length; i += 4) {
    const r = arr[i], g = arr[i + 1], b = arr[i + 2];
    const lum = (r + g + b) / 3;
    if (r > threshold && g > threshold && b > threshold) {
      arr[i + 3] = 0;
    } else if (lum > threshold - 22) {
      arr[i + 3] = Math.max(0, Math.min(255, Math.floor((threshold - lum) * 14)));
    }
  }
  cx.putImageData(data, 0, 0);
  return c;
}

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
    version: 4,
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
      x: 460,
      y: 880,
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

// 把地块布置到油画中的草地空白处
function createMapPlots() {
  const clusters = [
    { x: 80,   y: 880,  rows: 2, cols: 4 }, // 左下草地
    { x: 480,  y: 950,  rows: 2, cols: 4 }, // 中下靠路
    { x: 920,  y: 980,  rows: 2, cols: 4 }, // 中央广场下方
    { x: 1340, y: 990,  rows: 2, cols: 3 }, // 右下池塘旁
    { x: 1080, y: 760,  rows: 2, cols: 3 }, // 温室前广场
  ];
  const plots = [];
  clusters.forEach((cluster, clusterIndex) => {
    for (let row = 0; row < cluster.rows; row += 1) {
      for (let col = 0; col < cluster.cols; col += 1) {
        plots.push(makePlot(plots.length, cluster.x + col * 110, cluster.y + row * 70, clusterIndex));
      }
    }
  });
  return plots;
}

function makePlot(i, x, y, cluster = 0) {
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
    fertility: 0.85 + ((i * 17) % 35) / 100,
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
    return normalizeState(JSON.parse(raw));
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
  if (!target || target.dist > 90) return showToast("靠近一块空地再播种", "bad");
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
    button.innerHTML = `<span class="ico" style="background-image:url('./assets/crops_mature.jpg');background-size:400% 100%;background-position:${(crop.col / 3) * 100}% 50%"></span><strong>${crop.name}</strong><small>${crop.cost} 金</small>`;
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
  const speed = 240;
  if (input.left) game.player.facing = -1;
  if (input.right) game.player.facing = 1;
  game.player.x += (movingX / length) * speed * delta;
  game.player.y += (movingY / length) * speed * delta;
  game.player.x = clamp(game.player.x, 60, WORLD_WIDTH - 60);
  game.player.y = clamp(game.player.y, 200, WORLD_HEIGHT - 60);
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
  drawPlots(camera);
  drawBuildingLabels(camera);
  drawSunsetOverlay();

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
  const map = ASSET.worldMap;
  if (map.ready) {
    const img = map.image;
    const sx = (camera.x / WORLD_WIDTH) * img.width;
    const sy = (camera.y / WORLD_HEIGHT) * img.height;
    const sw = (canvas.width / WORLD_WIDTH) * img.width;
    const sh = (canvas.height / WORLD_HEIGHT) * img.height;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
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
  if (night <= 0) return;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, `rgba(13, 28, 60, ${night * 0.34})`);
  grad.addColorStop(1, `rgba(20, 45, 70, ${night * 0.18})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawPlots(camera) {
  const sortedPlots = [...game.plots].sort((a, b) => a.y - b.y);
  sortedPlots.forEach((plot) => {
    const x = plot.x - camera.x;
    const y = plot.y - camera.y;
    if (x < -120 || x > canvas.width + 120 || y < -90 || y > canvas.height + 110) return;

    if (plot.locked) {
      ctx.save();
      ctx.fillStyle = "rgba(20,30,18,.55)";
      ctx.beginPath();
      ctx.ellipse(x, y, 50, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.86)";
      ctx.font = "700 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("未开垦", x, y + 4);
      ctx.restore();
      return;
    }

    // 阴影
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 54, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 土壤精灵图
    const soil = ASSET.soil;
    const dw = 110;
    const dh = 60;
    if (soil.ready) {
      ctx.drawImage(soil.image, x - dw / 2, y - dh / 2, dw, dh);
    } else {
      ctx.save();
      ctx.fillStyle = "#6c4a2a";
      ctx.beginPath();
      ctx.ellipse(x, y, 50, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 浇水高光
    const moisture = clamp(plot.moisture || 0, 0, 100) / 100;
    if (moisture > 0.05) {
      ctx.save();
      ctx.fillStyle = `rgba(108, 211, 255, ${moisture * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 42, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (plot.crop) drawCrop(plot, x, y);
  });
}

function drawCrop(plot, x, y) {
  const crop = cropById(plot.crop);
  const progress = getCropProgress(plot);
  const cropsAtlas = ASSET.crops;

  // 长出来的茎/草
  const stemLen = 4 + progress * 14;
  ctx.save();
  ctx.strokeStyle = "rgba(58, 130, 70, .9)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 4);
  ctx.quadraticCurveTo(x - 10, y - stemLen, x, y - stemLen - 2);
  ctx.moveTo(x + 6, y - 4);
  ctx.quadraticCurveTo(x + 10, y - stemLen, x, y - stemLen - 2);
  ctx.stroke();
  ctx.restore();

  if (cropsAtlas.ready) {
    const img = cropsAtlas.image;
    const cellW = img.width / 4;
    const cellH = img.height;
    const sx = crop.col * cellW;
    const targetH = 28 + progress * 56;
    const targetW = targetH * (cellW / cellH);
    ctx.drawImage(
      img,
      sx, 0, cellW, cellH,
      x - targetW / 2, y - targetH * 0.85, targetW, targetH
    );
  } else {
    ctx.fillStyle = crop.color;
    ctx.beginPath();
    ctx.arc(x, y - 14 - progress * 14, 8 + progress * 14, 0, Math.PI * 2);
    ctx.fill();
  }

  // 进度文字
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.beginPath();
  ctx.roundRect(x - 28, y + 14, 56, 18, 9);
  ctx.fill();
  ctx.fillStyle = progress >= 1 ? "#ffe066" : "#fff3d4";
  ctx.font = "800 12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(progress >= 1 ? "可收获" : `${Math.round(progress * 100)}%`, x, y + 27);
  ctx.restore();
}

function drawBuildingLabels(camera) {
  buildings.forEach((building) => {
    const x = building.x - camera.x;
    const y = building.y - camera.y;
    if (x < -100 || x > canvas.width + 100 || y < -60 || y > canvas.height + 60) return;
    ctx.save();
    ctx.fillStyle = "rgba(10,24,19,.7)";
    ctx.beginPath();
    ctx.roundRect(x - 56, y - 14, 112, 28, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.stroke();
    ctx.fillStyle = "#fff3d4";
    ctx.font = "800 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(building.name, x, y + 1);
    ctx.restore();
  });
}

function drawPlayer(player, camera, isSelf) {
  const x = player.x - camera.x;
  const y = player.y - camera.y;

  // 投影
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.32)";
  ctx.beginPath();
  ctx.ellipse(x, y + 18, 26, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 身体光晕（自己）
  if (isSelf) {
    const grad = ctx.createRadialGradient(x, y - 30, 6, x, y - 30, 64);
    grad.addColorStop(0, "rgba(255, 232, 130, .35)");
    grad.addColorStop(1, "rgba(255, 232, 130, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - 64, y - 90, 128, 128);
  }

  const sprite = ASSET.farmer;
  const targetH = 110;
  const aspect = sprite.ready ? sprite.image.width / sprite.image.height : 0.85;
  const targetW = targetH * aspect;

  ctx.save();
  ctx.translate(x, y - 12);
  ctx.scale((player.facing || 1) * 1, 1);
  if (sprite.ready) {
    ctx.drawImage(sprite.image, -targetW / 2, -targetH * 0.92, targetW, targetH);
  } else {
    ctx.fillStyle = player.color || "#55d37b";
    ctx.beginPath();
    ctx.roundRect(-18, -targetH * 0.9, 36, targetH * 0.7, 12);
    ctx.fill();
  }
  ctx.restore();

  // 名字气泡
  ctx.save();
  ctx.fillStyle = isSelf ? "rgba(255,206,84,.94)" : "rgba(15, 24, 30, .82)";
  ctx.beginPath();
  ctx.roundRect(x - 50, y - targetH - 12, 100, 22, 11);
  ctx.fill();
  ctx.fillStyle = isSelf ? "#1a1408" : "#fff3d4";
  ctx.font = "800 12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(isSelf ? `${player.name}（你）` : player.name, x, y - targetH);
  ctx.restore();
}

function drawPointer(camera) {
  const target = getNearestPlot();
  if (!target || target.dist > 100) return;
  const plot = target.plot;
  const x = plot.x - camera.x;
  const y = plot.y - camera.y;
  const t = (now() % 1200) / 1200;
  ctx.save();
  ctx.strokeStyle = `rgba(255, 230, 120, ${0.55 + Math.sin(t * Math.PI * 2) * 0.25})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.ellipse(x, y, 60, 30, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawLog() {
  const entries = (game.log || []).slice(0, 4);
  if (!entries.length) return;
  ctx.save();
  ctx.globalAlpha = 0.86;
  ctx.fillStyle = "rgba(8, 20, 15, .55)";
  ctx.beginPath();
  ctx.roundRect(18, 126, 330, 88, 18);
  ctx.fill();
  ctx.fillStyle = "rgba(255,243,212,.86)";
  ctx.font = "700 13px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  entries.forEach((entry, i) => ctx.fillText(entry.message, 34, 152 + i * 18));
  ctx.restore();
}

function drawMiniMap(camera) {
  const w = 152;
  const h = 86;
  const x = canvas.width - w - 18;
  const y = canvas.height - h - 18;
  ctx.save();
  ctx.fillStyle = "rgba(8,20,15,.65)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.2)";
  ctx.stroke();

  // mini world map
  if (ASSET.worldMap.ready) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, w - 8, h - 8, 10);
    ctx.clip();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(ASSET.worldMap.image, x + 4, y + 4, w - 8, h - 8);
    ctx.restore();
  }

  // 建筑点
  ctx.fillStyle = "rgba(255,255,255,.82)";
  buildings.forEach((building) => {
    ctx.fillRect(x + 4 + (building.x / WORLD_WIDTH) * (w - 8) - 1.5, y + 4 + (building.y / WORLD_HEIGHT) * (h - 8) - 1.5, 3, 3);
  });

  // 视野框
  ctx.strokeStyle = "rgba(255, 224, 130, .9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 4 + (camera.x / WORLD_WIDTH) * (w - 8), y + 4 + (camera.y / WORLD_HEIGHT) * (h - 8), (canvas.width / WORLD_WIDTH) * (w - 8), (canvas.height / WORLD_HEIGHT) * (h - 8));

  // 玩家
  ctx.fillStyle = "#55d37b";
  ctx.beginPath();
  ctx.arc(x + 4 + (game.player.x / WORLD_WIDTH) * (w - 8), y + 4 + (game.player.y / WORLD_HEIGHT) * (h - 8), 3.2, 0, Math.PI * 2);
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

// roundRect polyfill (Safari 旧版本兼容)
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const radius = Math.min(r, Math.min(w, h) / 2);
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
    return this;
  };
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
  if (!el) return;
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
        text: "欢迎来到星之菜园，所有玩家默认在这片大地图相遇。",
        t: now(),
      },
    ];
  }
  startScreen.classList.remove("active");
  gameScreen.classList.remove("hidden");
  ui.sync.textContent = backendReady() ? "GitHub 后端已就绪" : "本地模式";
  addLog(`${name} 进入了村庄`);
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
