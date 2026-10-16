// @ts-nocheck
// 图文流（opus feed）列表：UP 主图文与登录用户的图文收藏，只产出 opus_id 列表。
// 对应 gallery-dl BilibiliUserArticlesExtractor / BilibiliUserArticlesFavoriteExtractor。
import { sleep } from "@kabegame/plugin-sdk";

import { OPUS_FEED_FAV_API, OPUS_FEED_SPACE_API } from "./consts";
import { checkBilibiliRisk, coerceStr, fetchJson } from "./util";

/** UP 主图文列表（gallery-dl user_articles）：opus_id 游标翻页直到 has_more 为假。 */
export async function collectSpaceOpusIds(mid, maxArticles) {
  const ids = [];
  let offset = "";
  while (ids.length < maxArticles) {
    const url = `${OPUS_FEED_SPACE_API}?host_mid=${mid}${offset ? `&offset=${offset}` : ""}`;
    const json = await fetchJson(url);
    if (json?.code !== 0) {
      checkBilibiliRisk(json?.code);
      throw new Error(`UP 主图文接口失败（${json?.code}）: ${coerceStr(json?.message)}`);
    }
    const data = json?.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) break;
    for (const item of items) {
      if (ids.length >= maxArticles) break;
      if (item?.opus_id != null) ids.push(coerceStr(item.opus_id));
    }
    if (data.has_more !== true) break;
    offset = coerceStr(data.offset) || coerceStr(items[items.length - 1]?.opus_id);
    await sleep(2000);
  }
  return ids;
}

/** 登录用户自己的图文收藏（gallery-dl user_favlist）：page 翻页，需要登录态。 */
export async function collectFavOpusIds(maxArticles) {
  const ids = [];
  let page = 1;
  while (ids.length < maxArticles) {
    const json = await fetchJson(`${OPUS_FEED_FAV_API}?page=${page}&page_size=20`);
    if (json?.code !== 0) {
      // -101 会在这里硬失败并提示登录：收藏夹只属于登录用户，没有匿名可看的形态。
      checkBilibiliRisk(json?.code);
      throw new Error(`图文收藏接口失败（${json?.code}）: ${coerceStr(json?.message)}`);
    }
    const data = json?.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) break;
    for (const item of items) {
      if (ids.length >= maxArticles) break;
      if (item?.opus_id != null) ids.push(coerceStr(item.opus_id));
    }
    if (data.has_more !== true) break;
    page += 1;
    await sleep(2000);
  }
  return ids;
}
