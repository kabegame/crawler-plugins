# 小黑盒（Heybox）Web API 说明

本目录文档描述从 `www.xiaoheihe.cn` 前端访问 `api.xiaoheihe.cn` 时，**列表类接口**（返回 `items` 或等价列表）的调用与签名规则，供爬虫或工具对接时参考。

详细规则见：**[items-api.md](./items-api.md)**。

## 文档索引

| 文档 | 内容 |
|------|------|
| [items-api.md](./items-api.md) | 公共参数、`_time` / `nonce` / `hkey` 算法、路径规范化、列表/搜索/评论树等接口及响应说明；**第 10 节：无 Cookie 爬取要点与流程（`share_url` → `link_id` → `tree` → 图 URL）** |
| [tree.md](./tree.md) | `link/tree` 请求方式、`link_id` 来源、与本地 `tree.json` / `tree-text.json` 样例说明 |

## 实现参考

本目录验证脚本（非产品依赖）：

- [`scripts/xhh-sign-test.mjs`](./scripts/xhh-sign-test.mjs) — Web 端 `hkey` / `nonce` 自检  
- [`scripts/replay-search-tree.mjs`](./scripts/replay-search-tree.mjs) — 搜索 / tree 重放与无 Cookie 等对照

## 声明

- 接口与校验策略可能变更，以线上行为为准。
- 请遵守小黑盒服务条款与 robots/合理使用要求；本文档仅作技术说明。
