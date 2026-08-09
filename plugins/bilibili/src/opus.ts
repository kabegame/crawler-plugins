// @ts-nocheck
// 图文帖（opus）：详情页 INITIAL_STATE 结构化取图（含实况图 live_url），
// 失败回退正则抠 bfs 链接；关联到 cv 时复用专栏的 metadata / 评论链路。
import { buildArticleMetadata, signViewUrl } from "./article";
import { OPUS_DETAIL_API } from "./consts";
import { fetchArticleReplies } from "./replies";
import {
  checkBilibiliRisk, coerceStr, collectImageUrlsFromContent, ensureHttpsBfs, fetchJson, fetchWith509Retry,
} from "./util";

const { addProgress, createImageMetadata, downloadImage, setHeader, warn } = Kabegame;

/**
 * 解析 opus 页内嵌的 `window.__INITIAL_STATE__`（gallery-dl BilibiliAPI.article 同法）。
 * 页面偶发下发风控壳页（window._riskdata_），此时没有该对象，返回 null 走正则回退。
 */
function parseOpusInitialState(html) {
  const marker = "window.__INITIAL_STATE__=";
  const text = coerceStr(html);
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const seg = text.slice(idx + marker.length);
  const end = seg.indexOf("};");
  if (end < 0) return null;
  try {
    return JSON.parse(seg.slice(0, end + 1));
  } catch {
    return null;
  }
}

/**
 * 从 INITIAL_STATE 收集结构化图片：头图相册 + 正文段落，每项 {url, liveUrl}。
 * liveUrl 是实况图（LivePhoto）的视频轨，普通图片没有。
 * 相比正则抠 HTML 的优势：拿得到 live_url，且不受评论区里贴图的干扰。
 */
function collectOpusPicsFromState(state) {
  const out = [];
  const seen = new Set();
  const push = (pic) => {
    const url = ensureHttpsBfs(pic?.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, liveUrl: ensureHttpsBfs(pic?.live_url || "") });
  };
  for (const module of state?.detail?.modules || []) {
    if (module?.module_type === "MODULE_TYPE_BLOCKED") {
      warn(`图文被内容门槛拦截：${coerceStr(module?.module_blocked?.hint_message) || "（如充电专属）"}`);
    }
    for (const pic of module?.module_top?.display?.album?.pics || []) push(pic);
    for (const paragraph of module?.module_content?.paragraphs || []) {
      for (const pic of paragraph?.pic?.pics || []) push(pic);
    }
  }
  return out;
}

function parseCvIdFromOpusHtml(html) {
  const idx = coerceStr(html).indexOf("opus-module-copyright__right");
  const slice = idx >= 0 ? coerceStr(html).slice(idx, idx + 4000) : coerceStr(html);
  return slice.match(/cv(\d+)/i)?.[1] || "";
}

/** url 的文件名部分，用作两个数据源之间的图片配对键（域名/协议可能不同）。 */
function picFileName(url) {
  return coerceStr(url).split(/[?#]/, 1)[0].split("/").pop() || "";
}

/**
 * 相册型 opus 的 live_url 补拉：HTML INITIAL_STATE 的 album.pics 不下发 live_url
 * （正文段落里的会），但实况图的静态帧文件名恒带 `live_` 前缀——据此判断有漏，
 * 再拉 detail API（features=itemOpusStyle 的 major.opus.pics）按文件名合并。
 * best-effort：失败只影响实况视频，静态图照常。
 */
async function fillLiveUrlsFromDetail(opusId, pics) {
  const hasLive = pics.some((p) => p.liveUrl);
  const looksLive = pics.some((p) => picFileName(p.url).startsWith("live_"));
  if (hasLive || !looksLive) return;
  try {
    const json = await fetchJson(`${OPUS_DETAIL_API}?id=${opusId}&features=itemOpusStyle`);
    if (json?.code !== 0) return;
    const detailPics = json?.data?.item?.modules?.module_dynamic?.major?.opus?.pics || [];
    const byName = new Map();
    for (const pic of detailPics) {
      const live = ensureHttpsBfs(pic?.live_url || "");
      if (live) byName.set(picFileName(pic?.url), live);
    }
    for (const pic of pics) {
      if (!pic.liveUrl) pic.liveUrl = byName.get(picFileName(pic.url)) || "";
    }
  } catch {
    // 补拉失败不阻断静态图下载。
  }
}

export async function processOneOpus(opusId, perTotal, img, sub, livePhoto) {
  const pageUrl = `https://www.bilibili.com/opus/${opusId}`;
  setHeader("Referer", pageUrl);
  setHeader("Origin", "https://www.bilibili.com");
  const html = await (await fetch(pageUrl)).text();

  // 首选 INITIAL_STATE 结构化取图（能拿到实况图 live_url），失败回退正则抠 bfs 链接。
  const state = parseOpusInitialState(html);
  let pics = collectOpusPicsFromState(state);
  if (pics.length === 0) {
    pics = collectImageUrlsFromContent(html).map((url) => ({ url, liveUrl: "" }));
  }
  if (pics.length === 0) {
    if (state) {
      // 结构化数据解析成功但确实没图：纯文字动态，批量模式下很常见，不当告警。
      console.log(`[bilibili] opus ${opusId} 没有图片（纯文字动态），跳过`);
    } else {
      warn("opus 页面未解析到 bfs 图片链接，可能为壳页或结构变化；可尝试先在畅游登录 bilibili 后重试。");
    }
    addProgress(perTotal);
    return;
  }
  if (livePhoto) await fillLiveUrlsFromDetail(opusId, pics);

  const cvId = parseCvIdFromOpusHtml(html);
  let vd = null;
  let repliesData = null;
  if (cvId && img && sub) {
    const view = await fetchWith509Retry(() => signViewUrl(cvId, img, sub), `opus ${opusId} cv ${cvId} view`);
    if (view?.code === 0) vd = view.data;
    else {
      checkBilibiliRisk(view?.code);
      warn(`opus ${opusId} 关联 cv ${cvId} view 失败: ${coerceStr(view?.message)}，仍尝试拉取评论`);
    }
    repliesData = await fetchArticleReplies(cvId, img, sub);
  }

  const metadata = vd
    ? buildArticleMetadata(vd, cvId, "", repliesData, pics.length, opusId)
    : { source: "bilibili_opus", opus_id: opusId, total_image_count: pics.length };
  // 同篇多图共享一份 metadata：先建一次，下载时只传 metadata_id。
  const metadataId = Number(createImageMetadata(metadata, null));
  const base = coerceStr(vd?.title) || `图文 ${opusId}`;
  // 进度按实际文件数分摊：实况图的视频轨算一个独立文件（gallery-dl 同样输出两个文件）。
  const liveCount = livePhoto ? pics.filter((p) => p.liveUrl).length : 0;
  const perFile = perTotal / (pics.length + liveCount);
  for (let index = 0; index < pics.length; index += 1) {
    const name = pics.length > 1 ? `${base}(${index + 1})` : base;
    await downloadImage(pics[index].url, { name, metadata_id: metadataId, url: pageUrl });
    addProgress(perFile);
    if (livePhoto && pics[index].liveUrl) {
      await downloadImage(pics[index].liveUrl, { name: `${name}(live)`, metadata_id: metadataId, url: pageUrl });
      addProgress(perFile);
    }
  }
}
