// @ts-nocheck
// PixAI V8 crawler. This mirrors the previous Rhai implementation but uses the
// Kabegame V8 host bridge and standard fetch.
const {
  addProgress,
  createImageMetadata: createImageMetadataRow,
  downloadImage,
  pluginData,
  setHeader,
  setPluginData,
  warn,
} = Kabegame;

const API_URL = "https://api.pixai.art/graphql";
const MEDIA_API_BASE = "https://api.pixai.art/v1/media/";

const OPERATION_MODELS = "listGenerationModels";
const OPERATION_ARTWORKS = "listArtworks";
const OPERATION_GET_TACK = "getTack";
const OPERATION_GET_ARTWORK_DETAIL = "getArtworkWithTaskDetail";

// PixAI supports Apollo persisted queries, but hashes rotate with site releases.
// Full query text avoids PersistedQueryNotFound failures.
const MODELS_QUERY =
  "query listGenerationModels($feed: String, $first: Int, $last: Int, $orderBy: String, $before: String, $after: String, $type: GenerationModelType) { generationModels(feed: $feed, first: $first, last: $last, orderBy: $orderBy, before: $before, after: $after, type: $type) { edges { node { id title } } pageInfo { hasNextPage hasPreviousPage endCursor startCursor } } }";

const ARTWORKS_QUERY =
  "query listArtworks($isSafeSearch: Boolean, $first: Int, $last: Int, $feed: String, $orderBy: String, $before: String, $after: String, $tackId: String, $loraId: ID, $authorId: ID, $types: [ArtworkType], $rankMediaType: RankMediaType, $isNsfw: Boolean) { artworks(isSafeSearch: $isSafeSearch, first: $first, last: $last, feed: $feed, orderBy: $orderBy, before: $before, after: $after, tackId: $tackId, loraId: $loraId, authorId: $authorId, types: $types, rankMediaType: $rankMediaType, isNsfw: $isNsfw) { edges { node { id title mediaId videoMediaId media { urls { variant url } } } } pageInfo { hasNextPage hasPreviousPage endCursor startCursor } } }";

const GET_TACK_QUERY =
  "query getTack($id: ID, $defaultName: String, $codeName: String) { tack(id: $id, defaultName: $defaultName, codeName: $codeName) { id parentId codeName category defaultName weight mediaId safetyScore createdAt updatedAt tackTerms { id tackId category name createdAt updatedAt } } }";

const ARTWORK_DETAIL_QUERY =
  "query getArtworkWithTaskDetail($id: ID!) { artwork(id: $id) { id title authorId prompts createdAt updatedAt mediaId videoMediaId likedCount commentCount extra media { id type width height imageType urls { variant url } } author { id username displayName avatarMediaId avatarSmallThumbnailMediaUrl accountType activeDecorations { id decorationId isEnabled decoration { id code type data } } } tacks { id codeName category defaultName displayName tackTerms { category name } } } }";

const MESSAGES_QUERY =
  "query listMessages($topicId: ID!, $last: Int) { messages(topicId: $topicId, last: $last) { edges { node { id type content createdAt author { id username displayName avatarSmallThumbnailMediaUrl } } } } }";

const REQUEST_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: "https://pixai.art",
  Referer: "https://pixai.art/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
};

const TAG_CACHE_BY_ID = "pixai_tacks_by_id";
const TAG_CACHE_BY_CODE_NAME = "pixai_tacks_by_code_name";

function setRequestHeaders() {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) {
    setHeader(key, value);
  }
}

function log(message, level) {
  if (level === "warn") {
    warn(String(message ?? ""));
    return;
  }
  console.log(String(message ?? ""));
}

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function buildGraphqlUrl(operation, variables, query) {
  const params = new URLSearchParams();
  params.set("operation", operation);
  params.set("operationName", operation);
  params.set("variables", JSON.stringify(variables));
  params.set("query", query);
  return `${API_URL}?${params.toString()}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

async function fetchGraphql(operation, variables, query) {
  setHeader("x-apollo-operation-name", operation);
  return fetchJson(buildGraphqlUrl(operation, variables, query));
}

function readPluginDataOrEmpty() {
  try {
    const data = pluginData();
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function trySetPluginData(data) {
  try {
    setPluginData(data);
  } catch {
    // Older runtimes may not expose plugin_data. Cache failure must not stop crawling.
  }
}

function readCachedTackByCodeName(codeName) {
  const cache = readPluginDataOrEmpty()[TAG_CACHE_BY_CODE_NAME];
  return cache && typeof cache === "object" ? cache[coerceStr(codeName)] : null;
}

function writeCachedTack(tackId, tack) {
  if (!tack || typeof tack !== "object") return;
  const data = readPluginDataOrEmpty();
  const byId = data[TAG_CACHE_BY_ID] && typeof data[TAG_CACHE_BY_ID] === "object"
    ? data[TAG_CACHE_BY_ID]
    : {};
  byId[coerceStr(tackId)] = tack;
  data[TAG_CACHE_BY_ID] = byId;

  const codeName = coerceStr(tack.codeName);
  if (codeName) {
    const byCode = data[TAG_CACHE_BY_CODE_NAME] &&
      typeof data[TAG_CACHE_BY_CODE_NAME] === "object"
      ? data[TAG_CACHE_BY_CODE_NAME]
      : {};
    byCode[codeName] = tack;
    data[TAG_CACHE_BY_CODE_NAME] = byCode;
  }
  trySetPluginData(data);
}

async function fetchTackByCodeName(codeName) {
  const codeNameStr = coerceStr(codeName);
  if (!codeNameStr) return null;

  const cached = readCachedTackByCodeName(codeNameStr);
  if (cached) return cached;

  try {
    const res = await fetchGraphql(
      OPERATION_GET_TACK,
      { codeName: codeNameStr },
      GET_TACK_QUERY,
    );
    const tack = res?.data?.tack || null;
    if (tack) writeCachedTack(coerceStr(tack.id) || codeNameStr, tack);
    return tack;
  } catch {
    log(`[PixAI] 标签详情获取失败，codeName=${codeNameStr}`, "warn");
    return null;
  }
}

async function fetchPixaiComments(artworkId) {
  const artworkIdStr = coerceStr(artworkId);
  if (!artworkIdStr) return [];

  try {
    const res = await fetchGraphql(
      "listMessages",
      { topicId: artworkIdStr, last: 20 },
      MESSAGES_QUERY,
    );
    const edges = arrayValue(res?.data?.messages?.edges);
    return edges.map((edge) => edge?.node).filter(Boolean);
  } catch {
    log(`[PixAI] 评论获取失败，artwork_id=${artworkIdStr}`, "warn");
    return [];
  }
}

async function fetchPixaiArtworkDetail(artworkId) {
  const artworkIdStr = coerceStr(artworkId);
  if (!artworkIdStr) return null;

  try {
    const res = await fetchGraphql(
      OPERATION_GET_ARTWORK_DETAIL,
      { id: artworkIdStr },
      ARTWORK_DETAIL_QUERY,
    );
    return res?.data?.artwork || null;
  } catch {
    log(`[PixAI] 作品详情获取失败，artwork_id=${artworkIdStr}`, "warn");
    return null;
  }
}

function countPublicUrls(urls) {
  let count = 0;
  for (const item of arrayValue(urls)) {
    if (item?.variant === "PUBLIC" && item?.url) count += 1;
  }
  return count;
}

function pickMediaIdForDownload(node) {
  const videoMediaId = coerceStr(node?.videoMediaId);
  if (videoMediaId) return videoMediaId;
  return coerceStr(node?.mediaId);
}

function pickVideoMediaIdForDownload(node, artworkDetail) {
  const detailVideoMediaId = coerceStr(artworkDetail?.videoMediaId);
  if (detailVideoMediaId) return detailVideoMediaId;
  return coerceStr(node?.videoMediaId);
}

function pickArtworkDownloadUrl(defaultUrl, node, artworkDetail) {
  const videoMediaId = pickVideoMediaIdForDownload(node, artworkDetail);
  if (videoMediaId) return `${MEDIA_API_BASE}${videoMediaId}/image`;
  return coerceStr(defaultUrl);
}

function createImageMetadata(metadata) {
  return Number(createImageMetadataRow(metadata, null));
}

async function downloadArtwork(finalDownloadUrl, artworkDetail, displayName, pixaiUrl) {
  const metadataId = createImageMetadata({ v2: artworkDetail });
  await downloadImage(finalDownloadUrl, {
    name: displayName,
    metadata_id: metadataId,
    url: pixaiUrl,
  });
}

async function enrichArtworkDetail(artworkId, fallbackTitle) {
  const detail = await fetchPixaiArtworkDetail(artworkId);
  if (!detail) {
    log(`[PixAI] 跳过作品：详情为空，artwork_id=${artworkId}`, "warn");
    return null;
  }
  detail.comments = await fetchPixaiComments(artworkId);
  if (!coerceStr(detail.title) && fallbackTitle) {
    detail.title = fallbackTitle;
  }
  return detail;
}

async function processArtworksEdgesForDownload(
  edges,
  label,
  contextId,
  progressBudget,
  useMediaApi,
  downloadedOffset,
) {
  const artworkEdges = arrayValue(edges);
  if (artworkEdges.length === 0) return 0;

  let downloaded = 0;
  if (useMediaApi) {
    const countOk = artworkEdges.filter((edge) => pickMediaIdForDownload(edge?.node)).length;
    log(`[PixAI] ${label} ${contextId} 可经 media API 下载 ${countOk}/${artworkEdges.length} 条`);
    const progressPer = countOk > 0 ? progressBudget / countOk : 0.0;

    for (let edgeIndex = 0; edgeIndex < artworkEdges.length; edgeIndex += 1) {
      const node = artworkEdges[edgeIndex]?.node;
      const mediaId = pickMediaIdForDownload(node);
      if (!mediaId) continue;

      const title = coerceStr(node?.title);
      const artworkId = coerceStr(node?.id);
      log(
        `[PixAI] 下载 ${label} ${contextId} 第 ${downloadedOffset + downloaded + 1} 张（第 ${edgeIndex + 1}/${artworkEdges.length} 条）：${title}`,
      );

      const detail = await enrichArtworkDetail(artworkId, title);
      if (!detail) continue;

      const downloadUrl = `${MEDIA_API_BASE}${mediaId}/image`;
      const finalDownloadUrl = pickArtworkDownloadUrl(downloadUrl, node, detail);
      const pixaiUrl = `https://pixai.art/artwork/${artworkId}`;
      await downloadArtwork(finalDownloadUrl, detail, coerceStr(detail.title) || title, pixaiUrl);
      downloaded += 1;
      if (progressPer > 0.0) addProgress(progressPer);
    }
    return downloaded;
  }

  let publicCount = 0;
  for (const edge of artworkEdges) {
    publicCount += countPublicUrls(edge?.node?.media?.urls);
  }
  log(`[PixAI] ${label} ${contextId} 作品页 PUBLIC 图片数 ${publicCount}`);
  const progressPerDownload = publicCount > 0 ? progressBudget / publicCount : 0.0;

  for (let edgeIndex = 0; edgeIndex < artworkEdges.length; edgeIndex += 1) {
    const node = artworkEdges[edgeIndex]?.node;
    const urls = arrayValue(node?.media?.urls);
    const publicUrl = urls.find((item) => item?.variant === "PUBLIC" && item?.url)?.url;
    if (!publicUrl) continue;

    const title = coerceStr(node?.title);
    const artworkId = coerceStr(node?.id);
    log(
      `[PixAI] 下载 ${label} ${contextId} 第 ${downloadedOffset + downloaded + 1} 张（第 ${edgeIndex + 1}/${artworkEdges.length} 条）：${title}`,
    );

    const detail = await enrichArtworkDetail(artworkId, title);
    if (!detail) continue;

    const finalDownloadUrl = pickArtworkDownloadUrl(publicUrl, node, detail);
    const pixaiUrl = `https://pixai.art/artwork/${artworkId}`;
    await downloadArtwork(finalDownloadUrl, detail, coerceStr(detail.title) || title, pixaiUrl);
    downloaded += 1;
    if (progressPerDownload > 0.0) addProgress(progressPerDownload);
  }

  return downloaded;
}

function applyArtworkSortVariables(variables, artworkSort) {
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

async function processArtworks(
  queryKey,
  id,
  label,
  maxPages,
  perItemProgress,
  artworkSort,
  skipPages,
) {
  let cursor = "";
  let artworkPage = 0;
  let downloaded = 0;
  const useBeforePagination = artworkSort === "latest";
  const effectivePages = maxPages - skipPages;
  const perPageProgress = effectivePages > 0 ? perItemProgress / effectivePages : 0.0;
  const scopeDesc = queryKey && id ? `${queryKey}=${id}` : "全站";

  log(`[PixAI] 处理${label}：${scopeDesc}，排序=${artworkSort}，跳过页数=${skipPages}`);

  while (artworkPage < maxPages) {
    if (artworkPage < skipPages) {
      log(`[PixAI] ${label} ${scopeDesc} 第 ${artworkPage + 1}/${maxPages} 页（跳过，仅获取游标）`);
    } else {
      log(`[PixAI] ${label} ${scopeDesc} 第 ${artworkPage + 1}/${maxPages} 页（有效第 ${artworkPage - skipPages + 1}/${effectivePages} 页）`);
    }

    const variables = { isSafeSearch: true };
    if (queryKey && id) variables[queryKey] = id;
    applyArtworkSortVariables(variables, artworkSort);
    if (cursor) variables[useBeforePagination ? "before" : "after"] = cursor;

    const res = await fetchGraphql(OPERATION_ARTWORKS, variables, ARTWORKS_QUERY);
    const artworks = res?.data?.artworks;
    if (!artworks) {
      log(`[PixAI] ${label} ${scopeDesc} 响应缺少 artworks，停止`);
      break;
    }

    const edges = arrayValue(artworks.edges);
    if (edges.length === 0) {
      log(artworkPage === 0
        ? `[PixAI] 警告：${label} ${scopeDesc} 无任何作品数据，跳过`
        : `[PixAI] ${label} ${scopeDesc} 当前页无数据，停止`);
      break;
    }
    log(`[PixAI] 作品页返回 ${edges.length} 条`);

    if (artworkPage >= skipPages) {
      downloaded += await processArtworksEdgesForDownload(
        edges,
        label,
        id,
        perPageProgress,
        false,
        downloaded,
      );
    }

    const pageInfo = artworks.pageInfo;
    if (!pageInfo) break;
    if (useBeforePagination) {
      if (pageInfo.hasPreviousPage !== true) {
        log(`[PixAI] ${label} ${scopeDesc} 无上一作品页`);
        break;
      }
      cursor = coerceStr(pageInfo.startCursor);
    } else {
      if (pageInfo.hasNextPage !== true) {
        log(`[PixAI] ${label} ${scopeDesc} 无下一作品页`);
        break;
      }
      cursor = coerceStr(pageInfo.endCursor);
    }
    if (!cursor) break;
    artworkPage += 1;
  }

  log(`[PixAI] ${label}处理完成：${scopeDesc}，排序=${artworkSort}，共下载 ${downloaded} 张`);
  return downloaded;
}

async function processAuthorArtworks(
  authorId,
  types,
  artworkTypeLabel,
  maxPages,
  perItemProgress,
  artworkSort,
  skipPages,
) {
  let cursor = "";
  let artworkPage = 0;
  let downloaded = 0;
  const useBeforePagination = artworkSort === "latest";
  const effectivePages = maxPages - skipPages;
  const perPageProgress = effectivePages > 0 ? perItemProgress / effectivePages : 0.0;
  const scopeDesc = `authorId=${authorId}, types=${artworkTypeLabel}`;

  log(`[PixAI] 处理作者流：${scopeDesc}，排序=${artworkSort}，跳过页数=${skipPages}`);

  while (artworkPage < maxPages) {
    if (artworkPage < skipPages) {
      log(`[PixAI] 作者流 ${scopeDesc} 第 ${artworkPage + 1}/${maxPages} 页（跳过，仅获取游标）`);
    } else {
      log(`[PixAI] 作者流 ${scopeDesc} 第 ${artworkPage + 1}/${maxPages} 页（有效第 ${artworkPage - skipPages + 1}/${effectivePages} 页）`);
    }

    const variables = { authorId, types };
    applyArtworkSortVariables(variables, artworkSort);
    if (cursor) variables[useBeforePagination ? "before" : "after"] = cursor;

    const res = await fetchGraphql(OPERATION_ARTWORKS, variables, ARTWORKS_QUERY);
    const artworks = res?.data?.artworks;
    if (!artworks) {
      log(`[PixAI] 作者流 ${scopeDesc} 响应缺少 artworks，停止`);
      break;
    }

    const edges = arrayValue(artworks.edges);
    if (edges.length === 0) {
      log(artworkPage === 0
        ? `[PixAI] 警告：作者流 ${scopeDesc} 无任何作品数据，跳过`
        : `[PixAI] 作者流 ${scopeDesc} 当前页无数据，停止`);
      break;
    }
    log(`[PixAI] 作者流作品页返回 ${edges.length} 条`);

    if (artworkPage >= skipPages) {
      downloaded += await processArtworksEdgesForDownload(
        edges,
        "作者",
        authorId,
        perPageProgress,
        false,
        downloaded,
      );
    }

    const pageInfo = artworks.pageInfo;
    if (!pageInfo) break;
    if (useBeforePagination) {
      if (pageInfo.hasPreviousPage !== true) {
        log(`[PixAI] 作者流 ${scopeDesc} 无上一作品页`);
        break;
      }
      cursor = coerceStr(pageInfo.startCursor);
    } else {
      if (pageInfo.hasNextPage !== true) {
        log(`[PixAI] 作者流 ${scopeDesc} 无下一作品页`);
        break;
      }
      cursor = coerceStr(pageInfo.endCursor);
    }
    if (!cursor) break;
    artworkPage += 1;
  }

  log(`[PixAI] 作者流处理完成：${scopeDesc}，排序=${artworkSort}，共下载 ${downloaded} 张`);
  return downloaded;
}

async function resolveTackId(codeName) {
  const codeNameStr = coerceStr(codeName);
  if (!codeNameStr) return "";

  const tack = await fetchTackByCodeName(codeNameStr);
  if (!tack) {
    log(`[PixAI] codeName=${codeNameStr} 未解析到 tack`);
    return "";
  }
  const tackId = coerceStr(tack.id);
  if (!tackId) {
    log(`[PixAI] codeName=${codeNameStr} 的 getTack 响应缺少 tack.id`);
    return "";
  }
  return tackId;
}

async function runGlobal(vars) {
  const maxGlobalPages = toInt(vars.max_global_pages, 5);
  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const skipArtworkPages = toInt(vars.skip_artwork_pages, 0);

  log(`[PixAI] 全站流：排序=${artworkSort}，最多 ${maxGlobalPages} 页，跳过 ${skipArtworkPages} 页`);
  const downloadCount = await processArtworks(
    "",
    "",
    "全站",
    maxGlobalPages,
    100.0,
    artworkSort,
    skipArtworkPages,
  );
  log(`[PixAI] 全站流结束：下载图片 ${downloadCount} 张`);
  if (downloadCount === 0) addProgress(100.0);
}

async function runTag(vars) {
  const tagCodeNames = arrayValue(vars.tag_code_names);
  const maxTagArtworkPages = toInt(vars.max_tag_artwork_pages, 3);
  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const skipArtworkPages = toInt(vars.skip_artwork_pages, 0);

  if (tagCodeNames.length === 0) {
    log("[PixAI] 未输入任何标签 codeName，结束");
    addProgress(100.0);
    return;
  }

  log(`[PixAI] 标签流：共 ${tagCodeNames.length} 个 codeName，每标签最多 ${maxTagArtworkPages} 页，跳过 ${skipArtworkPages} 页`);
  const perTagProgress = 100.0 / tagCodeNames.length;
  let downloadCount = 0;
  let resolvedCount = 0;

  for (let index = 0; index < tagCodeNames.length; index += 1) {
    const codeName = coerceStr(tagCodeNames[index]);
    log(`[PixAI] 处理标签 ${index + 1}/${tagCodeNames.length}：codeName=${codeName}`);
    const tagId = await resolveTackId(codeName);
    if (!tagId) {
      log(`[PixAI] 跳过标签：codeName=${codeName} 无效或未找到对应 tackId`);
      addProgress(perTagProgress);
      continue;
    }

    resolvedCount += 1;
    log(`[PixAI] codeName=${codeName} -> tackId=${tagId}`);
    downloadCount += await processArtworks(
      "tackId",
      tagId,
      "标签",
      maxTagArtworkPages,
      perTagProgress,
      artworkSort,
      skipArtworkPages,
    );
  }

  log(`[PixAI] 标签流结束：输入 codeName ${tagCodeNames.length} 个，解析成功 ${resolvedCount} 个，下载图片 ${downloadCount} 张`);
  if (downloadCount === 0) addProgress(100.0);
}

async function runAuthor(vars) {
  const authorId = coerceStr(vars.author_id);
  if (!authorId) {
    log("[PixAI] 未输入作者 ID，结束");
    addProgress(100.0);
    return;
  }

  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const skipArtworkPages = toInt(vars.skip_artwork_pages, 0);
  const maxAuthorArtworkPages = toInt(vars.max_author_artwork_pages, 5);
  const animated = coerceStr(vars.author_artwork_type) === "animated";
  const authorTypes = animated ? ["ANIMATED_ARTWORK"] : ["DEFAULT", "ALBUM"];
  const authorTypeLabel = animated ? "动图(ANIMATED_ARTWORK)" : "图片(DEFAULT+ALBUM)";

  log(`[PixAI] 作者流：authorId=${authorId}，类型=${authorTypeLabel}，排序=${artworkSort}，最多 ${maxAuthorArtworkPages} 页，跳过 ${skipArtworkPages} 页`);
  const downloadCount = await processAuthorArtworks(
    authorId,
    authorTypes,
    authorTypeLabel,
    maxAuthorArtworkPages,
    100.0,
    artworkSort,
    skipArtworkPages,
  );
  log(`[PixAI] 作者流结束：authorId=${authorId}，下载图片 ${downloadCount} 张`);
  if (downloadCount === 0) addProgress(100.0);
}

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
  const maxArtworkPagesRanking = toInt(vars.max_artwork_pages_ranking, 1);

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

async function runRanking(vars) {
  const rankType = coerceStr(vars.rank_type) || "artwork";
  const rankPeriod = coerceStr(vars.rank_period) || "today";
  if (rankType === "artwork" || rankType === "animated") {
    await runRankingArtworks(rankType, rankPeriod);
  } else {
    await runRankingModels(rankType, rankPeriod, vars);
  }
}

function applyModelSortVariables(variables, modelSort) {
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

async function runModel(vars) {
  const modelSort = coerceStr(vars.model_sort) || "trending";
  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const maxModelPages = toInt(vars.max_model_pages, 3);
  const skipModelPages = toInt(vars.skip_model_pages, 0);
  const maxArtworkPages = toInt(vars.max_artwork_pages, 1);
  const skipArtworkPages = toInt(vars.skip_artwork_pages, 0);
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

export async function crawl(_common, custom) {
  const vars = custom || {};
  setRequestHeaders();

  const crawlType = coerceStr(vars.crawl_type) || "global";
  if (crawlType === "global") {
    await runGlobal(vars);
  } else if (crawlType === "tag") {
    await runTag(vars);
  } else if (crawlType === "author") {
    await runAuthor(vars);
  } else if (crawlType === "ranking") {
    await runRanking(vars);
  } else {
    await runModel(vars);
  }

  log("[PixAI] 任务结束");
}
