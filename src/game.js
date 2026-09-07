// game.js —— 3D 賽車:THREE 場景 + 狀態機(menu→countdown→racing→finished)+ 車體 rig + 五檔視角。
// 不碰 DOM(3d-game-kit 三件套);headless 模式(無 canvas)可在 node 跑整場比賽做測試。
// ★ this.running 只給 RAF(speed-race-kit 鐵則 1);比賽狀態用 this.phase。
// ★ mesh.visible 一律 !!(0827 全艦隊通則)。
// ★ 視角名單一份常數(CAM_VIEWS + CAM_LABELS),localStorage 驗證與 cycleCamView 吃同一份。
import * as THREE from "three";
import { TRACKS, TRACK_IDS, BASE_TRACKS, BASE_TRACK_IDS, TRACK_VARIANTS, VARIANT_LABELS, trackIdOf, buildTrack, posAt, pointAtOffset, rightOfTangent, tvCameraSpots, nearest } from "./track.js";
import { CAR, DIFFICULTY, ASSIST_MODES, ASSIST_LABELS, assistStrength, createCar, placeOnTrack, stepCar, emptyInput, rescue, forwardOf, rpm01, kmh, clamp, resolveCollisions } from "./vehicle.js";
import { makeAiBrain, aiInput } from "./ai.js";
import { VEHICLES, VEHICLE_IDS, AI_VEHICLE_MODES, AI_VEHICLE_LABELS, vehicleParams, aiVehicleFor } from "./vehicles.js";
import { makeMotoRig, makeHorseRig, makeHoverRig } from "./rigs.js";
import { ITEM_TYPES, buildItems, stepItems, respawnForCar } from "./items.js";
import { dailyChallenge, dailyKey } from "./daily.js";

export { TRACKS, TRACK_IDS, BASE_TRACKS, BASE_TRACK_IDS, TRACK_VARIANTS, VARIANT_LABELS, trackIdOf, DIFFICULTY, ASSIST_MODES, ASSIST_LABELS, VEHICLES, VEHICLE_IDS, AI_VEHICLE_MODES, AI_VEHICLE_LABELS, ITEM_TYPES, dailyChallenge, dailyKey };

/* 模式(duel-2p-kit 單閘門:所有分歧只問 is2P()):solo=單人;duel2p=雙人同機分割畫面(左 P1 藍、右 P2 紅,鐵則色)。 */
export const MODES = { solo: { id: "solo", label: "單人" }, duel2p: { id: "duel2p", label: "雙人同機(分割畫面)" } };
export const P1_COLOR = 1, P2_COLOR = 0;   // 海洋藍 / 烈焰紅(全系列 P1 藍 P2 紅,孩子跨遊戲不用重學)
/* 起跑格(0906 收掉待拍板):last=玩家排最後(後面沒車擋追尾鏡頭、超車才好玩,預設);front=玩家排最前排。 */
export const GRID_OPTIONS = ["last", "front"];
export const GRID_LABELS = { last: "最後一排(超車最好玩)", front: "最前排" };

/* 視角五檔(V 鍵/視角鈕照這個順序輪)。每檔都要有中文名(缺名=畫面印「視角:undefined」)。
   tv 只在「結算/回放」自動用,手動選也可以——但它是固定機位,轉向仍是「車的左右」(方向盤就是方向盤)。 */
export const CAM_VIEWS = ["chase", "hood", "cockpit", "bird", "tv"];
export const CAM_LABELS = { chase: "追尾跟隨", hood: "車頭", cockpit: "駕駛座", bird: "高空俯瞰", tv: "轉播機位" };
export const CAM_KEY = "racing3d-camview";

export const CAR_COLORS = [
  { id: "red", label: "烈焰紅", hex: 0xe53935 },
  { id: "blue", label: "海洋藍", hex: 0x1e88e5 },
  { id: "yellow", label: "陽光黃", hex: 0xfdd835 },
  { id: "green", label: "青草綠", hex: 0x43a047 },
  { id: "purple", label: "葡萄紫", hex: 0x8e24aa },
  { id: "orange", label: "橘子橘", hex: 0xfb8c00 },
  { id: "white", label: "珍珠白", hex: 0xf5f5f5 },
];
export const LAP_OPTIONS = [1, 2, 3, 5];
export const AI_OPTIONS = [0, 1, 2, 3, 5];
export const AI_NAMES = ["阿福", "小美", "大衛", "以諾", "米迦", "撒拉", "約書亞"];
export const DEFAULT_SETTINGS = { trackId: "meadow", laps: 3, aiCount: 3, difficulty: "easy", colorIdx: 0, mode: "solo", assist: "auto", gridPos: "last", vehicle: "car", vehicle2: "car", aiVehicle: "mix", items: true };
const COUNTDOWN_SECONDS = 3.6;
/* 完美起跑(v3 規則,0907):GO 之後 window 秒內踩油門、而且油門「連續按住」還不到 hold 秒(倒數到「1」才踩算,從「3」就一直按不算)
   ⇒ 免費渦輪 boostSeconds 秒(燃料每幀退回,不碰 stepCar 物理)。太早按不罰、只提醒(溫柔規則)。
   AI 也會:每台以 aiSkill × aiChance 的機率拿到(職業檔約一半、幼兒檔約兩成),種子固定可重現。 */
export const PERFECT_START = { hold: 1.2, window: 0.6, boostSeconds: 1.4, aiChance: 0.5 };

const V = () => new THREE.Vector3();
const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export class RacingGame {
  constructor({ canvas = null, headless = false } = {}) {
    this.canvas = canvas;
    this.headless = headless || !canvas;
    this.phase = "menu";          // menu | countdown | racing | finished
    this.running = false;         // ★ 只給 RAF
    this.settings = { ...DEFAULT_SETTINGS };
    this.input = emptyInput();    // P1
    this.input2 = emptyInput();   // P2(雙人同機)
    this.autopilot = false;       // 測試/展示:玩家車(全部人類車)交給 AI
    this.items = []; this.itemMeshes = new Map();   // v5 道具層(整段可刪不傷核心:items=[] 就是 v4 行為)
    this.dailyKey = null;         // 今日挑戰:非 null 表示這一場是每日題
    this.paused = false;          // 暫停(v3):只在倒數/比賽中;整個世界凍住(物理/計時/鏡頭都不推),render 照畫最後一幀
    this.cars = []; this.rigs = new Map(); this.brains = new Map();
    this.player = null;           // P1(相容舊呼叫)
    this.players = [];            // 人類車手 [P1, P2?];索引 = car.playerIdx = 視窗索引
    this.raceT = 0; this.countdownT = 0; this._cdLast = 99;
    this.finishOrder = []; this.results = null; this._allAiDoneT = 0;
    this.message = ""; this.messageT = 0;
    this.onHud = null; this.onEvent = null;
    this.time = 0;
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 鏡頭狀態全部在建構子就有數字(選單期 render 就在跑,NaN 中毒雷)。
    // 每個視窗一份 cam state(雙人同機=兩份);this.camera/camPos/camView… 是 cams[0] 的相容別名(getter)。
    const savedView = (key, fallback) => { try { const v = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null; return v && CAM_VIEWS.includes(v) ? v : fallback; } catch { return fallback; } };
    this.cams = [this._makeCamState(savedView(CAM_KEY, "chase")), this._makeCamState(savedView(CAM_KEY + "-p2", "chase"))];
    this._v1 = V(); this._v2 = V(); this._v3 = V(); this._v4 = V();
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._vw = 1280; this._vh = 720;

    this.renderer = null;
    if (!this.headless) {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    this.scene = null; this.track = null; this.tvSpots = [];
    this.setTrack(this.settings.trackId);
    this._snapCams();
  }

  _makeCamState(view) {
    return {
      view, forceTv: false, snap: true, tvIdx: -1, shake: 0,
      pos: new THREE.Vector3(0, 12, -40), look: new THREE.Vector3(0, 0, 0), up: new THREE.Vector3(0, 1, 0), fov: 60,
      chaseDir: new THREE.Vector3(0, 0, 1),   // 追尾鏡頭的平滑方向(位置本身不 lerp)
      d: { pos: V(), look: V(), up: new THREE.Vector3(0, 1, 0), fov: 60, near: 0.3, kPos: 1, kLook: 1, kUp: 1, hard: false },
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 4000),
    };
  }
  _snapCams() { for (const c of this.cams) c.snap = true; }
  /* 相容別名(測試與舊呼叫都用這幾個名字) */
  get camera() { return this.cams[0].camera; }
  get camPos() { return this.cams[0].pos; }
  get camLook() { return this.cams[0].look; }
  get camUp() { return this.cams[0].up; }
  get camFov() { return this.cams[0].fov; }
  get camView() { return this.cams[0].view; }
  set camView(v) { this.cams[0].view = v; }
  get shake() { return this.cams[0].shake; }
  set shake(v) { this.cams[0].shake = v; }
  /** 單閘門:是不是雙人同機(選單期只有一台展示車 ⇒ false)。 */
  is2P() { return this.settings.mode === "duel2p" && this.players.length === 2; }
  /** 玩家的「AI 輕扶回中」強度(選單開關 × 難度預設)。 */
  assistStrength() { return assistStrength(DIFFICULTY[this.settings.difficulty] || DIFFICULTY.easy, this.settings.assist); }
  _pName(car) { return this.is2P() ? (car.playerIdx === 1 ? "P2" : "P1") : "你"; }

  /* ───────────────────────── 世界 ───────────────────────── */

  /** 換賽段=換整個 Scene(race-stage-kit ①):乾淨無殘留。 */
  setTrack(id) {
    if (!TRACKS[id]) id = "meadow";
    this.settings.trackId = id;
    this.track = buildTrack(TRACKS[id]);
    this.tvSpots = tvCameraSpots(this.track, 150);
    this.items = buildItems(this.track, this.settings.items === false ? 0 : 1);
    for (const c of this.cams) c.tvIdx = -1;
    this._clearCars();
    this._buildWorld();
    if (this.phase === "menu") this._placeMenuCar();
    this._snapCams();
  }

  _buildWorld() {
    const t = this.track, pal = t.palette;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(pal.sky);
    scene.fog = new THREE.Fog(pal.fog, 220, 1400);   // ★ 遠平面/霧要蓋過整條賽道(race-stage-kit ② 雷)
    scene.add(new THREE.HemisphereLight(0xe8f2ff, pal.grass, 0.85));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.35);
    sun.position.set(260, 380, 140);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // 地面
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), lambert(pal.grass));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.1;
    scene.add(ground);

    // 路面帶狀網格 + 路肩 + 邊坡裙(全部同一組 samples=判定=畫面)
    const maxH = Math.max(...t.samples.map((s) => s.y));
    const skirtW = Math.max(22, maxH * 2.6);
    scene.add(new THREE.Mesh(this._strip(-t.halfW, t.halfW, 0), lambert(pal.road)));
    scene.add(new THREE.Mesh(this._strip(-t.wallDist, -t.halfW, -0.012), lambert(pal.shoulder)));
    scene.add(new THREE.Mesh(this._strip(t.halfW, t.wallDist, -0.012), lambert(pal.shoulder)));
    const skirtColor = new THREE.Color(pal.grass).multiplyScalar(0.92);
    scene.add(new THREE.Mesh(this._strip(-t.wallDist - skirtW, -t.wallDist, -0.02, { dropOuter: true }), lambert(skirtColor)));
    scene.add(new THREE.Mesh(this._strip(t.wallDist, t.wallDist + skirtW, -0.02, { dropOuter: true }), lambert(skirtColor)));
    // 邊線 + 中央虛線
    const lineMat = lambert(pal.line);
    scene.add(new THREE.Mesh(this._strip(t.halfW - 0.55, t.halfW - 0.25, 0.02), lineMat));
    scene.add(new THREE.Mesh(this._strip(-t.halfW + 0.25, -t.halfW + 0.55, 0.02), lineMat));
    scene.add(new THREE.Mesh(this._strip(-0.14, 0.14, 0.02, { dash: 8 }), lineMat));

    this._buildCurbsAndBarriers(scene);
    this._buildStartLine(scene);
    this._buildTurnSigns(scene);
    this._buildScenery(scene);
    this._buildSkyDressing(scene);
    this._buildTvTripods(scene);
    this._buildItems(scene);

    this.scene = scene;
  }

  /** 道具的 3D 物件:加速板=綠底白箭頭貼地、油漬=深色扁橢圓、星星=金色八面體會轉。 */
  _buildItems(scene) {
    this.itemMeshes = new Map();
    if (!this.items || !this.items.length) return;
    for (const it of this.items) {
      const cfg = ITEM_TYPES[it.type];
      const g = new THREE.Group();
      g.position.set(it.x, it.y, it.z);
      if (it.type === "boost") {
        // 加速板:亮綠底 + 白外框 + 三排大 V 形箭頭(0907 截圖抓到:原本太小太暗,車一壓上去就看不出是什麼)
        const p = posAt(this.track, it.dist);
        g.rotation.y = Math.atan2(p.tx, p.tz);
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 7.4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        frame.rotation.x = -Math.PI / 2; frame.position.y = 0.022; g.add(frame);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 6.8), new THREE.MeshBasicMaterial({ color: cfg.color }));
        pad.rotation.x = -Math.PI / 2; pad.position.y = 0.03; g.add(pad);
        for (const dz of [-1.9, 0, 1.9]) {
          for (const sx of [-1, 1]) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.55), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            bar.position.set(sx * 0.72, 0.05, dz); bar.rotation.y = sx * 0.66; g.add(bar);
          }
        }
      } else if (it.type === "oil") {
        // 油漬:深色池 + **亮紫外圈**(0907 截圖抓到:純深色在深灰路面上等於隱形,孩子只會覺得莫名其妙滑了一下)
        const ring = new THREE.Mesh(new THREE.RingGeometry(cfg.radius * 0.98, cfg.radius * 1.32, 24), new THREE.MeshBasicMaterial({ color: 0xa98cff, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.022; ring.scale.set(1.25, 0.9, 1); g.add(ring);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(cfg.radius, 22), new THREE.MeshBasicMaterial({ color: cfg.color }));
        pool.rotation.x = -Math.PI / 2; pool.position.y = 0.032; pool.scale.set(1.25, 0.9, 1); g.add(pool);
        for (const [ox, oz, r] of [[0.5, 0.3, 0.55], [-0.6, -0.4, 0.42], [0.2, -0.7, 0.3]]) {
          const sheen = new THREE.Mesh(new THREE.CircleGeometry(r, 14), new THREE.MeshBasicMaterial({ color: 0x7b5fd6 }));
          sheen.rotation.x = -Math.PI / 2; sheen.position.set(ox, 0.038, oz); g.add(sheen);
        }
      } else {
        // 星星:金色八面體 + 地面光環 + 光柱(遠遠就看得到,值得繞過去撿)
        const halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.5, 20), new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
        halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03; g.add(halo);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 2.6, 10, 1, true), new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
        beam.position.y = 1.3; g.add(beam);
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(1.05), new THREE.MeshLambertMaterial({ color: cfg.color, emissive: 0xffb020, emissiveIntensity: 0.9 }));
        star.position.y = 1.45; star.scale.set(1, 1.4, 1); g.add(star);
        g.userData.spin = star;
      }
      scene.add(g);
      this.itemMeshes.set(it.id, g);
    }
  }

  /** 沿樣條的帶狀幾何:lateral fromL..toL,y 偏移 yOff;dropOuter=外緣降到地面(邊坡裙);dash=每 n 個樣本畫/不畫。 */
  _strip(fromL, toL, yOff, opts = {}) {
    const t = this.track, S = t.samples, N = t.N;
    const pos = [], idx = [];
    const outerIsRight = Math.abs(toL) > Math.abs(fromL);
    for (let i = 0; i <= N; i++) {
      const s = S[i % N];
      const r = rightOfTangent(s.tx, s.tz);
      const yA = s.y + yOff, yB = s.y + yOff;
      const dropA = opts.dropOuter && !outerIsRight ? -0.1 : yA;
      const dropB = opts.dropOuter && outerIsRight ? -0.1 : yB;
      pos.push(s.x + r.x * fromL, dropA, s.z + r.z * fromL);
      pos.push(s.x + r.x * toL, dropB, s.z + r.z * toL);
    }
    for (let i = 0; i < N; i++) {
      if (opts.dash && Math.floor(i / opts.dash) % 2 === 1) continue;
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      // ★ 繞序決定法線朝向:(b−a)×(c−a) 要朝 +y,否則整條路被背面剔除(首跑截圖:車在草地上跑)
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  _buildCurbsAndBarriers(scene) {
    const t = this.track, S = t.samples, N = t.N;
    // 彎道紅白路緣(InstancedMesh)
    const curbIdx = [];
    for (let i = 0; i < N; i += 4) if (Math.abs(S[i].k) > 0.007) curbIdx.push(i);
    if (curbIdx.length) {
      const geo = new THREE.BoxGeometry(0.5, 0.14, 2.7);
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const inst = new THREE.InstancedMesh(geo, mat, curbIdx.length * 2);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V(), sc = new THREE.Vector3(1, 1, 1);
      const red = new THREE.Color(0xd93025), white = new THREE.Color(0xf7f7f7);
      let n = 0;
      curbIdx.forEach((i, j) => {
        const s = S[i], r = rightOfTangent(s.tx, s.tz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(s.tx, s.tz));
        for (const side of [-1, 1]) {
          p.set(s.x + r.x * (t.halfW + 0.3) * side, s.y + 0.05, s.z + r.z * (t.halfW + 0.3) * side);
          m.compose(p, q, sc); inst.setMatrixAt(n, m);
          inst.setColorAt(n, j % 2 === 0 ? red : white); n++;
        }
      });
      scene.add(inst);
    }
    // 牆:矮樁 + 繩(每 8 公尺一根)
    const step = Math.max(1, Math.round(8 / (t.length / N)));
    const posts = [];
    for (let i = 0; i < N; i += step) posts.push(i);
    const pg = new THREE.CylinderGeometry(0.09, 0.09, 1.0, 8);
    const pm = new THREE.MeshLambertMaterial({ color: 0xe9eef5 });
    const pInst = new THREE.InstancedMesh(pg, pm, posts.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V(), sc = new THREE.Vector3(1, 1, 1);
    const ropePts = [];
    let n = 0;
    for (let k = 0; k < posts.length; k++) {
      const s = S[posts[k]], r = rightOfTangent(s.tx, s.tz);
      const s2 = S[posts[(k + 1) % posts.length]], r2 = rightOfTangent(s2.tx, s2.tz);
      for (const side of [-1, 1]) {
        p.set(s.x + r.x * t.wallDist * side, s.y + 0.5, s.z + r.z * t.wallDist * side);
        m.compose(p, q, sc); pInst.setMatrixAt(n++, m);
        ropePts.push(p.x, s.y + 0.92, p.z, s2.x + r2.x * t.wallDist * side, s2.y + 0.92, s2.z + r2.z * t.wallDist * side);
      }
    }
    scene.add(pInst);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(ropePts, 3));
    scene.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xffffff })));
  }

  _checkerTexture(cols = 8, rows = 2) {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = cols * 16; c.height = rows * 16;
    const g = c.getContext("2d");
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? "#111" : "#f4f4f4";
      g.fillRect(x * 16, y * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildStartLine(scene) {
    const t = this.track;
    const p = posAt(t, 0);
    const yaw = Math.atan2(p.tx, p.tz);
    const tex = this._checkerTexture(Math.round(t.halfW * 2), 2);
    const lineMat = tex ? new THREE.MeshLambertMaterial({ map: tex }) : lambert(0xffffff);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(t.halfW * 2, 2.6), lineMat);
    line.rotation.order = "YXZ";
    line.rotation.y = yaw; line.rotation.x = -Math.PI / 2;
    line.position.set(p.x, p.y + 0.03, p.z);
    scene.add(line);
    // 龕門:兩柱一梁
    const r = rightOfTangent(p.tx, p.tz);
    const postMat = lambert(0xf0f0f0);
    const h = 6.5;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), postMat);
      post.position.set(p.x + r.x * (t.wallDist + 0.6) * side, p.y + h / 2, p.z + r.z * (t.wallDist + 0.6) * side);
      scene.add(post);
    }
    const beamTex = this._checkerTexture(Math.round(t.wallDist * 2), 1);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(t.wallDist * 2 + 1.7, 1.1, 0.6), beamTex ? new THREE.MeshLambertMaterial({ map: beamTex }) : lambert(0xd93025));
    beam.position.set(p.x, p.y + h + 0.3, p.z);
    beam.rotation.y = yaw;
    scene.add(beam);
    this.startYaw = yaw; this.startPos = new THREE.Vector3(p.x, p.y, p.z);
  }

  /** 急彎前 25m、外側立一塊黃底黑箭頭板(孩子看得到要轉了)。 */
  _buildTurnSigns(scene) {
    const t = this.track, S = t.samples, N = t.N;
    const boardMat = lambert(0xffd400);
    const chevMat = lambert(0x111111);
    const postMat = lambert(0x666a70);
    const perM = N / t.length;
    let i = 0;
    while (i < N) {
      if (Math.abs(S[i].k) > 0.014) {
        // 找這一段彎的頂點
        let j = i, apex = i;
        while (j < N && Math.abs(S[j].k) > 0.008) { if (Math.abs(S[j].k) > Math.abs(S[apex].k)) apex = j; j++; }
        const sign = S[apex].k > 0 ? 1 : -1;              // + 右彎
        const at = (apex - Math.round(25 * perM) + N) % N;
        const s = S[at], r = rightOfTangent(s.tx, s.tz);
        const side = -sign;                               // 外側
        const g = new THREE.Group();
        g.position.set(s.x + r.x * (t.wallDist + 1.6) * side, s.y, s.z + r.z * (t.wallDist + 1.6) * side);
        g.rotation.y = Math.atan2(s.tx, s.tz) + Math.PI;  // 面對來車
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), postMat); post.position.y = 0.8; g.add(post);
        const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 0.08), boardMat); board.position.y = 2.0; g.add(board);
        // 箭頭:兩段斜箭(指向彎的方向;右彎的箭要指向「來車的右」=面對來車時的 −(車右)…用 sign 決定)
        for (const k of [-0.4, 0, 0.4]) {
          const a = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.02), chevMat);
          a.position.set(k - sign * 0.12, 2.12, -0.05); a.rotation.z = sign * 0.8; g.add(a);
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.02), chevMat);
          b.position.set(k - sign * 0.12, 1.88, -0.05); b.rotation.z = -sign * 0.8; g.add(b);
        }
        scene.add(g);
        i = j + Math.round(40 * perM);
      } else i++;
    }
  }

  /** 樹/仙人掌/雪松種在邊坡外側(不懸空:高度沿邊坡插值)。 */
  _buildScenery(scene) {
    const t = this.track, kind = t.scenery;
    const count = 170;
    const rnd = mulberry(20260905);
    const maxH = Math.max(...t.samples.map((s) => s.y));
    const skirtW = Math.max(22, maxH * 2.6);
    let trunkGeo, crownGeo, trunkColor, crownColor, crownY, scaleBase;
    if (kind === "cactus") {
      trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 3.2, 8); crownGeo = new THREE.SphereGeometry(0.5, 8, 6);
      trunkColor = 0x3f8f3a; crownColor = 0xe8546a; crownY = 3.3; scaleBase = 0.9;
    } else if (kind === "pines") {
      trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 7); crownGeo = new THREE.ConeGeometry(2.2, 6.5, 8);
      trunkColor = 0x5a3b22; crownColor = 0x2f6b46; crownY = 4.6; scaleBase = 1.0;
    } else {
      trunkGeo = new THREE.CylinderGeometry(0.28, 0.38, 2.6, 7); crownGeo = new THREE.SphereGeometry(2.4, 9, 7);
      trunkColor = 0x6b4a2b; crownColor = 0x2f8f3f; crownY = 4.2; scaleBase = 1.0;
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, lambert(trunkColor), count);
    const crowns = new THREE.InstancedMesh(crownGeo, lambert(crownColor), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V(), sc = V();
    const crownTint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const d = rnd() * t.length;
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = t.wallDist + 5 + rnd() * 55;
      const base = pointAtOffset(t, d, lat * side);
      const drop = clamp((lat - t.wallDist) / skirtW, 0, 1);
      const y = base.y * (1 - drop) - 0.1 * drop;
      const s = scaleBase * (0.75 + rnd() * 0.7);
      sc.set(s, s, s);
      p.set(base.x, y + (trunkGeo.parameters.height * s) / 2, base.z);
      m.compose(p, q, sc); trunks.setMatrixAt(i, m);
      p.set(base.x, y + crownY * s, base.z);
      m.compose(p, q, sc); crowns.setMatrixAt(i, m);
      crownTint.setHex(crownColor).offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.12);
      crowns.setColorAt(i, crownTint);
    }
    scene.add(trunks); scene.add(crowns);
    if (kind === "pines") {
      // 雪松頂上一層白
      const caps = new THREE.InstancedMesh(new THREE.ConeGeometry(1.2, 2.2, 8), lambert(0xffffff), count);
      for (let i = 0; i < count; i++) { crowns.getMatrixAt(i, m); p.setFromMatrixPosition(m); sc.setFromMatrixScale(m); p.y += 2.6 * sc.x; m.compose(p, q, sc); caps.setMatrixAt(i, m); }
      scene.add(caps);
    }
  }

  _buildSkyDressing(scene) {
    const t = this.track, pal = t.palette;
    const rnd = mulberry(7);
    // 遠山
    const mtMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(pal.fog).multiplyScalar(0.72) });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
      const R = 1400 + rnd() * 500;
      const h = 160 + rnd() * 260, w = 220 + rnd() * 320;
      const mt = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), mtMat);
      mt.position.set(Math.cos(a) * R, h / 2 - 20, Math.sin(a) * R);
      scene.add(mt);
    }
    // 雲
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false });
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(14 + rnd() * 12, 8, 6), cloudMat);
        c.position.set((k - 1) * 18 + rnd() * 6, rnd() * 4, rnd() * 6); c.scale.y = 0.45; g.add(c);
      }
      const a = rnd() * Math.PI * 2, R = 350 + rnd() * 700;
      g.position.set(Math.cos(a) * R, 140 + rnd() * 80, Math.sin(a) * R);
      scene.add(g);
    }
  }

  _buildTvTripods(scene) {
    const mat = lambert(0x2a2d33);
    for (const s of this.tvSpots) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.5, 6), mat); pole.position.y = -3.4; g.add(pole);
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.9), mat); g.add(cam);
      g.position.set(s.x, s.y, s.z);
      scene.add(g);
    }
  }

  /* ───────────────────────── 車體 rig ───────────────────────── */

  _makeCarRig(hex, { interior = false } = {}) {
    const group = new THREE.Group();
    const tilt = new THREE.Group();      // 俯仰/側傾掛這裡
    group.add(tilt);
    const paint = new THREE.MeshLambertMaterial({ color: hex });
    const dark = lambert(0x1f2229);
    const glass = new THREE.MeshLambertMaterial({ color: 0x21395c, transparent: true, opacity: 0.72 });
    const hide = [];   // 駕駛座視角要藏的(車艙/窗/車頂/駕駛頭)
    const add = (mesh, x, y, z, parent = tilt) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.42, 4.0), paint), 0, 0.62, 0);          // 底盤/引擎蓋
    add(new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.22, 4.15), dark), 0, 0.42, 0);        // 下裙
    add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.14), dark), 0, 0.5, 2.06);        // 前保桿
    add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.14), dark), 0, 0.5, -2.06);       // 後保桿
    const cabin = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.7), paint), 0, 1.08, -0.35); hide.push(cabin);
    const wind = add(new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.52, 0.06), glass), 0, 1.08, 0.62); wind.rotation.x = -0.42; hide.push(wind);
    const rear = add(new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.42, 0.06), glass), 0, 1.1, -1.24); rear.rotation.x = 0.38; hide.push(rear);
    for (const sx of [-1, 1]) {
      const sw = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 1.3), glass), sx * 0.76, 1.1, -0.3); hide.push(sw);
    }
    // 燈
    const headMat = new THREE.MeshLambertMaterial({ color: 0xfff6d0, emissive: 0xfff2b0, emissiveIntensity: 0.9 });
    const tailMat = new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0xff2a2a, emissiveIntensity: 0.35 });
    for (const sx of [-1, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), headMat), sx * 0.6, 0.74, 2.02);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), tailMat), sx * 0.6, 0.72, -2.02);
    }
    // 尾翼
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.42), dark), 0, 1.12, -1.95);
    for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), dark), sx * 0.6, 0.97, -1.95);
    // 渦輪火焰(只在 boosting 亮;visible 一律 !!)
    const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0xffa321 })), 0, 0.5, -2.5);
    flame.rotation.x = -Math.PI / 2; flame.visible = false;
    // 輪子(前輪掛轉向 pivot)
    const tireGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.3, 18); tireGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 12); hubGeo.rotateZ(Math.PI / 2);
    const tireMat = lambert(0x171717), hubMat = lambert(0xbfc5cf);
    const wheels = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * 0.86, CAR.wheelRadius, sz * 1.35); tilt.add(pivot);
      const spin = new THREE.Group(); pivot.add(spin);
      spin.add(new THREE.Mesh(tireGeo, tireMat)); spin.add(new THREE.Mesh(hubGeo, hubMat));
      wheels.push({ pivot, spin, front: sz > 0 });
    }
    // 駕駛(左座:+x 是左,因為 right=−x)——有臉:眼白+瞳孔+微笑+安全帽
    const driver = new THREE.Group(); driver.position.set(0.4, 0.84, -0.25); tilt.add(driver); hide.push(driver);   // 帽頂 1.32 ≤ 車頂 1.33
    const skin = lambert(0xf1c9a5, { emissive: 0x8a7355, emissiveIntensity: 0.45 });
    add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.26), lambert(0x2b3a6b)), 0, -0.02, 0, driver);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin), 0, 0.25, 0, driver);
    const helmet = add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, 1.75), lambert(0xffffff)), 0, 0.28, -0.01, driver);
    helmet.scale.set(1, 1, 1.05);
    for (const sx of [-1, 1]) {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), lambert(0xffffff)), sx * 0.06, 0.26, 0.15, driver);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), lambert(0x111111)), sx * 0.06, 0.26, 0.182, driver);
    }
    const smile = add(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 10, Math.PI), lambert(0x7a3b2e)), 0, 0.19, 0.165, driver);
    smile.rotation.z = Math.PI;   // 弧開口朝上=微笑
    // 影子(靜態橢圓)
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1.15, 2.3, 1); shadow.position.y = 0.02; group.add(shadow);

    // 車內(只給玩家車):儀表板/方向盤/儀表/A 柱/頂梁/後視鏡/門板/座椅
    let cockpit = null;
    if (interior) {
      cockpit = new THREE.Group(); tilt.add(cockpit);
      const trim = lambert(0x2b2f38), trim2 = lambert(0x1c1f26);
      // 0907 使用者實玩「車子有點太多了,有點擋住視線」⇒ 儀表板整組壓低、方向盤與儀表縮小、頂梁後視鏡上收、A 柱變細
      add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.55), trim), 0, 0.85, 0.72, cockpit);          // 儀表板(0.28→0.22 高、y 0.92→0.85)
      add(new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.05, 0.62), trim2), 0, 0.97, 0.74, cockpit);        // 儀表台頂(1.06→0.97)
      const col = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), trim2), 0.4, 0.98, 0.5, cockpit); col.rotation.x = 1.15;
      // 方向盤 pivot(向駕駛傾斜),wheel 子物件吃 rotation.z = steer(+右=順時鐘,見 _animateCar)
      const wheelPivot = new THREE.Group(); wheelPivot.position.set(0.4, 0.92, 0.36); wheelPivot.rotation.x = -0.38; cockpit.add(wheelPivot);   // y 1.0→0.92
      const wheel = new THREE.Group(); wheelPivot.add(wheel);
      wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 10, 30), lambert(0x111318)));   // 0.19→0.155(小一圈,不再佔畫面下半)
      const spokeMat = lambert(0x4a505c);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.03, 0.03), spokeMat), 0, 0, 0, wheel);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.03), spokeMat), 0, -0.075, 0, wheel);
      const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12), lambert(0xd0d4dc)), 0, 0, 0, wheel); hub.rotation.x = Math.PI / 2;
      // 儀表(不轉 group、材質雙面):+rotation.z 對駕駛是順時鐘,θ=0 指駕駛的左(+x)
      const gauge = new THREE.Group(); gauge.position.set(0.4, 1.02, 0.66); cockpit.add(gauge);   // y 1.13→1.02、半徑 0.115→0.092:不再浮在前方視線上
      gauge.add(new THREE.Mesh(new THREE.CircleGeometry(0.092, 28), new THREE.MeshBasicMaterial({ color: 0x0b0e15, side: THREE.DoubleSide })));
      gauge.add(new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.007, 6, 28), lambert(0xd0d4dc)));
      for (let i = 0; i <= 8; i++) {
        const th = (330 + i * 30) * Math.PI / 180;
        const tick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: i >= 7 ? 0xff5040 : 0xdde3ee, side: THREE.DoubleSide }));
        tick.position.set(Math.cos(th) * 0.076, Math.sin(th) * 0.076, -0.004); tick.rotation.z = th; gauge.add(tick);
      }
      const needlePivot = new THREE.Group(); needlePivot.position.z = -0.006; gauge.add(needlePivot);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.009, 0.004), new THREE.MeshBasicMaterial({ color: 0xff4a3d, side: THREE.DoubleSide }));
      needle.position.x = 0.04; needlePivot.add(needle);
      needlePivot.rotation.z = 330 * Math.PI / 180;
      // A 柱、頂梁、後視鏡、門板、座椅
      for (const sx of [-1, 1]) {
        const pillar = add(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.6, 0.055), trim), sx * 0.76, 1.24, 0.8, cockpit); pillar.rotation.x = -0.32;   // A 柱 0.08→0.055 並外移,少擋兩側
        add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 1.5), trim), sx * 0.76, 0.95, -0.25, cockpit);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), trim2), sx * 0.4, 0.8, -0.35, cockpit);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.12), trim2), sx * 0.4, 1.1, -0.62, cockpit);
      }
      add(new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.055, 0.12), trim), 0, 1.60, 0.86, cockpit);       // 擋風玻璃頂梁(1.48→1.60、變薄:上緣讓出天空)
      add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.035), trim2), 0, 1.545, 0.8, cockpit);     // 後視鏡柱
      add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.03), lambert(0x9fb4d0)), 0, 1.50, 0.8, cockpit); // 後視鏡(0.3→0.22 寬、上移到頂梁下)
      cockpit.userData = { wheel, wheelAxis: "z", wheelGain: 1.7, needlePivot };
    }
    return { group, tilt, wheels, hide, flame, cockpit, tailMat, paint, kind: "car", leanIn: false, anim: null };
  }

  /** v4 載具外型分派:同一個回傳契約(rigs.js)。 */
  _makeRig(vehicle, hex, opts) {
    if (vehicle === "moto") return makeMotoRig(hex, opts, (VEHICLES.moto.over.wheelRadius || 0.34));
    if (vehicle === "horse") return makeHorseRig(hex, opts);
    if (vehicle === "hover") return makeHoverRig(hex, opts);
    return this._makeCarRig(hex, opts);
  }

  /* ───────────────────────── 車隊 ───────────────────────── */

  _clearCars() {
    if (this.scene) for (const rig of this.rigs.values()) this.scene.remove(rig.group);
    this.cars = []; this.rigs.clear(); this.brains.clear(); this.player = null; this.players = [];
  }

  _spawnCar(opts, colorHex, interior) {
    const vehicle = VEHICLES[opts.vehicle] ? opts.vehicle : "car";
    const car = createCar({ ...opts, vehicle, params: vehicleParams(vehicle) });
    const rig = this._makeRig(vehicle, colorHex, { interior });
    this.scene.add(rig.group);
    this.cars.push(car); this.rigs.set(car, rig);
    return car;
  }

  _placeMenuCar() {
    this._clearCars();
    const t = this.track;
    const car = this._spawnCar({ name: "你", isPlayer: true, playerIdx: 0, colorIdx: this.settings.colorIdx, vehicle: this.settings.vehicle }, CAR_COLORS[this.settings.colorIdx].hex, true);
    placeOnTrack(car, t, t.length - 6, -t.halfW * 0.45);
    this.player = car; this.players = [car];
    this._syncRig(car, 0);
  }

  /** v4:換載具(idx 0=P1 / 1=P2);選單期重建展示車。亂值回賽車。 */
  setVehicle(id, idx = 0) {
    id = VEHICLES[id] ? id : "car";
    if (idx === 1) this.settings.vehicle2 = id; else this.settings.vehicle = id;
    if (this.phase === "menu" && idx === 0) { this._placeMenuCar(); this._snapCams(); this.pushHud(); }
    return id;
  }

  setPlayerColor(idx) {
    idx = ((idx % CAR_COLORS.length) + CAR_COLORS.length) % CAR_COLORS.length;
    this.settings.colorIdx = idx;
    const rig = this.player && this.rigs.get(this.player);
    if (rig) rig.paint.color.setHex(CAR_COLORS[idx].hex);
  }

  /** 開賽:合併設定 → 重建車隊 → 起跑格 → 倒數。 */
  startRace(settings = {}) {
    const next = { ...this.settings, ...settings };
    if (!DIFFICULTY[next.difficulty]) next.difficulty = "easy";
    if (!LAP_OPTIONS.includes(Number(next.laps))) next.laps = 3;
    if (!AI_OPTIONS.includes(Number(next.aiCount))) next.aiCount = 3;
    next.laps = Number(next.laps); next.aiCount = Number(next.aiCount);
    next.colorIdx = ((Number(next.colorIdx) || 0) % CAR_COLORS.length + CAR_COLORS.length) % CAR_COLORS.length;
    if (!MODES[next.mode]) next.mode = "solo";
    if (next.assist === "on") next.assist = "light";   // 舊存檔(v2~v6 的三態)平移到新的四檔
    if (!ASSIST_MODES.includes(next.assist)) next.assist = "auto";
    if (!GRID_OPTIONS.includes(next.gridPos)) next.gridPos = "last";
    if (!VEHICLES[next.vehicle]) next.vehicle = "car";
    if (!VEHICLES[next.vehicle2]) next.vehicle2 = "car";
    if (!AI_VEHICLE_MODES.includes(next.aiVehicle)) next.aiVehicle = "mix";
    next.items = next.items !== false;
    const itemsChanged = (next.items !== false) !== (this.settings.items !== false);
    const trackChanged = next.trackId !== this.settings.trackId || !this.scene;
    this.settings = next;
    if (trackChanged || itemsChanged) this.setTrack(next.trackId);   // 道具開關切換=整個場景重建(乾淨無殘留)
    this._clearCars();
    const t = this.track, L = t.length;
    const cfg = DIFFICULTY[next.difficulty];
    const two = next.mode === "duel2p";
    // 人類車手:單人=選的車色;雙人=鐵則色 P1 藍 / P2 紅(車色選單在雙人模式不生效)
    const p1Color = two ? P1_COLOR : next.colorIdx;
    const p1 = this._spawnCar({ name: two ? "P1" : "你", isPlayer: true, playerIdx: 0, colorIdx: p1Color, vehicle: next.vehicle }, CAR_COLORS[p1Color].hex, true);
    this.player = p1; this.players = [p1];
    if (two) this.players.push(this._spawnCar({ name: "P2", isPlayer: true, playerIdx: 1, colorIdx: P2_COLOR, vehicle: next.vehicle2 }, CAR_COLORS[P2_COLOR].hex, true));
    const used = new Set(this.players.map((p) => p.colorIdx));
    const others = CAR_COLORS.map((_, i) => i).filter((i) => !used.has(i));
    // 每場換一組 AI 種子(第 N 場):再來一場時車道偏好/完美起跑不會一模一樣;同一個 RacingGame 的第一場仍固定(測試可重現)
    this.raceNo = (this.raceNo || 0) + 1;
    const ais = [];
    const vOff = Math.floor(mulberry(1000 + this.raceNo * 7919)() * VEHICLE_IDS.length);   // v4 AI 混搭:每場隨機起點輪流拿(使用者拍板 Mario Kart 式)
    for (let i = 0; i < next.aiCount; i++) {
      const ci = others[i % others.length];
      const ai = this._spawnCar({ name: AI_NAMES[i % AI_NAMES.length], colorIdx: ci, vehicle: aiVehicleFor(i, vOff, next.aiVehicle) }, CAR_COLORS[ci].hex, false);
      this.brains.set(ai, makeAiBrain(0.137 + i * 0.311 + ((this.raceNo - 1) % 97) * 0.0071, cfg));
      ais.push(ai);
    }
    // 起跑格:兩列交錯,索引 0 = 最前格。玩家依 gridPos 排最後(預設;後面沒車擋追尾鏡頭、超車才好玩)或最前;
    // 雙人一定同一排(P1 左 P2 右,跟分割畫面左右一致):AI 奇數台時在玩家前插一個空格,獨占一排的車置中。
    const order = next.gridPos === "front" ? [...this.players, ...ais] : [...ais, ...(two && ais.length % 2 === 1 ? [null] : []), ...this.players];
    order.forEach((car, i) => {
      if (!car) return;
      const row = Math.floor(i / 2), col = i % 2;
      const alone = col === 0 && (i + 1 >= order.length || order[i + 1] === null);
      const d = L - 6 - row * 7.5;
      placeOnTrack(car, t, d, alone ? 0 : (col === 0 ? -1 : 1) * t.halfW * 0.45);
      car.progress = -(L - d);
      car.lap = 0; car.lapStartT = 0; car.lapTimes = []; car.bestLap = 0; car.finished = false; car.turbo = 1;
      car.startBoostT = 0; car.holdT = 0; car.startJudged = false;   // 完美起跑狀態
      car.oilT = 0; car.stars = 0; if (car.pickedIds) car.pickedIds.clear();   // v5 道具狀態
      this._syncRig(car, 0);
    });
    this.phase = "countdown";
    this.paused = false;
    this.dailyKey = null;   // 一般開賽=不是每日題(startDaily 會在之後補回)
    this.countdownT = COUNTDOWN_SECONDS; this._cdLast = 99;
    this.raceT = 0; this.finishOrder = []; this.results = null; this._allAiDoneT = 0; this._allAiDoneSaid = false;
    this.input = emptyInput(); this.input2 = emptyInput();
    for (const c of this.cams) c.forceTv = false;
    this.say(two ? "P1 左半邊、P2 右半邊,預備……" : "預備……", 2);
    this._snapCams();
    this._updateAspect();
    this._emit("racestart", { settings: { ...this.settings } });
    this.pushHud();
  }

  /** 今日挑戰(v5):日期種子決定賽道/方向/圈數/難度/對手/道具;回傳那份設定給 UI 顯示。 */
  startDaily(key = dailyKey()) {
    const d = dailyChallenge(key);
    this.startRace({ ...this.settings, ...d, vehicle: this.settings.vehicle });   // 載具沿用玩家自己選的(那是偏好不是題目)
    this.dailyKey = d.key;
    this.pushHud();
    return d;
  }

  backToMenu() {
    this.phase = "menu";
    this.paused = false;
    this.dailyKey = null;   // 回選單也要清今日題標記(0907 真瀏覽器驗收抓到:只在 startRace 清不夠)
    this.results = null;
    this._placeMenuCar();
    this._snapCams();
    this._updateAspect();
    this.pushHud();
  }

  /** 手動放回賽道(idx=0 P1、1 P2)。 */
  requestRescue(idx = 0) {
    const car = this.players[idx];
    if (!car || this.phase !== "racing" || car.finished) return;
    rescue(car, this.track);
    this._syncRig(car, 0);
    this.say(this.is2P() ? `${this._pName(car)} 放回賽道了,加油!` : "放回賽道了,加油!", 2);
    this._emit("rescue", { p: idx });
  }

  /* ───────────────────────── 暫停 / 完美起跑(v3) ───────────────────────── */

  /** 暫停:只在倒數/比賽中(選單與結算不暫停,回傳 false)。整個世界凍住,render 照畫最後一幀。 */
  setPaused(v) {
    v = !!v;
    if (v && !(this.phase === "countdown" || this.phase === "racing")) return false;
    if (v !== this.paused) {
      this.paused = v;
      this._emit(v ? "pause" : "resume", {});
      this.pushHud();
    }
    return this.paused;
  }
  togglePause() { return this.setPaused(!this.paused); }

  /** GO 後前 window 秒:每位人類車手第一次踩油門時判一次(自動駕駛不判)。 */
  _judgeStarts(dt) {
    if (this.autopilot) return;
    for (const p of this.players) {
      if (p.startJudged) continue;
      const inp = p.playerIdx === 1 ? this.input2 : this.input;
      const on = (inp.throttle || 0) > 0;
      const who = this.is2P() ? `${this._pName(p)} ` : "";
      if (on) {
        p.startJudged = true;
        if ((p.holdT || 0) <= PERFECT_START.hold) {
          p.startBoostT = PERFECT_START.boostSeconds;
          this.say(`⚡ ${who}完美起跑!`, 2);
          this._emit("perfectstart", { p: p.playerIdx });
        } else this.say(`${who}起跑太早了,下次在 GO 的時候踩油門有加速!`, 2.5);
      } else if (this.raceT > PERFECT_START.window) p.startJudged = true;
    }
  }

  /* ───────────────────────── 迴圈 ───────────────────────── */

  start() {
    if (this.running || this.headless) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  resize(width, height) {
    this._vw = Math.max(1, width | 0); this._vh = Math.max(1, height | 0);
    if (this.renderer) this.renderer.setSize(this._vw, this._vh, false);
    this._updateAspect();
  }

  /** 兩個鏡頭的長寬比:單人=整個畫面;雙人=各半(左右分割)。 */
  _updateAspect() {
    const w = this.is2P() ? this._vw / 2 : this._vw, h = Math.max(1, this._vh);
    for (const c of this.cams) { c.camera.aspect = w / h; c.camera.updateProjectionMatrix(); }
  }

  /** 雙人=同一個 scene 用 scissor 畫兩次(左 P1、右 P2);每一刀前先決定「誰的車艙要藏」(只藏該視窗車手自己的、且他選駕駛座時)。 */
  render() {
    if (!this.renderer || !this.scene) return;
    const r = this.renderer;
    if (this.is2P()) {
      const hw = Math.floor(this._vw / 2), h = this._vh;
      r.setScissorTest(true);
      for (let i = 0; i < 2; i++) {
        this._applyCockpitHide(i);
        r.setViewport(i * hw, 0, hw, h); r.setScissor(i * hw, 0, hw, h);
        r.render(this.scene, this.cams[i].camera);
      }
      r.setScissorTest(false);
      this._applyCockpitHide(-1);   // 還原成「各自視窗規則」(headless/測試看到的狀態)
    } else {
      r.setViewport(0, 0, this._vw, this._vh);
      r.render(this.scene, this.cams[0].camera);
    }
  }

  /** viewportIdx ≥0:那個視窗的畫面 —— 只有「該視窗車手自己選駕駛座」才藏他的車艙,對手的車艙照常顯示;
      viewportIdx <0:每台人類車依自己視窗的視角決定(單人與 headless 的預設語意)。visible 一律嚴格 boolean。 */
  _applyCockpitHide(viewportIdx) {
    for (const car of this.players) {
      const rig = this.rigs.get(car);
      if (!rig) continue;
      const own = !!this.cams[car.playerIdx] && this.cams[car.playerIdx].view === "cockpit" && this.phase !== "menu";
      const hide = viewportIdx < 0 ? own : (own && viewportIdx === car.playerIdx);
      for (const m of rig.hide) m.visible = !hide;
    }
  }

  update(dt) {
    dt = Math.min(dt, 1 / 20);
    if (this.paused) { this.pushHud(); return; }   // 暫停=整個世界凍住(連鏡頭與訊息計時都不推)
    this.time += dt;
    if (this.messageT > 0) { this.messageT -= dt; if (this.messageT <= 0) this.message = ""; }

    if (this.phase === "countdown") {
      this.countdownT -= dt;
      // 完美起跑判定用:油門連續按住幾秒(倒數期間車不會動,只記時間)
      for (const p of this.players) { const inp = p.playerIdx === 1 ? this.input2 : this.input; p.holdT = (inp.throttle || 0) > 0 ? (p.holdT || 0) + dt : 0; }
      const n = Math.ceil(this.countdownT);
      if (n < this._cdLast && n >= 1 && n <= 3) { this._cdLast = n; this.say(String(n), 1); this._emit("countdown", { n }); }
      if (this.countdownT <= 0) {
        this.phase = "racing"; this.raceT = 0;
        for (const c of this.cars) c.lapStartT = 0;
        const cfgGo = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.easy;
        for (const c of this.cars) { const b = this.brains.get(c); if (!c.isPlayer && b && b.rnd() < cfgGo.aiSkill * PERFECT_START.aiChance) c.startBoostT = PERFECT_START.boostSeconds; }
        this.say("GO!", 1.2); this._emit("go", {});
      }
    } else if (this.phase === "racing" || this.phase === "finished") {
      this.raceT += dt;
      if (this.phase === "racing" && this.raceT <= PERFECT_START.window + dt) this._judgeStarts(dt);
      this._stepRace(dt);
    }

    for (const car of this.cars) this._syncRig(car, dt);
    this._syncItems(dt);
    this._updateCamera(this.cams[0], dt);
    if (this.is2P()) this._updateCamera(this.cams[1], dt);
    this.pushHud();
  }

  _stepRace(dt) {
    const cfg = DIFFICULTY[this.settings.difficulty];
    const t = this.track;
    const assist = this.assistStrength();
    for (const car of this.cars) {
      let input;
      if (car.isPlayer && !car.finished && !this.autopilot) input = car.playerIdx === 1 ? this.input2 : this.input;
      else {
        let brain = this.brains.get(car);
        if (!brain) { brain = makeAiBrain(0.5, cfg); this.brains.set(car, brain); }
        input = aiInput(car, brain, t, cfg, dt, this.cars, this.player, this.items);
        if (car.finished) { input.throttle = Math.min(input.throttle, 0.35); input.boost = false; }   // 完賽=慢慢繞
      }
      // 人類車吃選單的「AI 輕扶回中」開關;AI 車照難度預設(它本來就會自己轉)
      const prevDist = car.trackDist;
      let evs;
      if (car.startBoostT > 0) {
        // 完美起跑:免費渦輪 —— 強制 boost、燃料退回;不碰 stepCar 物理(渦輪音效/火焰照走 boost 事件)
        const turbo0 = car.turbo, tired0 = car.tired;
        evs = stepCar(car, { ...input, boost: true }, dt, cfg, t, { raceT: this.raceT, assist: car.isPlayer ? assist : cfg.assist });
        car.turbo = turbo0; car.tired = tired0;
        car.startBoostT = Math.max(0, car.startBoostT - dt);
      } else evs = stepCar(car, input, dt, cfg, t, { raceT: this.raceT, assist: car.isPlayer ? assist : cfg.assist });
      for (const e of evs) this._onCarEvent(car, e);
      if (this.items.length && this.phase === "racing") {
        for (const hit of stepItems(car, this.items, prevDist, t)) this._onItemHit(car, hit);
      }
      if (!car.finished && car.lap >= this.settings.laps) {
        car.finished = true; car.finishTime = this.raceT;
        this.finishOrder.push(car);
        if (car.isPlayer) {
          if (this.players.every((p) => p.finished)) this._finishRace();
          else {
            const other = this.players.find((p) => p !== car);
            this.say(`${this._pName(car)} 衝線了!${this._pName(other)} 加油,跑完就好!`, 3);
            this._emit("playerfinish", { p: car.playerIdx, rank: this.rankedCars().indexOf(car) + 1 });
          }
        } else if (this.phase === "racing") this.say(`${car.name} 完賽了!`, 2);
      }
    }
    for (const e of resolveCollisions(this.cars)) if (e.car.isPlayer) { const cs = this.cams[e.car.playerIdx]; cs.shake = Math.max(cs.shake, 0.25); this._emit("bump", { speed: e.speed, p: e.car.playerIdx }); }
    if (this.phase === "racing" && this.player && this.settings.aiCount > 0 && this.cars.every((c) => c.isPlayer || c.finished)) {
      this._allAiDoneT += dt;
      if (this._allAiDoneT > 6 && !this._allAiDoneSaid) { this._allAiDoneSaid = true; this.say("對手都到了。慢慢來,衝過終點就好!", 4); this._emit("allaidone", {}); }
    }
  }

  /** 道具命中:玩家出字幕/音效/播報,AI 只吃效果。 */
  _onItemHit(car, hit) {
    const cfg = ITEM_TYPES[hit.type];
    if (!car.isPlayer) return;
    const p = car.playerIdx, who = this.is2P() ? `${this._pName(car)} ` : "";
    if (hit.type === "boost") this.say(`${who}⚡ 加速板!`, 1.2);
    else if (hit.type === "oil") this.say(`${who}🛢️ 踩到油漬,會滑一下!`, 1.8);
    else this.say(`${who}⭐ 星星 ×${car.stars}!渦輪補滿`, 1.5);
    this._emit("item", { type: hit.type, p, stars: car.stars, label: cfg.label });
  }

  _onCarEvent(car, e) {
    const type = typeof e === "string" ? e : e.type;
    if (type === "lap") respawnForCar(car);   // v5:過線 ⇒ 這一圈撿過的道具重生(每台車各自,不互搶)
    if (car.isPlayer) {
      const p = car.playerIdx, who = this.is2P() ? `${this._pName(car)} ` : "";
      const cs = this.cams[p];
      if (type === "bump") { cs.shake = Math.min(1, 0.3 + (e.speed || 0) / 40); this._emit("bump", { speed: e.speed || 0, p }); }
      else if (type === "offtrack") { this.say(`${who}出界了!回到路上`, 1.5); this._emit("offtrack", { p }); }
      else if (type === "ontrack") this._emit("ontrack", { p });
      else if (type === "rescue") { this.say(`${who}卡住了,放回賽道!`, 2); this._emit("rescue", { p }); }
      else if (type === "wrongway") { this.say(`⚠ ${who}方向反了!請掉頭`, 2.5); this._emit("wrongway", { p }); }
      else if (type === "boost") this._emit("boost", { p });
      else if (type === "boostend") this._emit("boostend", { p });
      else if (type === "lap") {
        const remain = this.settings.laps - e.lap;
        if (remain === 1) this.say(`${who}最後一圈!單圈 ${fmtTime(e.time)}`, 2.5);
        else if (remain > 1) this.say(`${who}第 ${e.lap} 圈完成 ${fmtTime(e.time)}`, 2.5);
        this._emit("lap", { lap: e.lap, time: e.time, final: remain === 1, best: car.bestLap === e.time, p });
      }
    }
  }

  _finishRace() {
    this.phase = "finished";
    const ranked = this.rankedCars();
    const rows = ranked.map((c, i) => ({
      rank: i + 1, name: c.name, isPlayer: !!c.isPlayer, playerIdx: c.isPlayer ? c.playerIdx : -1, colorHex: CAR_COLORS[c.colorIdx].hex,
      vehicle: c.vehicle, vehicleEmoji: (VEHICLES[c.vehicle] || VEHICLES.car).emoji, stars: c.stars || 0,
      time: c.finished ? c.finishTime : null, progress: c.progress, bestLap: c.bestLap || null,
    }));
    const medalOf = (rank) => rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🏁";
    const rank = ranked.indexOf(this.player) + 1;
    let medal = medalOf(rank), title, winner = -1, rank2 = 0;
    if (this.is2P()) {
      const p2 = this.players[1];
      rank2 = ranked.indexOf(p2) + 1;
      winner = rank2 < rank ? 1 : 0;                       // 逐幀判定不會同時過線,先過線者名次小
      medal = medalOf(Math.min(rank, rank2));
      title = `${winner === 0 ? "P1" : "P2"} 獲勝!${this.settings.aiCount > 0 ? `(全場第 ${Math.min(rank, rank2)} 名)` : ""}`;
    } else {
      title = rank === 1 ? "冠軍!太厲害了!" : rank === 2 ? "第二名!好快!" : rank === 3 ? "第三名!有獎牌!" : `第 ${rank} 名,完賽了!`;
    }
    this.results = {
      rank, rank2, winner, mode: this.settings.mode, total: this.cars.length, medal, title,
      time: this.player.finishTime, time2: this.is2P() ? this.players[1].finishTime : null,
      bestLap: this.player.bestLap, laps: this.settings.laps, rows, trackLabel: this.track.label, difficulty: DIFFICULTY[this.settings.difficulty].label,
      bestLap2: this.is2P() ? this.players[1].bestLap : null,
      stars: this.player.stars || 0, stars2: this.is2P() ? (this.players[1].stars || 0) : null,
      items: this.settings.items !== false, dailyKey: this.dailyKey,
      trackId: this.settings.trackId, difficultyId: this.settings.difficulty, trackLength: this.track.length,   // 給本機紀錄與排行房折算平均時速
    };
    this.say(`${medal} ${title}`, 5);
    for (const c of this.cams) if (c.view !== "cockpit") c.forceTv = true;    // 結算自動切轉播機位看自己繞場(駕駛座視角的人維持在車裡)
    this._snapCams();
    this._emit("finish", this.results);
  }

  /** 名次:完賽者依完賽時間,未完賽依 progress。 */
  rankedCars() {
    return [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  /* ───────────────────────── 視覺同步 ───────────────────────── */

  _syncRig(car, dt) {
    const rig = this.rigs.get(car);
    if (!rig) return;
    rig.group.position.set(car.x, car.y, car.z);
    rig.group.rotation.y = car.heading;
    // 俯仰/側傾(坡度 + 加減速點頭 + 轉彎外傾),lerp 到目標
    const pitchT = car.slopePitch + clamp(-car.accel * 0.012, -0.07, 0.07);
    // 賽車=外傾(車身側傾);摩托車=內傾(騎士壓車):右轉 yawRate<0 ⇒ rotation.z>0 = 頂往右倒
    const rollT = rig.leanIn ? clamp(-car.yawRate * car.speed * 0.02, -0.45, 0.45) : clamp(car.yawRate * car.speed * 0.006 + car.latAcc * 0.004, -0.14, 0.14);
    const k = dt > 0 ? Math.min(1, dt * 7) : 1;
    rig.tilt.rotation.x += (pitchT - rig.tilt.rotation.x) * k;
    rig.tilt.rotation.z += (rollT - rig.tilt.rotation.z) * k;
    if (car.bumpT > 0) rig.tilt.rotation.z += Math.sin(car.bumpT * 40) * 0.02 * car.bumpT;
    for (const w of rig.wheels) {
      w.spin.rotation.x = car.wheelSpin;
      if (w.front) w.pivot.rotation.y = -car.steer * 0.5;
    }
    if (rig.flame) rig.flame.visible = !!car.boosting;
    const braking = car.isPlayer ? ((car.playerIdx === 1 ? this.input2 : this.input).brake > 0 && this.phase === "racing") : car.accel < -4;
    if (rig.tailMat) rig.tailMat.emissiveIntensity = braking ? 1.0 : 0.35;
    if (rig.anim) rig.anim(car, dt);                                        // v4:馬的奔跑循環
    if (rig.cockpit) {
      const { wheel, wheelAxis = "z", wheelGain = 1.7, needlePivot } = rig.cockpit.userData;
      if (wheel) wheel.rotation[wheelAxis] = car.steer * wheelGain;    // 賽車方向盤 z(+右=順時鐘);馬韁 y;摩托車把手在前叉(wheelGain 0)
      if (needlePivot) {
        const cfg = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.easy;
        const frac = clamp(Math.abs(car.speed) / (cfg.maxSpeed * CAR.boostSpeedMul), 0, 1);
        needlePivot.rotation.z = (330 + frac * 240) * Math.PI / 180;
      }
    }
    // 駕駛座視角:藏車艙/窗/駕駛頭(只對人類車、且他自己的視窗選駕駛座);其他車照常。雙人渲染時 render() 每一刀再覆寫。
    const cockpitNow = car.isPlayer && this.phase !== "menu" && !!this.cams[car.playerIdx] && this.cams[car.playerIdx].view === "cockpit";
    for (const m of rig.hide) m.visible = !cockpitNow;
  }

  /** 道具視覺:玩家(P1)撿走的先藏起來、過線再出現;星星緩轉。visible 一律嚴格 boolean。 */
  _syncItems(dt) {
    if (!this.itemMeshes.size) return;
    const me = this.player;
    const picked = me && me.pickedIds ? me.pickedIds : null;
    for (const [id, g] of this.itemMeshes) {
      g.visible = !(picked && picked.has(id));
      const spin = g.userData && g.userData.spin;
      if (spin && g.visible) { spin.rotation.y += dt * 1.6; spin.position.y = 1.25 + Math.sin(this.time * 2.2) * 0.12; }
    }
  }

  /* ───────────────────────── 鏡頭 ───────────────────────── */

  /** 切視角(idx=0 P1 視窗、1 P2 視窗)。 */
  setCamView(id, idx = 0) {
    if (!CAM_VIEWS.includes(id) || !this.cams[idx]) return;
    const cs = this.cams[idx];
    cs.view = id;
    cs.forceTv = false;
    cs.snap = true;                       // 切視角=硬切(subtitle-camera-kit 式一)
    try { if (typeof localStorage !== "undefined") localStorage.setItem(idx === 0 ? CAM_KEY : CAM_KEY + "-p2", id); } catch { /* ignore */ }
    this._emit("view", { id, label: CAM_LABELS[id], p: idx });
    this.pushHud();
  }

  cycleCamView(idx = 0) {
    const cs = this.cams[idx] || this.cams[0];
    const i = CAM_VIEWS.indexOf(cs.view);
    this.setCamView(CAM_VIEWS[(i + 1) % CAM_VIEWS.length], this.cams[idx] ? idx : 0);
  }

  /** 目前實際用的視角(結算時自動轉播機位);idx=視窗。 */
  activeView(idx = 0) {
    const cs = this.cams[idx] || this.cams[0];
    if (this.phase === "menu") return "menu";
    if (this.phase === "finished" && cs.forceTv) return "tv";
    return cs.view;
  }

  _desiredCamera(cs, dt = 1 / 60) {
    const d = cs.d;
    const idx = this.cams.indexOf(cs);
    const car = this.players[idx] || this.player;
    const view = this.activeView(idx);
    d.hard = false; d.near = 0.3; d.kPos = 1 - Math.exp(-0.016 * 7); d.kLook = 1 - Math.exp(-0.016 * 7); d.kUp = 1 - Math.exp(-0.016 * 3);
    d.up.set(0, 1, 0);
    if (!car || view === "menu") {
      const s = this.startPos || new THREE.Vector3();
      const a = this.time * 0.18;
      d.pos.set(s.x + Math.cos(a) * 20, s.y + 6.5, s.z + Math.sin(a) * 20);
      d.look.set(s.x, s.y + 1.0, s.z);
      d.fov = 50;
      return;
    }
    const rig = this.rigs.get(car);
    const VEH = VEHICLES[car.vehicle] || VEHICLES.car;                      // v4:各載具的車頭/駕駛座眼位
    const f = forwardOf(car.heading);
    const speedFrac = clamp(Math.abs(car.speed) / 44, 0, 1.2);   // 0906 極速提高:基準 34→44(標準檔極速)
    const pump = this.reducedMotion ? 0 : speedFrac;
    const cx = car.x, cy = car.y, cz = car.z;
    if (view === "chase") {
      // 方向平滑、位置剛性:車永遠在畫面同一個位置,轉彎/甩尾時鏡頭慢半拍有速度感
      this._v4.set(f.x, 0, f.z);
      if (cs.snap) cs.chaseDir.copy(this._v4);
      else cs.chaseDir.lerp(this._v4, 1 - Math.exp(-dt * 4)).normalize();
      const dir = cs.chaseDir;
      const back = 7.4 + pump * 1.6;
      d.pos.set(cx - dir.x * back, cy + 2.7 + pump * 0.3, cz - dir.z * back);
      d.look.set(cx + dir.x * 5, cy + 1.05, cz + dir.z * 5);
      d.fov = 62 + pump * 8; d.kPos = 1; d.kLook = 1;
    } else if (view === "hood") {
      rig.tilt.updateWorldMatrix(true, false);
      this._v1.set(VEH.hood.x, VEH.hood.y, VEH.hood.z).applyMatrix4(rig.tilt.matrixWorld);   // 賽車=引擎蓋前緣上方 9cm;摩托車=前叉上;馬=鬐甲前
      this._v2.set(0, 0, 1).transformDirection(rig.tilt.matrixWorld);
      d.pos.copy(this._v1);
      d.look.copy(this._v1).addScaledVector(this._v2, 30); d.look.y -= 0.15;
      d.fov = 66 + pump * 7; d.kPos = 1; d.kLook = 1;
    } else if (view === "cockpit") {
      // 眼睛只吃 70% 俯仰、40% 側傾(車身 tilt 全灌進鏡頭=地平線歪 8°=孩子暈車)。
      // 世界旋轉 = Ry(heading)·Rx(pitch)·Rz(roll) ⇒ Euler order "YXZ"
      this._e.set(rig.tilt.rotation.x * 0.7, car.heading, rig.tilt.rotation.z * 0.4, "YXZ");
      this._q.setFromEuler(this._e);
      this._v1.set(VEH.eye.x, VEH.eye.y, VEH.eye.z).applyQuaternion(this._q).add(rig.group.position);   // 駕駛眼位(賽車左座 / 摩托車騎士 / 馬上騎士)
      this._v2.set(0, 0, 1).applyQuaternion(this._q);
      this._v3.set(0, 1, 0).applyQuaternion(this._q);
      // 轉彎時眼睛稍微往彎內看(右轉=heading 遞減=繞 up 轉 −φ)
      this._v2.applyAxisAngle(this._v3, -car.steer * 0.16);
      d.pos.copy(this._v1);
      d.look.copy(this._v1).addScaledVector(this._v2, 30); d.look.y -= 0.9;
      d.up.copy(this._v3);
      d.fov = 74 + pump * 6; d.near = 0.05; d.kPos = 1; d.kLook = 1; d.kUp = 1;
    } else if (view === "bird") {
      d.pos.set(cx + f.x * 0.01, cy + 44, cz + f.z * 0.01);
      d.look.set(cx + f.x * 6, cy, cz + f.z * 6);
      d.up.set(f.x, 0, f.z);                    // ★ 正上方視角 up 要明確定(0826 撞球雷);畫面上方=車頭方向
      d.fov = 55; d.kPos = 1 - Math.exp(-0.016 * 3.5); d.kLook = d.kPos; d.kUp = 1 - Math.exp(-0.016 * 2.5);
    } else { // tv
      const spots = this.tvSpots;
      let best = cs.tvIdx, bestD = Infinity;
      if (best >= 0) bestD = Math.hypot(spots[best].x - cx, spots[best].z - cz);
      for (let i = 0; i < spots.length; i++) {
        const dd = Math.hypot(spots[i].x - cx, spots[i].z - cz);
        if (dd < bestD * 0.85) { bestD = dd; best = i; }
      }
      if (best !== cs.tvIdx) { cs.tvIdx = best; d.hard = true; }
      const s = spots[best];
      d.pos.set(s.x, s.y, s.z);
      d.look.set(cx, cy + 0.9, cz);
      d.fov = clamp(1500 / Math.max(10, bestD), 16, 56);
      d.kLook = 1 - Math.exp(-0.016 * 9);
    }
  }

  _updateCamera(cs, dt) {
    const d = cs.d, cam = cs.camera;
    this._desiredCamera(cs, dt);
    if (cs.snap || d.hard) {
      cs.pos.copy(d.pos); cs.look.copy(d.look); cs.up.copy(d.up); cs.fov = d.fov;
      cs.snap = false;
    } else {
      // dt 修正的 lerp 係數(d.k* 是以 1/60 為基準)
      const fix = (k) => 1 - Math.pow(1 - k, dt * 60);
      cs.pos.lerp(d.pos, fix(d.kPos));
      cs.look.lerp(d.look, fix(d.kLook));
      cs.up.lerp(d.up, fix(d.kUp)).normalize();
      cs.fov += (d.fov - cs.fov) * fix(0.08);
    }
    cam.position.copy(cs.pos);
    if (cs.shake > 0 && !this.reducedMotion && this.activeView(this.cams.indexOf(cs)) !== "cockpit") {
      cam.position.x += (Math.random() - 0.5) * cs.shake * 0.35;
      cam.position.y += (Math.random() - 0.5) * cs.shake * 0.25;
    }
    cs.shake = Math.max(0, cs.shake - dt * 2.5);
    cam.up.copy(cs.up);
    cam.lookAt(cs.look);
    if (Math.abs(cam.fov - cs.fov) > 0.05 || cam.near !== d.near) {
      cam.fov = cs.fov; cam.near = d.near; cam.updateProjectionMatrix();
    }
  }

  /* ───────────────────────── HUD / 訊息 / 事件 ───────────────────────── */

  say(text, seconds = 2.5) { this.message = text; this.messageT = seconds; }

  _emit(type, data) { if (this.onEvent) this.onEvent(type, data); }

  pushHud() { if (this.onHud) this.onHud(this.hud()); }

  /** 第二車手的 HUD 小包(雙人才有;null=單人)。 */
  _hudP2(ranked) {
    if (!this.is2P()) return null;
    const p = this.players[1], cfg = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.easy;
    return {
      speedKmh: kmh(p.speed), rpm: rpm01(p.speed, cfg.maxSpeed),
      lap: Math.min(this.settings.laps, Math.max(1, p.lap + 1)), rank: ranked.indexOf(p) + 1,
      turbo: p.turbo, tired: !!p.tired, boosting: !!p.boosting, finished: !!p.finished,
      lapT: p.finished ? (p.lapTimes[p.lapTimes.length - 1] || 0) : Math.max(0, this.raceT - p.lapStartT), bestLap: p.bestLap,
      wrongWay: !!p.wrongWay, offTrack: !!p.offTrack, stars: p.stars || 0, oiled: (p.oilT || 0) > 0,
      camView: this.cams[1].view, camLabel: CAM_LABELS[this.cams[1].view], activeView: this.activeView(1),
      vehicle: p.vehicle,
    };
  }

  hud() {
    const p = this.player;
    const cfg = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.easy;
    const ranked = this.phase === "racing" || this.phase === "finished" ? this.rankedCars() : this.cars;
    const rank = p ? ranked.indexOf(p) + 1 : 1;
    return {
      phase: this.phase, mode: this.settings.mode, two: this.is2P(), paused: this.paused,
      vehicle: p ? p.vehicle : this.settings.vehicle,
      assist: this.assistStrength(),
      p2: this._hudP2(ranked),
      countdown: this.phase === "countdown" ? Math.ceil(this.countdownT) : 0,
      speedKmh: p ? kmh(p.speed) : 0,
      rpm: p ? rpm01(p.speed, cfg.maxSpeed) : 0,
      lap: p ? Math.min(this.settings.laps, Math.max(1, p.lap + 1)) : 1,
      laps: this.settings.laps,
      rank, total: this.cars.length,
      turbo: p ? p.turbo : 1, tired: !!(p && p.tired), boosting: !!(p && p.boosting),
      raceT: this.raceT,
      lapT: p ? (p.finished ? (p.lapTimes[p.lapTimes.length - 1] || 0) : Math.max(0, this.raceT - p.lapStartT)) : 0,
      bestLap: p ? p.bestLap : 0,
      wrongWay: !!(p && p.wrongWay), offTrack: !!(p && p.offTrack),
      stars: p ? (p.stars || 0) : 0, oiled: !!(p && (p.oilT || 0) > 0), itemsOn: this.settings.items !== false, dailyKey: this.dailyKey,
      camView: this.cams[0].view, camLabel: CAM_LABELS[this.cams[0].view], activeView: this.activeView(0),
      message: this.message,
      results: this.results,
      trackLabel: this.track ? this.track.label : "",
      cars: this.cars.map((c) => ({ x: c.x, z: c.z, isPlayer: !!c.isPlayer, playerIdx: c.isPlayer ? c.playerIdx : -1, colorHex: CAR_COLORS[c.colorIdx].hex, finished: !!c.finished })),
    };
  }
}

export function fmtTime(s) {
  if (!Number.isFinite(s) || s <= 0) return "--:--.-";
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
