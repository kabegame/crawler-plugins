// 传统专栏（cv）：view 接口取正文、正则抠图、评论入 metadata、逐图入库。
// buildArticleMetadata 同时被 opus 复用（opus 关联到 cv 时共享同一套元数据结构）。
import { VIEW_API } from "./consts";
import { t } from "./i18n";
import { labelsFromMetadata, searchTextsFromMetadata } from "./metadata-derived";
import { fetchArticleReplies, type ArticleReplies, type ReplySummary } from "./replies";
import {
  checkBilibiliRisk, coerceStr, collectImageUrlsFromContent, fetchWith509Retry, type BilibiliResponse,
} from "./util";
import { signUrl } from "./wbi";

const { addProgress, createImageMetadata, downloadImage, warn } = Kabegame;

// 站点 JSON 的最小结构：字段都可能缺失，只在确实依赖处收窄。
type ArticleAuthor = {
  mid?: number | null;
  name?: string | null;
  face?: string | null;
  fans?: number | null;
  level?: number | null;
};

type ArticleStats = {
  view?: number | null;
  like?: number | null;
  reply?: number | null;
  favorite?: number | null;
  coin?: number | null;
  share?: number | null;
};

type ArticleTag = {
  name?: string | null;
};

type ArticleCategory = {
  name?: string | null;
};

/** 专栏 view 接口 data 段（opus 关联 cv 时复用）。 */
export type ArticleViewData = {
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  publish_time?: number | null;
  author?: ArticleAuthor | null;
  stats?: ArticleStats | null;
  tags?: ArticleTag[] | null;
  categories?: ArticleCategory[] | null;
};

export type ArticleViewResponse = BilibiliResponse<ArticleViewData>;

/** 写入 metadata 的完整结构（必须是 JSON 可序列化，故用 type 而非 interface）。 */
export type ArticleMetadata = {
  source: string;
  cvid: string;
  title: string;
  desc: string;
  publish_time: number;
  // 接口缺失的透传字段保持 undefined（序列化时与原行为一样被丢弃），不做 null 归一。
  author: {
    mid?: number | null;
    name: string;
    face: string;
    fans?: number | null;
    level?: number | null;
  };
  stats: {
    view?: number | null;
    like?: number | null;
    reply?: number | null;
    favorite?: number | null;
    coin?: number | null;
    share?: number | null;
  };
  tags: { name: string }[];
  categories: { name: string }[];
  reply_total: number;
  replies: ReplySummary[];
  total_image_count: number;
  opus_id?: string;
};

export function signViewUrl(cvId: string, img: string, sub: string): string {
  return signUrl(VIEW_API, [
    ["gaia_source", "main_web"],
    ["id", coerceStr(cvId)],
    ["web_location", "333.976"],
    ["wts", String(Math.floor(Date.now() / 1000))],
  ], img, sub);
}

export function buildArticleMetadata(
  vd: ArticleViewData | null | undefined,
  cvId: string,
  searchDesc: unknown,
  repliesData: ArticleReplies | null | undefined,
  totalImageCount: number,
  opusId: string,
): ArticleMetadata {
  const authorRaw: ArticleAuthor = vd?.author || {};
  const statsRaw: ArticleStats = vd?.stats || {};
  const rawTags = vd?.tags;
  const rawCategories = vd?.categories;
  const metadata: ArticleMetadata = {
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
    tags: (Array.isArray(rawTags) ? rawTags : []).map((tag) => ({ name: coerceStr(tag?.name) })),
    categories: (Array.isArray(rawCategories) ? rawCategories : []).map((cat) => ({ name: coerceStr(cat?.name) })),
    reply_total: Number(repliesData?.total ?? 0),
    replies: Array.isArray(repliesData?.replies) ? repliesData.replies : [],
    total_image_count: totalImageCount,
  };
  if (opusId) metadata.opus_id = opusId;
  return metadata;
}

export async function processOneCv(
  cvId: string,
  img: string,
  sub: string,
  perCv: number,
  searchDesc: string,
): Promise<void> {
  const view = await fetchWith509Retry<ArticleViewResponse>(
    () => signViewUrl(cvId, img, sub),
    `cv ${cvId} view`,
  );
  if (view?.code !== 0) {
    checkBilibiliRisk(view?.code);
    warn(t("cvViewFailed", { cvId, message: coerceStr(view?.message) }));
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
  const metadataId = Number(createImageMetadata(metadata, { searchTexts: searchTextsFromMetadata(metadata) }));
  const labels = labelsFromMetadata(metadata);
  const perImage = perCv / imgs.length;
  const cvPageUrl = `https://www.bilibili.com/read/cv${cvId}`;
  for (let index = 0; index < imgs.length; index += 1) {
    const name = imgs.length > 1
      ? `${subject || `cv${cvId}`}(${index + 1})`
      : (subject || `cv${cvId}`);
    const opts: KabegameDownloadImageOptions = { name, metadata_id: metadataId, url: cvPageUrl };
    if (labels.length > 0) opts.labels = labels;
    await downloadImage(imgs[index], opts);
    addProgress(perImage);
  }
}
