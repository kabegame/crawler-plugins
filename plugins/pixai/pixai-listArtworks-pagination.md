# PixAI `listArtworks` 接口爬取说明

本文说明如何通过 HTTP 稳定调用 PixAI 站点使用的 GraphQL 接口 **`listArtworks`**（作品列表，Relay 游标分页：`first` + `after`）。实现爬虫、插件或离线脚本时按下列顺序组请求即可。**按标签（Tag）爬取**时变量用 **`tackId`**，要点见 **§5.1**。

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
| `loraId` | 字符串 | LoRA / 模型相关 id；**模型作品流** 与页面上下文一致时使用（与 `tackId` 一般不同时出现，**以抓包为准**）。 |
| `tackId` | 字符串 | **标签（Tag/Tack）** id；**标签作品流** 与页面上下文一致时使用。分页规则与 `loraId` 流完全相同。 |
| `isSafeSearch` | 布尔 | 是否安全搜索过滤。 |
| `first` | 整数 | 本页条数（每页最多多少条由服务端限制，常用 24）。 |
| `feed` | 字符串 | 流类型，如 `trending1`；不同入口可能不同，**以抓包为准**。 |
| `after` | 字符串，可选 | **第二页及以后**：上一页返回的 **`data.artworks.pageInfo.endCursor`**。第一页 **不要** 传。 |

翻页时 **除新增/更新 `after` 外，其余过滤条件必须与本流一致**，否则游标无效或结果错位。

### 5.1 按 Tag（标签）爬取要点

- **与模型流的唯一区别在 `variables` 主键**：标签页、按标签浏览作品时，抓包中为 **`tackId`**（字符串），而不是 **`loraId`**。`isSafeSearch`、`first`、`feed` 等与入口一致即可；**Relay 分页**仍是首屏不传 `after`，之后每页 **`after` = 上一响应的 `data.artworks.pageInfo.endCursor`**（见 §7、§8），不要手写游标（§9）。
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
- `clientLibrary.version` 宜与抓包一致（或与当前站点的 Apollo 版本一致）。

---

## 7. 响应结构（爬取时解析）

- 成功时主体为 JSON，根上常见 **`data`** 与可选 **`errors`**。
- 列表路径：**`data.artworks.edges`**，每项形如 `{"node": { ... 作品字段 ... }, "cursor": "..."}`。
- 分页：**`data.artworks.pageInfo`**
  - **`hasNextPage`**：是否还有下一页。
  - **`endCursor`**：下一页请求里 **`variables.after`** 的值。
  - **`startCursor`**：本页第一条游标（一般向前翻页用 `endCursor` 即可）。

若存在 **`errors`**，可能仍有部分 `data`；需根据业务决定重试或记录。

---

## 8. 伪代码：组 URL、发请求、翻页

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

// 全量翻页（标签流将 loraId 换为 tackId，其余相同）
baseVariables = { loraId 或 tackId, isSafeSearch, first, feed }   // 不含 after
cursor = 空

循环:
  variables = 复制(baseVariables)
  若 cursor 非空:
    variables.after = cursor
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
