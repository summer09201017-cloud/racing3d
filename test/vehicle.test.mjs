// vehicle.test.mjs —— 街機車體物理(node 直測)
import assert from "node:assert/strict";
import { TRACKS, buildTrack, posAt, nearest, pointAtOffset } from "../src/track.js";
import { CAR, DIFFICULTY, createCar, placeOnTrack, stepCar, emptyInput, rightOf, forwardOf, rescue, rpm01, kmh, resolveCollisions } from "../src/vehicle.js";
import { makeAiBrain, aiInput } from "../src/ai.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const near = (a, b, eps, msg) => { n++; assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`); };
const track = buildTrack(TRACKS.meadow);
// 縱向測試用「近直線」大圓(半徑 500m,曲率 0.002):真賽道 30m 彎會把直走的車送出牆,量不到極速
const straight = buildTrack({ id: "circle", label: "測試大圓", ctrl: Array.from({ length: 16 }, (_, i) => [Math.cos(i / 16 * Math.PI * 2) * 500, Math.sin(i / 16 * Math.PI * 2) * 500]), halfW: 7, shoulder: 5, heightKeys: [[0, 0], [1, 0]] });
const cfg = DIFFICULTY.normal;
const DT = 1 / 60;
const run = (car, inputFn, seconds, opts, trk = track) => {
  const evs = [];
  for (let t = 0; t < seconds; t += DT) evs.push(...stepCar(car, inputFn(t), DT, cfg, trk, opts));
  return evs;
};
// 沿大圓「輕輕跟線」的轉向(只補中線偏差,測縱向用)
const follow = (car) => Math.max(-0.3, Math.min(0.3, -car.lateral * 0.08));   // lateral<0=在左 ⇒ 要右轉(steer>0)

// ① 油門會加速、不超過極速;鬆油會慢慢停;煞車停得快
{
  const car = createCar(); placeOnTrack(car, straight, 100, 0);
  run(car, () => ({ ...emptyInput(), throttle: 1, steer: follow(car) }), 8, {}, straight);
  ok(car.speed > cfg.maxSpeed * 0.9, `8 秒接近極速 ${car.speed.toFixed(1)}`);
  ok(car.speed <= cfg.maxSpeed + 0.01, `不超過極速 ${car.speed.toFixed(2)}`);
  const v0 = car.speed;
  run(car, () => ({ ...emptyInput(), steer: follow(car) }), 2, {}, straight);
  ok(car.speed < v0 && car.speed > 0, "鬆油慢慢掉速");
  let tStop = 0;
  for (let t = 0; t < 5 && car.speed > 0; t += DT) { stepCar(car, { ...emptyInput(), brake: 1, steer: follow(car) }, DT, cfg, straight, {}); tStop = t; }
  ok(tStop < 3, `從極速煞到停 ${tStop.toFixed(2)}s < 3s`);
  run(car, () => ({ ...emptyInput(), brake: 1 }), 2, {}, straight);
  ok(car.speed < 0 && car.speed >= -CAR.reverseMax - 0.01, `停住後繼續按煞車=倒車 ${car.speed.toFixed(1)}`);
}

// ② 轉向符號:按右(steer=+1)⇒ 車往「自己的右手邊」走;heading 遞減
{
  const car = createCar(); placeOnTrack(car, straight, 100, 0);
  run(car, () => ({ ...emptyInput(), throttle: 1 }), 2, {}, straight);
  const h0 = car.heading, x0 = car.x, z0 = car.z;
  const r = rightOf(h0);
  run(car, () => ({ ...emptyInput(), throttle: 0.5, steer: 1 }), 0.6, { noRescue: true }, straight);
  const dx = car.x - x0, dz = car.z - z0;
  ok(dx * r.x + dz * r.z > 0.3, `按右 ⇒ 位移在右手邊 ${(dx * r.x + dz * r.z).toFixed(2)}`);
  ok(Math.sin(h0 - car.heading) > 0, "按右 ⇒ heading 遞減(順時鐘)");
  // 停著不能原地轉
  const parked = createCar(); placeOnTrack(parked, track, 100, 0);
  const hp = parked.heading;
  run(parked, () => ({ ...emptyInput(), steer: 1 }), 1, { noRescue: true });
  near(parked.heading, hp, 1e-9, "停著打方向不會轉");
}

// ③ 出界變慢;撞牆被推回牆內、掉速、有 bump 事件;永遠不會出到牆外
{
  const car = createCar(); placeOnTrack(car, straight, 100, 0);
  run(car, () => ({ ...emptyInput(), throttle: 1, steer: follow(car) }), 5, {}, straight);
  const vOn = car.speed;
  // 硬往右打到出界撞牆
  const evs = run(car, () => ({ ...emptyInput(), throttle: 1, steer: 1 }), 4, { noRescue: true }, straight);
  ok(evs.includes("offtrack"), "有 offtrack 事件");
  ok(evs.some((e) => e && e.type === "bump"), "有 bump 事件");
  ok(Math.abs(car.lateral) <= straight.wallDist + 1e-6, `永遠在牆內 ${car.lateral.toFixed(2)} ≤ ${straight.wallDist}`);
  // 出界後極速應低於路面極速:放到路肩、順著跑
  placeOnTrack(car, straight, 200, straight.halfW + 2);
  run(car, () => ({ ...emptyInput(), throttle: 1, steer: Math.max(-0.3, Math.min(0.3, -(car.lateral - (straight.halfW + 2)) * 0.08)) }), 8, { noRescue: true }, straight);
  ok(car.offTrack, "還在路肩上");
  ok(car.speed < cfg.maxSpeed * CAR.grassSpeedMul + 1, `草地極速受限 ${car.speed.toFixed(1)} < ${(cfg.maxSpeed * CAR.grassSpeedMul + 1).toFixed(1)}`);
  ok(vOn > cfg.maxSpeed * 0.8, "路面上的速度是正常的");
}

// ④ 卡住 2.5 秒自動救援回中線、面向正向;progress 不變
{
  const car = createCar(); placeOnTrack(car, track, 300, 0);
  // 直接放到牆邊出界、不動
  const p = pointAtOffset(track, 300, track.wallDist - 0.2);
  car.x = p.x; car.z = p.z; car.progress = 300;
  const evs = run(car, () => emptyInput(), 3.2);
  ok(evs.includes("rescue"), "有 rescue 事件");
  near(car.lateral, 0, 0.1, "救回中線");
  const tp = posAt(track, car.trackDist);
  near(Math.sin(car.heading - Math.atan2(tp.tx, tp.tz)), 0, 0.02, "面向正向");
  near(car.progress, 300, 1, "progress 沒被改");
  ok(!car.offTrack, "救援後不在出界");
}

// ⑤ 渦輪:計費、見底 tired、回到 0.3 才能再衝;渦輪中極速更高
{
  const car = createCar(); placeOnTrack(car, straight, 100, 0);
  run(car, () => ({ ...emptyInput(), throttle: 1, steer: follow(car) }), 3, {}, straight);
  let vmax = 0; const evs = [];
  for (let t = 0; t < 5; t += DT) { evs.push(...stepCar(car, { ...emptyInput(), throttle: 1, boost: true, steer: follow(car) }, DT, cfg, straight, { noRescue: true })); vmax = Math.max(vmax, car.speed); }
  ok(evs.includes("boost"), "有 boost 事件");
  ok(car.tired && car.turbo < CAR.turboRearm, `5 秒內燒光見底 tired(現在 turbo=${car.turbo.toFixed(2)} 在回充)`);
  ok(vmax > cfg.maxSpeed + 1, `渦輪中速度曾超極速 vmax=${vmax.toFixed(1)} > ${cfg.maxSpeed}`);
  // tired 中按 boost 沒用
  run(car, () => ({ ...emptyInput(), throttle: 1, boost: true, steer: follow(car) }), 1, { noRescue: true }, straight);
  ok(!car.boosting, "tired 中不能衝");
  run(car, () => ({ ...emptyInput(), throttle: 1, steer: follow(car) }), 3, { noRescue: true }, straight);
  ok(!car.tired && car.turbo >= CAR.turboRearm, `回到 ${CAR.turboRearm} 解除 tired turbo=${car.turbo.toFixed(2)}`);
}

// ⑥ 圈數:起跑格在負里程,跨線 progress ≥0 進第 1 圈;沿賽道跑完一整圈 lap=1、有 lap 事件與單圈時間
{
  const car = createCar(); placeOnTrack(car, track, track.length - 10, 0); car.progress = -10;
  ok(car.lap === 0 || Math.floor(car.progress / track.length) === -1, "起跑前 progress 為負");
  const brain = makeAiBrain(0.42, cfg);
  let t = 0; const evs = [];
  for (let i = 0; i < 60 * 120 && car.lap < 1; i++) {
    t += DT;
    evs.push(...stepCar(car, aiInput(car, brain, track, cfg, DT, [car]), DT, cfg, track, { raceT: t }));
  }
  ok(car.lap >= 1, `AI 兩分鐘內跑完一圈(用了 ${t.toFixed(1)}s)`);
  const lapEv = evs.find((e) => e && e.type === "lap");
  ok(lapEv && lapEv.time > 20 && lapEv.time < 120, `lap 事件時間合理 ${lapEv && lapEv.time.toFixed(1)}`);
  ok(car.lapTimes.length === 1, "lapTimes 記一筆");
  ok(!car.wrongWay, "AI 不逆向");
  ok(Math.abs(car.lateral) <= track.halfW + 0.5, `AI 在路上 lateral=${car.lateral.toFixed(1)}`);
}

// ⑦ 逆向偵測:掉頭往回開 2 秒 ⇒ wrongWay
{
  const car = createCar(); placeOnTrack(car, straight, 500, 0);
  car.heading = car.heading + Math.PI; car.progress = 500;
  const evs = run(car, () => ({ ...emptyInput(), throttle: 1 }), 3, { noRescue: true }, straight);
  ok(car.wrongWay && evs.includes("wrongway"), "逆向被偵測");
}

// ⑧ 全部狀態無 NaN(NaN 疫苗):暴力亂按 20 秒
{
  const car = createCar(); placeOnTrack(car, track, 50, 0);
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  run(car, () => ({ throttle: rnd(), brake: rnd() > 0.7 ? rnd() : 0, steer: rnd() * 2 - 1, boost: rnd() > 0.8, handbrake: rnd() > 0.9 }), 20);
  for (const [k, v] of Object.entries(car)) if (typeof v === "number") ok(Number.isFinite(v), `${k} 有限 ${v}`);
}

// ⑨ 輔助函數
ok(kmh(10) === 36, "kmh");
ok(rpm01(0, 30) >= 0.2 && rpm01(30, 30) <= 1, "rpm01 範圍");
const f = forwardOf(0); near(f.x, 0, 1e-9, "forward(0).x"); near(f.z, 1, 1e-9, "forward(0).z");
const rr = rightOf(0); near(rr.x, -1, 1e-9, "right(0).x = −1(與 track.rightOfTangent 同)");

// ⑩ 「AI 輕扶回中」:kids 檔手放開、只給油 20 秒,輔助開(該檔預設 0.85)比關(opts.assist=0)撞牆少;職業檔 on(0.35)也不比 off 多
{
  const bumpsWith = (cfg, assist) => {
    const car = createCar(); placeOnTrack(car, track, 20, 0);
    let bumps = 0;
    for (let t = 0; t < 20; t += DT) {
      const evs = stepCar(car, { ...emptyInput(), throttle: 1 }, DT, cfg, track, assist === undefined ? {} : { assist });
      bumps += evs.filter((e) => e && e.type === "bump").length;
    }
    ok(Number.isFinite(car.x), "跑完有限");
    return bumps;
  };
  const kidsOn = bumpsWith(DIFFICULTY.kids), kidsOff = bumpsWith(DIFFICULTY.kids, 0);
  ok(kidsOn < kidsOff, `kids 輔助開撞牆 ${kidsOn} < 關 ${kidsOff}`);
  const hardOn = bumpsWith(DIFFICULTY.hard, 0.35), hardOff = bumpsWith(DIFFICULTY.hard, 0);
  ok(hardOn <= hardOff, `hard 輔助 on(0.35)撞牆 ${hardOn} ≤ off ${hardOff}`);
  ok(bumpsWith(DIFFICULTY.hard) === hardOff, "hard 未指定 opts.assist = 該檔預設 0 = off");
  console.log(`  (kids 只給油 20 秒:輔助開 ${kidsOn} 次 / 關 ${kidsOff} 次;hard on ${hardOn} / off ${hardOff})`);
}

// ⑪ 車對車碰撞:追撞=推開+後車掉速;側擦=分開;不重疊就沒事
{
  const a = createCar(), b = createCar();
  a.x = 0; a.z = 0; a.heading = 0; a.speed = 20;
  b.x = 0; b.z = 3.0; b.heading = 0; b.speed = 15;          // b 在 a 前方 3m(車長 4.2 ⇒ 重疊 1.3m)
  const evs = resolveCollisions([a, b]);
  ok(evs.length === 2, "兩台各一筆事件");
  ok(b.z - a.z >= CAR.length - 0.01, `追撞後分開 ${(b.z - a.z).toFixed(2)} ≥ 車長`);
  ok(a.speed < 20, "後車掉速");
  const c = createCar(), d = createCar();
  c.x = 0; c.z = 0; c.heading = 0; d.x = -1.5; d.z = 0.5; d.heading = 0;   // d 在 c 右側(right=−x)1.5m ⇒ 側擦
  resolveCollisions([c, d]);
  ok(Math.abs(d.x - c.x) >= CAR.width - 0.01, `側擦後分開 ${Math.abs(d.x - c.x).toFixed(2)} ≥ 車寬`);
  ok(d.lat > 0 && c.lat < 0, "側擦各往外彈(d 往右、c 往左)");
  const e = createCar(), f2 = createCar(); e.x = 0; e.z = 0; f2.x = 0; f2.z = 6;
  ok(resolveCollisions([e, f2]).length === 0 && f2.z === 6, "不重疊不動");
}

console.log(`vehicle.test: ${n} 項通過`);
