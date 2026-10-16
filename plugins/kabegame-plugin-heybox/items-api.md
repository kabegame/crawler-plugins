# 小黑盒 Web 端「items」类接口爬取规则

面向 `https://api.xiaoheihe.cn` 上由官网前端发起的 BBS / 信息流类请求。下列规则来自对官网打包脚本（`xhh.js` 等）与实测抓包的对照。

---

## 1. 适用范围

- **Host**：`https://api.xiaoheihe.cn`
- **典型列表接口**（响应中含帖子列表，路径或字段名因接口而异）：
  - `GET /bbs/app/feeds` — 信息流，`result.links`（每条为帖子/链接）
  - `GET /bbs/app/api/general/search/v1` — 综合搜索，主体结果为 **`result.items`**（数组）。**`q`** 为关键词（UTF-8 后 URL 编码）；**`search_type`** 常见为 **`general`**（综合）或 **`link`**（偏帖子/链接）；**`time_range`** 可为空字符串；另有 **`offset`、`limit`** 分页，**`dw`、`is_pull_down`、`no_more`** 等与客户端布局/分页相关。换 **`q`** 或 **`search_type`** 会得到不同列表；签名用路径为 **`/bbs/app/api/general/search/v1/`**。
  - `GET /bbs/app/api/search/found` — 搜索发现等，`result.search_found.list` 等
  - `GET /bbs/app/link/tree` — 单帖 **评论/楼中楼树**；查询参数 **`link_id`** 与列表接口里帖子的 **`linkid`** 对应（如 `feeds` → `result.links[].linkid`，综合搜索 → `result.items[].info.linkid`）
  - `GET /bbs/app/api/original/image` — 由 **缩略图 URL** 换 **原图 URL**（见第 11 节）；签名用路径为 **`/bbs/app/api/original/image/`**
- 凡带 **`hkey`、`nonce`、`_time`** 的 Web 端请求，均需按第 3 节生成签名。

---

## 2. 公共查询参数（Web 端）

以下为官网 axios 拦截器合并的常用参数（具体接口会再叠加业务参数，如 `q`、`offset`、`pull` 等）。

| 参数 | 典型值 | 说明 |
|------|--------|------|
| `os_type` | `web` | 平台 |
| `app` | `heybox` | 应用名 |
| `client_type` | `web` | 客户端类型（与官网一致即可） |
| `version` | `999.0.4` | 前端版本号 |
| `web_version` | `2.5` | Web 版本 |
| `x_client_type` | `web` | |
| `x_app` | `heybox_website` | |
| `heybox_id` | 用户 ID 或空 | 未登录可空字符串 |
| `x_os_type` | `Windows` 等 | 与 UA 一致即可 |
| `device_info` | `Chrome` | |
| `device_id` | 固定长度设备 ID 字符串 | 浏览器侧多为本地持久化随机串 |
| `dw` | `628`、`604` 等 | **内容区宽度（像素）**，Web 端传主栏/列表可视宽度，用于排版与埋点；与 **`is_pull_down`**、**`no_more`** 同属布局上下文，**不参与** `hkey` 计算（签名仅依赖路径 + `_time` + `nonce`） |

签名三参数（必参与 URL 查询串）：

| 参数 | 说明 |
|------|------|
| `_time` | **Unix 秒**（整数），建议使用 `floor(now_ms / 1000)` |
| `nonce` | 32 位 **大写十六进制**，见 3.1 |
| `hkey` | 短字符串（约 7 字符），由路径 + `_time` + `nonce` 计算，见 3.2 |

---

## 3. 签名算法（与官网 Web 端一致）

### 3.1 `nonce`

1. 取当前秒级时间戳 `t`（与 URL 中的 `_time` 一致）。
2. 计算：`nonce = MD5( string(t) + string(Math.random()) ).hexdigest().toUpperCase()`  
   - 与浏览器一致：`Math.random()` 不接受参数；拼接为字符串后做 MD5。

### 3.2 `hkey` 依赖的「路径」

参与签名的不是完整 URL，而是 **仅 pathname**，并做规范化：

1. 若传入完整 URL，先取 `pathname`。
2. 按 `/` 分段，去掉空段，再用 `/` 连接，**前后各加一条 `/`**。  
   - 示例：`https://api.xiaoheihe.cn/bbs/app/feeds?...` → 参与签名的路径为 **`/bbs/app/feeds/`**  
   - 示例：`/bbs/app/api/general/search/v1` → **`/bbs/app/api/general/search/v1/`**

### 3.3 `hkey` 计算步骤（摘要）

记字符集（固定 36 字符）：

```text
AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89
```

记 `T = _time`（秒，整数）。内部用于签名的第二个时间量为 **`T + 1`**（与前端 `lv.g` → `ov(e, T+1, nonce)` 一致）。

1. **partA**：用字符集对 `string(T+1)` 做「按字符码取模映射」，字符集先 `slice(0, -2)`（去掉最后 2 个字符作为索引池）。
2. **partB**：对规范化路径中每个字符，用「字符码 mod 字符集长度」从字符集取字符，得到与路径等长的串。
3. **partC**：对 `nonce`（大写十六进制串）逐字符同样映射。
4. 将 **partA、partB、partC** 按 **列优先** 交错：第 0 列取各段第 0 个字符，再第 1 列……拼成一条字符串，**截取前 20 字符**。
5. 对该字符串做 **MD5**，得到 32 位小写十六进制 `md5hex`。
6. 取 `md5hex` 的 **后 6 个字符**，每个字符转为 ASCII 码，得到 6 个整数；对 **前 4 个码** 做一轮固定的 4 字节可逆混合（前端 `Km`），**原地**写回前 4 个；再对 **全部 6 个码** 求和，**mod 100**，格式化为两位数字字符串 `dd`。
7. 取 `md5hex` 的 **前 5 个字符**，用字符集 `slice(0, -4)` 做映射，得到前缀 `prefix`。
8. **`hkey = prefix + dd`**（如 `XTII792`）。

校验：用抓包中的 `_time`、`nonce`、路径与上述步骤应能还原同一 `hkey`。

---

## 4. HTTP 请求建议

| 项目 | 建议 |
|------|------|
| 方法 | 上述接口均为 **GET**，参数放在 **query** |
| `Origin` | `https://www.xiaoheihe.cn` |
| `Referer` | `https://www.xiaoheihe.cn/` |
| `User-Agent` | 常见桌面 Chrome UA 即可 |
| Cookie | **多数列表/搜索接口可不携带**；携带登录态时排序或埋点字段可能与匿名略有差异（见第 5 节） |

---

## 5. 帖子评论树 `GET /bbs/app/link/tree`

- **签名用路径（第 3.2 节）**：`/bbs/app/link/tree/`（与 `feeds`、搜索等同款 `hkey` 算法，仅路径不同）。
- **业务查询参数（示例）**：`link_id`（必填，整数，与上文列表里的 **`linkid`** 一致）、`h_src`（可为空）、`is_first`、`page`、`index`、`limit`、`owner_only` 等；与官网抓包对齐即可。
- **无 Cookie 实测**：仅携带合法 **`hkey` / `_time` / `nonce`** 与公共参数时，接口可能返回 **`"status":"show_captcha"`** 且 **`result` 为空对象**，属服务端风控/验证码策略；是否在登录态或浏览器内可拿到完整树，以线上为准。

---

## 6. 响应中「items」位置与 Cookie 差异（实测）

- **搜索** `general/search/v1`：`result.items` 为数组；单页条数由 `limit` 等决定。
- **信息流** `feeds`：列表在 **`result.links`**，不是 `items` 字段名。
- **带 Cookie vs 不带**：同一请求下条数可一致；**排序或个别条目**可能不同；对 **同一 `linkid`** 的帖子，业务字段大多一致，差异常见于 **`info.h_src`**（Base64 埋点串）及部分 **`report_id`**。

---

## 7. 综合搜索翻页（`GET /bbs/app/api/general/search/v1`）

- 在 **`q`、`search_type`** 与筛选条件（如 `time_range` 等）**不变**的前提下，通过增大 **`offset`** 拉取后续结果；步长通常与 **`limit`** 一致，例如 **`limit=30`** 时：第 1 页 `offset=0`，第 2 页 `offset=30`，第 3 页 `offset=60`，即 **`offset += limit`**。
- 查询串里的 **`no_more`** 多为前端占位（如 `false`）；**是否还有结果**主要看本次 **`result.items`** 是否为空、或条数是否明显少于 **`limit`**（末页可能不足一页）。
- **每次请求**应使用**当前秒级** **`_time`** 并现算 **`nonce`、`hkey`**（与 `offset` 无关，但旧签名会过期）。
- 实测（**`search_type=general`，`q=原神`，`limit=30`**，无 Cookie）：**`offset=30`** 与 **`offset=60`** 返回的 **`result.items[0].info.linkid`** 不同，说明翻页生效；单页 **`items` 条数**可能接近或略大于 `limit`，末页可能更少。

---

## 8. 时效与重放

- `_time`、`nonce`、`hkey` 需 **自洽**（按第 3 节生成）。
- 过旧的 `_time` 可能被服务端拒绝；应用 **当前秒级时间** 现算一组再请求。
- 同一组参数在一段时间内可能仍可重放，以服务端策略为准。

---

## 9. 代码参考

[scripts/xhh-sign-test.mjs](./scripts/xhh-sign-test.mjs)：含 `computeHkey`、`computeNonce` 及 `feeds` 自检示例；换接口时把路径改为对应 pathname 即可生成 `hkey`。

[scripts/replay-search-tree.mjs](./scripts/replay-search-tree.mjs)：搜索 / tree 重放、无 Cookie、空 `device_id` 等对照实验（非产品依赖）。

[scripts/download-search-first-item.mjs](./scripts/download-search-first-item.mjs)：综合搜索一页 → 每帖 `tree` → **`link.text` 中 `type=img` 的 `url`** → **`original/image` 取 `imgs`** → 下载原图（示例脚本，间隔与重试可配）。

---

## 10. 无 Cookie 爬取要点与流程

本节归纳：**不设置 Cookie** 时，按抓包形态拼 query、**动态计算签名与分页参数**，从综合搜索经 **`share_url`** 取 **`link_id`**，再拉 **`link/tree`** 取图链的推荐做法。

### 10.1 查询参数怎么设

- **与抓包对齐的固定项**（可按官网当前版本微调）：`os_type=web`、`app=heybox`、`client_type=web`、`version`、`web_version`、`x_client_type=web`、`x_app=heybox_website`、`x_os_type`、`device_info`、`heybox_id`（未登录可空）、`dw`、`is_pull_down`、`no_more` 等；`device_id` 用空字符串（需与自测一致，见第 4 节 HTTP 建议）。
- **每条 HTTP 请求都必须现算**（第 3 节）：同一秒级 **`_time`**、随机 **`nonce`**、由**当前接口路径**算出的 **`hkey`**。`search`、`tree`、**`original/image`**（第 11 节）的路径各不相同，**须按接口各算一组**，不可混用。
- **由程序按页推进的动态项**：
  - **`offset` / `limit`**：搜索翻页（第 7 节），例如 `limit=30` 时第 `n` 页为 `offset = (n - 1) * limit`。
  - **`link_id`**：仅用于 **`/bbs/app/link/tree`**，来自下述 **`share_url`** 解析，而非手写。

### 10.2 用户可配置项（示例）

| 配置 | 含义 |
|------|------|
| `q` | 搜索关键词（UTF-8，`URLSearchParams` 会负责编码） |
| `search_type` | 如 `general`（综合）、`link`（偏帖子）等，与官网一致 |
| `limit` | 每页条数，与 `offset` 配合翻页 |
| 爬取页数 | 上限 `offset` 或循环直到 `items` 为空 / 不足一页 |
| 可选 | `dw`、`device_id` 与抓包对齐，便于行为一致 |

### 10.3 推荐爬取流程（不设置 Cookie）

1. **请求搜索** `GET /bbs/app/api/general/search/v1`：带上用户设置的 **`q`**、**`search_type`**，以及当前页的 **`offset` / `limit`**；本步使用签名路径 **`/bbs/app/api/general/search/v1/`**。
2. 遍历 **`result.items`**：只处理带业务 **`info`** 的条目；对需要进详情拉图的帖，读取 **`info.share_url`**（若不存在则跳过或换用 `info.linkid` 按数值拼 `link_id`，以业务为准；**推荐优先用 `share_url` 中的 hex `link_id`**，与分享链路一致，**`tree` 可不传 `h_src`**）。
3. **从 `share_url` 解析 `link_id`**：例如  
   `https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&h_src=...&link_id=dcbe71750e99`  
   取查询参数 **`link_id`**（多为 **12 位十六进制** 字符串）。
4. **请求详情树** `GET /bbs/app/link/tree`：查询串中带 **`link_id=<上一步解析值>`**，以及抓包常见项如 **`is_first=1`、`page=1`、`index=1`、`limit=20`、`owner_only=0`**；**不必**带搜索埋点里的长 **`h_src`**（分享入口与实测一致）。签名路径为 **`/bbs/app/link/tree/`**，**重新**生成 `_time` / `nonce` / `hkey`。
5. **从 tree 响应中取正文缩略图并换原图**：在 **`result.link.text`** 中取正文——该字段多为 **JSON 数组字符串**（与 [tree-text.json](./tree-text.json)、[tree2.json](./tree2.json) 同构）：遍历元素，对 **`type` 为 `img`** 的项取其 **`url`**（CDN 缩略图，常带 `imageMogr2` 等查询参数）。**原图地址**需再请求 **`GET /bbs/app/api/original/image`**（第 11 节），使用返回的 **`result.imgs`** 再下载。
6. **循环**：完成当前帖的图片下载后，再处理同页下一条 `share_url`；当前搜索页处理完后 **`offset += limit`** 拉下一页，直至达到用户设置的页数或没有更多结果。

### 10.4 注意

- **风控**：无 Cookie 时部分环境仍可能返回 **`status: show_captcha`** 或空 `result`，需降频、重试或改参数；以线上为准（与第 5 节对照）。
- **并非每条 `item` 都有 `share_url`**：多为 **`type` 与帖子链路相关**的条目；条数可与 `limit` 不同（单页可能多于 `limit` 混合卡片）。
- 请遵守小黑盒服务条款与合理使用要求。

---

## 11. 原图：`GET /bbs/app/api/original/image`

在已拿到 **`GET /bbs/app/link/tree`** 的 **`status: ok`** 响应后，帖子正文里的图片通常不是一张「可直接当原图」的静态字段，而是：

1. **`result.link.text`**：字符串，内容为 **JSON 数组**（与 [tree-text.json](./tree-text.json) 一致）。
2. 数组中 **`type` 为 `img`** 的对象带有 **`url`**：指向 **缩略图/展示图**（多为 `thumb.jpeg` 等，且常带 `imageMogr2/.../thumbnail/...` 等 **query**，需 **完整保留** 作为本接口的输入）。

### 11.1 接口说明

| 项目 | 说明 |
|------|------|
| 方法 | **GET**，参数在 **query** |
| 签名用路径（第 3.2 节） | **`/bbs/app/api/original/image/`**（每次请求单独现算 `_time`、`nonce`、`hkey`） |
| 业务参数 | **`url`**：值为上一步 **`link.text`** 里 **`type=img`** 的 **`url` 整串**（含 `?` 后参数）；由 `URLSearchParams` 编码进查询串即可 |
| 公共参数 | 与其它 Web 接口一致：`os_type=web`、`app=heybox`、`client_type=web`、`version`、`web_version`、`x_client_type=web`、`x_app=heybox_website`、`heybox_id`（可空）、`x_os_type`、`device_info` 等；是否带 **`device_id`** 以你与抓包/风控自测为准 |
| HTTP 头 | 建议与第 4 节一致：`Origin`、`Referer`、`User-Agent` 等 |

### 11.2 响应与下载

- 成功时常见形态：`"status":"ok"`，**`result.imgs` 为字符串**。
- 实测该字符串多为 **单条原图 HTTPS URL**（例如去掉 `thumb`、无缩略参数的 CDN 地址）；亦可能为 JSON 数组字符串等形态，实现时可先 **`JSON.parse`**，失败则按整段当 URL 使用。
- 其它字段（如 **`is_original`、`width`、`height`、`fsize`**）可供展示，**下载原图以 `result.imgs` 解析出的 URL 为准**。

### 11.3 推荐串联流程（与第 10.3 节衔接）

1. `tree` → 取 **`result.link.text`** → **`JSON.parse`** 为数组。
2. 筛出 **`type === "img"`**，收集 **`url`**（缩略图列表）。
3. 对 **每个** 缩略图 **`url`**：请求 **`/bbs/app/api/original/image`**（新签名），解析 **`result.imgs`** 得到原图 URL，再 **GET 该 URL** 保存文件。
4. **频控**：连续请求易触发风控（与 `tree` 类似），建议在 **原图请求之间、下载成功后** 加入适当间隔（示例脚本中默认可配置秒级等待）。

---

## 工作评价（文档维护）

- **优点**：将路径规范化、`_time+1`、列优先交错、`hkey` 步骤写清，便于独立实现；补充 **`link.text` → `original/image` → `imgs`** 原图链路，与本地样例及示例脚本一致。
- **风险**：服务端若升级签名或增加风控，需重新抓包对照前端 bundle。
