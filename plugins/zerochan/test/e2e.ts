// zerochan e2e 用例。经 kabegame-cli 真实链路跑，见 ../../../test/harness.ts。
//
//   deno run -A plugins/zerochan/test/e2e.ts                # 全部非 optional 用例
//   deno run -A plugins/zerochan/test/e2e.ts tag-recent
//
// 站点列表每页 48 条，但**匿名访问看不全**（页尾写着 "Some images on this page are
// for members only"），实际可见条目每页浮动在 40 上下，所以一律只断言下限。
// 用例都压到 1 页：这是链路验证（bot 校验 → 列表 → 详情 → 原图），不是灌库。
import { defineCases, expectFiles } from "../../../test/harness.ts";

await defineCases("zerochan", [
  {
    // 主路径：单标签 + 最新排序。覆盖 xbotcheck 过闸、列表解析、详情原图直链和全量侧栏元数据。
    name: "tag-recent",
    vars: {
      crawl_mode: "tag",
      tag: "Arknights",
      sort_order: "id",
      start_page: 1,
      end_page: 1,
      quality: "high",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 30 }),
  },
  {
    // 人气排序：验证 ?s=fav 真的换了结果集（跟上一条同标签但内容不同）。
    name: "tag-popular",
    vars: {
      crawl_mode: "tag",
      tag: "Hatsune Miku",
      sort_order: "fav",
      start_page: 1,
      end_page: 1,
      quality: "high",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 30 }),
  },
  {
    // 全站浏览：不带标签的 /?s=id&p=N，顺带验证第 2 页的 offset 没走串。
    name: "all-second-page",
    vars: {
      crawl_mode: "all",
      sort_order: "id",
      start_page: 2,
      end_page: 2,
      quality: "medium",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 30 }),
  },
  {
    // 搜索：/search?q= 会 302 到最匹配的标签页并保留 q= 做组合过滤，
    // 这条验证跟随重定向后仍能解析出列表。
    name: "search-multi-word",
    vars: {
      crawl_mode: "search",
      search_query: "blue hair smile",
      sort_order: "fav",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 30 }),
  },
]);
