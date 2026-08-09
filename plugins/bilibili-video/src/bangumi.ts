// @ts-nocheck
// 番剧 / 剧集（PGC）下载。对应 yt-dlp 的 BiliBiliBangumiIE / BiliBiliBangumiSeasonIE /
// BiliBiliBangumiMediaIE（ignore/yt-dlp/yt_dlp/extractor/bilibili.py）。
//
// 与 UGC（video.ts）的差异：
//   - 接口是另一套 PGC 端点，不吃 WBI 签名；
//   - 元数据来自 pgc/view/web/season（series / season / episode 三层），一次给全季；
//   - playurl 响应有多种嵌套形态，且有三重门禁：地区限制、大会员专享（-10403）、
//     试看态（play_detail=PLAY_PREVIEW，code 仍是 0 但只给 6 分钟片段或干脆不给流）。
//     试看片段入库毫无意义，所以会员集在无权观看时一律跳过而不下载。
import { sleep } from "@kabegame/plugin-sdk";

import {
  BANGUMI_MEDIA_API, BANGUMI_PLAYURL_API, BANGUMI_SEASON_API, FNVAL_BANGUMI, WEB_BASE,
} from "./consts";
import { ingestDash } from "./ingest";
import { checkBilibiliRisk, coerceStr, fetchJson } from "./util";

const { addProgress, warn } = Kabegame;

/** 从链接或编号解析 ep / ss / md。ep 优先：播放页链接同时含 ss 时以 ep 为准。 */
export function parseBangumiId(raw) {
  const work = coerceStr(raw).trim();
  const ep = work.match(/(?:^|\/)ep(\d+)/i)?.[1];
  if (ep) return { kind: "ep", id: ep };
  const ss = work.match(/(?:^|\/)ss(\d+)/i)?.[1];
  if (ss) return { kind: "ss", id: ss };
  const md = work.match(/(?:^|\/)md(\d+)/i)?.[1];
  if (md) return { kind: "md", id: md };
  return { kind: "", id: "" };
}

/** season 信息：ep_id / season_id 均可查，返回整季（正片 episodes + seasons + section）。 */
async function fetchSeason(query, referer) {
  const json = await fetchJson(`${BANGUMI_SEASON_API}?${query}`, { Referer: referer });
  if (json?.code !== 0) {
    checkBilibiliRisk(json?.code);
    throw new Error(`番剧 season 接口失败（${json?.code}）: ${coerceStr(json?.message)}`);
  }
  return json.result;
}

/** md（剧集页）没有直接的剧集列表接口，先经 review/user 换出 season_id。 */
async function mediaToSeasonId(mdId) {
  const json = await fetchJson(
    `${BANGUMI_MEDIA_API}?media_id=${mdId}`,
    { Referer: `${WEB_BASE}/bangumi/media/md${mdId}` },
  );
  if (json?.code !== 0) {
    checkBilibiliRisk(json?.code);
    throw new Error(`番剧 media 接口失败（${json?.code}）: ${coerceStr(json?.message)}`);
  }
  const ssId = json?.result?.media?.season_id;
  if (!ssId) throw new Error(`md${mdId} 未关联任何季（season_id 缺失）`);
  return String(ssId);
}

/**
 * PGC playurl。响应嵌套形态不止一种（yt-dlp 记录了三种：result.video_info /
 * raw.data.video_info / data.result.video_info），这里照它的顺序归一。
 */
async function fetchEpisodePlayInfo(epId) {
  const json = await fetchJson(
    `${BANGUMI_PLAYURL_API}?fnval=${FNVAL_BANGUMI}&ep_id=${epId}`,
    { Referer: `${WEB_BASE}/bangumi/play/ep${epId}` },
  );
  let info = json;
  let code = info?.code;
  if (info?.raw) info = info.raw;
  if (info?.data) info = info.data;
  if (code == null) code = info?.code;
  if (info?.result) info = info.result;
  return { code, info };
}

/** 集的展示名：优先接口给的 show_title（如「第1话 残酷」），缺了就自己拼。 */
function episodeDisplayName(season, ep) {
  const epLabel = coerceStr(ep?.show_title)
    || [coerceStr(ep?.title), coerceStr(ep?.long_title)].filter(Boolean).join(" ");
  const seasonTitle = coerceStr(season?.title);
  return epLabel && seasonTitle ? `${seasonTitle} ${epLabel}` : (epLabel || seasonTitle || `ep${ep?.id}`);
}

function buildEpisodeMetadata(season, ep, video, audio, qualityLabel) {
  return {
    schema: 1,
    source: "bilibili_bangumi",
    ep_id: Number(ep?.id ?? 0),
    aid: ep?.aid,
    bvid: coerceStr(ep?.bvid),
    cid: coerceStr(ep?.cid),
    title: coerceStr(season?.title),
    episode: coerceStr(ep?.long_title),
    episode_number: coerceStr(ep?.title),
    season_id: season?.season_id,
    season_title: coerceStr(season?.season_title),
    series_id: season?.series?.series_id,
    series_title: coerceStr(season?.series?.series_title),
    pub_time: Number(ep?.pub_time ?? 0),
    duration: Math.round(Number(ep?.duration ?? 0) / 1000),
    cover: coerceStr(ep?.cover),
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

/** 下载一集。会员专享/地区限制抛 noRetry 错误（前者带 skipEpisode 标记，整季模式计为跳过）。 */
async function processEpisode(season, ep, vars, budget) {
  const epId = String(ep?.id ?? "");
  const displayName = episodeDisplayName(season, ep);
  const { code, info } = await fetchEpisodePlayInfo(epId);
  const videoInfo = info?.video_info || {};

  // 门禁一：地区限制（yt-dlp：plugins 里出现 AreaLimitPanel 且 is_block）。
  const geoBlocked = (info?.plugins || []).some(
    (p) => p?.name === "AreaLimitPanel" && p?.config?.is_block,
  );
  if (geoBlocked) {
    const error = new Error(`${displayName} 有地区限制，当前网络所在地区不可观看`);
    error.noRetry = true;
    throw error;
  }

  // 门禁二：大会员专享。-10403 是直接拒绝；试看态 code 仍为 0，只按标志识别
  // （实测未登录拉会员集：play_detail=PLAY_PREVIEW、is_preview=1 且 dash 为空）。
  const preview = info?.play_check?.play_detail === "PLAY_PREVIEW"
    || info?.play_video_type === "preview"
    || Number(videoInfo?.is_preview ?? 0) === 1;
  if (code === -10403 || preview) {
    const error = new Error(
      `${displayName} 为大会员专享，当前登录态无权观看完整版（试看片段不入库），跳过。`
      + `如已开通大会员请先在畅游登录 bilibili。`,
    );
    error.noRetry = true;
    error.skipEpisode = true;
    throw error;
  }

  if (code !== 0) {
    checkBilibiliRisk(code);
    throw new Error(`番剧 playurl 失败（${code}）: ${coerceStr(info?.message)}`);
  }

  const dash = videoInfo?.dash;
  if (!dash || !(dash.video || []).length) {
    throw new Error("番剧 playurl 未返回 DASH 流");
  }

  await ingestDash({
    dash,
    formatSource: videoInfo,
    displayName,
    stem: `ep${epId}`,
    pageUrl: coerceStr(ep?.share_url) || `${WEB_BASE}/bangumi/play/ep${epId}`,
    buildMeta: (video, audio, qualityLabel) => buildEpisodeMetadata(season, ep, video, audio, qualityLabel),
    vars,
    budget,
  });
}

async function processEpisodeWithRetry(season, ep, vars, budget, intervalMs, retries) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await processEpisode(season, ep, vars, budget);
      return;
    } catch (error) {
      if (attempt >= retries || error?.noRetry) throw error;
      warn(
        `ep${ep?.id} 下载失败（${coerceStr(error?.message ?? error)}），`
        + `${Math.round(intervalMs / 1000)}s 后重试（第 ${attempt + 1}/${retries} 次）`,
      );
      await sleep(intervalMs);
    }
  }
}

/** 番剧模式入口：ep 下载单集；ss / md 按正片列表批量（不含 PV / 花絮等 section）。 */
export async function crawlBangumi(vars, intervalMs, retries) {
  const target = parseBangumiId(vars.bangumi_url);
  if (!target.kind) {
    throw new Error(
      "无法识别番剧链接。支持单集（/bangumi/play/ep21495）、整季（/bangumi/play/ss26801）、"
      + "剧集页（/bangumi/media/md24097891），或直接填 ep/ss/md 编号",
    );
  }

  let seasonQuery;
  if (target.kind === "md") {
    seasonQuery = `season_id=${await mediaToSeasonId(target.id)}`;
  } else if (target.kind === "ss") {
    seasonQuery = `season_id=${target.id}`;
  } else {
    seasonQuery = `ep_id=${target.id}`;
  }
  const season = await fetchSeason(seasonQuery, `${WEB_BASE}/bangumi/play/${target.kind}${target.id}`);
  const mainEpisodes = Array.isArray(season?.episodes) ? season.episodes : [];

  if (target.kind === "ep") {
    const epId = Number(target.id);
    // 正片里找不到就翻 section（声优节目、预告等花絮也有独立 ep 页）。
    let ep = mainEpisodes.find((e) => Number(e?.id) === epId);
    if (!ep) {
      for (const section of season?.section || []) {
        ep = (section?.episodes || []).find((e) => Number(e?.id) === epId);
        if (ep) break;
      }
    }
    // 元数据兜底：列表里找不到也照样按 ep_id 拉流。
    if (!ep) ep = { id: epId };
    await processEpisodeWithRetry(season, ep, vars, 100.0, intervalMs, retries);
    return;
  }

  // 整季批量：ep_start 是正片列表的 1 起序号，max_videos 截断。
  if (mainEpisodes.length === 0) throw new Error(`「${coerceStr(season?.title)}」没有正片剧集`);
  const epStart = Math.max(1, Number(vars.ep_start ?? 1));
  const maxVideos = Math.max(1, Number(vars.max_videos ?? 5));
  const episodes = mainEpisodes.slice(epStart - 1, epStart - 1 + maxVideos);
  if (episodes.length === 0) {
    throw new Error(`「${coerceStr(season?.title)}」正片共 ${mainEpisodes.length} 集，起始集数 ${epStart} 超出范围`);
  }

  console.log(
    `[bilibili-video] 番剧「${coerceStr(season?.title)}」正片共 ${mainEpisodes.length} 集，`
    + `本次从第 ${epStart} 集起下载 ${episodes.length} 集（上限 ${maxVideos}）`,
  );

  const budget = 100.0 / episodes.length;
  let failed = 0;
  let skipped = 0;
  for (let index = 0; index < episodes.length; index += 1) {
    const ep = episodes[index];
    if (index > 0) await sleep(intervalMs);
    console.log(`[bilibili-video] (${index + 1}/${episodes.length}) ep${ep?.id} ${episodeDisplayName(season, ep)}`);
    try {
      await processEpisodeWithRetry(season, ep, vars, budget, intervalMs, retries);
    } catch (error) {
      if (error?.skipEpisode) skipped += 1;
      else failed += 1;
      warn(`ep${ep?.id} ${coerceStr(error?.message ?? error)}`);
      addProgress(budget);
    }
  }

  const succeeded = episodes.length - failed - skipped;
  if (succeeded === 0) {
    throw new Error(
      skipped > 0 && failed === 0
        ? `全部 ${skipped} 集都是大会员专享且当前无权观看，未下载任何内容`
        : "所有剧集均下载失败",
    );
  }
  if (skipped > 0) warn(`共 ${episodes.length} 集，其中 ${skipped} 集为大会员专享已跳过。`);
  if (failed > 0) warn(`共 ${episodes.length} 集，其中 ${failed} 集失败。`);
}
