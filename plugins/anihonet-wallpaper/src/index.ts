// @ts-nocheck
// anihonet V8 爬虫入口。
//
// 模块分工：
//   runtime   Kabegame 页面桥、HTML 解析与 URL 工具
//   metadata  详情页 metadata 与标签分类
//   detail    详情页图片命名、过滤和下载
//   series    作品列表分页与单作品抓取
//   ranking   排行榜分页
//   theme     作品标题一览中的主题检索
import { crawlKind } from "./ranking";
import { DEFAULT_BASE_URL, coerceStr } from "./runtime";
import { crawlAnimeSeries } from "./series";
import { crawlThemeFromIndex } from "./theme";

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
    await crawlAnimeSeries(`${baseUrl}/${workSlug}`, 100.0, "single", 1, 1, 1, 0, baseUrl);
  } else if (vars.crawl_mode === "by_theme") {
    await crawlThemeFromIndex(
      vars.theme_search,
      Number(vars.theme_start_page ?? 1),
      Number(vars.theme_end_page ?? 1),
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
    console.log("错误：crawl_mode 必须是 ranking、single_work 或 by_theme");
  }
}
