// @ts-nocheck
// 单个视频的完整下载链路：view → playurl → 分块下载 → 合流 → 入库。
// 对应 yt-dlp `BiliBiliIE._real_extract` + 它交给 ffmpeg 的 merge 步骤。
import { sleep } from "@kabegame/plugin-sdk";

import { FNVAL_DASH, PLAYURL_API, VIEW_API, WEB_BASE } from "./consts";
import { pickAudio, pickVideo, qualityLabels, streamUrls } from "./formats";
import { checkBilibiliRisk, coerceStr, fetchJson, isUnavailableTitle, nowSeconds } from "./util";
import { downloadStreamToVfs, removeQuietly } from "./vfs";
import { buildDmParams, signQuery } from "./wbi";

const { addProgress, downloadImage, ffmpeg, fs, warn } = Kabegame;

function buildMetadata(view, page, video, audio, qualityLabel) {
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
async function processPart(view, page, keys, vars, budget) {
  const bvid = coerceStr(view?.bvid);
  const cid = coerceStr(page?.cid);
  const partIndex = Number(page?.page ?? 1);
  const isMultiPart = (view?.pages?.length ?? 1) > 1;
  const title = coerceStr(view?.title);
  const partName = coerceStr(page?.part);
  const displayName = isMultiPart
    ? `${title} - P${partIndex}${partName && partName !== title ? ` ${partName}` : ""}`
    : title;

  const playParams = {
    bvid,
    cid,
    fnval: String(FNVAL_DASH),
    fourk: "1",
    wts: String(nowSeconds()),
    ...buildDmParams(),
  };
  // yt-dlp: 已登录时去掉 try_look（试看参数），未登录靠它拿到更高档位。
  if (!keys.isLoggedIn) playParams.try_look = "1";

  const play = await fetchJson(signQuery(PLAYURL_API, playParams, keys.img, keys.sub));
  if (play?.code !== 0) {
    checkBilibiliRisk(play?.code);
    throw new Error(`playurl 失败（${play?.code}）: ${coerceStr(play?.message)}`);
  }

  const dash = play?.data?.dash;
  if (!dash) {
    throw new Error("playurl 未返回 DASH 流（可能是番剧/课程等需要专用接口的内容）");
  }

  const video = pickVideo(dash, Number(vars.max_quality ?? 0), vars.prefer_avc !== false);
  const audio = pickAudio(dash);
  if (!video) throw new Error("playurl 未返回可用视频流");
  if (!audio) throw new Error("playurl 未返回可用音频流");

  const qualityLabel = qualityLabels(play?.data)[Number(video.id ?? 0)] || `quality ${video.id}`;
  console.log(
    `[bilibili-video] ▶ ${displayName}：${qualityLabel} / ${video.width}x${video.height} / ${coerceStr(video.codecs)}`,
  );

  const root = fs.getRoot();
  const stem = `${bvid}_${cid}`;
  const videoPath = `${root}/tmp/${stem}.video.m4s`;
  const audioPath = `${root}/tmp/${stem}.audio.m4s`;
  const outputPath = `${root}/tmp/${stem}.mp4`;

  try {
    // 进度切分：视频 60% / 音频 20% / 合流 10% / 入库 10%。
    let reported = 0;
    const reportChunk = (share) => (received, total) => {
      const step = (received / total) * budget * share;
      reported += step;
      addProgress(step);
    };

    await downloadStreamToVfs(
      streamUrls(video), videoPath, Number(video.size ?? 0), `${displayName} 视频流`, reportChunk(0.6),
    );
    await downloadStreamToVfs(
      streamUrls(audio), audioPath, Number(audio.size ?? 0), `${displayName} 音频流`, reportChunk(0.2),
    );

    await ffmpeg.muxStreams([videoPath, audioPath], outputPath);
    addProgress(budget * 0.1);
    reported += budget * 0.1;

    const probe = await ffmpeg.probe(outputPath);
    if (probe && !probe.browserSafe) {
      warn(`${displayName} 合流结果不是浏览器可直接播放的编码（${probe.mimeType}），画廊可能只显示缩略图。`);
    }

    const pageUrl = isMultiPart
      ? `${WEB_BASE}/video/${bvid}?p=${partIndex}`
      : `${WEB_BASE}/video/${bvid}`;
    await downloadImage(outputPath, {
      name: displayName,
      metadata: buildMetadata(view, page, video, audio, qualityLabel),
      url: pageUrl,
    });

    // 补齐本 P 剩余额度（分块进度是估算，未必刚好加满）。
    addProgress(Math.max(0, budget - reported));
    console.log(`[bilibili-video] ◀ ${displayName} 已提交下载队列`);
  } finally {
    // 合流产物 outputPath 交给下次任务开头的 cleanupStaleTmp 清理，见 vfs.ts。
    await removeQuietly(videoPath);
    await removeQuietly(audioPath);
  }
}

/** partIndex：1 起的分 P 序号，0 表示全部分 P。 */
async function downloadOneVideo(videoRef, keys, vars, budget, partIndex) {
  const query = videoRef.bvid ? `bvid=${videoRef.bvid}` : `aid=${videoRef.aid}`;
  const view = await fetchJson(`${VIEW_API}?${query}`);
  if (view?.code !== 0) {
    checkBilibiliRisk(view?.code);
    throw new Error(`view 接口失败（${view?.code}）: ${coerceStr(view?.message)}`);
  }

  const data = view.data;
  // 失效稿件会返回一段占位视频，下下来毫无意义；重试也不会变好，所以标记 noRetry。
  if (isUnavailableTitle(data?.title)) {
    const dead = new Error(`稿件已失效（标题为「${coerceStr(data?.title)}」），跳过`);
    dead.noRetry = true;
    throw dead;
  }

  const allPages = Array.isArray(data?.pages) && data.pages.length > 0
    ? data.pages
    : [{ cid: data?.cid, page: 1, part: coerceStr(data?.title), duration: data?.duration }];

  let pages;
  if (partIndex === 0) {
    pages = allPages;
  } else {
    const found = allPages.find((p) => Number(p?.page ?? 0) === partIndex);
    if (!found) throw new Error(`该视频只有 ${allPages.length} 个分 P，没有第 ${partIndex} P`);
    pages = [found];
  }

  console.log(
    `[bilibili-video] ${coerceStr(data?.bvid)} 「${coerceStr(data?.title)}」共 ${allPages.length} P，本次下载 ${pages.length} P`,
  );

  const perPart = budget / pages.length;
  let failed = 0;
  for (const page of pages) {
    try {
      await processPart(data, page, keys, vars, perPart);
    } catch (error) {
      failed += 1;
      warn(`P${Number(page?.page ?? 0)} 下载失败：${coerceStr(error?.message ?? error)}`);
      if (pages.length === 1) throw error;
    }
  }
  if (failed > 0 && failed === pages.length) throw new Error("所有分 P 均下载失败");
}

/** 单个视频失败后等 intervalMs 再重试，最多 retries 次。 */
export async function downloadWithRetry(videoRef, keys, vars, budget, partIndex, intervalMs, retries) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await downloadOneVideo(videoRef, keys, vars, budget, partIndex);
      return;
    } catch (error) {
      // noRetry：失效稿件之类重试也不会变好的情形，直接上抛。
      if (attempt >= retries || error?.noRetry) throw error;
      const label = videoRef.bvid || `av${videoRef.aid}`;
      warn(
        `${label} 下载失败（${coerceStr(error?.message ?? error)}），`
        + `${Math.round(intervalMs / 1000)}s 后重试（第 ${attempt + 1}/${retries} 次）`,
      );
      await sleep(intervalMs);
    }
  }
}
