// @ts-nocheck
// 按模型爬：先翻模型列表（自带独立的分页数 / 跳过页数），再对每个模型走一遍作品流。
//
// 模型页也用游标分页，所以 skip_model_pages 同样是「照样请求、只是不进作品流」。
import { DEFAULT_ARTWORK_PAGES, DEFAULT_MODEL_PAGES, DEFAULT_SKIP_MODEL_PAGES, MODELS_QUERY, OPERATION_MODELS } from "./consts";
import { fetchGraphql } from "./api";
import { processArtworks } from "./artworks";
import { arrayValue, coerceStr, log, skipPagesOf, toInt } from "./util";

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

  log(`[PixAI] 模型流排序：${modelSort}，最多 ${maxModelPages} 页，跳过 ${skipModelPages} 页`);

  while (modelPage < maxModelPages) {
    if (modelPage < skipModelPages) {
      log(`[PixAI] 进入模型页：第 ${modelPage + 1}/${maxModelPages} 页（跳过）`);
    } else {
      log(`[PixAI] 进入模型页：第 ${modelPage + 1}/${maxModelPages} 页（有效第 ${modelPage - skipModelPages + 1}/${effectiveModelPages} 页）`);
    }

    const variables = {};
    applyModelSortVariables(variables, modelSort);
    if (modelCursor) variables[useBeforePagination ? "before" : "after"] = modelCursor;

    const res = await fetchGraphql(OPERATION_MODELS, variables, MODELS_QUERY);
    const generationModels = res?.data?.generationModels;
    if (!generationModels) {
      log("[PixAI] 模型响应缺少 generationModels，结束");
      break;
    }

    const edges = arrayValue(generationModels.edges);
    if (edges.length === 0) {
      log("[PixAI] 当前模型页无数据，结束");
      break;
    }
    log(`[PixAI] 当前模型页模型数 ${edges.length}`);

    if (modelPage >= skipModelPages) {
      const perModelProgress = edges.length > 0 ? progressPerModelPage / edges.length : 0.0;
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const modelId = coerceStr(edges[edgeIndex]?.node?.id);
        if (!modelId) continue;
        if (seenModelIds.has(modelId)) {
          log(`[PixAI] 跳过重复模型：模型页 ${modelPage + 1} 第 ${edgeIndex + 1} 个，loraId=${modelId}`);
          continue;
        }

        log(`[PixAI] 获取模型：模型页 ${modelPage + 1} 的第 ${edgeIndex + 1}/${edges.length} 个，loraId=${modelId}`);
        seenModelIds.add(modelId);
        downloadCount += await processArtworks(
          "loraId",
          modelId,
          "模型",
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

  log(`[PixAI] 任务结束：处理模型 ${processedModels} 个，下载图片 ${downloadCount} 张`);
  if (processedModels === 0) addProgress(100.0);
}
