// vehicles.js —— 載具資料層(v4,0907 使用者拍板:首批 🏎️ 賽車 / 🏍️ 摩托車 / 🐎 馬,同場混搭)。純資料,零依賴 THREE。
// ★ 鐵則:極速由「難度」管、載具只換手感;每型取捨零和(轉得快就抓地差、越野強就起步慢),不然幼兒選馬對上職業賽車場面不成立。
// 載具 = 參數包(over)+ 3D 外型(rig)+ 音色(sound)+ 駕駛座眼位(eye/hood)。物理仍是同一支 stepCar:car.params = vehicleParams(id)。
import { CAR } from "./vehicle.js";

export const VEHICLES = {
  car: {
    id: "car", label: "賽車", emoji: "🏎️", rig: "car", sound: "engine", boostLabel: "渦輪", leanIn: false,
    blurb: "均衡:什麼都中等,最好上手。",
    over: {},
    eye: { x: 0.4, y: 1.38, z: -0.1 }, hood: { x: 0, y: 0.92, z: 1.6 },   // 0907 使用者實玩「擋住視線」⇒ 眼位 1.27→1.38(往上,不往前;前移會讓後視鏡與頂梁變大,見 CLAUDE.md 地雷 4)
  },
  moto: {
    id: "moto", label: "摩托車", emoji: "🏍️", rig: "moto", sound: "moto", boostLabel: "渦輪", leanIn: true,
    blurb: "轉得快、車身窄好鑽、起步快;但抓地差會滑、開到草地更慢、撞牆掉更多速。",
    // 0907 掃過 8 組:grip 0.9 / accel 1.15 ⇒ 草原自動駕駛 46.1s vs 賽車 45.4s(+1.4%),沙漠 +1.6%、雪山 +2.2%(vehicles.test ③ 守 ≤10%)
    over: { turnRate: CAR.turnRate * 1.25, gripMul: 0.9, accelMul: 1.15, width: 0.9, length: 2.3, grassSpeedMul: 0.5, wallBounce: 0.5, slipGain: CAR.slipGain * 1.1, wheelRadius: 0.34 },
    eye: { x: 0, y: 1.46, z: -0.15 }, hood: { x: 0, y: 0.85, z: 0.95 },
  },
  horse: {
    id: "horse", label: "馬", emoji: "🐎", rig: "horse", sound: "hooves", boostLabel: "衝刺", leanIn: false,
    blurb: "草地不減速(可以切內側)、抓地好不會滑;但起步慢、衝刺體力耗得快。",
    // 0907 掃過 8 組:grip 1.08 / accel 0.88 ⇒ 草原 44.6s vs 賽車 45.4s(−1.8%),沙漠 −0.7%、雪山 −1.7%;grip 1.15 會快到 −4%
    over: { turnRate: CAR.turnRate * 1.1, gripMul: 1.08, accelMul: 0.88, width: 1.2, length: 2.9, grassSpeedMul: 1.0, grassDrag: 0, turboBurn: CAR.turboBurn * 1.35, turboRegen: CAR.turboRegen * 0.85, wallBounce: 0.6, wheelRadius: 1.0 },
    eye: { x: 0, y: 2.98, z: -0.1 }, hood: { x: 0, y: 2.05, z: 1.55 },   // 眼位比騎士頭再高 25cm(0907 截圖:2.74 時馬頭正好擋在畫面中央)
  },
  run: {
    id: "run", label: "跑步", emoji: "🏃", rig: "run", sound: "steps", boostLabel: "衝刺", leanIn: false,
    blurb: "用兩條腿跑:轉彎最靈活、草地完全不減速、身體最窄鑽得過;但起步慢、衝刺很快沒力。",
    // 0907 掃 6 組:grip 1.0 / accel 0.85 ⇒ 草原 45.9s,五型差 3.5%。
    // ★ 原本 grip 1.2 讓它 43.3s 比誰都快 —— 轉最靈活 + 草地不減速 + 最窄三個優點疊起來太強,要用抓地與起步付回去。
    over: { turnRate: CAR.turnRate * 1.32, gripMul: 1.0, accelMul: 0.85, width: 0.7, length: 1.1, grassSpeedMul: 1.0, grassDrag: 0, turboBurn: CAR.turboBurn * 1.5, turboRegen: CAR.turboRegen * 0.8, wallBounce: 0.7, wheelRadius: 0.9 },
    eye: { x: 0, y: 1.62, z: 0.12 }, hood: { x: 0, y: 1.2, z: 0.8 },
  },
  hover: {
    id: "hover", label: "懸浮車", emoji: "🛸", rig: "hover", sound: "hover", boostLabel: "推進器", leanIn: false,
    blurb: "浮在地面上:草地完全不減速(想切哪就切哪)、轉向靈活;但很會漂,要提早修方向。",
    // 0907 掃 9 組:grip 0.92 / accel 1.02 ⇒ 草原 46.2s,四型差 8.7%→**3.5%**。
    // ★ 難控感由 slipGain ×1.45(甩得多)負責,不是靠抓地低——抓地太低只會讓它單純變慢、失去「浮起來滑順」的味道。
    over: { turnRate: CAR.turnRate * 1.18, gripMul: 0.92, accelMul: 1.02, width: 1.8, length: 3.4, grassSpeedMul: 1.0, grassDrag: 0, slipGain: CAR.slipGain * 1.45, wallBounce: 0.66, wheelRadius: 0.001 },
    eye: { x: 0, y: 1.34, z: 0.05 }, hood: { x: 0, y: 1.0, z: 1.5 },
  },
};
export const VEHICLE_IDS = Object.keys(VEHICLES);

/* 對手載具(0907 使用者:「對手要能選擇馬或摩托車或懸浮車」):mix=每場隨機混搭(原行為),其餘=全部同一種。 */
export const AI_VEHICLE_MODES = ["mix", ...VEHICLE_IDS];
export const AI_VEHICLE_LABELS = { mix: "🎲 混搭(每場都不一樣)", ...Object.fromEntries(VEHICLE_IDS.map((id) => [id, `全部 ${VEHICLES[id].emoji} ${VEHICLES[id].label}`])) };

/** 給 stepCar 用的完整參數包:基底 CAR + 該載具覆寫;accelMul/gripMul 乘在難度的 accel/grip 上。沒給/亂值=賽車。 */
export function vehicleParams(id) {
  const v = VEHICLES[id] || VEHICLES.car;
  return { ...CAR, accelMul: 1, gripMul: 1, ...v.over };
}

/** 第 i 台對手開什麼:mode="mix" 用隨機起點輪流拿(≥2 台一定不同種);指定某一型就全部同一型。 */
export function aiVehicleFor(i, offset, mode = "mix") {
  if (VEHICLES[mode]) return mode;
  return VEHICLE_IDS[(i + offset) % VEHICLE_IDS.length];
}
