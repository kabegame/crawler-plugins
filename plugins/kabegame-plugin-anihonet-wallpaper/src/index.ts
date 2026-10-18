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
import { t } from "./i18n";
import { DEFAULT_BASE_URL, coerceStr } from "./runtime";
import { crawlSearch } from "./search";
import { crawlAnimeSeries } from "./series";

const { addProgress } = Kabegame;

// 宿主 common 提供 baseUrl（见 @kabegame/types 的 KbCommonCfg）。
type AnihonetCommon = { baseUrl?: string | null } | null | undefined;

// 配置字段来自 GUI（可能有类型）或 CLI --var（一定是字符串），统一按 unknown 收窄。
type AnihonetVars = {
  crawl_mode?: unknown;
  wallpaper_type?: unknown;
  selected_work?: unknown;
  work_start_page?: unknown;
  work_end_page?: unknown;
  search_query?: unknown;
  search_order?: unknown;
  search_orderby?: unknown;
  search_start_page?: unknown;
  search_end_page?: unknown;
  start_page?: unknown;
  end_page?: unknown;
  ranking_period?: unknown;
};

export async function crawl(
  common: AnihonetCommon,
  custom: AnihonetVars | null | undefined,
): Promise<void> {
  const vars = custom || {};
  // 模式下拉被清空时（null）按默认的排行榜模式处理
  const mode = vars.crawl_mode ?? "ranking";
  const baseUrl = common?.baseUrl || DEFAULT_BASE_URL;
  const type = vars.wallpaper_type === "img-pc" ? "imgpc" : coerceStr(vars.wallpaper_type || "all");
  if (!["all", "sp", "image", "imgpc", "pc"].includes(type)) {
    console.log(t("invalidWallpaperType"));
    return;
  }

  if (mode === "single_work") {
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
  } else if (mode === "search") {
    await crawlSearch(
      vars.search_query,
      vars.search_order,
      vars.search_orderby,
      Number(vars.search_start_page ?? 1),
      Number(vars.search_end_page ?? 1),
      baseUrl,
    );
  } else if (mode === "ranking") {
    await crawlKind(
      type,
      Number(vars.start_page ?? 1),
      Number(vars.end_page ?? 1),
      coerceStr(vars.ranking_period || "daily"),
      baseUrl,
    );
  } else {
    console.log(t("unknownMode"));
  }
}
