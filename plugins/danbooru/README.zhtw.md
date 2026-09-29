# Danbooru 二次元圖庫 - 外掛說明

本外掛用於從 Danbooru（預設全年齡站 `donmai.moe`）爬取二次元作品並加入下載佇列，**並把詳情頁的全量標籤寫進圖片中繼資料**——
標籤會按分類寫入應用的「標籤」分區（`danbooru/<分類>`），可在畫冊頁瀏覽、在搜尋裡按標籤篩選。

## 爬取模式

- **標籤（tags）**：按標籤組合檢索 `/posts?tags=...`，最常用
- **人氣榜（popular）**：日/週/月人氣榜 `/explore/posts/popular`
- **全部（all）**：全站最新作品 `/posts`
- **標籤列表（tag_list）**：先按匹配式瀏覽標籤表 `/tags`，再逐個標籤抓它的作品

## 設定項

- **來源站（source_site）**：`donmai.moe`（預設，僅全年齡內容）或 `danbooru.donmai.us`（全站）
- **標籤組合（mode_tag_value）**：列表輸入，執行時用空格連接；標籤裡的空格自動轉底線 `_`
- **人氣榜週期（popular_scale）**：日榜 / 週榜 / 月榜
- **起始頁面 / 結束頁數（start_page / end_page）**：一次最多 100 頁
- **每頁條數（per_page）**：20 / 50 / 100 / 200，越大越省翻頁
- **標籤匹配式（tag）**：標籤列表模式下的名稱匹配，`*` 是萬用字元，如 `*genshin*`
- **標籤類型（mode_tag_type）**：任意 / 通用 / 作家 / 版權 / 角色 / 元資訊
- **標籤排序（mode_tag_order）**：作品數量 / 名稱 / 日期
- **跳過標籤數量 / 爬取標籤數量 / 每個標籤頁數**：控制標籤列表模式的廣度與深度
- **畫質（quality）**：
  - **高（high）**：原圖直鏈（站點上有數十 MB 的超大圖，注意磁碟與頻寬）
  - **中（medium）**：站點縮放後的 sample；影片貼文沒有 sample，會自動回落到原檔案

## 中繼資料

每張圖都會帶上從詳情頁解析的中繼資料，圖片詳情側欄用 `description.ejs` 渲染：

- `tags_string`：**全量標籤串**，按 作家 → 版權 → 角色 → 通用 → 元資訊 排好序
- `tags`：每個標籤的 `name` / `display` / `type` / `count` / 站內檢索連結 / wiki 連結
- `tags_by_type`：按分類分好組的標籤名陣列
- `post_id`、`rating`、`score`、`fav_count`、`status`
- `file_size`、`file_ext`、`width`、`height`、`original_href`、`sample_href`
- `uploader_name` / `uploader_href`、`posted_date_iso`、`source_href`
- `commentary`：畫師原始評論的標題與正文

同時外掛註冊了 PathQL provider，圖庫裡可以按 **分數（score）/ 收藏數（favorites）** 篩選已下載的圖：列表給出 `5+`、`10+` … `1000+` 等「不低於某值」的檔位；路徑段也接受區間寫法 `100-500`、`100+`、`-50`（兩端都包含）。

## 注意事項

- **站點對未登入 / 普通帳號限制每次檢索最多 2 個標籤**。填第 3 個標籤時外掛會 WARN，站點大概率回傳空結果。
  要多標籤檢索需要在「暢遊」裡登入並升級帳號等級。
- **請文明爬取**：一次最多 100 頁，超過會拒絕執行；結束頁面必須 ≥ 起始頁面。
- 預設來源站 `donmai.moe` 只提供全年齡內容（搜 `rating:e` 也不會回傳結果）；`danbooru.donmai.us` 含成人內容，未登入時按站點預設規則過濾。
- 通常需要可用的代理網路。
- 預設來源站 `donmai.moe` 有 Cloudflare 驗證（全站 `danbooru.donmai.us` 不需要）：首次使用（或驗證過期後）請先在「暢遊」中開啟 `donmai.moe` 並通過驗證，外掛會沿用暢遊的 Cookie 與瀏覽器識別；被攔截時任務會直接報錯提示。
- 站上有 mp4 / webm 影片貼文，外掛會按原檔案直鏈下載。

楽しんで～
