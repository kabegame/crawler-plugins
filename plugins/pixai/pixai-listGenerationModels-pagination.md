# PixAI `listGenerationModels` 接口爬取说明（父页面 / 模型列表）

本文说明如何通过 HTTP 稳定调用 PixAI 站点使用的 GraphQL 接口 **`listGenerationModels`**（模型列表：**人气 / 趋势 / 生成人气 / 最新** 等 Tab，见 [§5.1](#51-四种列表与排序)）。分页为 Relay 游标：**`last` + `before`**（向 **更旧**）或 **`first` + `after`**（向 **更新**），依 Tab 与抓包为准。实现爬虫、插件或离线脚本时按下列顺序组请求即可。

**子页面（某模型下的作品列表）** 使用 **`listArtworks`**（`first` + `after`），见同目录 [pixai-listArtworks-pagination.md](./pixai-listArtworks-pagination.md)。仓库 [docs/pixai-listGenerationModels-pagination.md](../../../docs/pixai-listGenerationModels-pagination.md) 为同文副本（可选对照）。

---

## 0. 父页面与子页面 `listArtworks` 的衔接

| 步骤 | 接口 | 作用 |
|------|------|------|
| ① | **`listGenerationModels`** | 拉取模型卡片列表（如 `feed: "trending"`）。 |
| ② | **`listArtworks`** | 对某个模型拉作品流；**`variables.loraId`** = ① 里每条边的 **`data.generationModels.edges[].node.id`**（字符串）。 |

子接口的 `isSafeSearch`、`first`、`feed` / `orderBy` 等 **以目标作品页抓包为准**，与父接口的 `feed` 字符串不必相同。

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
| `operation` | 建议 | 与 `operationName` 一致即可，如 `listGenerationModels`。 |
| `operationName` | 建议 | `listGenerationModels`，与 persisted query 及 CSRF 头一致。 |
| `variables` | 是 | **JSON 字符串** 再整体 URL 编码。见下文 [§5 variables](#5-variables-字段)。 |
| `extensions` | 是 | **JSON 字符串** 再整体 URL 编码。见下文 [§6 extensions](#6-extensions-persisted-query)。 |
| `u3t` | 可选 | 浏览器抓包里有时出现；**本接口在常规场景下可不传**。 |

**组装顺序示例（逻辑上）：**

```text
https://api.pixai.art/graphql
  ?operation=listGenerationModels
  &operationName=listGenerationModels
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
| `x-apollo-operation-name` | `listGenerationModels` | 与 `operationName` 一致；同样用于通过 CSRF 校验。 |
| `Origin` | `https://pixai.art` | 与 CORS 一致。 |
| `Referer` | `https://pixai.art/` | 与站点一致。 |
| `User-Agent` | 常见桌面浏览器串 | 降低被简单拦截概率。 |
| `x-browser-id` | 可选 | 抓包中有时存在；无则多数仍可通。 |

**CSRF 错误特征：** 响应 JSON 含 `Cross-Site Request Forgery` / `apollo-require-preflight` 等文案 → 补上 **`Content-Type: application/json`** 或 **`x-apollo-operation-name: listGenerationModels`**。

---

## 4. Cookie / 登录

- **不需要 Cookie。** 按本文组好查询参数与请求头后，即可用普通 HTTP 客户端拉取列表（与实测一致）；无需携带浏览器 `Cookie` 头，也无需登录态。
- 若日后站点策略变更导致未带 Cookie 被拒绝，再按抓包补全即可；当前文档按 **无 Cookie** 描述。
- 合规：仅在你有权访问的数据范围内使用，并遵守站点条款与频率限制。

---

## 5. `variables` 字段

值为 JSON 对象（再 URL 编码）。**第一页**抓包示例：

```json
{
  "feed": "trending",
  "last": 24
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `feed` | 字符串 | 列表类型（如 **`trending`**、**`latest`**、**`meilisearch`**）。与站点 Tab 的对应关系见 [§5.1](#51-四种列表与排序)。 |
| `authorId` | 字符串，可选 | 限定为某位用户的 **模型**列表（个人主页「模型」Tab 抓包）。与全站 **`feed`** 流 **不要混在同一请求里**（以抓包为准：常见 **无 `feed`**，仅有 **`first`**、**`authorId`**、**`orderBy`**）。分页为 **`first` + `after`**，下一页 **`after`** = 上一页 **`pageInfo.endCursor`**，结束看 **`hasNextPage`**。详见 [§5.2](#52-作者页的模型列表-authorid)。 |
| `orderBy` | 字符串，可选 | 显式排序字段。**前缀 `-` = 降序**；**去掉 `-`（或等价无负号字段名）= 升序 / 与站点默认相反的「倒序」**，如 **`markInfo.likedCount`**、**`markInfo.refCount`**、**`createdAt`**。详见 [§5.1](#51-四种列表与排序)。**趋势** 等 Tab 可不传，由服务端决定顺序。 |
| `last` | 整数，可选 | 与 **`before`** 配套：用于 **趋势 / 最新** 等；本页条数常用 **24**。与 **`first`** 以抓包为准二选一，勿混用。 |
| `first` | 整数，可选 | 与 **`after`** 配套：用于 **人气 / 生成人气**（`feed: "meilisearch"`）等；本页条数常用 **24**。 |
| `before` | 字符串，可选 | **`last`** 分页：**第二页及以后（更旧的一批）** = 上一页响应的 **`data.generationModels.pageInfo.startCursor`**。第一页 **不要** 传。 |
| `after` | 字符串，可选 | **`first`** 分页：下一页（更「新」一侧）= 上一页 **`pageInfo.endCursor`**。第一页 **不要** 传。语义与 **`listArtworks`** 的 `after` 一致，以抓包为准。 |

继续翻页时，**除游标字段外**，`feed`（若有）、**`authorId`**（若有）、`orderBy`、`last`/`first` 等须与本流 **完全一致**，否则游标无效或结果错位。

- 使用 **`last` + `before`** 时：向 **更旧** 翻页；下一页游标来源 **`pageInfo.startCursor`**；结束条件常看 **`hasPreviousPage`**（见 §7、§9）。
- 使用 **`first` + `after`** 时：向 **更新** 翻页；下一页游标来源 **`pageInfo.endCursor`**；结束条件常看 **`hasNextPage`**。

与 **`listArtworks`** 的对照（方向相反）：

| 接口 | 分页方向 | 参数 | 下一页游标来源 | 常见结束条件 |
|------|----------|------|----------------|--------------|
| `listArtworks` | 向前 | `first` + `after` | **`pageInfo.endCursor`** | `hasNextPage == false` |
| `listGenerationModels`（`last` 流） | 向后（更旧） | `last` + `before` | **`pageInfo.startCursor`** | `hasPreviousPage == false` |
| `listGenerationModels`（`first` 流） | 向前（更新） | `first` + `after` | **`pageInfo.endCursor`** | `hasNextPage == false`（以实际响应为准） |

### 5.1 四种列表与排序

站点模型列表常见四个 Tab 与抓包变量对应如下。**约定：`orderBy` 带前缀 `-` 为降序（站点常见默认）；去掉 `-` 为升序，即与上述默认相反的「倒序」请求。**

| 站点 Tab | `feed` | `orderBy`（降序 · 默认） | `orderBy`（升序 · 倒序） | 每页条数 | 排序含义（降序） |
|----------|--------|-------------------------|-------------------------|----------|------------------|
| **人气** | `meilisearch` | `-markInfo.likedCount` | `markInfo.likedCount` | `first`: 24 | 点赞相关计数从高到低 |
| **趋势** | `trending` | （不传） | — | `last`: 24 | 服务端内置「趋势」规则，无显式 `orderBy` |
| **生成人气** | `meilisearch` | `-markInfo.refCount` | `markInfo.refCount` | `first`: 24 | 引用/关联热度从高到低（字段语义以服务端为准） |
| **最新** | `latest` | `-createdAt` | `createdAt` | `last`: 24 | 创建时间从新到旧 |

**倒序 / 升序实测说明（无 Cookie GET，与 §6 persisted query 新哈希一致）：**

- **`meilisearch` + `markInfo.likedCount` / `markInfo.refCount`**：接口返回 **200** 且首条 **`node.id`** 与对应降序 **不同**，可视为升序参数被接受且顺序与降序区分明显。
- **`latest` + `createdAt`**：接口 **200**，但曾观测 **首条 `node.id` 与 `-createdAt` 相同**；是否严格按创建时间升序（最旧在前）需结合响应内时间字段或翻页再核对。
- 可用本插件目录下脚本批量对比：**`scripts/verify-listGenerationModels-orderBy.mjs`**（`node ./scripts/verify-listGenerationModels-orderBy.mjs`）。

**说明：**

- **人气** 与 **生成人气** 共用 **`feed: "meilisearch"`**，靠 **`orderBy`** 区分；分页均为 **`first` + `after`**（下一页：`after` = 上一页 **`pageInfo.endCursor`**）。升序、降序流各自保持 **`orderBy` 与分页参数一致**。
- **趋势**、**最新** 使用 **`last` + `before`**（下一页：`before` = 上一页 **`pageInfo.startCursor`**），与全文 §7–§9 示例一致。
- 登录态、**`u3t`**、以及 **`extensions.persistedQuery.sha256Hash`** 以当前站点抓包为准；不同前端版本可能与 §6 示例哈希不同，但上述 **`variables` 结构**仍可用于对照 Tab。

### 5.2 作者页的模型列表（`authorId`）

用户个人页的 **模型** 列表与全站四个 Tab（§5.1）不同：抓包常见 **`listGenerationModels`** 的 `variables` 含 **`authorId`**（作者用户 id 字符串），并配合 **`first`** 与可选 **`orderBy`**（如 **`-createdAt`**），**不传 `feed`**。

| 项目 | 说明 |
|------|------|
| **首屏** | `{"first":<n>,"authorId":"<id>","orderBy":"-createdAt"}`（`orderBy` 以该 Tab 抓包为准，可省略则勿传） |
| **下一页（更「旧」一侧 / 沿列表向下）** | 在首屏变量基础上增加 **`"after": "<上一响应的 pageInfo.endCursor>"`** |
| **结束** | **`hasNextPage == false`** 或 **`endCursor` 为空**（以响应为准） |
| **Persisted query** | 前端可能为「带 `authorId` 的同一 operation」注册 **另一哈希**；若 §6 示例哈希报未知查询，请在 Network 中复制当前请求的 **`extensions`** |
| **登录** | 公网 **无 `Authorization` / Cookie** 时，该流常返回 **`totalCount: 0`、空 `edges`**；与浏览器一致带 **`Bearer`**（及站点要求的 **`u3t`** 等）后再测 |

与 **`listArtworks`** 作者页（`authorId` + **`types`**，见 [pixai-listArtworks-pagination.md §5.3](./pixai-listArtworks-pagination.md)）并列：本接口拉 **模型**，彼接口拉 **作品**。

**校验脚本：** `node ./scripts/verify-listGenerationModels-author-pagination.mjs`（支持 `PIXAI_AUTHORIZATION`、`PIXAI_AUTHOR_ID`、`PIXAI_PQ_HASH`、`PIXAI_AUTHOR_ORDER_BY`、`PIXAI_FIRST`）。

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
    "sha256Hash": "4d76952c681f7d0787077ddeec310f6475ab059e50546248120617abfb4031e9"
  }
}
```

- **`sha256Hash`** 对应操作 **`listGenerationModels`** 的注册查询；**站点升级前端后哈希可能变更**，若出现 GraphQL 层「未知 persisted query」类错误，需在 DevTools → Network 里 **重新复制** `extensions`。
- **作者 `authorId` 流** 抓包中曾出现与上表 **不同** 的哈希（示例：`1658f8e716184e95d3177d20fad189d8f7b250fb30e8401496ed0aaf34e4ad83`）；以你当前页面请求为准。
- `clientLibrary.version` 宜与抓包一致（或与当前站点的 Apollo 版本一致）。

---

## 7. 响应结构（爬取时解析）

- 成功时主体为 JSON，根上常见 **`data`** 与可选 **`errors`**。
- 列表路径：**`data.generationModels.edges`**，每项形如 `{"node": { ... 模型字段含 `id`、`title`、`media` 等 ... }, "cursor": "..."}`。
- 分页：**`data.generationModels.pageInfo`**
  - **`hasPreviousPage`**：是否还有 **更旧** 的一批（继续翻页主要看它）。
  - **`hasNextPage`**：另一侧是否还有数据（父列表场景下常与「向下滚」语义不同，以实际 UI 为准）。
  - **`startCursor`**：本页 **第一条（通常更新 / 更靠前）** 的游标 → **下一页（更旧）请求里 `variables.before`**。
  - **`endCursor`**：本页最后一条游标；在 **`last` + `before`** 流中 **不要**用于 `before` 翻更旧页。在 **`first` + `after`** 流中，下一页 **`variables.after`** 取上一页 **`endCursor`**（与 `listArtworks` 一致）。

若存在 **`errors`**，可能仍有部分 `data`；需根据业务决定重试或记录。

---

## 8. 接缝重复（去重）

用 **`before = 上一页的 startCursor`** 再请求时，**新页最后一条**的 `node.id` 常与 **上一页第一条**的 `id` 相同（边界重复一条）。爬全站时对 **`node.id` 去重** 即可（不保证每次响应都有重叠）。

---

## 9. 伪代码：组 URL、发请求、翻页（更旧方向）

下列为语言无关步骤，实现时用自己环境的 JSON 序列化与 **百分号编码（encodeURIComponent 语义）** 即可。

```text
// 常量
BASE   = "https://api.pixai.art/graphql"
OP     = "listGenerationModels"
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

// 沿「更旧」方向翻完（或直到 hasPreviousPage 为 false）
baseVariables = { feed: "trending", last: 24 }   // 不含 before
beforeCursor = 空

循环:
  variables = 复制(baseVariables)
  若 beforeCursor 非空:
    variables.before = beforeCursor
  body = 拉取一页(variables)
  若 HTTP 失败 或 body.data.generationModels 缺失:
    按策略重试或退出
  对 body.data.generationModels.edges 中每条 edge:
    处理 edge.node（如记录 node.id 供后续 listArtworks 使用）
  pageInfo = body.data.generationModels.pageInfo
  若 pageInfo.hasPreviousPage == false:
    跳出循环
  beforeCursor = pageInfo.startCursor
  若 beforeCursor 为空: 跳出循环
  （可选）sleep，降低 429 风险
```

**注意：** `trending` 会随时间变化；若与历史抓包对比 id 不一致属正常。

---

## 10. `before` 游标（仅作理解，不要手写）

`before` 与 `startCursor` 为 **Base64** 编码的不透明串，内部结构与作品列表的 `after` 类似（常含 **MessagePack** 等），可能嵌入排序键与模型 **`id` 字符串**。**必须由接口返回的 `startCursor` 填入 `variables.before`**，不要自行拼接。

解码调试（可选）：

```bash
echo '<粘贴 startCursor>' | base64 -d | xxd
```

从本插件目录下已保存的响应取下一页游标（路径相对于 `src-crawler-plugins/plugins/pixai/`）：

```bash
jq -r '.data.generationModels.pageInfo.startCursor' ./json/pixai-listGenerationModels-page1-response.json
```

---

## 11. curl 示例（无 Cookie）

先用 **§9 伪代码** 算出完整 `URL`（对 `variables`、`extensions` 做百分号编码后拼进查询串）。下面 **不** 使用 `-b` / `Cookie`：

```bash
curl -sS "$URL" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'x-apollo-operation-name: listGenerationModels' \
  -H 'Origin: https://pixai.art' \
  -H 'Referer: https://pixai.art/' \
  -o models-page1.json
```

**第二页及以后（更旧）：** 在 `variables` 的 JSON 中加入  
`"before": "<上一响应的 pageInfo.startCursor>"`，  
再重新编码并替换 `URL` 中的 `variables=` 段。第三页、第四页同理：**每页**的 `before` 均为 **紧邻的上一页响应** 的 **`pageInfo.startCursor`**（而非 `endCursor`）。

---

## 12. 多页 `variables` 差异小结（与抓包对照）

除 Cookie、`u3t`、AMP 时间戳外，分页差别仅在 `variables`：

| 页 | `variables` 解码后（核心字段） |
|----|-------------------------------|
| 第一页 | `{"feed":"trending","last":24}` |
| 第二页 | 同上，并多 **`"before"`** = 第一页 **`pageInfo.startCursor`** |
| 第三页及以后 | 同上，**`"before"`** = **上一页** **`pageInfo.startCursor`** |

抓包中出现的 `before` 示例（仅说明形态，**以实时响应为准**）：

`gqJpZNcAG6ZL04rbpkKkc29ydJLLQKQ4PvnbItGzMTk5MjM2MzI1NzA5Nzg1NjU3OA==`

---

## 13. 仓库内响应样例（对照）

下列文件为 **无 Cookie** GET 请求的真实 JSON（与 **§11** 头一致），已格式化缩进，可与 **§5 / §7** 对照字段与游标衔接：

| 文件（相对本插件目录） | 说明 |
|------------------------|------|
| `./json/pixai-listGenerationModels-page1-response.json` | `variables`：`{"feed":"trending","last":24}`，无 `before` |
| `./json/pixai-listGenerationModels-page2-response.json` | `variables.before` = 上一文件 `data.generationModels.pageInfo.startCursor` |
| `./json/pixai-listGenerationModels-page3-response.json` | `variables.before` = 上一文件（page2）`data.generationModels.pageInfo.startCursor` |
| `./json/pixai-listArtworks-page1-response.json` | 子接口首屏（对照 `loraId` 与作品字段） |

**说明：** `trending` 实时变化，样例中的 `id` / 游标仅作结构参考；翻页请以你当前响应中的 `pageInfo` 为准。

---

## 14. 相关文档

- 子页面作品列表：**[pixai-listArtworks-pagination.md](./pixai-listArtworks-pagination.md)**（作者 **作品** 流见该文 §5.3）
- 仓库 `docs/` 副本（可选）：**[docs/pixai-listGenerationModels-pagination.md](../../../docs/pixai-listGenerationModels-pagination.md)**
