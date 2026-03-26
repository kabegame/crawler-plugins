# PixAI 爬虫计划：阶段 A / B

本文档归纳公开入口的爬取范围与优先级，对应站点地图中的列表与排行类 URL。阶段 C（详情与资源 URL）及后续不在此展开。

## 阶段 A — 种子与广度

目标：建立可扩展的发现面，从聚合页进入列表流。

| 入口 | URL 要点 | 说明 |
|------|-----------|------|
| 市场 | `https://pixai.art/market` | 主种子；分页/筛选参数以实际接口或页面为准，记入插件配置 |
| 标签 | `https://pixai.art/tags` | 展开标签链，进入各标签列表 |
| 搜索 | `https://pixai.art/search` | 仅在具备明确查询词或标签策略时使用；空搜通常无意义 |

建议顺序：先 `market` 与 `tags` 验证列表数据形态，再按需接入 `search`。

## 阶段 B — 排行榜（定时增量）

目标：按时间维度补充热门作品，适合与阶段 A 去重合并。

**作品排行（图库类任务的主线）：**

- `https://pixai.art/ranking/artwork/today`
- `https://pixai.art/ranking/artwork/weekly`
- `https://pixai.art/ranking/artwork/monthly`

**调度建议：** 首次可做全量或窗口内全量；之后 `today` 可较高频拉取，`weekly` / `monthly` 降低频率。与阶段 A 的列表统一去重（例如作品 id）。

**同阶段的扩展（与 artwork 区分任务类型，勿与「壁纸图」管道混用）：**

- 动图：`/ranking/animated/today|weekly|monthly`（媒体形态可能非静态图）
- 模型：`/ranking/model/today|weekly|monthly`
- LoRA：`/ranking/lora/today|weekly|monthly`

阶段 B 不包含：生成器、会员、登录注册、新闻活动等低发现价值入口；若需单独运营数据再另起任务。
