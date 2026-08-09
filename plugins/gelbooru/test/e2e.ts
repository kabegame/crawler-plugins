// gelbooru e2e 用例。经 kabegame-cli 真实链路跑，见 ../../../test/harness.ts。
//
//   deno run -A plugins/gelbooru/test/e2e.ts                # 全部非 optional 用例
//   deno run -A plugins/gelbooru/test/e2e.ts tags-basic
//
// 站点列表每页固定 42 条（匿名下 URL 的 limit 参数无效，那是账号设置项），
// 所以单页用例可以锁死 42；标签列表模式条目数随站点内容浮动，只断言下限。
// 用例都刻意压到 1 页：这是链路验证，不是灌库。
import { defineCases, expectFiles } from "../../../test/harness.ts";

await defineCases("gelbooru", [
  {
    // 主路径：两标签检索 1 页 → 42 条。
    // 这条同时覆盖 DOM 解析（列表 → 详情）、原图直链和全量 tag 元数据。
    //
    // 只断言下限：absurdres 的 PNG 原图常有 20~40MB（实测单张 31.8MB），
    // 走代理时几张大图会传不完，下载器报「文件格式不受支持（infer）」。
    // 这是带宽问题不是解析问题，所以「恰好 42」的严格断言放在下面的 medium 用例上。
    name: "tags-basic",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "touhou,absurdres",
      start_page: 1,
      end_page: 1,
      quality: "high",
    },
    timeout: 1200,
    expect: expectFiles({ minTotal: 35 }),
  },
  {
    // medium 质量走 img#image 的 sample，验证质量分流没走串。
    name: "tags-medium-quality",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "hakurei_reimu",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ total: 42 }),
  },
  {
    // 全站最新：验证 tags=all 的列表 URL 与 pid 偏移分页（第 2 页 pid=42）。
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
    // sort: 元标签拼进搜索串，验证排序选项真的改了结果集。
    // 高分榜里混着视频帖（要走 FFmpeg 转兼容副本），慢且偶有失败，所以只断言下限。
    name: "tags-sort-score",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "kirisame_marisa",
      sort_order: "sort:score:desc",
      start_page: 1,
      end_page: 1,
      quality: "medium",
    },
    timeout: 1200,
    expect: expectFiles({ minTotal: 30 }),
  },
  {
    // 视频帖：<video> 的 mp4 source 而不是 img#image，单独覆盖这条分支。
    name: "video-posts",
    vars: {
      crawl_mode: "tags",
      mode_tag_value: "video",
      start_page: 1,
      end_page: 1,
      quality: "high",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 30 }),
  },
  {
    // 标签列表模式：/index.php?page=tags 解析 + 按分类过滤 + 逐标签抓 1 页。
    // 取 2 个角色标签，每个 1 页 42 条。
    name: "tag-list-genshin",
    vars: {
      crawl_mode: "tag_list",
      tag: "*genshin*",
      mode_tag_type: "character",
      mode_tag_order: "count",
      mode_tag_skip: 0,
      mode_tag_count: 2,
      mode_tag_pages: 1,
      quality: "medium",
    },
    timeout: 1800,
    expect: expectFiles({ minTotal: 60 }),
  },
]);
