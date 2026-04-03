# 米游社开放 HTTP 接口备忘（爬虫用）

**第 1～2 节** 在 **`bbs-api.miyoushe.com`**，**第 3 节** 在 **`bbs-api-static.miyoushe.com`**。经 **curl** 探测：**不必带登录 Cookie**，**不必带 `DS`**，也不必带 **`x-rpc-device_id` / `x-rpc-app_version`** 等；**裸 GET** 亦可 `retcode: 0`（HTTP 200）。为贴近浏览器，可为 `fetch_json` 设置 **`User-Agent`** + **`Referer: https://www.miyoushe.com/`**。

---

## 1. 帖子搜索 `searchPosts`

**路径**

```http
GET https://bbs-api.miyoushe.com/painter/wapi/searchPosts
```

**主要 Query**

| 参数 | 必填 | 说明 |
|------|------|------|
| `keyword` | 建议 | 关键词，需 **URL 编码**（例：「壁纸」→ `%E5%A3%81%E7%BA%B8`） |
| `size` | 可选 | 每页条数（测过 `1`、`5`、`20` 等均返回 `retcode: 0`；上限以实际风控为准） |
| `gids` | 可选 | 游戏 ID，与站内 `game_id` 一致。省略时 **全站/多游戏混合**，`list` 内帖子 `game_id` 不一；指定时结果限定在该游戏语境下 |

**响应要点**

- 顶层：`retcode`、`message`、`data`
- `data.list`：帖子项数组（含 `post`、`forum`、`user`、`image_list` 等）
- 含分页相关字段（如 `last_id`、`is_last` 等，以实际 JSON 为准）

**结论**

- **匿名可爬**；Cookie 非必须。
- **`gids` 可省略**；需按游戏筛分时再传。

---

## 2. 帖子回复 `getPostReplies`

**路径**

```http
GET https://bbs-api.miyoushe.com/post/wapi/getPostReplies
```

**主要 Query**

| 参数 | 必填 | 说明 |
|------|------|------|
| `post_id` | 是 | 帖子 ID（字符串数字均可，与站内一致） |
| `size` | 建议 | 每页条数 |
| `order_type` | 视站方 | 例：`1`（与抓包一致；具体枚举以官方为准） |
| `is_hot` | 可选 | `true` / `false`。**`false`**：常规顺序列表（如按楼层时间）；**`true`**：热评/高热筛选，**条数与顺序会与 `false` 不同**（帖内评论少时可能只返回部分） |
| `gids` | 可选 | 游戏 ID。对固定 `post_id` 的探测中，**省略 `gids` 与带上正确 `gids` 结果一致**；其它场景建议与帖子所属游戏一致以防边界问题 |

**响应要点**

- `data.list`：回复项（`reply`、`user`、`images`、`sub_replies` 等）
- `total_reply_num`、`last_id`、`is_last` 等分页与统计字段

**结论**

- **匿名可爬**；Cookie 非必须。
- **`is_hot` 语义与列表强相关**，需「全部楼层」用 `false`，需「热评」用 `true`。

---

## 3. 表情套装列表 `emoticon_set`

**路径**

```http
GET https://bbs-api-static.miyoushe.com/misc/api/emoticon_set
```

**主要 Query**

| 参数 | 必填 | 说明 |
|------|------|------|
| `gids` | 可选 | 例：`gids=8`。探测下 **带与不带 `gids` 常返回同一大套配置**；仍可与当前帖子/游戏的 `game_id` 对齐传参 |

**响应结构（摘要）**

- 顶层：`retcode`、`message`、`data`。
- `data.list`：**数组**，每一项表示一个 **分组/套装**（如「米游兔」等），常见字段包括：
  - `id`、`name`、`icon`、`sort_order`、`num`、`status`（如 `published` / `draft`）、`is_available`
  - **`list`**：**子项数组**。若为空 `[]`，表示该分组下暂无表情。
- **子项**（叶子一层，与抓包一致）：`id`、`name`、`icon`、`sort_order`、`static_icon`、`updated_at`、`is_available`、`status`、`keywords`（多为 `[]`）。子项一般 **不再嵌套** `list`；若站方将来增加多级目录，可按树形递归解析。
- 单响应体积 **很大**（约 **数 MB**），整包格式化写入磁盘时注意内存与耗时。

**结论**

- **匿名可爬**；无需 Cookie、**无需 `DS`**、无需 `x-rpc-*`；**裸 GET** 亦可。
- **`gids` 可省略**。

---

## 4. 帖子详情 `getPostFull`

**路径**

```http
GET https://bbs-api.miyoushe.com/post/wapi/getPostFull
```

**主要 Query**

| 参数 | 必填 | 说明 |
|------|------|------|
| `post_id` | 是 | 帖子 ID |
| `gids` | 可选 | 与帖子 `post.game_id` 对齐传参；匿名探测下 **不带 `gids` 也能 `retcode=0`** |
| `read` | 可选 | 示例为 `read=1`；匿名探测下 **不带 `read` 也能 `retcode=0`** |

**返回要点（常用字段摘要）**

- 顶层：`retcode`、`message`、`data`
- `data.post.post`：帖子核心对象（常见字段包括 `game_id`、`post_id`、`f_forum_id`、`uid`、`subject`、`content`、`cover`、`images`、`view_type`、`created_at`、`topic_ids`、`is_original` 等）
  - `content` 通常是一个 **字符串化 JSON**（例如内含 `imgs: [...]`），配合 `images` 字段可直接得到图片链接列表
- `data.post.forum`：所属分区
- `data.post.topics`：话题数组
- `data.post.user`：发帖用户信息
- `data.post.stat`：浏览/回复/点赞/转发等统计信息
- 其它：`collection`、`challenge`、`hot_reply_list` 等也可能存在（以实际返回为准）

**结论**

- **匿名可爬**；无需 Cookie、**无需 `DS`**；`gids` / `read` 均可省略（但建议按业务需要与帖子 `game_id` 对齐传参）。

---

## 5. 用户帖子列表 `userPostList`

**路径**

```http
GET https://bbs-api.miyoushe.com/painter/wapi/userPostList
```

**主要 Query**

| 参数 | 必填 | 说明 |
|------|------|------|
| `uid` | 是 | 用户 UID |
| `size` | 建议 | 每页条数，抓包常见 `20` |
| `offset` | 翻页时必填 | 下一页游标；第一页不传 |

**翻页要点**

- 第一页示例：`?size=20&uid=389769816`
- 第二页示例：`?offset=73376481&size=20&uid=389769816`
- `offset` 建议优先取响应中的分页字段（如 `next_offset`/`offset`），缺失时可兜底取上一页末条 `post_id`（与你提供样例一致）。

**接口探测结论（2026-04-03，本地 bun 实测）**

- `GET .../userPostList?size=20`（不带 `uid`）：
  - HTTP `200`
  - `retcode = -100`
  - `message = "not login"`
- `GET .../userPostList?size=20&uid=`（空 uid）：
  - HTTP `200`
  - `retcode = -100`
  - `message = "not login"`
- `GET .../userPostList?size=20&uid=389769816`：
  - HTTP `200`
  - `retcode = 0`
  - `message = "OK"`
  - `data` 含 `is_last` / `next_offset` / `list`

=> 结论：该接口对当前策略下 **必须提供有效 `uid`**；不带 `uid` 会被判定为未登录。

**请求头 / 鉴权要点**

- 该接口在不同时间段风控可能不同。
- 建议按浏览器抓包携带：`Cookie`、`DS`、`x-rpc-app_version`、`x-rpc-client_type`、`x-rpc-device_id`、`x-rpc-device_fp`。
- 脚本里请通过**环境变量**传入，不要把真实凭证写入仓库文件。

**脚本（已提供，已用 bun 实测）**

文件：`src-crawler-plugins/plugins/miyoushe/scripts/fetch-user-post-list.mjs`

```bash
# 自动抓两页（第二页 offset 自动推导）
bun src-crawler-plugins/plugins/miyoushe/scripts/fetch-user-post-list.mjs --uid 389769816

# 调整页面大小（可调参数）
bun src-crawler-plugins/plugins/miyoushe/scripts/fetch-user-post-list.mjs --uid 389769816 --size 10

# 手动指定第二页 offset
bun src-crawler-plugins/plugins/miyoushe/scripts/fetch-user-post-list.mjs --uid 389769816 --offset 73376481

# 需要鉴权时（示例）
MYS_COOKIE="cookie_token=...; account_id=...;" \
MYS_DS="1775213364,xxxx,xxxxxxxx" \
MYS_DEVICE_ID="9a215eab-b4c7-43a2-9ee6-bca0c4fe7d76" \
MYS_DEVICE_FP="38d81728d34a6" \
MYS_APP_VERSION="2.102.0" \
MYS_CLIENT_TYPE="4" \
bun src-crawler-plugins/plugins/miyoushe/scripts/fetch-user-post-list.mjs --uid 389769816
```

**可调参数**

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--uid` | 是 | 无 | 用户 UID；不传会直接报错 `缺少参数 --uid`（且接口层也会返回 `retcode=-100, not login`） |
| `--size` | 否 | `20` | 页面大小（每页条数） |
| `--offset` | 否 | 自动推导 | 指定第二页游标；不传则从第一页响应推导 |

**本地实测（bun）**

- `bun ... --uid 389769816`：成功写入两页，第二页 offset=`73376481`
- `bun ... --uid 389769816 --size 10`：成功写入两页，第二页 offset=`73922761`
- `bun ...`（去掉 `--uid`）：报错 `缺少参数 --uid`
- **不带 Cookie（仅 `uid` + 基础请求头）稳定性测试**：连续 8 次请求均成功（`8/8`），未出现失败

脚本输出到：`src-crawler-plugins/plugins/miyoushe/json/`

- `userPostList-uid_<uid>-p1.json`
- `userPostList-uid_<uid>-p2-offset_<offset>.json`

---

## 安全与合规

- 勿将 **Cookie / `ltoken` / `cookie_token`** 写入仓库或公开文档。
- 请求频率与用途需遵守站点规则与当地法规；接口行为可能随站方策略变更，以线上为准。

---

## 与本插件其它能力

- **`bbs-api-static`**：分区 **`game_id`**、**「同人图」子版 `forum_id`** 见 `getAllGamesForums`（插件内 `crawl.rhai`、`json/` 样例）；表情元数据见 **第 3 节 `emoticon_set`**。
- 与 **`bbs-api`** 上 **第 1～2 节** 同属米游社 BBS 体系，可组合使用（注意 **static** / **bbs-api** 域名不同）。
