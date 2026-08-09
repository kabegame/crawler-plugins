// bilibili（专栏 / 图文）e2e 用例。经 kabegame-cli 真实链路跑，见 ../../../test/harness.ts。
//
//   deno run -A plugins/bilibili/test/e2e.ts                # 全部非 optional 用例
//   deno run -A plugins/bilibili/test/e2e.ts opus-album-livephoto
//
// 样例帖来自 gallery-dl 测试集（ignore/gallery-dl/test/results/bilibili.py），
// 内容形态稳定；若样例被删除会表现为「总产出 0」，届时需换帖。
import { defineCases, expectFiles, expectSuccess } from "../../../test/harness.ts";

await defineCases("bilibili", [
  {
    // 正文段落型实况图（live_url 直接在 INITIAL_STATE 里）：1 静态 + 1 视频。
    name: "opus-single-livephoto",
    vars: { mode: "single", cv_id_or_url: "https://www.bilibili.com/opus/1154738799821979656" },
    expect: expectFiles({ total: 2, exts: { ".jpg": 1, ".mp4": 1 } }),
  },
  {
    // 相册型实况图（HTML 不下发 live_url，走 detail API 补拉）：5 静态 + 5 视频。
    name: "opus-album-livephoto",
    vars: { mode: "single", cv_id_or_url: "https://www.bilibili.com/opus/1172711958019833880" },
    expect: expectFiles({ total: 10, exts: { ".jpg": 5, ".mp4": 5 } }),
  },
  {
    // UP 主图文批量（碧诗 uid=2，动态多为单图/文字，取 3 篇至少出 1 个文件）。
    name: "space-feed",
    vars: { mode: "space", mid: "2", max_articles: 3 },
    timeout: 900,
    expect: expectFiles({ minTotal: 1 }),
  },
  {
    // 传统 cv 专栏关键词搜索 1 页。风控敏感（-412/-352），默认跑但失败不置败。
    name: "search-cv",
    vars: { mode: "search", keyword: "壁纸", start_page: 1, end_page: 1 },
    timeout: 900,
    optional: true,
    expect: expectFiles({ minTotal: 1 }),
  },
  {
    // 登录账号的图文收藏：依赖畅游已登录 bilibili 且收藏非空。
    name: "favlist",
    vars: { mode: "favlist", max_articles: 2 },
    optional: true,
    expect: expectSuccess(),
  },
]);
