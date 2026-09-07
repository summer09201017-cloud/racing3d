// vehicle.js —— 街機車體模型(純函數,零依賴,node 可直測)。
// 不做剛體引擎:狀態只有 位置/朝向/前進速度/橫向滑移/轉向角/渦輪。
//   forward = (sin h, cos h)、right = (−cos h, sin h)   ← 與 track.js rightOfTangent 同一套(測試釘死)
//   ★ 轉向符號:steer=+1(按右)⇒ heading 遞減(從上往下看=順時鐘=往車子的右手邊轉)。
// 溫柔規則:撞牆=彈開+掉速(不翻不爆)、出界=草地變慢、卡住 2.5 秒自動放回賽道。
import { nearest, pointAtOffset, headingOfTangent, wrapDist, heightAt } from "./track.js";
import { oilGripMul } from "./items.js";

export const CAR = {
  length: 4.2, width: 1.9, wheelRadius: 0.36,
  turnRate: 2.3,          // rad/s(滿舵、低速)
  steerFullSpeed: 4,      // 低於此速度轉向率隨速度線性縮(停著不能原地打轉)
  highSpeedFalloff: 30,   // 高速轉向變鈍:mul = 1/(1+(v/falloff)^2*0.7)(0906 極速提高 ⇒ 24→30,50 m/s 時仍有 0.34 轉向)
  drag: 0.0024,           // 二次空阻(m/s² per (m/s)²)(0906:0.0032→0.0024,否則職業檔加速到不了新極速;試算見 CLAUDE.md)
  roll: 0.7,              // 滾動阻力 m/s²
  brake: 17,              // 煞車減速 m/s²(0906 極速提高 ⇒ 15→17,職業檔 180 km/h 仍 <3 秒煞停)
  reverseMax: 7,
  grassSpeedMul: 0.55,    // 出界最高速倍率
  grassDrag: 3.2,         // 出界額外減速 m/s²
  wallBounce: 0.55,       // 撞牆保留速度
  wallSpin: 0.35,         // 撞牆後車頭拉回切線方向的比例
  boostAccel: 6.5, boostSpeedMul: 1.16,
  turboBurn: 0.27, turboRegen: 0.085, turboRearm: 0.3,   // 見底要回到 0.3 才能再衝(遲滯,race-stage-kit ⑥)
  slipGain: 0.9,          // 轉彎把多少前進動量變成橫向滑移(甩尾感):穩態 lat = yaw·v·slipGain/grip
  handbrakeGrip: 1.6,     // 手煞時抓地(越小越滑)
  stuckSeconds: 2.5,      // 卡住多久自動救援
  wrongWaySeconds: 1.5,
};

/* 難度五檔(3d-game-kit「量值可調」):玩家極速/加速、AI 極速與技巧、幼兒輔助、抓地。
   speed 單位 m/s(×3.6 = km/h)。0906 使用者要「極速更高」:kids 24 m/s=86 km/h … hard 50 m/s=180 km/h
   (每檔加速也跟著加,不然到不了極速;drag 同步 0.0032→0.0024,試算見 CLAUDE.md「極速調校」)。
   assist = 該檔預設的「AI 輕扶回中」強度(0906:kids 0.6→0.85 更保母、child 0.4→0.55);玩家可用選單開關覆寫(assistStrength)。 */
export const DIFFICULTY = {
  kids:   { id: "kids",   label: "幼兒", maxSpeed: 24, accel: 10,   grip: 9,   assist: 0.85, aiMax: 22,   aiLatAcc: 6,   aiSkill: 0.45, aiBoost: 0.05 },
  child:  { id: "child",  label: "兒童", maxSpeed: 30, accel: 12,   grip: 8,   assist: 0.55, aiMax: 27,   aiLatAcc: 7.5, aiSkill: 0.6,  aiBoost: 0.15 },
  easy:   { id: "easy",   label: "入門", maxSpeed: 37, accel: 14,   grip: 7,   assist: 0.3,  aiMax: 33,   aiLatAcc: 9,   aiSkill: 0.75, aiBoost: 0.3 },
  normal: { id: "normal", label: "標準", maxSpeed: 44, accel: 16,   grip: 6.5, assist: 0,    aiMax: 40,   aiLatAcc: 11,  aiSkill: 0.88, aiBoost: 0.5 },
  hard:   { id: "hard",   label: "職業", maxSpeed: 50, accel: 18,   grip: 6,   assist: 0,    aiMax: 48,   aiLatAcc: 13,  aiSkill: 0.97, aiBoost: 0.7 },
};

/* 「AI 扶回中」強度(0907 使用者實玩拍板:「希望可以調整是輕輕扶還是重重扶或中等扶」+「所有難度都可以」):
   auto=照難度預設(幼兒/兒童/入門有、標準/職業無);light/medium/strong=不管哪一檔難度都給那個強度;off=完全自己開。
   ★ 強度是乘在 PD 輸出上的係數,不是改 kP/kD —— 手感一致,只是「扶多用力」。 */
/* 輔助的 PD 參數(量值可調):dead=半寬的幾成內完全不介入、kP 拉回力、kD 煞住衝過頭。 */
export const ASSIST = { dead: 0.45, kP: 2.2, kD: 0.9 };
export const ASSIST_MODES = ["auto", "light", "medium", "strong", "off"];
export const ASSIST_LABELS = {
  auto: "自動(照難度:幼兒/兒童/入門才扶)",
  light: "輕輕扶(只在快貼到路邊時碰一下)",
  medium: "中等扶(明顯把車帶回路中間)",
  strong: "重重扶(幾乎自己走中線,新手最安心)",
  off: "關:完全自己開",
};
/* 三檔的強度(量值可調)。任何難度都能選任何一檔——職業檔也能開重重扶,幼兒檔也能關掉。 */
export const ASSIST_LEVELS = { light: 0.35, medium: 0.7, strong: 1.15 };
export const ASSIST_ON_MIN = ASSIST_LEVELS.light;   // 相容舊名
export function assistStrength(cfg, mode = "auto") {
  if (mode === "off") return 0;
  if (ASSIST_LEVELS[mode] != null) return ASSIST_LEVELS[mode];
  if (mode === "on") return Math.max(cfg.assist || 0, ASSIST_LEVELS.light);   // 舊存檔:on ⇒ 至少輕輕扶
  return cfg.assist || 0;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const forwardOf = (h) => ({ x: Math.sin(h), z: Math.cos(h) });
export const rightOf = (h) => ({ x: -Math.cos(h), z: Math.sin(h) });

export function emptyInput() {
  return { throttle: 0, brake: 0, steer: 0, boost: false, handbrake: false };
}

/** 建一台車的狀態(全數字初值=NaN 疫苗)。 */
export function createCar({ x = 0, z = 0, heading = 0, y = 0, name = "車手", isPlayer = false, playerIdx = 0, colorIdx = 0, vehicle = "car", params = null } = {}) {
  return {
    name, isPlayer, playerIdx, colorIdx,
    vehicle, params,   // v4 載具:params = vehicleParams(vehicle)(vehicles.js);null = 基底 CAR
    x, y, z, heading,
    speed: 0,        // 前進速度(可負=倒車)
    lat: 0,          // 橫向滑移速度(+右)
    steer: 0,        // 平滑後的轉向 −1..1
    yawRate: 0,
    accel: 0,        // 這幀的縱向加速度(給視覺俯仰)
    latAcc: 0,       // 這幀的橫向加速度(給視覺側傾)
    turbo: 1, tired: false, boosting: false,
    trackIdx: -1, trackDist: 0, lateral: 0, latRate: 0, progress: 0, lap: 0,
    offTrack: false, wrongWay: false, wrongT: 0, stuckT: 0, bumpT: 0,
    oilT: 0, stars: 0, pickedIds: null,   // v5 道具層:油漬剩餘秒數 / 撿到的星星 / 這一圈撿過的道具 id
    finished: false, finishTime: 0, lapTimes: [], lapStartT: 0, bestLap: 0,
    slopePitch: 0,
    wheelSpin: 0,
  };
}

/** 把車放到賽道上某里程+橫向偏移(起跑格、救援都用它),progress 由呼叫端決定。 */
export function placeOnTrack(car, track, dist, lateral = 0) {
  const p = pointAtOffset(track, dist, lateral);
  car.x = p.x; car.z = p.z; car.y = p.y;
  car.heading = p.heading;
  car.speed = 0; car.lat = 0; car.steer = 0; car.yawRate = 0; car.latRate = 0;
  const n = nearest(track, car.x, car.z, -1);
  car.trackIdx = n.idx; car.trackDist = n.dist; car.lateral = n.lateral;
  car.offTrack = false; car.wrongWay = false; car.wrongT = 0; car.stuckT = 0;
}

/**
 * 推進一幀。回傳事件陣列(bump / offtrack / ontrack / rescue / wrongway / boost / boostend)。
 * cfg = DIFFICULTY[x];track = buildTrack(...);opts.assist 覆寫輔助強度(未給=cfg.assist;玩家開關走這裡)。
 */
export function stepCar(car, input, dt, cfg, track, opts = {}) {
  const events = [];
  if (dt <= 0) return events;
  const L = track.length;
  const P = car.params || CAR;                        // v4 載具參數包(沒給=賽車基底;vehicles.js)
  const accelMul = P.accelMul ?? 1, gripMul = P.gripMul ?? 1;

  // ── 轉向平滑 + AI 輕扶回中(離中線太遠時輕輕拉回;玩家自己在打方向就少介入)
  let steerTarget = clamp(input.steer || 0, -1, 1);
  const assist = opts.assist ?? cfg.assist ?? 0;
  if (assist > 0) {   // ★ 出界時也要作用:最需要被扶回來的就是已經滑到草地上那一刻(只在路上=草地上放生)
    const halfW = Math.max(1, track.halfW);
    const off = clamp(car.lateral / halfW, -2.5, 2.5);                              // 車在半寬的幾成處(+右)
    if (Math.abs(off) > ASSIST.dead) {
      // ★ PD 不是純 P:只有 P(位置誤差)在 0906 極速提高後會左右盪過頭 —— kids 檔實測撞牆 17 → 23 次。
      //   D 項吃 latRate(每秒往外飄幾公尺),把回中線的動作煞住,不會衝到對面牆。
      const err = (Math.abs(off) - ASSIST.dead) * Math.sign(off);
      const rate = clamp((car.latRate || 0) / halfW, -3, 3);
      const pull = clamp(-(err * ASSIST.kP + rate * ASSIST.kD) * assist, -1, 1);
      steerTarget = clamp(steerTarget + pull * (1 - Math.abs(steerTarget) * 0.6), -1, 1);   // 玩家自己在打方向就少介入
    }
  }
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 7);

  // ── 渦輪(統一計費:玩家與 AI 同規則)
  const wantBoost = !!input.boost && car.turbo > 0 && !car.tired && car.speed > 1;
  if (wantBoost !== car.boosting) events.push(wantBoost ? "boost" : "boostend");
  car.boosting = wantBoost;
  if (car.boosting) {
    car.turbo = Math.max(0, car.turbo - P.turboBurn * dt);
    if (car.turbo <= 0) { car.tired = true; car.boosting = false; events.push("boostend"); }
  } else {
    car.turbo = Math.min(1, car.turbo + P.turboRegen * dt);
    if (car.tired && car.turbo >= P.turboRearm) car.tired = false;
  }

  // ── 縱向
  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  let maxSpeed = cfg.maxSpeed * (car.offTrack ? P.grassSpeedMul : 1);
  if (car.boosting) maxSpeed *= P.boostSpeedMul;
  let a = 0;
  const v = car.speed, sv = Math.sign(v);
  if (throttle > 0) {
    // 加速隨接近極速遞減(有檔位感),超過極速就不再推
    const frac = clamp(v / maxSpeed, 0, 1);
    a += cfg.accel * accelMul * throttle * (1 - frac * 0.6) * (v < maxSpeed ? 1 : 0);
    if (car.boosting) a += P.boostAccel * (1 - frac * 0.5);
  }
  if (brake > 0) {
    if (v > 0.4) a -= P.brake * brake;
    else if (v > -P.reverseMax) a -= cfg.accel * accelMul * 0.45 * brake;   // 倒車
  }
  a -= sv * (P.roll + P.drag * v * v);
  if (car.offTrack) a -= sv * P.grassDrag;
  if (v > maxSpeed) a -= (v - maxSpeed) * 1.5;                     // 渦輪結束/出界 ⇒ 順順收速
  if (v <= maxSpeed && a > 0) a = Math.min(a, (maxSpeed - v) / dt);   // 這幀不越過極速(0906 drag 變小後會在極速上下抖 ±0.1,測試「不超過極速」抓到)
  const v2 = v + a * dt;
  car.speed = (Math.abs(v2) < 0.12 && throttle === 0 && brake === 0) ? 0 : v2;
  if (v !== 0 && Math.sign(v2) !== sv && throttle === 0 && brake === 0) car.speed = 0; // 純阻力不會反向
  car.speed = clamp(car.speed, -P.reverseMax, cfg.maxSpeed * P.boostSpeedMul * 1.05);
  car.accel = (car.speed - v) / dt;

  // ── 轉向(轉向率隨速度:低速線性縮、高速變鈍)
  const spd = Math.abs(car.speed);
  const sf = clamp(spd / P.steerFullSpeed, 0, 1) / (1 + (spd / P.highSpeedFalloff) ** 2 * 0.7);
  const yaw = -car.steer * P.turnRate * sf * (car.speed >= 0 ? 1 : -1);
  car.yawRate = yaw;
  car.heading = wrapAngle(car.heading + yaw * dt);

  // ── 橫向滑移:轉彎把一部分前進動量甩到外側,再被抓地吃掉(手煞=抓地變小=甩尾)
  if (car.oilT > 0) car.oilT = Math.max(0, car.oilT - dt);                    // v5 油漬:只讓抓地變差(會滑、要自己修正),不旋轉不失控
  const grip = (input.handbrake ? P.handbrakeGrip : cfg.grip * gripMul * (car.offTrack ? 0.75 : 1)) * oilGripMul(car);
  const latBefore = car.lat;
  car.lat += yaw * car.speed * P.slipGain * dt;    // yaw<0(右轉)⇒ lat<0(往左=外側);★ 要乘 dt(漏掉=每幀灌一秒的滑移,首跑實踩)
  car.lat *= Math.exp(-grip * dt);
  car.latAcc = (car.lat - latBefore) / dt;

  // ── 位移
  const f = forwardOf(car.heading), r = rightOf(car.heading);
  car.x += (f.x * car.speed + r.x * car.lat) * dt;
  car.z += (f.z * car.speed + r.z * car.lat) * dt;

  // ── 投影回賽道:里程/橫向/高度/出界/撞牆
  const n = nearest(track, car.x, car.z, car.trackIdx);
  let delta = n.dist - car.trackDist;
  if (delta > L / 2) delta -= L; else if (delta < -L / 2) delta += L;
  car.latRate = (n.lateral - car.lateral) / dt;                      // 橫向漂移速度(給輔助的 D 項)
  car.trackIdx = n.idx; car.trackDist = n.dist; car.lateral = n.lateral;
  car.progress += delta;
  car.y = n.y;
  // 坡度(沿車頭方向)給視覺俯仰
  const hAhead = heightAt(track, n.dist + 2.5), hBack = heightAt(track, n.dist - 2.5);
  const slope = (hAhead - hBack) / 5;
  const along = f.x * n.tx + f.z * n.tz;
  car.slopePitch = -Math.atan(slope * along);

  const wasOff = car.offTrack;
  car.offTrack = Math.abs(n.lateral) > track.halfW;
  if (car.offTrack && !wasOff) events.push("offtrack");
  if (!car.offTrack && wasOff) events.push("ontrack");

  if (Math.abs(n.lateral) > track.wallDist) {
    // 撞牆:推回牆內、掉速、車頭往切線方向拉回一點、橫向反彈
    const side = Math.sign(n.lateral);
    const rt = { x: -n.tz, z: n.tx };
    const over = Math.abs(n.lateral) - track.wallDist;
    car.x -= rt.x * over * side; car.z -= rt.z * over * side;
    car.lateral = track.wallDist * side;
    const hitSpeed = Math.abs(car.speed);
    car.speed *= P.wallBounce;
    car.lat = -car.lat * 0.4 - side * 1.2;
    const tangentH = headingOfTangent(n.tx, n.tz);
    const dH = wrapAngle(tangentH - car.heading);
    // 倒著撞也一樣拉回「面向牆內」,不強迫正向
    car.heading = wrapAngle(car.heading + dH * P.wallSpin * (Math.abs(dH) < Math.PI / 2 ? 1 : -1));
    car.bumpT = 0.45;
    events.push({ type: "bump", speed: hitSpeed });
  }
  car.bumpT = Math.max(0, car.bumpT - dt);

  // ── 逆向(倒退著跑不算,速度要 >3 且里程在倒退)
  if (delta < 0 && car.speed > 3) car.wrongT += dt; else car.wrongT = Math.max(0, car.wrongT - dt * 2);
  const wasWrong = car.wrongWay;
  car.wrongWay = car.wrongT > P.wrongWaySeconds;
  if (car.wrongWay && !wasWrong) events.push("wrongway");

  // ── 卡住自動救援(出界且幾乎不動,或貼牆磨)
  const stuck = (car.offTrack && spd < 2) || (Math.abs(car.lateral) > track.wallDist - 0.6 && spd < 2.5);
  car.stuckT = stuck ? car.stuckT + dt : 0;
  if (car.stuckT > P.stuckSeconds && !opts.noRescue) {
    rescue(car, track);
    events.push("rescue");
  }

  // ── 圈數(progress 連續累積,起跑格在負里程;跨線=floor 上升)
  const lapNow = Math.floor(car.progress / L);
  if (lapNow > car.lap) {
    const t = opts.raceT ?? 0;
    if (car.lap >= 0 && t > 0) {
      const lapTime = t - car.lapStartT;
      car.lapTimes.push(lapTime);
      if (!car.bestLap || lapTime < car.bestLap) car.bestLap = lapTime;
      events.push({ type: "lap", lap: lapNow, time: lapTime });
    }
    car.lapStartT = t;
  }
  car.lap = Math.max(car.lap, lapNow);

  car.wheelSpin += (car.speed / P.wheelRadius) * dt;
  return events;
}

/** 放回賽道中線、面向正向、速度歸零;progress 不動(公平)。 */
export function rescue(car, track) {
  const d = wrapDist(track, car.trackDist);
  const p = pointAtOffset(track, d, 0);
  car.x = p.x; car.z = p.z; car.y = p.y;
  car.heading = p.heading;
  car.speed = 0; car.lat = 0; car.steer = 0; car.yawRate = 0; car.latRate = 0;
  car.lateral = 0; car.offTrack = false; car.wrongWay = false; car.wrongT = 0; car.stuckT = 0; car.bumpT = 0; car.oilT = 0;   // 救援也把油漬擦掉(不然放回去還在滑)
  const n = nearest(track, car.x, car.z, car.trackIdx);
  car.trackIdx = n.idx; car.trackDist = n.dist;
}

export const kmh = (ms) => Math.round(Math.abs(ms) * 3.6);

/**
 * 車對車碰撞(溫柔版):把對手位置轉到本車座標,重疊就沿「穿入最少」的軸各推一半,
 * 追撞方掉一點速。不翻車、不旋轉、不判罰。回傳 [{car, other, speed}](給音效/鏡頭抖)。
 */
export function resolveCollisions(cars) {
  const events = [];
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const pa = a.params || CAR, pb = b.params || CAR;                       // v4:各自車寬車長(摩托車窄好鑽)
      const HW2 = (pa.width + pb.width) / 2 + 0.1, HL2 = (pa.length + pb.length) / 2 + 0.1;
      const dx = b.x - a.x, dz = b.z - a.z;
      if (dx * dx + dz * dz > (Math.max(pa.length, pb.length) + 1) ** 2) continue;
      const f = forwardOf(a.heading), r = rightOf(a.heading);
      const lx = dx * r.x + dz * r.z;        // b 在 a 的右側幾米
      const lz = dx * f.x + dz * f.z;        // b 在 a 的前方幾米
      const penX = HW2 - Math.abs(lx), penZ = HL2 - Math.abs(lz);
      if (penX <= 0 || penZ <= 0) continue;
      let px = 0, pz = 0;
      if (penX < penZ) { const s = Math.sign(lx || 1) * penX / 2; px = r.x * s; pz = r.z * s; }
      else { const s = Math.sign(lz || 1) * penZ / 2; px = f.x * s; pz = f.z * s; }
      a.x -= px; a.z -= pz; b.x += px; b.z += pz;
      const rel = Math.abs(a.speed - b.speed);
      if (penZ <= penX) {
        // 追撞:後車掉速、前車被推一點
        const rear = lz > 0 ? a : b, front = rear === a ? b : a;
        rear.speed *= 0.9; front.speed = Math.max(front.speed, rear.speed * 0.98);
      } else {
        // 側擦:兩台都掉一點、往兩邊彈開
        a.speed *= 0.985; b.speed *= 0.985;
        a.lat -= Math.sign(lx || 1) * 0.6; b.lat += Math.sign(lx || 1) * 0.6;
      }
      events.push({ car: a, other: b, speed: rel }); events.push({ car: b, other: a, speed: rel });
    }
  }
  return events;
}

/** 引擎轉速 0..1(給音效與轉速表):四速假檔位,每檔內隨速度爬升。 */
export function rpm01(speed, maxSpeed) {
  const frac = clamp(Math.abs(speed) / Math.max(1, maxSpeed), 0, 1.15);
  const gears = 4;
  const g = Math.min(gears - 1, Math.floor(frac * gears));
  const inGear = frac * gears - g;
  return clamp(0.25 + inGear * 0.7 + g * 0.02, 0.2, 1);
}
