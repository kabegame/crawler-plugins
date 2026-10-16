// @ts-nocheck
// 排行榜：作品榜直接一次拉 100 条榜单；模型榜（SD / LoRA）则对每个上榜模型再走一遍作品流。
//
// 榜单接口不返回 media.urls，所以作品榜的下载走 media API（useMediaApi=true）。
// 榜单本身没有分页，起始页 / 结束页对这条路径不生效。
import { ARTWORKS_QUERY, DEFAULT_RANKING_ARTWORK_PAGES, MODELS_QUERY, OPERATION_ARTWORKS, OPERATION_MODELS } from "./consts";
import { fetchGraphql } from "./api";
import { processArtworks } from "./artworks";
import { processArtworksEdgesForDownload } from "./download";
import { arrayValue, coerceStr, log, toInt } from "./util";

const { addProgress } = Kabegame;

async function runRankingArtworks(rankType, rankPeriod) {
  const feed = rankPeriod === "today"
    ? "rankv2_daily"
    : rankPeriod === "weekly"
      ? "rankv2_weekly"
      : "rankv2_monthly";
  const rankMediaType = rankType === "artwork" ? "ARTWORK" : "ARTWORK_ANIMATED";
  log(`[PixAI] 排行榜：${rankType} / ${rankPeriod}，feed=${feed}，rankMediaType=${rankMediaType}`);

  const res = await fetchGraphql(
    OPERATION_ARTWORKS,
    { rankMediaType, feed, first: 100, isNsfw: false },
    ARTWORKS_QUERY,
  );
  const artworks = res?.data?.artworks;
  if (!artworks) {
    log("[PixAI] 排行榜响应缺少 artworks，结束");
    addProgress(100.0);
    return;
  }

  const edges = arrayValue(artworks.edges);
  if (edges.length === 0) {
    log("[PixAI] 排行榜无数据");
    addProgress(100.0);
    return;
  }

  log(`[PixAI] 排行榜返回 ${edges.length} 条作品`);
  const rankCtx = `${rankType}/${rankPeriod}`;
  const downloadCount = await processArtworksEdgesForDownload(
    edges,
    "排行榜",
    rankCtx,
    100.0,
    true,
    0,
  );
  log(`[PixAI] 排行榜（${rankCtx}）结束：下载 ${downloadCount} 张`);
  if (downloadCount === 0) addProgress(100.0);
}

async function runRankingModels(rankType, rankPeriod, vars) {
  const modelType = rankType === "model" ? "ANY_MODEL" : "ANY_LORA";
  const orderBy = rankPeriod === "today"
    ? "-markInfo.artworkLikedCountAvgDaily"
    : rankPeriod === "weekly"
      ? "-markInfo.artworkLikedCountAvgWeekly"
      : "-markInfo.artworkLikedCountAvgMonthly";
  const maxArtworkPagesRanking = toInt(vars.max_artwork_pages_ranking, DEFAULT_RANKING_ARTWORK_PAGES);

  log(`[PixAI] 排行榜：${rankType} / ${rankPeriod}，type=${modelType}，orderBy=${orderBy}`);
  const res = await fetchGraphql(
    OPERATION_MODELS,
    { type: modelType, orderBy, first: 100 },
    MODELS_QUERY,
  );
  const generationModels = res?.data?.generationModels;
  if (!generationModels) {
    log("[PixAI] 排行榜模型响应缺少 generationModels，结束");
    addProgress(100.0);
    return;
  }

  const edges = arrayValue(generationModels.edges);
  if (edges.length === 0) {
    log("[PixAI] 排行榜模型无数据");
    addProgress(100.0);
    return;
  }

  log(`[PixAI] 排行榜返回 ${edges.length} 个模型`);
  const perModelProgress = 100.0 / edges.length;
  let downloadCount = 0;
  let processedModels = 0;

  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const node = edges[edgeIndex]?.node;
    const modelId = coerceStr(node?.id);
    if (!modelId) continue;
    const title = coerceStr(node?.title);
    log(`[PixAI] 排行榜模型 ${edgeIndex + 1}/${edges.length}：${title} (loraId=${modelId})`);
    downloadCount += await processArtworks(
      "loraId",
      modelId,
      "排行榜模型",
      maxArtworkPagesRanking,
      perModelProgress,
      "trending",
      0,
    );
    processedModels += 1;
  }

  log(`[PixAI] 排行榜（${rankType}/${rankPeriod}）结束：处理模型 ${processedModels} 个，下载 ${downloadCount} 张`);
  if (downloadCount === 0) addProgress(100.0);
}

export async function runRanking(vars) {
  const rankType = coerceStr(vars.rank_type) || "artwork";
  const rankPeriod = coerceStr(vars.rank_period) || "today";
  if (rankType === "artwork" || rankType === "animated") {
    await runRankingArtworks(rankType, rankPeriod);
  } else {
    await runRankingModels(rankType, rankPeriod, vars);
  }
}
