// @ts-nocheck
import { addArtworkProgress, coerceStr, ensurePixivCookie, fetchJson, rethrowIfLoginFailed } from "../common";
import { t } from "../i18n";
import { downloadIllust } from "../illust";

export async function runKeyword(vars) {
  const keyword = coerceStr(vars.keyword);
  if (!keyword) throw new Error(t("keywordRequired"));
  // 热门排序需 Premium 登录；r18/all 搜索会出 R18 结果需登录
  const needLogin = vars.keyword_order === "popular" ||
    vars.search_mode !== "safe";
  if (needLogin) ensurePixivCookie(t("labelKeyword"));
  const kwEnc = encodeURIComponent(keyword);
  const orderParam = vars.keyword_order === "popular" ? "popular_d" : "date_d";
  const target = Number(vars.num_artworks ?? 50);
  const limit = 60;
  let page = 1;
  let done = 0;

  while (done < target) {
    let json;
    try {
      json = await fetchJson(
        `https://www.pixiv.net/ajax/search/artworks/${kwEnc}?word=${kwEnc}&order=${orderParam}&mode=${vars.search_mode}&p=${page}&s_mode=s_tag_full&type=all&lang=zh`,
      );
    } catch (e) {
      rethrowIfLoginFailed(e, t("labelKeywordSearch"), needLogin);
      break;
    }
    const data = Array.isArray(json?.body?.illustManga?.data)
      ? json.body.illustManga.data
      : [];
    for (const item of data) {
      if (done >= target) break;
      const id = coerceStr(item?.id);
      if (!id) continue;
      await downloadIllust(id);
      done += 1;
      addArtworkProgress(target);
    }
    if (data.length < limit) break;
    page += 1;
  }
}

