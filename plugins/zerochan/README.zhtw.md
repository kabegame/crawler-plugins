# Zerochan 動漫圖板 - 外掛說明

本外掛用於從 `zerochan.net` 爬取動漫圖片並加入下載佇列。站點是**純伺服器端渲染**的，
列表和詳情全在首屏 HTML 裡，所以外掛走的是輕量的 `fetch` + DOM 解析，不需要開 WebView。

Zerochan 的特點是**人工整理的標籤體系**：每張圖的標籤都分了類（畫師 / 作品 / 角色 / 主題 / 來源），
還標了是誰加的，以及原作發佈在哪（Pixiv、Twitter、DeviantArt……）。這些都會寫進圖片中繼資料，
在圖片詳情側欄按站點原樣的配色還原出來。

## 爬取模式

- **瀏覽全部（all）**：不帶標籤逛全站 `/?s=…&p=N`
- **標籤（tag）**：按單個站內標籤 `/<Tag+Name>?s=…&p=N`
- **搜尋（search）**：任意關鍵詞 `/search?q=…`；站點會跳到最匹配的標籤頁，並用剩餘詞繼續過濾
  （例如 `blue hair smile` 會落到 `Blue Hair` 標籤並疊加其餘條件）

三種模式都可以選**排序**：

- **最新（id）**：按上傳時間倒序
- **人氣（fav）**：按收藏數倒序

## 設定項

- **爬取模式（crawl_mode）**：瀏覽全部 / 標籤 / 搜尋
- **標籤（tag）**：站內標籤的規範名（英文），例如 `Arknights`、`Hatsune Miku`、`Genshin Impact`
- **搜尋詞（search_query）**：任意關鍵詞
- **排序（sort_order）**：最新 / 人氣
- **起始頁面 / 結束頁數（start_page / end_page）**：每頁 48 條，一次最多 100 頁
- **畫質（quality）**：
  - **高（high）**：原圖直鏈（`static.zerochan.net/….full.….jpg`）
  - **中（medium）**：站點 1024px 的 webp 預覽圖

## 中繼資料

每張圖都會帶上從詳情頁解析的中繼資料，圖片詳情側欄用 `description.ejs` 還原站點右側欄：

- `tags`：每個標籤的規範名 `tag`、顯示名 `label`、分類 `type`、sprite 圖示 `icon`、
  站內連結 `url`、新增者 `by`，以及 `fav` / `primary` 標記
- `tags_string`：規範名串，可直接用於二次檢索
- `source`：原作發佈頁 URL 與站點圖示名（pixiv / twitter / deviantart…）
- `share`：站點給的直鏈、BBCode 縮圖、HTML 縮圖三段分享文字
- `stats`：尺寸、百萬像素、收藏數、標籤數
- `post_id`、`title`、`permalink`、`breadcrumbs`、`mangaka`、`uploader`、`uploaded_at`
- `file_size`、`file_ext`、`width`、`height`、`full_url`、`sample_url`

側欄範本的四個區塊（標籤 / 來源 URL / 分享 / 狀態）**標題與文案隨應用語言切換**
（簡中 / 繁中 / 英文 / 日文 / 韓文），標籤配色與圖示直接沿用站點自身的樣式表，淺色深色都跟隨應用主題。
分享區的三段文字都帶一鍵複製。

## 注意事項

- **站點有一道 bot 校驗**：首次請求會回傳 503「Checking browser...」，外掛會自動完成校驗取到
  `xbotcheck` cookie 後重試，正常情況下不需要人工干預。
- **匿名存取看不全**：列表頁尾部會寫 "Some images on this page are for members only"，
  所以每頁實際拿到的條目通常少於 48 條。要看全需要在「暢遊」裡登入站點。
- **標籤名要用站內規範名**：填的是站內標籤而不是自由文字；拿不準就用**搜尋**模式，讓站點自己去匹配。
- **請文明爬取**：一次最多 100 頁，超過會拒絕執行；結束頁面必須 ≥ 起始頁面。每張圖之間有節流。
- 通常需要可用的代理網路。

楽しんで～
