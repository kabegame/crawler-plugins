# anime-pictures 更新日志

## 0.5.0

- 下载时把作品、角色、画师、参考、物体标签写入应用的「标签」分区（`anime-pictures/copyright`、`anime-pictures/character`、`anime-pictures/artist`、`anime-pictures/reference`、`anime-pictures/object`），可在画册页浏览、在搜索里按标签筛选。
- 标签 key 由英文标签名派生，保留空格与英文括号（如 `sua (alien stage)`），其它符号会被去掉；纯日文等无法派生 key 的标签暂不写入。
- 历史下载的图片会在元数据迁移时自动补上标签。
- 修复爬取时被 Cloudflare 拦截返回 403：`cf_clearance` 与签发它的浏览器 UA 绑定，原先写死的 Windows Chrome/124 UA
  与畅游不一致，导致验证失效。现在改用畅游的 UA（`Kabegame.cefUserAgent()`）和 Cookie（`requireCookie()`，含 HttpOnly 的 `cf_clearance`）发请求。
- 取不到畅游的 UA 或 Cookie 时回退到内置值，并在任务日志中提示；若仍然 403，请先在畅游中打开 anime-pictures 并选择接受cookie。
- 最低应用版本提升至 `4.5.0`。
- 移除插件自带的「标签分组 → 标签」浏览（已由应用级标签取代），画廊插件扩展改为按 **星数 stars**（`5+` … `1000+` 档位，路径段支持区间 `10-50`、`10+`、`-5`）与站点标注的 **主色 color**（如 `palevioletred`）筛选。
