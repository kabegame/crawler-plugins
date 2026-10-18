// bilibili 专栏 / 图文插件入口。
//
// 模块分工：
//   consts  端点与常量           wbi      WBI 签名核心与密钥获取
//   util    取值/HTTP/输入解析    replies  评论区拉取与精简（入 metadata）
//   article 传统专栏（cv）链路    opus     图文帖链路（结构化取图 + 实况图）
//   search  专栏关键词搜索        feed     UP 主图文 / 图文收藏列表
import { sleep } from "@kabegame/plugin-sdk";

import { processOneCv } from "./article";
import { UA } from "./consts";
import { collectFavOpusIds, collectSpaceOpusIds } from "./feed";
import { t } from "./i18n";
import { processOneOpus } from "./opus";
import {
  collectArticleIds, signSearchUrl, type ArticleIdRow, type SearchResponse, type SearchVars,
} from "./search";
import {
  coerceStr, checkBilibiliRisk, errorMessage, fetchWith509Retry, isRecord, parseCvIdFromInput,
  parseMidFromInput, parseOpusIdFromInput,
} from "./util";
import { getWbiKeys, type WbiKeys } from "./wbi";

const { addProgress, requireCookie, setHeader, warn } = Kabegame;

/** 插件配置：GUI 字段可能有类型，CLI --var 一定是字符串，统一按 unknown 收窄。 */
type BilibiliVars = SearchVars & {
  mode?: unknown;
  live_photo?: unknown;
  cv_id_or_url?: unknown;
  max_articles?: unknown;
  mid?: unknown;
  start_page?: unknown;
  end_page?: unknown;
};

export async function crawl(_common: unknown, custom: unknown): Promise<void> {
  const vars: BilibiliVars = isRecord(custom) ? custom : {};
  setHeader("User-Agent", UA);
  setHeader("Referer", "https://www.bilibili.com/");
  setHeader("Origin", "https://www.bilibili.com");

  // 机会注入：从畅游取 B 站 Cookie（脚本拿不到明文）。取不到不阻断——
  // 公开专栏搜索等路径仍可跑；真正需要登录时会在接口返回 -101 处硬失败。
  if (!requireCookie()) {
    warn(t("cookieMissing"));
  }

  const livePhoto = vars.live_photo !== false;

  if (vars.mode === "single") {
    const opusId = parseOpusIdFromInput(vars.cv_id_or_url);
    if (opusId) {
      let keys: WbiKeys = { img: "", sub: "" };
      try {
        keys = await getWbiKeys();
      } catch {
        // Opus image extraction can still work without WBI metadata.
      }
      await processOneOpus(opusId, 100.0, keys.img, keys.sub, livePhoto);
      addProgress(100.0);
      return;
    }
  }

  if (vars.mode === "space" || vars.mode === "favlist") {
    // WBI 只服务于 opus 关联 cv 的元数据与评论，拿不到也不阻断批量取图。
    let keys: WbiKeys = { img: "", sub: "" };
    try {
      keys = await getWbiKeys();
    } catch {
      // 同上。
    }
    const maxArticles = Math.max(1, Number(vars.max_articles ?? 20));
    let opusIds: string[];
    if (vars.mode === "space") {
      const mid = parseMidFromInput(vars.mid);
      if (!mid) throw new Error(t("midRequired"));
      opusIds = await collectSpaceOpusIds(mid, maxArticles);
      if (opusIds.length === 0) throw new Error(t("spaceEmpty", { mid }));
    } else {
      opusIds = await collectFavOpusIds(maxArticles);
      if (opusIds.length === 0) throw new Error(t("favEmpty"));
    }

    console.log(t("opusBatchStart", { count: opusIds.length, max: maxArticles }));
    const perOpus = 100.0 / opusIds.length;
    let failed = 0;
    for (let index = 0; index < opusIds.length; index += 1) {
      if (index > 0) await sleep(1000);
      try {
        await processOneOpus(opusIds[index], perOpus, keys.img, keys.sub, livePhoto);
      } catch (error) {
        failed += 1;
        warn(t("opusDownloadFailed", { opusId: opusIds[index], reason: errorMessage(error) }));
        addProgress(perOpus);
      }
    }
    if (failed > 0 && failed === opusIds.length) throw new Error(t("allOpusFailed"));
    if (failed > 0) warn(t("opusPartialFailed", { count: opusIds.length, failed }));
    addProgress(100.0);
    return;
  }

  const keys = await getWbiKeys();
  const allIds: ArticleIdRow[] = [];
  if (vars.mode === "single") {
    const cvId = parseCvIdFromInput(vars.cv_id_or_url);
    if (!cvId) throw new Error(t("singleInputRequired"));
    allIds.push({ id: cvId, desc: "" });
  } else {
    const startPage = Number(vars.start_page ?? 1);
    const endPage = Number(vars.end_page ?? startPage);
    if (endPage < startPage) throw new Error(t("endPageBeforeStart"));
    for (let page = startPage; page <= endPage; page += 1) {
      const search = await fetchWith509Retry<SearchResponse>(
        () => signSearchUrl(vars, page, keys.img, keys.sub),
        t("searchApiLabel"),
      );
      if (search?.code !== 0) {
        checkBilibiliRisk(search?.code);
        warn(t("searchPageFailed", { page, reason: coerceStr(search?.message) }));
      } else {
        allIds.push(...collectArticleIds(search.data));
      }
    }
  }

  if (allIds.length === 0) {
    warn(t("noArticlesFound"));
    addProgress(100.0);
    return;
  }

  const perCv = 100.0 / allIds.length;
  for (const row of allIds) {
    await processOneCv(coerceStr(row.id), keys.img, keys.sub, perCv, coerceStr(row.desc));
  }
  addProgress(100.0);
}
