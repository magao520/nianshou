const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const now = () => Date.now();
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const canvas = $("#farmCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
const entry = $("#entry");
const game = $("#game");
const toastEl = $("#toast");
const sheet = $("#sheet");
const sheetTitle = $("#sheetTitle");
const sheetBody = $("#sheetBody");
const syncInfo = $("#syncInfo");

const SAVE_VERSION = 7;
const CLIENT_KEY = "cloudFarm.clientId.v1";
const LOCAL_PLAYER_KEY = "cloudFarm.player.v1";
const MUTATION_RATE = 1 / 1000;
const ONLINE_WINDOW = 90_000;
const RECENT_WINDOW = 10 * 60_000;

const crops = {
  carrot: { name: "胡萝卜", emoji: "🥕", growMs: 90_000, seedCost: 3, sell: 9, colors: ["#86c85a", "#ff9948"] },
  tomato: { name: "番茄", emoji: "🍅", growMs: 150_000, seedCost: 5, sell: 16, colors: ["#3fa65a", "#df493d"] },
  corn: { name: "甜玉米", emoji: "🌽", growMs: 240_000, seedCost: 8, sell: 28, colors: ["#78b64c", "#ffd45b"] },
  eggplant: { name: "茄子", emoji: "🍆", growMs: 320_000, seedCost: 12, sell: 42, colors: ["#4d9a5d", "#7b4bc0"] },
};

let clientId = localStorage.getItem(CLIENT_KEY);
if (!clientId) {
  clientId = uid();
  localStorage.setItem(CLIENT_KEY, clientId);
}

let room = "PUBLIC-FARM";
let selectedCrop = "carrot";
let db = null;
let player = null;
let activePanel = "garden";
let lastFrame = performance.now();
let t = 0;
let particles = [];
let floating = [];
let broadcast = null;

function blankPlayer(name = "菜园主") {
  return {
    id: clientId,
    name,
    coins: 120,
    lastSeen: now(),
    createdAt: now(),
    inventory: {},
    stats: { harvests: 0, mutations: 0, listings: 0 },
    plots: Array.from({ length: 12 }, (_, i) => ({ id: `plot-${i}`, crop: null, plantedAt: 0, growMs: 0, watered: false })),
  };
}

function blankDb() {
  return {
    version: SAVE_VERSION,
    rev: 0,
    room,
    updatedAt: now(),
    players: {},
    market: {},
    events: [],
  };
}

function dbKey() {
  return `cloudFarm.room.${room}.v${SAVE_VERSION}`;
}

function safeReadDb() {
  try {
    const raw = JSON.parse(localStorage.getItem(dbKey()) || "null");
    if (!raw || raw.version !== SAVE_VERSION) return blankDb();
    raw.players ||= {};
    raw.market ||= {};
    raw.events ||= [];
    return raw;
  } catch {
    return blankDb();
  }
}

function commit(mutator, reason = "sync") {
  const latest = safeReadDb();
  latest.players[clientId] ||= structuredClone(player || blankPlayer());
  mutator(latest);
  latest.rev = (latest.rev || 0) + 1;
  latest.updatedAt = now();
  latest.players[clientId].lastSeen = now();
  latest.events = (latest.events || []).slice(-40);
  localStorage.setItem(dbKey(), JSON.stringify(latest));
  db = latest;
  player = latest.players[clientId];
  localStorage.setItem(LOCAL_PLAYER_KEY, JSON.stringify({ name: player.name, room }));
  broadcast?.postMessage({ room, rev: db.rev, reason });
  renderAll();
}

function mergePlayer(remote, local) {
  if (!remote) return structuredClone(local);
  if (!local) return remote;
  return {
    ...remote,
    ...local,
    coins: Math.max(Number(remote.coins || 0), Number(local.coins || 0)),
    inventory: mergeInventory(remote.inventory, local.inventory),
    plots: chooseNewestPlots(remote.plots, local.plots),
    stats: {
      harvests: Math.max(remote.stats?.harvests || 0, local.stats?.harvests || 0),
      mutations: Math.max(remote.stats?.mutations || 0, local.stats?.mutations || 0),
      listings: Math.max(remote.stats?.listings || 0, local.stats?.listings || 0),
    },
    lastSeen: Math.max(remote.lastSeen || 0, local.lastSeen || 0),
  };
}

function mergeInventory(a = {}, b = {}) {
  const out = { ...a };
  Object.entries(b).forEach(([key, value]) => {
    out[key] = Math.max(Number(out[key] || 0), Number(value || 0));
  });
  return out;
}

function chooseNewestPlots(a = [], b = []) {
  return Array.from({ length: 12 }, (_, i) => {
    const pa = a[i] || { id: `plot-${i}`, crop: null, plantedAt: 0, growMs: 0, watered: false };
    const pb = b[i] || pa;
    const ta = pa.updatedAt || pa.plantedAt || 0;
    const tb = pb.updatedAt || pb.plantedAt || 0;
    return tb >= ta ? pb : pa;
  });
}

function start() {
  room = ($("#roomCode").value || "PUBLIC-FARM").trim().toUpperCase();
  const saved = JSON.parse(localStorage.getItem(LOCAL_PLAYER_KEY) || "null");
  const name = ($("#playerName").value || saved?.name || "菜园主").trim().slice(0, 14);
  db = safeReadDb();
  player = db.players[clientId] ? structuredClone(db.players[clientId]) : blankPlayer(name);
  player.name = name;
  entry.classList.remove("active");
  game.classList.remove("hidden");
  try {
    broadcast = new BroadcastChannel(`cloudFarm:${room}`);
    broadcast.onmessage = syncFromStorage;
  } catch {}
  commit((draft) => {
    draft.players[clientId] = player;
    draft.events.push({ id: uid(), time: now(), text: `${player.name} 进入了菜园` });
  }, "enter");
  resize();
  toast("欢迎回到云上菜园");
}

function syncFromStorage() {
  const latest = safeReadDb();
  if (!db || latest.rev >= db.rev) {
    db = latest;
    player = mergePlayer(latest.players[clientId], player);
    db.players[clientId] = player;
    renderAll();
  }
}

function heartbeat() {
  if (!player) return;
  commit((draft) => {
    draft.players[clientId].lastSeen = now();
  }, "heartbeat");
}

function cropProgress(plot) {
  if (!plot.crop) return 0;
  const bonus = plot.watered ? 1.18 : 1;
  return clamp((now() - plot.plantedAt) * bonus / plot.growMs, 0, 1);
}

function plant(plotIndex) {
  const crop = crops[selectedCrop];
  const plot = player.plots[plotIndex];
  if (plot.crop) return toast("这块地已经种上了");
  if (player.coins < crop.seedCost) return toast("金币不够买种子");
  commit((draft) => {
    const p = draft.players[clientId];
    p.coins -= crop.seedCost;
    p.plots[plotIndex] = { id: `plot-${plotIndex}`, crop: selectedCrop, plantedAt: now(), growMs: crop.growMs, watered: false, updatedAt: now() };
    draft.events.push({ id: uid(), time: now(), text: `${p.name} 播种了${crop.name}` });
  }, "plant");
  burst(plotScreen(plotIndex), crop.colors[0]);
}

function water(plotIndex) {
  const plot = player.plots[plotIndex];
  if (!plot.crop) return toast("空地不用浇水");
  if (plot.watered) return toast("这块地已经浇过水");
  commit((draft) => {
    draft.players[clientId].plots[plotIndex].watered = true;
    draft.players[clientId].plots[plotIndex].updatedAt = now();
  }, "water");
  splash(plotScreen(plotIndex));
}

function harvest(plotIndex) {
  const plot = player.plots[plotIndex];
  if (!plot.crop) return toast("这块地是空的");
  const progress = cropProgress(plot);
  if (progress < 1) return toast(`还没成熟：${Math.floor(progress * 100)}%`);
  const type = plot.crop;
  const crop = crops[type];
  const mutated = Math.random() < MUTATION_RATE;
  const itemKey = mutated ? `mut_${type}` : type;
  commit((draft) => {
    const p = draft.players[clientId];
    p.inventory[itemKey] = (p.inventory[itemKey] || 0) + 1;
    p.stats.harvests += 1;
    if (mutated) p.stats.mutations += 1;
    p.plots[plotIndex] = { id: `plot-${plotIndex}`, crop: null, plantedAt: 0, growMs: 0, watered: false, updatedAt: now() };
    draft.events.push({ id: uid(), time: now(), text: mutated ? `${p.name} 采到了变异${crop.name}` : `${p.name} 收获了${crop.name}` });
  }, "harvest");
  burst(plotScreen(plotIndex), mutated ? "#ff6ff2" : crop.colors[1], mutated ? 32 : 16);
  toast(mutated ? `千分之一！获得变异${crop.name}` : `收获${crop.name}`);
}

function recycle(plotIndex) {
  const plot = player.plots[plotIndex];
  if (!plot.crop) return toast("空地不用回收");
  commit((draft) => {
    draft.players[clientId].plots[plotIndex] = { id: `plot-${plotIndex}`, crop: null, plantedAt: 0, growMs: 0, watered: false, updatedAt: now() };
  }, "recycle");
  toast("已回收作物");
}

function addInventory(key, qty) {
  player.inventory[key] = (player.inventory[key] || 0) + qty;
}

function listItem(key, qty, price) {
  qty = Math.max(1, Math.floor(qty));
  price = Math.max(1, Math.floor(price));
  if ((player.inventory[key] || 0) < qty) return toast("库存不足");
  commit((draft) => {
    const p = draft.players[clientId];
    p.inventory[key] -= qty;
    if (p.inventory[key] <= 0) delete p.inventory[key];
    const id = uid();
    draft.market[id] = { id, sellerId: clientId, sellerName: p.name, item: key, qty, price, createdAt: now() };
    p.stats.listings += 1;
    draft.events.push({ id: uid(), time: now(), text: `${p.name} 上架了 ${qty} 个${itemName(key)}` });
  }, "list");
  openMarket();
}

function delist(id) {
  const listing = db.market[id];
  if (!listing || listing.sellerId !== clientId) return toast("只能下架自己的商品");
  commit((draft) => {
    delete draft.market[id];
    const p = draft.players[clientId];
    p.inventory[listing.item] = (p.inventory[listing.item] || 0) + listing.qty;
  }, "delist");
  openMarket();
}

function buy(id) {
  const listing = db.market[id];
  if (!listing) return toast("商品已不存在");
  if (listing.sellerId === clientId) return toast("不能购买自己的商品");
  if (player.coins < listing.price) return toast("金币不足");
  commit((draft) => {
    const buyer = draft.players[clientId];
    const seller = draft.players[listing.sellerId] || { ...blankPlayer(listing.sellerName), id: listing.sellerId };
    buyer.coins -= listing.price;
    buyer.inventory[listing.item] = (buyer.inventory[listing.item] || 0) + listing.qty;
    seller.coins = (seller.coins || 0) + listing.price;
    draft.players[listing.sellerId] = seller;
    delete draft.market[id];
    draft.events.push({ id: uid(), time: now(), text: `${buyer.name} 购买了 ${listing.qty} 个${itemName(listing.item)}` });
  }, "buy");
  openMarket();
}

function renderAll() {
  if (!player) return;
  $("#coinText").textContent = player.coins;
  $("#bagText").textContent = Object.values(player.inventory || {}).reduce((a, b) => a + b, 0);
  $("#syncText").textContent = `房间 ${db.rev || 0}`;
  renderSeeds();
  if (!sheet.classList.contains("hidden")) openPanel(activePanel);
}

function renderSeeds() {
  $("#seedStrip").innerHTML = Object.entries(crops).map(([key, crop]) => `
    <button class="seed ${selectedCrop === key ? "active" : ""}" data-seed="${key}">
      <span>${crop.emoji} ${crop.name}</span>
      <small>${Math.round(crop.growMs / 60000)}分钟 · ${crop.seedCost}金币</small>
    </button>
  `).join("");
}

function openPanel(panel) {
  activePanel = panel;
  document.querySelectorAll(".dock button").forEach((btn) => btn.classList.toggle("active", btn.dataset.panel === panel));
  if (panel === "garden") {
    sheet.classList.add("hidden");
    return;
  }
  sheet.classList.remove("hidden");
  if (panel === "bag") openBag();
  if (panel === "market") openMarket();
  if (panel === "players") openPlayers();
}

function openBag() {
  sheetTitle.textContent = "背包";
  const rows = Object.entries(player.inventory || {});
  sheetBody.innerHTML = rows.length ? rows.map(([key, qty]) => `
    <div class="card-row">
      <div><strong>${itemName(key)}</strong><p>${isMutation(key) ? "稀有变异，可高价交易" : "普通蔬菜，可出售或上架"}</p></div>
      <div><span class="chip">×${qty}</span></div>
    </div>
    <div class="card-row">
      <input inputmode="numeric" id="qty-${key}" value="1" aria-label="上架数量" />
      <input inputmode="numeric" id="price-${key}" value="${defaultPrice(key)}" aria-label="上架价格" />
      <button class="market-action primary-action" data-list="${key}">上架</button>
    </div>
  `).join("") : `<div class="card-row"><div><strong>背包是空的</strong><p>成熟后采摘蔬菜会进入背包。</p></div></div>`;
}

function openMarket(filter = "") {
  sheetTitle.textContent = "集市";
  const listings = Object.values(db.market || {})
    .filter((x) => itemName(x.item).includes(filter) || x.sellerName.includes(filter))
    .sort((a, b) => b.createdAt - a.createdAt);
  sheetBody.innerHTML = `
    <input class="search" id="marketSearch" placeholder="搜索蔬菜或玩家..." value="${filter}" />
    <div class="market-grid">
      ${listings.length ? listings.map((x) => `
        <div class="card-row">
          <div>
            <strong>${itemName(x.item)} <span class="chip">×${x.qty}</span></strong>
            <p>${x.sellerName} · ${x.price} 金币 · ${timeAgo(x.createdAt)}上架</p>
          </div>
          ${x.sellerId === clientId
            ? `<button class="market-action" data-delist="${x.id}">下架</button>`
            : `<button class="market-action primary-action" data-buy="${x.id}">购买</button>`}
        </div>
      `).join("") : `<div class="card-row"><div><strong>暂无商品</strong><p>可以在背包里自由上架蔬菜或变异蔬菜。</p></div></div>`}
    </div>
  `;
}

function openPlayers() {
  sheetTitle.textContent = "玩家";
  const players = Object.values(db.players || {}).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  sheetBody.innerHTML = players.map((p) => {
    const online = now() - (p.lastSeen || 0) < ONLINE_WINDOW;
    const cropReady = (p.plots || []).filter((plot) => plot.crop && cropProgressFor(plot) >= 1).length;
    const cropGrowing = (p.plots || []).filter((plot) => plot.crop).length;
    const progressList = (p.plots || []).filter((plot) => plot.crop).map((plot) => cropProgressFor(plot));
    const maturity = progressList.length ? Math.round(progressList.reduce((a, b) => a + b, 0) / progressList.length * 100) : 0;
    return `
      <div class="card-row">
        <div>
          <strong>${p.name}${p.id === clientId ? "（你）" : ""}</strong>
          <p>${online ? "在线" : `${timeAgo(p.lastSeen)}在线`} · ${cropGrowing} 棵生长中 · 平均成熟 ${maturity}% · ${cropReady} 棵可摘</p>
        </div>
        <span class="chip">${online ? "在线" : "离线"}</span>
      </div>
    `;
  }).join("");
}

function cropProgressFor(plot) {
  if (!plot.crop) return 0;
  return clamp((now() - plot.plantedAt) * (plot.watered ? 1.18 : 1) / plot.growMs, 0, 1);
}

function itemName(key) {
  const mutation = isMutation(key);
  const raw = mutation ? key.replace("mut_", "") : key;
  return `${mutation ? "✨变异" : ""}${crops[raw]?.name || raw}`;
}

function isMutation(key) {
  return key.startsWith("mut_");
}

function defaultPrice(key) {
  const raw = key.replace("mut_", "");
  const base = crops[raw]?.sell || 10;
  return isMutation(key) ? base * 60 : base;
}

function timeAgo(ts) {
  const diff = Math.max(0, now() - (ts || 0));
  if (diff < ONLINE_WINDOW) return "刚刚";
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}分钟前`;
  return `${Math.floor(min / 60)}小时前`;
}

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop(frameTime) {
  const dt = Math.min(0.04, (frameTime - lastFrame) / 1000);
  lastFrame = frameTime;
  t += dt;
  updateParticles(dt);
  draw();
  requestAnimationFrame(loop);
}

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#afe9ff");
  sky.addColorStop(0.46, "#dff5c8");
  sky.addColorStop(1, "#ffd993");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  drawClouds(w);
  drawFarmBase(w, h);
  drawPlots(w, h);
  drawParticles();
  drawHudHint(w, h);
}

function drawClouds(w) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 4; i += 1) {
    const x = ((t * 12 + i * 180) % (w + 220)) - 100;
    const y = 82 + i * 38;
    ctx.fillStyle = "#ffffff";
    blob(x, y, 38, 0.52);
    blob(x + 38, y - 10, 52, 0.52);
    blob(x + 85, y, 35, 0.52);
  }
  ctx.restore();
}

function drawFarmBase(w, h) {
  ctx.save();
  ctx.translate(w / 2, h * 0.54);
  ctx.fillStyle = "#79c86b";
  roundRect(-w * 0.58, -h * 0.18, w * 1.16, h * 0.58, 34, true);
  ctx.fillStyle = "rgba(255,255,255,.18)";
  for (let i = 0; i < 28; i += 1) {
    const x = Math.sin(i * 12.91) * w * 0.5;
    const y = -h * 0.15 + ((i * 37) % (h * 0.5));
    ctx.fillRect(x, y, 12, 3);
  }
  ctx.fillStyle = "#b97a45";
  roundRect(-w * 0.45, h * 0.18, w * 0.9, h * 0.16, 28, true);
  ctx.restore();
}

function drawPlots(w, h) {
  if (!player) return;
  const cols = w < 420 ? 3 : 4;
  const size = Math.min((w - 42) / cols, 92);
  const gap = Math.min(12, size * 0.14);
  const rows = Math.ceil(12 / cols);
  const totalW = cols * size + (cols - 1) * gap;
  const startX = (w - totalW) / 2;
  const startY = Math.max(128, h * 0.25);
  player.plots.forEach((plot, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (size + gap);
    const y = startY + row * (size + gap);
    drawPlot(plot, x, y, size, i);
  });
}

function drawPlot(plot, x, y, size, index) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(95,55,25,.18)";
  roundRect(4, 8, size, size, 22, true);
  const soil = ctx.createLinearGradient(0, 0, 0, size);
  soil.addColorStop(0, "#9d663b");
  soil.addColorStop(1, "#704126");
  ctx.fillStyle = soil;
  roundRect(0, 0, size, size, 22, true);
  ctx.strokeStyle = "rgba(255,239,195,.34)";
  ctx.lineWidth = 2;
  for (let k = 0; k < 4; k += 1) {
    ctx.beginPath();
    ctx.moveTo(12, 18 + k * size / 5);
    ctx.quadraticCurveTo(size * 0.5, 10 + k * size / 5, size - 12, 18 + k * size / 5);
    ctx.stroke();
  }
  if (plot.crop) drawCrop(plot, size);
  else {
    ctx.fillStyle = "rgba(255,255,255,.38)";
    ctx.font = `900 ${Math.max(18, size * 0.22)}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("+", size / 2, size / 2 + 8);
  }
  const p = cropProgress(plot);
  if (plot.crop) {
    ctx.fillStyle = "rgba(0,0,0,.2)";
    roundRect(10, size - 14, size - 20, 7, 8, true);
    ctx.fillStyle = p >= 1 ? "#fff279" : "#78e06f";
    roundRect(10, size - 14, (size - 20) * p, 7, 8, true);
  }
  ctx.restore();
}

function drawCrop(plot, size) {
  const crop = crops[plot.crop];
  const p = cropProgress(plot);
  const [leaf, fruit] = crop.colors;
  ctx.save();
  ctx.translate(size / 2, size * 0.56);
  const stage = p < 0.34 ? 0.45 : p < 0.75 ? 0.72 : 1;
  ctx.scale(stage, stage);
  ctx.strokeStyle = leaf;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.quadraticCurveTo(i * 10, -8 - Math.abs(i) * 3 + Math.sin(t * 2 + i) * 2, i * 16, -24);
    ctx.stroke();
    ctx.fillStyle = i % 2 ? "#5fc96e" : leaf;
    ctx.beginPath();
    ctx.ellipse(i * 15, -22, 10, 6, i * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (p > 0.72) {
    ctx.fillStyle = fruit;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc((i - 1) * 14, -8 + Math.sin(t * 3 + i) * 1.5, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (plot.watered) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#8be9ff";
    ctx.beginPath();
    ctx.arc(24, 20, 4 + Math.sin(t * 4) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHudHint(w, h) {
  if (!player) return;
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "rgba(255,255,255,.8)";
  roundRect(18, h - 156, Math.min(w - 36, 390), 42, 20, true);
  ctx.fillStyle = "#3b4a2f";
  ctx.font = "800 13px system-ui";
  ctx.fillText("点击土地：空地播种，生长期浇水，成熟后采摘，长按/右键回收", 34, h - 130);
  ctx.restore();
}

function roundRect(x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) ctx.fill();
  else ctx.stroke();
}

function blob(x, y, r, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.65, y + 4, r * 0.78, 0, Math.PI * 2);
  ctx.arc(x - r * 0.56, y + 7, r * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function plotScreen(index) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const cols = w < 420 ? 3 : 4;
  const size = Math.min((w - 42) / cols, 92);
  const gap = Math.min(12, size * 0.14);
  const totalW = cols * size + (cols - 1) * gap;
  const startX = (w - totalW) / 2;
  const startY = Math.max(128, h * 0.25);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: startX + col * (size + gap) + size / 2, y: startY + row * (size + gap) + size / 2 };
}

function hitPlot(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const cols = w < 420 ? 3 : 4;
  const size = Math.min((w - 42) / cols, 92);
  const gap = Math.min(12, size * 0.14);
  const totalW = cols * size + (cols - 1) * gap;
  const startX = (w - totalW) / 2;
  const startY = Math.max(128, h * 0.25);
  for (let i = 0; i < 12; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const px = startX + col * (size + gap);
    const py = startY + row * (size + gap);
    if (x >= px && x <= px + size && y >= py && y <= py + size) return i;
  }
  return -1;
}

function burst(pos, color, count = 18) {
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    particles.push({ x: pos.x, y: pos.y, vx: Math.cos(a) * (40 + Math.random() * 140), vy: Math.sin(a) * (40 + Math.random() * 140), life: 0.55 + Math.random() * 0.45, max: 1, color, r: 3 + Math.random() * 5 });
  }
}

function splash(pos) {
  for (let i = 0; i < 16; i += 1) {
    particles.push({ x: pos.x, y: pos.y, vx: -40 + Math.random() * 80, vy: -80 - Math.random() * 70, life: 0.65, max: 0.65, color: "#74dfff", r: 2 + Math.random() * 3 });
  }
}

function updateParticles(dt) {
  particles = particles.filter((p) => {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 140 * dt;
    p.vx *= 0.98;
    return p.life > 0;
  });
}

function drawParticles() {
  particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

function bind() {
  $("#enterGame").addEventListener("click", start);
  $("#openSyncInfo").addEventListener("click", () => syncInfo.classList.remove("hidden"));
  $("#closeSyncInfo").addEventListener("click", () => syncInfo.classList.add("hidden"));
  $("#closeSheet").addEventListener("click", () => openPanel("garden"));
  document.querySelector(".dock").addEventListener("click", (event) => {
    const panel = event.target.closest("[data-panel]")?.dataset.panel;
    if (panel) openPanel(panel);
  });
  $("#seedStrip").addEventListener("click", (event) => {
    const seed = event.target.closest("[data-seed]")?.dataset.seed;
    if (seed) {
      selectedCrop = seed;
      renderSeeds();
    }
  });
  canvas.addEventListener("click", (event) => {
    if (!player) return;
    const i = hitPlot(event.clientX, event.clientY);
    if (i < 0) return;
    const plot = player.plots[i];
    if (!plot.crop) plant(i);
    else if (cropProgress(plot) >= 1) harvest(i);
    else water(i);
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const i = hitPlot(event.clientX, event.clientY);
    if (i >= 0) recycle(i);
  });
  let holdTimer = null;
  canvas.addEventListener("pointerdown", (event) => {
    const i = hitPlot(event.clientX, event.clientY);
    if (i >= 0) holdTimer = setTimeout(() => recycle(i), 620);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((name) => canvas.addEventListener(name, () => clearTimeout(holdTimer)));
  sheetBody.addEventListener("input", (event) => {
    if (event.target.id === "marketSearch") openMarket(event.target.value.trim());
  });
  sheetBody.addEventListener("click", (event) => {
    const listKey = event.target.closest("[data-list]")?.dataset.list;
    const delistId = event.target.closest("[data-delist]")?.dataset.delist;
    const buyId = event.target.closest("[data-buy]")?.dataset.buy;
    if (listKey) listItem(listKey, Number($(`#qty-${CSS.escape(listKey)}`).value), Number($(`#price-${CSS.escape(listKey)}`).value));
    if (delistId) delist(delistId);
    if (buyId) buy(buyId);
  });
  window.addEventListener("resize", resize);
  window.addEventListener("storage", syncFromStorage);
}

bind();
resize();
renderSeeds();
requestAnimationFrame(loop);
setInterval(heartbeat, 12_000);
setInterval(syncFromStorage, 5_000);
