// @ts-nocheck
import { addArtworkProgress, coerceStr, ensurePixivCookie, fetchJson, rethrowIfLoginFailed } from "../common";
import { downloadIllust } from "../illust";

const { setHeader, warn } = Kabegame;

function effectiveContentForRanking(rankingMode, contentMode) {
  return ["daily", "weekly", "monthly", "rookie"].includes(rankingMode)
    ? contentMode
    : "all";
}

function rankingPixivMode(rankingMode, ageMode) {
  if (ageMode !== "r18") return rankingMode;
  return rankingMode === "daily_ai" ? "daily_r18_ai" : `${rankingMode}_r18`;
}

export async function runRanking(vars) {
  const effectiveContent = effectiveContentForRanking(
    vars.ranking_mode,
    vars.content_mode,
  );
  if (
    (vars.ranking_mode === "monthly" || vars.ranking_mode === "rookie") &&
    effectiveContent === "ugoira"
  ) {
    throw new Error("月榜与新生榜不支持动图（うごイラ）内容类型");
  }

  const apiMode = rankingPixivMode(vars.ranking_mode, vars.age_mode);
  if (vars.age_mode === "r18") {
    if (!coerceStr(vars.user_id)) {
      throw new Error("R18 排行榜请在「用户 UID」填写登录账号 UID");
    }
    setHeader("x-user-id", coerceStr(vars.user_id));
    ensurePixivCookie("R18 排行榜");
  }

  let done = 0;
  let page = 1;
  const target = Number(vars.num_artworks ?? 50);
  while (done < target) {
    const dateQ = coerceStr(vars.ranking_date)
      ? `&date=${vars.ranking_date}`
      : "";
    const refBase =
      `https://www.pixiv.net/ranking.php?mode=${apiMode}&content=${effectiveContent}${dateQ}`;
    setHeader("Referer", refBase);
    let json;
    try {
      json = await fetchJson(`${refBase}&p=${page}&format=json`);
    } catch (e) {
      rethrowIfLoginFailed(e, "R18 排行榜", vars.age_mode === "r18");
      break;
    }
    const contents = Array.isArray(json?.contents) ? json.contents : [];
    for (const item of contents) {
      if (done >= target) break;
      const id = coerceStr(item?.illust_id);
      if (!id) continue;
      await downloadIllust(id);
      done += 1;
      addArtworkProgress(target);
    }
    if (done >= target || !json?.next) break;
    page = Number(json.next);
    if (!Number.isFinite(page) || page < 1) break;
  }
  if (done < target) {
    warn(
      `排行榜实际只获取到 ${done} 个作品，少于请求的 ${target} 个（可能已到底或无更多页）`,
    );
  }
}

