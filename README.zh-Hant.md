<div align="center">

# Mixo Supports

**免費的光固化 3D 列印支撐，直接在瀏覽器裡完成。**
拖進模型，幾秒內就能產生可直接列印的 SLA / MSLA / DLP 支撐，再用手動微調，最後輸出 STL 給你的切片軟體。不用安裝、不用註冊，檔案也不會離開你的電腦。

### [▶ 開啟 Mixo Supports](https://mixocreative.github.io/mixo-supports/)

[English](README.md) · 繁體中文 · [日本語](README.ja.md)

![Mixo Supports：繩結模型加上自動產生的樹脂支撐與底筏](docs/images/editor.png)

</div>

---

## 為什麼選 Mixo Supports

- **到哪都能用。** 在瀏覽器裡執行，Windows、macOS、Linux、ChromeOS、平板和手機都可以。打開連結就能開始。
- **隱私優先。** 模型只在你的裝置上讀取和運算，不會上傳，不用註冊，也沒有追蹤分析。
- **經過驗證的幾何。** 支撐產生器與 Blender 的 SLASG / Resin UV 支撐系統一致，並和真正的 Blender 輸出逐位元比對。
- **大模型也流暢。** 繁重的運算都在背景 worker 執行，編輯器不卡頓，長時間的工作都有進度條。
- **免費。** 沒有浮水印，也沒有付費才能用的功能。

## 功能

### 自動支撐
- 一鍵在 **朝下的面**、**孤島**（會懸在半空中列印的最低點）和 **懸空邊緣** 加上支撐。
- **輕型、中型、重型** 預設組合，或自訂間距、懸空角度（預設 50°）、稜線角度、抬升高度、支撐柱直徑等所有參數。
- **樹狀支撐**：分枝再合併，省樹脂也減少剝離力。
- 沿著模型輪廓的 **底筏**，外擴斜牆並刻上物件字母。也有 **屋頂** 和 **保護籠** 模式。
- 一個平台可以放多個模型。每個模型都是獨立的物件，支撐會跟著模型一起移動、旋轉。

### 好印又好拆的接觸點
- **預設為圓錐尖端**：0.2 mm 的尖端漸寬到支撐柱，留在模型上的痕跡很小。
- 支撐頭截面可選 **圓形**、**方形** 或 **十字**，外形可選 **漸細** 或 **直筒**；接觸形狀可選 **無** 或 **球形**。
- 可調整 **嵌入深度**，讓尖端稍微埋進模型，列印時牢牢黏合，不會脫落。

### 支撐編輯模式
![支撐編輯模式：紅框、按鍵提示與完成按鈕](docs/images/edit-mode.png)

- 進入模式後，**左鍵點擊** 新增支撐，**右鍵點擊** 移除支撐。點擊前會先顯示半透明預覽。
- 紅框和標籤清楚提醒你正在編輯。按 **完成** 或 **Esc** 離開，Tab 鍵可切換模式。
- 完整的 **復原 / 重做**。手動編輯在重新產生後依然保留，**清除手動編輯** 可回到全自動。

### 檢查缺少支撐的地方
掃描模型，列出所有沒有支撐碰到的孤島和懸空區域。**顯示** 會把鏡頭移到該位置，**修正** 會在那裡開啟支撐編輯模式，讓你補上缺少的支撐。

### 匯入與輸出
- 可匯入 **STL**、**GLB** 和 **glTF**。STL 以 Z 軸朝上讀取，和切片軟體一致。
- 輸出 **STL**：目前物件或每個物件、含或不含模型，或整個平台合成一個檔案。
- 輸出的檔案可以直接載入 Chitubox、Lychee、PrusaSlicer、UVtools 等光固化切片軟體。

### 手機、平板與三種語言

| 手機 | 日本語 |
|---|---|
| <img src="docs/images/phone.png" alt="手機上的 Mixo Supports" width="260"> | <img src="docs/images/japanese.png" alt="日文介面的 Mixo Supports" width="520"> |

介面會依照瀏覽器語言自動切換並記住你的選擇，隨時可在 **English**、**繁體中文** 和 **日本語** 之間切換。

## 使用方式

1. 開啟 **[mixocreative.github.io/mixo-supports](https://mixocreative.github.io/mixo-supports/)**。
2. 把 STL、GLB 或 glTF 拖到 **匯入模型**。
3. 移動或旋轉模型到列印方向。
4. 按 **產生支撐**，再選預設組合或調整設定。
5. 可選：執行 **檢查缺少支撐的地方**，或在 **支撐編輯模式** 手動修正。
6. **輸出** STL，照平常方式切片。

## 開發者

React、Three.js（react-three-fiber）、TypeScript、Vite 與 Web Workers，點選使用 three-mesh-bvh。

```bash
npm install
npm run dev      # 本機編輯器：http://localhost:5173/mixo-supports/
npm test         # Vitest 測試，含 Blender 一致性測試
npm run build    # 型別檢查並建置到 dist/
```

每次推送到 `main` 都會自動部署到 GitHub Pages。程式結構請見 [英文版 README](README.md#for-developers)。

## 授權

Copyright © 2026 mixocreative，保留所有權利。程式碼公開供閱讀，但複製、修改、散布、架設或任何商業用途都需要書面授權。你可以自由使用 [線上版](https://mixocreative.github.io/mixo-supports/) 準備自己的列印，輸出的檔案屬於你。詳見 [LICENSE](LICENSE)（以英文版為準）。

## 意見回饋

遇到支撐效果不好的模型，或想要新功能？請 [開一個 issue](https://github.com/mixocreative/mixo-supports/issues)，可以的話附上檔案。給個 ⭐ 能幫助更多光固化玩家找到這個專案。

---

<sub>關鍵字：光固化 3D 列印、樹脂列印、SLA 支撐、MSLA、DLP、LCD 光固化印表機、自動支撐、樹狀支撐、支撐產生器、STL 支撐編輯、免費 Chitubox 與 Lychee 替代方案、瀏覽器 3D 列印前處理、Elegoo、Anycubic、Phrozen、Formlabs、模型公仔、桌遊棋子、珠寶。</sub>
