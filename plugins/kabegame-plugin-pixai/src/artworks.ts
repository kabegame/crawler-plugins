// @ts-nocheck
// 作品分页遍历。全站 / 标签 / 模型 / 作者四种流的翻页逻辑完全一致，
// 只有 GraphQL 变量和日志措辞不同，所以统一收在 crawlArtworkPages 里。
//
// 分页方向由排序决定：latest 这类倒序流用 before + startCursor 往回翻，
// 其余用 after + endCursor 往后翻。
import { ARTWORKS_QUERY, OPERATION_ARTWORKS } from "./consts";
import { fetchGraphql } from "./api";
import { processArtworksEdgesForDownload } from "./download";
import { arrayValue, coerceStr, log } from "./util";
import { t } from "./i18n";

/** 把排序选项翻成 listArtworks 的 feed / orderBy / first / last。 */
export function applyArtworkSortVariables(variables, artworkSort) {
  switch (artworkSort) {
    case "trending":
      Object.assign(variables, { first: 24, feed: "trending1" });
      break;
    case "daily_ranking":
      Object.assign(variables, { first: 24, feed: "daily_ranking_dedup" });
      break;
    case "popular_desc":
      Object.assign(variables, { first: 24, orderBy: "-markInfo.likedCount" });
      break;
    case "latest":
      Object.assign(variables, { last: 24, feed: "latest" });
      break;
    case "popular_asc":
      Object.assign(variables, { first: 24, orderBy: "markInfo.likedCount" });
      break;
    case "created_asc":
      Object.assign(variables, { first: 24, orderBy: "createdAt" });
      break;
    case "created_desc":
      Object.assign(variables, { first: 24, orderBy: "-createdAt" });
      break;
    default:
      Object.assign(variables, { first: 24, feed: "trending1" });
      break;
  }
}

/**
 * 遍历一条作品流并下载。
 *
 * skipPages = 起始页 - 1：游标只能从第一页顺次取，所以起始页之前的页照样要请求，
 * 只是不下载。maxPages 是页码上限（含），因此实际下载页数 = maxPages - skipPages。
 */
async function crawlArtworkPages({
  baseVariables,
  label,
  downloadLabel,
  scopeDesc,
  contextId,
  maxPages,
  perItemProgress,
  artworkSort,
  skipPages,
}) {
  let cursor = "";
  let artworkPage = 0;
  let downloaded = 0;
  const useBeforePagination = artworkSort === "latest";
  const effectivePages = maxPages - skipPages;
  const perPageProgress = effectivePages > 0 ? perItemProgress / effectivePages : 0.0;

  log(t("artworkFlowStart", { label, scope: scopeDesc, sort: artworkSort, startPage: skipPages + 1 }));

  while (artworkPage < maxPages) {
    if (artworkPage < skipPages) {
      log(t("artworkPageCursorOnly", { label, scope: scopeDesc, page: artworkPage + 1, maxPages }));
    } else {
      log(t("artworkPageProgress", {
        label,
        scope: scopeDesc,
        page: artworkPage + 1,
        maxPages,
        effectivePage: artworkPage - skipPages + 1,
        effectivePages,
      }));
    }

    const variables = { ...baseVariables };
    applyArtworkSortVariables(variables, artworkSort);
    if (cursor) variables[useBeforePagination ? "before" : "after"] = cursor;

    const res = await fetchGraphql(OPERATION_ARTWORKS, variables, ARTWORKS_QUERY);
    const artworks = res?.data?.artworks;
    if (!artworks) {
      log(t("artworksMissing", { label, scope: scopeDesc }));
      break;
    }

    const edges = arrayValue(artworks.edges);
    if (edges.length === 0) {
      log(artworkPage === 0
        ? t("noArtworkData", { label, scope: scopeDesc })
        : t("artworkPageEmpty", { label, scope: scopeDesc }));
      break;
    }
    log(t("artworkPageReturned", { label, count: edges.length }));

    if (artworkPage >= skipPages) {
      downloaded += await processArtworksEdgesForDownload(
        edges,
        downloadLabel,
        contextId,
        perPageProgress,
        false,
        downloaded,
      );
    }

    const pageInfo = artworks.pageInfo;
    if (!pageInfo) break;
    if (useBeforePagination) {
      if (pageInfo.hasPreviousPage !== true) {
        log(t("noPreviousArtworkPage", { label, scope: scopeDesc }));
        break;
      }
      cursor = coerceStr(pageInfo.startCursor);
    } else {
      if (pageInfo.hasNextPage !== true) {
        log(t("noNextArtworkPage", { label, scope: scopeDesc }));
        break;
      }
      cursor = coerceStr(pageInfo.endCursor);
    }
    if (!cursor) break;
    artworkPage += 1;
  }

  log(t("artworkFlowDone", { label, scope: scopeDesc, sort: artworkSort, count: downloaded }));
  return downloaded;
}

/**
 * 全站 / 标签 / 模型流：queryKey 为空即全站，否则是 tackId / loraId 之一。
 */
export async function processArtworks(
  queryKey,
  id,
  label,
  maxPages,
  perItemProgress,
  artworkSort,
  skipPages,
) {
  const baseVariables = { isSafeSearch: true };
  if (queryKey && id) baseVariables[queryKey] = id;
  return crawlArtworkPages({
    baseVariables,
    label,
    downloadLabel: label,
    scopeDesc: queryKey && id ? `${queryKey}=${id}` : t("labelGlobal"),
    contextId: id,
    maxPages,
    perItemProgress,
    artworkSort,
    skipPages,
  });
}

/**
 * 作者流：按 authorId + types 过滤。
 * 这里不带 isSafeSearch —— 作者页本来就是定向抓取，交给站点默认口径。
 */
export async function processAuthorArtworks(
  authorId,
  types,
  artworkTypeLabel,
  maxPages,
  perItemProgress,
  artworkSort,
  skipPages,
) {
  return crawlArtworkPages({
    baseVariables: { authorId, types },
    label: t("labelAuthorFlow"),
    downloadLabel: t("labelAuthor"),
    scopeDesc: `authorId=${authorId}, types=${artworkTypeLabel}`,
    contextId: authorId,
    maxPages,
    perItemProgress,
    artworkSort,
    skipPages,
  });
}
