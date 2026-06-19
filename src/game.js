const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const now = () => Date.now();
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TAU = Math.PI * 2;

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
const CARD_BASE = "./assets/vendor/kenney/cards/";
const AUDIO = {
  case: "./assets/vendor/kenney/audio/dice-shake-3.ogg",
  win: "./assets/vendor/kenney/audio/chips-stack-6.ogg",
  trash: "./assets/vendor/kenney/audio/chips-handle-1.ogg",
  deal: "./assets/vendor/kenney/audio/card-slide-1.ogg",
  place: "./assets/vendor/kenney/audio/card-place-1.ogg",
  shuffle: "./assets/vendor/kenney/audio/card-shuffle.ogg",
  open: "./assets/vendor/kenney/audio/cards-pack-open-1.ogg",
};

const crops = {
  carrot: { name: "胡萝卜", emoji: "🥕", growMs: 30 * 60_000, seedCost: 3, sell: 9, colors: ["#86c85a", "#ff9948"] },
  tomato: { name: "番茄", emoji: "🍅", growMs: 45 * 60_000, seedCost: 5, sell: 16, colors: ["#3fa65a", "#df493d"] },
  corn: { name: "甜玉米", emoji: "🌽", growMs: 60 * 60_000, seedCost: 8, sell: 28, colors: ["#78b64c", "#ffd45b"] },
  watermelon: { name: "西瓜", emoji: "🍉", growMs: 75 * 60_000, seedCost: 10, sell: 36, colors: ["#55b95f", "#2f9d4c"] },
  eggplant: { name: "茄子", emoji: "🍆", growMs: 90 * 60_000, seedCost: 12, sell: 42, colors: ["#4d9a5d", "#7b4bc0"] },
};

const prizes = {
  prize_super_mutation: { name: "超级变异植物", emoji: "🌈", value: 900, tier: "特等奖" },
  prize_rare_seed: { name: "高价值农作物种子", emoji: "💎", value: 520, tier: "特等奖" },
  prize_gift_box: { name: "农产品礼盒", emoji: "🎁", value: 220, tier: "一等奖" },
  prize_seed_box: { name: "普通种子盲盒", emoji: "📦", value: 80, tier: "二等奖" },
  prize_postcard: { name: "农场文创卡", emoji: "🎨", value: 60, tier: "二等奖" },
  prize_straw: { name: "一捆烂稻草", emoji: "🧹", value: 2, tier: "参与奖" },
  prize_mud: { name: "一坨农业泥巴", emoji: "🟤", value: 1, tier: "参与奖" },
  prize_broken_boot: { name: "破胶靴", emoji: "🥾", value: 3, tier: "参与奖" },
};

const lotteryPool = [
  { tier: "特等奖", chance: 0.001, items: ["prize_super_mutation", "prize_rare_seed"] },
  { tier: "一等奖", chance: 0.002, items: ["prize_gift_box"] },
  { tier: "二等奖", chance: 0.002, items: ["prize_seed_box", "prize_postcard"] },
  { tier: "参与奖", chance: 0.995, items: ["prize_straw", "prize_mud", "prize_broken_boot"] },
];

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
let bagCategory = "crops";
let selectedListingId = "";
let selectedPlayerId = "";
let lotterySpinning = false;
let lotteryReels = ["🥕", "🌽", "🍅"];
let lotteryMessage = "10 金币摇一次，奖品会进入背包奖品页。";
let lotteryCaseItems = [];
let lotteryCaseOffset = 0;
let lotteryPrize = null;
let blackjack = null;

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
  playSound("place");
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
  if (!ready.length) {
    if (sell) return sellInventoryCrops();
    return toast("暂无成熟蔬菜");
  }
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

function sellInventoryItem(key, qty = player.inventory[key] || 0) {
  qty = Math.max(1, Math.floor(qty));
  if (!player.inventory[key] || player.inventory[key] < qty) return toast("库存不足");
  const price = defaultPrice(key);
  const earned = price * qty;
  commit((draft) => {
    const p = draft.players[clientId];
    p.inventory[key] -= qty;
    if (p.inventory[key] <= 0) delete p.inventory[key];
    p.coins += earned;
    draft.events.push({ id: uid(), time: now(), text: `${p.name} 直接出售了 ${qty} 个${itemName(key)}` });
  }, "sell-inventory");
  toast(`出售 ${qty} 个${itemName(key)}，获得 ${earned} 金币`);
  if (activePanel === "bag") openBag();
}

function sellInventoryCrops() {
  const rows = Object.entries(player.inventory || {}).filter(([key]) => !isPrize(key));
  if (!rows.length) return toast("暂无成熟地块，也没有可出售的背包蔬菜");
  bagCategory = "crops";
  selectedBagKey = rows[0][0];
  openPanel("bag");
  toast("选择农作物并输入数量后出售，不会再一键卖光");
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
  closeDrawers();
  document.querySelectorAll(".dock button").forEach((btn) => btn.classList.toggle("active", btn.dataset.panel === panel));
  if (panel === "garden") {
    sheet.classList.add("hidden");
    sheet.classList.remove("blackjack-sheet");
    return;
  }
  sheet.classList.remove("hidden");
  sheet.classList.toggle("blackjack-sheet", panel === "blackjack");
  if (panel === "bag") openBag();
  if (panel === "market") openMarket();
  if (panel === "players") openPlayers();
  if (panel === "lottery") openLottery();
  if (panel === "blackjack") openBlackjack();
}

function openBag() {
  sheetTitle.textContent = "背包";
  const rows = Object.entries(player.inventory || {}).filter(([key]) => bagCategory === "prizes" ? isPrize(key) : !isPrize(key));
  if (!rows.length) {
    selectedBagKey = "";
    sheetBody.innerHTML = `
      <div class="tabs"><button class="${bagCategory === "crops" ? "active" : ""}" data-bag-tab="crops">农作物</button><button class="${bagCategory === "prizes" ? "active" : ""}" data-bag-tab="prizes">奖品</button></div>
      <div class="card-row"><div><strong>${bagCategory === "prizes" ? "奖品页是空的" : "农作物页是空的"}</strong><p>${bagCategory === "prizes" ? "摇摇乐抽到的奖品会放在这里。" : "成熟后采摘蔬菜会进入这里。"}</p></div></div>`;
    return;
  }
  if (!selectedBagKey || !player.inventory[selectedBagKey]) selectedBagKey = rows[0][0];
  const selectedQty = player.inventory[selectedBagKey] || 0;
  sheetBody.innerHTML = `
    <div class="tabs"><button class="${bagCategory === "crops" ? "active" : ""}" data-bag-tab="crops">农作物</button><button class="${bagCategory === "prizes" ? "active" : ""}" data-bag-tab="prizes">奖品</button></div>
    <div class="two-pane">
      <div class="pane-list">
        ${rows.map(([key, qty]) => `
          <button class="list-card ${selectedBagKey === key ? "active" : ""}" data-bag-select="${key}">
            <span>${itemIcon(key)} ${itemName(key)}</span><span class="chip">×${qty}</span>
          </button>
        `).join("")}
      </div>
      <div class="pane-detail">
        <div class="item-title"><span class="item-icon">${itemIcon(selectedBagKey)}</span><div><strong>${itemName(selectedBagKey)}</strong><p>${itemDescription(selectedBagKey)}</p></div></div>
        <span class="chip">库存 ×${selectedQty}</span>
        ${!isPrize(selectedBagKey) ? `<div class="sell-row"><input id="sellQty-${selectedBagKey}" inputmode="numeric" value="1" min="1" max="${selectedQty}" aria-label="出售数量" /><button class="market-action" data-sell-item="${selectedBagKey}">出售选定数量</button></div>` : ""}
        <button class="market-action primary-action" data-open-list="${selectedBagKey}">上架</button>
      </div>
    </div>
  `;
}

function openLottery() {
  sheetTitle.textContent = "摇摇乐";
  if (!lotteryCaseItems.length) lotteryCaseItems = makeCaseItems();
  sheetBody.innerHTML = `
    <div class="lottery-layout">
      <div class="case-machine ${lotterySpinning ? "spinning" : ""}">
        <div class="slot-title">云上开盒摇摇乐</div>
        <div class="case-window">
          <div class="case-marker"></div>
          <div class="case-track" style="transform: translateX(${lotteryCaseOffset}px)">
            ${lotteryCaseItems.map((key) => `<span class="case-item ${prizeClass(key)}"><b>${itemIcon(key)}</b><em>${itemName(key).replace("·", "<br>")}</em></span>`).join("")}
          </div>
        </div>
        <p>${lotteryMessage}</p>
        <button class="market-action primary-action" id="spinLottery" ${lotterySpinning ? "disabled" : ""}>10 金币摇一次</button>
      </div>
      <div class="prize-table">
        <div><strong>🏆 奖池</strong><span>特等奖 1/1000：超级变异植物 / 高价值种子</span></div>
        <div><strong>一等奖</strong><span>1/500：农产品礼盒</span></div>
        <div><strong>二等奖</strong><span>0.2%：文创 / 普通种子盲盒</span></div>
        <div><strong>参与奖</strong><span>农业垃圾，也能进背包和上架</span></div>
      </div>
    </div>
  `;
}

function openBlackjack() {
  sheetTitle.textContent = "老王的二十一点";
  if (!blackjack) blackjack = freshBlackjack();
  sheetBody.innerHTML = renderBlackjack();
}

function rollLotteryPrize() {
  const r = Math.random();
  let acc = 0;
  const tier = lotteryPool.find((x) => {
    acc += x.chance;
    return r <= acc;
  }) || lotteryPool[lotteryPool.length - 1];
  const key = tier.items[Math.floor(Math.random() * tier.items.length)];
  return { key, tier: tier.tier, icon: itemIcon(key), name: itemName(key) };
}

function prizeClass(key) {
  if (["prize_super_mutation", "prize_rare_seed"].includes(key)) return "legendary";
  if (key === "prize_gift_box") return "rare";
  if (["prize_seed_box", "prize_postcard"].includes(key)) return "uncommon";
  return "common";
}

function makeCaseItems(winningKey = null) {
  const weighted = [
    "prize_straw", "prize_mud", "prize_broken_boot", "prize_straw", "prize_mud",
    "prize_seed_box", "prize_postcard", "prize_gift_box", "prize_rare_seed", "prize_super_mutation",
  ];
  const items = Array.from({ length: 48 }, (_, i) => weighted[(Math.random() * weighted.length + i) % weighted.length | 0]);
  if (winningKey) items[39] = winningKey;
  return items;
}

function spinLottery() {
  if (lotterySpinning) return;
  if (player.coins < 10) return toast("金币不够，摇摇乐需要 10 金币");
  lotterySpinning = true;
  lotteryPrize = rollLotteryPrize();
  lotteryCaseItems = makeCaseItems(lotteryPrize.key);
  lotteryCaseOffset = 0;
  lotteryMessage = "箱子开始滚动，盯紧中线...";
  openLottery();
  playSound("case");
  const itemWidth = 96;
  const targetIndex = 39;
  const finalOffset = -(targetIndex * itemWidth - 104) - Math.random() * 28;
  const started = performance.now();
  const duration = 3600;
  const tick = () => {
    const p = clamp((performance.now() - started) / duration, 0, 1);
    const ease = 1 - Math.pow(1 - p, 4);
    lotteryCaseOffset = Math.round(finalOffset * ease + Math.sin(p * 58) * (1 - p) * 16);
    if (activePanel === "lottery") openLottery();
    if (p < 1) requestAnimationFrame(tick);
    else {
      commit((draft) => {
        const p = draft.players[clientId];
        p.coins -= 10;
        p.inventory[lotteryPrize.key] = (p.inventory[lotteryPrize.key] || 0) + 1;
        draft.events.push({ id: uid(), time: now(), text: `${p.name} 摇摇乐抽到 ${lotteryPrize.name}` });
      }, "lottery");
      lotteryMessage = `${lotteryPrize.tier}！获得 ${lotteryPrize.name}，已存入背包奖品页。`;
      lotterySpinning = false;
      playSound(lotteryPrize.tier === "参与奖" ? "trash" : "win");
      if (activePanel === "lottery") openLottery();
    }
  };
  requestAnimationFrame(tick);
}

function playSound(type) {
  const src = AUDIO[type];
  if (src) {
    const audio = new Audio(src);
    audio.volume = type === "case" ? 0.42 : 0.58;
    audio.play().catch(() => playTone(type));
    return;
  }
  playTone(type);
}

function playTone(type) {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const freq = type === "win" ? 720 : type === "trash" ? 180 : 380;
    osc.type = type === "slot" ? "square" : "sine";
    osc.frequency.setValueAtTime(freq, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(type === "win" ? 1080 : freq * 1.25, audio.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.22);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.24);
  } catch {}
}

function freshBlackjack() {
  return { active: false, bet: 10, deck: [], player: [], dealer: [], phase: "idle", message: "选择下注金币，老王会先发牌。", revealDealer: false, outcome: "", fx: "" };
}

function makeDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = suits.flatMap((suit) => ranks.map((rank) => ({ suit, rank })));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  cards.forEach((card) => {
    if (card.rank === "A") { total += 11; aces += 1; }
    else total += ["K", "Q", "J"].includes(card.rank) ? 10 : Number(card.rank);
  });
  while (total > 21 && aces) { total -= 10; aces -= 1; }
  return total;
}

function startBlackjackRound(bet) {
  bet = Math.max(1, Math.floor(bet));
  if (player.coins < bet) return toast("金币不足，无法下注");
  const deck = makeDeck();
  blackjack = {
    active: true,
    bet,
    deck,
    player: [deck.pop(), deck.pop()],
    dealer: [deck.pop(), deck.pop()],
    phase: "player",
    revealDealer: false,
    outcome: "",
    fx: "deal",
    message: `你下注 ${bet} 金币。${huangTaunt(0)}`,
  };
  commit((draft) => { draft.players[clientId].coins -= bet; }, "blackjack-bet");
  playSound("shuffle");
  openBlackjack();
}

function blackjackHit() {
  if (!blackjack || blackjack.phase !== "player") return;
  blackjack.player.push(blackjack.deck.pop());
  blackjack.fx = "hit";
  blackjack.message = `你拿到一张新牌。${huangTaunt(handValue(blackjack.player))}`;
  playSound("deal");
  if (handValue(blackjack.player) > 21) settleBlackjack("lose");
  else openBlackjack();
}

function blackjackStand() {
  if (!blackjack || blackjack.phase !== "player") return;
  blackjack.phase = "dealer";
  blackjack.revealDealer = true;
  blackjack.fx = "stand";
  playSound("place");
  while (handValue(blackjack.dealer) < 17) blackjack.dealer.push(blackjack.deck.pop());
  const pv = handValue(blackjack.player);
  const dv = handValue(blackjack.dealer);
  if (dv > 21 || pv > dv) settleBlackjack("win");
  else if (pv === dv) settleBlackjack("push");
  else settleBlackjack("lose");
}

function settleBlackjack(result) {
  blackjack.phase = "done";
  blackjack.revealDealer = true;
  blackjack.outcome = result;
  const bet = blackjack.bet;
  const payout = result === "win" ? bet * 2 : result === "push" ? bet : 0;
  if (payout > 0) commit((draft) => { draft.players[clientId].coins += payout; }, "blackjack-payout");
  blackjack.message = result === "win" ? `你赢了老王！返还 ${payout} 金币。老王嘴硬：这把算你运气好。` : result === "push" ? "平局，退回下注。老王：差一点你就没了。" : "老王赢了，这局没收获。老王：还要继续证明自己吗？";
  playSound(result === "win" ? "win" : "trash");
  openBlackjack();
}

function huangTaunt(value) {
  if (!value) return "老王眯着眼说：先发两张，别怂。";
  if (value <= 10) return "老王敲着桌子：这点数还停？你自己信吗？";
  if (value <= 15) return "老王笑了：不上不下，最折磨人。";
  if (value <= 17) return "老王压低声音：再要一张可能起飞，也可能爆。";
  if (value <= 20) return "老王盯着你：现在停？还是贪一手？";
  return "老王摊手：爆了吧，年轻人。";
}

function renderBlackjack() {
  const b = blackjack;
  const dealerCards = b.dealer.map((card, i) => cardHtml(card, i === 1 && !b.revealDealer)).join("");
  const playerCards = b.player.map((card) => cardHtml(card, false)).join("");
  const playerValue = b.player.length ? handValue(b.player) : 0;
  const dealerValue = b.revealDealer ? handValue(b.dealer) : 0;
  return `
    <div class="blackjack-table">
      <div class="blackjack-hero">
        <div class="huang-card">
          <div class="huang-avatar"><span class="huang-hat"></span><span class="huang-face"></span><span class="huang-mustache"></span></div>
          <div><strong>农场主老王</strong><p>老王把牌桌支在隔壁牧场，边发牌边给你上压力。</p></div>
        </div>
        <div class="bet-row">
          <label>下注<input id="bjBet" inputmode="numeric" value="${b.bet || 10}" ${b.phase !== "idle" && b.phase !== "done" ? "disabled" : ""}></label>
          <button class="market-action primary-action" data-bj="deal">${b.phase === "done" ? "再来一局" : "发牌"}</button>
        </div>
      </div>
      <div class="bj-scorebar">
        <span>你：${playerValue || "待发牌"}${playerValue ? "点" : ""}</span>
        <span>老王：${dealerValue ? `${dealerValue}点` : "暗牌"}</span>
        <span>下注：${b.bet || 10}</span>
      </div>
      <div class="bj-board">
        <div class="card-zone dealer-zone">
          <strong>老王的牌</strong>
          <div class="cards">${dealerCards || `<span class="empty-card">待发牌</span>`}</div>
        </div>
        <div class="card-zone player-zone">
          <strong>你的牌</strong>
          <div class="cards">${playerCards || `<span class="empty-card">待发牌</span>`}</div>
        </div>
      </div>
      <p class="bj-message ${b.outcome ? `result-${b.outcome}` : ""}">${b.message}</p>
      <div class="bj-actions">
        <button class="market-action" data-bj="hit" ${b.phase !== "player" ? "disabled" : ""}>要牌</button>
        <button class="market-action primary-action" data-bj="stand" ${b.phase !== "player" ? "disabled" : ""}>停牌/交牌</button>
        <button class="market-action" data-bj="peek" ${b.phase !== "player" ? "disabled" : ""}>看牌</button>
      </div>
    </div>
  `;
}

function cardHtml(card, hidden) {
  if (hidden) return `<span class="bj-card img-card"><img src="${CARD_BASE}card_back.png" alt="暗牌"></span>`;
  return `<span class="bj-card img-card"><img src="${cardAsset(card)}" alt="${card.rank}${card.suit}"></span>`;
}

function cardAsset(card) {
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[card.suit];
  const rank = { A: "A", K: "K", Q: "Q", J: "J", "10": "10", "9": "09", "8": "08", "7": "07", "6": "06", "5": "05", "4": "04", "3": "03", "2": "02" }[card.rank];
  return `${CARD_BASE}card_${suit}_${rank}.png`;
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
  if (prizes[key]) return `${prizes[key].tier}·${prizes[key].name}`;
  const mutation = isMutation(key);
  const raw = mutation ? key.replace("mut_", "") : key;
  return `${mutation ? "✨变异" : ""}${crops[raw]?.name || raw}`;
}

function itemIcon(key) {
  if (prizes[key]) return prizes[key].emoji;
  const raw = key.replace("mut_", "");
  const icon = crops[raw]?.emoji || "🥬";
  return isMutation(key) ? `✨${icon}` : icon;
}

function isMutation(key) {
  return key.startsWith("mut_");
}

function isPrize(key) {
  return key.startsWith("prize_");
}

function itemDescription(key) {
  if (prizes[key]) return `${prizes[key].tier}奖品，参考价值 ${prizes[key].value} 金币，可收藏或上架集市。`;
  if (isMutation(key)) return "稀有变异蔬菜，可高价挂到集市。";
  return "普通蔬菜，可留存、交易或等待集市需求。";
}

function defaultPrice(key) {
  if (prizes[key]) return prizes[key].value;
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
  drawSkyFlow(w, h);
  drawClouds(w);
  drawBirds(w, h);
  drawFarmBase(w, h);
  drawAnimals(w, h);
  drawPlots(w, h);
  drawParticles();
  drawHudHint(w, h);
}

function drawSkyFlow(w, h) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 5; i += 1) {
    const y = 72 + i * 32 + Math.sin(t * 0.7 + i) * 7;
    const grad = ctx.createLinearGradient(0, y - 20, w, y + 20);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, "rgba(255,255,255,.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(-40, y);
    ctx.bezierCurveTo(w * 0.25, y - 22, w * 0.62, y + 22, w + 40, y - 8);
    ctx.stroke();
  }
  ctx.restore();
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

function drawBirds(w, h) {
  ctx.save();
  ctx.strokeStyle = "rgba(58, 86, 72, 0.48)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = 0; i < 7; i += 1) {
    const speed = 18 + i * 2.4;
    const x = ((t * speed + i * 123) % (w + 140)) - 70;
    const y = 76 + Math.sin(t * 0.8 + i) * 10 + (i % 3) * 28;
    const s = 0.55 + (i % 3) * 0.18;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.quadraticCurveTo(-5, -7 - Math.sin(t * 5 + i) * 2, 0, 0);
    ctx.quadraticCurveTo(6, -7 + Math.sin(t * 5 + i) * 2, 13, 0);
    ctx.stroke();
    ctx.restore();
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
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ddffd0";
  ctx.lineWidth = 6;
  for (let i = 0; i < 8; i += 1) {
    const y = -h * 0.1 + i * h * 0.075 + Math.sin(t + i) * 5;
    ctx.beginPath();
    ctx.moveTo(-w * 0.56, y);
    ctx.bezierCurveTo(-w * 0.2, y - 18, w * 0.12, y + 18, w * 0.55, y - 6);
    ctx.stroke();
  }
  ctx.restore();
  drawFarmDecoration(w, h);
  const path = ctx.createLinearGradient(0, h * 0.22, 0, h * 0.33);
  path.addColorStop(0, "#c8884c");
  path.addColorStop(1, "#a76538");
  ctx.fillStyle = path;
  roundRect(-w * 0.41, h * 0.23, w * 0.82, h * 0.085, 24, true);
  ctx.fillStyle = "rgba(255, 229, 167, .18)";
  for (let i = 0; i < 6; i += 1) {
    roundRect(-w * 0.33 + i * w * 0.13, h * 0.255 + Math.sin(i) * 4, 18, 5, 5, true);
  }
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

function drawAnimals(w, h) {
  const baseY = h * 0.64;
  const cowX = 42 + Math.abs(Math.sin(t * 0.34)) * (w - 108);
  const sheepX = w - 54 - Math.abs(Math.sin(t * 0.28 + 1.4)) * (w - 120);
  const chickenX = 76 + ((t * 28) % Math.max(120, w - 150));
  drawCow(cowX, baseY, Math.sin(t * 0.34) > 0 ? 1 : -1);
  drawSheep(sheepX, baseY + 56, Math.sin(t * 0.28 + 1.4) > 0 ? -1 : 1);
  drawChicken(chickenX, baseY + 112, 1);
}

function drawCow(x, y, dir = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * 0.72, 0.72);
  ctx.fillStyle = "rgba(45, 70, 32, .16)";
  ctx.beginPath();
  ctx.ellipse(0, 20, 34, 8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#fff7ea";
  roundRect(-30, -12, 52, 26, 12, true);
  ctx.fillStyle = "#60412b";
  ctx.beginPath();
  ctx.ellipse(-12, -2, 10, 8, -0.3, 0, TAU);
  ctx.ellipse(10, 6, 8, 7, 0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#fff7ea";
  roundRect(18, -18, 24, 21, 10, true);
  ctx.fillStyle = "#f2a6a6";
  ctx.beginPath();
  ctx.ellipse(33, -5, 9, 6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#31271e";
  ctx.fillRect(-22, 12, 5, 14);
  ctx.fillRect(9, 12, 5, 14);
  ctx.fillRect(29, 0, 3, 3);
  ctx.restore();
}

function drawSheep(x, y, dir = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * 0.66, 0.66);
  ctx.fillStyle = "rgba(45, 70, 32, .16)";
  ctx.beginPath();
  ctx.ellipse(0, 18, 30, 8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#fffdf2";
  [-18, -5, 8, 19].forEach((cx, i) => {
    ctx.beginPath();
    ctx.arc(cx, -4 + Math.sin(i) * 2, 14, 0, TAU);
    ctx.fill();
  });
  ctx.fillStyle = "#5d5042";
  roundRect(22, -12, 18, 18, 8, true);
  ctx.fillRect(-18, 9, 5, 12);
  ctx.fillRect(9, 9, 5, 12);
  ctx.fillStyle = "#201a15";
  ctx.fillRect(31, -5, 3, 3);
  ctx.restore();
}

function drawChicken(x, y, dir = 1) {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 8) * 1.5);
  ctx.scale(dir * 0.55, 0.55);
  ctx.fillStyle = "rgba(45, 70, 32, .14)";
  ctx.beginPath();
  ctx.ellipse(0, 17, 18, 5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#fff5d8";
  ctx.beginPath();
  ctx.ellipse(0, 0, 17, 20, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#f04e3e";
  ctx.beginPath();
  ctx.arc(2, -19, 5, 0, TAU);
  ctx.arc(-5, -18, 4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffb23f";
  ctx.beginPath();
  ctx.moveTo(15, -4);
  ctx.lineTo(27, 1);
  ctx.lineTo(15, 6);
  ctx.fill();
  ctx.strokeStyle = "#a66a24";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-5, 18);
  ctx.lineTo(-8, 28);
  ctx.moveTo(7, 18);
  ctx.lineTo(10, 28);
  ctx.stroke();
  ctx.fillStyle = "#2e241b";
  ctx.fillRect(9, -8, 3, 3);
  ctx.restore();
}

function drawPlots(w, h) {
  if (!player) return;
  const cols = 4;
  const size = Math.max(58, Math.min((w - 42) / cols, 82));
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
  const skew = size * 0.14;
  const lip = [
    [skew, 0],
    [size - skew, 0],
    [size, size * 0.18],
    [size - size * 0.07, size - size * 0.1],
    [size * 0.07, size - size * 0.1],
    [0, size * 0.18],
  ];
  const soilPoly = [
    [skew + 6, 9],
    [size - skew - 6, 9],
    [size - 9, size * 0.22],
    [size - size * 0.13, size - size * 0.18],
    [size * 0.13, size - size * 0.18],
    [9, size * 0.22],
  ];
  ctx.fillStyle = "rgba(67, 49, 21, .22)";
  ctx.beginPath();
  ctx.ellipse(size / 2, size * 0.55, size * 0.52, size * 0.34, 0, 0, TAU);
  ctx.fill();
  const lipGrad = ctx.createLinearGradient(0, 0, 0, size);
  lipGrad.addColorStop(0, "#8bdc72");
  lipGrad.addColorStop(1, "#3e9c52");
  ctx.fillStyle = lipGrad;
  drawPoly(lip, true);
  ctx.strokeStyle = "rgba(255,255,255,.26)";
  ctx.lineWidth = 2;
  drawPoly(lip, false);
  const innerShade = ctx.createLinearGradient(0, 6, 0, size);
  innerShade.addColorStop(0, "rgba(44, 28, 12, .36)");
  innerShade.addColorStop(0.22, "rgba(44, 28, 12, .08)");
  innerShade.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = innerShade;
  drawPoly(soilPoly, true);
  const soil = ctx.createLinearGradient(0, 10, 0, size);
  soil.addColorStop(0, "#b87945");
  soil.addColorStop(0.48, "#8e5731");
  soil.addColorStop(1, "#633a22");
  ctx.fillStyle = soil;
  drawPoly(soilPoly, true);
  ctx.save();
  clipPoly(soilPoly);
  ctx.strokeStyle = "rgba(255,239,195,.24)";
  ctx.lineWidth = 2;
  for (let k = 0; k < 5; k += 1) {
    ctx.beginPath();
    ctx.moveTo(13, 16 + k * size / 7);
    ctx.bezierCurveTo(size * 0.34, 7 + k * size / 7, size * 0.68, 21 + k * size / 7, size - 13, 16 + k * size / 7);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(77,43,24,.28)";
  ctx.lineWidth = 1.5;
  drawPoly(soilPoly, false);
  if (plot.crop) drawCrop(plot, size);
  else {
    ctx.fillStyle = "rgba(255,255,255,.42)";
    ctx.font = `900 ${Math.max(18, size * 0.22)}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("+", size / 2, size * 0.48 + 8);
  }
  const p = cropProgress(plot);
  if (plot.crop) {
    ctx.fillStyle = "rgba(0,0,0,.18)";
    roundRect(13, size - 16, size - 26, 6, 8, true);
    ctx.fillStyle = p >= 1 ? "#fff279" : "#78e06f";
    roundRect(13, size - 16, (size - 26) * p, 6, 8, true);
  }
  ctx.restore();
}

function drawCrop(plot, size) {
  const crop = crops[plot.crop];
  const p = cropProgress(plot);
  ctx.save();
  ctx.translate(size / 2, size * 0.56);
  drawCropBadge(plot.crop, crop, p, size);
  if (plot.watered) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#8be9ff";
    ctx.beginPath();
    ctx.arc(24, 20, 4 + Math.sin(t * 4) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCropBadge(type, crop, p, size) {
  const stage = 0.72 + p * 0.32;
  ctx.save();
  ctx.scale(stage, stage);
  ctx.fillStyle = "rgba(33, 72, 35, .25)";
  ctx.beginPath();
  ctx.ellipse(0, 18, size * 0.22, size * 0.08, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.65)";
  ctx.beginPath();
  ctx.arc(0, -7, size * 0.25, 0, TAU);
  ctx.fill();
  drawCropVector(type, size);
  if (p >= 1) {
    ctx.strokeStyle = "rgba(255,242,121,.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -8, size * 0.31 + Math.sin(t * 4) * 2, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCropVector(type, size) {
  ctx.save();
  ctx.translate(0, -8 + Math.sin(t * 2) * 1.2);
  const s = size / 82;
  ctx.scale(s, s);
  if (type === "carrot") {
    ctx.fillStyle = "#57b95d";
    [-9, 0, 9].forEach((x, i) => {
      ctx.save();
      ctx.translate(x, -21);
      ctx.rotate((i - 1) * 0.45);
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 14, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    });
    const grad = ctx.createLinearGradient(0, -12, 0, 22);
    grad.addColorStop(0, "#ffb25b");
    grad.addColorStop(1, "#f36f27");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-13, -9);
    ctx.quadraticCurveTo(0, -18, 13, -9);
    ctx.quadraticCurveTo(7, 11, 0, 25);
    ctx.quadraticCurveTo(-8, 10, -13, -9);
    ctx.fill();
    ctx.strokeStyle = "rgba(126,66,20,.25)";
    ctx.lineWidth = 2;
    [-3, 6, 14].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(-5, y);
      ctx.lineTo(7, y - 3);
      ctx.stroke();
    });
  } else if (type === "tomato") {
    ctx.fillStyle = "#e84838";
    ctx.beginPath();
    ctx.arc(0, 1, 22, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff7568";
    ctx.beginPath();
    ctx.arc(-8, -8, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#3d9a48";
    for (let i = 0; i < 5; i += 1) {
      ctx.save();
      ctx.rotate(i * TAU / 5);
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(5, -20);
      ctx.lineTo(-5, -20);
      ctx.fill();
      ctx.restore();
    }
  } else if (type === "corn") {
    ctx.fillStyle = "#60b45e";
    ctx.beginPath();
    ctx.ellipse(-12, 4, 8, 25, -0.35, 0, TAU);
    ctx.ellipse(12, 4, 8, 25, 0.35, 0, TAU);
    ctx.fill();
    const grad = ctx.createLinearGradient(0, -24, 0, 22);
    grad.addColorStop(0, "#ffe87b");
    grad.addColorStop(1, "#f3b72e");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 28, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(158,103,13,.18)";
    for (let y = -16; y <= 14; y += 8) {
      ctx.fillRect(-9, y, 18, 2);
    }
  } else if (type === "watermelon") {
    const grad = ctx.createRadialGradient(-8, -8, 4, 0, 0, 25);
    grad.addColorStop(0, "#8cff7b");
    grad.addColorStop(1, "#21914a");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(9,89,43,.45)";
    ctx.lineWidth = 4;
    [-10, 0, 10].forEach((x) => {
      ctx.beginPath();
      ctx.ellipse(x, 0, 6, 22, 0, 0, TAU);
      ctx.stroke();
    });
    ctx.fillStyle = "#f55e6f";
    ctx.beginPath();
    ctx.moveTo(-18, 5);
    ctx.quadraticCurveTo(0, 22, 18, 5);
    ctx.closePath();
    ctx.fill();
  } else {
    const grad = ctx.createLinearGradient(0, -24, 0, 24);
    grad.addColorStop(0, "#9b65e6");
    grad.addColorStop(1, "#5d2b98");
    ctx.fillStyle = grad;
    ctx.save();
    ctx.rotate(-0.25);
    ctx.beginPath();
    ctx.ellipse(0, 4, 14, 28, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#54aa5a";
    ctx.beginPath();
    ctx.moveTo(-12, -20);
    ctx.lineTo(0, -32);
    ctx.lineTo(12, -20);
    ctx.lineTo(0, -15);
    ctx.closePath();
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
  if (t > 7) return;
  ctx.save();
  ctx.globalAlpha = Math.min(0.7, (7 - t) / 2);
  ctx.fillStyle = "rgba(255,255,255,.8)";
  roundRect(18, h - 142, Math.min(w - 36, 390), 36, 18, true);
  ctx.fillStyle = "#3b4a2f";
  ctx.font = "800 12px system-ui";
  ctx.fillText("点击土地播种/浇水/采摘，长按回收", 34, h - 119);
  ctx.restore();
}

function roundRect(x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) ctx.fill();
  else ctx.stroke();
}

function drawPoly(points, fill) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  if (fill) ctx.fill();
  else ctx.stroke();
}

function clipPoly(points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.clip();
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
  const size = Math.max(58, Math.min((w - 42) / cols, 82));
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
  const size = Math.max(58, Math.min((w - 42) / cols, 82));
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
  for (let i = 0; i < 32; i += 1) {
    particles.push({ kind: i < 10 ? "stream" : "drop", x: pos.x - 28 + Math.random() * 20, y: pos.y - 52 + Math.random() * 18, vx: 35 + Math.random() * 80, vy: 120 + Math.random() * 110, life: 0.75, max: 0.75, color: i < 10 ? "#bff7ff" : "#4ed8ff", r: 2 + Math.random() * 3 });
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
    if (p.kind === "stream") {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

function closeDrawers() {
  $("#seedStrip").classList.remove("open");
  $("#actionTray").classList.remove("open");
  document.querySelector(".dock").classList.remove("open");
}

function bind() {
  $("#enterGame").addEventListener("click", start);
  $("#closeSheet").addEventListener("click", () => openPanel("garden"));
  $("#seedToggle").addEventListener("click", () => {
    sheet.classList.add("hidden");
    $("#seedStrip").classList.toggle("open");
    $("#actionTray").classList.remove("open");
    document.querySelector(".dock").classList.remove("open");
  });
  $("#toolToggle").addEventListener("click", () => {
    sheet.classList.add("hidden");
    $("#actionTray").classList.toggle("open");
    $("#seedStrip").classList.remove("open");
    document.querySelector(".dock").classList.remove("open");
  });
  $("#menuToggle").addEventListener("click", () => {
    sheet.classList.add("hidden");
    $("#seedStrip").classList.remove("open");
    $("#actionTray").classList.remove("open");
    document.querySelector(".dock").classList.toggle("open");
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
    const bagTab = event.target.closest("[data-bag-tab]")?.dataset.bagTab;
    const listKey = event.target.closest("[data-list]")?.dataset.list;
    const openListKey = event.target.closest("[data-open-list]")?.dataset.openList;
    const sellItemKey = event.target.closest("[data-sell-item]")?.dataset.sellItem;
    const bagSelect = event.target.closest("[data-bag-select]")?.dataset.bagSelect;
    const delistId = event.target.closest("[data-delist]")?.dataset.delist;
    const buyId = event.target.closest("[data-buy]")?.dataset.buy;
    const marketSelect = event.target.closest("[data-market-select]")?.dataset.marketSelect;
    const playerSelect = event.target.closest("[data-player-select]")?.dataset.playerSelect;
    const bjAction = event.target.closest("[data-bj]")?.dataset.bj;
    if (event.target.closest("#spinLottery")) spinLottery();
    if (bagTab) { bagCategory = bagTab; selectedBagKey = ""; openBag(); }
    if (listKey) listItem(listKey, Number($(`#qty-${CSS.escape(listKey)}`).value), Number($(`#price-${CSS.escape(listKey)}`).value));
    if (openListKey) openListingModal(openListKey);
    if (sellItemKey) sellInventoryItem(sellItemKey, Number($(`#sellQty-${CSS.escape(sellItemKey)}`)?.value || 1));
    if (bagSelect) { selectedBagKey = bagSelect; openBag(); }
    if (delistId) delist(delistId);
    if (buyId) buy(buyId);
    if (marketSelect) { selectedListingId = marketSelect; openMarket($("#marketSearch")?.value.trim() || ""); }
    if (playerSelect) { selectedPlayerId = playerSelect; openPlayers(); }
    if (bjAction === "deal") startBlackjackRound(Number($("#bjBet")?.value || 10));
    if (bjAction === "hit") blackjackHit();
    if (bjAction === "stand") blackjackStand();
    if (bjAction === "peek") { blackjack.message = `你的牌面是 ${handValue(blackjack.player)} 点。${huangTaunt(handValue(blackjack.player))}`; openBlackjack(); }
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
