// 单个视频的完整下载链路：view → playurl → 分块下载 → 合流 → 入库。
// 对应 yt-dlp `BiliBiliIE._real_extract` + 它交给 ffmpeg 的 merge 步骤。
import { sleep } from "@kabegame/plugin-sdk";

import { FNVAL_DASH, PLAYURL_API, VIEW_API, WEB_BASE } from "./consts";
import { t } from "./i18n";
import { ingestDash } from "./ingest";
import type {
  BilibiliVars,
  Dash,
  DashStream,
  FormatMetadata,
  PlayDataWithFormats,
  TaggedError,
  VideoRef,
  WbiKeysState,
} from "./types";
import {
  checkBilibiliRisk,
  coerceStr,
  errorMessage,
  fetchJson,
  hasNoRetry,
  isUnavailableTitle,
  nowSeconds,
} from "./util";
import { buildDmParams, signQuery } from "./wbi";

const { warn } = Kabegame;

/** view 接口（x/web-interface/view）的最小结构。 */
type BiliOwner = {
  mid?: number | null;
  name?: string | null;
  face?: string | null;
};

type BiliStat = {
  view?: number | null;
  danmaku?: number | null;
  reply?: number | null;
  favorite?: number | null;
  coin?: number | null;
  share?: number | null;
  like?: number | null;
};

type BiliPage = {
  cid?: number | null;
  page?: number | null;
  part?: string | null;
  duration?: number | null;
};

type BiliView = {
  bvid?: string | null;
  aid?: number | null;
  cid?: number | null;
  title?: string | null;
  desc?: string | null;
  duration?: number | null;
  pubdate?: number | null;
  owner?: BiliOwner | null;
  stat?: BiliStat | null;
  pages?: BiliPage[] | null;
};

type ViewResponse = {
  code?: number | null;
  message?: string | null;
  data?: BiliView | null;
};

type PlayurlData = PlayDataWithFormats & {
  dash?: Dash | null;
};

type PlayurlResponse = {
  code?: number | null;
  message?: string | null;
  data?: PlayurlData | null;
};

/** metadata 的 owner / stat 段。字段可能缺失，保持 undefined 而非补 null。 */
type VideoMetadataOwner = {
  mid?: number | null;
  name: string;
  face: string;
};

type VideoMetadataStat = {
  view?: number | null;
  danmaku?: number | null;
  reply?: number | null;
  favorite?: number | null;
  coin?: number | null;
  share?: number | null;
  like?: number | null;
};

type VideoMetadata = {
  schema: number;
  source: string;
  bvid: string;
  aid?: number | null;
  cid: string;
  page: number;
  title: string;
  part: string;
  desc: string;
  duration: number;
  pubdate: number;
  owner: VideoMetadataOwner;
  stat: VideoMetadataStat;
  format: FormatMetadata;
};

function buildMetadata(
  view: BiliView | null | undefined,
  page: BiliPage | null | undefined,
  video: DashStream,
  audio: DashStream,
  qualityLabel: string,
): VideoMetadata {
  return {
    schema: 1,
    source: "bilibili_video",
    bvid: coerceStr(view?.bvid),
    aid: view?.aid,
    cid: coerceStr(page?.cid),
    page: Number(page?.page ?? 1),
    title: coerceStr(view?.title),
    part: coerceStr(page?.part),
    desc: coerceStr(view?.desc),
    duration: Number(page?.duration ?? view?.duration ?? 0),
    pubdate: Number(view?.pubdate ?? 0),
    owner: {
      mid: view?.owner?.mid,
      name: coerceStr(view?.owner?.name),
      face: coerceStr(view?.owner?.face),
    },
    stat: {
      view: view?.stat?.view,
      danmaku: view?.stat?.danmaku,
      reply: view?.stat?.reply,
      favorite: view?.stat?.favorite,
      coin: view?.stat?.coin,
      share: view?.stat?.share,
      like: view?.stat?.like,
    },
    format: {
      quality: Number(video.id ?? 0),
      quality_label: qualityLabel,
      codecs: coerceStr(video.codecs),
      width: Number(video.width ?? 0),
      height: Number(video.height ?? 0),
      frame_rate: coerceStr(video.frameRate || video.frame_rate),
      audio_codecs: coerceStr(audio.codecs),
    },
  };
}

/** 下载一个分 P。budget 是本 P 可用的进度额度。 */
async function processPart(
  view: BiliView | null | undefined,
  page: BiliPage | null | undefined,
  keys: WbiKeysState,
  vars: BilibiliVars,
  budget: number,
): Promise<void> {
  const bvid = coerceStr(view?.bvid);
  const cid = coerceStr(page?.cid);
  const partIndex = Number(page?.page ?? 1);
  const isMultiPart = (view?.pages?.length ?? 1) > 1;
  const title = coerceStr(view?.title);
  const partName = coerceStr(page?.part);
  const displayName = isMultiPart
    ? `${title} - P${partIndex}${partName && partName !== title ? ` ${partName}` : ""}`
    : title;

  const playParams: Record<string, string> = {
    bvid,
    cid,
    fnval: String(FNVAL_DASH),
    fourk: "1",
    wts: String(nowSeconds()),
    ...buildDmParams(),
  };
  // yt-dlp: 已登录时去掉 try_look（试看参数），未登录靠它拿到更高档位。
  if (!keys.isLoggedIn) playParams.try_look = "1";

  const play = await fetchJson<PlayurlResponse>(
    signQuery(PLAYURL_API, playParams, keys.img, keys.sub),
  );
  if (play?.code !== 0) {
    checkBilibiliRisk(play?.code);
    throw new Error(t("playurlFailed", { code: play?.code, message: coerceStr(play?.message) }));
  }

  const dash = play?.data?.dash;
  if (!dash) {
    throw new Error(t("ugcNoDash"));
  }

  const pageUrl = isMultiPart
    ? `${WEB_BASE}/video/${bvid}?p=${partIndex}`
    : `${WEB_BASE}/video/${bvid}`;
  await ingestDash({
    dash,
    formatSource: play?.data,
    displayName,
    stem: `${bvid}_${cid}`,
    pageUrl,
    buildMeta: (video, audio, qualityLabel) => buildMetadata(view, page, video, audio, qualityLabel),
    vars,
    budget,
  });
}

/** partIndex：1 起的分 P 序号，0 表示全部分 P。 */
async function downloadOneVideo(
  videoRef: VideoRef,
  keys: WbiKeysState,
  vars: BilibiliVars,
  budget: number,
  partIndex: number,
): Promise<void> {
  const query = videoRef.bvid ? `bvid=${videoRef.bvid}` : `aid=${videoRef.aid}`;
  const view = await fetchJson<ViewResponse>(`${VIEW_API}?${query}`);
  if (view?.code !== 0) {
    checkBilibiliRisk(view?.code);
    throw new Error(t("viewFailed", { code: view?.code, message: coerceStr(view?.message) }));
  }

  const data = view.data;
  // 失效稿件会返回一段占位视频，下下来毫无意义；重试也不会变好，所以标记 noRetry。
  if (isUnavailableTitle(data?.title)) {
    const dead: TaggedError = new Error(t("videoUnavailable", { title: coerceStr(data?.title) }));
    dead.noRetry = true;
    throw dead;
  }

  const pageList = data?.pages;
  const allPages: BiliPage[] = Array.isArray(pageList) && pageList.length > 0
    ? pageList
    : [{ cid: data?.cid, page: 1, part: coerceStr(data?.title), duration: data?.duration }];

  let pages: BiliPage[];
  if (partIndex === 0) {
    pages = allPages;
  } else {
    const found = allPages.find((p) => Number(p?.page ?? 0) === partIndex);
    if (!found) throw new Error(t("partOutOfRange", { total: allPages.length, part: partIndex }));
    pages = [found];
  }

  console.log(t("videoSummary", {
    bvid: coerceStr(data?.bvid),
    title: coerceStr(data?.title),
    total: allPages.length,
    count: pages.length,
  }));

  const perPart = budget / pages.length;
  let failed = 0;
  for (const page of pages) {
    try {
      await processPart(data, page, keys, vars, perPart);
    } catch (error) {
      failed += 1;
      warn(t("partFailed", { part: Number(page?.page ?? 0), error: errorMessage(error) }));
      if (pages.length === 1) throw error;
    }
  }
  if (failed > 0 && failed === pages.length) throw new Error(t("allPartsFailed"));
}

/** 单个视频失败后等 intervalMs 再重试，最多 retries 次。 */
export async function downloadWithRetry(
  videoRef: VideoRef,
  keys: WbiKeysState,
  vars: BilibiliVars,
  budget: number,
  partIndex: number,
  intervalMs: number,
  retries: number,
): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await downloadOneVideo(videoRef, keys, vars, budget, partIndex);
      return;
    } catch (error) {
      // noRetry：失效稿件之类重试也不会变好的情形，直接上抛。
      if (attempt >= retries || hasNoRetry(error)) throw error;
      const label = videoRef.bvid || `av${videoRef.aid}`;
      warn(t("retryLater", {
        label,
        error: errorMessage(error),
        seconds: Math.round(intervalMs / 1000),
        attempt: attempt + 1,
        total: retries,
      }));
      await sleep(intervalMs);
    }
  }
}
