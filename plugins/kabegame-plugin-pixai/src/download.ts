// 一页作品 edges → 落库。含下载地址挑选（media API vs 列表里的 PUBLIC url）、
// 详情补齐与进度分摊。
import { MEDIA_API_BASE } from "./consts";
import { fetchPixaiArtworkDetail, fetchPixaiComments } from "./api";
import { labelsFromArtworkDetail } from "./labels";
import { searchTextsFromDetail } from "./search-texts";
import type { PixaiArtworkDetail, PixaiArtworkEdge, PixaiArtworkNode, PixaiMetadataV2, PixaiUrlVariant } from "./types";
import { arrayValue, coerceStr, log } from "./util";
import { t } from "./i18n";

const { addProgress, createImageMetadata: createImageMetadataRow, downloadImage } = Kabegame;

function countPublicUrls(urls: unknown): number {
  let count = 0;
  for (const item of arrayValue<PixaiUrlVariant>(urls)) {
    if (item?.variant === "PUBLIC" && item?.url) count += 1;
  }
  return count;
}

/** 列表节点的下载媒体 id：动图优先取 videoMediaId，否则退回静图 mediaId。 */
function pickMediaIdForDownload(node: PixaiArtworkNode | null | undefined): string {
  const videoMediaId = coerceStr(node?.videoMediaId);
  if (videoMediaId) return videoMediaId;
  return coerceStr(node?.mediaId);
}

function pickVideoMediaIdForDownload(
  node: PixaiArtworkNode | null | undefined,
  artworkDetail: PixaiArtworkDetail | null | undefined,
): string {
  const detailVideoMediaId = coerceStr(artworkDetail?.videoMediaId);
  if (detailVideoMediaId) return detailVideoMediaId;
  return coerceStr(node?.videoMediaId);
}

/** 详情里有 videoMediaId 就一律换成视频地址，否则用调用方给的默认 url。 */
function pickArtworkDownloadUrl(
  defaultUrl: unknown,
  node: PixaiArtworkNode | null | undefined,
  artworkDetail: PixaiArtworkDetail | null | undefined,
): string {
  const videoMediaId = pickVideoMediaIdForDownload(node, artworkDetail);
  if (videoMediaId) return `${MEDIA_API_BASE}${videoMediaId}/image`;
  return coerceStr(defaultUrl);
}

function createImageMetadata(metadata: PixaiMetadataV2): number {
  return Number(createImageMetadataRow(metadata, { searchTexts: searchTextsFromDetail(metadata.v2) }));
}

async function downloadArtwork(
  finalDownloadUrl: string,
  artworkDetail: PixaiArtworkDetail,
  displayName: string,
  pixaiUrl: string,
): Promise<void> {
  const metadataId = createImageMetadata({ v2: artworkDetail });
  const labels: KabegameLabelInput[] = labelsFromArtworkDetail(artworkDetail);
  const opts: KabegameDownloadImageOptions = {
    name: displayName,
    metadata_id: metadataId,
    url: pixaiUrl,
    labels,
  };
  await downloadImage(finalDownloadUrl, opts);
}

/** 列表节点只有标题和媒体 id，入库要的 tacks/author/prompts 都在详情里，故逐条补齐。 */
async function enrichArtworkDetail(
  artworkId: unknown,
  fallbackTitle: string,
): Promise<PixaiArtworkDetail | null> {
  const detail = await fetchPixaiArtworkDetail(artworkId);
  if (!detail) {
    log(t("skipArtworkNoDetail", { artworkId }), "warn");
    return null;
  }
  detail.comments = await fetchPixaiComments(artworkId);
  if (!coerceStr(detail.title) && fallbackTitle) {
    detail.title = fallbackTitle;
  }
  return detail;
}

/**
 * 下载一页作品。
 * useMediaApi=true 走 media API（排行榜用，列表不返回 media.urls）；
 * false 则取列表节点里的 PUBLIC url。
 */
export async function processArtworksEdgesForDownload(
  edges: unknown,
  label: string,
  contextId: string,
  progressBudget: number,
  useMediaApi: boolean,
  downloadedOffset: number,
): Promise<number> {
  const artworkEdges = arrayValue<PixaiArtworkEdge>(edges);
  if (artworkEdges.length === 0) return 0;

  let downloaded = 0;
  if (useMediaApi) {
    const countOk = artworkEdges.filter((edge) => pickMediaIdForDownload(edge?.node)).length;
    log(t("mediaApiAvailable", { label, contextId, ok: countOk, total: artworkEdges.length }));
    const progressPer = countOk > 0 ? progressBudget / countOk : 0.0;

    for (let edgeIndex = 0; edgeIndex < artworkEdges.length; edgeIndex += 1) {
      const node = artworkEdges[edgeIndex]?.node;
      const mediaId = pickMediaIdForDownload(node);
      if (!mediaId) continue;

      const title = coerceStr(node?.title);
      const artworkId = coerceStr(node?.id);
      log(
        t("downloadingArtwork", {
          label,
          contextId,
          index: downloadedOffset + downloaded + 1,
          edgeIndex: edgeIndex + 1,
          total: artworkEdges.length,
          title,
        }),
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
  log(t("publicImageCount", { label, contextId, count: publicCount }));
  const progressPerDownload = publicCount > 0 ? progressBudget / publicCount : 0.0;

  for (let edgeIndex = 0; edgeIndex < artworkEdges.length; edgeIndex += 1) {
    const node = artworkEdges[edgeIndex]?.node;
    const urls = arrayValue<PixaiUrlVariant>(node?.media?.urls);
    const publicUrl = urls.find((item) => item?.variant === "PUBLIC" && item?.url)?.url;
    if (!publicUrl) continue;

    const title = coerceStr(node?.title);
    const artworkId = coerceStr(node?.id);
    log(
      t("downloadingArtwork", {
        label,
        contextId,
        index: downloadedOffset + downloaded + 1,
        edgeIndex: edgeIndex + 1,
        total: artworkEdges.length,
        title,
      }),
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
