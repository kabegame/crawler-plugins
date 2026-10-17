// @ts-nocheck
// 按模型爬：先翻模型列表（自带独立的分页数 / 跳过页数），再对每个模型走一遍作品流。
//
// 模型页也用游标分页，所以 skip_model_pages 同样是「照样请求、只是不进作品流」。
import { DEFAULT_ARTWORK_PAGES, DEFAULT_MODEL_PAGES, DEFAULT_SKIP_MODEL_PAGES, MODELS_QUERY, OPERATION_MODELS } from "./consts";
import { fetchGraphql } from "./api";
import { processArtworks } from "./artworks";
import { arrayValue, coerceStr, log, skipPagesOf, toInt } from "./util";
import { t } from "./i18n";

const { addProgress } = Kabegame;

/** 把模型排序选项翻成 listGenerationModels 的 feed / orderBy / first / last。 */
export function applyModelSortVariables(variables, modelSort) {
  switch (modelSort) {
    case "trending":
      Object.assign(variables, { feed: "trending", last: 24 });
      break;
    case "popular_desc":
      Object.assign(variables, { feed: "meilisearch", orderBy: "-markInfo.likedCount", first: 24 });
      break;
    case "popular_asc":
      Object.assign(variables, { feed: "meilisearch", orderBy: "markInfo.likedCount", first: 24 });
      break;
    case "gen_popular_desc":
      Object.assign(variables, { feed: "meilisearch", orderBy: "-markInfo.refCount", first: 24 });
      break;
    case "gen_popular_asc":
      Object.assign(variables, { feed: "meilisearch", orderBy: "markInfo.refCount", first: 24 });
      break;
    case "latest_desc":
      Object.assign(variables, { feed: "latest", last: 24 });
      break;
    case "latest_asc":
      Object.assign(variables, { feed: "latest", orderBy: "createdAt", last: 24 });
      break;
    default:
      Object.assign(variables, { feed: "trending", last: 24 });
      break;
  }
}

export async function runModel(vars) {
  const modelSort = coerceStr(vars.model_sort) || "trending";
  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const maxModelPages = toInt(vars.max_model_pages, DEFAULT_MODEL_PAGES);
  const skipModelPages = toInt(vars.skip_model_pages, DEFAULT_SKIP_MODEL_PAGES);
  const maxArtworkPages = toInt(vars.max_artwork_pages, DEFAULT_ARTWORK_PAGES);
  const skipArtworkPages = skipPagesOf(vars);
  const seenModelIds = new Set();
  const useBeforePagination =
    modelSort === "trending" || modelSort === "latest_desc" || modelSort === "latest_asc";
  const effectiveModelPages = maxModelPages - skipModelPages;
  const progressPerModelPage = effectiveModelPages > 0 ? 100.0 / effectiveModelPages : 0.0;
  let modelCursor = "";
  let modelPage = 0;
  let processedModels = 0;
  let downloadCount = 0;

  log(t("modelSortSummary", { sort: modelSort, maxPages: maxModelPages, skipPages: skipModelPages }));

  while (modelPage < maxModelPages) {
    if (modelPage < skipModelPages) {
      log(t("modelPageSkipped", { page: modelPage + 1, maxPages: maxModelPages }));
    } else {
      log(t("modelPageProgress", {
        page: modelPage + 1,
        maxPages: maxModelPages,
        effectivePage: modelPage - skipModelPages + 1,
        effectivePages: effectiveModelPages,
      }));
    }

    const variables = {};
    applyModelSortVariables(variables, modelSort);
    if (modelCursor) variables[useBeforePagination ? "before" : "after"] = modelCursor;

    const res = await fetchGraphql(OPERATION_MODELS, variables, MODELS_QUERY);
    const generationModels = res?.data?.generationModels;
    if (!generationModels) {
      log(t("modelsMissing"));
      break;
    }

    const edges = arrayValue(generationModels.edges);
    if (edges.length === 0) {
      log(t("modelPageEmpty"));
      break;
    }
    log(t("modelPageCount", { count: edges.length }));

    if (modelPage >= skipModelPages) {
      const perModelProgress = edges.length > 0 ? progressPerModelPage / edges.length : 0.0;
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const modelId = coerceStr(edges[edgeIndex]?.node?.id);
        if (!modelId) continue;
        if (seenModelIds.has(modelId)) {
          log(t("duplicateModel", { page: modelPage + 1, index: edgeIndex + 1, modelId }));
          continue;
        }

        log(t("fetchingModel", {
          page: modelPage + 1,
          index: edgeIndex + 1,
          total: edges.length,
          modelId,
        }));
        seenModelIds.add(modelId);
        downloadCount += await processArtworks(
          "loraId",
          modelId,
          t("labelModels"),
          maxArtworkPages,
          perModelProgress,
          artworkSort,
          skipArtworkPages,
        );
        processedModels += 1;
      }
    }

    const pageInfo = generationModels.pageInfo;
    if (!pageInfo) break;
    if (useBeforePagination) {
      if (pageInfo.hasPreviousPage !== true) break;
      modelCursor = coerceStr(pageInfo.startCursor);
    } else {
      if (pageInfo.hasNextPage !== true) break;
      modelCursor = coerceStr(pageInfo.endCursor);
    }
    if (!modelCursor) break;
    modelPage += 1;
  }

  log(t("modelTaskFinished", { models: processedModels, downloads: downloadCount }));
  if (processedModels === 0) addProgress(100.0);
}
