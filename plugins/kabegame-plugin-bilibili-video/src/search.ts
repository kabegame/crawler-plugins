// 关键词搜索。端点与 bilibili 专栏插件相同，只是 search_type 从 article 换成 video。
//
// 注意 yt-dlp `BiliBiliSearchIE` 走的是**非 WBI** 的 x/web-interface/search/type，
// 代价是要自己塞一个 buvid3 cookie；插件拿不到 cookie 写入权限，所以这里用 WBI 版。
import { sleep } from "@kabegame/plugin-sdk";

import { SEARCH_API, SEARCH_PAGE_SIZE, WEB_BASE } from "./consts";
import { t } from "./i18n";
import type { BilibiliVars, ListEntry, WbiKeysState } from "./types";
import { checkBilibiliRisk, coerceStr, fetchJson, isUnavailableTitle, nowSeconds } from "./util";
import { buildDmParams, signQuery } from "./wbi";

const { warn } = Kabegame;

type SearchItem = {
  type?: string | null;
  bvid?: string | null;
  title?: string | null;
};

type SearchData = {
  numResults?: number | null;
  numPages?: number | null;
  result?: SearchItem[] | null;
};

type SearchResponse = {
  code?: number | null;
  message?: string | null;
  data?: SearchData | null;
};

/** 搜索结果的 title 带 `<em class="keyword">` 高亮标签，入库前要洗掉。 */
function stripHighlight(html: unknown): string {
  return coerceStr(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function fetchSearchPage(
  vars: BilibiliVars,
  pageNo: number,
  keys: WbiKeysState,
): Promise<SearchData | null | undefined> {
  const params: Record<string, string> = {
    search_type: "video",
    keyword: coerceStr(vars.keyword),
    page: String(pageNo),
    page_size: String(SEARCH_PAGE_SIZE),
    order: coerceStr(vars.search_order) || "totalrank",
    duration: coerceStr(vars.duration) || "0",
    tids: "0",
    wts: String(nowSeconds()),
    ...buildDmParams(),
  };

  const json = await fetchJson<SearchResponse>(signQuery(SEARCH_API, params, keys.img, keys.sub), {
    Referer: `${WEB_BASE}/`,
  });
  if (json?.code !== 0) {
    checkBilibiliRisk(json?.code);
    throw new Error(t("searchFailed", { code: json?.code, message: coerceStr(json?.message) }));
  }
  return json.data;
}

/**
 * 返回 [{ bvid, title }]。搜索结果里混有直播间、番剧等非投稿条目，
 * 只保留 type === "video" 且有 bvid 的。
 */
export async function collectSearchEntries(
  vars: BilibiliVars,
  keys: WbiKeysState,
  intervalMs: number,
): Promise<ListEntry[]> {
  const keyword = coerceStr(vars.keyword).trim();
  if (!keyword) throw new Error(t("keywordRequired"));

  const startPage = Math.max(1, Number(vars.start_page ?? 1));
  const endPage = Math.max(startPage, Number(vars.end_page ?? startPage));
  const maxVideos = Math.max(1, Number(vars.max_videos ?? 5));

  const entries: ListEntry[] = [];
  const seen = new Set<string>();
  let totalResults = 0;
  let totalPages = 0;
  let dead = 0;

  for (let pageNo = startPage; pageNo <= endPage; pageNo += 1) {
    if (entries.length >= maxVideos) break;
    if (pageNo > startPage) await sleep(intervalMs);

    const data = await fetchSearchPage(vars, pageNo, keys);
    totalResults = Number(data?.numResults ?? totalResults);
    totalPages = Number(data?.numPages ?? totalPages);

    const resultValue = data?.result;
    const result: SearchItem[] = Array.isArray(resultValue) ? resultValue : [];
    if (result.length === 0) break;

    for (const item of result) {
      if (entries.length >= maxVideos) break;
      if (coerceStr(item?.type) !== "video") continue;
      const bvid = coerceStr(item?.bvid);
      // 同一个稿件可能在多页重复出现，按 bvid 去重。
      if (!bvid || seen.has(bvid)) continue;
      seen.add(bvid);
      const title = stripHighlight(item?.title);
      // 搜索索引里留着失效稿件，标题就是占位文案，这里先挡掉省一次 view 请求。
      if (isUnavailableTitle(title)) {
        dead += 1;
        continue;
      }
      entries.push({ bvid, title });
    }

    if (totalPages > 0 && pageNo >= totalPages) break;
  }

  console.log(t("searchSummary", {
    keyword,
    total: totalResults,
    pages: totalPages,
    start: startPage,
    end: Math.min(endPage, totalPages || endPage),
    count: entries.length,
    max: maxVideos,
  }));
  if (dead > 0) warn(t("searchDeadSkipped", { count: dead }));
  if (entries.length === 0) {
    warn(t("searchNoMatch"));
    throw new Error(t("searchEmpty"));
  }
  return entries;
}
