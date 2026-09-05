// game.js —— 3D 賽車:THREE 場景 + 狀態機(menu→countdown→racing→finished)+ 車體 rig + 五檔視角。
// 不碰 DOM(3d-game-kit 三件套);headless 模式(無 canvas)可在 node 跑整場比賽做測試。
// ★ this.running 只給 RAF(speed-race-kit 鐵則 1);比賽狀態用 this.phase。
// ★ mesh.visible 一律 !!(0827 全艦隊通則)。
// ★ 視角名單一份常數(CAM_VIEWS + CAM_LABELS),localStorage 驗證與 cycleCamView 吃同一份。
import * as THREE from "three";
import { TRACKS, TRACK_IDS, buildTrack, posAt, pointAtOffset, rightOfTangent, tvCameraSpots, nearest } from "./track.js";
import { CAR, DIFFICULTY, createCar, placeOnTrack, stepCar, emptyInput, rescue, forwardOf, rpm01, kmh, clamp, resolveCollisions } from "./vehicle.js";
import { makeAiBrain, aiInput } from "./ai.js";

export { TRACKS, TRACK_IDS, DIFFICULTY };

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
export const DEFAULT_SETTINGS = { trackId: "meadow", laps: 3, aiCount: 3, difficulty: "easy", colorIdx: 0 };
const COUNTDOWN_SECONDS = 3.6;

const V = () => new THREE.Vector3();
const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export class RacingGame {
  constructor({ canvas = null, headless = false } = {}) {
    this.canvas = canvas;
    this.headless = headless || !canvas;
    this.phase = "menu";          // menu | countdown | racing | finished
    this.running = false;         // ★ 只給 RAF
    this.settings = { ...DEFAULT_SETTINGS };
    this.input = emptyInput();
    this.autopilot = false;       // 測試/展示:玩家車交給 AI
    this.cars = []; this.rigs = new Map(); this.brains = new Map();
    this.player = null;
    this.raceT = 0; this.countdownT = 0; this._cdLast = 99;
    this.finishOrder = []; this.results = null; this._allAiDoneT = 0;
    this.message = ""; this.messageT = 0;
    this.onHud = null; this.onEvent = null;
    this.time = 0;
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 鏡頭狀態全部在建構子就有數字(選單期 render 就在跑,NaN 中毒雷)
    this.camView = "chase";
    try {
      const v = typeof localStorage !== "undefined" ? localStorage.getItem(CAM_KEY) : null;
      if (v && CAM_VIEWS.includes(v)) this.camView = v;
    } catch { /* ignore */ }
    this.camPos = new THREE.Vector3(0, 12, -40);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.camFov = 60; this.camNear = 0.3;
    this._camSnap = true; this._tvIdx = -1; this.shake = 0;
    this._d = { pos: V(), look: V(), up: new THREE.Vector3(0, 1, 0), fov: 60, near: 0.3, kPos: 1, kLook: 1, kUp: 1, hard: false };
    this._v1 = V(); this._v2 = V(); this._v3 = V(); this._v4 = V();
    this._chaseDir = new THREE.Vector3(0, 0, 1);   // 追尾鏡頭的平滑方向(位置本身不 lerp)
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler();

    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 4000);
    this.renderer = null;
    if (!this.headless) {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    this.scene = null; this.track = null; this.tvSpots = [];
    this.setTrack(this.settings.trackId);
    this._camSnap = true;
  }

  /* ───────────────────────── 世界 ───────────────────────── */

  /** 換賽段=換整個 Scene(race-stage-kit ①):乾淨無殘留。 */
  setTrack(id) {
    if (!TRACKS[id]) id = "meadow";
    this.settings.trackId = id;
    this.track = buildTrack(TRACKS[id]);
    this.tvSpots = tvCameraSpots(this.track, 150);
    this._tvIdx = -1;
    this._clearCars();
    this._buildWorld();
    if (this.phase === "menu") this._placeMenuCar();
    this._camSnap = true;
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

    this.scene = scene;
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
      add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 0.55), trim), 0, 0.92, 0.72, cockpit);          // 儀表板
      add(new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.05, 0.62), trim2), 0, 1.06, 0.74, cockpit);        // 儀表台頂
      const col = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), trim2), 0.4, 0.98, 0.5, cockpit); col.rotation.x = 1.15;
      // 方向盤 pivot(向駕駛傾斜),wheel 子物件吃 rotation.z = steer(+右=順時鐘,見 _animateCar)
      const wheelPivot = new THREE.Group(); wheelPivot.position.set(0.4, 1.0, 0.36); wheelPivot.rotation.x = -0.38; cockpit.add(wheelPivot);
      const wheel = new THREE.Group(); wheelPivot.add(wheel);
      wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.026, 10, 30), lambert(0x111318)));
      const spokeMat = lambert(0x4a505c);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.03), spokeMat), 0, 0, 0, wheel);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.03), spokeMat), 0, -0.09, 0, wheel);
      const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12), lambert(0xd0d4dc)), 0, 0, 0, wheel); hub.rotation.x = Math.PI / 2;
      // 儀表(不轉 group、材質雙面):+rotation.z 對駕駛是順時鐘,θ=0 指駕駛的左(+x)
      const gauge = new THREE.Group(); gauge.position.set(0.4, 1.13, 0.66); cockpit.add(gauge);
      gauge.add(new THREE.Mesh(new THREE.CircleGeometry(0.115, 28), new THREE.MeshBasicMaterial({ color: 0x0b0e15, side: THREE.DoubleSide })));
      gauge.add(new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.008, 6, 28), lambert(0xd0d4dc)));
      for (let i = 0; i <= 8; i++) {
        const th = (330 + i * 30) * Math.PI / 180;
        const tick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: i >= 7 ? 0xff5040 : 0xdde3ee, side: THREE.DoubleSide }));
        tick.position.set(Math.cos(th) * 0.095, Math.sin(th) * 0.095, -0.004); tick.rotation.z = th; gauge.add(tick);
      }
      const needlePivot = new THREE.Group(); needlePivot.position.z = -0.006; gauge.add(needlePivot);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.004), new THREE.MeshBasicMaterial({ color: 0xff4a3d, side: THREE.DoubleSide }));
      needle.position.x = 0.05; needlePivot.add(needle);
      needlePivot.rotation.z = 330 * Math.PI / 180;
      // A 柱、頂梁、後視鏡、門板、座椅
      for (const sx of [-1, 1]) {
        const pillar = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), trim), sx * 0.74, 1.24, 0.8, cockpit); pillar.rotation.x = -0.32;
        add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 1.5), trim), sx * 0.76, 0.95, -0.25, cockpit);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), trim2), sx * 0.4, 0.8, -0.35, cockpit);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.12), trim2), sx * 0.4, 1.1, -0.62, cockpit);
      }
      add(new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.07, 0.14), trim), 0, 1.48, 0.86, cockpit);        // 擋風玻璃頂梁(離眼 ~0.95m)
      add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.04), trim2), 0, 1.42, 0.8, cockpit);        // 後視鏡柱
      add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.03), lambert(0x9fb4d0)), 0, 1.37, 0.8, cockpit); // 後視鏡
      cockpit.userData = { wheel, needlePivot };
    }
    return { group, tilt, wheels, hide, flame, cockpit, tailMat, paint };
  }

  /* ───────────────────────── 車隊 ───────────────────────── */

  _clearCars() {
    if (this.scene) for (const rig of this.rigs.values()) this.scene.remove(rig.group);
    this.cars = []; this.rigs.clear(); this.brains.clear(); this.player = null;
  }

  _spawnCar(opts, colorHex, interior) {
    const car = createCar(opts);
    const rig = this._makeCarRig(colorHex, { interior });
    this.scene.add(rig.group);
    this.cars.push(car); this.rigs.set(car, rig);
    return car;
  }

  _placeMenuCar() {
    this._clearCars();
    const t = this.track;
    const car = this._spawnCar({ name: "你", isPlayer: true, colorIdx: this.settings.colorIdx }, CAR_COLORS[this.settings.colorIdx].hex, true);
    placeOnTrack(car, t, t.length - 6, -t.halfW * 0.45);
    this.player = car;
    this._syncRig(car, 0);
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
    const trackChanged = next.trackId !== this.settings.trackId || !this.scene;
    this.settings = next;
    if (trackChanged) this.setTrack(next.trackId);
    this._clearCars();
    const t = this.track, L = t.length;
    const cfg = DIFFICULTY[next.difficulty];
    const player = this._spawnCar({ name: "你", isPlayer: true, colorIdx: next.colorIdx }, CAR_COLORS[next.colorIdx].hex, true);
    this.player = player;
    const others = CAR_COLORS.map((_, i) => i).filter((i) => i !== next.colorIdx);
    for (let i = 0; i < next.aiCount; i++) {
      const ci = others[i % others.length];
      const ai = this._spawnCar({ name: AI_NAMES[i % AI_NAMES.length], colorIdx: ci }, CAR_COLORS[ci].hex, false);
      this.brains.set(ai, makeAiBrain(0.137 + i * 0.311, cfg));
    }
    // 起跑格:兩列交錯;★玩家排最後一格(後面沒車擋追尾鏡頭,超車才好玩),獨占一排就置中
    const nCars = this.cars.length;
    this.cars.forEach((car, idx) => {
      const i = car.isPlayer ? nCars - 1 : idx - 1;      // AI 佔 0..n−2,玩家佔 n−1
      const row = Math.floor(i / 2), col = i % 2;
      const alone = i === nCars - 1 && col === 0;
      const d = L - 6 - row * 7.5;
      placeOnTrack(car, t, d, alone ? 0 : (col === 0 ? -1 : 1) * t.halfW * 0.45);
      car.progress = -(L - d);
      car.lap = 0; car.lapStartT = 0; car.lapTimes = []; car.bestLap = 0; car.finished = false; car.turbo = 1;
      this._syncRig(car, 0);
    });
    this.phase = "countdown";
    this.countdownT = COUNTDOWN_SECONDS; this._cdLast = 99;
    this.raceT = 0; this.finishOrder = []; this.results = null; this._allAiDoneT = 0;
    this.input = emptyInput();
    this.say("預備……", 2);
    this._camSnap = true;
    this._emit("racestart", { settings: { ...this.settings } });
    this.pushHud();
  }

  backToMenu() {
    this.phase = "menu";
    this.results = null;
    this._placeMenuCar();
    this._camSnap = true;
    this.pushHud();
  }

  requestRescue() {
    if (!this.player || this.phase !== "racing") return;
    rescue(this.player, this.track);
    this._syncRig(this.player, 0);
    this.say("放回賽道了,加油!", 2);
    this._emit("rescue", {});
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
    if (!this.renderer) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (this.renderer && this.scene) this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    if (this.messageT > 0) { this.messageT -= dt; if (this.messageT <= 0) this.message = ""; }

    if (this.phase === "countdown") {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT);
      if (n < this._cdLast && n >= 1 && n <= 3) { this._cdLast = n; this.say(String(n), 1); this._emit("countdown", { n }); }
      if (this.countdownT <= 0) {
        this.phase = "racing"; this.raceT = 0;
        for (const c of this.cars) c.lapStartT = 0;
        this.say("GO!", 1.2); this._emit("go", {});
      }
    } else if (this.phase === "racing" || this.phase === "finished") {
      this.raceT += dt;
      this._stepRace(dt);
    }

    for (const car of this.cars) this._syncRig(car, dt);
    this._updateCamera(dt);
    this.pushHud();
  }

  _stepRace(dt) {
    const cfg = DIFFICULTY[this.settings.difficulty];
    const t = this.track;
    for (const car of this.cars) {
      let input;
      if (car.isPlayer && !car.finished && !this.autopilot) input = this.input;
      else {
        let brain = this.brains.get(car);
        if (!brain) { brain = makeAiBrain(0.5, cfg); this.brains.set(car, brain); }
        input = aiInput(car, brain, t, cfg, dt, this.cars, this.player);
        if (car.finished) { input.throttle = Math.min(input.throttle, 0.35); input.boost = false; }   // 完賽=慢慢繞
      }
      const evs = stepCar(car, input, dt, cfg, t, { raceT: this.raceT });
      for (const e of evs) this._onCarEvent(car, e);
      if (!car.finished && car.lap >= this.settings.laps) {
        car.finished = true; car.finishTime = this.raceT;
        this.finishOrder.push(car);
        if (car.isPlayer) this._finishRace();
        else if (this.phase === "racing") this.say(`${car.name} 完賽了!`, 2);
      }
    }
    for (const e of resolveCollisions(this.cars)) if (e.car.isPlayer) { this.shake = Math.max(this.shake, 0.25); this._emit("bump", { speed: e.speed }); }
    if (this.phase === "racing" && this.player && this.settings.aiCount > 0 && this.cars.every((c) => c.isPlayer || c.finished)) {
      this._allAiDoneT += dt;
      if (this._allAiDoneT > 6 && !this._allAiDoneSaid) { this._allAiDoneSaid = true; this.say("對手都到了。慢慢來,衝過終點就好!", 4); this._emit("allaidone", {}); }
    }
  }

  _onCarEvent(car, e) {
    const type = typeof e === "string" ? e : e.type;
    if (car.isPlayer) {
      if (type === "bump") { this.shake = Math.min(1, 0.3 + (e.speed || 0) / 40); this._emit("bump", { speed: e.speed || 0 }); }
      else if (type === "offtrack") { this.say("出界了!回到路上", 1.5); this._emit("offtrack", {}); }
      else if (type === "ontrack") this._emit("ontrack", {});
      else if (type === "rescue") { this.say("卡住了,放回賽道!", 2); this._emit("rescue", {}); }
      else if (type === "wrongway") { this.say("⚠ 方向反了!請掉頭", 2.5); this._emit("wrongway", {}); }
      else if (type === "boost") this._emit("boost", {});
      else if (type === "boostend") this._emit("boostend", {});
      else if (type === "lap") {
        const remain = this.settings.laps - e.lap;
        if (remain === 1) this.say(`最後一圈!單圈 ${fmtTime(e.time)}`, 2.5);
        else if (remain > 1) this.say(`第 ${e.lap} 圈完成 ${fmtTime(e.time)}`, 2.5);
        this._emit("lap", { lap: e.lap, time: e.time, final: remain === 1, best: car.bestLap === e.time });
      }
    }
  }

  _finishRace() {
    this.phase = "finished";
    const rows = this.rankedCars().map((c, i) => ({
      rank: i + 1, name: c.name, isPlayer: !!c.isPlayer, colorHex: CAR_COLORS[c.colorIdx].hex,
      time: c.finished ? c.finishTime : null, progress: c.progress, bestLap: c.bestLap || null,
    }));
    const me = rows.find((r) => r.isPlayer);
    const rank = me ? me.rank : 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🏁";
    const title = rank === 1 ? "冠軍!太厲害了!" : rank === 2 ? "第二名!好快!" : rank === 3 ? "第三名!有獎牌!" : `第 ${rank} 名,完賽了!`;
    this.results = { rank, total: this.cars.length, medal, title, time: this.player.finishTime, bestLap: this.player.bestLap, laps: this.settings.laps, rows, trackLabel: this.track.label, difficulty: DIFFICULTY[this.settings.difficulty].label };
    this.say(`${medal} ${title}`, 5);
    if (this.camView !== "cockpit") this._forceTv = true;    // 結算自動切轉播機位看自己繞場(駕駛座視角的人維持在車裡)
    this._camSnap = true;
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
    const rollT = clamp(car.yawRate * car.speed * 0.006 + car.latAcc * 0.004, -0.14, 0.14);
    const k = dt > 0 ? Math.min(1, dt * 7) : 1;
    rig.tilt.rotation.x += (pitchT - rig.tilt.rotation.x) * k;
    rig.tilt.rotation.z += (rollT - rig.tilt.rotation.z) * k;
    if (car.bumpT > 0) rig.tilt.rotation.z += Math.sin(car.bumpT * 40) * 0.02 * car.bumpT;
    for (const w of rig.wheels) {
      w.spin.rotation.x = car.wheelSpin;
      if (w.front) w.pivot.rotation.y = -car.steer * 0.5;
    }
    rig.flame.visible = !!car.boosting;
    const braking = car.isPlayer ? (this.input.brake > 0 && this.phase === "racing") : car.accel < -4;
    rig.tailMat.emissiveIntensity = braking ? 1.0 : 0.35;
    if (rig.cockpit) {
      const { wheel, needlePivot } = rig.cockpit.userData;
      wheel.rotation.z = car.steer * 1.7;    // +右=順時鐘(對駕駛而言);見 _makeCarRig 註解
      const cfg = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.easy;
      const frac = clamp(Math.abs(car.speed) / (cfg.maxSpeed * CAR.boostSpeedMul), 0, 1);
      needlePivot.rotation.z = (330 + frac * 240) * Math.PI / 180;
    }
    // 駕駛座視角:藏車艙/窗/駕駛頭(只對玩家車);其他車照常
    const cockpitNow = this.camView === "cockpit" && car.isPlayer && this.phase !== "menu";
    for (const m of rig.hide) m.visible = !cockpitNow;
  }

  /* ───────────────────────── 鏡頭 ───────────────────────── */

  setCamView(id) {
    if (!CAM_VIEWS.includes(id)) return;
    this.camView = id;
    this._forceTv = false;
    this._camSnap = true;                       // 切視角=硬切(subtitle-camera-kit 式一)
    try { if (typeof localStorage !== "undefined") localStorage.setItem(CAM_KEY, id); } catch { /* ignore */ }
    this._emit("view", { id, label: CAM_LABELS[id] });
    this.pushHud();
  }

  cycleCamView() {
    const i = CAM_VIEWS.indexOf(this.camView);
    this.setCamView(CAM_VIEWS[(i + 1) % CAM_VIEWS.length]);
  }

  /** 目前實際用的視角(結算時自動轉播機位)。 */
  activeView() {
    if (this.phase === "menu") return "menu";
    if (this.phase === "finished" && this._forceTv) return "tv";
    return this.camView;
  }

  _desiredCamera(d, dt = 1 / 60) {
    const car = this.player;
    const view = this.activeView();
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
    const f = forwardOf(car.heading);
    const speedFrac = clamp(Math.abs(car.speed) / 34, 0, 1.2);
    const pump = this.reducedMotion ? 0 : speedFrac;
    const cx = car.x, cy = car.y, cz = car.z;
    if (view === "chase") {
      // 方向平滑、位置剛性:車永遠在畫面同一個位置,轉彎/甩尾時鏡頭慢半拍有速度感
      this._v4.set(f.x, 0, f.z);
      if (this._camSnap) this._chaseDir.copy(this._v4);
      else this._chaseDir.lerp(this._v4, 1 - Math.exp(-dt * 4)).normalize();
      const dir = this._chaseDir;
      const back = 7.4 + pump * 1.6;
      d.pos.set(cx - dir.x * back, cy + 2.7 + pump * 0.3, cz - dir.z * back);
      d.look.set(cx + dir.x * 5, cy + 1.05, cz + dir.z * 5);
      d.fov = 62 + pump * 8; d.kPos = 1; d.kLook = 1;
    } else if (view === "hood") {
      rig.tilt.updateWorldMatrix(true, false);
      this._v1.set(0, 0.92, 1.6).applyMatrix4(rig.tilt.matrixWorld);           // 引擎蓋前緣上方 9cm
      this._v2.set(0, 0, 1).transformDirection(rig.tilt.matrixWorld);
      d.pos.copy(this._v1);
      d.look.copy(this._v1).addScaledVector(this._v2, 30); d.look.y -= 0.15;
      d.fov = 66 + pump * 7; d.kPos = 1; d.kLook = 1;
    } else if (view === "cockpit") {
      // 眼睛只吃 70% 俯仰、40% 側傾(車身 tilt 全灌進鏡頭=地平線歪 8°=孩子暈車)。
      // 世界旋轉 = Ry(heading)·Rx(pitch)·Rz(roll) ⇒ Euler order "YXZ"
      this._e.set(rig.tilt.rotation.x * 0.7, car.heading, rig.tilt.rotation.z * 0.4, "YXZ");
      this._q.setFromEuler(this._e);
      this._v1.set(0.4, 1.27, -0.1).applyQuaternion(this._q).add(rig.group.position);   // 駕駛眼位(左座)
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
      let best = this._tvIdx, bestD = Infinity;
      if (best >= 0) bestD = Math.hypot(spots[best].x - cx, spots[best].z - cz);
      for (let i = 0; i < spots.length; i++) {
        const dd = Math.hypot(spots[i].x - cx, spots[i].z - cz);
        if (dd < bestD * 0.85) { bestD = dd; best = i; }
      }
      if (best !== this._tvIdx) { this._tvIdx = best; d.hard = true; }
      const s = spots[best];
      d.pos.set(s.x, s.y, s.z);
      d.look.set(cx, cy + 0.9, cz);
      d.fov = clamp(1500 / Math.max(10, bestD), 16, 56);
      d.kLook = 1 - Math.exp(-0.016 * 9);
    }
  }

  _updateCamera(dt) {
    const d = this._d;
    this._desiredCamera(d, dt);
    if (this._camSnap || d.hard) {
      this.camPos.copy(d.pos); this.camLook.copy(d.look); this.camUp.copy(d.up); this.camFov = d.fov;
      this._camSnap = false;
    } else {
      // dt 修正的 lerp 係數(d.k* 是以 1/60 為基準)
      const fix = (k) => 1 - Math.pow(1 - k, dt * 60);
      this.camPos.lerp(d.pos, fix(d.kPos));
      this.camLook.lerp(d.look, fix(d.kLook));
      this.camUp.lerp(d.up, fix(d.kUp)).normalize();
      this.camFov += (d.fov - this.camFov) * fix(0.08);
    }
    this.camera.position.copy(this.camPos);
    if (this.shake > 0 && !this.reducedMotion && this.activeView() !== "cockpit") {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.35;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.25;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - this.camFov) > 0.05 || this.camera.near !== d.near) {
      this.camera.fov = this.camFov; this.camera.near = d.near; this.camera.updateProjectionMatrix();
    }
  }

  /* ───────────────────────── HUD / 訊息 / 事件 ───────────────────────── */

  say(text, seconds = 2.5) { this.message = text; this.messageT = seconds; }

  _emit(type, data) { if (this.onEvent) this.onEvent(type, data); }

  pushHud() { if (this.onHud) this.onHud(this.hud()); }

  hud() {
    const p = this.player;
    const cfg = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.easy;
    const ranked = this.phase === "racing" || this.phase === "finished" ? this.rankedCars() : this.cars;
    const rank = p ? ranked.indexOf(p) + 1 : 1;
    return {
      phase: this.phase,
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
      camView: this.camView, camLabel: CAM_LABELS[this.camView], activeView: this.activeView(),
      message: this.message,
      results: this.results,
      trackLabel: this.track ? this.track.label : "",
      cars: this.cars.map((c) => ({ x: c.x, z: c.z, isPlayer: !!c.isPlayer, colorHex: CAR_COLORS[c.colorIdx].hex, finished: !!c.finished })),
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
