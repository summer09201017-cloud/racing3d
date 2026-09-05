// track.test.mjs —— 賽道純算術層(node 直測,不用瀏覽器)
import assert from "node:assert/strict";
import { TRACKS, TRACK_IDS, buildTrack, posAt, nearest, pointAtOffset, heightAt, rightOfTangent, headingOfTangent, maxCurvatureAhead, tvCameraSpots, turnSign, wrapDist } from "../src/track.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const near = (a, b, eps, msg) => { n++; assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`); };

for (const id of TRACK_IDS) {
  const t = buildTrack(TRACKS[id]);
  ok(t.length > 800 && t.length < 3000, `${id} 長度合理 ${t.length}`);
  // 閉環:里程 0 與 length 同一點
  const p0 = posAt(t, 0), p1 = posAt(t, t.length);
  near(Math.hypot(p0.x - p1.x, p0.z - p1.z), 0, 1e-6, `${id} 閉環`);
  // 等弧長:相鄰取樣距離一致
  const d01 = Math.hypot(t.samples[1].x - t.samples[0].x, t.samples[1].z - t.samples[0].z);
  const dmid = Math.hypot(t.samples[1001].x - t.samples[1000].x, t.samples[1001].z - t.samples[1000].z);
  near(d01, dmid, d01 * 0.15, `${id} 等弧長`);
  // 切線單位長
  for (let i = 0; i < t.N; i += 97) near(Math.hypot(t.samples[i].tx, t.samples[i].tz), 1, 1e-6, `${id} 切線單位 ${i}`);
  // 高度剖面首尾為 0(起跑線平地)且連續
  near(heightAt(t, 0), 0, 1e-6, `${id} 起點高度 0`);
  let maxJump = 0;
  for (let i = 1; i < t.N; i++) maxJump = Math.max(maxJump, Math.abs(t.samples[i].y - t.samples[i - 1].y));
  ok(maxJump < 0.2, `${id} 高度連續(最大跳 ${maxJump})`);
  // 最小轉彎半徑不能小於路寬(否則內側自己交叉)
  const maxK = Math.max(...t.samples.map((s) => Math.abs(s.k)));
  ok(1 / maxK > t.wallDist, `${id} 最小半徑 ${(1 / maxK).toFixed(1)} > 牆距 ${t.wallDist}`);
  // nearest:中線上任一點 lateral≈0、右偏 3m ⇒ lateral≈+3、左偏 ⇒ −3(符號釘死)
  for (const d of [0, 137, t.length * 0.5, t.length * 0.83]) {
    const c = posAt(t, d);
    const nc = nearest(t, c.x, c.z);
    near(nc.lateral, 0, 0.05, `${id} 中線 lateral 0 @${d}`);
    near(wrapDist(t, nc.dist - d + t.length / 2) - t.length / 2, 0, 0.6, `${id} nearest 里程 @${d}`);
    const pr = pointAtOffset(t, d, 3);
    near(nearest(t, pr.x, pr.z).lateral, 3, 0.08, `${id} 右偏 +3 @${d}`);
    const pl = pointAtOffset(t, d, -3);
    near(nearest(t, pl.x, pl.z).lateral, -3, 0.08, `${id} 左偏 −3 @${d}`);
    // hint 版與全掃版同答案
    const nh = nearest(t, pr.x, pr.z, nc.idx);
    near(nh.lateral, 3, 0.08, `${id} hint 版 lateral @${d}`);
  }
  // hint 給錯很遠 ⇒ 會自己全掃回正解
  const far = posAt(t, t.length * 0.5);
  const nf = nearest(t, far.x, far.z, 0);
  near(nf.lateral, 0, 0.05, `${id} 錯 hint 仍回正解`);
  // 轉播機位都在牆外
  for (const s of tvCameraSpots(t)) {
    const ns = nearest(t, s.x, s.z);
    ok(Math.abs(ns.lateral) > t.wallDist + 5, `${id} 機位在牆外 ${ns.lateral.toFixed(1)}`);
  }
  ok(maxCurvatureAhead(t, 0, 200) > 0, `${id} 前方曲率有值`);
}

// right 向量定義:切線 (0,1)=朝 +z ⇒ right=(−1,0)=−x(三件套「面向 +z 建構」的右手邊)
const r = rightOfTangent(0, 1);
near(r.x, -1, 1e-9, "right.x"); near(r.z, 0, 1e-9, "right.z");
near(headingOfTangent(0, 1), 0, 1e-9, "heading of +z = 0");
near(headingOfTangent(1, 0), Math.PI / 2, 1e-9, "heading of +x = π/2");
// 曲率符號:右彎 k>0(用人造 90° 右彎驗:切線 (0,1)→(−1,0) 是往 right 轉)
const a = { tx: 0, tz: 1 }, b = { tx: -1, tz: 0 };
const cross = a.tx * b.tz - a.tz * b.tx;
ok(turnSign(cross) === 1, "右彎 cross>0 ⇒ turnSign +1");

console.log(`track.test: ${n} 項通過`);
