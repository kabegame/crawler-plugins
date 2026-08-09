// bilibili-video e2e 用例。经 kabegame-cli 真实链路跑，见 ../../../test/harness.ts。
//
//   deno run -A plugins/bilibili-video/test/e2e.ts             # 全部非 optional 用例
//   deno run -A plugins/bilibili-video/test/e2e.ts bangumi-ep
//
// 视频体积大，所有用例固定 360P（max_quality=16）控制流量；两个下载用例
// 合计约 100 MB。样例：Bad Apple!! 影绘 PV（经典稳定稿件）与悠久之翼2（免费番剧）。
import { defineCases, expectFiles } from "../../../test/harness.ts";

await defineCases("bilibili-video", [
  {
    // UGC 单视频：view → wbi playurl → DASH 合流入库。
    name: "ugc-single",
    vars: { mode: "single", video: "BV1xx411c79H", max_quality: "16" },
    expect: expectFiles({ total: 1, exts: { ".mp4": 1 } }),
  },
  {
    // 番剧单集（免费集）：PGC playurl，无 WBI。
    name: "bangumi-ep",
    vars: { mode: "bangumi", bangumi_url: "ep21484", max_quality: "16" },
    expect: expectFiles({ total: 1, exts: { ".mp4": 1 } }),
  },
  {
    // 番剧整季 + 会员集跳过：鬼灭 ss26801 前 2 集，第 1 集免费入库、
    // 第 2 集大会员专享应跳过（若测试环境是大会员则会下 2 个，故用 minTotal）。
    name: "bangumi-season-gate",
    vars: {
      mode: "bangumi",
      bangumi_url: "https://www.bilibili.com/bangumi/play/ss26801",
      max_videos: 2, max_quality: "16", interval: 5,
    },
    timeout: 900,
    expect: expectFiles({ minTotal: 1 }),
  },
  {
    // 番剧 md 剧集页 → season 换算路径（CAROLE & TUESDAY 第 1 集免费）。
    name: "bangumi-md",
    vars: { mode: "bangumi", bangumi_url: "md24097891", max_videos: 1, max_quality: "16" },
    optional: true,
    expect: expectFiles({ total: 1, exts: { ".mp4": 1 } }),
  },
  {
    // UP 主投稿列表。space 接口风控严，默认不跑。
    name: "space-list",
    vars: { mode: "space", mid: "3985676", max_videos: 1, max_quality: "16" },
    optional: true,
    expect: expectFiles({ minTotal: 1 }),
  },
]);
