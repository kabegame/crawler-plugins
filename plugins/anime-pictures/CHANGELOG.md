# anime-pictures 更新日志

## 0.4.2

- 修复爬取时被 Cloudflare 拦截返回 403：`cf_clearance` 与签发它的浏览器 UA 绑定，原先写死的 Windows Chrome/124 UA
  与畅游不一致，导致验证失效。现在改用畅游的 UA（`Kabegame.cefUserAgent()`）和 Cookie（`requireCookie()`，含 HttpOnly 的 `cf_clearance`）发请求。
- 取不到畅游的 UA 或 Cookie 时回退到内置值，并在任务日志中提示；若仍然 403，请先在畅游中打开 anime-pictures 并选择接受cookie。
- 最低应用版本提升至 `4.4.1`。
