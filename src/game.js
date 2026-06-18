const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");

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
};

const crops = [
  { id: "radish", name: "樱桃萝卜", icon: "🌱", matureIcon: "🥕", cost: 4, value: 12, grow: 14, xp: 4, color: "#ff6b88" },
  { id: "tomato", name: "星光番茄", icon: "🌿", matureIcon: "🍅", cost: 8, value: 24, grow: 24, xp: 8, color: "#ff6b3d" },
  { id: "pumpkin", name: "月亮南瓜", icon: "🍃", matureIcon: "🎃", cost: 16, value: 46, grow: 38, xp: 14, color: "#ffb347" },
];

const bg = new Image();
bg.src = "./assets/verdant-terraces-bg.jpg";

const savedBackend = JSON.parse(localStorage.getItem("cloudFarmBackend") || "{}");
const now = () => Date.now();

let selectedCrop = crops[0].id;
let lastTime = performance.now();
let syncTimer = 0;
let toastTimer = 0;
let input = { left: false, right: false };
let game = createInitialState();

function createInitialState() {
  const plotCount = 10;
  return {
    version: 1,
    room: "FARM-520",
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
      x: 210,
      y: 388,
      facing: 1,
      color: randomPlayerColor(),
      lastSeen: now(),
    },
    visitors: {},
    plots: Array.from({ length: plotCount }, (_, i) => makePlot(i)),
    log: [],
  };
}

function makePlot(i) {
  return {
    id: `plot-${i}`,
    x: 230 + i * 170,
    y: 422 + (i % 2) * 8,
    locked: i >= 6,
    crop: null,
    plantedAt: 0,
    wateredAt: 0,
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
    plots: (data.plots?.length ? data.plots : base.plots).map((plot, i) => ({ ...makePlot(i), ...plot })),
  };
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
    .map((plot) => ({ plot, dist: Math.abs(plot.x - game.player.x) }))
    .sort((a, b) => a.dist - b.dist)[0];
}

function getCropProgress(plot) {
  if (!plot.crop) return 0;
  const crop = cropById(plot.crop);
  const wateredBoost = now() - plot.wateredAt < 18000 ? 1.35 : 1;
  return clamp(((now() - plot.plantedAt) / 1000 / crop.grow) * wateredBoost, 0, 1);
}

function plant() {
  const target = getNearestPlot();
  if (!target || target.dist > 78) return showToast("靠近一块空地再播种", "bad");
  const plot = target.plot;
  if (plot.crop) return showToast("这块地已经种下作物了", "bad");
  const crop = cropById(selectedCrop);
  if (game.coins < crop.cost) return showToast(`金币不足，需要 ${crop.cost}`, "bad");
  game.coins -= crop.cost;
  plot.crop = crop.id;
  plot.plantedAt = now();
  plot.wateredAt = 0;
  addLog(`${game.player.name} 种下了 ${crop.name}`);
  saveLocal();
}

function water() {
  const target = getNearestPlot();
  if (!target || target.dist > 86) return showToast("靠近作物再浇水", "bad");
  const plot = target.plot;
  if (!plot.crop) return showToast("这块地还没有作物", "bad");
  if (game.water < 8) return showToast("水量不足，等一会儿自动恢复", "bad");
  game.water -= 8;
  plot.wateredAt = now();
  addLog(`${game.player.name} 给作物浇了水`);
  saveLocal();
}

function harvest() {
  const target = getNearestPlot();
  if (!target || target.dist > 86) return showToast("靠近成熟作物再收获", "bad");
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
  addLog(`${game.player.name} 收获 ${crop.name}，获得 ${gain} 金币`);
  showToast(`收获成功 +${gain} 金币`);
  saveLocal();
}

function expandFarm() {
  const locked = game.plots.find((plot) => plot.locked);
  if (!locked) return showToast("菜园已经全部解锁");
  const price = 40 + game.expansion * 25;
  if (game.coins < price) return showToast(`扩建需要 ${price} 金币`, "bad");
  game.coins -= price;
  game.expansion += 1;
  locked.locked = false;
  showToast("新土地已解锁");
  addLog(`${game.player.name} 扩建了一块土地`);
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
    button.innerHTML = `${crop.matureIcon}<br><small>${crop.cost} 金</small>`;
    button.title = crop.name;
    button.addEventListener("click", () => {
      selectedCrop = crop.id;
      renderCropBar();
    });
    ui.cropBar.appendChild(button);
  });
}

function update(delta) {
  const speed = 250;
  if (input.left) {
    game.player.x -= speed * delta;
    game.player.facing = -1;
  }
  if (input.right) {
    game.player.x += speed * delta;
    game.player.facing = 1;
  }
  const maxX = game.plots[game.plots.length - 1].x + 220;
  game.player.x = clamp(game.player.x, 80, maxX);
  game.player.lastSeen = now();
  game.water = clamp(game.water + delta * 2.2, 0, 100);
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
  const worldWidth = game.plots[game.plots.length - 1].x + 500;
  const camera = clamp(game.player.x - width * 0.42, 0, Math.max(0, worldWidth - width));

  ctx.clearRect(0, 0, width, height);
  drawBackground(camera);
  drawSunsetOverlay();
  drawGround(camera);
  drawPlots(camera);
  drawPlayer(game.player, camera, true);
  Object.values(game.visitors || {})
    .filter((p) => p.id !== game.player.id && now() - p.lastSeen < 45000)
    .forEach((p) => drawPlayer(p, camera, false));
  drawPointer(camera);
  drawLog();
  updateHud();
}

function drawBackground(camera) {
  const parallax = camera * 0.12;
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
  const ground = ctx.createLinearGradient(0, 360, 0, canvas.height);
  ground.addColorStop(0, "rgba(94, 178, 89, 0.18)");
  ground.addColorStop(1, "#2e6b3d");
  ctx.fillStyle = ground;
  roundRect(-40 - camera * 0.04, 380, canvas.width + 120, 200, 34);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,.14)";
  ctx.lineWidth = 2;
  for (let i = -1; i < 16; i += 1) {
    const x = i * 90 - (camera * 0.35) % 90;
    ctx.beginPath();
    ctx.moveTo(x, 470);
    ctx.quadraticCurveTo(x + 40, 425, x + 100, 400);
    ctx.stroke();
  }
}

function drawPlots(camera) {
  game.plots.forEach((plot) => {
    const x = plot.x - camera;
    const y = plot.y;
    if (x < -120 || x > canvas.width + 120) return;

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = plot.locked ? "rgba(40,40,40,.72)" : "#7d4a28";
    ctx.strokeStyle = plot.locked ? "rgba(255,255,255,.18)" : "#b87342";
    ctx.lineWidth = 4;
    drawEllipse(0, 0, 74, 28);
    ctx.fill();
    ctx.stroke();

    if (plot.locked) {
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = "700 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("待扩建", 0, 5);
      ctx.restore();
      return;
    }

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
  const x = player.x - camera;
  const y = player.y;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(player.facing || 1, 1);

  ctx.fillStyle = "rgba(0,0,0,.22)";
  drawEllipse(0, 20, 28, 8);
  ctx.fill();

  ctx.fillStyle = player.color || "#55d37b";
  roundRect(-18, -34, 36, 52, 15);
  ctx.fill();

  ctx.fillStyle = "#ffe1b4";
  ctx.beginPath();
  ctx.arc(0, -48, 18, 0, Math.PI * 2);
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
  if (!target || target.dist > 96) return;
  const plot = target.plot;
  const x = plot.x - camera;
  ctx.save();
  ctx.strokeStyle = "#fff3a7";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  drawEllipse(x, plot.y, 86, 36);
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
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
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
  const room = ($("#roomCode").value.trim() || "FARM-520").toUpperCase();
  const local = loadLocal(room) || createInitialState();
  game = normalizeState(local);
  game.room = room;
  game.player.name = name;
  game.player.id = getClientId();
  game.player.lastSeen = now();
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
  bindHold("#leftBtn", "left");
  bindHold("#rightBtn", "right");

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") setMove("left", true);
    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") setMove("right", true);
    if (event.key.toLowerCase() === "j") plant();
    if (event.key.toLowerCase() === "k") water();
    if (event.key.toLowerCase() === "l") harvest();
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") setMove("left", false);
    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") setMove("right", false);
  });
  window.addEventListener("resize", resizeCanvas);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

initBackendForm();
renderCropBar();
resizeCanvas();
bindEvents();
registerServiceWorker();
requestAnimationFrame(gameLoop);
