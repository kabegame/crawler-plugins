# 帖子「树」接口与本地样例

## 本地文件说明

一个帖子的完整接口返回示例见 [tree.json](./tree.json)。

主要和图片相关的信息放在 [tree-text.json](./tree-text.json) 里 **`type` 为 `img`** 的条目的 **`url`**；该 URL 去掉 `?` 后的查询参数即为更接近原图的地址（按小黑盒 CDN 规则处理）。

---

## 如何请求 `GET /bbs/app/link/tree`

与 [items-api.md](./items-api.md) 中其它 Web 接口相同，必须在查询串中携带自洽的 **`hkey`、`nonce`、`_time`**，以及公共参数（`os_type=web`、`app=heybox`、`device_id` 等），详见该文档第 2、3 节。

| 项目 | 说明 |
|------|------|
| **URL** | `https://api.xiaoheihe.cn/bbs/app/link/tree` |
| **签名用路径** | 规范化后为 **`/bbs/app/link/tree/`**（用于计算 `hkey`，与 URL pathname 一致） |
| **`link_id`** | 与列表中的帖子 id 对应：可为 **`result.items[].info.linkid`（数值）**，或综合搜索里 **`info.share_url`** 查询参数中的 **`link_id`（多为 12 位 hex）**；后者与分享链路一致，**可不传 `h_src`**。爬取步骤见 [items-api.md](./items-api.md) 第 10 节。 |
| **其它常见参数** | `h_src`（可为空）、`is_first`、`page`、`index`、`limit`、`owner_only` 等，与浏览器抓包一致即可 |
| **请求头** | 建议带 `Origin: https://www.xiaoheihe.cn`、`Referer: https://www.xiaoheihe.cn/`、桌面 Chrome 系 `User-Agent` |

生成 `hkey` 时，将签名脚本里的路径改为 **`/bbs/app/link/tree`**（或上述规范化路径），再拼入当前秒级 `_time` 与随机 `nonce`。可参考 [scripts/xhh-sign-test.mjs](./scripts/xhh-sign-test.mjs) 中 `computeHkey` / `computeNonce` 的用法。

**注意**：仅合法签名、**不带 Cookie** 时，服务端可能返回 **`status: "show_captcha"`** 且 **`result` 为空**，需验证码或登录态才能拿到与 [tree.json](./tree.json) 类似的正文；以线上行为为准。
