# 隱碼防偽 · 掃碼驗證示範站

實體防偽標籤掃碼後落地的驗證頁**概念驗證示範站**。標籤外觀是一顆普通 QR，額外的防偽訊號隱藏在碼面內；本頁用手機相機在單次拍攝中完成讀碼、序號簽章檢查與隱碼量測，依結果決定是否顯示產品資料。

👉 **[開啟示範站](https://casperjian.github.io/qr-verify-demo/)**

## 三種畫面

| 網址 | 畫面 |
|---|---|
| [`?demo=pass`](https://casperjian.github.io/qr-verify-demo/?demo=pass) | ✅ 正確解讀隱碼 — 產品資料與權益解鎖 |
| [`?demo=fail`](https://casperjian.github.io/qr-verify-demo/?demo=fail) | ⛔ 未讀到隱碼 — 判定疑似複製品，資料鎖住 |
| [`?demo=sig`](https://casperjian.github.io/qr-verify-demo/?demo=sig) | ⚠ 序號簽章無效 — 直接停止 |

不需實體標籤即可檢視；頁面底部也有按鈕可即時切換。要實際拍攝驗證請按「📷 實際掃描驗證」（需 https 與相機權限）。

## 說明

- 頁面上的品牌與產品資料皆為**示範內容**，非真實紀錄。
- 判定邏輯目前在前端執行，僅供概念驗證；正式版的驗證與資料發放會移至伺服器端。
- 標籤生成端與印刷參數不在本 repo。

## 第三方

[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（MIT）· [jsQR](https://github.com/cozmo/jsQR)（Apache-2.0）
