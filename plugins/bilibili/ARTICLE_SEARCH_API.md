# 哔哩哔哩专栏搜索与文章元数据接口（爬虫用）

本文说明 **专栏 Tab** 下「搜索页 SSR」与 **`/x/article/metas` 批量元数据** 的关系、数据差异与解析要点。样本响应见同插件目录下 `json/`。

## 总览

| 步骤 | 说明 |
|------|------|
| 1 | 浏览器访问专栏搜索页，服务端注入 `window.__pinia`，其中 **`searchTypeResponse.searchTypeResponse`** 含当前关键词、分页信息与 **`result` 列表**（专栏条目摘要）。 |
| 2 | 前端用列表中的 **`id`（专栏 cvid）** 再请求 **`GET https://api.bilibili.com/x/article/metas`**，批量补齐/刷新文章维度信息。 |
| （可选） | 单篇详情 JSON：按 **§4** 会话 + WBI 后请求 **`GET https://api.bilibili.com/x/article/view`**。 |

搜索快照与 `metas` / `view` **不是同一接口**：SSR 是 **HTML 内嵌**；后两者为 **JSON API**，需合法 Cookie（及 `view` 的 WBI）时才能稳定返回业务数据（见各节）。

## 1. 专栏搜索页（SSR）

- **URL 形态**：`https://search.bilibili.com/article?keyword={关键词}&from_source=article`  
  可选查询参数如 `vt` 等由站点生成，一般不影响理解数据流。
- **响应**：`text/html`，关键数据在 **`window.__pinia=(function(...){ return { ... }; })(...)`** 的返回值里。
- **路径**（专栏 Tab）：在返回对象中定位：

  `searchTypeResponse.searchTypeResponse`

  常用字段：

  - `seid`：搜索会话 id（字符串）。
  - `page` / `pagesize` / `numResults` / `numPages`：分页与总条数。
  - `suggest_keyword`：建议词（可能为空字符串）。
  - `result`：**专栏结果数组**，元素结构见 `json/searchTypeResponse-article-item.example.json`。

- **标题中的关键词高亮**：`title` 内嵌 HTML，如 `<em class="keyword">...</em>`，落库或展示前应做 strip 或白名单过滤。
- **封面**：`image_urls[]` 多为 **协议相对路径**（以 `//` 开头），需补全为 `https:` 再下载。

### 解析建议（爬虫）

1. 用正则或 HTML 解析器取出包含 `window.__pinia=` 的 `<script>` 文本。
2. 该段为 **立即执行函数**，不是合法 JSON；可靠做法是 **在 JS 运行时执行**（如 headless 浏览器、或仅提取 `searchTypeResponse` 片段再谨慎解析），或跟随官方/前端打包逻辑。
3. 从 `result[]` 提取 `id` 列表，供步骤 2 批量请求。

### 仓库内样本

- `json/article-search-ssr-keyword-test.html`：无登录 Cookie 下抓取的关键词 `test` 专栏搜索页（含完整 `__pinia` 脚本块，体积约 100KB）。**注意**：与你本机带 Cookie 的响应在 `seid`、条数上可能不同。

## 2. 文章 Metas 接口

- **URL**：`GET https://api.bilibili.com/x/article/metas`
- **查询参数**：
  - `ids`：逗号分隔的专栏 id（与 SSR 中 `result[].id` 一致），单次批量上限以服务端为准（常见二十条左右，与浏览器行为一致即可）。
  - `web_location`：与站点一致即可，例如 `333.337`（与搜索页 `meta name="spm_prefix"` 等区域相关）。
- **最小请求头子集（在需 Cookie 的前提下）**：

  - `User-Agent`：桌面 Chrome 形态。
  - `Referer`：与专栏搜索页一致，例如 `https://search.bilibili.com/article?keyword=...&from_source=article`。
  - `Origin`：`https://search.bilibili.com`
  - `Cookie`：**必填**（经实测无 Cookie 易触发风控，见下）。

### 无 Cookie 时的典型失败

仓库内 `json/x-article-metas-no-cookie.json` 为一次无 Cookie 请求的响应：

```json
{"code":-352,"message":"-352","ttl":1}
```

`-352` 表示接口未按预期返回业务数据；爬虫应携带用户配置的 **B 站 Cookie**（至少包含能标识会话的字段，具体以你环境实测为准），并做好失败重试与日志。

### 成功时的用途（与 SSR 的差异）

- **SSR `result[]`**：面向搜索列表展示，含 **`view` / `like` / `image_urls` / 摘要 `desc`** 等，适合作为「发现与排序」来源。
- **`/x/article/metas`**：返回 **批量文章元数据**（正文统计、状态、标签等以实际 `data` 为准），常用于详情页一致性与字段补全。具体字段请以 **带 Cookie 成功响应** 为准，抓包保存后可放入 `json/` 作 `x-article-metas-success.sample.json` 命名规范样本。

### metas 覆盖的是「整页 SSR」还是「部分」？

结论分两层说：

1. **相对「整个关键词的搜索结果」**  
   `metas` **只处理你传入的 `ids`**，一次请求通常对应 **当前页要在列表里展示的那批专栏**（与前端随后发起的批量请求一致），**不是**把 `numResults` 全站结果一次性拉齐。翻页或「加载更多」会再来一轮 SSR / 请求，再用新的一批 `id` 调 `metas`。

2. **相对「专栏 Tab 当前页 SSR 里的 `result[]`」**  
   对样本页 `keyword=test` 解析：`searchTypeResponse.searchTypeResponse.result` 共 **20** 条专栏；用这 **20** 个 `id` 调用 `metas` 后，`data` 中为 **20** 个以 `id` 为键的对象，**与请求 id 集合一一对应**（在文章未删除、接口正常的前提下）。因此：**不是「只拿到 SSR 列表的子集」**，而是 **「你传多少 id，就按篇返回多少篇元数据」**；与 SSR 是否对齐，取决于前端是否用 **本页全部** `result[].id` 去拼 `ids`（常见实现是整页一批）。

### 字段差异摘要（SSR 列表项 vs `data[cvid]`）

| 维度 | SSR `result[]` | `GET /x/article/metas` 的 `data[id]` |
|------|------------------|--------------------------------------|
| 标题 | 常含 `<em class="keyword">` 高亮 | 纯文本 `title`，无搜索高亮标签 |
| 摘要 | `desc`，偏展示用片段 | `summary`，结构上与搜索摘要接近，往往更「正文向」 |
| 封面 | `image_urls[]` 多为 `//` 相对地址 | `image_urls` / `origin_image_urls` 多为 **https 完整 URL** |
| 互动数据 | `view`、`like` 等，与搜索索引快照接近 | `stats` 对象：`view`、`like`、`favorite`、`reply`、`coin` 等，**数值可能与 SSR 有小幅时差或统计口径差异** |
| 作者 | 多为 `mid` 等简略字段 | `author` 含昵称、头像、大会员信息等完整结构 |
| 分区 | `category_id` / `category_name` | `category` + `categories[]` 层级更完整 |
| 其它 | 搜索排序相关：`rank_index` 等 | `state`、`words`、`ctime`/`mtime`、`reprint` 等编辑与状态字段 |

## 3. 专栏正文页（cv）与正文内 `data-src`

此前仅用 **裸 URL** `GET /read/cv{id}/`、**无 Cookie** 时，响应往往只有空壳 `#article-web-app`，正文由前端脚本再拉取，**看不到** `#article-content` 里的图。

实测与浏览器一致的请求（**带登录 Cookie**，且 URL 上常见 **`from=search`、`spm_id_from=...`、`opus_fallback=1`** 等查询参数）时，服务端可直接返回 **整页 SSR**（约数十 KB）：根节点 `#app` 带 `data-server-rendered="true"`，内含：

- `#article-content` → `#read-article-holder` 下多组 `<figure class="img-box">`，`<img data-src="//i0.hdslb.com/bfs/article/....jpg">` 即正文图；爬虫可对这一段做 HTML 解析或正则提取 `data-src`，再补全为 `https:` 下载。
- 页面底部 **`window.__INITIAL_STATE__`** 中 `readInfo.content` 为与 DOM 同源的 **正文 HTML 字符串**（同样含 `data-src`），也可在无需解析 DOM 时直接取字符串解析。
- 部分稿件在 `readInfo` 中还有 **Opus 结构化正文**（如 `opus.content.paragraphs` 等），图片 URL 可能为完整 `https`。

因此：**「最简单」= 同一套 Cookie + 与入口一致的 query**，用 `curl`/HTTP 客户端即可拿到带 `data-src` 的 HTML，**不必** headless 浏览器；与裸 GET 的差异来自 **Cookie 与 query 触发的 SSR 分支**，而非必须用复杂客户端。

## 4. 专栏详情 `GET /x/article/view`（JSON）

与 §3 的 **整页 HTML** 不同，该接口返回 **专栏详情的 JSON**（含正文 HTML 字符串、互动与作者信息等），形态与浏览器在专栏页发起的 XHR 一致。

- **URL**：`GET https://api.bilibili.com/x/article/view`
- **业务查询参数**（需与 WBI 签名参数一并参与排序与 `w_rid` 计算）：
  - `id`：专栏 cvid（字符串即可）。
  - `gaia_source`：如 `main_web`。
  - `web_location`：如 `333.976`（与站点前端抓包一致即可）。
- **WBI 签名**：与其它 Web 接口相同。先 `GET https://api.bilibili.com/x/web-interface/nav`，从 `data.wbi_img` 的 `img_url` / `sub_url` 取出文件名，用公开的 **`MIXIN_KEY_ENC_TAB`** 派生 mixin key，对参数表做 `enc_wbi`（追加 `wts`、`w_rid` 等）。完整步骤与示例实现见同目录 **`tools/try_cv_view_cookies.py`**（`get_wbi_keys`、`enc_wbi`）。
- **Cookie 与会话（推荐顺序）**：
  1. **`GET` 专栏页** `https://www.bilibili.com/read/cv{id}/`（桌面 Chrome 形态的 `User-Agent` 等）。**不需要**让客户端自动跟随 30x：请直接使用 **最终 HTTPS URL** 单次请求；实测常直接 **200** 并 `Set-Cookie`（如 `buvid3`、`b_nut` 等）。若将 `allow_redirects` 设为 `false`，可避免多余跳转，行为与「直打最终地址」一致。
  2. 可选：在同一会话中为 `.bilibili.com` 设置 **`b_lsid`**、**`_uuid`**（生成方式与站点前端一致，见脚本内 `gen_b_lsid`、`gen_uuid_infoc`），便于与浏览器行为对齐。
  3. 同一会话依次：`nav` → 计算 WBI → **`GET /x/article/view`**。
- **请求头**：`Referer` 指向专栏页，例如 `https://www.bilibili.com/read/cv{id}/?opus_fallback=1`；`Origin`：`https://www.bilibili.com`。
- **风控**：可能返回 `code: -509`（请求过于频繁），需 **间隔重试**；业务成功为 `code: 0`。
- **样本**：`json/x-article-view-cv21097348.sample.json`（可用  
  `python3 tools/try_cv_view_cookies.py --save-json json/x-article-view-cv21097348.sample.json`  
  在 `code == 0` 时写出完整响应体）。

## 5. 推荐流水线（壁纸/图集类爬虫）

1. GET 专栏搜索页 → 解析 `searchTypeResponse.searchTypeResponse.result[]`。
2. 清洗 `title`（去 `<em>`）、补全 `image_urls` URL。
3. 收集 `id` → GET `metas`（带 Cookie）→ 与 SSR 条目按 `id` 合并。
4. 若需正文内全部图片：GET `https://www.bilibili.com/read/cv{id}/`（建议带与业务一致的 query + Cookie）→ 从 `#article-content` 或 `__INITIAL_STATE__.readInfo.content` 提取 `data-src` / 图片 URL。
5. 若需 **JSON 维度** 的正文与元数据（与 XHR 一致）：按 **§4** 建立会话并调用 `GET /x/article/view`（可与 §3 二选一或互补）。

## 6. 安全与合规

- **不要将真实 Cookie、SESSDATA 提交到仓库**；仅用本地或 CI 密钥注入。
- 请求频率与版权以哔哩哔哩服务条款及内容许可为准。
