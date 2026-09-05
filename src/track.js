// track.js —— 賽道純算術層(零依賴,node 可直測)。
// 範式:race-stage-kit ②「里程域 dist 帶高度」+ mount-riding-kit ①「閉環樣條」。
// 本款車子是**自由 2D 移動**,樣條只當「進度/圈數/AI 路徑/重置點/路面高度」的參考:
//   posAt(dist)   → 樣條上該里程的世界點(含 y=heightAt)與切線
//   nearest(x,z)  → 任一世界點投影回樣條:里程 dist、帶號橫向偏移 lateral(+右/-左,對著前進方向)
// ★ 判定=畫面:路面 mesh、車子貼地、小地圖、AI 目標點全用同一組 samples。

/* 賽道資料(加賽道=加一筆,不加程式)。ctrl 是閉環控制點 [x, z];
   AI 與圈數只看里程方向=ctrl 的排列順序=「正向」。
   heightKeys:[u(0..1), 高度 m] 關鍵影格,smoothstep 插值(race-stage-kit 範式)。
   halfW:路面半寬;shoulder:路肩草地寬(出界會變慢但還在跑);牆在 halfW+shoulder。 */
export const TRACKS = {
  meadow: {
    id: "meadow", label: "草原環道", emoji: "🌿",
    ctrl: [
      [0, -150], [120, -170], [230, -110], [260, 10], [200, 110],
      [90, 150], [-40, 120], [-90, 30], [-180, -20], [-230, -120], [-130, -190],
    ],
    halfW: 7, shoulder: 5,
    heightKeys: [[0, 0], [0.18, 6], [0.32, 6], [0.45, 0], [0.62, 3], [0.78, 0], [1, 0]],
    palette: { road: 0x4a4e57, line: 0xf2f2f2, grass: 0x4f9d4a, shoulder: 0x7bb662, sky: 0x8ec9ff, fog: 0xbfe1ff },
    scenery: "trees",
  },
  desert: {
    id: "desert", label: "沙漠長直線", emoji: "🏜️",
    ctrl: [
      [0, -220], [260, -230], [330, -80], [300, 120], [160, 200],
      [-40, 180], [-120, 60], [-260, 40], [-320, -100], [-200, -220],
    ],
    halfW: 8, shoulder: 6,
    heightKeys: [[0, 0], [0.25, 4], [0.4, 9], [0.55, 4], [0.7, 8], [0.85, 2], [1, 0]],
    palette: { road: 0x5a5148, line: 0xffe9a8, grass: 0xd9b56e, shoulder: 0xc9a25a, sky: 0xffd9a0, fog: 0xf5d7a8 },
    scenery: "cactus",
  },
  snow: {
    id: "snow", label: "雪山彎道", emoji: "🏔️",
    ctrl: [
      [0, -120], [90, -160], [150, -80], [110, 0], [170, 80], [100, 150],
      [0, 120], [-60, 170], [-150, 120], [-120, 20], [-170, -60], [-90, -130],
    ],
    halfW: 6.5, shoulder: 4,
    heightKeys: [[0, 0], [0.2, 10], [0.35, 18], [0.5, 12], [0.65, 22], [0.82, 8], [1, 0]],
    palette: { road: 0x3f4753, line: 0xffffff, grass: 0xe9f1f7, shoulder: 0xd6e2ec, sky: 0xb9d4ec, fog: 0xdbe8f2 },
    scenery: "pines",
  },
};
export const TRACK_IDS = Object.keys(TRACKS);

const smoothstep = (t) => t * t * (3 - 2 * t);

/** 均勻 Catmull-Rom 閉環:回傳 u∈[0,1) 對應的點(不含高度)。 */
function catmullClosed(ctrl, u) {
  const n = ctrl.length;
  const f = (((u % 1) + 1) % 1) * n;
  const i1 = Math.floor(f) % n;
  const t = f - Math.floor(f);
  const p0 = ctrl[(i1 - 1 + n) % n], p1 = ctrl[i1], p2 = ctrl[(i1 + 1) % n], p3 = ctrl[(i1 + 2) % n];
  const t2 = t * t, t3 = t2 * t;
  const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * 把一筆 TRACKS 資料展開成可查詢的賽道物件。
 * samples[i] = { x, z, y, tx, tz, dist, k(曲率) } 等弧長取樣(N 點),length=總里程。
 */
export function buildTrack(def, N = 2000) {
  // 先用 4N 個等 u 取樣量弧長,再重取樣成等弧長(AI 與里程域才線性)。
  const M = N * 4;
  const raw = [];
  let acc = 0;
  let prev = catmullClosed(def.ctrl, 0);
  raw.push({ x: prev[0], z: prev[1], d: 0 });
  for (let i = 1; i <= M; i++) {
    const p = catmullClosed(def.ctrl, i / M);
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    raw.push({ x: p[0], z: p[1], d: acc });
    prev = p;
  }
  const length = acc;
  const samples = new Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / N) * length;
    while (j < M - 1 && raw[j + 1].d < target) j++;
    const a = raw[j], b = raw[j + 1];
    const span = Math.max(1e-6, b.d - a.d);
    const t = Math.min(1, Math.max(0, (target - a.d) / span));
    samples[i] = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dist: target, y: 0, tx: 0, tz: 0, k: 0 };
  }
  // 切線(中央差分)、高度、曲率
  for (let i = 0; i < N; i++) {
    const a = samples[(i - 1 + N) % N], b = samples[(i + 1) % N];
    let tx = b.x - a.x, tz = b.z - a.z;
    const L = Math.hypot(tx, tz) || 1;
    tx /= L; tz /= L;
    samples[i].tx = tx; samples[i].tz = tz;
    samples[i].y = heightAtU(def.heightKeys, i / N);
  }
  for (let i = 0; i < N; i++) {
    const a = samples[(i - 2 + N) % N], b = samples[(i + 2) % N];
    const ang = Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz); // 帶號轉角
    const ds = (4 / N) * length;
    samples[i].k = ang / ds; // 曲率 1/m;符號見 turnSign()
  }
  const wallDist = def.halfW + def.shoulder;
  return { ...def, samples, N, length, wallDist };
}

/** 高度剖面:關鍵影格 smoothstep(race-stage-kit ②)。 */
export function heightAtU(keys, u) {
  u = ((u % 1) + 1) % 1;
  for (let i = 0; i < keys.length - 1; i++) {
    const [u0, h0] = keys[i], [u1, h1] = keys[i + 1];
    if (u >= u0 && u <= u1) {
      const t = u1 > u0 ? (u - u0) / (u1 - u0) : 0;
      return h0 + (h1 - h0) * smoothstep(t);
    }
  }
  return keys[keys.length - 1][1];
}

export function wrapDist(track, d) {
  const L = track.length;
  return ((d % L) + L) % L;
}

/** 里程 → 樣條點(含 y 與切線),兩取樣點間線性內插。 */
export function posAt(track, dist) {
  const L = track.length, N = track.N;
  const d = wrapDist(track, dist);
  const f = (d / L) * N;
  const i0 = Math.floor(f) % N, i1 = (i0 + 1) % N;
  const t = f - Math.floor(f);
  const a = track.samples[i0], b = track.samples[i1];
  let tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l; tz /= l;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    tx, tz,
    k: a.k + (b.k - a.k) * t,
    dist: d,
  };
}

export function heightAt(track, dist) {
  return posAt(track, dist).y;
}

/** 前進方向的右手向量(對著切線 t=(tx,tz),上=+y):right = t × up = (-tz, tx)。
    與 vehicle.js 的 rightOf(heading) 同一定義,測試釘死。 */
export function rightOfTangent(tx, tz) {
  return { x: -tz, z: tx };
}

/** 曲率符號 → 這段是右彎(+1)還是左彎(−1)。以 right=(−tz,tx) 定義:
    轉角 ang=atan2(cross, dot),cross = a×b 在 y 軸的分量;右彎時切線往 right 轉。
    右轉:b ≈ a + right*ε = (tx − tz ε, tz + tx ε) ⇒ cross = a.tx*b.tz − a.tz*b.tx = tx²ε + tz²ε = +ε ⇒ k>0 = 右彎。 */
export function turnSign(k) {
  return k > 0 ? 1 : k < 0 ? -1 : 0;
}

/**
 * 世界點 → 最近樣條點。hintIdx 給上一幀的索引就只搜附近(O(1));沒有 hint 或離太遠就全掃。
 * 回傳 { idx, dist, lateral(帶號,+=在前進方向的右側), px, pz, tx, tz, y, k, gap(距中心線幾米) }
 */
export function nearest(track, x, z, hintIdx = -1) {
  const S = track.samples, N = track.N;
  let best = -1, bestD2 = Infinity;
  const scan = (from, to) => {
    for (let i = from; i <= to; i++) {
      const s = S[((i % N) + N) % N];
      const dx = x - s.x, dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = ((i % N) + N) % N; }
    }
  };
  if (hintIdx >= 0) {
    scan(hintIdx - 40, hintIdx + 40);
    // 太遠(> 牆距三倍)就不信 hint,全掃一次
    if (Math.sqrt(bestD2) > (track.wallDist + 10) * 3) { best = -1; bestD2 = Infinity; scan(0, N - 1); }
  } else scan(0, N - 1);
  const s = S[best];
  const r = rightOfTangent(s.tx, s.tz);
  const dx = x - s.x, dz = z - s.z;
  const lateral = dx * r.x + dz * r.z;
  const along = dx * s.tx + dz * s.tz; // 沿切線的微小偏差,修正里程
  return {
    idx: best,
    dist: wrapDist(track, s.dist + along),
    lateral,
    gap: Math.sqrt(bestD2),
    px: s.x, pz: s.z, tx: s.tx, tz: s.tz, y: s.y, k: s.k,
  };
}

/** 給定里程與橫向偏移,算世界點(起跑格、AI 車道目標、重置點都用它)。 */
export function pointAtOffset(track, dist, lateral) {
  const p = posAt(track, dist);
  const r = rightOfTangent(p.tx, p.tz);
  return { x: p.x + r.x * lateral, y: p.y, z: p.z + r.z * lateral, tx: p.tx, tz: p.tz, heading: headingOfTangent(p.tx, p.tz) };
}

/** 切線 → 車頭朝向角(vehicle.js 定義:forward = (sin h, cos h))。 */
export function headingOfTangent(tx, tz) {
  return Math.atan2(tx, tz);
}

/** 前方 lookahead 公尺內最大曲率絕對值(AI 煞車用)。 */
export function maxCurvatureAhead(track, dist, lookahead) {
  const N = track.N, L = track.length;
  const i0 = Math.floor((wrapDist(track, dist) / L) * N);
  const n = Math.max(1, Math.ceil((lookahead / L) * N));
  let m = 0;
  for (let i = 0; i <= n; i++) {
    const k = Math.abs(track.samples[(i0 + i) % N].k);
    if (k > m) m = k;
  }
  return m;
}

/** 轉播機位:沿賽道每 spacing 公尺一台,放在彎道外側高處(看得到車彎進來)。 */
export function tvCameraSpots(track, spacing = 150) {
  const spots = [];
  for (let d = 0; d < track.length - spacing * 0.5; d += spacing) {
    const p = posAt(track, d);
    const r = rightOfTangent(p.tx, p.tz);
    // 右彎(k>0)外側在左(−1);左彎外側在右(+1);直線放右側
    const side = p.k > 0.002 ? -1 : 1;
    const off = track.wallDist + 9;
    spots.push({ x: p.x + r.x * off * side, y: p.y + 7, z: p.z + r.z * off * side, dist: d });
  }
  return spots;
}
