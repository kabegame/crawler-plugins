// danbooru e2e 用例。经 kabegame-cli 真实链路跑，见 ../../../test/harness.ts。
//
//   deno run -A plugins/danbooru/test/e2e.ts                # 全部非 optional 用例
//   deno run -A plugins/danbooru/test/e2e.ts tags-basic
//
// 站点内容天天变，所以除 popular（固定 20 条/页）外都只断言下限，不锁死总数。
// 用例都刻意压到 1 页 / 少量条目：这是链路验证，不是灌库。
import { defineCases, expectFiles } from "../../../test/harness.ts";

await defineCases("danbooru", [
  {
    // 主路径：两标签检索 1 页，per_page=20 → 20 条。
    // 这条同时覆盖 DOM 解析（列表 → 详情）、原图直链和全量 tag 元数据。
    name: "tags-basic",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "touhou",
      per_page: "20",
      start_page: 1,
      end_page: 1,
      quality: "high",
    },
    timeout: 900,
    expect: expectFiles({ total: 20 }),
  },
  {
    // medium 质量走 #image 的 sample，验证质量分流没走串。
    name: "tags-medium-quality",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "hakurei_reimu",
      per_page: "20",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 900,
    expect: expectFiles({ minTotal: 15 }),
  },
  {
    // 人气榜是独立的 URL 形态（/explore/posts/popular），单独覆盖。
    name: "popular-day",
    vars: {
      crawl_mode: "popular",
      popular_scale: "day",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 900,
    expect: expectFiles({ total: 20 }),
  },
  {
    // 全站最新：验证不带 tags 的列表 URL。
    name: "all-first-page",
    vars: {
      crawl_mode: "all",
      per_page: "20",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 900,
    expect: expectFiles({ total: 20 }),
  },
  {
    // 标签列表模式：/tags 解析 + 逐标签抓 1 页。取 2 个标签，每个 1 页 20 条。
    name: "tag-list-genshin",
    vars: {
      crawl_mode: "tag_list",
      tag: "*genshin*",
      mode_tag_type: "4",
      mode_tag_order: "count",
      mode_tag_skip: 0,
      mode_tag_count: 2,
      mode_tag_pages: 1,
      per_page: "20",
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ minTotal: 20 }),
  },
  {
    // safebooru 镜像：DOM 同构，验证源站切换真的换了 host。
    name: "safebooru-tags",
    vars: {
      source_site: "safebooru",
      crawl_mode: "tags",
      mode_tag_value: "kirisame_marisa",
      per_page: "20",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 900,
    expect: expectFiles({ minTotal: 15 }),
  },
]);
