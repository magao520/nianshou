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
const listingModal = $("#listingModal");
const listingTitle = $("#listingTitle");
const listingHint = $("#listingHint");
const listingQty = $("#listingQty");
const listingPrice = $("#listingPrice");

const SAVE_VERSION = 7;
const CLIENT_KEY = "cloudFarm.clientId.v1";
const LOCAL_PLAYER_KEY = "cloudFarm.player.v1";
const MUTATION_RATE = 1 / 1000;
const ONLINE_WINDOW = 90_000;
const RECENT_WINDOW = 10 * 60_000;
const art = {};

const crops = {
  carrot: { name: "胡萝卜", emoji: "🥕", growMs: 30 * 60_000, seedCost: 3, sell: 9, colors: ["#86c85a", "#ff9948"] },
  tomato: { name: "番茄", emoji: "🍅", growMs: 45 * 60_000, seedCost: 5, sell: 16, colors: ["#3fa65a", "#df493d"] },
  corn: { name: "甜玉米", emoji: "🌽", growMs: 60 * 60_000, seedCost: 8, sell: 28, colors: ["#78b64c", "#ffd45b"] },
  eggplant: { name: "茄子", emoji: "🍆", growMs: 90 * 60_000, seedCost: 12, sell: 42, colors: ["#4d9a5d", "#7b4bc0"] },
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
let listingItemKey = null;
let selectedBagKey = "";
let selectedListingId = "";
let selectedPlayerId = "";

[
  ["field", "./assets/2d/kenney/farm/dirtFarmland_E.png"],
  ["corn", "./assets/2d/kenney/farm/corn_E.png"],
  ["cornYoung", "./assets/2d/kenney/farm/cornYoung_S.png"],
  ["cornDouble", "./assets/2d/kenney/farm/cornDouble_E.png"],
  ["fenceN", "./assets/2d/kenney/farm/fenceHigh_N.png"],
  ["fenceS", "./assets/2d/kenney/farm/fenceHigh_S.png"],
  ["fenceW", "./assets/2d/kenney/farm/fenceHigh_W.png"],
  ["sack", "./assets/2d/kenney/farm/sack_N.png"],
  ["hay", "./assets/2d/kenney/farm/hayBalesStacked_W.png"],
  ["trash", "./assets/2d/kenney/game-icons/trashcanOpen.png"],
  ["market", "./assets/2d/kenney/game-icons/multiplayer.png"],
  ["medal", "./assets/2d/kenney/game-icons/medal1.png"],
].forEach(([key, src]) => {
  const img = new Image();
  img.src = src;
  art[key] = img;
});

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
    Object.values(raw.players).forEach((p) => {
      (p.plots || []).forEach((plot) => {
        if (plot.crop && crops[plot.crop] && plot.growMs < crops[plot.crop].growMs) plot.growMs = crops[plot.crop].growMs;
      });
    });
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
  room = "PUBLIC-FARM";
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
  openPanel("market");
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

function collectReady({ sell = false } = {}) {
  const ready = player.plots
    .map((plot, index) => ({ plot, index }))
    .filter(({ plot }) => plot.crop && cropProgress(plot) >= 1);
  if (!ready.length) return toast("暂无成熟蔬菜");
  let earned = 0;
  let harvested = 0;
  let mutations = 0;
  commit((draft) => {
    const p = draft.players[clientId];
    ready.forEach(({ plot, index }) => {
      const crop = crops[plot.crop];
      const mutated = Math.random() < MUTATION_RATE;
      if (sell) {
        earned += mutated ? crop.sell * 60 : crop.sell;
        p.coins += mutated ? crop.sell * 60 : crop.sell;
      } else {
        const key = mutated ? `mut_${plot.crop}` : plot.crop;
        p.inventory[key] = (p.inventory[key] || 0) + 1;
      }
      if (mutated) mutations += 1;
      harvested += 1;
      p.plots[index] = { id: `plot-${index}`, crop: null, plantedAt: 0, growMs: 0, watered: false, updatedAt: now() };
    });
    p.stats.harvests += harvested;
    p.stats.mutations += mutations;
    draft.events.push({ id: uid(), time: now(), text: sell ? `${p.name} 直接出售了 ${harvested} 棵成熟蔬菜` : `${p.name} 采摘了 ${harvested} 棵成熟蔬菜` });
  }, sell ? "sell-ready" : "harvest-ready");
  toast(sell ? `出售 ${harvested} 棵，获得 ${earned} 金币` : `采摘 ${harvested} 棵成熟蔬菜`);
}

function renderAll() {
  if (!player) return;
  $("#coinText").textContent = player.coins;
  $("#bagText").textContent = Object.values(player.inventory || {}).reduce((a, b) => a + b, 0);
  $("#syncText").textContent = `全服 ${db.rev || 0}`;
  renderSeeds();
  if (!sheet.classList.contains("hidden")) openPanel(activePanel);
}

function renderSeeds() {
  $("#seedStrip").innerHTML = Object.entries(crops).map(([key, crop]) => `
    <button class="seed ${selectedCrop === key ? "active" : ""}" data-seed="${key}">
      <span>${crop.emoji} ${crop.name}</span>
      <small>${Math.round(crop.growMs / 60000)}分钟成熟 · ${crop.seedCost}金币</small>
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
  if (!rows.length) {
    selectedBagKey = "";
    sheetBody.innerHTML = `<div class="card-row"><div><strong>背包是空的</strong><p>成熟后采摘蔬菜会进入背包。</p></div></div>`;
    return;
  }
  if (!selectedBagKey || !player.inventory[selectedBagKey]) selectedBagKey = rows[0][0];
  const selectedQty = player.inventory[selectedBagKey] || 0;
  sheetBody.innerHTML = `
    <div class="two-pane">
      <div class="pane-list">
        ${rows.map(([key, qty]) => `
          <button class="list-card ${selectedBagKey === key ? "active" : ""}" data-bag-select="${key}">
            <span>${itemIcon(key)} ${itemName(key)}</span><span class="chip">×${qty}</span>
          </button>
        `).join("")}
      </div>
      <div class="pane-detail">
        <div class="item-title"><span class="item-icon">${itemIcon(selectedBagKey)}</span><div><strong>${itemName(selectedBagKey)}</strong><p>${isMutation(selectedBagKey) ? "稀有变异蔬菜，可高价挂到集市。" : "普通蔬菜，可留存、交易或等待集市需求。"}</p></div></div>
        <span class="chip">库存 ×${selectedQty}</span>
        <button class="market-action primary-action" data-open-list="${selectedBagKey}">上架</button>
      </div>
    </div>
  `;
}

function openMarket(filter = "") {
  sheetTitle.textContent = "集市";
  const listings = Object.values(db.market || {})
    .filter((x) => itemName(x.item).includes(filter) || x.sellerName.includes(filter))
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!selectedListingId || !db.market[selectedListingId]) selectedListingId = listings[0]?.id || "";
  const selected = db.market[selectedListingId];
  sheetBody.innerHTML = `
    <input class="search" id="marketSearch" placeholder="搜索蔬菜或玩家..." value="${filter}" />
    <div class="two-pane">
      <div class="pane-list">
      ${listings.length ? listings.map((x) => `
        <button class="list-card ${selectedListingId === x.id ? "active" : ""}" data-market-select="${x.id}">
          <span>${itemIcon(x.item)} ${itemName(x.item)}</span><span class="chip">${x.price}金</span>
        </button>
      `).join("") : `<div class="card-row"><div><strong>暂无商品</strong><p>可以在背包里自由上架蔬菜或变异蔬菜。</p></div></div>`}
      </div>
      <div class="pane-detail">
        ${selected ? `
          <div class="item-title"><span class="item-icon">${itemIcon(selected.item)}</span><div><strong>${itemName(selected.item)}</strong><p>${selected.sellerName} · ${timeAgo(selected.createdAt)}上架</p></div></div>
          <span class="chip">数量 ×${selected.qty}</span>
          <span class="chip">价格 ${selected.price} 金币</span>
          ${selected.sellerId === clientId
            ? `<button class="market-action" data-delist="${selected.id}">下架</button>`
            : `<button class="market-action primary-action" data-buy="${selected.id}">购买</button>`}
        ` : `<strong>选择商品</strong><p>左侧选择商品查看详情。</p>`}
      </div>
    </div>
  `;
}

function openPlayers() {
  sheetTitle.textContent = "玩家";
  const players = Object.values(db.players || {}).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  if (!selectedPlayerId || !db.players[selectedPlayerId]) selectedPlayerId = players[0]?.id || "";
  const detail = db.players[selectedPlayerId];
  const list = players.map((p) => {
    const online = now() - (p.lastSeen || 0) < ONLINE_WINDOW;
    const cropReady = (p.plots || []).filter((plot) => plot.crop && cropProgressFor(plot) >= 1).length;
    const cropGrowing = (p.plots || []).filter((plot) => plot.crop).length;
    const progressList = (p.plots || []).filter((plot) => plot.crop).map((plot) => cropProgressFor(plot));
    const maturity = progressList.length ? Math.round(progressList.reduce((a, b) => a + b, 0) / progressList.length * 100) : 0;
    return `
      <button class="list-card ${selectedPlayerId === p.id ? "active" : ""}" data-player-select="${p.id}">
        <span>${p.name}${p.id === clientId ? "（你）" : ""}</span><span class="chip">${online ? "在线" : "离线"}</span>
      </button>
    `;
  }).join("");
  const online = detail && now() - (detail.lastSeen || 0) < ONLINE_WINDOW;
  const growing = detail ? (detail.plots || []).filter((plot) => plot.crop).length : 0;
  const ready = detail ? (detail.plots || []).filter((plot) => plot.crop && cropProgressFor(plot) >= 1).length : 0;
  const progressList = detail ? (detail.plots || []).filter((plot) => plot.crop).map((plot) => cropProgressFor(plot)) : [];
  const maturity = progressList.length ? Math.round(progressList.reduce((a, b) => a + b, 0) / progressList.length * 100) : 0;
  sheetBody.innerHTML = `
    <div class="two-pane">
      <div class="pane-list">${list}</div>
      <div class="pane-detail">
        ${detail ? `
          <strong>${detail.name}${detail.id === clientId ? "（你）" : ""}</strong>
          <span class="chip">${online ? "在线" : `${timeAgo(detail.lastSeen)}在线`}</span>
          <p>生长中：${growing} 棵</p>
          <p>平均成熟：${maturity}%</p>
          <p>可采摘：${ready} 棵</p>
          <p>累计采摘：${detail.stats?.harvests || 0} 次</p>
        ` : `<strong>暂无玩家</strong>`}
      </div>
    </div>
  `;
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

function itemIcon(key) {
  const raw = key.replace("mut_", "");
  const icon = crops[raw]?.emoji || "🥬";
  return isMutation(key) ? `✨${icon}` : icon;
}

function isMutation(key) {
  return key.startsWith("mut_");
}

function defaultPrice(key) {
  const raw = key.replace("mut_", "");
  const base = crops[raw]?.sell || 10;
  return isMutation(key) ? base * 60 : base;
}

function openListingModal(key) {
  listingItemKey = key;
  listingTitle.textContent = `上架 ${itemName(key)}`;
  listingHint.textContent = `库存 ${player.inventory[key] || 0} 个，设置数量和价格后上架到集市。`;
  listingQty.value = "1";
  listingPrice.value = String(defaultPrice(key));
  listingModal.classList.remove("hidden");
}

function closeListingModal() {
  listingItemKey = null;
  listingModal.classList.add("hidden");
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
  const grass = ctx.createLinearGradient(0, -h * 0.2, 0, h * 0.42);
  grass.addColorStop(0, "#91db78");
  grass.addColorStop(0.58, "#65bd65");
  grass.addColorStop(1, "#4fa858");
  ctx.fillStyle = grass;
  roundRect(-w * 0.58, -h * 0.19, w * 1.16, h * 0.6, 38, true);
  ctx.fillStyle = "rgba(255,255,255,.16)";
  for (let i = 0; i < 34; i += 1) {
    const x = Math.sin(i * 12.91) * w * 0.52;
    const y = -h * 0.16 + ((i * 37) % (h * 0.54));
    ctx.fillRect(x, y, 11, 3);
  }
  drawFarmDecoration(w, h);
  const path = ctx.createLinearGradient(0, h * 0.16, 0, h * 0.34);
  path.addColorStop(0, "#c8884c");
  path.addColorStop(1, "#a76538");
  ctx.fillStyle = path;
  roundRect(-w * 0.46, h * 0.18, w * 0.92, h * 0.16, 30, true);
  ctx.restore();
}

function drawFarmDecoration(w, h) {
  const img = (key) => art[key]?.complete ? art[key] : null;
  const drawImg = (key, x, y, size) => {
    const asset = img(key);
    if (!asset) return;
    const ratio = asset.width / asset.height || 1;
    ctx.drawImage(asset, x, y, size * ratio, size);
  };
  for (let i = 0; i < 5; i += 1) drawImg("fenceN", -w * 0.48 + i * 58, -h * 0.17, 42);
  for (let i = 0; i < 5; i += 1) drawImg("fenceS", w * 0.18 + i * 50, -h * 0.17, 42);
  drawImg("hay", -w * 0.43, h * 0.08, 64);
  drawImg("sack", w * 0.32, h * 0.05, 54);
  drawImg("cornDouble", -w * 0.48, -h * 0.04, 64);
  drawImg("cornDouble", w * 0.38, -h * 0.02, 64);
}

function drawPlots(w, h) {
  if (!player) return;
  const cols = 4;
  const size = Math.min((w - 42) / cols, 82);
  const gap = Math.min(10, size * 0.12);
  const rows = Math.ceil(12 / cols);
  const totalW = cols * size + (cols - 1) * gap;
  const startX = (w - totalW) / 2;
  const startY = Math.max(104, h * 0.16);
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
  roundRect(4, 8, size, size, 24, true);
  const soil = ctx.createLinearGradient(0, 0, 0, size);
  soil.addColorStop(0, "#b87945");
  soil.addColorStop(0.52, "#8e5731");
  soil.addColorStop(1, "#633a22");
  ctx.fillStyle = soil;
  roundRect(0, 0, size, size, 22, true);
  ctx.strokeStyle = "rgba(255,239,195,.22)";
  ctx.lineWidth = 2;
  for (let k = 0; k < 5; k += 1) {
    ctx.beginPath();
    ctx.moveTo(12, 14 + k * size / 6);
    ctx.bezierCurveTo(size * 0.35, 6 + k * size / 6, size * 0.68, 22 + k * size / 6, size - 12, 14 + k * size / 6);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(77,43,24,.24)";
  ctx.lineWidth = 1;
  roundRect(2, 2, size - 4, size - 4, 20, false);
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
  if (plot.crop === "corn" && art.corn?.complete) {
    const asset = p > 0.72 ? art.cornDouble : p > 0.34 ? art.corn : art.cornYoung;
    if (asset?.complete) {
      const scale = p < 0.34 ? 0.58 : p < 0.72 ? 0.78 : 1;
      ctx.drawImage(asset, -size * 0.32 * scale, -size * 0.52 * scale, size * 0.64 * scale, size * 0.72 * scale);
      ctx.restore();
      return;
    }
  }
  const stage = p < 0.34 ? 0.45 : p < 0.75 ? 0.72 : 1;
  ctx.scale(stage, stage);
  drawCropShape(plot.crop, leaf, fruit, p);
  if (plot.watered) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#8be9ff";
    ctx.beginPath();
    ctx.arc(24, 20, 4 + Math.sin(t * 4) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCropShape(type, leaf, fruit, p) {
  ctx.strokeStyle = leaf;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.quadraticCurveTo(i * 9, -8 - Math.abs(i) * 3 + Math.sin(t * 2 + i) * 2, i * 15, -24);
    ctx.stroke();
    ctx.fillStyle = i % 2 ? "#5fc96e" : leaf;
    ctx.beginPath();
    ctx.ellipse(i * 14, -22, 10, 6, i * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (p <= 0.72) return;
  if (type === "carrot") {
    ctx.fillStyle = fruit;
    [-12, 0, 12].forEach((x, i) => {
      ctx.beginPath();
      ctx.moveTo(x - 7, -5);
      ctx.quadraticCurveTo(x, 22 + i * 2, x + 7, -5);
      ctx.fill();
    });
    return;
  }
  if (type === "tomato") {
    ctx.fillStyle = fruit;
    [-13, 0, 13].forEach((x, i) => {
      ctx.beginPath();
      ctx.arc(x, -8 + Math.sin(t * 3 + i), 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#53a653";
      ctx.fillRect(x - 2, -18, 4, 5);
      ctx.fillStyle = fruit;
    });
    return;
  }
  if (type === "eggplant") {
    ctx.fillStyle = fruit;
    [-10, 9].forEach((x, i) => {
      ctx.save();
      ctx.translate(x, -4 + i * 2);
      ctx.rotate(i ? 0.22 : -0.18);
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5bb85e";
      ctx.beginPath();
      ctx.moveTo(-6, -15);
      ctx.lineTo(0, -24);
      ctx.lineTo(6, -15);
      ctx.fill();
      ctx.restore();
    });
    return;
  }
  ctx.fillStyle = fruit;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc((i - 1) * 14, -8 + Math.sin(t * 3 + i) * 1.5, 8, 0, Math.PI * 2);
    ctx.fill();
  }
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
  const cols = 4;
  const size = Math.min((w - 42) / cols, 82);
  const gap = Math.min(10, size * 0.12);
  const totalW = cols * size + (cols - 1) * gap;
  const startX = (w - totalW) / 2;
  const startY = Math.max(104, h * 0.16);
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
  const cols = 4;
  const size = Math.min((w - 42) / cols, 82);
  const gap = Math.min(10, size * 0.12);
  const totalW = cols * size + (cols - 1) * gap;
  const startX = (w - totalW) / 2;
  const startY = Math.max(104, h * 0.16);
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
  $("#closeSheet").addEventListener("click", () => openPanel("garden"));
  $("#seedToggle").addEventListener("click", () => {
    $("#seedStrip").classList.toggle("open");
    $("#actionTray").classList.remove("open");
    document.querySelector(".dock").classList.remove("open");
  });
  $("#toolToggle").addEventListener("click", () => {
    $("#actionTray").classList.toggle("open");
    $("#seedStrip").classList.remove("open");
    document.querySelector(".dock").classList.remove("open");
  });
  $("#menuToggle").addEventListener("click", () => {
    document.querySelector(".dock").classList.toggle("open");
    $("#seedStrip").classList.remove("open");
    $("#actionTray").classList.remove("open");
  });
  $("#closeTrays").addEventListener("click", () => {
    $("#seedStrip").classList.remove("open");
    $("#actionTray").classList.remove("open");
    document.querySelector(".dock").classList.remove("open");
  });
  $("#harvestReady").addEventListener("click", () => collectReady({ sell: false }));
  $("#sellReady").addEventListener("click", () => collectReady({ sell: true }));
  $("#closeListingModal").addEventListener("click", closeListingModal);
  $("#confirmListing").addEventListener("click", () => {
    if (!listingItemKey) return;
    listItem(listingItemKey, Number(listingQty.value), Number(listingPrice.value));
    closeListingModal();
  });
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
    const openListKey = event.target.closest("[data-open-list]")?.dataset.openList;
    const bagSelect = event.target.closest("[data-bag-select]")?.dataset.bagSelect;
    const delistId = event.target.closest("[data-delist]")?.dataset.delist;
    const buyId = event.target.closest("[data-buy]")?.dataset.buy;
    const marketSelect = event.target.closest("[data-market-select]")?.dataset.marketSelect;
    const playerSelect = event.target.closest("[data-player-select]")?.dataset.playerSelect;
    if (listKey) listItem(listKey, Number($(`#qty-${CSS.escape(listKey)}`).value), Number($(`#price-${CSS.escape(listKey)}`).value));
    if (openListKey) openListingModal(openListKey);
    if (bagSelect) { selectedBagKey = bagSelect; openBag(); }
    if (delistId) delist(delistId);
    if (buyId) buy(buyId);
    if (marketSelect) { selectedListingId = marketSelect; openMarket($("#marketSearch")?.value.trim() || ""); }
    if (playerSelect) { selectedPlayerId = playerSelect; openPlayers(); }
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
