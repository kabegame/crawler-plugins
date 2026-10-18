// 排行榜：作品榜直接一次拉 100 条榜单；模型榜（SD / LoRA）则对每个上榜模型再走一遍作品流。
//
// 榜单接口不返回 media.urls，所以作品榜的下载走 media API（useMediaApi=true）。
// 榜单本身没有分页，起始页 / 结束页对这条路径不生效。
import { ARTWORKS_QUERY, DEFAULT_RANKING_ARTWORK_PAGES, MODELS_QUERY, OPERATION_ARTWORKS, OPERATION_MODELS } from "./consts";
import { fetchGraphql } from "./api";
import { processArtworks } from "./artworks";
import { processArtworksEdgesForDownload } from "./download";
import type { ListArtworksResponse, ListGenerationModelsResponse, PixaiArtworkEdge, PixaiModelEdge, PixaiVars } from "./types";
import { arrayValue, coerceStr, log, toInt } from "./util";
import { t } from "./i18n";

const { addProgress } = Kabegame;

async function runRankingArtworks(rankType: string, rankPeriod: string): Promise<void> {
  const feed = rankPeriod === "today"
    ? "rankv2_daily"
    : rankPeriod === "weekly"
      ? "rankv2_weekly"
      : "rankv2_monthly";
  const rankMediaType = rankType === "artwork" ? "ARTWORK" : "ARTWORK_ANIMATED";
  log(t("rankingArtworksStart", { rankType, rankPeriod, feed, rankMediaType }));

  const res = await fetchGraphql<ListArtworksResponse>(
    OPERATION_ARTWORKS,
    { rankMediaType, feed, first: 100, isNsfw: false },
    ARTWORKS_QUERY,
  );
  const artworks = res?.data?.artworks;
  if (!artworks) {
    log(t("rankingArtworksMissing"));
    addProgress(100.0);
    return;
  }

  const edges = arrayValue<PixaiArtworkEdge>(artworks.edges);
  if (edges.length === 0) {
    log(t("rankingArtworksEmpty"));
    addProgress(100.0);
    return;
  }

  log(t("rankingArtworksReturned", { count: edges.length }));
  const rankCtx = `${rankType}/${rankPeriod}`;
  const downloadCount = await processArtworksEdgesForDownload(
    edges,
    t("labelRanking"),
    rankCtx,
    100.0,
    true,
    0,
  );
  log(t("rankingArtworksDone", { rankContext: rankCtx, count: downloadCount }));
  if (downloadCount === 0) addProgress(100.0);
}

async function runRankingModels(rankType: string, rankPeriod: string, vars: PixaiVars): Promise<void> {
  const modelType = rankType === "model" ? "ANY_MODEL" : "ANY_LORA";
  const orderBy = rankPeriod === "today"
    ? "-markInfo.artworkLikedCountAvgDaily"
    : rankPeriod === "weekly"
      ? "-markInfo.artworkLikedCountAvgWeekly"
      : "-markInfo.artworkLikedCountAvgMonthly";
  const maxArtworkPagesRanking = toInt(vars.max_artwork_pages_ranking, DEFAULT_RANKING_ARTWORK_PAGES);

  log(t("rankingModelsStart", { rankType, rankPeriod, modelType, orderBy }));
  const res = await fetchGraphql<ListGenerationModelsResponse>(
    OPERATION_MODELS,
    { type: modelType, orderBy, first: 100 },
    MODELS_QUERY,
  );
  const generationModels = res?.data?.generationModels;
  if (!generationModels) {
    log(t("rankingModelsMissing"));
    addProgress(100.0);
    return;
  }

  const edges = arrayValue<PixaiModelEdge>(generationModels.edges);
  if (edges.length === 0) {
    log(t("rankingModelsEmpty"));
    addProgress(100.0);
    return;
  }

  log(t("rankingModelsReturned", { count: edges.length }));
  const perModelProgress = 100.0 / edges.length;
  let downloadCount = 0;
  let processedModels = 0;

  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const node = edges[edgeIndex]?.node;
    const modelId = coerceStr(node?.id);
    if (!modelId) continue;
    const title = coerceStr(node?.title);
    log(t("rankingModelItem", { index: edgeIndex + 1, total: edges.length, title, modelId }));
    downloadCount += await processArtworks(
      "loraId",
      modelId,
      t("labelRankingModels"),
      maxArtworkPagesRanking,
      perModelProgress,
      "trending",
      0,
    );
    processedModels += 1;
  }

  log(t("rankingModelsDone", { rankType, rankPeriod, models: processedModels, count: downloadCount }));
  if (downloadCount === 0) addProgress(100.0);
}

export async function runRanking(vars: PixaiVars): Promise<void> {
  const rankType = coerceStr(vars.rank_type) || "artwork";
  const rankPeriod = coerceStr(vars.rank_period) || "today";
  if (rankType === "artwork" || rankType === "animated") {
    await runRankingArtworks(rankType, rankPeriod);
  } else {
    await runRankingModels(rankType, rankPeriod, vars);
  }
}
