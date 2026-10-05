// @ts-nocheck
// anihonet V8 爬虫入口。
//
// 模块分工：
//   runtime   Kabegame 页面桥、HTML 解析与 URL 工具
//   metadata  详情页 metadata 与标签分类
//   detail    详情页图片命名、过滤和下载
//   series    作品列表分页与单作品抓取
//   ranking   排行榜分页
//   search    站内关键词搜索与分页
import { crawlKind } from "./ranking";
import { DEFAULT_BASE_URL, coerceStr } from "./runtime";
import { crawlSearch } from "./search";
import { crawlAnimeSeries } from "./series";

const { addProgress } = Kabegame;

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = common?.baseUrl || DEFAULT_BASE_URL;
  const type = vars.wallpaper_type === "img-pc" ? "imgpc" : coerceStr(vars.wallpaper_type || "all");
  if (!["all", "sp", "image", "imgpc", "pc"].includes(type)) {
    console.log("错误：wallpaper_type 必须是 all/sp/image/imgpc/pc");
    return;
  }

  if (vars.crawl_mode === "single_work") {
    const workSlug = coerceStr(vars.selected_work);
    if (!workSlug) {
      addProgress(100.0);
      return;
    }
    await crawlAnimeSeries(
      `${baseUrl}/${workSlug}`,
      100.0,
      "single",
      1,
      1,
      vars.work_start_page == null ? 1 : Number(vars.work_start_page),
      vars.work_end_page == null ? 0 : Number(vars.work_end_page),
      baseUrl,
    );
  } else if (vars.crawl_mode === "search") {
    await crawlSearch(
      vars.search_query,
      vars.search_order,
      vars.search_orderby,
      Number(vars.search_start_page ?? 1),
      Number(vars.search_end_page ?? 1),
      baseUrl,
    );
  } else if (vars.crawl_mode === "ranking") {
    await crawlKind(
      type,
      Number(vars.start_page ?? 1),
      Number(vars.end_page ?? 1),
      coerceStr(vars.ranking_period || "daily"),
      baseUrl,
    );
  } else {
    console.log("错误：crawl_mode 必须是 ranking、single_work 或 search");
  }
}
