// @ts-nocheck
// 传统专栏（cv）：view 接口取正文、正则抠图、评论入 metadata、逐图入库。
// buildArticleMetadata 同时被 opus 复用（opus 关联到 cv 时共享同一套元数据结构）。
import { VIEW_API } from "./consts";
import { fetchArticleReplies } from "./replies";
import {
  checkBilibiliRisk, coerceStr, collectImageUrlsFromContent, fetchWith509Retry,
} from "./util";
import { signUrl } from "./wbi";

const { addProgress, createImageMetadata, downloadImage, warn } = Kabegame;

export function signViewUrl(cvId, img, sub) {
  return signUrl(VIEW_API, [
    ["gaia_source", "main_web"],
    ["id", coerceStr(cvId)],
    ["web_location", "333.976"],
    ["wts", String(Math.floor(Date.now() / 1000))],
  ], img, sub);
}

export function buildArticleMetadata(vd, cvId, searchDesc, repliesData, totalImageCount, opusId) {
  const authorRaw = vd?.author || {};
  const statsRaw = vd?.stats || {};
  const metadata = {
    source: "bilibili_article",
    cvid: cvId,
    title: coerceStr(vd?.title),
    desc: coerceStr(searchDesc) || coerceStr(vd?.summary),
    publish_time: Number(vd?.publish_time ?? 0),
    author: {
      mid: authorRaw.mid,
      name: coerceStr(authorRaw.name),
      face: coerceStr(authorRaw.face),
      fans: authorRaw.fans,
      level: authorRaw.level,
    },
    stats: {
      view: statsRaw.view,
      like: statsRaw.like,
      reply: statsRaw.reply,
      favorite: statsRaw.favorite,
      coin: statsRaw.coin,
      share: statsRaw.share,
    },
    tags: (Array.isArray(vd?.tags) ? vd.tags : []).map((tag) => ({ name: coerceStr(tag?.name) })),
    categories: (Array.isArray(vd?.categories) ? vd.categories : []).map((cat) => ({ name: coerceStr(cat?.name) })),
    reply_total: Number(repliesData?.total ?? 0),
    replies: Array.isArray(repliesData?.replies) ? repliesData.replies : [],
    total_image_count: totalImageCount,
  };
  if (opusId) metadata.opus_id = opusId;
  return metadata;
}

export async function processOneCv(cvId, img, sub, perCv, searchDesc) {
  const view = await fetchWith509Retry(
    () => signViewUrl(cvId, img, sub),
    `cv ${cvId} view`,
  );
  if (view?.code !== 0) {
    checkBilibiliRisk(view?.code);
    warn(`cv ${cvId} view 失败: ${coerceStr(view?.message)}`);
    addProgress(perCv);
    return;
  }
  const vd = view.data;
  const imgs = collectImageUrlsFromContent(vd?.content);
  if (imgs.length === 0) {
    addProgress(perCv);
    return;
  }
  const repliesData = await fetchArticleReplies(cvId, img, sub);
  const subject = coerceStr(vd?.title);
  const metadata = buildArticleMetadata(vd, cvId, searchDesc, repliesData, imgs.length, "");
  // 同篇多图共享一份 metadata：先建一次，下载时只传 metadata_id。
  const metadataId = Number(createImageMetadata(metadata, null));
  const perImage = perCv / imgs.length;
  const cvPageUrl = `https://www.bilibili.com/read/cv${cvId}`;
  for (let index = 0; index < imgs.length; index += 1) {
    const name = imgs.length > 1
      ? `${subject || `cv${cvId}`}(${index + 1})`
      : (subject || `cv${cvId}`);
    await downloadImage(imgs[index], { name, metadata_id: metadataId, url: cvPageUrl });
    addProgress(perImage);
  }
}
