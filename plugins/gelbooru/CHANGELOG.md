# Gelbooru 更新日志

## 1.1.0

- 下载时把详情页标签按分类写入应用的「标签」分区：作家、版权、角色、通用、元信息分别位于
  `gelbooru/artist`、`gelbooru/copyright`、`gelbooru/character`、`gelbooru/general`、
  `gelbooru/metadata` 下
- 标签 key 使用站点的规范标签名（如 `hakurei_reimu`），显示名使用页面文字
- 历史下载的图片会通过 `provideLabels` 自动补上标签；没有 `tags` 元数据的图片无法补齐
- 最低应用版本提升至 `4.5.0`
- 移除插件自带的「标签分类 → 标签」PathQL 浏览，统一改用应用级标签画册浏览和筛选

## 1.0.0

首个版本。

- 三种爬取模式：标签、全部、标签列表
- 排序可选最新 / 高分 / 最近更新 / 随机（站点的 `sort:` 元标签）
- 质量分高（原图直链）/ 中（站点 sample），视频帖自动取 `<video>` 里的 mp4 原文件
- **全量标签元数据**：`tags_string` 直接可用作 AI 生图 prompt，侧栏一键复制；
  另存每个标签的分类、作品数和站内链接
- 详情侧栏模板 `description.ejs`：按 作家 / 版权 / 角色 / 通用 / 元信息 分组着色，
  附统计信息
- PathQL provider：画廊里按 标签分类 → 标签 两级浏览已下载的图

祝你使用愉快～
