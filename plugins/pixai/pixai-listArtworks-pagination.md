# PixAI `listArtworks` 接口爬取说明

本文说明如何通过 HTTP 稳定调用 PixAI 站点使用的 GraphQL 接口 **`listArtworks`**（作品列表）。**全部七种官方排序**（`feed` / `orderBy` / `first` / `last` 的组合）及 **`tackId` / `loraId` / 二者皆不传** 的爬法见 **§5.2**（**全站/通用流** 可不传标签与模型 id，与主站热门等入口抓包一致）。**作者个人页**（`authorId` + `types`；分页以 Tab 抓包为准，见 **§5.3**）。Relay 响应字段与通用伪代码见 §7、§8。**按标签（Tag）爬取**时变量用 **`tackId`**，要点见 **§5.1**。

---

## 1. 端点与 HTTP 方法

| 项 | 值 |
|----|-----|
| **Base URL** | `https://api.pixai.art/graphql` |
| **方法** | **GET**（与官网一致：参数全部放在 **查询字符串** 里） |

不使用 POST body 发送 `query` 时，依赖 **Apollo Persisted Queries**：通过 `extensions` 传 `sha256Hash`，服务端用哈希解析出真实查询。

---

## 2. 查询参数（Query String）

所有参数均需 **URL 编码**。下表为「解码后的语义名 → 含义」。

| 参数名 | 必填 | 说明 |
|--------|------|------|
| `operation` | 建议 | 与 `operationName` 一致即可，如 `listArtworks`。 |
| `operationName` | 建议 | `listArtworks`，与 persisted query 及 CSRF 头一致。 |
| `variables` | 是 | **JSON 字符串** 再整体 URL 编码。见下文 [§5 variables](#5-variables-字段)。 |
| `extensions` | 是 | **JSON 字符串** 再整体 URL 编码。见下文 [§6 extensions](#6-extensions-persisted-query)。 |
| `u3t` | 可选 | 浏览器抓包里有时出现；**本接口在常规场景下可不传**。 |

**组装顺序示例（逻辑上）：**

```text
https://api.pixai.art/graphql
  ?operation=listArtworks
  &operationName=listArtworks
  &variables=<URL编码的 JSON>
  &extensions=<URL编码的 JSON>
  [&u3t=<可选>]
```

`variables` 与 `extensions` 必须是 **无多余空格的紧凑 JSON**（`separators=(',',':')`），再 `encodeURIComponent` 整段，避免 `+`/空格与引号被错误解析。

---

## 3. 请求头

| 头 | 建议值 | 作用 |
|----|--------|------|
| `Accept` | `application/graphql-response+json, application/json;q=0.9` 或 `application/json` | 声明响应类型。 |
| `Content-Type` | `application/json` | **满足 Apollo CSRF**：非表单类 `Content-Type`，否则易返回 400。 |
| `x-apollo-operation-name` | `listArtworks` | 与 `operationName` 一致；同样用于通过 CSRF 校验。 |
| `Origin` | `https://pixai.art` | 与 CORS 一致。 |
| `Referer` | `https://pixai.art/` | 与站点一致。 |
| `User-Agent` | 常见桌面浏览器串 | 降低被简单拦截概率。 |
| `x-browser-id` | 可选 | 抓包中有时存在；无则多数仍可通。 |

**CSRF 错误特征：** 响应 JSON 含 `Cross-Site Request Forgery` / `apollo-require-preflight` 等文案 → 补上 **`Content-Type: application/json`** 或 **`x-apollo-operation-name: listArtworks`**。

---

## 4. Cookie / 登录

- **不需要 Cookie。** 按本文组好查询参数与请求头后，即可用普通 HTTP 客户端拉取列表（与实测一致）；无需携带浏览器 `Cookie` 头，也无需登录态。
- 若日后站点策略变更导致未带 Cookie 被拒绝，再按抓包补全即可；当前文档按 **无 Cookie** 描述。
- 合规：仅在你有权访问的数据范围内使用，并遵守站点条款与频率限制。

---

## 5. `variables` 字段

值为 JSON 对象（再 URL 编码）。抓包示例：

```json
{
  "loraId": "1991205934961235887",
  "isSafeSearch": true,
  "first": 24,
  "feed": "trending1"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `loraId` | 字符串，可选 | LoRA / 模型相关 id；**模型作品流** 与页面上下文一致时使用（与 `tackId` 一般不同时出现，**以抓包为准**）。**不传** 时表示非模型限定流（可与 **`tackId` 同时不传** 构成全站/通用列表，见 **§5.2**）。 |
| `tackId` | 字符串，可选 | **标签（Tag/Tack）** id；**标签作品流** 与页面上下文一致时使用。分页规则与 `loraId` 流相同。**不传** 时表示非标签限定流（可与 **`loraId` 同时不传**，见 **§5.2**）。 |
| `isSafeSearch` | 布尔 | 是否安全搜索过滤。 |
| `first` | 整数 | 本页条数（每页最多多少条由服务端限制，常用 24）；常与 `after` / `endCursor` 向前翻页配合。部分入口用 **`last`** 代替，见 **§5.2**。 |
| `last` | 整数，可选 | 与 `first` 语义类似（本页条数）。抓包中可与 **`feed: "latest"`** 等组合出现；与 `first` **一般不同时使用**。翻页字段须与该入口一致（可能涉及 `before` / `startCursor`），**以抓包为准**。 |
| `feed` | 字符串，可选 | 流类型（决定或参与列表排序/筛选逻辑），如 `trending1`、`latest`、`daily_ranking_dedup`；不同入口可能不同，**以抓包为准**。与 **`orderBy`** 可能二选一或并存，见 **§5.2**。 |
| `orderBy` | 字符串，可选 | 按字段排序表达式。前缀 **`-`** 多为降序，**`+`** 或无前缀多为升序。七种官方排序中 **人气、点赞升序、创建时间升/降** 见 **§5.2**。响应里点赞在 **`node.likedCount`**，时间在 **`node.createdAt`**，与 `orderBy` 字符串路径可能不一致，属正常现象。 |
| `after` | 字符串，可选 | **第二页及以后**：上一页返回的 **`data.artworks.pageInfo.endCursor`**。第一页 **不要** 传。使用 `last` 为主的流时，翻页可能不以 `after` 为主，**以抓包为准**。 |

翻页时 **除新增/更新游标（常见为 `after`）外，其余过滤条件必须与本流一致**，否则游标无效或结果错位。

### 5.1 按 Tag（标签）爬取要点

- **与模型流的唯一区别在 `variables` 主键**：标签页、按标签浏览作品时，抓包中为 **`tackId`**（字符串），而不是 **`loraId`**。`isSafeSearch` 与 **§5.2** 所选官方排序对应的 `feed` / `orderBy` / `first` / `last` 等与入口一致即可。**趋势、日榜、人气** 及 **`orderBy` 三种时间/点赞序**：首屏不传游标，之后 **`after` = 上一响应的 `data.artworks.pageInfo.endCursor`**（见 §7、§8），不要手写游标（§9）。**「最新」** 排序用 `last`，翻页字段常与上述不同，**以 §5.2 总览表「最新」一行** 为准。模型流 **`loraId` + 各排序** 见 **§5.2**（将示例中的 **`tackId` 换成 `loraId`** 即可）。**全站/通用流**（主站热门等）**不传 `tackId` 与 `loraId`**，仅保留 `isSafeSearch` 与 §5.2 中与该入口一致的 `feed` / `orderBy` / `first` / `last`，见 **§5.2**「流维度」第三项。
- **示例 `variables`（首屏，紧凑 JSON 后再做 URL 编码）**：

```json
{
  "isSafeSearch": true,
  "tackId": "1941984460689399023",
  "first": 24,
  "feed": "trending1"
}
```

- **`tackId` 的来源**：须与当前标签页 URL / 接口一致；仓库内 [`json/artworks-tags.json`](./json/artworks-tags.json) 为 **标签列表元数据**（`tags` 查询样例），可用于对照 `id` / `name`，**拉取该标签下的作品列表仍用本接口 `listArtworks` + `tackId`**，二者不要混淆。
- **与本仓库插件脚本**：[`crawl.rhai`](./crawl.rhai) 当前按 **模型** 组装 `loraId`；若实现「按标签爬作品」，将变量改为 **`tackId`**（并保留相同翻页与 `extensions` 逻辑）即可。
- **`trending` 类 feed** 仍可能出现时间漂移或相邻页 id 交集，需要唯一集合时对 `node.id` 去重（§8 末段）。

### 5.2 七种官方排序与爬取（`tackId` / `loraId` / 均可不传）

`listArtworks` 在同一 persisted query 下，通过 **`variables` 的合法组合** 提供 **七种官方排序**。前四种与站点 **主界面 Tab** 常见一一对应；后三种仅通过 **`orderBy`** 表达，**与 `feed` 类排序一样由服务端接受、可稳定分页**，并非「非正式参数」——爬虫、插件可与人气/趋势等 **同等选用**。

#### 流维度：标签、模型或全站（三选一）

- **标签流**：`"tackId": "<标签 id>"`（见 §5.1）。
- **模型 / LoRA 流**：`"loraId": "<模型 id>"`（与模型详情页作品列表、[`crawl.rhai`](./crawl.rhai) 等一致）。
- **全站 / 通用流**：**不传 `tackId` 与 `loraId`**（或二者均省略）。与主站 **未限定标签或模型** 的作品列表抓包一致，例如仅 `isSafeSearch` + `first` + `feed: "trending1"` 等。
- 同一请求里 **`tackId` 与 `loraId` 一般不同时出现**；**全站流** 为 **二者均不传**，**以抓包为准**。下列 **`feed` / `orderBy` / `first` / `last` 及翻页规则对上述三种情形相同**，只需在示例上 **删掉主键**、或把 **`tackId` 整条键值** 换成 **`loraId` + 对应 id**（或反之）。

**全站 · 趋势（首屏示例，无 `tackId` / `loraId`）**：

```json
{
  "isSafeSearch": true,
  "first": 24,
  "feed": "trending1"
}
```

**爬取通则**：选定一种排序后，**`variables` 除游标外保持不变**；游标用响应 **`pageInfo`**（常见为 **`endCursor` → 下一页 `after`**），**不要手写**（§9）。换排序须 **从第一页重拉**。`after` 解码中的 **`sort`** 见 §9。

---

#### 七种排序总览（官方 · 一眼对照）

| # | 排序名称 | 主界面常见 | 首屏关键 `variables`（除 `isSafeSearch`、可选 `tackId`/`loraId` 外） | 翻页 |
|---|----------|------------|--------------------------------------------------|------|
| 1 | **趋势** | 有 Tab | `first` + **`feed: "trending1"`** | **`after`** ← **`endCursor`** |
| 2 | **日榜** | 有 Tab | `first` + **`feed: "daily_ranking_dedup"`** | **`after`** ← **`endCursor`** |
| 3 | **人气**（赞多→少） | 有 Tab | `first` + **`orderBy: "-markInfo.likedCount"`**；**不传 `feed`** | **`after`** ← **`endCursor`** |
| 4 | **最新** | 有 Tab | **`last`** + **`feed: "latest"`**；**不传 `first`** | 与 **「最新」Tab** 抓包一致，常见 **`before` + `startCursor`**；勿假定 `first`+`after` |
| 5 | **人气(逆)** | 未必单独 Tab | `first` + **`orderBy: "markInfo.likedCount"`** 或 **`"+markInfo.likedCount"`**；**不传 `feed`** | **`after`** ← **`endCursor`**（同人气） |
| 6 | **创建时间从旧到新** | 未必单独 Tab | `first` + **`orderBy: "createdAt"`** 或 **`"+createdAt"`**；**不传 `feed`** | **`after`** ← **`endCursor`** |
| 7 | **创建时间从新到旧** | 未必单独 Tab | `first` + **`orderBy: "-createdAt"`**；**不传 `feed`** | **`after`** ← **`endCursor`** |

**共性**：均带 **`isSafeSearch`**（通常 `true`）。**可选** 主键 **`tackId`** 或 **`loraId`**（**全站流二者皆不传**）。第二页起仅在 JSON 上 **追加/更新游标**；`extensions`、请求头不变。

**说明（#5～#7）**：与 #3 一样走 **`orderBy` 官方字段**；#5 为 #3 的升序；#6 / #7 按 **`node.createdAt`** 排序，勿用 **`updatedAt`** 代替「按发布时间」。#7 与 #4 **变量不同**（#4 为 `last`+`latest` feed），语义同属「新在前」但实现须各用各套翻页。

**注意**：#5～#7 首屏 **`edges` 条数可能明显小于 `first`**，以 **`hasNextPage`** 为准继续传 **`after`**。**`orderBy: "markInfo.createdAt"`** 等路径实测可能 **0 条**，勿用。

---

#### 示例 JSON（标签 · `tackId`）

模型流将 **`tackId`** 改为 **`loraId`** 并替换 id；**全站流** 则 **省略** `tackId` 与 `loraId`。第二页起在对应首屏上增加 **`"after": "<上一页 endCursor>"`**（#4「最新」除外，按抓包）。

**1. 趋势**

```json
{
  "isSafeSearch": true,
  "tackId": "<标签 id>",
  "first": 24,
  "feed": "trending1"
}
```

**2. 日榜**

```json
{
  "isSafeSearch": true,
  "tackId": "<标签 id>",
  "first": 24,
  "feed": "daily_ranking_dedup"
}
```

**3. 人气**

```json
{
  "isSafeSearch": true,
  "tackId": "<标签 id>",
  "first": 24,
  "orderBy": "-markInfo.likedCount"
}
```

**模型流 · 人气（仅主键不同）**

```json
{
  "loraId": "<模型 id>",
  "isSafeSearch": true,
  "first": 24,
  "orderBy": "-markInfo.likedCount"
}
```

第二页示例（在上一 JSON 上加 `after`）：

```json
{
  "loraId": "<模型 id>",
  "isSafeSearch": true,
  "first": 24,
  "orderBy": "-markInfo.likedCount",
  "after": "<上一页 endCursor>"
}
```

**4. 最新**

```json
{
  "isSafeSearch": true,
  "tackId": "<标签 id>",
  "last": 24,
  "feed": "latest"
}
```

**5. 点赞从低到高**

```json
{
  "isSafeSearch": true,
  "tackId": "<标签 id>",
  "first": 24,
  "orderBy": "markInfo.likedCount"
}
```

（亦可 **`"+markInfo.likedCount"`**。）

**6. 创建时间从旧到新**

```json
{
  "isSafeSearch": true,
  "tackId": "<标签 id>",
  "first": 24,
  "orderBy": "createdAt"
}
```

（亦可 **`"+createdAt"`**。）

**7. 创建时间从新到旧**

```json
{
  "isSafeSearch": true,
  "tackId": "<标签 id>",
  "first": 24,
  "orderBy": "-createdAt"
}
```

---

#### 其他说明

- **`trending1`** 后缀若随前端升级变化，以 DevTools **「趋势」** 对应请求的 `feed` 为准。
- **最新（#4）** 的翻页请 **打开「最新」Tab 抓包**，与 `pageInfo.hasPreviousPage` / `startCursor` 等对齐；§8 伪代码以 `first`+`after` 为主，**#4 须单独分支**。

### 5.3 作者页作品列表（`authorId` + `types`）

用户个人页「作品 / 相册 / 动图」等抓包常见 **`listArtworks`**，变量与 **§5.2 模型/标签流** 不同：**无 `loraId` / `tackId` / `feed` / `isSafeSearch`**（以抓包为准），而用 **`authorId`**（作者用户 id 字符串）与 **`types`**（见下表）限定范围。

#### `types` 取值（字符串数组，可多选）

| 取值 | 说明 |
|------|------|
| **`DEFAULT`** | 默认类型作品（如静态图）。 |
| **`ALBUM`** | 相册。 |
| **`ANIMATED_ARTWORK`** | 动图 / 动画类作品；仅动图子列表时抓包常见 **`["ANIMATED_ARTWORK"]`**。 |

示例：**`["DEFAULT","ALBUM"]`**（作品与相册合并列表）；**`["ANIMATED_ARTWORK"]`**（仅动图）。其它枚举以站点抓包为准。

#### 分页（以 Tab 抓包为准）

- **「作品 + 相册」等常见 Tab**：Relay **`last` + `before`**，语义与同目录 **[`listGenerationModels` 的 `last` + `before`](./pixai-listGenerationModels-pagination.md)** 一致：**向更旧一批** 时，下一页 **`before`** = 本响应 **`data.artworks.pageInfo.startCursor`**（勿用 `endCursor` 当 `before`）。结束看 **`hasPreviousPage`**。
- **动图等 Tab**：抓包亦见 **`first` + `after`**（与 §5.2 人气类似：下一页 **`after`** ← **`endCursor`**，结束看 **`hasNextPage`**）。**勿与当前 Tab 已选用的 `last`/`before` 混用**。

站点在作者页还可传 **`orderBy`**（与 **§5.2** 同源，如 **`"-markInfo.likedCount"`**）。翻页时 **`orderBy`、`authorId`、`types`、每页条数字段（`first` 或 `last`）** 须与首屏 **完全一致**，仅更新游标（**`before`** 或 **`after`**）。

| 步骤 | `variables`（逻辑） |
|------|---------------------|
| **`last` + `before` 流 · 首屏** | `{ "last": <n>, "authorId": "<id>", "types": <见上表> }`，可选 **`orderBy`**；**不传 `before`**。 |
| **`last` + `before` 流 · 下一页** | 同上，增加 **`"before": "<上一响应的 pageInfo.startCursor>"`**。 |
| **`last` + `before` 流 · 结束** | **`pageInfo.hasPreviousPage === false`**。 |
| **`first` + `after` 流 · 首屏** | `{ "first": <n>, "authorId": "<id>", "types": <见上表> }`，可选 **`orderBy`**；**不传 `after`**。 |
| **`first` + `after` 流 · 下一页** | 同上，增加 **`"after": "<上一响应的 pageInfo.endCursor>"`**。 |
| **`first` + `after` 流 · 结束** | **`pageInfo.hasNextPage === false`**。 |

**`extensions`**：与 **§6** 中 **`listArtworks`** 示例一致即可；若出现 **`PersistedQueryNotFound`**，再从 DevTools → Network **整段复制** `extensions`。**作者流与 §5.2 的差别在 `variables` 字段**（必有 **`authorId` + `types`**；分页为 **`last`/`before` 或 `first`/`after`**，与 §5.2 的 `tackId`/`loraId`/`isSafeSearch` 等勿混用）。

**登录**：你提供的样例带 **`Authorization: Bearer …`** 与 Cookie；是否必须取决于作者可见性与站点策略，**以抓包为准**。勿将 token 写入仓库。

**校验**：插件目录下 `node ./scripts/verify-listArtworks-author-pagination.mjs`（可选 `PIXAI_AUTHORIZATION`、`PIXAI_AUTHOR_ID`）；测人气序时设 **`PIXAI_AUTHOR_ORDER_BY=-markInfo.likedCount`**。连续两页 **`node.id` 集合应无交集**。

**七种排序 × 图片 / 动图（首屏探测）**：`node ./scripts/verify-listArtworks-author-seven-sorts.mjs`。在 **`authorId` + `types`** 上套用 **§5.2 总览表** 的 `first`/`last`、`feed`/`orderBy`（**不传 `tackId`/`loraId`**；是否加 **`isSafeSearch`** 以抓包为准，脚本可用 **`PIXAI_AUTHOR_INCLUDE_SAFE_SEARCH=1`** 对照）。仓库用默认作者 id 曾 **14/14 首屏 HTTP 200、无 GraphQL errors**；**`types: ["ANIMATED_ARTWORK"]`** 时 **`edges` 条数随该作者动图存量变化**（可能远小于 `first`）。换作者请设 **`PIXAI_AUTHOR_ID`**。

---

## 6. `extensions`（Persisted Query）

值为 JSON 对象（再 URL 编码），结构固定为客户端库信息 + 持久化查询哈希：

```json
{
  "clientLibrary": {
    "name": "@apollo/client",
    "version": "4.1.4"
  },
  "persistedQuery": {
    "version": 1,
    "sha256Hash": "e0c938939452d33abf3289e74b9f9f7bebd749e065ee905e7e073aca6f05199c"
  }
}
```

- **`sha256Hash`** 对应操作 **`listArtworks`** 的注册查询；**站点升级前端后哈希可能变更**，若出现 GraphQL 层「未知 persisted query」类错误，需在 DevTools → Network 里 **重新复制** `extensions`。
- **作者页（§5.3）与标签/模型/全站流（§5.2）** 均为 **`listArtworks`** 时，**`extensions` 可与上表一致**；区分各入口的要点是 **`variables`**——作者流必有 **`authorId` + `types`**（含 **`DEFAULT` / `ALBUM` / `ANIMATED_ARTWORK`** 等，§5.3 表），分页 **`last`/`before` 或 `first`/`after`** 以 Tab 抓包为准；§5.2 流用 **`tackId`/`loraId`/`isSafeSearch`** 等与 **`first`/`after`**（及 #4 等）组合，**两套不要混用**。
- `clientLibrary.version` 宜与抓包一致（或与当前站点的 Apollo 版本一致）。

---

## 7. 响应结构（爬取时解析）

- 成功时主体为 JSON，根上常见 **`data`** 与可选 **`errors`**。
- 列表路径：**`data.artworks.edges`**，每项形如 `{"node": { ... 作品字段 ... }, "cursor": "..."}`。
- 分页：**`data.artworks.pageInfo`**
  - **`hasNextPage`** / **`hasPreviousPage`**：`first`+`after` 流多看 **`hasNextPage`**（含 **§5.3** 动图等 Tab）；**`last`+`before`** 流（**§5.2 #4 最新**、**§5.3** 作品/相册等 Tab）向更旧翻页时多看 **`hasPreviousPage`**。
  - **`endCursor`**：在 **`first` + `after`** 流中，下一页 **`variables.after`** 通常取本页的 **`endCursor`**（见 §5.2 总览表、§5.3 动图子流）。
  - **`startCursor`**：在 **`last` + `before`** 流中，下一页 **`variables.before`** 取 **本页** 的 **`startCursor`**（见 §5.3、[`listGenerationModels`](./pixai-listGenerationModels-pagination.md) §5）。

若存在 **`errors`**，可能仍有部分 `data`；需根据业务决定重试或记录。

---

## 8. 伪代码：组 URL、发请求、翻页

**§5.2** 七种官方排序的首屏 `variables` 见该节；下列循环适用于 **#1～#3、#5～#7**（`first` + `after` + `endCursor`）。**#4 最新** 使用 `last` + `feed: "latest"`，翻页须按 **§5.2 总览表** 与该 Tab 抓包单独实现（常见 **`before` ← 上一页 `startCursor`**，**`hasPreviousPage`** 判结束）。**§5.3 作者页** 必有 **`authorId` + `types`**（含 **`ANIMATED_ARTWORK`** 等，见 §5.3）；分页多为 **`last`/`before`**，动图等 Tab 可能为 **`first`/`after`**。**#4**、**§5.3** 与下方循环 **须各写分支**，**不得**把 §5.2 的 `tackId`/`loraId` 主键搬进作者请求。

下列为语言无关步骤，实现时用自己环境的 JSON 序列化与 **百分号编码（encodeURIComponent 语义）** 即可。

```text
// 常量
BASE   = "https://api.pixai.art/graphql"
OP     = "listArtworks"
EXT_JSON = 紧凑 JSON（见 §6 的 extensions 对象，键序可固定以便复现）

HEADERS = {
  "Accept": "application/json",
  "Content-Type": "application/json",
  "x-apollo-operation-name": OP,
  "Origin": "https://pixai.art",
  "Referer": "https://pixai.art/"
}
// 不发送 Cookie 头

函数 构建请求URL(variables 对象):
  varsJson = 将 variables 序列化为紧凑 JSON（无多余空格）
  q = "operation=" + OP
    + "&operationName=" + OP
    + "&variables=" + percent_encode(varsJson)
    + "&extensions=" + percent_encode(EXT_JSON)
  // 可选: + "&u3t=" + percent_encode(某令牌)
  返回 BASE + "?" + q

函数 拉取一页(variables):
  url = 构建请求URL(variables)
  response = HTTP_GET(url, headers = HEADERS)   // 无 Cookie
  body = 解析 JSON(response)
  返回 body

// 全量翻页（§5.2：tackId / loraId 二选一或皆不传；feed / orderBy 等见该节。§5.3：authorId + types，游标见 §5.3 表）
baseVariables = { 可选 loraId 或 tackId, isSafeSearch, ... }   // 全站流不含 loraId/tackId；常见含 first 与 feed；或含 last、orderBy 等；不含游标
cursor = 空

循环:
  variables = 复制(baseVariables)
  若 cursor 非空:
    variables.after = cursor   // 使用 last/before 的流则按抓包改字段名与游标来源
  body = 拉取一页(variables)
  若 HTTP 失败 或 body.data.artworks 缺失:
    按策略重试或退出
  对 body.data.artworks.edges 中每条 edge:
    处理 edge.node（及所需字段）
  pageInfo = body.data.artworks.pageInfo
  若 pageInfo.hasNextPage == false:
    跳出循环
  cursor = pageInfo.endCursor
  若 cursor 为空: 跳出循环
  （可选）sleep，降低 429 风险
```

**注意：** `trending` 类 feed 会随时间变化，连续翻页时 **偶发与上一页 id 交集**；若要求唯一集合，对 `node.id` **做去重**。

---

## 9. `after` 游标内部结构（仅作理解，不要手写）

对 `after` 做 **标准 Base64 解码** 得到 **MessagePack** 编码的 map，语义上接近：

```json
{
  "id": "<8 字节二进制，fixext8>",
  "seed": 2,
  "sort": [387.20892, "1992748035839559718"]
}
```

- **`sort`**：`[分数, 作品 id 字符串]`，与排序相关。
- **`seed`**：服务端分页状态整数。
- **`id`**：内部二进制。

**结论：** 游标必须由接口返回的 **`endCursor`** 提供，**不要**自行拼 Base64/MessagePack。

解码调试（可选）：

```bash
echo '<粘贴 endCursor>' | base64 -d | xxd
```

从已保存的响应取下一页游标：

```bash
jq -r '.data.artworks.pageInfo.endCursor' ../../../docs/pixai-listArtworks-page1-response.json
```

（路径相对于本文件 `src-crawler-plugins/plugins/pixai/`。）

---

## 10. curl 示例（无 Cookie）

先用 **§8 伪代码** 算出完整 `URL`（对 `variables`、`extensions` 做百分号编码后拼进查询串）。下面 **不** 使用 `-b` / `Cookie`：

```bash
curl -sS "$URL" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'x-apollo-operation-name: listArtworks' \
  -H 'Origin: https://pixai.art' \
  -H 'Referer: https://pixai.art/' \
  -o page1.json
```

第二页：在 `variables` 的 JSON 中加入 `"after": "<上一响应的 pageInfo.endCursor>"`，再重新编码并替换 `URL` 中的 `variables=` 段。

---

## 11. 仓库内响应样例（对照）

下列文件为 **无 Cookie** 请求的真实 JSON 响应（体积约数百 KB，已格式化缩进），可用于对照字段与游标衔接：

| 文件（相对仓库根） | 说明 |
|--------------------|------|
| `./json/pixai-listArtworks-page1-response.json` | `variables` 无 `after`（首屏；样例为 **`loraId`** 流） |
| `./json/pixai-listArtworks-page2-response.json` | `variables.after` = 上一文件 `data.artworks.pageInfo.endCursor` |
| `./json/artworks-tags.json` | 标签元数据对照；**作品分页**仍用 `listArtworks` + **`tackId`**（§5.1） |

---

## 12. 相关文档

- 父页面模型列表 **`listGenerationModels`**（**`last` + `before`**）：**[pixai-listGenerationModels-pagination.md](./pixai-listGenerationModels-pagination.md)**（与 [docs/pixai-listGenerationModels-pagination.md](../../../docs/pixai-listGenerationModels-pagination.md) 内容同步，任选其一查阅）。
