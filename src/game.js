/* ==============================================================
   云上菜园 · 像素引擎 v5
   - 60FPS 固定步长游戏循环（accumulator）
   - 像素相机 480×270 内部分辨率 → 整数倍缩放
   - 程序化生成所有像素美术（瓦片、角色、作物、建筑、UI）
   - 帧动画状态机：idle / walk / action
   - AABB 物理与碰撞
   - WebAudio 程序化音效
   - JSON 持久化 + GitHub 房间同步
============================================================== */

// ---------- 调色板 ----------
const PAL = {
  // 草地
  grass1: "#5fb43a", grass2: "#4a9c2e", grass3: "#3a7d24", grass4: "#7cc94d",
  flower1: "#ff6f8e", flower2: "#ffd84a", flower3: "#9d7dff",
  // 土
  soilDry: "#8a5a2b", soilWet: "#5d3a18", soilEdge: "#6a4221",
  // 路
  pathLight: "#d4b380", pathMid: "#b6926a", pathEdge: "#86694a",
  // 水
  waterLight: "#6cd0ff", waterMid: "#3aa8e4", waterDark: "#2070b0",
  // 木
  wood1: "#a16a3a", wood2: "#7d4e29", wood3: "#5a371b",
  // 屋顶
  roofRed: "#c14b3b", roofRedDark: "#8d2f24",
  roofBlue: "#5e8fc4", roofBlueDark: "#3a5d8c",
  roofGreen: "#5fa66b", roofGreenDark: "#3a7e48",
  // 石
  stone1: "#9aa3ad", stone2: "#6c7682", stone3: "#3e4854",
  // 角色
  skin: "#f3c19a", skinDk: "#c98966", hair: "#6a3d22",
  shirt: "#fff3d4", shirtDk: "#cdb993",
  pants: "#3a6cb0", pantsDk: "#264a82",
  hat: "#d9b56b", hatDk: "#a07f3e",
  shoe: "#3a2818",
  // 作物
  radishLeaf: "#5fb43a", radishRed: "#e64a4a", radishWhite: "#ffe4e0",
  tomatoLeaf: "#3a7d24", tomatoRed: "#e74040", tomatoHighlight: "#ff8e6e",
  pumpkinLeaf: "#3a7d24", pumpkinOrange: "#ff8c2a", pumpkinDk: "#b85a18",
  cornLeaf: "#5fb43a", cornYellow: "#ffd34a", cornDk: "#b8852a",
  // UI
  uiCream: "#fff3d4", uiBrown: "#5a371b", uiGold: "#ffd166",
};

// ---------- 配置 ----------
const BASE_VIEW_H = 270;     // 内部像素高度，宽度按真实屏幕比例动态计算
let VIEW_W = 480;
let VIEW_H = BASE_VIEW_H;
const TILE = 16;             // 单瓦片尺寸
const MAP_W = 64;            // 瓦片地图宽
const MAP_H = 40;            // 瓦片地图高
const WORLD_W = MAP_W * TILE; // 1024
const WORLD_H = MAP_H * TILE; // 640
const PLAYER_SPEED = 72;     // 像素/秒
const FIXED_DT = 1 / 60;

// ---------- 工具 ----------
const $ = (s) => document.querySelector(s);
const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));

// ---------- DOM 引用 ----------
const canvas = $("#gameCanvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

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

// 内部像素画布
const buf = document.createElement("canvas");
buf.width = VIEW_W;
buf.height = VIEW_H;
const bx = buf.getContext("2d");
bx.imageSmoothingEnabled = false;

// ---------- 像素工具 ----------
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = false;
  return { c, x };
}

function fillRect(x, ctxRef, x0, y0, w, h) {
  ctxRef.fillRect(x0, y0, w, h);
}

// 像素数组绘制 (将字符串数组按调色板染色)
function paintPixels(target, ox, oy, lines, palette) {
  for (let y = 0; y < lines.length; y += 1) {
    const row = lines[y];
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x];
      const color = palette[ch];
      if (!color) continue;
      target.fillStyle = color;
      target.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

// ---------- 程序化生成像素美术 ----------
const SPRITES = {};

function buildAssets() {
  buildTileSet();
  buildPlayer();
  buildCrops();
  buildBuildings();
  buildProps();
  buildUI();
}

// 瓦片集：grass / grassDeco1 / grassDeco2 / path / pathV / pathH / waterA / waterB / soil / soilWet / fence / stone
function buildTileSet() {
  const cols = 12;
  const tile = makeCanvas(TILE * cols, TILE);
  const x = tile.x;

  // helper
  const grassBase = (ox) => {
    for (let py = 0; py < TILE; py += 1) {
      for (let px = 0; px < TILE; px += 1) {
        // 伪随机散点，不做规律斜纹，避免画面像“廉价纹理平铺”。
        const v = (px * 37 + py * 57 + px * py * 11) % 29;
        x.fillStyle = v < 3 ? PAL.grass3 : v < 8 ? PAL.grass2 : v > 25 ? PAL.grass4 : PAL.grass1;
        x.fillRect(ox + px, py, 1, 1);
      }
    }
    x.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 4; i += 1) {
      const gx = (i * 5 + ox) % TILE;
      const gy = (i * 7 + 3) % TILE;
      x.fillRect(ox + gx, gy, 1, 2);
    }
  };

  // 0: 纯草
  grassBase(0);

  // 1: 草+花
  grassBase(TILE);
  paintPixels(x, TILE + 4, 5, [" 1 ", "121", " 1 "], { "1": PAL.flower1, "2": PAL.flower2 });
  paintPixels(x, TILE + 10, 10, [" 3 ", "333"], { "3": PAL.flower3 });

  // 2: 草+小石头
  grassBase(TILE * 2);
  paintPixels(x, TILE * 2 + 5, 6, [" SS ", "SLLS", " SS "], { S: PAL.stone2, L: PAL.stone1 });

  // 3: 路径中心
  for (let py = 0; py < TILE; py += 1) {
    for (let px = 0; px < TILE; px += 1) {
      const v = (px * 5 + py * 11) % 7;
      x.fillStyle = v < 2 ? PAL.pathEdge : v < 5 ? PAL.pathMid : PAL.pathLight;
      x.fillRect(TILE * 3 + px, py, 1, 1);
    }
  }

  // 4: 水（动画 A）
  for (let py = 0; py < TILE; py += 1) {
    for (let px = 0; px < TILE; px += 1) {
      const v = (px + py) % 4;
      x.fillStyle = v === 0 ? PAL.waterDark : v === 1 ? PAL.waterMid : PAL.waterLight;
      x.fillRect(TILE * 4 + px, py, 1, 1);
    }
  }
  // 高光
  paintPixels(x, TILE * 4 + 2, 3, ["HH"], { H: "#ffffff" });
  paintPixels(x, TILE * 4 + 9, 10, ["HHH"], { H: "#cfeaff" });

  // 5: 水（动画 B）
  for (let py = 0; py < TILE; py += 1) {
    for (let px = 0; px < TILE; px += 1) {
      const v = (px + py + 2) % 4;
      x.fillStyle = v === 0 ? PAL.waterDark : v === 1 ? PAL.waterMid : PAL.waterLight;
      x.fillRect(TILE * 5 + px, py, 1, 1);
    }
  }
  paintPixels(x, TILE * 5 + 6, 5, ["HH"], { H: "#ffffff" });
  paintPixels(x, TILE * 5 + 11, 12, ["HHH"], { H: "#cfeaff" });

  // 6: 干土地块
  for (let py = 0; py < TILE; py += 1) {
    for (let px = 0; px < TILE; px += 1) {
      const v = (px * 3 + py * 5) % 6;
      x.fillStyle = v < 2 ? PAL.soilEdge : v < 4 ? PAL.soilDry : "#9c6a36";
      x.fillRect(TILE * 6 + px, py, 1, 1);
    }
  }
  // 犁沟横线
  x.fillStyle = PAL.soilEdge;
  for (let i = 3; i < TILE; i += 4) x.fillRect(TILE * 6 + 1, i, TILE - 2, 1);

  // 7: 湿润土地块
  for (let py = 0; py < TILE; py += 1) {
    for (let px = 0; px < TILE; px += 1) {
      const v = (px * 3 + py * 5) % 6;
      x.fillStyle = v < 2 ? "#3e2410" : v < 4 ? PAL.soilWet : "#754826";
      x.fillRect(TILE * 7 + px, py, 1, 1);
    }
  }
  x.fillStyle = "#3e2410";
  for (let i = 3; i < TILE; i += 4) x.fillRect(TILE * 7 + 1, i, TILE - 2, 1);

  // 8: 木栅栏
  paintPixels(x, TILE * 8, 0,
    [
      "                ",
      "                ",
      " WW WW WW WW WW ",
      "WWWWWWWWWWWWWWWW",
      " W  W  W  W  W  ",
      " W  W  W  W  W  ",
      "WWWWWWWWWWWWWWWW",
      " W  W  W  W  W  ",
      " W  W  W  W  W  ",
      " W  W  W  W  W  ",
      " W  W  W  W  W  ",
      " W  W  W  W  W  ",
      "                ",
      "                ",
      "                ",
      "                ",
    ], { W: PAL.wood2 });

  // 9: 大石头
  grassBase(TILE * 9);
  paintPixels(x, TILE * 9 + 2, 3,
    [
      "  SSSS  ",
      " SLLLLS ",
      "SLLLLLLS",
      "SLDDLLLS",
      "SDDDLLLS",
      " SSDLSS ",
      "  SSSS  ",
    ], { S: PAL.stone3, L: PAL.stone1, D: PAL.stone2 });

  // 10: 灌木
  grassBase(TILE * 10);
  paintPixels(x, TILE * 10 + 2, 4,
    [
      " GGGGGG ",
      "GGggGGgg",
      "GgGGggGG",
      "GGggGGgg",
      " GggGGg ",
      "  ssss  ",
    ], { G: PAL.grass3, g: PAL.grass4, s: PAL.wood3 });

  // 11: 木质地板
  for (let py = 0; py < TILE; py += 1) {
    for (let px = 0; px < TILE; px += 1) {
      const v = (px + py) % 3;
      x.fillStyle = v === 0 ? PAL.wood3 : v === 1 ? PAL.wood2 : PAL.wood1;
      x.fillRect(TILE * 11 + px, py, 1, 1);
    }
  }

  SPRITES.tiles = tile.c;
}

// 玩家：32x32 sprite, 4方向 × 4帧
// 方向顺序：down, left, right, up
function buildPlayer() {
  const fw = 16, fh = 24, cols = 4, rows = 4;
  const c = makeCanvas(fw * cols, fh * rows);
  const x = c.x;

  // 通用绘制
  const drawFrame = (col, row, dir, frame) => {
    const ox = col * fw, oy = row * fh;
    const bob = frame === 1 || frame === 3 ? 0 : -1;     // 走路上下浮动
    const legSwap = frame === 1 ? 1 : frame === 3 ? -1 : 0;
    // 阴影
    paintPixels(x, ox, oy,
      [
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "    SSSSSSSS    ",
        "                ",
      ], { S: "rgba(0,0,0,.45)" });

    // 头/身体（共用）
    const headY = 4 + bob;
    // 帽子
    paintPixels(x, ox + 3, oy + headY,
      [
        "  HHHHHH  ",
        " HHHHHHHH ",
        "HHHHHHHHHH",
        "  hhhhhh  ",
      ], { H: PAL.hat, h: PAL.hatDk });
    // 头/脸
    paintPixels(x, ox + 4, oy + headY + 4,
      [
        " ssssss ",
        "ssssssss",
        "skssssks",
        "ssssssss",
      ], { s: PAL.skin, k: "#3a2010" });
    // 身体（衬衫）
    paintPixels(x, ox + 4, oy + headY + 8,
      [
        "SSSSSSSS",
        "ShSSSShS",
        "SSSSSSSS",
        "SSSSSSSS",
      ], { S: PAL.shirt, h: PAL.shirtDk });
    // 裤子
    paintPixels(x, ox + 4, oy + headY + 12,
      [
        "PPPPPPPP",
        "PPPPPPPP",
      ], { P: PAL.pants });
    // 腿
    paintPixels(x, ox + 4, oy + headY + 14,
      [
        legSwap === 1 ? "PP    PP" : legSwap === -1 ? "  PPPP  " : " PP  PP ",
        "BB    BB",
      ], { P: PAL.pantsDk, B: PAL.shoe });

    // 手臂朝向
    if (dir === "left") {
      paintPixels(x, ox + 2, oy + headY + 9,
        ["SS", "SS"], { S: PAL.shirt });
    } else if (dir === "right") {
      paintPixels(x, ox + 12, oy + headY + 9,
        ["SS", "SS"], { S: PAL.shirt });
    } else if (dir === "up") {
      // 头发覆盖脸
      paintPixels(x, ox + 4, oy + headY + 4,
        [
          " HHHHHH ",
          "HHHHHHHH",
          "HHHHHHHH",
          "HHHHHHHH",
        ], { H: PAL.hair });
    } else {
      // down: 默认脸
    }
  };

  ["down", "left", "right", "up"].forEach((dir, row) => {
    for (let f = 0; f < 4; f += 1) drawFrame(f, row, dir, f);
  });

  SPRITES.player = c.c;
}

// 作物：4 种 × 4 阶段（种子 / 苗 / 半成 / 成熟），每帧 16×16
function buildCrops() {
  const cols = 4, rows = 4;
  const c = makeCanvas(16 * cols, 16 * rows);
  const x = c.x;

  const stages = {
    radish: [
      // 种子
      ["", "", "", "", "", "", "", "", "", "", "      ggg     ", "      gg      "],
      // 苗
      ["", "", "", "", "", "      gg      ", "     gGg      ", "      gg      ", "      gg      "],
      // 半成
      ["", "", "", "    gGg gGg   ", "    GGGgGGG   ", "     gGgGg    ", "      ggg     ", "      RR      "],
      // 成熟
      ["", "    gGg gGg   ", "   GGGGGGGG   ", "    gGGGGg    ", "     RRRR     ", "    RRWWRR    ", "    RRRRRR    ", "     RRRR     "],
    ],
    tomato: [
      [],
      ["", "", "", "", "      g       ", "     ggg      ", "      g       ", "      g       "],
      ["", "", "      g       ", "     ggg      ", "    g r g     ", "      g       ", "      g       "],
      ["", "    ggggg     ", "   ggGggGgg   ", "   gGRRRRGg   ", "   gRRrRRg    ", "    GRRRG     ", "      g       "],
    ],
    pumpkin: [
      [],
      ["", "", "", "", "      g       ", "     ggg      ", "      g       "],
      ["", "", "    ggGgg     ", "    gGGGg     ", "    gGOGg     ", "    OOOOO     ", "      g       "],
      ["", "    gggGgg    ", "   gGGGGGGg   ", "   gOOoOOOg   ", "   gOoOOoOg   ", "   gOOOOOOg   ", "    OOOOO     ", "     ggg      "],
    ],
    corn: [
      [],
      ["", "", "", "", "      g       ", "     ggg      ", "      g       "],
      ["", "", "    g g g     ", "    gGgGg     ", "    Y g Y     ", "      g       "],
      ["", "   g     g    ", "   gG y Gg    ", "   gG yyGg    ", "   gG yyGg    ", "    GyyG      ", "    yyyy      ", "     yy       "],
    ],
  };

  const palette = {
    radish: { g: PAL.radishLeaf, G: PAL.grass4, R: PAL.radishRed, W: PAL.radishWhite },
    tomato: { g: PAL.tomatoLeaf, G: PAL.grass4, R: PAL.tomatoRed, r: PAL.tomatoHighlight, },
    pumpkin: { g: PAL.pumpkinLeaf, G: PAL.grass4, O: PAL.pumpkinOrange, o: PAL.pumpkinDk },
    corn: { g: PAL.cornLeaf, G: PAL.grass4, y: PAL.cornYellow, Y: PAL.cornDk },
  };

  ["radish", "tomato", "pumpkin", "corn"].forEach((id, col) => {
    const sequences = stages[id];
    sequences.forEach((lines, row) => {
      const padded = [...lines];
      while (padded.length < 16) padded.unshift("");
      const norm = padded.map((l) => l.padEnd(16, " "));
      paintPixels(x, col * 16, row * 16, norm, palette[id]);
    });
  });

  SPRITES.crops = c.c;
}

// 建筑：每个 64×64 像素
function buildBuildings() {
  const items = ["home", "market", "greenhouse", "mill", "pond"];
  const c = makeCanvas(64 * items.length, 64);
  const x = c.x;

  // home (0)
  paintPixels(x, 0, 8,
    [
      "       RRRRRRRRRRRRRRRRRRRRRR        ",
      "      RRRRRRRRRRRRRRRRRRRRRRRR       ",
      "     RRRRRRRRRRRRRRRRRRRRRRRRRR      ",
      "    RRrrrrrrrrrrrrrrrrrrrrrrrrRR     ",
      "   RRrrrrrrrrrrrrrrrrrrrrrrrrrrRR    ",
      "  RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR   ",
      " WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW  ",
      " WoWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWoW  ",
      " WoWWWWWWWWWWWBBBBBBBBWWWWWWWWWWWoW  ",
      " WWWWWWWWWWWWWBBBBBBBBWWWWWWWWWWWWW  ",
      " WoWWWWWWWWWWWBBBBBBBBWWWWWWWWWWWoW  ",
      " WoWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWoW  ",
      " WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW  ",
      " sssssssssssssssssssssssssssssssss   ",
    ], { R: PAL.roofRed, r: PAL.roofRedDark, W: PAL.shirt, w: PAL.shirtDk, B: PAL.wood3, o: PAL.waterMid, s: PAL.stone2 });

  // market (1)
  const ox = 64;
  paintPixels(x, ox, 12,
    [
      "                                ",
      "    BBBBBBBBBBBBBBBBBBBBBBBB    ",
      "   BWWWWWWWWWWWWWWWWWWWWWWWWB   ",
      "  BWRRRRRRRRRRRRRRRRRRRRRRRRWB  ",
      " BWRYYRYYRYYRYYRYYRYYRYYRYYRWB  ",
      " BWRRRRRRRRRRRRRRRRRRRRRRRRRWB  ",
      " WWWWWWWWWWWWWWWWWWWWWWWWWWWWW  ",
      " WoooooooooooooooooooooooooooW  ",
      " WoTTTTTToTTTTTToTTTTTToTTTTToW ",
      " WoTGTGTToTGTGTToTGTGTToTGTGToW ",
      " WoTTTTTToTTTTTToTTTTTToTTTTToW ",
      " WoooooooooooooooooooooooooooW  ",
      " WWWWWWWWWWWWWWWWWWWWWWWWWWWWW  ",
      "                                ",
    ], { B: PAL.wood3, W: PAL.wood1, R: PAL.roofRed, Y: PAL.uiCream, o: PAL.wood2, T: PAL.tomatoRed, G: PAL.tomatoLeaf });

  // greenhouse (2)
  const ox2 = 128;
  paintPixels(x, ox2, 6,
    [
      "    WWWWWWWWWWWWWWWWWWWWWWWW   ",
      "   WgGGGGGGGGGGGGGGGGGGGGGGgW  ",
      "  WgGGGGGGGGGGGGGGGGGGGGGGGGgW ",
      " WgGGggGGGGGggGGGGGggGGGGGgGgW ",
      " WgGGGGGGGGGGGGGGGGGGGGGGGGGgW ",
      " WgGGGGGGGGGGGGGGGGGGGGGGGGGgW ",
      " WgGggGGGggGGGggGGGggGGGggGGgW ",
      " WgGGGGGGGGGGGGGGGGGGGGGGGGGgW ",
      " WWWWWWWWWWWWWWWWWWWWWWWWWWWWW ",
      " WBBBWBBBBBBBBBBBBBBBBBBBWBBBW ",
      " WBoBWBoooooooooooooooooBWBoBW ",
      " WBoBWBooooDDoooooDDooooBWBoBW ",
      " WBBBWBBBBBBBBBBBBBBBBBBBWBBBW ",
      "                               ",
    ], { W: PAL.stone1, g: PAL.waterLight, G: "#a8e8ff", B: PAL.wood2, o: PAL.wood1, D: PAL.wood3 });

  // mill (3) - 风车
  const ox3 = 192;
  paintPixels(x, ox3, 0,
    [
      "        WWWWWW          ",
      "       WoooooooW         ",
      "      WoooooooooW        ",
      "     WoooooooooooW       ",
      "      WoooooooooW        ",
      "       WoooooooW         ",
      "        WWWWWW          ",
      "         B  B           ",
      "        BBBBBB          ",
      "        BWWWWB          ",
      "        BWWWWB          ",
      "        BBBBBB          ",
      "        BWWWWB          ",
      "        BWWWWB          ",
      "        BBBBBB          ",
    ], { W: PAL.wood1, o: PAL.uiCream, B: PAL.wood3 });
  // 风车叶片（静态）
  paintPixels(x, ox3 + 8, 5,
    [
      " RR    RR ",
      "RRRR  RRRR",
      "RRRR  RRRR",
      " RR    RR ",
    ], { R: PAL.roofRed });

  // pond (4)
  const ox4 = 256;
  paintPixels(x, ox4, 16,
    [
      "      WWWWWWWWWWWWWWWWWWWWWW    ",
      "    WWaaaaaaaaaaaaaaaaaaaaaaWW  ",
      "   WaaaabbbbaaaaaaaaaabbbbaaaaW ",
      "  WaaabbbBBbbaaaaaabbbBBbbaaaaW ",
      "  WaabbbBBBBbbaaaabbbBBBBbbaaaW ",
      "  WaaabbbBBbbaaaaaabbbBBbbaaaW  ",
      "   WaaaabbbbaaaaaaaaaabbbbaaaW  ",
      "    WWaaaaaaaaaaaaaaaaaaaaaaWW  ",
      "      WWWWWWWWWWWWWWWWWWWWWW    ",
    ], { W: PAL.stone3, a: PAL.waterMid, b: PAL.waterDark, B: PAL.waterLight });

  SPRITES.buildings = c.c;
}

// 场景小物件：桶、箱子、告示牌、花丛、稻草堆、灯笼，每个 16×16
function buildProps() {
  const c = makeCanvas(16 * 8, 16);
  const x = c.x;
  const P = {
    W: PAL.wood1, w: PAL.wood2, d: PAL.wood3,
    S: PAL.stone1, s: PAL.stone2,
    G: PAL.grass4, g: PAL.grass3,
    Y: PAL.uiGold, y: "#b8852a",
    R: PAL.roofRed, r: PAL.roofRedDark,
    F: PAL.flower1, f: PAL.flower2,
    B: PAL.waterMid,
  };

  // 0 木桶
  paintPixels(x, 0, 3, [
    "    dddddd      ",
    "   dWWWWWWd     ",
    "   WwWWWWwW     ",
    "   WwWWWWwW     ",
    "   WwWWWWwW     ",
    "   dWWWWWWd     ",
    "    dddddd      ",
  ], P);
  // 1 木箱
  paintPixels(x, 16, 4, [
    "  dddddddddddd  ",
    "  dWWWWWWWWWWd  ",
    "  dWddWWddWWd  ",
    "  dWWWddWWWWd  ",
    "  dWWddWWddWd  ",
    "  dWWWWWWWWWd  ",
    "  ddddddddddd  ",
  ], P);
  // 2 告示牌
  paintPixels(x, 32, 2, [
    "    WWWWWWWW    ",
    "   WYYYYYYYW    ",
    "   WYYddYYYW    ",
    "   WYYYYYYYW    ",
    "    WWWWWWWW    ",
    "       d        ",
    "       d        ",
    "       d        ",
    "      ddd       ",
  ], P);
  // 3 花丛
  paintPixels(x, 48, 5, [
    "   gGg  gGg     ",
    "  gFgGgfGgG     ",
    "  GgGgGgGgG     ",
    "   gGgffGg      ",
    "    gggg        ",
  ], P);
  // 4 稻草堆
  paintPixels(x, 64, 5, [
    "     YYYY       ",
    "   YYYYYYYY     ",
    "  YYYYyyYYYY    ",
    "  YYYyyyyYYY    ",
    "   YYYYYYYY     ",
    "     yyyy       ",
  ], P);
  // 5 路灯/灯笼
  paintPixels(x, 80, 1, [
    "      d         ",
    "     ddd        ",
    "    dYYYd       ",
    "    dYfYd       ",
    "     ddd        ",
    "      d         ",
    "      d         ",
    "      d         ",
    "     ddd        ",
  ], P);
  // 6 小石堆
  paintPixels(x, 96, 7, [
    "    ssSSs       ",
    "   sSSSSSs      ",
    "  sSSssSSs      ",
    "   sSSSSs       ",
  ], P);
  // 7 水边芦苇
  paintPixels(x, 112, 2, [
    "   g  g g       ",
    "   g  g g       ",
    "  gG  gGg       ",
    "  gGg gGg       ",
    "   gGGGG        ",
    "   BBBBB        ",
  ], P);

  SPRITES.props = c.c;
}

// UI 图标：32×32 each, 4 个
function buildUI() {
  const c = makeCanvas(32 * 4, 32);
  const x = c.x;

  // 0 播种 - 种子袋
  paintPixels(x, 4, 6,
    [
      "    BBBBBB  ",
      "   BBwwwwBB ",
      "  BBwwwwwwBB",
      " BBwwwsswwBB",
      " BwwwsssswwB",
      " BwwwsswwwwB",
      " BBwwwwwwwBB",
      "  BBBBBBBBB ",
      "    BBBB    ",
    ], { B: PAL.wood3, w: PAL.uiCream, s: PAL.grass3 });

  // 1 浇水 - 浇水壶
  paintPixels(x, 32 + 4, 8,
    [
      "      BBBB     ",
      "    BBBBBBB    ",
      " BBBBwwwwwBBB  ",
      "BwwwwwwwwwwwBB ",
      "Bwwwwwwwwwwwww ",
      "BwwwwwwwwwwwBB ",
      "BwwwwwwwwwwBBB ",
      " BBBBBBBBBBB   ",
      "  d d d d      ",
    ], { B: PAL.stone3, w: PAL.stone1, d: PAL.waterMid });

  // 2 收获 - 篮子
  paintPixels(x, 64 + 4, 8,
    [
      "    RRRR     ",
      "   RRrrRR    ",
      "  RRrrrrRR   ",
      " WWWWWWWWWW  ",
      " WBWBWBWBWW  ",
      " WBBBBBBBBW  ",
      " WBWBWBWBWW  ",
      "  WWWWWWWW   ",
    ], { R: PAL.tomatoRed, r: PAL.tomatoHighlight, W: PAL.wood1, B: PAL.wood3 });

  // 3 开垦 - 锄头
  paintPixels(x, 96 + 4, 5,
    [
      "         SS  ",
      "        SSSS ",
      "       SSSS  ",
      "      SSSS   ",
      "     WW S    ",
      "    WWS      ",
      "   WW        ",
      "  WW         ",
      " WW          ",
    ], { S: PAL.stone1, W: PAL.wood2 });

  SPRITES.ui = c.c;
}

// ---------- 关卡（瓦片地图） ----------
// 0=grass 1=grassFlower 2=grassRock 3=path 4=waterA 5=waterB 6=soilDry 7=soilWet 8=fence 9=stone 10=bush 11=wood

let groundMap = [];  // 地面层（草/路/水）
let overlayMap = []; // 装饰层（花/石/灌木/栅栏 + 瓦片地块）
let collisionMap = []; // 碰撞标记 (1=阻挡)

function buildLevel() {
  groundMap = new Array(MAP_W * MAP_H).fill(0);
  overlayMap = new Array(MAP_W * MAP_H).fill(-1);
  collisionMap = new Array(MAP_W * MAP_H).fill(0);

  // 草地填底，加随机花/石
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const r = (x * 31 + y * 17) % 100;
      if (r < 6) overlayMap[y * MAP_W + x] = 1;
      else if (r < 9) overlayMap[y * MAP_W + x] = 2;
    }
  }

  // 一条横向主路 + 一条纵向路
  for (let x = 2; x < MAP_W - 2; x += 1) {
    setTile(groundMap, x, 22, 3);
    overlayMap[22 * MAP_W + x] = -1;
  }
  for (let y = 4; y < MAP_H - 4; y += 1) {
    setTile(groundMap, 28, y, 3);
    overlayMap[y * MAP_W + 28] = -1;
  }

  // 池塘
  for (let y = 28; y < 33; y += 1) {
    for (let x = 44; x < 52; x += 1) {
      setTile(groundMap, x, y, ((x + y) % 2) ? 4 : 5);
      collisionMap[y * MAP_W + x] = 1;
    }
  }

  // 围栏围起农场区域
  for (let x = 2; x <= 26; x += 1) {
    overlayMap[3 * MAP_W + x] = 8;
    collisionMap[3 * MAP_W + x] = 1;
  }
  // 灌木点缀
  for (let i = 0; i < 30; i += 1) {
    const x = irand(0, MAP_W - 1);
    const y = irand(0, MAP_H - 1);
    if (groundMap[y * MAP_W + x] === 0 && overlayMap[y * MAP_W + x] < 0) {
      overlayMap[y * MAP_W + x] = 10;
      collisionMap[y * MAP_W + x] = 1;
    }
  }
}

function setTile(arr, x, y, v) {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return;
  arr[y * MAP_W + x] = v;
}

// ---------- 建筑实体 ----------
const buildingDefs = [
  { id: "home",       name: "玩家小屋", sprite: 0, x: 8 * TILE,   y: 8 * TILE,  w: 64, h: 56 },
  { id: "market",     name: "集市小站", sprite: 1, x: 32 * TILE,  y: 6 * TILE,  w: 64, h: 56 },
  { id: "greenhouse", name: "星光温室", sprite: 2, x: 44 * TILE,  y: 6 * TILE,  w: 64, h: 60 },
  { id: "mill",       name: "风车仓库", sprite: 3, x: 22 * TILE,  y: 30 * TILE, w: 32, h: 56 },
  { id: "pond",       name: "月亮池塘", sprite: 4, x: 44 * TILE,  y: 27 * TILE, w: 64, h: 32 },
];

function applyBuildingCollisions() {
  buildingDefs.forEach((b) => {
    const tx0 = Math.floor(b.x / TILE);
    const ty0 = Math.floor((b.y + b.h - 16) / TILE);
    const tx1 = Math.floor((b.x + b.w - 1) / TILE);
    const ty1 = Math.floor((b.y + b.h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
          collisionMap[ty * MAP_W + tx] = 1;
        }
      }
    }
  });
}

// ---------- 作物配置 ----------
const crops = [
  { id: "radish", name: "樱桃萝卜", col: 0, cost: 4, value: 12, grow: 14, xp: 4, water: 8 },
  { id: "tomato", name: "星光番茄", col: 1, cost: 8, value: 25, grow: 24, xp: 8, water: 10 },
  { id: "pumpkin", name: "月亮南瓜", col: 2, cost: 16, value: 48, grow: 38, xp: 14, water: 13 },
  { id: "corn", name: "金穗玉米", col: 3, cost: 22, value: 64, grow: 46, xp: 20, water: 15 },
];

// ---------- 田地 ----------
function createPlots() {
  const plots = [];
  // 农场区域 4 行 × 8 列，每块占 1 瓦
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      plots.push({
        id: `plot-${plots.length}`,
        tx: 6 + col,
        ty: 14 + row,
        locked: plots.length >= 16,
        crop: null,
        plantedAt: 0,
        wateredAt: 0,
        moisture: 0,
        fertility: 0.85 + (plots.length * 7 % 30) / 100,
        harvests: 0,
      });
    }
  }
  return plots;
}

// ---------- 状态 ----------
const savedBackend = JSON.parse(localStorage.getItem("cloudFarmBackend") || "{}");
let selectedCrop = crops[0].id;
let lastTime = performance.now();
let accumulator = 0;
let syncTimer = 0;
let toastTimer = 0;
let lastChatSignature = "";
let input = { left: false, right: false, up: false, down: false, action: false };
let game = createInitialState();
let actionFlash = 0;
let lastGamepadButtons = new Set();
let camera = { x: 0, y: 0 };
let moveTarget = null;

function createInitialState() {
  return {
    version: 5,
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
      x: 14 * TILE,
      y: 22 * TILE,
      vx: 0, vy: 0,
      facing: "down",
      anim: { state: "idle", frame: 0, t: 0 },
      lastSeen: now(),
    },
    visitors: {},
    plots: createPlots(),
    chat: [],
    log: [],
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

// ---------- 持久化 ----------
function saveLocal() {
  localStorage.setItem(`cloudFarm:${game.room}`, JSON.stringify(game));
}

function loadLocal(room) {
  const raw = localStorage.getItem(`cloudFarm:${room}`);
  if (!raw) return null;
  try { return normalizeState(JSON.parse(raw)); } catch { return null; }
}

function normalizeState(data) {
  const base = createInitialState();
  return {
    ...base,
    ...data,
    player: { ...base.player, ...(data.player || {}), id: getClientId(), lastSeen: now(), anim: base.player.anim },
    visitors: data.visitors || {},
    chat: Array.isArray(data.chat) ? data.chat.slice(-60) : [],
    plots: normalizePlots(data.plots, base.plots),
  };
}

function normalizePlots(savedPlots, basePlots) {
  const saved = new Map((savedPlots || []).map((p) => [p.id, p]));
  return basePlots.map((b, i) => ({ ...b, ...(saved.get(b.id) || savedPlots?.[i] || {}) }));
}

// ---------- 玩家 / 物理 ----------
function update(dt) {
  const player = game.player;
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const manualMove = dx !== 0 || dy !== 0;

  if (manualMove) {
    moveTarget = null;
  } else if (moveTarget) {
    const tx = moveTarget.x - player.x;
    const ty = moveTarget.y - player.y;
    const dist = Math.hypot(tx, ty);
    if (dist < 3) {
      moveTarget = null;
      dx = 0;
      dy = 0;
    } else {
      dx = tx / dist;
      dy = ty / dist;
    }
  }

  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  player.vx = dx * PLAYER_SPEED;
  player.vy = dy * PLAYER_SPEED;

  // facing
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) player.facing = "right";
    else if (dx < 0) player.facing = "left";
  } else {
    if (dy > 0) player.facing = "down";
    else if (dy < 0) player.facing = "up";
  }

  const moving = (dx !== 0 || dy !== 0);
  player.anim.state = moving ? "walk" : "idle";
  player.anim.t += dt;
  if (player.anim.t > 0.14) {
    player.anim.t = 0;
    player.anim.frame = (player.anim.frame + 1) % 4;
  }
  if (!moving) player.anim.frame = 0;

  // AABB 碰撞解算
  moveWithCollision(player, player.vx * dt, 0);
  moveWithCollision(player, 0, player.vy * dt);

  // 边界
  player.x = clamp(player.x, 0, WORLD_W - 12);
  player.y = clamp(player.y, 0, WORLD_H - 16);
  player.lastSeen = now();

  // 资源恢复
  game.water = clamp(game.water + dt * 2.2, 0, 100);
  game.plots.forEach((p) => {
    if (p.crop) p.moisture = clamp((p.moisture || 0) - dt * 0.85, 0, 100);
  });
  game.dayTime = (game.dayTime + dt * 0.008) % 1;
  game.updatedAt = now();
  if (actionFlash > 0) actionFlash -= dt;

  syncTimer += dt;
  if (syncTimer > 8) {
    syncTimer = 0;
    saveLocal();
    if (backendReady()) pushToGithub(true);
  }
}

function moveWithCollision(p, dx, dy) {
  // 玩家碰撞盒：12 宽 6 高（脚部）
  const bx0 = -6, bx1 = 6, by0 = -2, by1 = 4;
  const newX = p.x + dx;
  const newY = p.y + dy;
  const checkX = dx !== 0 ? newX : p.x;
  const checkY = dy !== 0 ? newY : p.y;
  const tx0 = Math.floor((checkX + bx0) / TILE);
  const tx1 = Math.floor((checkX + bx1) / TILE);
  const ty0 = Math.floor((checkY + by0) / TILE);
  const ty1 = Math.floor((checkY + by1) / TILE);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return;
      if (collisionMap[ty * MAP_W + tx]) return;
    }
  }
  p.x = newX;
  p.y = newY;
}

// ---------- 农事动作 ----------
function getNearestPlot() {
  const px = game.player.x, py = game.player.y;
  let best = null, bestD = Infinity;
  game.plots.forEach((p) => {
    if (p.locked) return;
    const cx = p.tx * TILE + TILE / 2;
    const cy = p.ty * TILE + TILE / 2;
    const d = Math.hypot(cx - px, cy - py);
    if (d < bestD) { bestD = d; best = p; }
  });
  return best ? { plot: best, dist: bestD } : null;
}

function plant() {
  const t = getNearestPlot();
  if (!t || t.dist > 24) return showToast("靠近一块空地再播种", "bad");
  const plot = t.plot;
  if (plot.crop) return showToast("这块地已经种下作物了", "bad");
  const crop = crops.find((c) => c.id === selectedCrop);
  if (game.coins < crop.cost) return showToast(`金币不足，需要 ${crop.cost}`, "bad");
  game.coins -= crop.cost;
  plot.crop = crop.id;
  plot.plantedAt = now();
  plot.wateredAt = 0;
  plot.moisture = Math.max(plot.moisture || 0, 28);
  addLog(`${game.player.name} 种下了 ${crop.name}`);
  Sfx.play("plant");
  actionFlash = 0.2;
  saveLocal();
}

function water() {
  const t = getNearestPlot();
  if (!t || t.dist > 24) return showToast("靠近作物再浇水", "bad");
  const plot = t.plot;
  if (!plot.crop) return showToast("这块地还没有作物", "bad");
  const crop = crops.find((c) => c.id === plot.crop);
  if (game.water < crop.water) return showToast(`水量不足，需要 ${crop.water}`, "bad");
  game.water -= crop.water;
  plot.wateredAt = now();
  plot.moisture = clamp((plot.moisture || 0) + 45, 0, 100);
  plot.fertility = clamp((plot.fertility || 1) + 0.015, 0.75, 1.35);
  addLog(`${game.player.name} 给作物浇了水`);
  Sfx.play("water");
  actionFlash = 0.2;
  saveLocal();
}

function harvest() {
  const t = getNearestPlot();
  if (!t || t.dist > 24) return showToast("靠近成熟作物再收获", "bad");
  const plot = t.plot;
  if (!plot.crop) return showToast("这里还没有可收获的作物", "bad");
  const progress = getCropProgress(plot);
  if (progress < 1) {
    const crop = crops.find((c) => c.id === plot.crop);
    return showToast(`还需要 ${Math.ceil((1 - progress) * crop.grow)} 秒成熟`, "bad");
  }
  const crop = crops.find((c) => c.id === plot.crop);
  const combo = 1 + Math.min(0.4, plot.harvests * 0.04);
  const gain = Math.round(crop.value * combo);
  game.coins += gain;
  game.xp += crop.xp;
  game.level = Math.max(1, Math.floor(Math.sqrt(game.xp / 18)) + 1);
  plot.crop = null;
  plot.harvests += 1;
  plot.moisture = clamp((plot.moisture || 0) - 20, 0, 100);
  plot.fertility = clamp((plot.fertility || 1) - 0.025, 0.75, 1.35);
  addLog(`${game.player.name} 收获 ${crop.name}，获得 ${gain} 金币`);
  showToast(`收获成功 +${gain} 金币`);
  Sfx.play("harvest");
  actionFlash = 0.25;
  saveLocal();
}

function expandFarm() {
  const locked = game.plots.find((p) => p.locked);
  if (!locked) return showToast("菜园已经全部解锁");
  const price = 55 + game.expansion * 18;
  if (game.coins < price) return showToast(`开垦新田需要 ${price} 金币`, "bad");
  game.coins -= price;
  game.expansion += 1;
  locked.locked = false;
  locked.fertility = 1.08;
  showToast("新田已开垦");
  addLog(`${game.player.name} 开垦了一块新田`);
  Sfx.play("expand");
  saveLocal();
}

function getCropProgress(plot) {
  if (!plot.crop) return 0;
  const crop = crops.find((c) => c.id === plot.crop);
  const moistureBoost = 0.72 + clamp(plot.moisture || 0, 0, 100) / 100 * 0.55;
  const fertilityBoost = clamp(plot.fertility || 1, 0.75, 1.35);
  return clamp(((now() - plot.plantedAt) / 1000 / crop.grow) * moistureBoost * fertilityBoost, 0, 1);
}

function addLog(message) {
  game.log = [{ t: now(), message }, ...(game.log || [])].slice(0, 20);
}

// ---------- Toast ----------
function showToast(message, tone = "normal") {
  toastEl.textContent = message;
  toastEl.style.border = tone === "bad" ? "1px solid rgba(255,107,107,.55)" : "1px solid rgba(255,255,255,.18)";
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

// ---------- 渲染 ----------
function render() {
  bx.fillStyle = "#0e1b17";
  bx.fillRect(0, 0, VIEW_W, VIEW_H);

  camera = {
    x: clamp(Math.floor(game.player.x - VIEW_W / 2), 0, WORLD_W - VIEW_W),
    y: clamp(Math.floor(game.player.y - VIEW_H / 2 - 8), 0, WORLD_H - VIEW_H),
  };

  drawTiles(camera);
  drawBuildings(camera);
  drawWorldProps(camera);
  drawPlots(camera);
  drawCrops(camera);

  // 排序绘制玩家
  const players = [game.player, ...Object.values(game.visitors || {}).filter((p) => p.id !== game.player.id && now() - p.lastSeen < 45000)];
  players.sort((a, b) => a.y - b.y).forEach((p) => drawPlayer(p, camera, p.id === game.player.id));

  drawMoveTarget(camera);
  drawHover(camera);
  drawNight();

  // 按真实屏幕比例完整铺满，不裁切、不黑边、不强行 16:9。
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(buf, 0, 0, VIEW_W, VIEW_H, 0, 0, w, h);
  drawMiniMap(camera);
  updateHud();
  renderChat();
}

function drawTiles(cam) {
  const tx0 = Math.max(0, Math.floor(cam.x / TILE));
  const ty0 = Math.max(0, Math.floor(cam.y / TILE));
  const tx1 = Math.min(MAP_W - 1, Math.ceil((cam.x + VIEW_W) / TILE));
  const ty1 = Math.min(MAP_H - 1, Math.ceil((cam.y + VIEW_H) / TILE));
  const waterFrame = Math.floor((Date.now() / 500) % 2);
  for (let y = ty0; y <= ty1; y += 1) {
    for (let x = tx0; x <= tx1; x += 1) {
      let g = groundMap[y * MAP_W + x];
      if (g === 4 || g === 5) g = waterFrame === 0 ? 4 : 5;
      bx.drawImage(SPRITES.tiles, g * TILE, 0, TILE, TILE, x * TILE - cam.x, y * TILE - cam.y, TILE, TILE);
      const o = overlayMap[y * MAP_W + x];
      if (o >= 0) {
        bx.drawImage(SPRITES.tiles, o * TILE, 0, TILE, TILE, x * TILE - cam.x, y * TILE - cam.y, TILE, TILE);
      }
    }
  }
}

function drawBuildings(cam) {
  buildingDefs.slice().sort((a, b) => (a.y + a.h) - (b.y + b.h)).forEach((b) => {
    const dx = Math.floor(b.x - cam.x);
    const dy = Math.floor(b.y - cam.y);
    const sx = b.sprite * 64;
    bx.drawImage(SPRITES.buildings, sx, 0, 64, 64, dx, dy, 64, 64);
    // 名牌
    const lx = b.x - cam.x + b.w / 2;
    const ly = b.y - cam.y - 4;
    drawLabel(b.name, lx, ly);
  });
}

function drawWorldProps(cam) {
  const trees = [
    { x: 3 * TILE, y: 8 * TILE, s: 1 }, { x: 6 * TILE, y: 6 * TILE, s: 1 },
    { x: 18 * TILE, y: 7 * TILE, s: 1 }, { x: 58 * TILE, y: 5 * TILE, s: 1 },
    { x: 57 * TILE, y: 35 * TILE, s: 1 }, { x: 4 * TILE, y: 34 * TILE, s: 1 },
    { x: 16 * TILE, y: 33 * TILE, s: 1 }, { x: 39 * TILE, y: 33 * TILE, s: 1 },
    { x: 52 * TILE, y: 11 * TILE, s: 1 }, { x: 59 * TILE, y: 18 * TILE, s: 1 },
  ];
  trees.forEach((tree) => drawTree(Math.floor(tree.x - cam.x), Math.floor(tree.y - cam.y)));

  const props = [
    { i: 0, x: 25 * TILE, y: 23 * TILE }, { i: 1, x: 26 * TILE, y: 23 * TILE },
    { i: 2, x: 14 * TILE, y: 20 * TILE }, { i: 3, x: 5 * TILE, y: 18 * TILE },
    { i: 4, x: 35 * TILE, y: 20 * TILE }, { i: 5, x: 30 * TILE, y: 18 * TILE },
    { i: 6, x: 18 * TILE, y: 26 * TILE }, { i: 7, x: 52 * TILE, y: 31 * TILE },
    { i: 3, x: 43 * TILE, y: 17 * TILE }, { i: 4, x: 33 * TILE, y: 10 * TILE },
    { i: 0, x: 9 * TILE, y: 13 * TILE }, { i: 1, x: 11 * TILE, y: 13 * TILE },
  ];
  props.forEach((p) => {
    const dx = Math.floor(p.x - cam.x);
    const dy = Math.floor(p.y - cam.y);
    if (dx < -16 || dx > VIEW_W || dy < -16 || dy > VIEW_H) return;
    bx.drawImage(SPRITES.props, p.i * 16, 0, 16, 16, dx, dy, 16, 16);
  });
}

function drawTree(x, y) {
  if (x < -36 || x > VIEW_W + 12 || y < -44 || y > VIEW_H + 12) return;
  bx.fillStyle = "rgba(0,0,0,0.28)";
  bx.beginPath();
  bx.ellipse(x + 16, y + 34, 13, 4, 0, 0, Math.PI * 2);
  bx.fill();
  // 树干
  bx.fillStyle = PAL.wood3;
  bx.fillRect(x + 13, y + 22, 6, 14);
  bx.fillStyle = PAL.wood1;
  bx.fillRect(x + 15, y + 22, 2, 12);
  // 像素树冠
  bx.fillStyle = PAL.grass3;
  bx.fillRect(x + 7, y + 8, 18, 16);
  bx.fillRect(x + 4, y + 14, 24, 12);
  bx.fillRect(x + 10, y + 2, 12, 10);
  bx.fillStyle = PAL.grass2;
  bx.fillRect(x + 9, y + 7, 14, 15);
  bx.fillRect(x + 6, y + 16, 9, 8);
  bx.fillStyle = PAL.grass4;
  bx.fillRect(x + 13, y + 5, 5, 5);
  bx.fillRect(x + 19, y + 14, 5, 5);
  bx.fillRect(x + 8, y + 18, 4, 4);
}

function drawLabel(text, cx, cy) {
  bx.font = "bold 8px monospace";
  const w = bx.measureText(text).width + 6;
  bx.fillStyle = "rgba(0,0,0,0.65)";
  bx.fillRect(Math.floor(cx - w / 2), Math.floor(cy - 9), Math.ceil(w), 10);
  bx.fillStyle = PAL.uiCream;
  bx.textAlign = "center";
  bx.textBaseline = "middle";
  bx.fillText(text, Math.floor(cx), Math.floor(cy - 4));
}

function drawPlots(cam) {
  game.plots.forEach((p) => {
    const px = p.tx * TILE - cam.x;
    const py = p.ty * TILE - cam.y;
    if (px < -16 || px > VIEW_W || py < -16 || py > VIEW_H) return;
    if (p.locked) {
      bx.fillStyle = "rgba(0,0,0,0.45)";
      bx.fillRect(px, py, TILE, TILE);
      bx.strokeStyle = "rgba(255,255,255,0.4)";
      bx.setLineDash([2, 2]);
      bx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
      bx.setLineDash([]);
      return;
    }
    const moist = clamp(p.moisture || 0, 0, 100) / 100;
    const tile = moist > 0.15 ? 7 : 6;
    bx.drawImage(SPRITES.tiles, tile * TILE, 0, TILE, TILE, px, py, TILE, TILE);
  });
}

function drawCrops(cam) {
  game.plots.forEach((p) => {
    if (!p.crop || p.locked) return;
    const px = p.tx * TILE - cam.x;
    const py = p.ty * TILE - cam.y;
    if (px < -16 || px > VIEW_W || py < -16 || py > VIEW_H) return;
    const crop = crops.find((c) => c.id === p.crop);
    const progress = getCropProgress(p);
    const stage = progress >= 1 ? 3 : progress >= 0.65 ? 2 : progress >= 0.3 ? 1 : 0;
    bx.drawImage(SPRITES.crops, crop.col * 16, stage * 16, 16, 16, px, py, 16, 16);
    // 成熟闪光
    if (progress >= 1 && Math.floor(Date.now() / 300) % 2 === 0) {
      bx.fillStyle = "rgba(255,243,167,0.75)";
      bx.fillRect(px + 7, py - 1, 2, 2);
    }
  });
}

function drawPlayer(p, cam, isSelf) {
  const dirRow = { down: 0, left: 1, right: 2, up: 3 }[p.facing] || 0;
  const frame = p.anim?.frame || 0;
  const sx = frame * 16, sy = dirRow * 24;
  const dx = Math.floor(p.x - cam.x - 8);
  const dy = Math.floor(p.y - cam.y - 20);

  // 阴影
  bx.fillStyle = "rgba(0,0,0,0.35)";
  bx.beginPath();
  bx.ellipse(dx + 8, dy + 22, 5, 2, 0, 0, Math.PI * 2);
  bx.fill();

  bx.drawImage(SPRITES.player, sx, sy, 16, 24, dx, dy, 16, 24);

  // 名字
  bx.font = "bold 7px monospace";
  const text = isSelf ? `${p.name}(你)` : p.name;
  const w = bx.measureText(text).width + 4;
  bx.fillStyle = isSelf ? PAL.uiGold : "rgba(0,0,0,0.7)";
  bx.fillRect(dx + 8 - w / 2, dy - 8, w, 8);
  bx.fillStyle = isSelf ? "#1a1408" : PAL.uiCream;
  bx.textAlign = "center";
  bx.textBaseline = "middle";
  bx.fillText(text, dx + 8, dy - 4);
}

function drawHover(cam) {
  const t = getNearestPlot();
  if (!t || t.dist > 28) return;
  const px = t.plot.tx * TILE - cam.x;
  const py = t.plot.ty * TILE - cam.y;
  const blink = Math.floor(Date.now() / 200) % 2 === 0;
  bx.strokeStyle = blink ? "#ffe066" : "#fff3a7";
  bx.lineWidth = 1;
  bx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  if (actionFlash > 0) {
    bx.fillStyle = `rgba(255, 255, 255, ${actionFlash})`;
    bx.fillRect(px, py, TILE, TILE);
  }
}

function drawMoveTarget(cam) {
  if (!moveTarget) return;
  const x = Math.floor(moveTarget.x - cam.x);
  const y = Math.floor(moveTarget.y - cam.y);
  const pulse = 1 + Math.sin(Date.now() / 120) * 0.25;
  bx.strokeStyle = "#fff3a7";
  bx.lineWidth = 1;
  bx.strokeRect(x - 5 * pulse, y - 5 * pulse, 10 * pulse, 10 * pulse);
  bx.fillStyle = "rgba(255, 209, 102, 0.85)";
  bx.fillRect(x - 1, y - 1, 3, 3);
}

function drawNight() {
  const night = Math.max(0, Math.sin(game.dayTime * Math.PI * 2 - 0.8));
  if (night <= 0) return;
  bx.fillStyle = `rgba(13, 28, 60, ${night * 0.4})`;
  bx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawHudOverlay() {
  // 像素 HUD：已经在 DOM 顶部了，这里只画日志
  const entries = (game.log || []).slice(0, 3);
  if (!entries.length) return;
  bx.fillStyle = "rgba(0, 0, 0, 0.55)";
  bx.fillRect(4, VIEW_H - 38, 200, 34);
  bx.fillStyle = PAL.uiCream;
  bx.font = "7px monospace";
  bx.textAlign = "left";
  bx.textBaseline = "alphabetic";
  entries.forEach((e, i) => bx.fillText(e.message.slice(0, 32), 8, VIEW_H - 28 + i * 10));
}

// 小地图 (画在主 canvas 上，不进缓冲)
function drawMiniMap(cam) {
  const w = 132, h = 84;
  const x = canvas.width - w - 14;
  const y = canvas.height - h - 14;
  ctx.fillStyle = "rgba(8,20,15,0.78)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // 用 buf 当快照
  const sx = (w - 8) / WORLD_W;
  const sy = (h - 8) / WORLD_H;
  // 草地铺底
  ctx.fillStyle = "#2c5d36";
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  // 路
  ctx.fillStyle = "#b6926a";
  ctx.fillRect(x + 4 + 2 * TILE * sx, y + 4 + 22 * TILE * sy, (MAP_W - 4) * TILE * sx, 1 * TILE * sy);
  ctx.fillRect(x + 4 + 28 * TILE * sx, y + 4 + 4 * TILE * sy, 1 * TILE * sx, (MAP_H - 8) * TILE * sy);
  // 池塘
  ctx.fillStyle = "#3aa8e4";
  ctx.fillRect(x + 4 + 44 * TILE * sx, y + 4 + 28 * TILE * sy, 8 * TILE * sx, 5 * TILE * sy);
  // 建筑点
  ctx.fillStyle = "#ffd166";
  buildingDefs.forEach((b) => {
    ctx.fillRect(x + 4 + b.x * sx, y + 4 + b.y * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
  });
  // 视野框
  ctx.strokeStyle = "#fff3a7";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 4 + cam.x * sx, y + 4 + cam.y * sy, VIEW_W * sx, VIEW_H * sy);
  // 玩家
  ctx.fillStyle = "#55d37b";
  ctx.beginPath();
  ctx.arc(x + 4 + game.player.x * sx, y + 4 + game.player.y * sy, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- HUD / 聊天 ----------
function updateHud() {
  ui.coin.textContent = Math.floor(game.coins);
  ui.level.textContent = game.level;
  ui.water.textContent = Math.floor(game.water);
  ui.room.textContent = game.room;
}

function renderCropBar() {
  ui.cropBar.innerHTML = "";
  crops.forEach((crop) => {
    const button = document.createElement("button");
    button.className = `crop-choice ${selectedCrop === crop.id ? "active" : ""}`;
    // 用 sprite 图集生成 dataURL 的 column
    const ico = document.createElement("canvas");
    ico.width = 16; ico.height = 16;
    const icx = ico.getContext("2d");
    icx.imageSmoothingEnabled = false;
    if (SPRITES.crops) icx.drawImage(SPRITES.crops, crop.col * 16, 3 * 16, 16, 16, 0, 0, 16, 16);
    button.innerHTML = `<span class="ico"></span><strong>${crop.name}</strong><small>${crop.cost} 金</small>`;
    button.querySelector(".ico").style.backgroundImage = `url(${ico.toDataURL()})`;
    button.title = crop.name;
    button.addEventListener("click", () => {
      selectedCrop = crop.id;
      renderCropBar();
      Sfx.play("ui");
    });
    ui.cropBar.appendChild(button);
  });
}

function renderChat() {
  if (!ui.chatMessages || ui.chatPanel.classList.contains("hidden")) return;
  const messages = (game.chat || []).slice(-18);
  const sig = messages.map((m) => m.id).join("|");
  if (sig === lastChatSignature) return;
  lastChatSignature = sig;
  ui.chatMessages.innerHTML = "";
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-line";
    empty.textContent = "还没有消息，发一句欢迎大家。";
    ui.chatMessages.appendChild(empty);
    return;
  }
  messages.forEach((m) => {
    const line = document.createElement("div");
    line.className = "chat-line";
    const name = document.createElement("strong");
    name.textContent = m.name || "玩家";
    line.appendChild(name);
    line.append(document.createTextNode(m.text || ""));
    ui.chatMessages.appendChild(line);
  });
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

function sendChat(text) {
  const clean = text.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean) return;
  game.chat = [...(game.chat || []), {
    id: `${game.player.id}-${now()}`,
    playerId: game.player.id,
    name: game.player.name,
    text: clean,
    t: now(),
  }].slice(-60);
  addLog(`${game.player.name}：${clean}`);
  renderChat();
  saveLocal();
  Sfx.play("ui");
  if (backendReady()) pushToGithub(true);
}

// ---------- 音频系统 ----------
const Sfx = (() => {
  let ctxA;
  const ensure = () => {
    if (!ctxA) ctxA = new (window.AudioContext || window.webkitAudioContext)();
    return ctxA;
  };
  const beep = (freq, dur, type = "square", vol = 0.06) => {
    try {
      const a = ensure();
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, a.currentTime);
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g).connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    } catch {}
  };
  const noise = (dur, vol = 0.06) => {
    try {
      const a = ensure();
      const buffer = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() - 0.5) * Math.exp(-i / data.length * 4);
      const src = a.createBufferSource();
      src.buffer = buffer;
      const g = a.createGain();
      g.gain.setValueAtTime(vol, a.currentTime);
      src.connect(g).connect(a.destination);
      src.start();
    } catch {}
  };
  return {
    play(name) {
      switch (name) {
        case "plant": beep(660, 0.08); setTimeout(() => beep(880, 0.08), 80); break;
        case "water": noise(0.25, 0.04); break;
        case "harvest": beep(880, 0.06); setTimeout(() => beep(1320, 0.08), 60); setTimeout(() => beep(1760, 0.1), 120); break;
        case "expand": beep(220, 0.18, "sawtooth", 0.05); break;
        case "ui": beep(1200, 0.04, "square", 0.04); break;
        case "step": noise(0.05, 0.025); break;
        default: break;
      }
    },
    resume() { try { ensure().resume(); } catch {} },
  };
})();

// ---------- GitHub 后端 ----------
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
  const c = getBackendConfig();
  return Boolean(c.owner && c.repo && c.branch && c.token);
}
function roomPath() { return `rooms/${encodeURIComponent(game.room)}.json`; }

async function githubRequest(path, options = {}) {
  const c = getBackendConfig();
  const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${c.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub 请求失败：${r.status} ${await r.text()}`);
  return r.json();
}
function encodeBase64Unicode(v) { return btoa(unescape(encodeURIComponent(v))); }
function decodeBase64Unicode(v) { return decodeURIComponent(escape(atob(v.replace(/\n/g, "")))); }
function publicState() {
  const clone = JSON.parse(JSON.stringify(game));
  clone.visitors = { ...(clone.visitors || {}), [game.player.id]: game.player };
  clone.chat = (clone.chat || []).slice(-60);
  clone.updatedAt = now();
  return clone;
}
async function pullFromGithub(silent = false) {
  if (!backendReady()) { if (!silent) showToast("请先配置 GitHub 后端", "bad"); return false; }
  try {
    ui.sync.textContent = "正在拉取云端房间...";
    const file = await githubRequest(roomPath());
    const remote = normalizeState(JSON.parse(decodeBase64Unicode(file.content)));
    mergeRemote(remote);
    saveLocal();
    ui.sync.textContent = "已从 GitHub 拉取";
    if (!silent) showToast("已同步云端房间");
    return file.sha;
  } catch (e) {
    if (String(e.message).includes("404")) { ui.sync.textContent = "云端暂无房间，等待创建"; return null; }
    ui.sync.textContent = "同步失败";
    if (!silent) showToast("GitHub 同步失败，请检查仓库权限", "bad");
    return false;
  }
}
function mergeRemote(remote) {
  const localPlayer = game.player;
  const map = new Map(remote.plots.map((p) => [p.id, p]));
  game = {
    ...game, ...remote,
    coins: Math.max(game.coins, remote.coins || 0),
    xp: Math.max(game.xp, remote.xp || 0),
    level: Math.max(game.level, remote.level || 1),
    water: Math.max(game.water, remote.water || 0),
    chat: mergeChat(game.chat || [], remote.chat || []),
    plots: game.plots.map((p) => {
      const r = map.get(p.id); if (!r) return p;
      if ((r.plantedAt || 0) > (p.plantedAt || 0) || r.crop !== p.crop) return r;
      return { ...r, ...p, harvests: Math.max(p.harvests || 0, r.harvests || 0) };
    }),
    visitors: { ...(remote.visitors || {}), [localPlayer.id]: localPlayer },
    player: localPlayer,
  };
}
function mergeChat(a, b) {
  const m = new Map();
  [...b, ...a].forEach((x) => { if (x?.id) m.set(x.id, x); });
  return [...m.values()].sort((a, b) => (a.t || 0) - (b.t || 0)).slice(-60);
}
async function pushToGithub(silent = false) {
  if (!backendReady()) { if (!silent) showToast("当前是本地模式", "bad"); return; }
  try {
    ui.sync.textContent = "正在推送到 GitHub...";
    const sha = await pullFromGithub(true);
    const c = getBackendConfig();
    await githubRequest(roomPath(), {
      method: "PUT",
      body: JSON.stringify({
        message: `sync cloud farm room ${game.room}`,
        content: encodeBase64Unicode(JSON.stringify(publicState(), null, 2)),
        branch: c.branch, ...(sha ? { sha } : {}),
      }),
    });
    ui.sync.textContent = `GitHub 已同步 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    if (!silent) showToast("云端同步完成");
  } catch {
    ui.sync.textContent = "同步失败";
    if (!silent) showToast("推送失败：请检查 Token 权限", "bad");
  }
}

// ---------- 启动 ----------
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
    game.chat = [{ id: `system-${now()}`, playerId: "system", name: "系统", text: "欢迎来到星之菜园！", t: now() }];
  }
  startScreen.classList.remove("active");
  gameScreen.classList.remove("hidden");
  ui.sync.textContent = backendReady() ? "GitHub 后端已就绪" : "本地模式";
  addLog(`${name} 进入了村庄`);
  renderCropBar();
  saveLocal();
  Sfx.resume();
  if (backendReady()) pushToGithub(true);
}

// ---------- 输入 ----------
function setMove(direction, pressed) { input[direction] = pressed; }

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const sy = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  return {
    x: clamp(camera.x + sx * VIEW_W, 0, WORLD_W - 1),
    y: clamp(camera.y + sy * VIEW_H, 0, WORLD_H - 1),
  };
}

function plotAtWorld(x, y) {
  return game.plots.find((plot) => {
    const px = plot.tx * TILE;
    const py = plot.ty * TILE;
    return x >= px && x <= px + TILE && y >= py && y <= py + TILE;
  });
}

function handleMapPointer(event) {
  if (gameScreen.classList.contains("hidden")) return;
  const world = screenToWorld(event.clientX, event.clientY);
  const plot = plotAtWorld(world.x, world.y);
  if (plot) {
    moveTarget = { x: plot.tx * TILE + TILE / 2, y: plot.ty * TILE + TILE + 8, plotId: plot.id };
    if (plot.locked) showToast("这块地还没开垦，靠近后点“开垦”");
    else if (!plot.crop) showToast("正在前往空地，靠近后可播种");
    else if (getCropProgress(plot) >= 1) showToast("正在前往成熟作物，靠近后可收获");
    else showToast("正在前往作物，靠近后可浇水");
  } else {
    moveTarget = { x: world.x, y: world.y };
  }
  Sfx.play("ui");
}

function bindHold(button, direction) {
  const el = $(button);
  if (!el) return;
  const down = (e) => { e.preventDefault(); setMove(direction, true); Sfx.resume(); };
  const up = () => setMove(direction, false);
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerleave", up);
}

function resizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width || window.innerWidth));
  const cssH = Math.max(1, Math.round(rect.height || window.innerHeight));
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ratio = canvas.width / Math.max(1, canvas.height);
  VIEW_H = BASE_VIEW_H;
  VIEW_W = clamp(Math.round(VIEW_H * ratio), 360, 760);
  if (buf.width !== VIEW_W || buf.height !== VIEW_H) {
    buf.width = VIEW_W;
    buf.height = VIEW_H;
    bx.imageSmoothingEnabled = false;
  }
  ctx.imageSmoothingEnabled = false;
}

function bindEvents() {
  $("#startGame").addEventListener("click", () => { Sfx.play("ui"); startGame(); });
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
  $("#toolToggle").addEventListener("click", () => {
    const controls = $("#controlsPanel");
    const cropBar = $("#cropBar");
    const open = controls.classList.toggle("collapsed") === false;
    cropBar.classList.toggle("collapsed", !open);
    $("#toolToggle").classList.toggle("open", open);
    $("#toolToggle").setAttribute("aria-expanded", String(open));
    Sfx.play("ui");
  });
  canvas.addEventListener("pointerdown", handleMapPointer);
  $("#syncNow").addEventListener("click", () => pushToGithub(false));
  $("#chatToggle").addEventListener("click", () => {
    ui.chatPanel.classList.toggle("hidden");
    renderChat();
    if (!ui.chatPanel.classList.contains("hidden")) ui.chatInput.focus();
  });
  $("#closeChat").addEventListener("click", () => ui.chatPanel.classList.add("hidden"));
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    sendChat(ui.chatInput.value);
    ui.chatInput.value = "";
  });
  bindHold("#upBtn", "up");
  bindHold("#leftBtn", "left");
  bindHold("#rightBtn", "right");
  bindHold("#downBtn", "down");

  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft" || k === "a") setMove("left", true);
    if (e.key === "ArrowRight" || k === "d") setMove("right", true);
    if (e.key === "ArrowUp" || k === "w") setMove("up", true);
    if (e.key === "ArrowDown" || k === "s") setMove("down", true);
    if (k === "j") plant();
    if (k === "k") water();
    if (k === "l") harvest();
    if (k === "u") expandFarm();
    if (k === "enter") $("#chatToggle").click();
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft" || k === "a") setMove("left", false);
    if (e.key === "ArrowRight" || k === "d") setMove("right", false);
    if (e.key === "ArrowUp" || k === "w") setMove("up", false);
    if (e.key === "ArrowDown" || k === "s") setMove("down", false);
  });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);

  // 手柄
  window.addEventListener("gamepadconnected", () => showToast("手柄已连接"));
}

function readGamepad() {
  if (!navigator.getGamepads) return;
  const gps = navigator.getGamepads();
  for (const g of gps) {
    if (!g) continue;
    const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
    setMove("left", ax < -0.3); setMove("right", ax > 0.3);
    setMove("up", ay < -0.3); setMove("down", ay > 0.3);
    const current = new Set();
    g.buttons.forEach((button, index) => {
      if (button?.pressed) current.add(index);
    });
    const pressedOnce = (index) => current.has(index) && !lastGamepadButtons.has(index);
    if (pressedOnce(0)) plant();
    if (pressedOnce(1)) water();
    if (pressedOnce(2)) harvest();
    if (pressedOnce(3)) expandFarm();
    lastGamepadButtons = current;
    return;
  }
  lastGamepadButtons.clear();
}

function initBackendForm() {
  $("#ghOwner").value = savedBackend.owner || "magao520";
  $("#ghRepo").value = savedBackend.repo || "";
  $("#ghBranch").value = savedBackend.branch || "main";
  $("#ghToken").value = savedBackend.token || "";
}

// ---------- 主循环 ----------
function gameLoop(time) {
  const delta = (time - lastTime) / 1000;
  lastTime = time;
  accumulator += Math.min(delta, 0.25);
  while (accumulator >= FIXED_DT) {
    update(FIXED_DT);
    readGamepad();
    accumulator -= FIXED_DT;
  }
  render();
  requestAnimationFrame(gameLoop);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("./sw.js").then((r) => r.update()).catch(() => {});
  }
}

// ---------- 初始化 ----------
buildAssets();
buildLevel();
applyBuildingCollisions();
initBackendForm();
renderCropBar();
resizeCanvas();
bindEvents();
registerServiceWorker();
requestAnimationFrame(gameLoop);
