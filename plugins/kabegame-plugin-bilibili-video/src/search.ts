// @ts-nocheck
// 关键词搜索。端点与 bilibili 专栏插件相同，只是 search_type 从 article 换成 video。
//
// 注意 yt-dlp `BiliBiliSearchIE` 走的是**非 WBI** 的 x/web-interface/search/type，
// 代价是要自己塞一个 buvid3 cookie；插件拿不到 cookie 写入权限，所以这里用 WBI 版。
import { sleep } from "@kabegame/plugin-sdk";

import { SEARCH_API, SEARCH_PAGE_SIZE, WEB_BASE } from "./consts";
import { checkBilibiliRisk, coerceStr, fetchJson, isUnavailableTitle, nowSeconds } from "./util";
import { buildDmParams, signQuery } from "./wbi";

const { warn } = Kabegame;

/** 搜索结果的 title 带 `<em class="keyword">` 高亮标签，入库前要洗掉。 */
function stripHighlight(html) {
  return coerceStr(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function fetchSearchPage(vars, pageNo, keys) {
  const params = {
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

  const json = await fetchJson(signQuery(SEARCH_API, params, keys.img, keys.sub), {
    Referer: `${WEB_BASE}/`,
  });
  if (json?.code !== 0) {
    checkBilibiliRisk(json?.code);
    throw new Error(`搜索接口失败（${json?.code}）: ${coerceStr(json?.message)}`);
  }
  return json.data;
}

/**
 * 返回 [{ bvid, title }]。搜索结果里混有直播间、番剧等非投稿条目，
 * 只保留 type === "video" 且有 bvid 的。
 */
export async function collectSearchEntries(vars, keys, intervalMs) {
  const keyword = coerceStr(vars.keyword).trim();
  if (!keyword) throw new Error("请填写搜索关键词");

  const startPage = Math.max(1, Number(vars.start_page ?? 1));
  const endPage = Math.max(startPage, Number(vars.end_page ?? startPage));
  const maxVideos = Math.max(1, Number(vars.max_videos ?? 5));

  const entries = [];
  const seen = new Set();
  let totalResults = 0;
  let totalPages = 0;
  let dead = 0;

  for (let pageNo = startPage; pageNo <= endPage; pageNo += 1) {
    if (entries.length >= maxVideos) break;
    if (pageNo > startPage) await sleep(intervalMs);

    const data = await fetchSearchPage(vars, pageNo, keys);
    totalResults = Number(data?.numResults ?? totalResults);
    totalPages = Number(data?.numPages ?? totalPages);

    const result = Array.isArray(data?.result) ? data.result : [];
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

  console.log(
    `[bilibili-video] 搜索「${keyword}」共 ${totalResults} 个结果 / ${totalPages} 页，`
    + `本次取第 ${startPage}~${Math.min(endPage, totalPages || endPage)} 页，命中 ${entries.length} 个（上限 ${maxVideos}）`,
  );
  if (dead > 0) warn(`搜索结果里有 ${dead} 个已失效稿件，已跳过。`);
  if (entries.length === 0) {
    warn("搜索没有命中任何投稿视频，可换关键词或放宽时长筛选。");
    throw new Error("搜索未取到任何视频");
  }
  return entries;
}
