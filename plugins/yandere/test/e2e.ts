// yande.re e2e 用例。经 kabegame-cli 真实链路跑，见 ../../../test/harness.ts。
//
//   deno run -A plugins/yandere/test/e2e.ts                # 全部非 optional 用例
//   deno run -A plugins/yandere/test/e2e.ts tags-basic
//
// 站点列表每页固定 40 条（未登录时 URL 上没有可用的每页条数参数），所以单页用例
// 可以锁死 40。
// 用例都刻意压到 1 页：这是链路验证，不是灌库。
import { defineCases, expectFiles } from "../../../test/harness.ts";

await defineCases("yandere", [
  {
    // 主路径：两标签检索 1 页 → 40 条。
    // 这条同时覆盖 DOM 解析（列表 → 详情）、原文件直链和侧栏标签 / 评论区元数据。
    //
    // 只断言下限：这个站的原文件普遍 4~8MB（大图几十 MB），走代理时几张会传不完，
    // 下载器重试 3 次后放弃，日志里是 taskLogDownloadRetry「end of file before
    // message length reached」。实测同一条用例重跑时 40 张全部命中去重（失败 0），
    // 说明解析没问题、是带宽问题，所以「恰好 40」的严格断言放在下面的 medium 用例上。
    name: "tags-basic",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "genshin_impact,bikini",
      start_page: 1,
      end_page: 1,
      quality: "high",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 35 }),
  },
  {
    // medium 质量走 #image 的 sample，验证质量分流没走串。
    name: "tags-medium-quality",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "hatsune_miku",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ total: 40 }),
  },
  {
    // 全站最新 + 分级过滤：验证不带用户标签时 rating: 元标签能独立成搜索串。
    name: "all-safe-rating",
    vars: {
      crawl_mode: "all",
      rating: "safe",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ total: 40 }),
  },
  {
    // order: 元标签拼进搜索串，验证排序选项真的改了结果集。
    name: "tags-sort-score",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "kantai_collection",
      sort_order: "order:score",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ total: 40 }),
  },
  {
    // 排行榜：往期日榜 2 期 + 分级过滤。榜单页不接受 tags，分级靠页面脚本 Post.register 里的
    // rating 在插件内筛。往期榜单内容固定，但具体张数取决于当期分级构成，只断言下限。
    // 2026-10 实测 2026-09-01 / 08-31 两期的 Questionable 分别是 27 / 21 张。
    name: "popular-day-questionable",
    vars: {
      crawl_mode: "popular",
      popular_scale: "day",
      popular_date: "2026-09-01",
      popular_periods: 2,
      rating: "questionable",
      quality: "medium",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 40 }),
  },
]);
