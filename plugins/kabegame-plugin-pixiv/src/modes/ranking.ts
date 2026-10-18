import { addArtworkProgress, coerceStr, ensurePixivCookie, fetchJson, rethrowIfLoginFailed, type PixivVars } from "../common";
import { t } from "../i18n";
import { downloadIllust } from "../illust";

const { setHeader, warn } = Kabegame;

type PixivRankingResponse = {
  contents?: Array<{ illust_id?: string | number | null }> | null;
  next?: string | number | null;
};

// 配置值原样返回（类型未知），拼 URL 时由模板字符串还原原有 String() 语义。
function effectiveContentForRanking(rankingMode: unknown, contentMode: unknown): unknown {
  return typeof rankingMode === "string" &&
      ["daily", "weekly", "monthly", "rookie"].includes(rankingMode)
    ? contentMode
    : "all";
}

function rankingPixivMode(rankingMode: unknown, ageMode: unknown): unknown {
  if (ageMode !== "r18") return rankingMode;
  return rankingMode === "daily_ai" ? "daily_r18_ai" : `${rankingMode}_r18`;
}

export async function runRanking(vars: PixivVars): Promise<void> {
  const effectiveContent = effectiveContentForRanking(
    vars.ranking_mode,
    vars.content_mode,
  );
  if (
    (vars.ranking_mode === "monthly" || vars.ranking_mode === "rookie") &&
    effectiveContent === "ugoira"
  ) {
    throw new Error(t("ugoiraUnsupported"));
  }

  const apiMode = rankingPixivMode(vars.ranking_mode, vars.age_mode);
  if (vars.age_mode === "r18") {
    if (!coerceStr(vars.user_id)) {
      throw new Error(t("r18UserRequired"));
    }
    setHeader("x-user-id", coerceStr(vars.user_id));
    ensurePixivCookie(t("labelR18Ranking"));
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
    let json: PixivRankingResponse | null = null;
    try {
      json = await fetchJson<PixivRankingResponse>(`${refBase}&p=${page}&format=json`);
    } catch (e) {
      rethrowIfLoginFailed(e, t("labelR18Ranking"), vars.age_mode === "r18");
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
    warn(t("rankingShort", { done, target }));
  }
}
