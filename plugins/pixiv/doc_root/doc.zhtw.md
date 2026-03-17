# Pixiv 爬蟲 - 外掛說明

本外掛用於從 Pixiv 爬取插畫，支援排行榜、個人收藏、畫師作品、關鍵詞搜尋四種模式。

## HTTP 頭設定（必讀）

Pixiv API 需要認證與 Referer。**Cookie 需在「進階設定 → HTTP 頭」中填寫**，不會作為外掛變數注入。

### 如何取得 Cookie

#### 方法一：透過瀏覽器複製

1. 使用瀏覽器**登入（未登入請先註冊）** [pixiv.net](https://www.pixiv.net)

![home](./images/home.png)

2. 開啟開發者工具（F12），切換到網路標籤（圖中紅框處）

![console](./images/console.png)

3. 依下圖步驟複製你的 cookie

![cookie](./images/cookie.png)

4. 開啟 Kabegame
5. 在需要提供 cookie 的設定下，新增 HTTP 頭

![header](./images/header-config.png)

#### 方法二：透過 Kabegame 暢遊頁面複製（較簡單，但需在電腦上）

1. 開啟 Kabegame，進入暢遊分頁

![kabegame-surf](./images/kabegame-surf.png)

2. 從外掛快速進入 → 選擇 Pixiv → 點擊「開始暢遊」，會彈出 Pixiv 首頁視窗，若提示登入請在此登入

![surf-pixiv](./images/surf-pixiv.png)

3. 登入後點擊「檢視網站 cookie」（勿關閉視窗），會彈出視窗，複製即可

![cookie-dialog](./images/cookie-dialog.png)

4. 愉快使用！

### 如何取得使用者 ID（自己或畫師的）

在 P 站開啟該使用者主頁，網址中間或結尾的數字即為使用者 ID。

![user](./images/user.png)

### 何時需要 Cookie

| 模式 | Cookie |
|------|--------|
| 排行榜（非 R18） | 可選 |
| 排行榜（R18） | 必填 |
| 個人收藏 | 必填 |
| 畫師作品（非 R18） | 可選 |
| 畫師作品（R18） | 必填 |
| 關鍵詞搜尋（非 R18） | 可選 |
| 關鍵詞搜尋（R18） | 必填 |

## 爬取類型

- **排行榜**：依日榜／週榜／月榜下載指定日期的作品
- **個人收藏**：下載你公開收藏的插畫
- **畫師作品**：下載指定畫師的公開作品
- **關鍵詞搜尋**：依關鍵詞搜尋並下載

## 設定項

依選擇模式，表單會顯示不同設定項：

- **排行榜**：排行榜類型、內容類型、起始日期（YYYYMMDD）、日期範圍、最大下載數
- **收藏**：使用者 UID、最大下載數
- **畫師**：使用者 UID、畫師 UID、最大下載數
- **關鍵詞**：搜尋關鍵詞、搜尋模式（安全／R18／全部）、排序方式（按日期／按人氣）、最大下載數。**善用可精準爬取喜歡的內容**

## 注意事項

- 若遇 403，可重新取得 cookie。若僅偶發，可能是被限流，多執行幾次任務，或改在暢遊頁面手動下載。
- Cookie 過期後需重新取得
- 關鍵詞支援進階搜尋語法，如 `(Lucy OR 邊緣行者) AND 5000users`
- **按人氣排序**需 Pixiv Premium 帳戶，非 Premium 請使用「按日期」
- 請合理設定最大下載數，避免對 Pixiv 造成過大負擔
