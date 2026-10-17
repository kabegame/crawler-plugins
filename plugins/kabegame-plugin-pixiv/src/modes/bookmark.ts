// @ts-nocheck
import { addArtworkProgress, coerceStr, ensurePixivCookie, fetchJson, rethrowIfLoginFailed } from "../common";
import { t } from "../i18n";
import { downloadIllust } from "../illust";

export async function runBookmark(vars) {
  const userId = coerceStr(vars.user_id);
  if (!userId) throw new Error(t("bookmarkUserRequired"));
  ensurePixivCookie(t("labelBookmark"));
  const target = Number(vars.num_artworks ?? 50);
  const limit = 48;
  let offset = 0;
  let done = 0;
  while (done < target) {
    let json;
    try {
      json = await fetchJson(
        `https://www.pixiv.net/ajax/user/${userId}/illusts/bookmarks?tag=&offset=${offset}&limit=${limit}&rest=show&lang=zh`,
      );
    } catch (e) {
      rethrowIfLoginFailed(e, t("labelBookmark"), true);
      break;
    }
    const works = Array.isArray(json?.body?.works) ? json.body.works : [];
    for (const work of works) {
      if (done >= target) break;
      const id = coerceStr(work?.id);
      if (!id) continue;
      await downloadIllust(id);
      done += 1;
      addArtworkProgress(target);
    }
    if (works.length < limit) break;
    offset += limit;
  }
}

