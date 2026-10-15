// safebooru e2e 用例。经 kabegame-cli 真实链路跑，见 ../../../test/harness.ts。
//
//   deno run -A plugins/safebooru/test/e2e.ts                # 全部非 optional 用例
//   deno run -A plugins/safebooru/test/e2e.ts tags-medium
//
// 列表走 dapi，limit=42 固定，每页恰好 42 条（与网页列表逐条一致），所以单页用例锁死 42。
// 用例都压到 1 页：这是链路验证，不是灌库。
import { defineCases, expectFiles } from "../../../test/harness.ts";

await defineCases("safebooru", [
  {
    // 主路径：两标签 1 页 → 42 条，medium 取 sample，覆盖 JSON + XML 合并与 tag_info 分类。
    name: "tags-medium",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "hakurei_reimu,highres",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ total: 42 }),
  },
  {
    // 空搜索不能传 tags=all（dapi 当真实标签，返回空 body）；第 2 页验证 pid 是页号。
    name: "all-second-page",
    vars: {
      crawl_mode: "all",
      start_page: 2,
      end_page: 2,
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ total: 42 }),
  },
  {
    // 越过 API 直接翻页上限（起始偏移 ≤ 200000，即第 4762 页）：默认排序靠 id:< 游标跳转定位。
    name: "all-beyond-api-cap",
    vars: {
      crawl_mode: "all",
      start_page: 4763,
      end_page: 4763,
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ total: 42 }),
  },
  {
    // 高分榜几乎每页都有带评论的帖子，覆盖详情页评论解析与评论翻页。
    name: "all-sort-score-comments",
    vars: {
      crawl_mode: "all",
      sort_order: "sort:score:desc",
      start_page: 1,
      end_page: 1,
      quality: "medium",
      fetch_comments: true,
    },
    timeout: 1200,
    expect: expectFiles({ total: 42 }),
  },
  {
    // 元标签（含 > = :）要逐 token 编码；high 取原图。原图偏大，只断言下限。
    name: "tags-metatag-high",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "scenery,width:>=1920,height:<=1200",
      sort_order: "sort:score:desc",
      start_page: 1,
      end_page: 1,
      quality: "high",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 35 }),
  },
  {
    // id 范围模式：id:>=/id:<= 闭区间 + sort:id:asc，每页 100 条，101 张跨两页。
    name: "id-range",
    vars: {
      crawl_mode: "id_range",
      id_start: 5000000,
      id_end: 5000100,
      quality: "medium",
    },
    timeout: 1800,
    expect: expectFiles({ total: 101 }),
  },
]);
