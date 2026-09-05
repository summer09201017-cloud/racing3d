# racing3d — 3D 賽車・五檔視角(含駕駛座第一人稱)

Three.js 街機賽車:自由移動的車體 + 閉環樣條賽道 + 五檔視角(追尾/車頭/駕駛座/高空俯瞰/轉播機位)+ AI 對手 + 溫柔規則。
2026-09-05 開工(規劃見記憶 racing3d-plan)。現況以 `讀我-HANDOFF.txt` ★段為準。

## 指令

- `npm run dev` / `run.bat` — 本機開發(<http://localhost:5173>)
- `npm test` — 純函數三層 node 直測(track / vehicle / race headless 整場),不用瀏覽器
- `npm run build && npm run check:local` — 真瀏覽器驗收(playwright-core+系統 Edge,免下載):起 preview → 開賽真 click → 五檔視角各截一張到 `screenshots/` → 結算卡 → 0 pageerror
- `CHECK_URL="https://..." node scripts/browser-check.mjs` — 直驗線上

## 架構(3d-game-kit 三件套 + 純函數層)

| 檔 | 職責 |
|---|---|
| `src/track.js` | ★地基:閉環 Catmull-Rom 等弧長取樣 2000 點 + 高度剖面(smoothstep 關鍵影格)。`posAt(dist)`、`nearest(x,z,hint)`(里程/帶號橫向/高度)、`pointAtOffset`、`tvCameraSpots`。`TRACKS` 一條賽道一筆資料,加賽道不加程式 |
| `src/vehicle.js` | 街機車體純函數 `stepCar`:油門/煞車/倒車、轉向率隨速度、橫向滑移(甩尾)、渦輪計費(遲滯)、出界變慢、撞牆彈開、逆向偵測、卡住自動救援、圈數(progress 連續累積)。`resolveCollisions` 車對車溫柔推開。`DIFFICULTY` 五檔 |
| `src/ai.js` | 對手腦:追前方車道點 + 彎前煞車 `v=sqrt(latAcc/k)` + 閃避 + 溫柔橡皮筋 + 渦輪(同一套計費) |
| `src/game.js` | THREE 場景(換賽道=換整個 Scene)、車體 rig(外殼+車內組)、五檔視角、狀態機 menu→countdown→racing→finished、名次/結算。不碰 DOM;headless 可在 node 跑整場 |
| `src/main.js` | UI 接線:選單/HUD/小地圖/鍵盤/觸控/手把 → `game.input`、音效、beacons、PWA |
| `src/audio.js` | Web Audio 合成:引擎聲(轉速跟車速)、渦輪、撞牆、輪胎滑、倒數、圈數、完賽(零音檔;人聲尚未烤) |

## 座標與符號鐵則(測試釘死,改動前必讀)

- 車頭 `forward = (sin h, cos h)`、右手 `right = (−cos h, sin h)`;track 的 `rightOfTangent = (−tz, tx)` 同一套。車體 mesh 面向 +z 建構。
- **按右 steer=+1 ⇒ heading 遞減**(從上看順時鐘);前輪 `pivot.rotation.y = −steer·0.5`;方向盤 `wheel.rotation.z = +steer·1.7`(對駕駛=順時鐘);儀表針 `θ = 330° + frac·240°`(θ=0 指駕駛的左,+ 為順時鐘)。
- 曲率 `k > 0 = 右彎`;急彎標誌立在外側 `side = −sign(k)`。
- 起跑格玩家排**最後一格**(後面沒車擋追尾鏡頭、超車才好玩)。progress 起跑為負,跨線後 ≥0;`lap = floor(progress/L)`。

## 本專案地雷(首跑實踩)

1. 橫向滑移那一行**要乘 dt**(漏掉=每幀灌一秒的滑移,車在直線上左右擺到出牆,極速只到 6 m/s)。
2. 路面帶狀網格繞序 `idx.push(a, b, c, b, d, c)`:反了法線朝下=整條路被背面剔除,截圖看到「車在草地上跑」而所有測試全綠(判定層用的是 samples 不是 mesh)。**方向/可見類的錯要靠截圖,不能靠測試。**
3. 追尾鏡頭**位置剛性、只平滑方向**:位置 lerp 在加速時落後 4~7 m,起跑第二排的車剛好卡在鏡頭裡。
4. 駕駛座:後視鏡/頂梁要放在擋風玻璃頂(離眼 ~0.9 m),放 0.3 m 會佈滿三分之一畫面;`near=0.05` 否則方向盤被裁;車艙/窗/駕駛頭用 `rig.hide` 一次藏,`visible` 一律嚴格 boolean。
5. `mesh.visible` 一律 `!!`(0827 全艦隊通則);`this.running` 只給 RAF。
6. 玩法說明(`#helpOverlay`)第一次開賽自動跳一次,browser-check 截圖前要真 click 關掉。
7. main.js 每幀從鍵盤/觸控/手把**覆寫** `game.input` ⇒ 測試想操控玩家要用真鍵盤(`page.keyboard.down`)或 `game.autopilot`。

## 部署

**2026-09-06 上線 Netlify(direct upload,未接 GitHub auto-build)**:https://new-hfpc-racing3d.netlify.app
site id `4d240b0c-e780-4962-bf85-30779e678b64`;源碼 GitHub `summer09201017-cloud/racing3d`(main)。線上 browser-check 34/34。

- **為什麼不是 CF**:Cloudflare 帳號 2026-09-03 起 ToS 審查(CF 原信只禁「加新網域」;「不建新 Pages/Worker」是我們 0903 自訂的預防規則),0904 使用者拍板「凍結期間純靜態新站先上 Netlify、站名加 `new-` 前綴」。審查解除後再搬 CF Pages(`hfpc-racing3d`),一週 3~5 站慢搬;搬時 psPing 的 `?g=racing3d` 鍵不變、統計不歸零,但 origin 會變 ⇒ 已裝 PWA 要重裝。
- **更新流程(★ git push 不會上線,一定要重跑 deploy)**:
  `npm test && npm run build && netlify deploy --prod --dir dist --site 4d240b0c-e780-4962-bf85-30779e678b64 --no-build`
  → `CHECK_URL=https://new-hfpc-racing3d.netlify.app node scripts/browser-check.mjs`。殼層(index.html / sw.js / manifest)有改就 bump sw `CACHE = "racing3d-v1"`。
- psPing id `racing3d`(index.html)、`racing3d-done` / `racing3d-dwell`(main.js)——beacon 只排除 localhost、不認 hostname,Netlify 上照常打;verTag 在 `index.html #verTag`。
- **帳本尚未登記**(四處都要重佈 CF Worker,等使用者拍板):奧運頁卡(Desktop/hfpc-olympics)、作品集 add-work、sites.json、play-stats Worker NAMES。
